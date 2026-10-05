package reader

import (
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
)

func (s *Server) updateAnnotationNote(w http.ResponseWriter, r *http.Request) {
	var patch struct {
		Note *string `json:"note"`
	}
	if !decode(w, r, &patch) {
		return
	}
	if patch.Note == nil {
		fail(w, 400, "缺少笔记内容")
		return
	}
	// Update only the note in one statement. Concurrent underline merges cannot
	// be overwritten by a stale copy of the original location or quote.
	var body string
	err := s.Store.DB.QueryRow("UPDATE annotations SET body=json_set(body,'$.note',?) WHERE id=? AND document_id=? RETURNING body", *patch.Note, r.PathValue("annotation"), r.PathValue("id")).Scan(&body)
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
