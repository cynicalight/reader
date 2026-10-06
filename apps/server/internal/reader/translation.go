package reader

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
)

type TranslationSentence struct {
	Source string `json:"source"`
	Target string `json:"target"`
}
type TranslationBlock struct {
	BlockID         string                `json:"blockId"`
	SourceHash      string                `json:"sourceHash"`
	Status          string                `json:"status"`
	Sentences       []TranslationSentence `json:"sentences"`
	FormulaMarkdown string                `json:"formulaMarkdown,omitempty"`
	Error           string                `json:"error,omitempty"`
}

func translationSource(b PDFBlock) string {
	if isPDFPageDecoration(b) {
		return ""
	}
	switch b.Label {
	case "reference", "reference_content", "algorithm", "display_formula", "inline_formula", "formula_number", "header", "footer", "number":
		return ""
	}
	if isImageAsset(b) {
		return strings.TrimSpace(b.Caption)
	}
	return strings.TrimSpace(b.Text)
}
func translationHash(source string) string {
	sum := sha256.Sum256([]byte("zh-CN:v1:" + source))
	return hex.EncodeToString(sum[:])
}
func needsTranslation(b PDFBlock) bool {
	return translationSource(b) != "" || (isFormula(b) && b.Image != "")
}
func newTranslation(b PDFBlock) TranslationBlock {
	source := translationSource(b)
	if isFormula(b) {
		source = "formula-image:v1:" + b.Image + ":" + b.Text
	}
	return TranslationBlock{BlockID: b.ID, SourceHash: translationHash(source), Status: "pending", Sentences: []TranslationSentence{}}
}
func (s *Server) translations(documentID string, m layoutManifest) ([]TranslationBlock, error) {
	rows, err := s.Store.DB.Query("SELECT body FROM translations WHERE document_id=?", documentID)
	if err != nil {
		return nil, err
	}
	saved := map[string]TranslationBlock{}
	for rows.Next() {
		var body string
		var t TranslationBlock
		if err = rows.Scan(&body); err != nil {
			rows.Close()
			return nil, err
		}
		if err = json.Unmarshal([]byte(body), &t); err != nil {
			rows.Close()
			return nil, errors.New("译文记录损坏")
		}
		saved[t.BlockID+":"+t.SourceHash] = t
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return nil, err
	}
	result := []TranslationBlock{}
	for _, b := range m.Blocks {
		if !needsTranslation(b) {
			continue
		}
		t := newTranslation(b)
		if value, ok := saved[t.BlockID+":"+t.SourceHash]; ok {
			t = value
		}
		result = append(result, t)
	}
	return result, nil
}

func (s *Server) retryFailedTranslations(documentID string) error {
	m, err := s.readLayout(documentID)
	if err != nil {
		return nil
	}
	items, err := s.translations(documentID, m)
	if err != nil {
		return err
	}
	for _, t := range items {
		if t.Status == "failed" {
			t.Status = "pending"
			t.Error = ""
			if err = s.saveTranslation(documentID, t); err != nil {
				return err
			}
		}
	}
	return nil
}

// Upgrade previously settled documents without changing their layout or notes.
func (s *Server) queueUntranslatedPDFs() {
	docs, err := s.Store.Documents()
	if err != nil {
		return
	}
	for _, doc := range docs {
		if doc.Type != "pdf" {
			continue
		}
		p, err := s.Store.processing(doc.ID)
		if err != nil || p.Status != "complete" {
			continue
		}
		m, err := s.readLayout(doc.ID)
		if err != nil {
			continue
		}
		items, err := s.translations(doc.ID, m)
		if err != nil {
			continue
		}
		for _, t := range items {
			if t.Status != "complete" {
				p.Phase = "translating"
				p.Status = "queued"
				p.Detail = "等待翻译正文"
				_ = s.Store.saveProcessing(p)
				break
			}
		}
	}
}
func (s *Server) saveTranslation(documentID string, t TranslationBlock) error {
	s.translationMu.Lock()
	defer s.translationMu.Unlock()
	body, err := json.Marshal(t)
	if err != nil {
		return err
	}
	_, err = s.Store.DB.Exec(`INSERT INTO translations(document_id,block_id,source_hash,status,body) VALUES(?,?,?,?,?) ON CONFLICT(document_id,block_id,source_hash) DO UPDATE SET status=excluded.status,body=excluded.body`, documentID, t.BlockID, t.SourceHash, t.Status, string(body))
	if err == nil {
		s.publishTranslation(documentID, t)
	}
	return err
}
func (s *Server) documentTranslations(w http.ResponseWriter, r *http.Request) {
	d, err := s.Store.Document(r.PathValue("id"))
	if err != nil || d.Type != "pdf" {
		fail(w, 404, "PDF 不存在")
		return
	}
	m, err := s.readLayout(d.ID)
	if err != nil {
		respond(w, 200, []TranslationBlock{})
		return
	}
	items, err := s.translations(d.ID, m)
	if err != nil {
		fail(w, 500, "无法读取译文")
		return
	}
	respond(w, 200, items)
}

