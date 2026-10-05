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
)

func translationFixture(t *testing.T) (*Server, Processing, layoutManifest) {
	t.Helper()
	s, p := processingFixture(t)
	s.Token = "test-secret"
	m, _ := s.readLayout("doc")
	b := m.Blocks[0]
	b.Image = ""
	b.Label = "text"
	b.Text = "First sentence. Second sentence."
	b2 := b
	b2.ID = "p1-b2"
	b2.Text = "Another paragraph."
	m.Blocks = []PDFBlock{b, b2}
	data, _ := json.Marshal(m)
	if err := os.WriteFile(filepath.Join(s.analysisDir("doc"), "manifest.json"), data, 0600); err != nil {
		t.Fatal(err)
	}
	if err := s.learnPDF(context.Background(), &p); err != nil {
		t.Fatal(err)
	}
	return s, p, m
}
func TestTranslationRejectsMissingReorderedOrEmptySentences(t *testing.T) {
	cases := []string{
		`{"sentences":[{"source":"First sentence.","target":"第一句。"}]}`,
		`{"sentences":[{"source":"Second sentence.","target":"第二句。"},{"source":"First sentence.","target":"第一句。"}]}`,
		`{"sentences":[{"source":"First sentence. Second sentence.","target":""}]}`,
		`{"sentences":[`,
	}
	for _, raw := range cases {
		if _, err := parseTranslation(raw, "First sentence. Second sentence."); err == nil {
			t.Fatalf("accepted invalid alignment: %s", raw)
		}
	}
	sentences, err := parseTranslation(`{"sentences":[{"source":"First sentence.","target":"第一句。"},{"source":"Second sentence.","target":"第二句。"}]}`, "First sentence. Second sentence.")
	if err != nil || len(sentences) != 2 {
		t.Fatalf("valid sentences rejected: %v", err)
	}
}
func TestTranslationPartialFailureAndRetryPreservesCompletedBlocks(t *testing.T) {
	s, p, m := translationFixture(t)
	if p.Phase != "settling" {
		t.Fatal("text-only paper skipped translation")
	}
	var calls atomic.Int32
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		n := calls.Add(1)
		text := translationLine(m.Blocks[1])
		if n == 1 {
			text = translationLine(m.Blocks[0]) + strings.Replace(translationLine(m.Blocks[1]), "Another paragraph.", "Wrong paragraph.", 1)
		}

		writeAPIReply(w, text)
	}))
	defer provider.Close()
	c := AIConfig{Primary: "codex", Models: map[string]string{}, TextAPI: APIConnection{URL: provider.URL, Model: "test"}, Capabilities: map[string]Capability{}}
	c.Capabilities["text-api"] = Capability{Text: true, Fingerprint: configPrint(c, "text-api")}
	if err := s.writeAIConfig(c); err != nil {
		t.Fatal(err)
	}
	if err := s.settlePDF(context.Background(), &p); err == nil {
		t.Fatal("invalid translation reported success")
	}
	response := request(t, s, "GET", "/api/documents/doc/translations", nil)
	var items []TranslationBlock
	if json.Unmarshal(response.Body.Bytes(), &items) != nil || len(items) != 2 || items[0].Status != "complete" || items[1].Status != "failed" {
		t.Fatalf("partial progress lost: %s", response.Body.String())
	}
	p.Status = "failed"
	if err := s.Store.saveProcessing(p); err != nil {
		t.Fatal(err)
	}
	response = request(t, s, "POST", "/api/documents/doc/translations", strings.NewReader(`{"blockId":"p1-b2"}`))
	if response.Code != 202 {
		t.Fatal(response.Body.String())
	}
	p, _ = s.Store.processing("doc")
	if err := s.settlePDF(context.Background(), &p); err != nil {
		t.Fatal(err)
	}
	if calls.Load() != 2 || p.Status != "complete" {
		t.Fatalf("completed paragraph regenerated or job not complete: calls=%d %+v", calls.Load(), p)
	}
	// A changed source must never silently reuse the old translated text.
	m.Blocks[0].Text = "Changed source."
	items, err := s.translations("doc", m)
	if err != nil || items[0].Status != "pending" || len(items[0].Sentences) != 0 || items[1].Status != "complete" {
		t.Fatalf("stale source reused: %+v %v", items, err)
	}
}
func TestTranslationResumesInterruptedWithoutPrioritizingRequestedParagraph(t *testing.T) {
	s, p, m := translationFixture(t)
	first := newTranslation(m.Blocks[0])
	first.Status = "running"
	_ = s.saveTranslation("doc", first)
	response := request(t, s, "POST", "/api/documents/doc/translations", strings.NewReader(`{"blockId":"p1-b2"}`))
	if response.Code != 202 {
		t.Fatal(response.Body.String())
	}
	var order []string
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		batch := readTranslationInput(t, r).Batch
		var out strings.Builder
		for _, paragraph := range batch.Paragraphs {
			order = append(order, paragraph.BlockID)
			out.WriteString(translationParagraphLine(paragraph))
		}
		writeAPIReply(w, out.String())
	}))
	defer provider.Close()
	configureTranslationTest(t, s, provider.URL)
	if err := s.settlePDF(context.Background(), &p); err != nil {
		t.Fatal(err)
	}
	if len(order) != 2 || order[0] != m.Blocks[0].ID {
		t.Fatalf("unexpected order: %v", order)
	}
}
