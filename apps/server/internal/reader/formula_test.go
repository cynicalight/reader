package reader

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestFormulaMarkdownSeparatesInterpretation(t *testing.T) {
	source := "表达式：\n$$\nS(i,j)=\\frac{1}{2}\\log p_R(j|i)\n$$\n中文解释：符号含义。"
	math, err := formulaMarkdown(source)
	if err != nil || strings.Contains(math, "中文") || !strings.HasPrefix(math, "$$\n") {
		t.Fatalf("%q %v", math, err)
	}
	for _, invalid := range []string{"只有解释", "$$ $$", "```latex\n$$\nx\n$$\n```"} {
		if _, err := formulaMarkdown(invalid); err == nil {
			t.Fatalf("accepted %q", invalid)
		}
	}
}
func TestImageAssetsTranslateOnlyCaption(t *testing.T) {
	for _, label := range []string{"table", "image", "chart"} {
		b := PDFBlock{Label: label, Image: "assets/p1-b1.png", Text: "INTERNAL CELLS 66.7 58.6", Caption: "Table 5. Results."}
		if source := translationSource(b); source != b.Caption {
			t.Fatalf("%s: %q", label, source)
		}
		b.Caption = ""
		if source := translationSource(b); source != "" {
			t.Fatalf("body leaked: %q", source)
		}
	}
}
func TestConsolidationPersistsFormulaBeforeCaptionTranslation(t *testing.T) {
	s, p := processingFixture(t)
	s.Token = "test-secret"
	m, _ := s.readLayout("doc")
	formula := m.Blocks[0]
	formula.Label = "display_formula"
	formula.Text = "FORMULA OCR"
	table := formula
	table.ID = "p1-b2"
	table.Label = "table"
	table.Image = "assets/p1-b2.png"
	table.Text = "INTERNAL CELLS 66.7 58.6"
	table.Caption = "Table 5. Results."
	m.Blocks = []PDFBlock{formula, table}
	data, _ := json.Marshal(m)
	if err := os.WriteFile(filepath.Join(s.analysisDir("doc"), "manifest.json"), data, 0600); err != nil {
		t.Fatal(err)
	}
	for _, b := range m.Blocks {
		if err := os.WriteFile(filepath.Join(s.analysisDir("doc"), b.Image), []byte("fixture"), 0600); err != nil {
			t.Fatal(err)
		}
	}
	calls := 0
	images := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		var body struct {
			Messages []struct {
				Content json.RawMessage `json:"content"`
			} `json:"messages"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		response := "表格解析，仅供 AI。"
		if strings.Contains(string(body.Messages[len(body.Messages)-1].Content), "FORMULA OCR") {
			if !strings.Contains(string(body.Messages[len(body.Messages)-1].Content), "KaTeX") {
				t.Error("missing formula instruction")
			}
			response = "$$\nS(i,j)=\\frac{1}{2}\\log p_R(j|i)\n$$\n解释：概率。"
		}
		w.Header().Set("Content-Type", "text/event-stream")
		sendTranslationDelta(w, response)
		finishTranslationStream(w)
	}))
	defer images.Close()
	text := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		math := s.savedFormula("doc", formula)
		if math == "" || strings.Contains(math, "解释") {
			t.Error("translation began without formula-only Markdown")
		}
		input := readTranslationInput(t, r)
		if len(input.Batch.Paragraphs) != 1 || input.Batch.Paragraphs[0].Source != table.Caption {
			t.Errorf("body sent to translation: %+v", input.Batch)
		}
		for _, para := range append(append(input.Batch.Before, input.Batch.Paragraphs...), input.Batch.After...) {
			if strings.Contains(para.Source, "INTERNAL") || strings.Contains(para.Source, "FORMULA OCR") {
				t.Error("asset body in translation context")
			}
		}
		w.Header().Set("Content-Type", "text/event-stream")
		for _, para := range input.Batch.Paragraphs {
			sendTranslationDelta(w, translationParagraphLine(para))
		}
		finishTranslationStream(w)
	}))
	defer text.Close()
	configureTranslationTest(t, s, text.URL)
	config := s.aiConfig()
	config.ImageAPI = APIConnection{URL: images.URL, Model: "test"}
	config.Capabilities["image-api"] = Capability{Text: true, Vision: true, Fingerprint: configPrint(config, "image-api")}
	if err := s.writeAIConfig(config); err != nil {
		t.Fatal(err)
	}
	if err := s.learnPDF(context.Background(), &p); err != nil {
		t.Fatal(err)
	}
	if err := s.settlePDF(context.Background(), &p); err != nil {
		t.Fatal(err)
	}
	if p.Status != "complete" || p.AssetsDone != 2 || calls != 2 {
		t.Fatalf("%+v calls=%d", p, calls)
	}
	w := request(t, s, "GET", "/api/documents/doc/blocks", nil)
	var blocks []PDFBlock
	if err := json.Unmarshal(w.Body.Bytes(), &blocks); err != nil {
		t.Fatal(err)
	}
	if len(blocks) != 2 || blocks[0].FormulaMarkdown == "" || blocks[1].FormulaMarkdown != "" {
		t.Fatalf("wrong formula API: %s", w.Body.String())
	}
	// Resume uses the two completed artifacts without another provider call.
	if err := s.settlePDF(context.Background(), &p); err != nil {
		t.Fatal(err)
	}
	if calls != 2 {
		t.Fatal("repeated completed consolidation")
	}
}

func TestInvalidFormulaStopsBeforeTranslation(t *testing.T) {
	s, p := processingFixture(t)
	m, _ := s.readLayout("doc")
	m.Blocks[0].Label = "display_formula"
	data, _ := json.Marshal(m)
	if err := os.WriteFile(filepath.Join(s.analysisDir("doc"), "manifest.json"), data, 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(s.analysisDir("doc"), m.Blocks[0].Image), []byte("fixture"), 0600); err != nil {
		t.Fatal(err)
	}
	images := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		sendTranslationDelta(w, "只有解释，没有公式数学块。")
		finishTranslationStream(w)
	}))
	defer images.Close()
	textCalls := 0
	text := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { textCalls++; t.Error("translated after invalid formula") }))
	defer text.Close()
	configureTranslationTest(t, s, text.URL)
	config := s.aiConfig()
	config.ImageAPI = APIConnection{URL: images.URL, Model: "test"}
	config.Capabilities["image-api"] = Capability{Text: true, Vision: true, Fingerprint: configPrint(config, "image-api")}
	if err := s.writeAIConfig(config); err != nil {
		t.Fatal(err)
	}
	if err := s.learnPDF(context.Background(), &p); err != nil {
		t.Fatal(err)
	}
	if err := s.settlePDF(context.Background(), &p); err == nil {
		t.Fatal("accepted formula without math")
	}
	if textCalls != 0 || p.AssetsDone != 0 || p.Phase != "settling" {
		t.Fatalf("%+v textCalls=%d", p, textCalls)
	}
	if s.savedFormula("doc", m.Blocks[0]) != "" {
		t.Fatal("persisted invalid formula")
	}
}
func TestFormulaDerivedReadIsBoundedToAnalysis(t *testing.T) {
	s, _ := processingFixture(t)
	outside := filepath.Join(t.TempDir(), "outside.md")
	if err := os.WriteFile(outside, []byte("$$\nx\n$$"), 0600); err != nil {
		t.Fatal(err)
	}
	dir := filepath.Join(s.analysisDir("doc"), "formulas")
	if err := os.MkdirAll(dir, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, filepath.Join(dir, "p1-b1.md")); err != nil {
		t.Fatal(err)
	}
	if s.savedFormula("doc", PDFBlock{ID: "p1-b1", Label: "display_formula", Image: "assets/p1-b1.png"}) != "" {
		t.Fatal("formula symlink escaped analysis")
	}
}

func TestAssetBodyExcludedFromTranslationFrontMatter(t *testing.T) {
	m := layoutManifest{Blocks: []PDFBlock{{ID: "p1-b1", Page: 1, Label: "table", Text: "PRIVATE TABLE CELLS", Caption: "Table caption."}, {ID: "p1-b2", Page: 1, Label: "display_formula", Text: "FORMULA OCR"}}}
	prompt := translationPrompt(Document{Title: "Test"}, m, translationBatch{})
	if strings.Contains(prompt, "PRIVATE TABLE CELLS") || strings.Contains(prompt, "FORMULA OCR") {
		t.Fatal("asset body leaked through metadata context")
	}
}
