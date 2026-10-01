package reader

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"encoding/xml"
	"io"
	"mime/multipart"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func testServer(t *testing.T) *Server {
	t.Helper()
	store, e := OpenStore(t.TempDir())
	if e != nil {
		t.Fatal(e)
	}
	t.Cleanup(func() { store.DB.Close() })
	return NewServer(store, "test-secret", "")
}
func request(t *testing.T, s *Server, method, path string, body io.Reader) *httptest.ResponseRecorder {
	t.Helper()
	r := httptest.NewRequest(method, "http://127.0.0.1:17840"+path, body)
	r.Header.Set("Authorization", "Bearer test-secret")
	w := httptest.NewRecorder()
	s.Handler().ServeHTTP(w, r)
	return w
}
func upload(t *testing.T, s *Server, name string, data []byte) *httptest.ResponseRecorder {
	t.Helper()
	var body bytes.Buffer
	m := multipart.NewWriter(&body)
	f, _ := m.CreateFormFile("file", name)
	f.Write(data)
	m.Close()
	r := httptest.NewRequest("POST", "http://127.0.0.1:17840/api/documents", &body)
	r.Header.Set("Authorization", "Bearer test-secret")
	r.Header.Set("Content-Type", m.FormDataContentType())
	w := httptest.NewRecorder()
	s.Handler().ServeHTTP(w, r)
	return w
}
func sample(t *testing.T, name string) []byte {
	t.Helper()
	b, e := os.ReadFile(filepath.Join("../../../web/public/samples", name))
	if e != nil {
		t.Fatal(e)
	}
	return b
}
func TestLibraryRoundTrip(t *testing.T) {
	s := testServer(t)
	for _, name := range []string{"the-art-of-reading.epub", "reading-notes.pdf"} {
		t.Run(name, func(t *testing.T) {
			data := sample(t, name)
			w := upload(t, s, name, data)
			if w.Code != 201 {
				t.Fatalf("import: %d %s", w.Code, w.Body.String())
			}
			var doc Document
			if e := json.Unmarshal(w.Body.Bytes(), &doc); e != nil {
				t.Fatal(e)
			}
			if duplicate := upload(t, s, name, data); duplicate.Code != 200 {
				t.Fatalf("duplicate: %d", duplicate.Code)
			}
			progress := `{"type":"pdf","page":2}`
			if doc.Type == "epub" {
				progress = `{"type":"epub","href":"EPUB/chapter2.xhtml","progression":0.4,"locator":"{}"}`
			}
			w = request(t, s, "PATCH", "/api/documents/"+doc.ID, strings.NewReader(`{"favorite":true,"progress":`+progress+`,"percentage":0.5}`))
			if w.Code != 200 {
				t.Fatal(w.Body.String())
			}
			updated, err := s.Store.Document(doc.ID)
			if err != nil || !updated.Favorite || updated.Percentage != .5 || !bytes.Equal(updated.Progress, []byte(progress)) {
				t.Fatalf("progress not persisted: %+v %v", updated, err)
			}
			ann := `{"kind":"note","location":` + progress + `,"quote":"evidence","note":"Check assumptions","color":"#ffff00"}`
			w = request(t, s, "POST", "/api/documents/"+doc.ID+"/annotations", strings.NewReader(ann))
			if w.Code != 201 {
				t.Fatal(w.Body.String())
			}
			var a Annotation
			json.Unmarshal(w.Body.Bytes(), &a)
			w = request(t, s, "GET", "/api/documents/"+doc.ID+"/annotations", nil)
			if !strings.Contains(w.Body.String(), "Check assumptions") {
				t.Fatal(w.Body.String())
			}
			if doc.Type == "epub" {
				w = request(t, s, "GET", "/pub/test-secret/"+doc.ID+"/manifest.json", nil)
				if w.Code != 200 || !strings.Contains(w.Body.String(), "toc") {
					t.Fatalf("manifest: %s", w.Body.String())
				}
				w = request(t, s, "GET", "/pub/test-secret/"+doc.ID+"/EPUB/chapter1.xhtml", nil)
				if w.Code != 200 || !strings.Contains(w.Body.String(), "阅读之前") {
					t.Fatalf("resource: %s", w.Body.String())
				}
				decoder := xml.NewDecoder(strings.NewReader(w.Body.String()))
				for {
					_, e := decoder.Token()
					if e == io.EOF {
						break
					}
					if e != nil {
						t.Fatal(e)
					}
				}
				w = request(t, s, "GET", "/api/documents/"+doc.ID+"/search?q=Reader", nil)
				if w.Code != 200 {
					t.Fatal(w.Body.String())
				}
				w = request(t, s, "GET", "/pub/test-secret/"+doc.ID+"/positions.json", nil)
				if !strings.Contains(w.Body.String(), "progression") {
					t.Fatal("missing positions")
				}
			} else {
				r := httptest.NewRequest("GET", "http://127.0.0.1:17840/pub/test-secret/"+doc.ID+"/original.pdf", nil)
				r.Header.Set("Range", "bytes=0-4")
				w = httptest.NewRecorder()
				s.Handler().ServeHTTP(w, r)
				if w.Code != 206 || w.Body.String() != "%PDF-" {
					t.Fatalf("range: %d %s", w.Code, w.Body.String())
				}
			}
			w = request(t, s, "DELETE", "/api/documents/"+doc.ID+"/annotations/"+a.ID, nil)
			if w.Code != 204 {
				t.Fatal(w.Code)
			}
		})
	}
	docs, e := s.Store.Documents()
	if e != nil || len(docs) != 2 {
		t.Fatalf("library: %v %v", docs, e)
	}
}
func TestAuthBoundaries(t *testing.T) {
	s := testServer(t)
	for _, test := range []struct {
		name, host, origin, token string
		want                      int
	}{{"missing token", "127.0.0.1:17840", "", "", 401}, {"foreign origin", "127.0.0.1:17840", "https://evil.example", "test-secret", 403}, {"rebinding", "evil.example:17840", "", "test-secret", 403}, {"valid", "127.0.0.1:17840", "http://127.0.0.1:17840", "test-secret", 200}} {
		t.Run(test.name, func(t *testing.T) {
			r := httptest.NewRequest("GET", "http://"+test.host+"/api/documents", nil)
			r.Header.Set("Authorization", "Bearer "+test.token)
			r.Header.Set("Origin", test.origin)
			w := httptest.NewRecorder()
			s.Handler().ServeHTTP(w, r)
			if w.Code != test.want {
				t.Fatal(w.Code)
			}
		})
	}
}
func TestRejectInvalidImports(t *testing.T) {
	s := testServer(t)
	if w := upload(t, s, "bad.pdf", []byte("not pdf")); w.Code != 400 {
		t.Fatal(w.Code)
	}
	if w := upload(t, s, "bad.epub", []byte("not zip")); w.Code != 400 {
		t.Fatal(w.Code)
	}
	var data bytes.Buffer
	z := zip.NewWriter(&data)
	f, _ := z.Create("../../escape")
	f.Write([]byte("unsafe"))
	z.Close()
	if w := upload(t, s, "traversal.epub", data.Bytes()); w.Code != 400 {
		t.Fatal(w.Code)
	}
	docs, _ := s.Store.Documents()
	if len(docs) != 0 {
		t.Fatal("invalid imports persisted")
	}
}
func TestContentSanitization(t *testing.T) {
	out, text, e := sanitizeContent([]byte(`<html xmlns="http://www.w3.org/1999/xhtml"><head><style>p{color:red}</style><script>secret()</script></head><body onload="secret()"><p id="target">Safe<br/>text &amp; notes</p><a href="java&#x09;script:evil()">link</a><iframe srcdoc="evil"/></body></html>`))
	if e != nil {
		t.Fatal(e)
	}
	for _, unsafe := range []string{"<script", "onload", "javascript", "iframe", "srcdoc"} {
		if strings.Contains(string(out), unsafe) {
			t.Fatalf("unsafe %s: %s", unsafe, out)
		}
	}
	if !strings.Contains(string(out), "<style>") || !strings.Contains(text, "Safe") {
		t.Fatal(string(out))
	}
	d := xml.NewDecoder(bytes.NewReader(out))
	for {
		_, err := d.Token()
		if err == io.EOF {
			break
		}
		if err != nil {
			t.Fatal(err)
		}
	}
}
func TestLocationValidation(t *testing.T) {
	for _, bad := range []string{`{"type":"epub","href":"../secret"}`, `{"type":"epub","href":"https://evil.test/file"}`, `{"type":"epub","href":"chapter.xhtml","progression":2}`} {
		if validLocation([]byte(bad), "epub") {
			t.Fatal(bad)
		}
	}
	if validLocation([]byte(`{"type":"pdf","page":0}`), "pdf") {
		t.Fatal("zero page")
	}
}
func TestProviderEventParsing(t *testing.T) {
	text, bad := eventText("codex", []byte(`{"type":"item.completed","item":{"type":"agent_message","text":"answer"}}`))
	if text != "answer" || bad {
		t.Fatal(text, bad)
	}
	text, bad = eventText("claude", []byte(`{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"你好"}}}`))
	if text != "你好" || bad {
		t.Fatal(text, bad)
	}
	text, _ = eventText("codex", []byte(`{"type":"item.completed","item":{"type":"command_execution","text":"secret"}}`))
	if text != "" {
		t.Fatal("tool output leaked")
	}
	_, bad = eventText("claude", []byte(`{"type":"result","subtype":"error_max_turns","is_error":true}`))
	if !bad {
		t.Fatal("failure ignored")
	}
}
func TestStoreReopen(t *testing.T) {
	root := t.TempDir()
	s, e := OpenStore(root)
	if e != nil {
		t.Fatal(e)
	}
	_, e = s.DB.Exec("INSERT INTO settings VALUES('reader','{\"mode\":\"dark\"}')")
	if e != nil {
		t.Fatal(e)
	}
	s.DB.Close()
	s, e = OpenStore(root)
	if e != nil {
		t.Fatal(e)
	}
	defer s.DB.Close()
	var value string
	if e = s.DB.QueryRow("SELECT value FROM settings").Scan(&value); e != nil || !strings.Contains(value, "dark") {
		t.Fatal(value, e)
	}
}
func TestProviderMissing(t *testing.T) {
	t.Setenv("PATH", t.TempDir())
	if providerStatus(context.Background(), "codex").Installed {
		t.Fatal("reported absent CLI as installed")
	}
}
func TestChatWithFakeCLI(t *testing.T) {
	s := testServer(t)
	dir := t.TempDir()
	script := `#!/bin/sh
if [ "$1" = login ]; then exit 0; fi
cat >/dev/null
printf '%s\n' '{"type":"item.completed","item":{"type":"agent_message","text":"Test answer"}}' '{"type":"turn.completed"}'
`
	if e := os.WriteFile(filepath.Join(dir, "codex"), []byte(script), 0700); e != nil {
		t.Fatal(e)
	}
	t.Setenv("PATH", dir+string(os.PathListSeparator)+os.Getenv("PATH"))
	w := upload(t, s, "paper.pdf", sample(t, "reading-notes.pdf"))
	var d Document
	json.Unmarshal(w.Body.Bytes(), &d)
	w = request(t, s, "POST", "/api/documents/"+d.ID+"/chat", strings.NewReader(`{"provider":"codex","prompt":"Explain","context":"Some text"}`))
	if w.Code != 200 || !strings.Contains(w.Body.String(), "event: done") || !strings.Contains(w.Body.String(), "Test answer") {
		t.Fatal(w.Code, w.Body.String())
	}
	w = request(t, s, "GET", "/api/documents/"+d.ID+"/messages", nil)
	var messages []Message
	json.Unmarshal(w.Body.Bytes(), &messages)
	if len(messages) != 2 {
		t.Fatal(w.Body.String())
	}
}
