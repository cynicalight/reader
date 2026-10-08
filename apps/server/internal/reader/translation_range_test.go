package reader

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"testing"
)

// Ten pages with one 9000-character paragraph each and a formula image on page 9.
func bookFixture(t *testing.T) (*Server, Processing, layoutManifest) {
	t.Helper()
	s, p := processingFixture(t)
	s.Token = "test-secret"
	if _, err := s.Store.DB.Exec("UPDATE documents SET library='books' WHERE id='doc'"); err != nil {
		t.Fatal(err)
	}
	m := layoutManifest{Pages: 10}
	for page := 1; page <= 10; page++ {
		b := PDFBlock{ID: fmt.Sprintf("p%d-b1", page), Page: page, Label: "text", Text: strings.Repeat("Word. ", 1500)}
		b.Bounds.X, b.Bounds.Y, b.Bounds.Width, b.Bounds.Height = .1, .1, .5, .3
		m.Blocks = append(m.Blocks, b)
	}
	formula := PDFBlock{ID: "p9-b2", Page: 9, Label: "display_formula", Text: "E=mc^2", Image: "assets/p9-b2.png"}
	formula.Bounds.X, formula.Bounds.Y, formula.Bounds.Width, formula.Bounds.Height = .1, .5, .5, .1
	m.Blocks = append(m.Blocks, formula)
	dir := s.analysisDir("doc")
	if err := os.WriteFile(filepath.Join(dir, formula.Image), []byte("png"), 0600); err != nil {
		t.Fatal(err)
	}
	data, _ := json.Marshal(m)
	if err := os.WriteFile(filepath.Join(dir, "manifest.json"), data, 0600); err != nil {
		t.Fatal(err)
	}
	return s, p, m
}

func translationStatuses(t *testing.T, s *Server, m layoutManifest) map[string]string {
	t.Helper()
	items, err := s.translations("doc", m)
	if err != nil {
		t.Fatal(err)
	}
	out := map[string]string{}
	for _, item := range items {
		out[item.BlockID] = item.Status
	}
	return out
}

func requestRange(t *testing.T, s *Server, from, to int) (int, translationRange) {
	t.Helper()
	w := request(t, s, "POST", "/api/documents/doc/translations/range", strings.NewReader(fmt.Sprintf(`{"fromPage":%d,"toPage":%d}`, from, to)))
	var result translationRange
	if w.Code == 202 {
		if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
			t.Fatal(err)
		}
	}
	return w.Code, result
}

func TestBookImportParsesLayoutWithoutAutomaticTranslation(t *testing.T) {
	s := testServer(t)
	s.Token = "test-secret"
	if w := request(t, s, "PUT", "/api/settings", strings.NewReader(`{"autoTranslatePDF":false}`)); w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	w := uploadTo(t, s, "books", "book.pdf", sample(t, "reading-notes.pdf"))
	if w.Code != 201 {
		t.Fatal(w.Body.String())
	}
	var d Document
	_ = json.Unmarshal(w.Body.Bytes(), &d)
	p, err := s.Store.processing(d.ID)
	if err != nil || !p.Enabled || p.Status != "queued" || p.Phase != "learning" {
		t.Fatalf("book layout was not queued: %+v %v", p, err)
	}
}

func TestBookTranslatesOnlyRequestedChapterWithinLimit(t *testing.T) {
	s, p, m := bookFixture(t)
	var mu sync.Mutex
	translated := []string{}
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		input := readTranslationInput(t, r)
		w.Header().Set("Content-Type", "text/event-stream")
		for _, paragraph := range input.Batch.Paragraphs {
			mu.Lock()
			translated = append(translated, paragraph.BlockID)
			mu.Unlock()
			sendTranslationDelta(w, translationParagraphLine(paragraph))
		}
		finishTranslationStream(w)
	}))
	defer provider.Close()
	configureTranslationTest(t, s, provider.URL)

	if err := s.learnPDF(context.Background(), &p); err != nil {
		t.Fatal(err)
	}
	if p.Status != "complete" || p.TranslationsTotal != 0 {
		t.Fatalf("book queued translation after layout: %+v", p)
	}
	for id, status := range translationStatuses(t, s, m) {
		if status != "idle" {
			t.Fatalf("%s is %s before any request", id, status)
		}
	}
	if w := request(t, s, "POST", "/api/documents/doc/translations", strings.NewReader(`{}`)); w.Code != 400 {
		t.Fatal("book accepted a whole-document translation request")
	}
	if code, _ := requestRange(t, s, 0, 3); code != 400 {
		t.Fatal("accepted page 0")
	}
	if code, _ := requestRange(t, s, 4, 11); code != 400 {
		t.Fatal("accepted a page past the end")
	}

	code, result := requestRange(t, s, 2, 6)
	if code != 202 || result.Queued != 4 || result.Characters != 4*8999 || result.NextPage != 6 {
		t.Fatalf("chapter limit not applied: %d %+v", code, result)
	}
	p, _ = s.Store.processing("doc")
	if p.Status != "queued" || p.Phase != "translating" {
		t.Fatalf("range request did not queue translation: %+v", p)
	}
	if err := s.processPDF(context.Background(), &p); err != nil {
		t.Fatal(err)
	}
	sort.Strings(translated)
	if strings.Join(translated, ",") != "p2-b1,p3-b1,p4-b1,p5-b1" {
		t.Fatalf("translated %v", translated)
	}
	statuses := translationStatuses(t, s, m)
	for id, want := range map[string]string{"p1-b1": "idle", "p2-b1": "complete", "p5-b1": "complete", "p6-b1": "idle", "p9-b2": "idle"} {
		if statuses[id] != want {
			t.Fatalf("%s is %s, want %s", id, statuses[id], want)
		}
	}
	p, _ = s.Store.processing("doc")
	if p.Status != "complete" || p.TranslationsDone != 4 || p.TranslationsTotal != 4 {
		t.Fatalf("progress counted unrequested paragraphs: %+v", p)
	}

	code, result = requestRange(t, s, 2, 6)
	if code != 202 || result.Queued != 1 || result.NextPage != 0 {
		t.Fatalf("continuing the chapter: %d %+v", code, result)
	}
}

func TestBookRangeRequestResumesPausedProcessing(t *testing.T) {
	s, p, _ := bookFixture(t)
	if err := s.learnPDF(context.Background(), &p); err != nil {
		t.Fatal(err)
	}
	if got := assistanceRequest(t, s, "pause"); got.Enabled {
		t.Fatal("pause did not disable processing")
	}
	if code, result := requestRange(t, s, 1, 1); code != 202 || result.Queued != 1 {
		t.Fatalf("range request: %d %+v", code, result)
	}
	p, _ = s.Store.processing("doc")
	if !p.Enabled || p.Status != "queued" {
		t.Fatalf("explicit chapter request stayed paused: %+v", p)
	}
}
