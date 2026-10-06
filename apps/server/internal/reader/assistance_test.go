package reader

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func assistanceRequest(t *testing.T, s *Server, action string, page int) Processing {
	t.Helper()
	s.Token = "test-secret"
	body, _ := json.Marshal(map[string]any{"action": action, "page": page})
	w := request(t, s, "POST", "/api/documents/doc/assistance", strings.NewReader(string(body)))
	if w.Code != 200 {
		t.Fatalf("%s: %d %s", action, w.Code, w.Body.String())
	}
	var p Processing
	if e := json.Unmarshal(w.Body.Bytes(), &p); e != nil {
		t.Fatal(e)
	}
	return p
}
func TestAssistanceDefaultLegacyAndPauseSurviveRestart(t *testing.T) {
	s, p := processingFixture(t)
	p.Mode = ""
	p.Enabled = false
	p.Status = "running"
	_ = s.Store.saveProcessing(p)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	s.StartProcessing(ctx)()
	got, _ := s.Store.processing("doc")
	if got.Enabled || got.Status != "paused" {
		t.Fatalf("legacy task resumed: %+v", got)
	}
	p = assistanceRequest(t, s, "reading", 2)
	if !p.Enabled || p.Mode != "reading" || p.PageStart != 2 || p.PageEnd != 2 {
		t.Fatalf("wrong scope: %+v", p)
	}
	p = assistanceRequest(t, s, "pause", 2)
	s.StartProcessing(ctx)()
	got, _ = s.Store.processing("doc")
	if got.Enabled || got.Status != "paused" {
		t.Fatalf("pause lost on restart: %+v", got)
	}
	got = assistanceRequest(t, s, "follow", 1)
	if got.Enabled || got.PageStart != p.PageStart {
		t.Fatal("navigation enabled a paused task")
	}
	if r := request(t, s, "POST", "/api/documents/doc/processing", nil); r.Code != 409 {
		t.Fatal("retry enabled a paused task")
	}
}
func TestAssistanceJoinsProcessingWithoutCancellingChat(t *testing.T) {
	s, p := processingFixture(t)
	s.Token = "test-secret"
	p.Mode = "reading"
	p.PageStart = 1
	p.PageEnd = 2
	_ = s.Store.saveProcessing(p)
	ctx, cancel := context.WithCancel(context.Background())
	task := &documentTask{cancel: cancel, done: make(chan struct{})}
	s.activeProcessing = map[string]*documentTask{"doc": task}
	chat, finish, e := s.beginDocumentTask(context.Background(), "doc")
	if e != nil {
		t.Fatal(e)
	}
	defer finish()
	go func() {
		<-ctx.Done()
		p.Status = "failed"
		p.Enabled = true
		_ = s.Store.saveProcessing(p)
		s.finishProcessingTask("doc", task)
	}()
	got := assistanceRequest(t, s, "pause", 1)
	if got.Enabled || got.Status != "paused" {
		t.Fatalf("stale worker overwrote pause: %+v", got)
	}
	if chat.Err() != nil {
		t.Fatal("paused the independent chat")
	}
}
func TestReadingScopeDoesNotTranslateCachedPagesOutsideWindow(t *testing.T) {
	s, _, m := translationFixture(t)
	m.Pages = 20
	outside := m.Blocks[0]
	outside.ID = "p9-b1"
	outside.Page = 9
	m.Blocks = append(m.Blocks, outside)
	raw, _ := json.Marshal(m)
	_ = os.WriteFile(filepath.Join(s.analysisDir("doc"), "manifest.json"), raw, 0600)
	var calls atomic.Int32
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		input := readTranslationInput(t, r)
		for _, paragraph := range input.Batch.Paragraphs {
			if paragraph.BlockID == outside.ID {
				t.Error("translated an unread page")
			}
		}
		w.Header().Set("Content-Type", "text/event-stream")
		for _, paragraph := range input.Batch.Paragraphs {
			sendTranslationDelta(w, translationParagraphLine(paragraph))
		}
		finishTranslationStream(w)
	}))
	defer provider.Close()
	configureTranslationTest(t, s, provider.URL)
	p := assistanceRequest(t, s, "reading", 1)
	if e := s.learnPDF(context.Background(), &p); e != nil {
		t.Fatal(e)
	}
	if e := s.settlePDF(context.Background(), &p); e != nil {
		t.Fatal(e)
	}
	before := calls.Load()
	if before != 1 {
		t.Fatalf("calls=%d", before)
	}
	p = assistanceRequest(t, s, "reading", 1)
	if e := s.learnPDF(context.Background(), &p); e != nil {
		t.Fatal(e)
	}
	if e := s.settlePDF(context.Background(), &p); e != nil {
		t.Fatal(e)
	}
	if calls.Load() != before {
		t.Fatal("revisited page generated again")
	}
	items, _ := s.translations("doc", m)
	if items[len(items)-1].Status != "pending" {
		t.Fatal("modified unread page")
	}
	if w := request(t, s, "POST", "/api/documents/doc/translations", strings.NewReader(`{"blockId":"p9-b1"}`)); w.Code != 409 {
		t.Fatal("explicit paragraph request escaped scope")
	}
}
func TestPartialExtractionPassesOnlyMissingPagesAndPreservesCache(t *testing.T) {
	s, p := processingFixture(t)
	m, _ := s.readLayout("doc")
	m.Pages = 20
	m.ProcessedPages = []int{1}
	raw, _ := json.Marshal(m)
	_ = os.WriteFile(filepath.Join(s.analysisDir("doc"), "manifest.json"), raw, 0600)
	script := filepath.Join(t.TempDir(), "worker.sh")
	// The fake processor fails if the server omits or broadens --pages.
	contents := `#!/bin/sh
while [ "$#" -gt 0 ]; do
 case "$1" in --output) out="$2";; --pages) pages="$2";; esac
 shift 2
done
[ "$pages" = "4,5,6" ] || exit 42
mkdir -p "$out/assets"
printf '%s' '{"pages":20,"processedPages":[4,5,6],"blocks":[],"warnings":[]}' > "$out/manifest.json"
`
	if e := os.WriteFile(script, []byte(contents), 0700); e != nil {
		t.Fatal(e)
	}
	t.Setenv("READER_NODE", "/bin/sh")
	t.Setenv("READER_PROCESSOR", script)
	p.Mode = "reading"
	p.PageStart = 4
	p.PageEnd = 6
	if e := s.learnPDF(context.Background(), &p); e != nil {
		t.Fatal(e)
	}
	got, e := s.readLayout("doc")
	if e != nil {
		t.Fatal(e)
	}
	if len(got.Blocks) != 1 || got.Blocks[0].ID != m.Blocks[0].ID || len(got.ProcessedPages) != 4 {
		t.Fatalf("cache lost: %+v", got)
	}
	if p.PagesDone != 3 || p.PagesTotal != 3 || p.AssetsTotal != 0 {
		t.Fatalf("range progress counted whole document: %+v", p)
	}
	// Empty/scanned pages are cached too, and must not be re-extracted.
	t.Setenv("READER_PROCESSOR", "/does/not/exist")
	if e := s.learnPDF(context.Background(), &p); e != nil {
		t.Fatalf("reparsed cached empty pages: %v", e)
	}
}
func TestFullProcessingAdvancesButReadingWindowDoesNot(t *testing.T) {
	s, p := processingFixture(t)
	m, _ := s.readLayout("doc")
	m.Pages = 10
	raw, _ := json.Marshal(m)
	_ = os.WriteFile(filepath.Join(s.analysisDir("doc"), "manifest.json"), raw, 0600)
	p.Mode = "reading"
	p.PageStart = 1
	p.PageEnd = 3
	p.Status = "complete"
	if e := s.advanceFullProcessing(&p); e != nil {
		t.Fatal(e)
	}
	if p.PageStart != 1 || p.Status != "complete" {
		t.Fatal("prefetch ran ahead")
	}
	p.Mode = "full"
	if e := s.advanceFullProcessing(&p); e != nil {
		t.Fatal(e)
	}
	if p.PageStart != 4 || p.PageEnd != 6 || p.Status != "queued" {
		t.Fatalf("full batch: %+v", p)
	}
	_ = s.Store.saveProcessing(p)
	assistanceRequest(t, s, "pause", 4)
	got := assistanceRequest(t, s, "resume", 4)
	if got.PageStart != 4 || got.Mode != "full" {
		t.Fatalf("full resume revisited early pages: %+v", got)
	}
}
func TestImportDoesNotStartBackgroundAI(t *testing.T) {
	s := testServer(t)
	d := organizationDoc(t, s)
	p, e := s.Store.processing(d.ID)
	if e != nil || p.Enabled || p.Status != "paused" {
		t.Fatalf("import processing: %+v %v", p, e)
	}
	if d.ClassificationStatus != "idle" {
		t.Fatal("import queued AI classification")
	}
	ctx, cancel := context.WithCancel(context.Background())
	stop := s.StartProcessing(ctx)
	defer func() { cancel(); stop() }()
	time.Sleep(1200 * time.Millisecond)
	p, _ = s.Store.processing(d.ID)
	if p.Enabled || p.Status != "paused" {
		t.Fatalf("background claimed imported PDF: %+v", p)
	}
}

