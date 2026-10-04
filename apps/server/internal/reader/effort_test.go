package reader

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestNativeEffortMapping(t *testing.T) {
	for _, tt := range []struct {
		name, provider  string
		supported, want []string
	}{
		{"codex extended", "codex", []string{"low", "medium", "high", "xhigh", "max", "ultra"}, []string{"low", "medium", "high", "max"}},
		{"codex older", "codex", []string{"low", "medium", "high", "xhigh"}, []string{"low", "medium", "high", "xhigh"}},
		{"claude", "claude", []string{"low", "medium", "high", "max"}, []string{"low", "medium", "high", "max"}},
		{"haiku", "claude", nil, []string{"", "", "", ""}},
		{"kimi k3", "kimi", []string{"low", "high", "max"}, []string{"low", "high", "high", "max"}},
		{"kimi k2", "kimi", []string{"off", "on", "high"}, []string{"off", "on", "high", "high"}},
	} {
		t.Run(tt.name, func(t *testing.T) {
			models := []AgentModel{{ID: "model", Default: true, Aliases: []string{"alias"}, SupportedEfforts: tt.supported}}
			for i, level := range []string{"low", "medium", "high", "max"} {
				for _, model := range []string{"model", "alias", ""} {
					if got := nativeEffort(tt.provider, level, model, models); got != tt.want[i] {
						t.Fatalf("%s/%s: got %q want %q", model, level, got, tt.want[i])
					}
				}
			}
		})
	}
}

func TestEffortPersistsAndRejectsNativeOnlyValues(t *testing.T) {
	s := testServer(t)
	c := AIConfig{Primary: "codex", Models: map[string]string{"codex": "model"}, Efforts: map[string]map[string]string{"codex": {"model": "max"}}}
	if r := request(t, s, "PUT", "/api/ai/config", configJSON(c)); r.Code != 200 {
		t.Fatal(r.Body)
	}
	if got := s.aiConfig().Efforts["codex"]["model"]; got != "max" {
		t.Fatal(got)
	}
	// An older settings client omitting the optional field must not erase it.
	c.Efforts = nil
	if r := request(t, s, "PUT", "/api/ai/config", configJSON(c)); r.Code != 200 {
		t.Fatal(r.Body)
	}
	if got := s.aiConfig().Efforts["codex"]["model"]; got != "max" {
		t.Fatal("effort lost", got)
	}
	for _, value := range []string{"xhigh", "ultra", "on", "invalid"} {
		c.Efforts = map[string]map[string]string{"codex": {"model": value}}
		if r := request(t, s, "PUT", "/api/ai/config", configJSON(c)); r.Code != 400 {
			t.Fatalf("accepted %s: %s", value, r.Body)
		}
	}
}

func TestConfiguredEffortReachesProvider(t *testing.T) {
	for _, tt := range []struct {
		provider, level, native string
		supported               []string
	}{
		{"codex", "max", "xhigh", []string{"low", "medium", "high", "xhigh"}},
		{"claude", "high", "high", []string{"low", "medium", "high"}},
		{"kimi", "medium", "on", []string{"off", "on", "high"}},
	} {
		t.Run(tt.provider, func(t *testing.T) {
			fakeAgent(t, tt.provider, "complete")
			capture := filepath.Join(t.TempDir(), "request.json")
			t.Setenv("READER_AGENT_CAPTURE", capture)
			s := testServer(t)
			s.modelCache = map[string]modelCatalogEntry{tt.provider: {models: []AgentModel{{ID: "model", SupportedEfforts: tt.supported}}, expires: time.Now().Add(time.Minute)}}
			c := AIConfig{Models: map[string]string{tt.provider: "model"}, Efforts: map[string]map[string]string{tt.provider: {"model": tt.level}}}
			answer, err := s.invoke(t.Context(), c, tt.provider, AIInput{Prompt: "test"}, nil)
			if err != nil || answer != "你好，世界" {
				t.Fatalf("%s %v", answer, err)
			}
			b, err := os.ReadFile(capture)
			if err != nil {
				t.Fatal(err)
			}
			if tt.provider == "claude" {
				if !strings.Contains(string(b), "--effort "+tt.native) {
					t.Fatal(string(b))
				}
				return
			}
			var params map[string]any
			if err = json.Unmarshal(b, &params); err != nil {
				t.Fatal(err)
			}
			if tt.provider == "codex" && params["effort"] != tt.native {
				t.Fatal(string(b))
			}
			if tt.provider == "kimi" && (params["configId"] != "thinking" || params["value"] != tt.native || params["sessionId"] != "session") {
				t.Fatal(string(b))
			}
		})
	}
}

func TestDecodeEffortCapabilities(t *testing.T) {
	for _, tt := range []struct{ provider, raw string }{
		{"codex", `{"data":[{"model":"test","defaultReasoningEffort":"medium","supportedReasoningEfforts":[{"reasoningEffort":"low"},{"reasoningEffort":"high"}]}]}`},
		{"claude", `{"models":[{"value":"test","supportsEffort":true,"supportedEffortLevels":["low","high"]}]}`},
	} {
		models, err := decodeAgentModels(tt.provider, json.RawMessage(tt.raw))
		if err != nil || len(models) != 1 || len(models[0].SupportedEfforts) != 2 {
			t.Fatalf("%+v %v", models, err)
		}
	}
	values, current := kimiEfforts(json.RawMessage(`{"configOptions":[{"id":"thinking","currentValue":"high","options":[{"value":"low"},{"value":"high"},{"value":"max"}]}]}`))
	if len(values) != 3 || current != "high" {
		t.Fatalf("%v %s", values, current)
	}
}

func configJSON(c AIConfig) *bytes.Reader { b, _ := json.Marshal(c); return bytes.NewReader(b) }
