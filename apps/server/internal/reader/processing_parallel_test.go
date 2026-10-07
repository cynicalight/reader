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

func TestProcessingProgressMergesConcurrentLanes(t *testing.T) {
	s, p := processingFixture(t)
	if err := s.learnPDF(context.Background(), &p); err != nil {
		t.Fatal(err)
	}
	p.Settling = &ProcessingStage{Status: "running"}
	p.Translating = &ProcessingStage{Status: "running"}
	if err := s.Store.saveProcessing(p); err != nil {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	for _, lane := range []string{"settling", "translating"} {
		work := p
		work.lane = lane
		wg.Add(1)
		go func() {
			defer wg.Done()
			for i := 1; i <= 50; i++ {
				work.AssetsDone, work.TranslationsDone = i, i
				if err := s.Store.saveProcessing(work); err != nil {
					t.Error(err)
					return
				}
			}
		}()
	}
	wg.Wait()
	state, _ := s.Store.processing("doc")
	if state.AssetsDone != 50 || state.TranslationsDone != 50 {
		t.Fatalf("progress overwritten: %+v", state)
	}
}
func TestProcessingRecoveryPreservesCompletedLane(t *testing.T) {
	s, p := processingFixture(t)
	if err := s.learnPDF(context.Background(), &p); err != nil {
		t.Fatal(err)
	}
	p.Settling = &ProcessingStage{Status: "running"}
	p.Translating = &ProcessingStage{Status: "complete"}
	p.TranslationsDone = 7
	p.Status = "running"
	if err := s.Store.saveProcessing(p); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	stop := s.StartProcessing(ctx)
	stop()
	state, _ := s.Store.processing("doc")
	if state.Settling.Status != "queued" || state.Translating.Status != "complete" || state.TranslationsDone != 7 {
		t.Fatalf("completed lane reset: %+v", state)
	}
}
func TestProcessingWakeDoesNotResetFailedOrCompletedLane(t *testing.T) {
	s, p := processingFixture(t)
	if err := s.learnPDF(context.Background(), &p); err != nil {
		t.Fatal(err)
	}
	p.Settling = &ProcessingStage{Status: "waiting"}
	p.Translating = &ProcessingStage{Status: "failed", Detail: "text failed"}
	aggregateProcessing(&p)
	if err := s.Store.saveProcessing(p); err != nil {
		t.Fatal(err)
	}
	s.wakeProcessing()
	state, _ := s.Store.processing("doc")
	if state.Settling.Status != "queued" || state.Translating.Status != "failed" {
		t.Fatalf("wake altered other lane: %+v", state)
	}
}
func TestProcessingRetryKeepsCompletedTranslation(t *testing.T) {
	s, p := processingFixture(t)
	s.Token = "test-secret"
	if err := s.learnPDF(context.Background(), &p); err != nil {
		t.Fatal(err)
	}
	p.Settling = &ProcessingStage{Status: "failed", Detail: "image failed"}
	p.Translating = &ProcessingStage{Status: "complete"}
	p.TranslationsDone = 5
	aggregateProcessing(&p)
	if err := s.Store.saveProcessing(p); err != nil {
		t.Fatal(err)
	}
	w := request(t, s, "POST", "/api/documents/doc/processing", nil)
	if w.Code != 200 {
		t.Fatalf("%s", w.Body.String())
	}
	state, _ := s.Store.processing("doc")
	if state.Settling.Status != "queued" || state.Translating.Status != "complete" || state.TranslationsDone != 5 {
		t.Fatalf("retry altered completed translation: %+v", state)
	}
}

func TestTranslationFailureDoesNotCancelConsolidation(t *testing.T) {
	s, p, m := formulaFixture(t)
	// Use only the captioned table, so the failure belongs to text translation.
	m.Blocks = m.Blocks[1:]
	data, _ := json.Marshal(m)
	if err := os.WriteFile(filepath.Join(s.analysisDir("doc"), "manifest.json"), data, 0600); err != nil {
		t.Fatal(err)
	}
	images := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		sendTranslationDelta(w, "saved table")
		finishTranslationStream(w)
	}))
	defer images.Close()
	text := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "text unavailable", http.StatusServiceUnavailable)
	}))
	defer text.Close()
	configureFormulaTest(t, s, text.URL, images.URL)
	if err := s.learnPDF(context.Background(), &p); err != nil {
		t.Fatal(err)
	}
	if err := s.processPDF(context.Background(), &p); err == nil {
		t.Fatal("translation failure ignored")
	}
	if p.Settling.Status != "complete" || p.Translating.Status != "failed" || p.AssetsDone != 1 {
		t.Fatalf("consolidation was lost: %+v", p)
	}
	if !s.attachmentReady("doc", m.Blocks[0]) {
		t.Fatal("consolidation result missing")
	}
}
func TestParallelCancellationPreservesFinishedTranslationAndResumesOnlyAssets(t *testing.T) {
	s, p, m := formulaFixture(t)
	m.Blocks = m.Blocks[1:]
	data, _ := json.Marshal(m)
	if err := os.WriteFile(filepath.Join(s.analysisDir("doc"), "manifest.json"), data, 0600); err != nil {
		t.Fatal(err)
	}
	started := make(chan struct{})
	release := make(chan struct{})
	var once sync.Once
	unblock := func() { once.Do(func() { close(release) }) }
	var imageCalls, textCalls atomic.Int32
	images := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if imageCalls.Add(1) == 1 {
			close(started)
			<-release
		}
		w.Header().Set("Content-Type", "text/event-stream")
		sendTranslationDelta(w, "saved table")
		finishTranslationStream(w)
	}))
	defer images.Close()
	defer unblock()
	text := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		textCalls.Add(1)
		w.Header().Set("Content-Type", "text/event-stream")
		for _, para := range readTranslationInput(t, r).Batch.Paragraphs {
			sendTranslationDelta(w, translationParagraphLine(para))
		}
		finishTranslationStream(w)
	}))
	defer text.Close()
	configureFormulaTest(t, s, text.URL, images.URL)
	if err := s.learnPDF(context.Background(), &p); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { done <- s.processPDF(ctx, &p) }()
	waitFormulaSignal(t, started)
	deadline := time.Now().Add(5 * time.Second)
	for {
		state, _ := s.Store.processing("doc")
		if state.Translating.Status == "complete" {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("translation did not finish independently")
		}
		time.Sleep(5 * time.Millisecond)
	}
	cancel()
	if err := <-done; err == nil {
		t.Fatal("cancellation ignored")
	}
	unblock()
	if p.Settling.Status != "queued" || p.Translating.Status != "complete" {
		t.Fatalf("lost completed stage: %+v", p)
	}
	if err := s.processPDF(context.Background(), &p); err != nil {
		t.Fatal(err)
	}
	if p.Status != "complete" || imageCalls.Load() != 2 || textCalls.Load() != 1 {
		t.Fatalf("resume repeated translation: %+v image=%d text=%d", p, imageCalls.Load(), textCalls.Load())
	}
}