// Requests only enqueue work. The settling worker owns provider calls and persists
// completed responses independently, so closing a reader never loses progress.
func (s *Server) requestTranslation(w http.ResponseWriter, r *http.Request) {
	d, err := s.Store.Document(r.PathValue("id"))
	if err != nil || d.Type != "pdf" {
		fail(w, 404, "PDF 不存在")
		return
	}
	var req struct {
		BlockID string `json:"blockId"`
	}
	if !decode(w, r, &req) {
		return
	}
	m, err := s.readLayout(d.ID)
	if err != nil {
		fail(w, 409, "正文仍在解析中")
		return
	}
	s.processingMu.Lock()
	defer s.processingMu.Unlock()
	items, err := s.translations(d.ID, m)
	if err != nil {
		fail(w, 500, "无法读取译文")
		return
	}
	found := req.BlockID == ""
	for _, t := range items {
		if req.BlockID != "" && t.BlockID != req.BlockID {
			continue
		}
		found = true
		if t.Status == "complete" || t.Status == "running" {
			continue
		}
		t.Status = "pending"
		t.Error = ""
		if err = s.saveTranslation(d.ID, t); err != nil {
			fail(w, 500, "无法保存翻译任务")
			return
		}
	}
	if !found {
		fail(w, 404, "没有可翻译的段落")
		return
	}
	p, err := s.Store.processing(d.ID)
	if err != nil {
		fail(w, 500, "无法读取处理状态")
		return
	}
	if p.Status != "running" {
		if p.Phase == "ready" {
			p.Phase = "translating"
		}
		p.Status = "queued"
		p.Detail = "等待继续处理"
		if err = s.Store.saveProcessing(p); err != nil {
			fail(w, 500, "无法安排翻译任务")
			return
		}
	}
	respond(w, 202, map[string]bool{"queued": true})
}

func parseTranslation(raw, source string) ([]TranslationSentence, error) {
	raw = strings.TrimSpace(raw)
	if strings.HasPrefix(raw, "```") {
		if i := strings.IndexByte(raw, '\n'); i >= 0 {
			raw = strings.TrimSpace(raw[i+1:])
			raw = strings.TrimSpace(strings.TrimSuffix(raw, "```"))
		}
	}
	var out struct {
		Sentences []TranslationSentence `json:"sentences"`
	}
	if json.Unmarshal([]byte(raw), &out) != nil || len(out.Sentences) == 0 {
		return nil, errors.New("译文格式不完整，请重试此段")
	}
	var joined strings.Builder
	for _, sentence := range out.Sentences {
		if strings.TrimSpace(sentence.Source) == "" || strings.TrimSpace(sentence.Target) == "" {
			return nil, errors.New("译文存在空句，请重试此段")
		}
		joined.WriteString(sentence.Source)
		joined.WriteByte(' ')
	}
	normalize := func(v string) string { return strings.Join(strings.Fields(v), "") }
	if normalize(joined.String()) != normalize(source) {
		return nil, errors.New("原文句子未完整对应，请重试此段")
	}
	return out.Sentences, nil
}
