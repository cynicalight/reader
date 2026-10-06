package reader

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
)

// Controls serialize with worker claims. Cancellation joins processing only,
// leaving independent chat requests and already published results intact.
func (s *Server) getAssistance(w http.ResponseWriter, r *http.Request) {
	d, e := s.Store.Document(r.PathValue("id"))
	if e != nil || d.Type != "pdf" {
		fail(w, 404, "PDF 不存在")
		return
	}
	p, e := s.Store.processing(d.ID)
	if e != nil {
		p = initialProcessing(d.ID)
	}
	respond(w, 200, p)
}
func (s *Server) setAssistance(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Action string `json:"action"`
		Page   int    `json:"page"`
	}
	if !decode(w, r, &req) {
		return
	}
	if req.Action != "reading" && req.Action != "full" && req.Action != "pause" && req.Action != "follow" && req.Action != "resume" {
		fail(w, 400, "无效的辅助阅读操作")
		return
	}
	if req.Action != "pause" && (req.Page < 1 || req.Page > 1000) {
		fail(w, 400, "无效的 PDF 页码")
		return
	}
	s.processingControlMu.Lock()
	defer s.processingControlMu.Unlock()
	d, e := s.Store.Document(r.PathValue("id"))
	if e != nil || d.Type != "pdf" {
		fail(w, 404, "PDF 不存在")
		return
	}
	s.processingMu.Lock()
	p, e := s.Store.processing(d.ID)
	if e != nil {
		p = initialProcessing(d.ID)
	}
	if req.Action == "follow" && (!p.Enabled || p.Mode != "reading" || p.PageStart == req.Page) {
		s.processingMu.Unlock()
		respond(w, 200, p)
		return
	}
	m, layoutErr := s.readLayout(d.ID)
	if layoutErr == nil && req.Action != "pause" && req.Page > m.Pages {
		s.processingMu.Unlock()
		fail(w, 400, "页码超出文档范围")
		return
	}
	if s.blockedProcessing == nil {
		s.blockedProcessing = map[string]bool{}
	}
	s.blockedProcessing[d.ID] = true
	// Disable before joining, so neither serial queue can claim a new stage.
	p.Enabled = false
	p.Status = "paused"
	if e = s.Store.saveProcessing(p); e != nil {
		delete(s.blockedProcessing, d.ID)
		s.processingMu.Unlock()
		fail(w, 500, "无法暂停处理")
		return
	}
	task := s.activeProcessing[d.ID]
	if task != nil {
		task.cancel()
	}
	s.processingMu.Unlock()
	if task != nil {
		<-task.done
	}
	s.processingMu.Lock()
	defer s.processingMu.Unlock()
	defer delete(s.blockedProcessing, d.ID)
	// Worker may have published final progress while cancellation was joining.
	if latest, err := s.Store.processing(d.ID); err == nil {
		p = latest
	} else {
		fail(w, 404, "PDF 不存在")
		return
	}
	p.Enabled = req.Action != "pause"
	p.CompletedAt = ""
	if p.Enabled {
		if req.Action == "resume" && p.Mode == "full" {
			// Continue the paused batch without revisiting earlier pages.
		} else if req.Action == "full" {
			p.Mode = "full"
			p.PageStart = 1
		} else {
			p.Mode = "reading"
			p.PageStart = req.Page
		}
		p.PageEnd = min(1000, p.PageStart+2)
		if layoutErr == nil {
			p.PageEnd = min(m.Pages, p.PageEnd)
		}
		p.Phase = "learning"
		p.Status = "queued"
		p.PagesDone = 0
		p.PagesTotal = p.PageEnd - p.PageStart + 1
		p.Detail = fmt.Sprintf("等待准备第 %d–%d 页", p.PageStart, p.PageEnd)
		if e = s.retryFailedTranslations(d.ID, &p); e != nil {
			fail(w, 500, "无法恢复译文")
			return
		}
	} else {
		p.Status = "paused"
		p.Detail = "辅助阅读已暂停"
	}
	if e = s.Store.saveProcessing(p); e != nil {
		fail(w, 500, "无法保存辅助阅读设置")
		return
	}
	p, _ = s.Store.processing(d.ID)
	respond(w, 200, p)
}
func (s *Server) finishProcessingTask(id string, t *documentTask) {
	if t == nil {
		return
	}
	t.cancel()
	s.processingMu.Lock()
	defer s.processingMu.Unlock()
	delete(s.activeProcessing, id)
	close(t.done)
}
func (s *Server) pauseLegacyProcessing() {
	rows, e := s.Store.DB.Query("SELECT body FROM document_processing WHERE COALESCE(json_extract(body,'$.mode'),'')=''")
	if e != nil {
		return
	}
	var pending []Processing
	for rows.Next() {
		var b string
		var p Processing
		if rows.Scan(&b) == nil && json.Unmarshal([]byte(b), &p) == nil {
			pending = append(pending, p)
		}
	}
	rows.Close()
	for _, p := range pending {
		p.Enabled = false
		if p.Status != "complete" {
			p.Status = "paused"
			p.Detail = "辅助阅读未开启"
		}
		_ = s.Store.saveProcessing(p)
	}
	// Run once: imported documents are idle; explicit classification still works.
	var migrated string
	if s.Store.DB.QueryRow("SELECT value FROM settings WHERE key='manual-processing-v1'").Scan(&migrated) != nil {
		_, _ = s.Store.DB.Exec("UPDATE documents SET classification_status='idle' WHERE classification_status IN ('pending','running')")
		_, _ = s.Store.DB.Exec("INSERT OR IGNORE INTO settings(key,value) VALUES('manual-processing-v1','true')")
	}
}
func pageArguments(pages []int) string {
	v := make([]string, len(pages))
	for i, p := range pages {
		v[i] = strconv.Itoa(p)
	}
	return strings.Join(v, ",")
}
func processedPages(m layoutManifest) map[int]bool {
	result := map[int]bool{}
	if m.ProcessedPages == nil {
		for i := 1; i <= m.Pages; i++ {
			result[i] = true
		}
	} else {
		for _, p := range m.ProcessedPages {
			result[p] = true
		}
	}
	return result
}
func missingPages(m layoutManifest, start, end int) []int {
	if start == 0 {
		return nil
	}
	known := processedPages(m)
	pages := []int{}
	if m.Pages > 0 {
		end = min(end, m.Pages)
	}
	for i := start; i <= end; i++ {
		if !known[i] {
			pages = append(pages, i)
		}
	}
	return pages
}
func processingLayout(m layoutManifest, p *Processing) layoutManifest {
	if p.PageStart == 0 {
		return m
	}
	blocks := []PDFBlock{}
	for _, b := range m.Blocks {
		if b.Page >= p.PageStart && b.Page <= p.PageEnd {
			blocks = append(blocks, b)
		}
	}
	m.Blocks = blocks
	incomplete := []int{}
	for _, page := range m.IncompletePages {
		if page >= p.PageStart && page <= p.PageEnd {
			incomplete = append(incomplete, page)
		}
	}
	m.IncompletePages = incomplete
	// Warnings are page-specific in the processor; avoid marking an unrelated range.
	warnings := []string{}
	for _, v := range m.Warnings {
		for page := p.PageStart; page <= p.PageEnd; page++ {
			if strings.HasPrefix(v, fmt.Sprintf("第 %d 页", page)) {
				warnings = append(warnings, v)
				break
			}
		}
	}
	m.Warnings = warnings
	return m
}
func (s *Server) advanceFullProcessing(p *Processing) error {
	if !p.Enabled || p.Mode != "full" {
		return nil
	}
	m, e := s.readLayout(p.DocumentID)
	if e != nil {
		return e
	}
	if p.PageEnd < m.Pages {
		p.PageStart = p.PageEnd + 1
		p.PageEnd = min(m.Pages, p.PageStart+2)
		p.Phase = "learning"
		p.Status = "queued"
		p.CompletedAt = ""
		p.PagesDone = 0
		p.PagesTotal = p.PageEnd - p.PageStart + 1
		p.Detail = fmt.Sprintf("等待准备第 %d–%d 页", p.PageStart, p.PageEnd)
		return s.Store.saveProcessing(*p)
	}
	return nil
}

