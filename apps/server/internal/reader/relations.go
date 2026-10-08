package reader

import (
	"net/http"
)

const maxRelations = 100

// relationPair orders two document IDs the way document_relations stores them.
func relationPair(x, y string) (string, string) {
	if x < y {
		return x, y
	}
	return y, x
}

// relateDocuments links two documents as related; the link shows on both.
func (s *Server) relateDocuments(w http.ResponseWriter, r *http.Request) {
	id, other := r.PathValue("id"), r.PathValue("other")
	if id == other {
		fail(w, 400, "不能关联自己")
		return
	}
	for _, docID := range []string{id, other} {
		d, err := s.Store.Document(docID)
		if err != nil || d.DeletedAt != "" {
			fail(w, 404, "文档不存在")
			return
		}
		if len(d.Related) >= maxRelations {
			fail(w, 400, "每篇最多关联 100 篇")
			return
		}
	}
	a, b := relationPair(id, other)
	if _, err := s.Store.DB.Exec("INSERT OR IGNORE INTO document_relations VALUES(?,?,?)", a, b, now()); err != nil {
		fail(w, 500, "关联保存失败")
		return
	}
	s.respondDocument(w, id)
}

func (s *Server) unrelateDocuments(w http.ResponseWriter, r *http.Request) {
	a, b := relationPair(r.PathValue("id"), r.PathValue("other"))
	if _, err := s.Store.DB.Exec("DELETE FROM document_relations WHERE a=? AND b=?", a, b); err != nil {
		fail(w, 500, "关联删除失败")
		return
	}
	s.respondDocument(w, r.PathValue("id"))
}

func (s *Server) respondDocument(w http.ResponseWriter, id string) {
	d, err := s.Store.Document(id)
	if err != nil {
		fail(w, 404, "文档不存在")
		return
	}
	respond(w, 200, d)
}
