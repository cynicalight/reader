package reader

import (
	"database/sql"
	"errors"
	"net/http"
)

// Moving to the trash keeps every file and record; only purge removes data.
func (s *Store) TrashedDocuments(library string) ([]Document, error) {
	rows, err := s.DB.Query(`SELECT `+documentColumns+` FROM documents WHERE deleted_at!='' AND library=? ORDER BY deleted_at DESC`, library)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	docs := []Document{}
	for rows.Next() {
		d, err := scanDocument(rows)
		if err != nil {
			return nil, err
		}
		docs = append(docs, d)
	}
	return docs, rows.Err()
}

func (s *Server) trashDocument(w http.ResponseWriter, r *http.Request) {
	s.importMu.Lock()
	defer s.importMu.Unlock()
	id := r.PathValue("id")
	s.documentMu.Lock()
	if s.deletingDocuments[id] {
		s.documentMu.Unlock()
		fail(w, 409, "文档正在删除")
		return
	}
	d, err := s.Store.Document(id)
	if errors.Is(err, sql.ErrNoRows) {
		s.documentMu.Unlock()
		fail(w, 404, "文档不存在")
		return
	}
	if err != nil {
		s.documentMu.Unlock()
		fail(w, 500, "无法读取文档")
		return
	}
	if d.DeletedAt != "" {
		s.documentMu.Unlock()
		respond(w, 200, d)
		return
	}
	interrupted := false
	if p, e := s.Store.processing(id); e == nil {
		interrupted = p.Status == "running" || (p.Translating != nil && p.Translating.Status == "running")
	}
	// Marking first rejects new work; running work is then cancelled and joined.
	if _, err = s.Store.DB.Exec("UPDATE documents SET deleted_at=? WHERE id=?", now(), id); err != nil {
		s.documentMu.Unlock()
		fail(w, 500, "无法移到回收站")
		return
	}
	tasks := []*documentTask{}
	for task := range s.documentTasks[id] {
		task.cancel()
		tasks = append(tasks, task)
	}
	s.documentMu.Unlock()
	for _, task := range tasks {
		select {
		case <-task.done:
		case <-r.Context().Done():
			// The document is already in the trash; the task stops on its own.
			fail(w, 408, "已移到回收站，后台任务仍在停止")
			return
		}
	}
	if interrupted {
		s.requeueInterrupted(id, "已暂停，恢复后继续")
	}
	if d, err = s.Store.Document(id); err != nil {
		fail(w, 500, "无法读取文档")
		return
	}
	respond(w, 200, d)
}

// requeueInterrupted returns work stopped by the trash to the queue.
func (s *Server) requeueInterrupted(id, detail string) {
	s.processingMu.Lock()
	defer s.processingMu.Unlock()
	p, err := s.Store.processing(id)
	if err != nil || p.Status == "complete" {
		return
	}
	p.Status, p.Detail = "queued", detail
	p.recoverStages, p.resetStages = true, true
	_ = s.Store.saveProcessing(p)
}

func (s *Server) restoreDocument(w http.ResponseWriter, r *http.Request) {
	s.importMu.Lock()
	defer s.importMu.Unlock()
	d, err := s.restore(r.PathValue("id"))
	if errors.Is(err, sql.ErrNoRows) {
		fail(w, 404, "文档不存在")
		return
	}
	if err != nil {
		fail(w, 500, "无法恢复文档")
		return
	}
	respond(w, 200, d)
}

// restore is idempotent; the caller holds importMu.
func (s *Server) restore(id string) (Document, error) {
	d, err := s.Store.Document(id)
	if err != nil || d.DeletedAt == "" {
		return d, err
	}
	if _, err = s.Store.DB.Exec("UPDATE documents SET deleted_at='' WHERE id=?", id); err != nil {
		return d, err
	}
	// A task that was starting when the document moved to the trash may have left "running".
	if p, e := s.Store.processing(id); e == nil && (p.Status == "running" || (p.Translating != nil && p.Translating.Status == "running")) {
		s.requeueInterrupted(id, "继续上次的处理")
	}
	return s.Store.Document(id)
}

func (s *Server) trashList(w http.ResponseWriter, r *http.Request) {
	library := r.URL.Query().Get("library")
	if !validLibrary(library) {
		fail(w, 400, "未知书库")
		return
	}
	docs, err := s.Store.TrashedDocuments(library)
	if err != nil {
		fail(w, 500, "无法读取回收站")
		return
	}
	respond(w, 200, docs)
}

func (s *Server) emptyTrash(w http.ResponseWriter, r *http.Request) {
	library := r.URL.Query().Get("library")
	if !validLibrary(library) {
		fail(w, 400, "未知书库")
		return
	}
	s.importMu.Lock()
	defer s.importMu.Unlock()
	docs, err := s.Store.TrashedDocuments(library)
	if err != nil {
		fail(w, 500, "无法读取回收站")
		return
	}
	removed := 0
	for _, d := range docs {
		if status, message := s.purgeDocument(r.Context(), d.ID); message != "" {
			respond(w, status, map[string]any{"error": message, "removed": removed})
			return
		}
		removed++
	}
	respond(w, 200, map[string]int{"removed": removed})
}
