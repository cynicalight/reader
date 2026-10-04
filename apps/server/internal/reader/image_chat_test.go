package reader

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func imageFixture(t *testing.T) (*Server, []byte) {
	t.Helper()
	s, _ := processingFixture(t)
	s.Token = "test-secret"
	data, _, err := visionProbe()
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(filepath.Join(s.analysisDir("doc"), "assets", "p1-b1.png"), data, 0600); err != nil {
		t.Fatal(err)
	}
	return s, data
}
func TestBlockImageAuthorizationAndBoundaries(t *testing.T) {
	s, data := imageFixture(t)
	good := request(t, s, "GET", "/pub/test-secret/doc/assets/p1-b1.png", nil)
	if good.Code != 200 || good.Header().Get("Content-Type") != "image/png" || !bytes.Equal(good.Body.Bytes(), data) {
		t.Fatal("image resource failed", good.Code)
	}
	for _, path := range []string{"/pub/wrong/doc/assets/p1-b1.png", "/pub/test-secret/doc/assets/p1-b2.png", "/pub/test-secret/missing/assets/p1-b1.png"} {
		if res := request(t, s, "GET", path, nil); res.Code == 200 {
			t.Fatal("invalid resource accepted", path)
		}
	}
	if _, _, err := s.readBlockImage("doc", "../../ai-connections"); err == nil {
		t.Fatal("path accepted")
	}
	external := filepath.Join(t.TempDir(), "outside.png")
	os.WriteFile(external, data, 0600)
	asset := filepath.Join(s.analysisDir("doc"), "assets", "p1-b1.png")
	os.Remove(asset)
	if err := os.Symlink(external, asset); err != nil {
		t.Fatal(err)
	}
	if _, _, err := s.readBlockImage("doc", "p1-b1"); err == nil {
		t.Fatal("symlink escaped analysis root")
	}
}
func TestImageChatSendsPixelsAndRecordsAttachmentWithFallback(t *testing.T) {
	s, data := imageFixture(t)
	calls := 0
	api := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		var body struct {
			Messages []struct {
				Content []struct {
					Type     string `json:"type"`
					ImageURL struct {
						URL string `json:"url"`
					} `json:"image_url"`
				} `json:"content"`
			} `json:"messages"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
		}
		if len(body.Messages) != 1 || len(body.Messages[0].Content) != 2 || body.Messages[0].Content[1].ImageURL.URL != imageData(data) {
			t.Error("original image pixels missing")
		}
		w.Header().Set("Content-Type", "application/json")
		writeAPIReply(w, "Image explanation")
	}))
	defer api.Close()
	config := AIConfig{Primary: "codex", Models: map[string]string{}, ImageAPI: APIConnection{URL: api.URL, Model: "vision"}, Capabilities: map[string]Capability{}}
	config.Capabilities["image-api"] = Capability{Text: true, Vision: true, Fingerprint: configPrint(config, "image-api")}
	if err := s.writeAIConfig(config); err != nil {
		t.Fatal(err)
	}
	res := request(t, s, "POST", "/api/documents/doc/chat", strings.NewReader(`{"provider":"codex","prompt":"Explain","context":"source","attachments":["p1-b1","p1-b1"]}`))
	if res.Code != 200 || !strings.Contains(res.Body.String(), "event: fallback") || !strings.Contains(res.Body.String(), "event: done") || calls != 1 {
		t.Fatalf("chat failed: %d %s", res.Code, res.Body.String())
	}
	messages := request(t, s, "GET", "/api/documents/doc/messages", nil)
	var stored []Message
	if err := json.Unmarshal(messages.Body.Bytes(), &stored); err != nil {
		t.Fatal(err)
	}
	if len(stored) != 2 || len(stored[0].Attachments) != 1 || stored[0].Attachments[0].ID != "p1-b1" || stored[1].Content != "Image explanation" {
		t.Fatalf("attachment not persisted: %+v", stored)
	}
}
func TestImageChatRejectsInvalidOrUnverifiedInput(t *testing.T) {
	s, _ := imageFixture(t)
	for _, ids := range []string{`["p1-b1"]`, `["../secret"]`, `["p1-b2"]`, `["p1-b1","p1-b1","p1-b1","p1-b1","p1-b1"]`} {
		res := request(t, s, "POST", "/api/documents/doc/chat", strings.NewReader(`{"provider":"codex","prompt":"Explain","context":"","attachments":`+ids+`}`))
		if res.Code != 400 {
			t.Fatalf("expected rejection: %d %s", res.Code, res.Body.String())
		}
	}
	var count int
	if err := s.Store.DB.QueryRow("SELECT count(*) FROM messages").Scan(&count); err != nil || count != 0 {
		t.Fatal("failed validation stored a message")
	}
}

func TestImageAPIKeepsMultipleAttachments(t *testing.T) {
	data, _, err := visionProbe()
	if err != nil {
		t.Fatal(err)
	}
	second, _, err := visionProbe()
	if err != nil {
		t.Fatal(err)
	}
	api := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Messages []struct {
				Content []struct {
					ImageURL struct {
						URL string `json:"url"`
					} `json:"image_url"`
				} `json:"content"`
			} `json:"messages"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
		}
		if len(body.Messages) != 1 || len(body.Messages[0].Content) != 3 {
			t.Error("not all images transmitted")
		} else if body.Messages[0].Content[1].ImageURL.URL != imageData(data) || body.Messages[0].Content[2].ImageURL.URL != imageData(second) {
			t.Error("image ordering changed")
		}
		writeAPIReply(w, "Both images received")
	}))
	defer api.Close()
	_, err = invokeAPI(t.Context(), APIConnection{URL: api.URL, Model: "vision"}, AIInput{Prompt: "Compare", Images: [][]byte{data, second}}, nil)
	if err != nil {
		t.Fatal(err)
	}
}
