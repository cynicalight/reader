package reader

import (
	"net/http"
	"unicode/utf8"
)

// Books translate a chapter at a time. One request queues at most this much
// untranslated source text, in reading order, so a long chapter needs another
// request instead of an unbounded provider run.
const bookTranslationCharacters = 40000

// A formula is one image request; charge it like a short paragraph.
const formulaTranslationCharacters = 500

type translationRange struct {
	Queued     int `json:"queued"`
	Characters int `json:"characters"`
	// NextPage is where a capped request stopped; 0 when the range is fully requested.
	NextPage int `json:"nextPage"`
}

func translationCost(b PDFBlock) int {
	if source := translationSource(b); source != "" {
		return utf8.RuneCountInString(source)
	}
	return formulaTranslationCharacters
}

// Requesting a range is explicit consent, so it also resumes paused processing.
func (s *Server) requestTranslationRange(w http.ResponseWriter, r *http.Request) {
	d, err := s.Store.Document(r.PathValue("id"))
	if err != nil || d.Type != "pdf" {
		fail(w, 404, "PDF 不存在")
		return
	}
	var req struct {
		FromPage int `json:"fromPage"`
		ToPage   int `json:"toPage"`
	}
	if !decode(w, r, &req) {
		return
	}
	m, err := s.readLayout(d.ID)
	if err != nil {
		fail(w, 409, "正文仍在解析中")
		return
	}
	if req.FromPage < 1 || req.ToPage < req.FromPage || req.ToPage > m.Pages {
		fail(w, 400, "页码范围无效")
		return
	}
	s.processingControlMu.Lock()
	defer s.processingControlMu.Unlock()
	s.processingMu.Lock()
	defer s.processingMu.Unlock()
	items, err := s.translations(d.ID, m)
	if err != nil {
		fail(w, 500, "无法读取译文")
		return
	}
	byID := map[string]TranslationBlock{}
	for _, t := range items {
		byID[t.BlockID] = t
	}
	result := translationRange{}
	for _, b := range m.Blocks {
		t, ok := byID[b.ID]
		if !ok || b.Page < req.FromPage || b.Page > req.ToPage || (t.Status != "idle" && t.Status != "failed") {
			continue
		}
		cost := translationCost(b)
		if result.Queued > 0 && result.Characters+cost > bookTranslationCharacters {
			result.NextPage = b.Page
			break
		}
		t.Status, t.Error, t.FormulaMarkdown = "pending", "", ""
		if err = s.saveTranslation(d.ID, t); err != nil {
			fail(w, 500, "无法保存翻译任务")
			return
		}
		result.Queued++
		result.Characters += cost
	}
	if result.Queued > 0 {
		p, err := s.Store.processing(d.ID)
		if err != nil {
			fail(w, 500, "无法读取处理状态")
			return
		}
		p.enable, p.queueTranslation = true, true
		if err = s.Store.saveProcessing(p); err != nil {
			fail(w, 500, "无法安排翻译任务")
			return
		}
	}
	respond(w, 202, result)
}
