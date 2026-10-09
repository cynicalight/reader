package reader

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
	"time"
)

const deepSeekModels = `{"object":"list","data":[{"id":"deepseek-flash","object":"model","name":"DeepSeek-V4.1-Flash","effort":{"supported_levels":["low","high","max"],"default_level":"high"}},{"id":"deepseek-v4-pro","object":"model","name":"DeepSeek-V4-Pro","effort":{"supported_levels":["low","high","max"],"default_level":"high"}},{"id":"plain","object":"model"}]}`

type apiCall struct {
	Model    string              `json:"model"`
	Effort   string              `json:"reasoning_effort"`
	Messages []completionMessage `json:"messages"`
}

// fakeAPI serves /models and records every completion request. reply returns
// the answer text, or "" to fail the request with HTTP 500.
func fakeAPI(t *testing.T, reply func(int, apiCall) string) (*httptest.Server, func() []apiCall) {
	var mu sync.Mutex
	var calls []apiCall
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer sk-test" {
			w.WriteHeader(401)
			return
		}
		if r.Method == "GET" && r.URL.Path == "/v1/models" {
			io.WriteString(w, deepSeekModels)
			return
		}
		var call apiCall
		if r.URL.Path != "/v1/chat/completions" || json.NewDecoder(r.Body).Decode(&call) != nil {
			w.WriteHeader(400)
			return
		}
		mu.Lock()
		calls = append(calls, call)
		n := len(calls)
		mu.Unlock()
		text := reply(n, call)
		if text == "" {
			w.WriteHeader(500)
			return
		}
		writeAPIReply(w, text)
	}))
	t.Cleanup(upstream.Close)
	return upstream, func() []apiCall {
		mu.Lock()
		defer mu.Unlock()
		return append([]apiCall{}, calls...)
	}
}

func TestAPIAgentChoosesTaskModelsAndEffort(t *testing.T) {
	s := testServer(t)
	upstream, calls := fakeAPI(t, func(int, apiCall) string { return "ok" })
	conn := APIConnection{URL: upstream.URL + "/v1", Key: "sk-test"}
	cases := []struct {
		task         modelTask
		model, level string
		want, effort string
	}{
		{taskChat, "", "medium", "deepseek-v4-pro", "high"},
		{taskTranslation, "", "low", "deepseek-flash", "low"},
		{taskChat, "plain", "max", "plain", ""},                // No advertised effort.
		{taskChat, "custom-model", "max", "custom-model", ""},  // Not in the catalog.
		{taskChat, "deepseek-flash", "", "deepseek-flash", ""}, // Probes omit effort.
	}
	for _, c := range cases {
		adapter := apiAgentAdapter{conn, c.model, c.level, c.task, s.apiCatalog(conn)}
		if _, err := adapter.Stream(t.Context(), GenerateRequest{AIInput{Prompt: "hi"}}, nil); err != nil {
			t.Fatal(err)
		}
		got := calls()[len(calls())-1]
		if got.Model != c.want || got.Effort != c.effort {
			t.Fatalf("%+v: sent model %q effort %q", c, got.Model, got.Effort)
		}
	}
	models, err := s.apiCatalog(conn)(t.Context(), "api")
	if err != nil || len(models) != 3 || models[1].Name != "DeepSeek-V4-Pro" || models[2].Name != "plain" {
		t.Fatalf("catalog: %+v %v", models, err)
	}
	other := APIConnection{URL: upstream.URL + "/v1", Key: "sk-wrong"}
	if _, err = s.apiCatalog(other)(t.Context(), "api"); errorKind(err) != ErrorAuthentication {
		t.Fatalf("a different key reused the cached catalog: %v", err)
	}
}

