package reader

import (
	"encoding/json"
	"errors"
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
	}
	if !decode(w, r, &req) {
		return
	}
	if req.Action != "start" && req.Action != "pause" && req.Action != "resume" {
		fail(w, 400, "无效的辅助阅读操作")
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
		p.Status, p.Detail = "queued", "等待继续处理"
		// Always prepare the complete manifest, including caches from older partial jobs.
		// Completed translations and transcripts are reused by both processing lanes.
		p.Phase = "learning"
		p.PagesDone = 0
		p.Settling, p.Translating = nil, nil
		if e = s.retryFailedTranslations(d.ID); e != nil {
			fail(w, 500, "无法恢复译文")
			return
		}
	} else {
		p.Status, p.Detail = "paused", "翻译已暂停"
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
	rows, e := s.Store.DB.Query("SELECT body FROM document_processing WHERE json_extract(body,'$.enabled') IS NULL OR json_extract(body,'$.enabled')=0")
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
			p.Detail = "翻译未开始"
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
