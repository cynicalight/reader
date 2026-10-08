package reader

import (
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"regexp"
	"unicode/utf8"
)

var colorPattern = regexp.MustCompile(`^#[0-9a-fA-F]{6}$`)

func (s *Server) updateAnnotationNote(w http.ResponseWriter, r *http.Request) {
	var patch struct {
		Note     *string         `json:"note"`
		AnswerID *string         `json:"answerId"`
		Resolved *bool           `json:"resolved"`
		Color    *string         `json:"color"`
		Tags     json.RawMessage `json:"tags"`
	}
	if !decode(w, r, &patch) {
		return
	}
	if patch.Color != nil && !colorPattern.MatchString(*patch.Color) {
		fail(w, 400, "颜色须为 #rrggbb")
		return
	}
	var tags *string
	if len(patch.Tags) > 0 && string(patch.Tags) != "null" {
		normalized, err := normalizeTags(patch.Tags)
		if err != nil || len(normalized) > 10 {
			fail(w, 400, "批注标签最多 10 个，每个 1–40 个字符")
			return
		}
		b, _ := json.Marshal(normalized)
		text := string(b)
		tags = &text
	}
	if patch.Note == nil && patch.AnswerID == nil && patch.Resolved == nil && patch.Color == nil && tags == nil {
		fail(w, 400, "缺少笔记内容")
		return
	}
	documentID := r.PathValue("id")
	if patch.AnswerID != nil && *patch.AnswerID != "" {
		var exists int
		if s.Store.DB.QueryRow("SELECT count(*) FROM messages WHERE id=? AND document_id=?", *patch.AnswerID, documentID).Scan(&exists); exists == 0 {
			fail(w, 400, "回答不存在")
			return
		}
	}
	// Update only the given fields in one statement. Concurrent underline merges
	// cannot be overwritten by a stale copy of the original location or quote.
	var body string
	err := s.Store.DB.QueryRow(`UPDATE annotations SET body=json_set(body,
  '$.note',COALESCE(?,json_extract(body,'$.note')),
  '$.color',COALESCE(?,json_extract(body,'$.color')),
  '$.answerId',COALESCE(?,json_extract(body,'$.answerId'),''),
  '$.resolved',json(CASE WHEN ? IS NULL THEN (CASE WHEN json_extract(body,'$.resolved') THEN 'true' ELSE 'false' END) WHEN ? THEN 'true' ELSE 'false' END),
  '$.tags',json(COALESCE(?,json_extract(body,'$.tags'),'[]')))
  WHERE id=? AND document_id=? RETURNING body`, patch.Note, patch.Color, patch.AnswerID, patch.Resolved, patch.Resolved, tags, r.PathValue("annotation"), documentID).Scan(&body)
	if errors.Is(err, sql.ErrNoRows) {
		fail(w, 404, "标注不存在，请重新选择原文")
		return
	}
	if err != nil {
		fail(w, 500, "笔记保存失败")
		return
	}
	respond(w, 200, json.RawMessage(body))
}

type documentNote struct {
	Body      string `json:"body"`
	UpdatedAt string `json:"updatedAt,omitempty"`
}

// The paper note is one free-form note per document, beside its annotations.
func (s *Server) documentNote(w http.ResponseWriter, r *http.Request) {
	var note documentNote
	err := s.Store.DB.QueryRow("SELECT body,updated_at FROM document_notes WHERE document_id=?", r.PathValue("id")).Scan(&note.Body, &note.UpdatedAt)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		fail(w, 500, "无法读取笔记")
		return
	}
	respond(w, 200, note)
}
func (s *Server) saveDocumentNote(w http.ResponseWriter, r *http.Request) {
	var note documentNote
	if !decode(w, r, &note) {
		return
	}
	if utf8.RuneCountInString(note.Body) > 100000 {
		fail(w, 400, "笔记最多 100000 个字符")
		return
	}
	if _, err := s.Store.Document(r.PathValue("id")); err != nil {
		fail(w, 404, "文档不存在")
		return
	}
	note.UpdatedAt = now()
	if _, err := s.Store.DB.Exec("INSERT INTO document_notes VALUES(?,?,?) ON CONFLICT(document_id) DO UPDATE SET body=excluded.body,updated_at=excluded.updated_at", r.PathValue("id"), note.Body, note.UpdatedAt); err != nil {
		fail(w, 500, "笔记保存失败")
		return
	}
	respond(w, 200, note)
}