func TestAPITranslationSessionSpansBatches(t *testing.T) {
	s := testServer(t)
	upstream, calls := fakeAPI(t, func(n int, _ apiCall) string {
		if n == 2 {
			return ""
		}
		return "answer-" + string(rune('0'+n))
	})
	config := AIConfig{Primary: "api", API: APIConnection{URL: upstream.URL + "/v1", Key: "sk-test"}, Models: map[string]string{}, Capabilities: map[string]Capability{}}
	service, sessions := s.translationService(config)
	defer sessions.close()
	session := service.connections["api"].Adapter
	if session != sessions.api {
		t.Fatal("translation does not use the worker's API session")
	}
	for i, prompt := range []string{"batch-1", "batch-2", "batch-3"} {
		_, err := session.Stream(t.Context(), GenerateRequest{AIInput{Prompt: prompt}}, nil)
		if (i == 1) != (err != nil) {
			t.Fatalf("batch %d: %v", i+1, err)
		}
	}
	got := calls()
	roles := func(c apiCall) string {
		parts := []string{}
		for _, m := range c.Messages {
			text, _ := m.Content.(string)
			if m.Role == "system" {
				text = "-"
			}
			parts = append(parts, m.Role+":"+text)
		}
		return strings.Join(parts, " ")
	}
	want := []string{
		"system:- user:batch-1",
		"system:- user:batch-1 assistant:answer-1 user:batch-2",
		// The failed second turn is dropped; the first one stays in the session.
		"system:- user:batch-1 assistant:answer-1 user:batch-3",
	}
	for i := range want {
		if roles(got[i]) != want[i] || got[i].Model != "deepseek-flash" {
			t.Fatalf("call %d: %s (%s)", i+1, roles(got[i]), got[i].Model)
		}
	}
	sessions.close()
	if sessions.api.history != nil {
		t.Fatal("closed session kept history")
	}
}

func TestAPITranslationHistoryTrimsOldestTurns(t *testing.T) {
	s := &apiTranslationSession{}
	turn := strings.Repeat("x", apiTranslationHistoryBytes/8)
	for i := 0; i < 8; i++ {
		s.record(turn, turn+string(rune('a'+i)))
	}
	if s.size > apiTranslationHistoryBytes || len(s.history)%2 != 0 || s.history[0].Role != "user" {
		t.Fatalf("history not trimmed to whole turns: %d bytes, %d messages", s.size, len(s.history))
	}
	if last := s.history[len(s.history)-1].Content.(string); !strings.HasSuffix(last, "h") {
		t.Fatal("latest turn was dropped")
	}
	huge := strings.Repeat("y", apiTranslationHistoryBytes)
	s.record(huge, "z")
	if len(s.history) != 2 || s.history[1].Content != "z" {
		t.Fatal("an oversized latest turn must stay as the only context")
	}
}

func TestAPIAgentConfigKeepsKeyPrivate(t *testing.T) {
	s := testServer(t)
	body := `{"primary":"api","models":{"api":"deepseek-flash"},"api":{"url":"https://api.deepseek.com","key":"sk-private","hasKey":false},"textAPI":{"url":"","model":"","hasKey":false},"imageAPI":{"url":"","model":"","hasKey":false},"capabilities":{}}`
	if w := request(t, s, "PUT", "/api/ai/config", strings.NewReader(body)); w.Code != 200 || strings.Contains(w.Body.String(), "sk-private") || !strings.Contains(w.Body.String(), `"hasKey":true`) {
		t.Fatalf("save: %d %s", w.Code, w.Body.String())
	}
	c := s.aiConfig()
	c.Capabilities["api"] = Capability{Text: true, Fingerprint: configPrint(c, "api")}
	if err := s.writeAIConfig(c); err != nil {
		t.Fatal(err)
	}
	// The UI resends hasKey without the secret; the key and its test survive.
	resend := strings.Replace(body, `"key":"sk-private","hasKey":false`, `"hasKey":true`, 1)
	if w := request(t, s, "PUT", "/api/ai/config", strings.NewReader(resend)); w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	if c = s.aiConfig(); c.API.Key != "sk-private" || !capable(c, "api", false) {
		t.Fatalf("key or capability lost: %+v", c.API)
	}
	// A new key is a new connection and must be tested again.
	changed := strings.Replace(body, "sk-private", "sk-other", 1)
	if w := request(t, s, "PUT", "/api/ai/config", strings.NewReader(changed)); w.Code != 200 || capable(s.aiConfig(), "api", false) {
		t.Fatal("capability survived a key change")
	}
	insecure := strings.Replace(body, "https://api.deepseek.com", "http://api.deepseek.com", 1)
	if w := request(t, s, "PUT", "/api/ai/config", strings.NewReader(insecure)); w.Code != 400 {
		t.Fatal("plain HTTP to a remote API was accepted")
	}
	w := request(t, s, "GET", "/api/providers?auth=skip", nil)
	if !strings.Contains(w.Body.String(), `{"id":"api","installed":true,"authenticated":true,"status":"已配置"}`) {
		t.Fatal(w.Body.String())
	}
}