func TestInvalidPartialManifestCannotReplaceExistingCache(t *testing.T) {
	s, _ := processingFixture(t)
	before, e := os.ReadFile(filepath.Join(s.analysisDir("doc"), "manifest.json"))
	if e != nil {
		t.Fatal(e)
	}
	work := t.TempDir()
	for _, body := range []string{
		`{"pages":2,"processedPages":[2],"blocks":[{"id":"p2-b1","page":2,"bounds":{"width":1,"height":1},"image":"../../outside.png"}]}`,
		`{"pages":2,"processedPages":[1,2],"blocks":[]}`,
	} {
		if e = os.WriteFile(filepath.Join(work, "manifest.json"), []byte(body), 0600); e != nil {
			t.Fatal(e)
		}
		if e = s.mergeLayout("doc", work, []int{2}); e == nil {
			t.Fatal("invalid/out-of-scope partial manifest accepted")
		}
		after, e := os.ReadFile(filepath.Join(s.analysisDir("doc"), "manifest.json"))
		if e != nil || string(after) != string(before) {
			t.Fatal("invalid candidate replaced existing cache")
		}
	}
}

func TestFullProcessingRetainsEarlierOCRWarnings(t *testing.T) {
	s, p := processingFixture(t)
	m, _ := s.readLayout("doc")
	m.Pages = 10
	m.IncompletePages = []int{1}
	m.Warnings = []string{"第 1 页无可提取文字；尚未接入 OCR，正文不完整。"}
	data, _ := json.Marshal(m)
	_ = os.WriteFile(filepath.Join(s.analysisDir("doc"), "manifest.json"), data, 0600)
	p.Mode = "full"
	p.PageStart = 4
	p.PageEnd = 6
	if e := s.learnPDF(context.Background(), &p); e != nil {
		t.Fatal(e)
	}
	if !p.Incomplete {
		t.Fatal("whole-book status forgot an earlier scanned page")
	}
	p.Mode = "reading"
	if e := s.learnPDF(context.Background(), &p); e != nil {
		t.Fatal(e)
	}
	if p.Incomplete || p.Warning != "" {
		t.Fatal("unrelated scanned page marked the reading window incomplete")
	}
}
