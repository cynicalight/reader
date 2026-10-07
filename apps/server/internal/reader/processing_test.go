package reader

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func processingFixture(t *testing.T) (*Server, Processing) {
	t.Helper()
	store, e := OpenStore(t.TempDir())
	if e != nil {
		t.Fatal(e)
	}
	t.Cleanup(func() { store.DB.Close() })
	_, e = store.DB.Exec("INSERT INTO documents(id,type,title,author,size,created_at,last_opened_at) VALUES('doc','pdf','test','',1,?,?)", now(), now())
	if e != nil {
		t.Fatal(e)
	}
	s := NewServer(store, "test", "")
	d, _ := store.Document("doc")
	if e = store.enqueuePDF(d); e != nil {
		t.Fatal(e)
	}
	p, _ := store.processing("doc")
	dir := s.analysisDir("doc")
	if e = os.MkdirAll(filepath.Join(dir, "assets"), 0700); e != nil {
		t.Fatal(e)
	}
	b := PDFBlock{ID: "p1-b1", Page: 1, Label: "chart", Image: "assets/p1-b1.png"}
	b.Bounds.X = .1
	b.Bounds.Y = .1
	b.Bounds.Width = .3
	b.Bounds.Height = .4
	data, _ := json.Marshal(layoutManifest{Pages: 2, Blocks: []PDFBlock{b}})
	if e = os.WriteFile(filepath.Join(dir, "manifest.json"), data, 0600); e != nil {
		t.Fatal(e)
	}
	return s, p
}
func TestProcessingWaitsForVisionAndKeepsBlocks(t *testing.T) {
	s, p := processingFixture(t)
	if e := s.learnPDF(context.Background(), &p); e != nil {
		t.Fatal(e)
	}
	if p.Phase != "settling" || p.PagesDone != 2 || p.AssetsTotal != 1 {
		t.Fatalf("wrong learning result: %+v", p)
	}
	if e := s.processPDF(context.Background(), &p); e != nil {
		t.Fatal(e)
	}
	if p.Status != "waiting" || p.AssetsDone != 0 {
		t.Fatalf("fake completion: %+v", p)
	}
	m, e := s.readLayout("doc")
	if e != nil || len(m.Blocks) != 1 {
		t.Fatal("blocks unavailable while waiting")
	}
	s.wakeProcessing()
	saved, _ := s.Store.processing("doc")
	if saved.Status != "queued" {
		t.Fatal("configuration change did not resume")
	}
}
func TestProcessingResumesSavedTranscriptsWithoutCallingAI(t *testing.T) {
	s, p := processingFixture(t)
	if e := s.learnPDF(context.Background(), &p); e != nil {
		t.Fatal(e)
	}
	dir := filepath.Join(s.analysisDir("doc"), "transcripts")
	_ = os.MkdirAll(dir, 0700)
	target := filepath.Join(dir, "p1-b1.md")
	if e := writeTranscript(target, []byte("user-corrected transcript")); e != nil {
		t.Fatal(e)
	}
	if e := writeTranscript(target, []byte("replacement")); e == nil {
		t.Fatal("overwrote a transcript")
	}
	if e := s.processPDF(context.Background(), &p); e != nil {
		t.Fatal(e)
	}
	if p.Status != "complete" || p.AssetsDone != 1 {
		t.Fatalf("did not resume %+v", p)
	}
	data, _ := os.ReadFile(target)
	if string(data) != "user-corrected transcript" {
		t.Fatal("user correction lost")
	}
}

