package reader

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"
)

func TestConnectionStages(t *testing.T) {
	calls := 0
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if calls == 1 {
			writeAPIReply(w, "Sure — **READER_OK**.")
			return
		}
		http.Error(w, "image input not supported", http.StatusBadRequest)
	}))
	defer upstream.Close()
	s := testServer(t)
	c := s.aiConfig()
	c.ImageAPI = APIConnection{URL: upstream.URL, Model: "test"}
	if err := s.writeAIConfig(c); err != nil {
		t.Fatal(err)
	}
	text := request(t, s, "POST", "/api/ai/test/image-api?capability=text", nil)
	var cap Capability
	if err := json.Unmarshal(text.Body.Bytes(), &cap); err != nil {
		t.Fatal(err)
	}
	if text.Code != 200 || !cap.Text || cap.Vision || calls != 1 {
		t.Fatalf("text must finish and persist without invoking vision: calls=%d response=%s", calls, text.Body.String())
	}
	if !s.aiConfig().Capabilities["image-api"].Text {
		t.Fatal("text result not persisted")
	}
	vision := request(t, s, "POST", "/api/ai/test/image-api?capability=vision", nil)
	if err := json.Unmarshal(vision.Body.Bytes(), &cap); err != nil {
		t.Fatal(err)
	}
	if vision.Code != 200 || !cap.Text || cap.Vision || cap.Error == "" || calls != 2 {
		t.Fatalf("vision failure must preserve text without repeating its probe: calls=%d response=%s", calls, vision.Body.String())
	}
}

func TestConnectionProbeWithoutLoginOrCatalog(t *testing.T) {
	fakeAgent(t, "claude", "user-settings")
	s := testServer(t)
	w := request(t, s, "POST", "/api/ai/test/claude?capability=text", nil)
	var cap Capability
	_ = json.Unmarshal(w.Body.Bytes(), &cap)
	if w.Code != 200 || !cap.Text {
		t.Fatalf("working CLI must pass despite unavailable login/catalog: %s", w.Body.String())
	}
}

func TestVisionProbeFormatting(t *testing.T) {
	expected := "RED BLUE GREEN YELLOW RED BLUE GREEN YELLOW"
	for _, answer := range []string{expected, "The colors are: red, blue, green, yellow, red, blue, green, yellow.", "1. RED\n2. BLUE\n3. GREEN\n4. YELLOW\n5. RED\n6. BLUE\n7. GREEN\n8. YELLOW"} {
		if !matchesVisionProbe(answer, expected) {
			t.Fatalf("valid image answer rejected: %q", answer)
		}
	}
	for _, answer := range []string{"READER_OK", "I cannot see the image", "RED BLUE", expected + " RED", "YELLOW BLUE GREEN YELLOW RED BLUE GREEN YELLOW"} {
		if matchesVisionProbe(answer, expected) {
			t.Fatalf("invalid image answer accepted: %q", answer)
		}
	}
}

func TestConnectionProbeRejectsStaleResult(t *testing.T) {
	for _, change := range []string{"model", "new-check"} {
		t.Run(change, func(t *testing.T) {
			s := testServer(t)
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				s.configMu.Lock()
				latest := s.readAIConfig()
				if change == "model" {
					latest.TextAPI.Model = "new-model"
				} else {
					latest.Capabilities["text-api"] = Capability{Text: false, Error: "newer failure", CheckedAt: "newer"}
				}
				err := s.writeAIConfig(latest)
				s.configMu.Unlock()
				if err != nil {
					t.Error(err)
				}
				writeAPIReply(w, "READER_OK")
			}))
			defer upstream.Close()
			c := s.aiConfig()
			c.TextAPI = APIConnection{URL: upstream.URL, Model: "test"}
			if err := s.writeAIConfig(c); err != nil {
				t.Fatal(err)
			}
			w := request(t, s, "POST", "/api/ai/test/text-api?capability=text", nil)
			if w.Code != 409 || s.aiConfig().Capabilities["text-api"].Text {
				t.Fatalf("stale result saved: %s", w.Body.String())
			}
		})
	}
}

// Opt-in: sends only a fixed text prompt and a generated color chart. Credentials
// and real documents are never read by the test. Vision availability is reported
// independently because the CLI may point at a text-only model.
func TestLiveClaudeCapabilities(t *testing.T) {
	if os.Getenv("READER_TEST_CLAUDE") != "1" {
		t.Skip("set READER_TEST_CLAUDE=1 to check the local CLI")
	}
	s := testServer(t)
	for _, stage := range []string{"text", "vision"} {
		start := time.Now()
		w := request(t, s, "POST", "/api/ai/test/claude?capability="+stage, nil)
		var cap Capability
		if err := json.Unmarshal(w.Body.Bytes(), &cap); err != nil {
			t.Fatal(err)
		}
		t.Logf("%s elapsed=%s status=%d text=%t vision=%t error=%q", stage, time.Since(start).Round(time.Millisecond), w.Code, cap.Text, cap.Vision, cap.Error)
		if w.Code != 200 || !cap.Text {
			t.Fatalf("working terminal text lost: %s", w.Body.String())
		}
	}
}