// READER_TEST_DEEPSEEK=1 runs a real translation batch and a follow-up turn on
// the same session with DEEPSEEK_API_KEY.
func TestLiveDeepSeekTranslationSession(t *testing.T) {
	key := os.Getenv("DEEPSEEK_API_KEY")
	if os.Getenv("READER_TEST_DEEPSEEK") != "1" || key == "" {
		t.Skip("set READER_TEST_DEEPSEEK=1 and DEEPSEEK_API_KEY")
	}
	s := testServer(t)
	conn := APIConnection{URL: "https://api.deepseek.com", Key: key}
	models, err := s.apiCatalog(conn)(t.Context(), "api")
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("models: %+v", models)
	config := AIConfig{Primary: "api", API: conn, Models: map[string]string{}, Capabilities: map[string]Capability{}}
	service, sessions := s.translationService(config)
	defer sessions.close()
	session := service.connections["api"].Adapter
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()
	source := "Reading is a conversation with the author. Good readers ask questions as they go."
	batch := translationBatch{Paragraphs: []translationParagraph{{BlockID: "p7-b3", SourceHash: translationHash(source), Source: source}}}
	var rows []TranslationBlock
	decoder := newTranslationJSONL(batch, func(b TranslationBlock) error { rows = append(rows, b); return nil })
	result, err := session.Stream(ctx, GenerateRequest{AIInput{Prompt: translationPrompt(Document{Title: "Live"}, layoutManifest{}, batch)}}, func(e ProviderEvent) error {
		return decoder.feed(e.Text)
	})
	if err == nil && strings.TrimSpace(decoder.buffer) != "" {
		err = decoder.line(decoder.buffer)
	}
	if err != nil || len(rows) != 1 {
		t.Fatalf("translation: %v %q", err, result.Text)
	}
	t.Logf("translated: %+v", rows[0].Sentences)
	follow, err := session.Stream(ctx, GenerateRequest{AIInput{Prompt: "Reply with only the blockId of the paragraph you translated in the previous turn."}}, nil)
	if err != nil || !strings.Contains(follow.Text, "p7-b3") {
		t.Fatalf("session lost the previous batch: %v %q", err, follow.Text)
	}
}

// READER_TEST_DEEPSEEK=1 saves the API agent through HTTP and runs the same
// text and vision checks as Settings.
func TestLiveDeepSeekCapabilityCheck(t *testing.T) {
	key := os.Getenv("DEEPSEEK_API_KEY")
	if os.Getenv("READER_TEST_DEEPSEEK") != "1" || key == "" {
		t.Skip("set READER_TEST_DEEPSEEK=1 and DEEPSEEK_API_KEY")
	}
	s := testServer(t)
	config, _ := json.Marshal(AIConfig{Primary: "api", API: APIConnection{URL: "https://api.deepseek.com", Key: key}, Models: map[string]string{"api": "deepseek-flash"}})
	if w := request(t, s, "PUT", "/api/ai/config", strings.NewReader(string(config))); w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	w := request(t, s, "GET", "/api/ai/models?provider=api", nil)
	t.Logf("models: %d %s", w.Code, w.Body.String())
	w = request(t, s, "POST", "/api/ai/test/api", nil)
	t.Logf("capability: %d %s", w.Code, w.Body.String())
	if !capable(s.aiConfig(), "api", false) {
		t.Fatal("text check failed")
	}
}
