package reader

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"unicode"
	"unicode/utf8"
)

func metadataText(raw json.RawMessage, limit int, empty bool) (string, error) {
	var value string
	if string(raw) == "null" || json.Unmarshal(raw, &value) != nil {
		return "", errors.New("invalid text")
	}
	value = strings.TrimSpace(value)
	if (!empty && value == "") || utf8.RuneCountInString(value) > limit || strings.ContainsFunc(value, unicode.IsControl) {
		return "", errors.New("invalid text")
	}
	return value, nil
}

type documentTask struct {
	cancel context.CancelFunc
	done   chan struct{}
}

// Register before reading/writing document files. Deletion cancels and joins all
// registered work, and prevents a queued task from starting during cleanup.
func (s *Server) beginDocumentTask(parent context.Context, id string) (context.Context, func(), error) {
	s.documentMu.Lock()
	defer s.documentMu.Unlock()
	if s.deletingDocuments[id] {
		return nil, nil, errors.New("document is being deleted")
	}
	if _, err := s.Store.Document(id); err != nil {
		return nil, nil, err
	}
	if s.documentTasks == nil {
		s.documentTasks = make(map[string]map[*documentTask]struct{})
	}
	if s.documentTasks[id] == nil {
		s.documentTasks[id] = make(map[*documentTask]struct{})
	}
	ctx, cancel := context.WithCancel(parent)
	task := &documentTask{cancel, make(chan struct{})}
	s.documentTasks[id][task] = struct{}{}
	return ctx, func() {
		cancel()
		s.documentMu.Lock()
		defer s.documentMu.Unlock()
		delete(s.documentTasks[id], task)
		if len(s.documentTasks[id]) == 0 {
			delete(s.documentTasks, id)
		}
		close(task.done)
	}, nil
}

func (s *Server) deleteDocument(w http.ResponseWriter, r *http.Request) {
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
		w.WriteHeader(204)
		return
	}
	if err != nil {
		s.documentMu.Unlock()
		fail(w, 500, "无法读取文档")
		return
	}
	if s.deletingDocuments == nil {
		s.deletingDocuments = make(map[string]bool)
	}
	s.deletingDocuments[id] = true
	tasks := []*documentTask{}
	for task := range s.documentTasks[id] {
		task.cancel()
		tasks = append(tasks, task)
	}
	s.documentMu.Unlock()
	defer func() { s.documentMu.Lock(); delete(s.deletingDocuments, id); s.documentMu.Unlock() }()
	for _, task := range tasks {
		select {
		case <-task.done:
		case <-r.Context().Done():
			fail(w, 408, "等待后台任务停止超时，请重试")
			return
		}
	}
	tx, err := s.Store.DB.Begin()
	if err != nil {
		fail(w, 500, "无法删除文档")
		return
	}
	defer tx.Rollback()
	// FTS virtual tables have no foreign-key cascade.
	if _, err = tx.Exec("DELETE FROM search_index WHERE document_id=?", id); err == nil {
		_, err = tx.Exec("DELETE FROM documents WHERE id=?", id)
	}
	if err == nil {
		err = tx.Commit()
	}
	if err != nil {
		fail(w, 500, "删除失败，文档已保留")
		return
	}
	// Only library-owned copies are removed; the imported source is untouched.
	for _, path := range []string{s.Store.File(d), filepath.Join(s.Store.Root, "cache", id)} {
		if err = os.RemoveAll(path); err != nil {
			log.Printf("document %s deleted; cleanup failed: %v", id, err)
		}
	}
	w.WriteHeader(204)
}
