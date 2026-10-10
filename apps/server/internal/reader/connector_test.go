package reader

import (
	"bytes"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

const testExtensionOrigin = connectorExtensionOrigin

func bridgeRequest(s *Server, method, path, secret string, body *bytes.Buffer, contentType string) *httptest.ResponseRecorder {
	var r *http.Request
	if body == nil {
		r = httptest.NewRequest(method, "http://127.0.0.1:17841"+path, nil)
	} else {
		r = httptest.NewRequest(method, "http://127.0.0.1:17841"+path, body)
	}
	r.Header.Set("Origin", testExtensionOrigin)
	if secret != "" {
		r.Header.Set("Authorization", "Bearer "+secret)
	}
	if contentType != "" {
		r.Header.Set("Content-Type", contentType)
	}
	w := httptest.NewRecorder()
	s.ConnectorHandler().ServeHTTP(w, r)
	return w
}
func sessionTestConnector(t *testing.T, s *Server) string {
	t.Helper()
	s.SetConnectorAvailable(true)
	w := bridgeRequest(s, "POST", "/v1/session", "", nil, "")
	if w.Code != 200 {
		t.Fatalf("session %d: %s", w.Code, w.Body.String())
	}
	var session struct {
		Secret string `json:"secret"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &session)
	return session.Secret
}
func TestConnectorSessionAndImport(t *testing.T) {
	s := testServer(t)
	if w := bridgeRequest(s, "GET", "/v1/folders", "", nil, ""); w.Code != 401 {
		t.Fatalf("unauthorized: %d", w.Code)
	}
	secret := sessionTestConnector(t, s)
	var body bytes.Buffer
	m := multipart.NewWriter(&body)
	_ = m.WriteField("metadata", `{"title":"Test connector paper","doi":"10.1000/test","url":"https://example.org/paper","itemType":"journal"}`)
	_ = m.WriteField("sourceUrl", "https://example.org/paper")
	_ = m.WriteField("tags", `["research"]`)
	_ = m.WriteField("folders", `["Web"]`)
	_ = m.WriteField("snapshot", `<article><h1>Saved</h1><script>alert(1)</script><img src="https://evil.example/a"><a href="javascript:alert(1)">bad</a><a href="/paper/related">related</a></article>`)
	f, _ := m.CreateFormFile("pdf", "paper.pdf")
	_, _ = f.Write(testPDF(2))
	_ = m.Close()
	w := bridgeRequest(s, "POST", "/v1/import", secret, &body, m.FormDataContentType())
	if w.Code != 201 {
		t.Fatalf("import %d: %s", w.Code, w.Body.String())
	}
	var result struct {
		Document Document `json:"document"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &result)
	if result.Document.Title != "Test connector paper" || result.Document.Library != "papers" || len(result.Document.Tags) != 1 {
		t.Fatalf("import result: %+v", result.Document)
	}
	snapshot := request(t, s, "GET", "/pub/test-secret/"+result.Document.ID+"/snapshot.html", nil)
	if snapshot.Code != 200 || !strings.Contains(snapshot.Body.String(), "Saved") || strings.Contains(snapshot.Body.String(), "alert(1)") || strings.Contains(snapshot.Body.String(), "https://evil.example/a") {
		t.Fatalf("unsafe snapshot: %d %s", snapshot.Code, snapshot.Body.String())
	}
	if !strings.Contains(snapshot.Header().Get("Content-Security-Policy"), "sandbox") {
		t.Fatal("snapshot missing CSP sandbox")
	}
	if !strings.Contains(snapshot.Body.String(), `href="https://example.org/paper/related"`) {
		t.Fatal("relative snapshot link was not made absolute")
	}
	manual := request(t, s, "PATCH", "/api/documents/"+result.Document.ID, strings.NewReader(`{"title":"My edited title","metadata":{"venue":"My venue"}}`))
	if manual.Code != 200 {
		t.Fatal(manual.Body.String())
	}
	var duplicate bytes.Buffer
	dm := multipart.NewWriter(&duplicate)
	_ = dm.WriteField("metadata", `{"title":"Site title changed","venue":"Site venue","url":"https://example.org/paper"}`)
	_ = dm.WriteField("sourceUrl", "https://example.org/paper")
	df, _ := dm.CreateFormFile("pdf", "paper.pdf")
	_, _ = df.Write(testPDF(2))
	_ = dm.Close()
	w = bridgeRequest(s, "POST", "/v1/import", secret, &duplicate, dm.FormDataContentType())
	if w.Code != 200 {
		t.Fatalf("duplicate: %d %s", w.Code, w.Body.String())
	}
	updated, err := s.Store.Document(result.Document.ID)
	if err != nil || updated.Title != "My edited title" || updated.Metadata.Venue != "My venue" {
		t.Fatalf("manual metadata overwritten: %+v %v", updated, err)
	}
	_ = sessionTestConnector(t, s)
	if w = bridgeRequest(s, "GET", "/v1/folders", secret, nil, ""); w.Code != 401 {
		t.Fatalf("rotated credential: %d", w.Code)
	}
}
func TestConnectorOriginRestriction(t *testing.T) {
	s := testServer(t)
	s.SetConnectorAvailable(true)
	r := httptest.NewRequest("GET", "http://127.0.0.1:17841/v1/status", nil)
	r.Header.Set("Origin", "https://evil.example")
	w := httptest.NewRecorder()
	s.ConnectorHandler().ServeHTTP(w, r)
	if w.Code != 403 {
		t.Fatalf("web origin: %d", w.Code)
	}
	r.Header.Set("Origin", "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
	w = httptest.NewRecorder()
	s.ConnectorHandler().ServeHTTP(w, r)
	if w.Code != 403 {
		t.Fatalf("other extension origin: %d", w.Code)
	}
}
