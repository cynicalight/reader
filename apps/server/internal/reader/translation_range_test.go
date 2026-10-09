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

func translationStatuses(t *testing.T, s *Server, id string, m layoutManifest) map[string]string {
	t.Helper()
	items, err := s.translations(id, m)
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

func TestBookImportWaitsForAChapterRequest(t *testing.T) {
	s := testServer(t)
	s.Token = "test-secret"
	w := uploadTo(t, s, "books", "book.pdf", sample(t, "reading-notes.pdf"))
	if w.Code != 201 {
		t.Fatal(w.Body.String())
	}
	var d Document
	_ = json.Unmarshal(w.Body.Bytes(), &d)
	p, err := s.Store.processing(d.ID)
	if err != nil || !p.Enabled || p.Status != "complete" || p.Phase != "ready" {
		t.Fatalf("book import started processing: %+v %v", p, err)
	}
	if d.ClassificationStatus != "idle" {
		t.Fatal("book PDF queued classification before any text was parsed")
	}
}

// fakeLayout stands in for the processor: it records the requested pages and
// writes one 1020-character paragraph per page of an 80-page book.
func fakeLayout(t *testing.T) (log string) {
	t.Helper()
	dir := t.TempDir()
	log = filepath.Join(dir, "calls.log")
	script := filepath.Join(dir, "layout.sh")
	body := `while [ $# -gt 0 ]; do case "$1" in --output) out="$2"; shift;; --from-page) from="$2"; shift;; --to-page) to="$2"; shift;; esac; shift; done
echo "$from-$to" >> "$FAKE_LAYOUT_LOG"
mkdir -p "$out/assets"
text=""; i=0; while [ $i -lt 60 ]; do text="${text}Sentence number. "; i=$((i+1)); done
blocks=""; pages=""; p=$from
while [ $p -le $to ]; do
  [ -n "$blocks" ] && blocks="$blocks," && pages="$pages,"
  blocks="$blocks{\"id\":\"p$p-b1\",\"page\":$p,\"label\":\"text\",\"bounds\":{\"x\":0.1,\"y\":0.1,\"width\":0.5,\"height\":0.3},\"text\":\"$text\"}"
  pages="$pages$p"
  echo "{\"event\":\"page\",\"page\":$p,\"total\":80}"
  p=$((p+1))
done
printf '{"pages":80,"model":"fake","parsedPages":[%s],"blocks":[%s],"warnings":[],"incompletePages":[]}' "$pages" "$blocks" > "$out/manifest.json"
`
	if err := os.WriteFile(script, []byte(body), 0700); err != nil {
		t.Fatal(err)
	}
	t.Setenv("READER_NODE", "/bin/sh")
	t.Setenv("READER_PROCESSOR", script)
	t.Setenv("FAKE_LAYOUT_LOG", log)
	return log
}

func TestBookChapterParsesOnlyItsPagesThenTranslates(t *testing.T) {
	s := testServer(t)
	s.Token = "test-secret"
	log := fakeLayout(t)
	w := uploadTo(t, s, "books", "book.pdf", testPDF(80))
	var d Document
	if w.Code != 201 || json.Unmarshal(w.Body.Bytes(), &d) != nil {
		t.Fatal(w.Body.String())
	}
	chapter := func() translationRange {
		t.Helper()
		w := request(t, s, "POST", "/api/documents/"+d.ID+"/translations/range", strings.NewReader(`{"fromPage":1,"toPage":80}`))
		var result translationRange
		if w.Code != 202 || json.Unmarshal(w.Body.Bytes(), &result) != nil {
			t.Fatalf("chapter request: %d %s", w.Code, w.Body.String())
		}
		return result
	}
	learn := func() {
		t.Helper()
		p, _ := s.Store.processing(d.ID)
		if p.Phase != "learning" || p.Status != "queued" || p.Chapter == nil {
			t.Fatalf("chapter not queued for parsing: %+v", p)
		}
		if err := s.learnPDF(context.Background(), &p); err != nil {
			t.Fatal(err)
		}
	}
	if result := chapter(); !result.Parsing {
		t.Fatalf("unparsed chapter queued translation directly: %+v", result)
	}
	learn()
	m, err := s.readLayout(d.ID)
	if err != nil || len(m.ParsedPages) != bookLayoutPages || len(m.Blocks) != bookLayoutPages {
		t.Fatalf("first window: %+v %v", m.ParsedPages, err)
	}
	p, _ := s.Store.processing(d.ID)
	if p.Chapter != nil || p.Phase != "translating" || p.Status != "queued" || p.TranslationsTotal != bookLayoutPages {
		t.Fatalf("parsed chapter was not queued for translation: %+v", p)
	}
	items, _ := s.translations(d.ID, m)
	for _, item := range items {
		item.Status, item.Sentences = "complete", []TranslationSentence{{Source: "x", Target: "译"}}
		if err := s.saveTranslation(d.ID, item); err != nil {
			t.Fatal(err)
		}
	}
	if result := chapter(); !result.Parsing {
		t.Fatalf("continuing the chapter did not parse the next pages: %+v", result)
	}
	learn()
	m, _ = s.readLayout(d.ID)
	if len(m.ParsedPages) != 2*bookLayoutPages || len(m.Blocks) != 2*bookLayoutPages || m.Blocks[bookLayoutPages].ID != "p31-b1" {
		t.Fatalf("second window not merged: %v", m.ParsedPages)
	}
	raw, _ := os.ReadFile(filepath.Join(s.analysisDir(d.ID), "manifest.json"))
	if !strings.Contains(string(raw), `"model": "fake"`) {
		t.Fatal("merging dropped manifest fields")
	}
	calls, _ := os.ReadFile(log)
	if string(calls) != "1-30\n31-60\n" {
		t.Fatalf("layout ran for %q", calls)
	}
	statuses := translationStatuses(t, s, d.ID, m)
	if statuses["p30-b1"] != "complete" || statuses["p31-b1"] != "pending" || statuses["p60-b1"] != "pending" {
		t.Fatalf("second window statuses: %v", statuses)
	}
}

func TestChapterWindowStartsAtUnfinishedPages(t *testing.T) {
	m := layoutManifest{Pages: 100, ParsedPages: []int{1, 2, 3}}
	for page := 1; page <= 3; page++ {
		m.Blocks = append(m.Blocks, PDFBlock{ID: fmt.Sprintf("p%d-b1", page), Page: page})
	}
	items := []TranslationBlock{{BlockID: "p1-b1", Status: "complete"}, {BlockID: "p2-b1", Status: "idle"}, {BlockID: "p3-b1", Status: "complete"}}
	if start, end, ok := chapterWindow(&m, items, 1, 100); !ok || start != 2 || end != 31 {
		t.Fatalf("window %d-%d %v", start, end, ok)
	}
	items[1].Status = "complete"
	if start, end, ok := chapterWindow(&m, items, 1, 100); !ok || start != 4 || end != 33 {
		t.Fatalf("window %d-%d %v", start, end, ok)
	}
	if _, _, ok := chapterWindow(&m, items, 1, 3); ok {
		t.Fatal("finished chapter still has work")
	}
	if start, end, ok := chapterWindow(nil, nil, 5, 9); !ok || start != 5 || end != 9 {
		t.Fatalf("unparsed book window %d-%d %v", start, end, ok)
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
	for id, status := range translationStatuses(t, s, "doc", m) {
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
	statuses := translationStatuses(t, s, "doc", m)
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