func TestProcessingTranslatesIndependentlyOfAttachments(t *testing.T) {
	for _, mode := range []string{"slow", "saved", "waiting", "failed"} {
		t.Run(mode, func(t *testing.T) {
			s, p := processingFixture(t)
			m, _ := s.readLayout("doc")
			m.Blocks[0].Caption = "Figure one."
			dir := s.analysisDir("doc")
			data, _ := json.Marshal(m)
			if err := os.WriteFile(filepath.Join(dir, "manifest.json"), data, 0600); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(filepath.Join(dir, m.Blocks[0].Image), []byte("fixture"), 0600); err != nil {
				t.Fatal(err)
			}
			target := filepath.Join(dir, "transcripts", "p1-b1.md")
			if mode == "saved" {
				_ = os.MkdirAll(filepath.Dir(target), 0700)
				if err := writeTranscript(target, []byte("saved interpretation\n")); err != nil {
					t.Fatal(err)
				}
			}
			release := make(chan struct{})
			var once sync.Once
			unblock := func() { once.Do(func() { close(release) }) }
			textStarted := make(chan struct{})
			var imageCalls atomic.Int32
			images := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				imageCalls.Add(1)
				if mode == "failed" {
					http.Error(w, "image provider unavailable", http.StatusServiceUnavailable)
					return
				}
				if mode == "slow" {
					<-release
				}
				w.Header().Set("Content-Type", "text/event-stream")
				sendTranslationDelta(w, "saved interpretation")
				finishTranslationStream(w)
			}))
			defer images.Close()
			defer unblock()
			text := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				close(textStarted)
				saved, err := s.Store.processing("doc")
				if err != nil || saved.Translating == nil || saved.Translating.Status != "running" {
					t.Error("independent translation state was not published")
				}
				w.Header().Set("Content-Type", "text/event-stream")
				for _, paragraph := range readTranslationInput(t, r).Batch.Paragraphs {
					sendTranslationDelta(w, translationParagraphLine(paragraph))
				}
				finishTranslationStream(w)
			}))
			defer text.Close()
			configureTranslationTest(t, s, text.URL)
			config := s.aiConfig()
			config.ImageAPI = APIConnection{URL: images.URL, Model: "test"}
			if mode != "waiting" {
				config.Capabilities["image-api"] = Capability{Text: true, Vision: true, Fingerprint: configPrint(config, "image-api")}
			}
			if err := s.writeAIConfig(config); err != nil {
				t.Fatal(err)
			}
			if err := s.learnPDF(context.Background(), &p); err != nil {
				t.Fatal(err)
			}
			done := make(chan error, 1)
			go func() { done <- s.processPDF(context.Background(), &p) }()
			waitFormulaSignal(t, textStarted)
			if mode == "slow" {
				deadline := time.Now().Add(5 * time.Second)
				for {
					state, _ := s.Store.processing("doc")
					if state.Translating.Status == "complete" {
						if state.Settling.Status != "running" || state.AssetsDone != 0 || state.TranslationsDone != 1 || state.Status != "running" {
							t.Fatalf("lost parallel progress: %+v", state)
						}
						if _, err := os.Stat(target); !os.IsNotExist(err) {
							t.Fatal("test did not hold up consolidation")
						}
						break
					}
					if time.Now().After(deadline) {
						t.Fatal("translation blocked by consolidation")
					}
					time.Sleep(5 * time.Millisecond)
				}
			}
			unblock()
			err := <-done
			if p.Translating.Status != "complete" || p.TranslationsDone != 1 {
				t.Fatalf("lost completed translation: %+v", p)
			}
			if mode == "waiting" {
				if err != nil || p.Settling.Status != "waiting" || p.Status != "waiting" {
					t.Fatalf("%+v %v", p, err)
				}
			} else if mode == "failed" {
				if err == nil || p.Settling.Status != "failed" || p.Status != "failed" {
					t.Fatalf("%+v %v", p, err)
				}
			} else if err != nil || p.Status != "complete" || p.AssetsDone != 1 {
				t.Fatalf("%+v %v", p, err)
			}
			if mode == "saved" && imageCalls.Load() != 0 {
				t.Fatal("regenerated saved attachment")
			}
		})
	}
}
func TestLayoutRejectsEscapingAssetPath(t *testing.T) {
	s, _ := processingFixture(t)
	path := filepath.Join(s.analysisDir("doc"), "manifest.json")
	data, _ := os.ReadFile(path)
	var m layoutManifest
	_ = json.Unmarshal(data, &m)
	m.Blocks[0].Image = "../../outside.png"
	data, _ = json.Marshal(m)
	_ = os.WriteFile(path, data, 0600)
	if _, e := s.readLayout("doc"); e == nil {
		t.Fatal("escaping path accepted")
	}
}
func TestProcessingInterruptedStateIsQueuedOnRestart(t *testing.T) {
	s, p := processingFixture(t)
	p.Status = "running"
	_ = s.Store.saveProcessing(p)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	stop := s.StartProcessing(ctx)
	stop()
	saved, _ := s.Store.processing("doc")
	if saved.Status != "queued" {
		t.Fatalf("lost interrupted task: %+v", saved)
	}
}
func TestLibraryLockIsExclusive(t *testing.T) {
	root := t.TempDir()
	release, e := LockLibrary(root)
	if e != nil {
		t.Fatal(e)
	}
	if second, e := LockLibrary(root); e == nil {
		second()
		t.Fatal("second library writer admitted")
	}
	release()
	next, e := LockLibrary(root)
	if e != nil {
		t.Fatal(e)
	}
	next()
}
func TestMissingPrimaryWaitsEvenWithVerifiedImageAPI(t *testing.T) {
	s, p := processingFixture(t)
	_ = s.learnPDF(context.Background(), &p)
	c := AIConfig{Models: map[string]string{}, ImageAPI: APIConnection{URL: "https://example.com/v1", Model: "image"}, Capabilities: map[string]Capability{}}
	c.Capabilities["image-api"] = Capability{Text: true, Vision: true, Fingerprint: configPrint(c, "image-api")}
	_ = s.writeAIConfig(c)
	if e := s.processPDF(context.Background(), &p); e != nil {
		t.Fatal(e)
	}
	if p.Status != "waiting" {
		t.Fatalf("missing primary incorrectly failed: %+v", p)
	}
}
func TestScannedPagesRemainExplicitlyIncomplete(t *testing.T) {
	s, p := processingFixture(t)
	m := layoutManifest{Pages: 2, Blocks: []PDFBlock{}, Warnings: []string{"第 1 页无可提取文字；尚未接入 OCR，正文不完整。"}, IncompletePages: []int{1}}
	data, _ := json.Marshal(m)
	_ = os.WriteFile(filepath.Join(s.analysisDir("doc"), "manifest.json"), data, 0600)
	if e := s.learnPDF(context.Background(), &p); e != nil {
		t.Fatal(e)
	}
	if !p.Incomplete || p.Detail == "正文已就绪，无图片附件需要解析" {
		t.Fatalf("claimed complete text: %+v", p)
	}
}
func TestConcurrentCapabilitySaveDoesNotLoseWake(t *testing.T) {
	s, p := processingFixture(t)
	p.Phase = "settling"
	for i := 0; i < 20; i++ {
		empty := AIConfig{Models: map[string]string{}, Capabilities: map[string]Capability{}}
		_ = s.writeAIConfig(empty)
		p.Status = "running"
		_ = s.Store.saveProcessing(p)
		var wg sync.WaitGroup
		wg.Add(2)
		go func() { defer wg.Done(); copy := p; _, _ = s.waitForVision(&copy) }()
		go func() {
			defer wg.Done()
			c := AIConfig{Primary: "codex", Models: map[string]string{}, Capabilities: map[string]Capability{}}
			c.Capabilities["codex"] = Capability{Text: true, Vision: true, Fingerprint: configPrint(c, "codex")}
			s.configMu.Lock()
			_ = s.writeAIConfig(c)
			s.wakeProcessing()
			s.configMu.Unlock()
		}()
		wg.Wait()
		saved, _ := s.Store.processing("doc")
		if saved.Status == "waiting" {
			t.Fatal("lost capability wake")
		}
	}
}
