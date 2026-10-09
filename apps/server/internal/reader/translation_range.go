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
	// NextPage is where a limit stopped the request; 0 when the range is fully requested.
	NextPage int `json:"nextPage"`
	// Parsing reports that the chapter's pages are being parsed first; its
	// translation is queued when parsing finishes.
	Parsing bool `json:"parsing"`
}

func translationCost(b PDFBlock) int {
	if source := translationSource(b); source != "" {
		return utf8.RuneCountInString(source)
	}
	return formulaTranslationCharacters
}

// queueTranslationRange marks the next untranslated paragraphs of [from, to]
// pending, within the page and character limits, and queues translation.
// Callers hold processingMu.
func (s *Server) queueTranslationRange(d Document, m layoutManifest, from, to int) (translationRange, error) {
	result := translationRange{}
	items, err := s.translations(d.ID, m)
	if err != nil {
		return result, err
	}
	start, end, ok := chapterWindow(&m, items, from, to)
	if !ok {
		return result, nil
	}
	byID := map[string]TranslationBlock{}
	for _, t := range items {
		byID[t.BlockID] = t
	}
	for _, b := range m.Blocks {
		t, ok := byID[b.ID]
		if !ok || b.Page < start || b.Page > end || (t.Status != "idle" && t.Status != "failed") {
			continue
		}
		cost := translationCost(b)
		if result.Queued > 0 && result.Characters+cost > bookTranslationCharacters {
			result.NextPage = b.Page
			break
		}
		t.Status, t.Error, t.FormulaMarkdown = "pending", "", ""
		if err = s.saveTranslation(d.ID, t); err != nil {
			return result, err
		}
		result.Queued++
		result.Characters += cost
	}
	if result.NextPage == 0 && end < min(to, m.Pages) {
		result.NextPage = end + 1
	}
	if result.Queued > 0 {
		p, err := s.Store.processing(d.ID)
		if err != nil {
			return result, err
		}
		p.enable, p.queueTranslation = true, true
		err = s.Store.saveProcessing(p)
		return result, err
	}
	return result, nil
}

// Requesting a range is explicit consent, so it also resumes paused processing.
// Book pages that were never parsed go through the layout lane first.
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
	var known *layoutManifest
	m, err := s.readLayout(d.ID)
	pages := m.Pages
	if err == nil {
		known = &m
	} else if d.Library != "books" {
		fail(w, 409, "正文仍在解析中")
		return
	} else if pages, err = pdfPageCount(s.Store.File(d)); err != nil {
		// Some PDFs defeat the page-tree reader; the layout worker clamps the range.
		pages = req.ToPage
	}
	if req.FromPage < 1 || req.ToPage < req.FromPage || req.ToPage > pages {
		fail(w, 400, "页码范围无效")
		return
	}
	s.processingControlMu.Lock()
	defer s.processingControlMu.Unlock()
	s.processingMu.Lock()
	defer s.processingMu.Unlock()
	var items []TranslationBlock
	if known != nil {
		if items, err = s.translations(d.ID, m); err != nil {
			fail(w, 500, "无法读取译文")
			return
		}
	}
	start, end, ok := chapterWindow(known, items, req.FromPage, req.ToPage)
	if !ok {
		respond(w, 202, translationRange{})
		return
	}
	if d.Library == "books" && len(unparsedPages(known, start, end)) > 0 {
		if s.activeProcessing[d.ID] != nil {
			fail(w, 409, "正在处理其他章节，请稍后再试")
			return
		}
		p, err := s.Store.processing(d.ID)
		if err != nil {
			p = initialProcessing(d.ID)
		}
		p.Enabled, p.Chapter = true, &PageRange{req.FromPage, req.ToPage}
		p.Phase, p.Status, p.Detail = "learning", "queued", "等待解析本章"
		p.Translating, p.CompletedAt = nil, ""
		if err = s.Store.saveProcessing(p); err != nil {
			fail(w, 500, "无法安排解析任务")
			return
		}
		respond(w, 202, translationRange{Parsing: true})
		return
	}
	result, err := s.queueTranslationRange(d, m, req.FromPage, req.ToPage)
	if err != nil {
		fail(w, 500, "无法安排翻译任务")
		return
	}
	respond(w, 202, result)
}
