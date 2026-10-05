package reader

import (
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
)

type TagBoard struct {
	ID    string   `json:"id"`
	Name  string   `json:"name"`
	Tags  []string `json:"tags"`
	Match string   `json:"match"`
}

func (s *Server) tagBoards(w http.ResponseWriter, r *http.Request) {
	rows, err := s.Store.DB.Query("SELECT id,name,tags,match FROM tag_boards ORDER BY rowid")
	if err != nil {
		fail(w, 500, "无法读取标签看板")
		return
	}
	defer rows.Close()
	result := []TagBoard{}
	for rows.Next() {
		var b TagBoard
		var tags string
		if err = rows.Scan(&b.ID, &b.Name, &tags, &b.Match); err == nil {
			err = json.Unmarshal([]byte(tags), &b.Tags)
		}
		if err != nil {
			fail(w, 500, "标签看板数据损坏")
			return
		}
		result = append(result, b)
	}
	if rows.Err() != nil {
		fail(w, 500, "无法读取标签看板")
		return
	}
	respond(w, 200, result)
}
func (s *Server) saveTagBoard(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name  json.RawMessage `json:"name"`
		Tags  json.RawMessage `json:"tags"`
		Match string          `json:"match"`
	}
	if !decode(w, r, &body) {
		return
	}
	name, err := metadataText(body.Name, 80, false)
	if err != nil {
		fail(w, 400, "看板名称须为 1–80 个字符")
		return
	}
	tags, err := normalizeTags(body.Tags)
	if err != nil || len(tags) == 0 {
		fail(w, 400, "请选择 1–30 个有效标签")
		return
	}
	if body.Match != "all" && body.Match != "any" {
		fail(w, 400, "标签匹配方式无效")
		return
	}
	board := TagBoard{ID: r.PathValue("id"), Name: name, Tags: tags, Match: body.Match}
	encoded, _ := json.Marshal(tags)
	status := 200
	if r.Method == "POST" {
		board.ID = id()
		status = 201
		_, err = s.Store.DB.Exec("INSERT INTO tag_boards(id,name,tags,match) VALUES(?,?,?,?)", board.ID, name, string(encoded), body.Match)
	} else {
		var result sql.Result
		result, err = s.Store.DB.Exec("UPDATE tag_boards SET name=?,tags=?,match=? WHERE id=?", name, string(encoded), body.Match, board.ID)
		if err == nil {
			if n, _ := result.RowsAffected(); n == 0 {
				err = sql.ErrNoRows
			}
		}
	}
	if errors.Is(err, sql.ErrNoRows) {
		fail(w, 404, "看板不存在，请重新加载")
		return
	}
	if err != nil {
		fail(w, 500, "保存看板失败")
		return
	}
	respond(w, status, board)
}
func (s *Server) deleteTagBoard(w http.ResponseWriter, r *http.Request) {
	if _, err := s.Store.DB.Exec("DELETE FROM tag_boards WHERE id=?", r.PathValue("id")); err != nil {
		fail(w, 500, "删除看板失败")
		return
	}
	w.WriteHeader(204)
}
