package reader

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"

	"rsc.io/pdf"
)

// The paper library accepts article-sized PDFs only; books stay in the book library.
const (
	maxPaperBytes = 50 << 20
	maxPaperPages = 150
)

func validLibrary(library string) bool { return library == "books" || library == "papers" }

// pdfPageCount reads the page tree without rendering. Malformed or unsupported
// encrypted files report an error instead of a guess.
func pdfPageCount(path string) (pages int, err error) {
	f, err := os.Open(path)
	if err != nil {
		return 0, err
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil {
		return 0, err
	}
	defer func() {
		// The parser panics on some malformed objects.
		if recover() != nil {
			pages, err = 0, errors.New("malformed PDF")
		}
	}()
	r, err := pdf.NewReader(f, info.Size())
	if err != nil {
		return 0, err
	}
	pages = r.NumPage()
	if pages < 1 {
		return 0, errors.New("PDF has no pages")
	}
	return pages, nil
}

// paperLimit returns a user-facing reason when a file cannot join the paper library.
// An unreadable page tree does not block import; the size limit still applies.
func paperLimit(kind string, size int64, path string) string {
	if kind != "pdf" {
		return "文献库只支持 PDF"
	}
	if size > maxPaperBytes {
		return fmt.Sprintf("文献库只收录 %d MB 以内的 PDF，可导入图书库", maxPaperBytes>>20)
	}
	if pages, err := pdfPageCount(path); err == nil && pages > maxPaperPages {
		return fmt.Sprintf("这份 PDF 有 %d 页，文献库只收录 %d 页以内的论文，可导入图书库", pages, maxPaperPages)
	}
	return ""
}

var preferenceKeys = map[string]bool{"library": true}

func (s *Server) preferences(w http.ResponseWriter, r *http.Request) {
	key := r.PathValue("key")
	if !preferenceKeys[key] {
		fail(w, 404, "未知偏好")
		return
	}
	var value string
	err := s.Store.DB.QueryRow("SELECT value FROM settings WHERE key=?", "preferences:"+key).Scan(&value)
	if errors.Is(err, sql.ErrNoRows) {
		respond(w, 200, map[string]any{})
		return
	}
	if err != nil {
		fail(w, 500, "无法读取偏好")
		return
	}
	respond(w, 200, json.RawMessage(value))
}
func (s *Server) savePreferences(w http.ResponseWriter, r *http.Request) {
	key := r.PathValue("key")
	if !preferenceKeys[key] {
		fail(w, 404, "未知偏好")
		return
	}
	var v map[string]any
	if !decode(w, r, &v) {
		return
	}
	b, _ := json.Marshal(v)
	if len(b) > 64<<10 {
		fail(w, 400, "偏好内容过大")
		return
	}
	if _, err := s.Store.DB.Exec("INSERT INTO settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", "preferences:"+key, string(b)); err != nil {
		fail(w, 500, "偏好保存失败")
		return
	}
	respond(w, 200, json.RawMessage(b))
}
