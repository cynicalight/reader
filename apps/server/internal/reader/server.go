package reader

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"io"
	"mime"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
)

type Server struct {
	Store    *Store
	Token    string
	Web      string
	aiMu     sync.Mutex
	importMu sync.Mutex
}

func NewServer(s *Store, token, web string) *Server { return &Server{Store: s, Token: token, Web: web} }
func id() string                                    { b := make([]byte, 16); _, _ = rand.Read(b); return hex.EncodeToString(b) }
func respond(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
func fail(w http.ResponseWriter, status int, message string) {
	respond(w, status, map[string]string{"error": message})
}
func decode(w http.ResponseWriter, r *http.Request, v any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	d := json.NewDecoder(r.Body)
	d.DisallowUnknownFields()
	if err := d.Decode(v); err != nil {
		fail(w, 400, "无效的请求内容")
		return false
	}
	return true
}
func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/health", func(w http.ResponseWriter, r *http.Request) { respond(w, 200, map[string]string{"status": "ok"}) })
	mux.HandleFunc("GET /api/documents", func(w http.ResponseWriter, r *http.Request) {
		v, e := s.Store.Documents()
		if e != nil {
			fail(w, 500, "无法读取书库")
			return
		}
		respond(w, 200, v)
	})
	mux.HandleFunc("POST /api/documents", s.importDocument)
	mux.HandleFunc("PATCH /api/documents/{id}", s.updateDocument)
	mux.HandleFunc("GET /api/documents/{id}/annotations", s.annotations)
	mux.HandleFunc("POST /api/documents/{id}/annotations", s.saveAnnotation)
	mux.HandleFunc("DELETE /api/documents/{id}/annotations/{annotation}", func(w http.ResponseWriter, r *http.Request) {
		_, err := s.Store.DB.Exec("DELETE FROM annotations WHERE id=? AND document_id=?", r.PathValue("annotation"), r.PathValue("id"))
		if err != nil {
			fail(w, 500, "删除失败")
			return
		}
		w.WriteHeader(204)
	})
	mux.HandleFunc("GET /api/documents/{id}/search", s.search)
	mux.HandleFunc("GET /api/documents/{id}/messages", s.messages)
	mux.HandleFunc("POST /api/documents/{id}/chat", s.chat)
	mux.HandleFunc("GET /api/providers", s.providers)
	mux.HandleFunc("GET /api/settings", func(w http.ResponseWriter, r *http.Request) {
		var value string
		err := s.Store.DB.QueryRow("SELECT value FROM settings WHERE key='reader'").Scan(&value)
		if err != nil {
			respond(w, 200, map[string]any{})
			return
		}
		respond(w, 200, json.RawMessage(value))
	})
	mux.HandleFunc("PUT /api/settings", func(w http.ResponseWriter, r *http.Request) {
		var v map[string]any
		if !decode(w, r, &v) {
			return
		}
		b, _ := json.Marshal(v)
		_, err := s.Store.DB.Exec("INSERT INTO settings VALUES('reader',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", string(b))
		if err != nil {
			fail(w, 500, "设置保存失败")
			return
		}
		respond(w, 200, v)
	})
	mux.HandleFunc("GET /pub/{cap}/{id}/{resource...}", s.resource)
	if s.Web != "" {
		mux.Handle("/", http.FileServer(http.Dir(s.Web)))
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		host, _, err := net.SplitHostPort(r.Host)
		if err != nil {
			host = r.Host
		}
		if host != "127.0.0.1" && host != "localhost" {
			fail(w, 403, "invalid host")
			return
		}
		if origin := r.Header.Get("Origin"); origin != "" {
			u, e := url.Parse(origin)
			if e != nil || u.Scheme != "http" || (u.Host != r.Host && u.Host != "127.0.0.1:5173") {
				fail(w, 403, "invalid origin")
				return
			}
		}
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("Content-Security-Policy", "default-src 'self'; script-src 'self' blob: 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; font-src 'self' data: blob:; frame-src 'self' blob:; worker-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'self'")
		if strings.HasPrefix(r.URL.Path, "/api/") && r.URL.Path != "/api/health" {
			provided := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
			if subtle.ConstantTimeCompare([]byte(provided), []byte(s.Token)) != 1 {
				fail(w, 401, "请使用启动时提供的 Reader 地址")
				return
			}
		}
		mux.ServeHTTP(w, r)
	})
}
func (s *Server) importDocument(w http.ResponseWriter, r *http.Request) {
	s.importMu.Lock()
	defer s.importMu.Unlock()
	r.Body = http.MaxBytesReader(w, r.Body, 100<<20)
	if err := r.ParseMultipartForm(8 << 20); err != nil {
		fail(w, 400, "文件超过 100 MB 或上传无效")
		return
	}
	defer r.MultipartForm.RemoveAll()
	file, header, err := r.FormFile("file")
	if err != nil {
		fail(w, 400, "请选择 EPUB 或 PDF")
		return
	}
	defer file.Close()
	kind := strings.TrimPrefix(strings.ToLower(filepath.Ext(header.Filename)), ".")
	if kind != "epub" && kind != "pdf" {
		fail(w, 400, "仅支持 EPUB 和 PDF")
		return
	}
	temp, err := os.CreateTemp(s.Store.Root, "import-*")
	if err != nil {
		fail(w, 500, "无法保存文件")
		return
	}
	defer os.Remove(temp.Name())
	defer temp.Close()
	hash := sha256.New()
	size, err := io.Copy(io.MultiWriter(temp, hash), file)
	if err != nil {
		fail(w, 400, "上传未完成")
		return
	}
	if err = temp.Close(); err != nil {
		fail(w, 500, "保存失败")
		return
	}
	docID := hex.EncodeToString(hash.Sum(nil))[:32]
	if d, e := s.Store.Document(docID); e == nil {
		respond(w, 200, d)
		return
	}
	d := Document{ID: docID, Type: kind, Title: strings.TrimSuffix(filepath.Base(header.Filename), filepath.Ext(header.Filename)), Size: size, CreatedAt: now(), LastOpenedAt: now()}
	var texts map[string]string
	cache := filepath.Join(s.Store.Root, "cache", docID)
	success := false
	defer func() {
		if !success {
			_ = os.RemoveAll(cache)
		}
	}()
	if kind == "pdf" {
		f, e := os.Open(temp.Name())
		if e != nil {
			fail(w, 500, "无法验证文件")
			return
		}
		head := make([]byte, 5)
		_, e = io.ReadFull(f, head)
		f.Close()
		if e != nil || string(head) != "%PDF-" {
			fail(w, 400, "文件不是有效的 PDF")
			return
		}
	}
	if kind == "epub" {
		m, t, e := prepareEPUB(r.Context(), temp.Name(), cache)
		if e != nil {
			fail(w, 400, "EPUB 无法导入："+e.Error())
			return
		}
		texts = t
		if metadata, ok := m["metadata"].(map[string]any); ok {
			if title, ok := metadata["title"].(string); ok && title != "" {
				d.Title = title
			}
			if authors, ok := metadata["author"].([]any); ok {
				names := []string{}
				for _, a := range authors {
					if author, ok := a.(map[string]any); ok {
						if n, ok := author["name"].(string); ok {
							names = append(names, n)
						}
					}
				}
				d.Author = strings.Join(names, ", ")
			}
		}
	}
	dest := s.Store.File(d)
	if err = os.Rename(temp.Name(), dest); err != nil {
		fail(w, 500, "无法保存原文件")
		return
	}
	tx, err := s.Store.DB.Begin()
	if err != nil {
		_ = os.Remove(dest)
		fail(w, 500, "无法写入书库")
		return
	}
	defer tx.Rollback()
	_, err = tx.Exec("INSERT INTO documents(id,type,title,author,size,created_at,last_opened_at) VALUES(?,?,?,?,?,?,?)", d.ID, d.Type, d.Title, d.Author, d.Size, d.CreatedAt, d.LastOpenedAt)
	if err == nil {
		for href, text := range texts {
			_, err = tx.Exec("INSERT INTO search_index(document_id,href,content) VALUES(?,?,?)", d.ID, href, text)
			if err != nil {
				break
			}
		}
	}
	if err == nil {
		err = tx.Commit()
	}
	if err != nil {
		_ = os.Remove(dest)
		fail(w, 500, "书库保存失败")
		return
	}
	success = true
	respond(w, 201, d)
}
func validLocation(data json.RawMessage, kind string) bool {
	var l struct {
		Type        string  `json:"type"`
		Page        int     `json:"page"`
		Href        string  `json:"href"`
		Progression float64 `json:"progression"`
	}
	if json.Unmarshal(data, &l) != nil || l.Type != kind {
		return false
	}
	if kind == "pdf" {
		return l.Page > 0
	}
	_, err := safeResource(l.Href)
	return l.Href != "" && err == nil && l.Progression >= 0 && l.Progression <= 1
}
func (s *Server) updateDocument(w http.ResponseWriter, r *http.Request) {
	d, err := s.Store.Document(r.PathValue("id"))
	if err != nil {
		fail(w, 404, "文档不存在")
		return
	}
	var v struct {
		Favorite   *bool           `json:"favorite"`
		Progress   json.RawMessage `json:"progress"`
		Percentage *float64        `json:"percentage"`
	}
	if !decode(w, r, &v) {
		return
	}
	if v.Progress != nil {
		if !validLocation(v.Progress, d.Type) {
			fail(w, 400, "无效阅读位置")
			return
		}
		d.Progress = v.Progress
	}
	if v.Percentage != nil {
		if *v.Percentage < 0 || *v.Percentage > 1 {
			fail(w, 400, "无效进度")
			return
		}
		d.Percentage = *v.Percentage
	}
	if v.Favorite != nil {
		d.Favorite = *v.Favorite
	}
	d.LastOpenedAt = now()
	var progress any
	if v.Progress != nil {
		progress = string(v.Progress)
	}
	_, err = s.Store.DB.Exec("UPDATE documents SET favorite=COALESCE(?,favorite),progress=COALESCE(?,progress),percentage=COALESCE(?,percentage),last_opened_at=? WHERE id=?", v.Favorite, progress, v.Percentage, d.LastOpenedAt, d.ID)
	if err != nil {
		fail(w, 500, "保存失败")
		return
	}
	respond(w, 200, d)
}
func (s *Server) annotations(w http.ResponseWriter, r *http.Request) {
	rows, err := s.Store.DB.Query("SELECT body FROM annotations WHERE document_id=? ORDER BY rowid", r.PathValue("id"))
	if err != nil {
		fail(w, 500, "无法读取批注")
		return
	}
	defer rows.Close()
	items := []json.RawMessage{}
	for rows.Next() {
		var b string
		if err = rows.Scan(&b); err != nil {
			fail(w, 500, "无法读取批注")
			return
		}
		items = append(items, json.RawMessage(b))
	}
	respond(w, 200, items)
}
func (s *Server) saveAnnotation(w http.ResponseWriter, r *http.Request) {
	d, err := s.Store.Document(r.PathValue("id"))
	if err != nil {
		fail(w, 404, "文档不存在")
		return
	}
	var a Annotation
	if !decode(w, r, &a) {
		return
	}
	if !validLocation(a.Location, d.Type) || (a.Kind != "highlight" && a.Kind != "underline" && a.Kind != "note" && a.Kind != "bookmark") {
		fail(w, 400, "批注类型或位置无效")
		return
	}
	a.ID = id()
	a.DocumentID = d.ID
	a.CreatedAt = now()
	b, _ := json.Marshal(a)
	_, err = s.Store.DB.Exec("INSERT INTO annotations VALUES(?,?,?)", a.ID, a.DocumentID, string(b))
	if err != nil {
		fail(w, 500, "批注保存失败")
		return
	}
	respond(w, 201, a)
}
func (s *Server) resource(w http.ResponseWriter, r *http.Request) {
	if subtle.ConstantTimeCompare([]byte(r.PathValue("cap")), []byte(s.Token)) != 1 {
		fail(w, 403, "invalid capability")
		return
	}
	d, err := s.Store.Document(r.PathValue("id"))
	if err != nil {
		fail(w, 404, "文档不存在")
		return
	}
	name := r.PathValue("resource")
	if d.Type == "pdf" {
		if name != "original.pdf" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/pdf")
		http.ServeFile(w, r, s.Store.File(d))
		return
	}
	name, err = safeResource(name)
	if err != nil {
		fail(w, 400, "无效资源路径")
		return
	}
	cache := filepath.Join(s.Store.Root, "cache", d.ID)
	if name == "manifest.json" {
		data, e := os.ReadFile(filepath.Join(cache, name))
		if e != nil {
			fail(w, 404, "目录不可用")
			return
		}
		var m map[string]any
		_ = json.Unmarshal(data, &m)
		m["links"] = []map[string]string{{"rel": "self", "href": "http://" + r.Host + r.URL.Path, "type": "application/webpub+json"}, {"rel": "http://readium.org/positions", "href": "positions.json", "type": "application/vnd.readium.position-list+json"}}
		respond(w, 200, m)
		return
	}
	ext := strings.ToLower(filepath.Ext(name))
	if ext == ".js" {
		http.NotFound(w, r)
		return
	}
	ct := mime.TypeByExtension(ext)
	if ext == ".xhtml" {
		ct = "text/html; charset=utf-8"
	}
	if ct != "" {
		w.Header().Set("Content-Type", ct)
	}
	http.ServeFile(w, r, filepath.Join(cache, filepath.FromSlash(name)))
}
func (s *Server) search(w http.ResponseWriter, r *http.Request) {
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	if q == "" {
		respond(w, 200, []any{})
		return
	}
	query := "\"" + strings.ReplaceAll(q, "\"", "\"\"") + "\""
	rows, err := s.Store.DB.Query("SELECT href,content FROM search_index WHERE document_id=? AND (search_index MATCH ?) LIMIT 100", r.PathValue("id"), query)
	if err != nil {
		fail(w, 500, "搜索失败")
		return
	}
	type hit struct{ href, text string }
	hits := []hit{}
	seen := map[string]bool{}
	for rows.Next() {
		var h hit
		if rows.Scan(&h.href, &h.text) == nil {
			hits = append(hits, h)
			seen[h.href] = true
		}
	}
	rows.Close()
	// unicode61 does not segment CJK words. A literal substring fallback also
	// supports short Chinese queries; percent and underscore are escaped.
	literal := strings.NewReplacer("\\", "\\\\", "%", "\\%", "_", "\\_").Replace(q)
	rows, err = s.Store.DB.Query("SELECT href,content FROM search_index WHERE document_id=? AND content LIKE ? ESCAPE '\\' LIMIT 100", r.PathValue("id"), "%"+literal+"%")
	if err != nil {
		fail(w, 500, "搜索失败")
		return
	}
	defer rows.Close()
	for rows.Next() {
		var h hit
		if rows.Scan(&h.href, &h.text) == nil && !seen[h.href] {
			hits = append(hits, h)
		}
	}
	out := []any{}
	for _, h := range hits {
		runes := []rune(h.text)
		lower := strings.ToLower(h.text)
		index := strings.Index(lower, strings.ToLower(q))
		start := 0
		if index >= 0 {
			start = len([]rune(lower[:index])) - 35
		}
		if start < 0 {
			start = 0
		}
		end := min(len(runes), start+150)
		excerpt := string(runes[start:end])
		out = append(out, map[string]any{"id": h.href, "excerpt": excerpt, "location": map[string]any{"type": "epub", "href": h.href, "quote": q}})
		if len(out) == 100 {
			break
		}
	}
	respond(w, 200, out)
}
func (s *Server) messages(w http.ResponseWriter, r *http.Request) {
	rows, err := s.Store.DB.Query("SELECT body FROM messages WHERE document_id=? ORDER BY created_at", r.PathValue("id"))
	if err != nil {
		fail(w, 500, "读取对话失败")
		return
	}
	defer rows.Close()
	out := []json.RawMessage{}
	for rows.Next() {
		var b string
		if rows.Scan(&b) == nil {
			out = append(out, json.RawMessage(b))
		}
	}
	respond(w, 200, out)
}
func (s *Store) saveMessage(m Message) error {
	m.ID = id()
	m.CreatedAt = now()
	b, err := json.Marshal(m)
	if err != nil {
		return err
	}
	_, err = s.DB.Exec("INSERT INTO messages VALUES(?,?,?,?)", m.ID, m.DocumentID, string(b), m.CreatedAt)
	return err
}
