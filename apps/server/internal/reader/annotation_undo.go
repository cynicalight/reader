package reader

import (
	"database/sql"
	"encoding/json"
	"log"
	"net/http"
	"reflect"
)

const annotationUndoHeader = "X-Reader-Undo-Session"
const annotationUndoLimit = 100
const annotationUndoBytes = 16 << 20

type annotationChange struct {
	session, document string
	before, after     map[string]string
	size              int
}

type annotationQuery interface {
	Query(string, ...any) (*sql.Rows, error)
}

func annotationSnapshot(db annotationQuery, document string) (map[string]string, error) {
	rows, err := db.Query("SELECT id,body FROM annotations WHERE document_id=?", document)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := map[string]string{}
	for rows.Next() {
		var id, body string
		if err = rows.Scan(&id, &body); err != nil {
			return nil, err
		}
		result[id] = body
	}
	return result, rows.Err()
}

// SQLite's field patches materialize optional defaults. They do not count as
// edits and must not invalidate the preceding real operation's undo snapshot.
func sameAnnotationBody(a, b string) bool {
	if a == b {
		return true
	}
	if a == "" || b == "" {
		return false
	}
	var left, right map[string]any
	if json.Unmarshal([]byte(a), &left) != nil || json.Unmarshal([]byte(b), &right) != nil {
		return false
	}
	for _, fields := range []map[string]any{left, right} {
		for key, value := range map[string]any{"answerId": "", "resolved": false, "tags": []any{}} {
			if fields[key] == nil || reflect.DeepEqual(fields[key], value) {
				delete(fields, key)
			}
		}
	}
	return reflect.DeepEqual(left, right)
}

func annotationDiff(before, after map[string]string) annotationChange {
	change := annotationChange{before: map[string]string{}, after: map[string]string{}}
	ids := map[string]bool{}
	for id := range before {
		ids[id] = true
	}
	for id := range after {
		ids[id] = true
	}
	for id := range ids {
		if !sameAnnotationBody(before[id], after[id]) {
			change.before[id] = before[id]
			change.after[id] = after[id]
			change.size += len(before[id]) + len(after[id]) + len(id)*2
		}
	}
	return change
}

// Serialize all annotation HTTP mutations, including clients without history.
// Diffs include every underline absorbed by the existing merge transaction.
func (s *Server) recordAnnotation(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		s.annotationMu.Lock()
		defer s.annotationMu.Unlock()
		session := r.Header.Get(annotationUndoHeader)
		if session == "" {
			next(w, r)
			return
		}
		if len(session) > 128 {
			fail(w, 400, "撤销会话无效")
			return
		}
		document := r.PathValue("id")
		before, err := annotationSnapshot(s.Store.DB, document)
		if err != nil {
			fail(w, 500, "无法读取批注")
			return
		}
		next(w, r)
		after, err := annotationSnapshot(s.Store.DB, document)
		if err != nil {
			log.Printf("cannot record annotation undo: %v", err)
			return
		}
		change := annotationDiff(before, after)
		if len(change.before) == 0 {
			return
		}
		change.session, change.document = session, document
		s.annotationHistory = append(s.annotationHistory, change)
		size := 0
		for _, entry := range s.annotationHistory {
			size += entry.size
		}
		for len(s.annotationHistory) > annotationUndoLimit || size > annotationUndoBytes {
			size -= s.annotationHistory[0].size
			s.annotationHistory[0] = annotationChange{}
			s.annotationHistory = s.annotationHistory[1:]
		}
	}
}

func (s *Server) undoAnnotation(w http.ResponseWriter, r *http.Request) {
	session, document := r.Header.Get(annotationUndoHeader), r.PathValue("id")
	if session == "" || len(session) > 128 {
		fail(w, 400, "撤销会话无效")
		return
	}
	s.annotationMu.Lock()
	defer s.annotationMu.Unlock()
	index := -1
	for i := len(s.annotationHistory) - 1; i >= 0; i-- {
		entry := s.annotationHistory[i]
		if entry.session == session && entry.document == document {
			index = i
			break
		}
	}
	if index < 0 {
		respond(w, 200, map[string]any{"undone": false, "annotations": []Annotation{}})
		return
	}
	entry := s.annotationHistory[index]
	tx, err := s.Store.DB.Begin()
	if err != nil {
		fail(w, 500, "无法撤销批注")
		return
	}
	defer tx.Rollback()
	var exists int
	if err = tx.QueryRow("SELECT count(*) FROM documents WHERE id=? AND deleted_at=''", document).Scan(&exists); err != nil || exists == 0 {
		fail(w, 404, "文档不存在")
		return
	}
	current, err := annotationSnapshot(tx, document)
	if err != nil {
		fail(w, 500, "无法读取批注")
		return
	}
	for id, expected := range entry.after {
		if !sameAnnotationBody(current[id], expected) {
			history := s.annotationHistory[:0]
			for _, item := range s.annotationHistory {
				if item.session != session || item.document != document {
					history = append(history, item)
				}
			}
			clear(s.annotationHistory[len(history):])
			s.annotationHistory = history
			fail(w, 409, "批注已被其他窗口修改，撤销记录已重置")
			return
		}
	}
	for id, body := range entry.before {
		if body == "" {
			_, err = tx.Exec("DELETE FROM annotations WHERE id=? AND document_id=?", id, document)
		} else {
			_, err = tx.Exec("INSERT INTO annotations(id,document_id,body) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body WHERE annotations.document_id=excluded.document_id", id, document, body)
		}
		if err != nil {
			fail(w, 500, "无法撤销批注")
			return
		}
	}
	restored, err := annotationSnapshot(tx, document)
	if err != nil {
		fail(w, 500, "无法读取恢复后的批注")
		return
	}
	if err = tx.Commit(); err != nil {
		fail(w, 500, "无法撤销批注")
		return
	}
	copy(s.annotationHistory[index:], s.annotationHistory[index+1:])
	s.annotationHistory[len(s.annotationHistory)-1] = annotationChange{}
	s.annotationHistory = s.annotationHistory[:len(s.annotationHistory)-1]
	items := []json.RawMessage{}
	for _, body := range restored {
		items = append(items, json.RawMessage(body))
	}
	respond(w, 200, map[string]any{"undone": true, "annotations": items})
}