// Publish new page assets before atomically publishing the merged manifest.
// Cached page IDs and transcripts are never replaced; a crash can leave only
// unreferenced assets, safely reusable by the next attempt.
func (s *Server) mergeLayout(id, work string, allowed []int) error {
	target := s.analysisDir(id)
	next, e := readLayoutDirectory(work)
	if e != nil {
		return e
	}
	if allowed != nil {
		requested := map[int]bool{}
		for _, page := range allowed {
			requested[page] = true
		}
		for _, page := range next.ProcessedPages {
			if !requested[page] {
				return errors.New("解析结果超出所选范围")
			}
		}
		if next.ProcessedPages == nil {
			return errors.New("解析器未返回处理范围")
		}
	}
	if _, e := os.Stat(target); os.IsNotExist(e) {
		return os.Rename(work, target)
	}
	old, e := s.readLayout(id)
	if e != nil {
		return errors.New("已有解析目录异常，已保留，未覆盖")
	}
	raw, e := os.ReadFile(filepath.Join(work, "manifest.json"))
	if e != nil {
		return e
	}
	if old.Pages != next.Pages {
		return errors.New("PDF 页数与缓存不一致")
	}
	var metadata map[string]json.RawMessage
	data, e := os.ReadFile(filepath.Join(target, "manifest.json"))
	if e != nil {
		return e
	}
	if e = json.Unmarshal(data, &metadata); e != nil {
		return e
	}
	var incoming map[string]json.RawMessage
	if e = json.Unmarshal(raw, &incoming); e != nil {
		return e
	}
	if a, b := metadata["inputSHA256"], incoming["inputSHA256"]; len(a) > 0 && len(b) > 0 && string(a) != string(b) {
		return errors.New("PDF 与已有解析缓存不一致")
	}
	known := processedPages(old)
	for _, b := range next.Blocks {
		if known[b.Page] {
			continue
		}
		if b.Image != "" {
			content, e := os.ReadFile(filepath.Join(work, b.Image))
			if e != nil {
				return e
			}
			dest := filepath.Join(target, b.Image)
			if _, e = os.Stat(dest); os.IsNotExist(e) {
				if e = writeTranscript(dest, content); e != nil {
					return e
				}
			}
		}
		old.Blocks = append(old.Blocks, b)
	}
	for _, page := range next.ProcessedPages {
		known[page] = true
	}
	old.ProcessedPages = []int{}
	for page := range known {
		old.ProcessedPages = append(old.ProcessedPages, page)
	}
	sort.Ints(old.ProcessedPages)
	sort.SliceStable(old.Blocks, func(i, j int) bool { return old.Blocks[i].Page < old.Blocks[j].Page })
	old.Warnings = append(old.Warnings, next.Warnings...)
	old.IncompletePages = append(old.IncompletePages, next.IncompletePages...)
	for key, value := range map[string]any{"blocks": old.Blocks, "processedPages": old.ProcessedPages, "warnings": old.Warnings, "incompletePages": old.IncompletePages} {
		metadata[key], e = json.Marshal(value)
		if e != nil {
			return e
		}
	}
	data, e = json.Marshal(metadata)
	if e != nil {
		return e
	}
	temp, e := os.CreateTemp(target, ".manifest-*")
	if e != nil {
		return e
	}
	defer os.Remove(temp.Name())
	if _, e = temp.Write(data); e != nil {
		temp.Close()
		return e
	}
	if e = temp.Sync(); e != nil {
		temp.Close()
		return e
	}
	if e = temp.Close(); e != nil {
		return e
	}
	return os.Rename(temp.Name(), filepath.Join(target, "manifest.json"))
}
