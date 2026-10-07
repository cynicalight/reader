package reader

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func catalog(ids ...string) []AgentModel {
	models := []AgentModel{}
	for i, id := range ids {
		models = append(models, AgentModel{ID: id, Name: id, Default: i == 0})
	}
	return models
}

func TestDefaultTaskModelPerAgent(t *testing.T) {
	codex := catalog("gpt-6.1-sol", "gpt-6-astra", "gpt-6-sol", "gpt-6-luna", "gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna")
	claude := catalog("claude-opus-5-5", "claude-sonnet-5-5", "claude-fable-5-1", "claude-haiku-4-5-20251001", "claude-sonnet-5", "claude-opus-5", "claude-fable-5", "claude-opus-4-8", "claude-sonnet-4-6")
	claude[1].Aliases = []string{"sonnet"}
	kimi := catalog("moonshot-cn/kimi-k3", "moonshot-cn/kimi-k2.7-code")
	for _, tt := range []struct {
		name     string
		task     modelTask
		provider string
		models   []AgentModel
		want     string
	}{
		{"codex chat takes the newest sol, never astra", taskChat, "codex", codex, "gpt-6.1-sol"},
		{"codex translation takes the newest luna", taskTranslation, "codex", codex, "gpt-6-luna"},
		{"claude chat takes the newest opus, never fable", taskChat, "claude", claude, "claude-opus-5-5"},
		{"claude translation takes the newest sonnet", taskTranslation, "claude", claude, "claude-sonnet-5-5"},
		{"claude translation falls back to haiku", taskTranslation, "claude", catalog("claude-opus-5-5", "claude-haiku-4-5-20251001", "claude-haiku-3-5"), "claude-haiku-4-5-20251001"},
		{"kimi keeps its CLI default", taskChat, "kimi", kimi, ""},
		{"kimi has no fast tier", taskTranslation, "kimi", kimi, ""},
		{"kimi flash tier", taskTranslation, "kimi", catalog("kimi-k3", "kimi-k3-flash"), "kimi-k3-flash"},
		{"general beats code variant", taskTranslation, "codex", catalog("gpt-7-codex-mini", "gpt-6-mini"), "gpt-6-mini"},
		{"whole tokens only", taskTranslation, "codex", catalog("gemini-pro", "lunar-x"), ""},
		{"empty catalog", taskChat, "claude", nil, ""},
	} {
		t.Run(tt.name, func(t *testing.T) {
			if got := defaultTaskModel(tt.task, tt.provider, tt.models); got != tt.want {
				t.Fatalf("got %q want %q", got, tt.want)
			}
		})
	}
}

func TestTaskRecommendationsMarkCatalog(t *testing.T) {
	models := taskRecommendations("claude", catalog("claude-opus-5-5", "claude-sonnet-5-5", "claude-fable-5-1"))
	got := map[string]string{}
	for _, m := range models {
		got[m.ID] = strings.Join(m.RecommendedFor, ",")
	}
	if got["claude-opus-5-5"] != "chat" || got["claude-sonnet-5-5"] != "translation" || got["claude-fable-5-1"] != "" {
		t.Fatal(got)
	}
}

func TestTranslationModelAndEffortAreIndependent(t *testing.T) {
	s := testServer(t)
	c := AIConfig{Primary: "claude", Models: map[string]string{"claude": "chat-model"}, Efforts: map[string]map[string]string{"claude": {"chat-model": "max"}},
		TranslationModels: map[string]string{"claude": "fast-model"}, TranslationEfforts: map[string]map[string]string{"claude": {"fast-model": "low"}}}
	if r := request(t, s, "PUT", "/api/ai/config", configJSON(c)); r.Code != 200 {
		t.Fatal(r.Body)
	}
	// An older client that omits translation fields must not erase them.
	c.TranslationModels, c.TranslationEfforts = nil, nil
	if r := request(t, s, "PUT", "/api/ai/config", configJSON(c)); r.Code != 200 {
		t.Fatal(r.Body)
	}
	saved := s.aiConfig()
	if saved.TranslationModels["claude"] != "fast-model" || saved.TranslationEfforts["claude"]["fast-model"] != "low" || saved.Efforts["claude"]["chat-model"] != "max" {
		t.Fatalf("%+v", saved)
	}
	c.TranslationEfforts = map[string]map[string]string{"claude": {"fast-model": "ultra"}}
	if r := request(t, s, "PUT", "/api/ai/config", configJSON(c)); r.Code != 400 {
		t.Fatal(r.Body)
	}
}

func TestUnsetModelsResolvePerTask(t *testing.T) {
	efforts := []string{"low", "medium", "high", "max"}
	for _, tt := range []struct {
		task       modelTask
		model, eff string
	}{
		{taskChat, "claude-opus-5-5", "medium"},
		{taskTranslation, "claude-sonnet-5-5", "medium"},
	} {
		t.Run(string(tt.task), func(t *testing.T) {
			fakeAgent(t, "claude", "complete")
			capture := filepath.Join(t.TempDir(), "request.json")
			t.Setenv("READER_AGENT_CAPTURE", capture)
			s, _ := imageFixture(t)
			models := catalog("claude-opus-5-5", "claude-sonnet-5-5", "claude-fable-5-1")
			for i := range models {
				models[i].SupportedEfforts = efforts
			}
			s.modelCache = map[string]modelCatalogEntry{"claude": {models: models, expires: time.Now().Add(time.Minute)}}
			c := AIConfig{Primary: "claude", Models: map[string]string{}, Capabilities: map[string]Capability{}}
			c.Capabilities["claude"] = Capability{Text: true, Fingerprint: configPrint(c, "claude")}
			if _, err := s.taskGenerationService(c, tt.task).Generate(t.Context(), AIInput{Prompt: "test"}, false, nil); err != nil {
				t.Fatal(err)
			}
			b, err := os.ReadFile(capture)
			if err != nil {
				t.Fatal(err)
			}
			if !strings.Contains(string(b), "--model "+tt.model) || !strings.Contains(string(b), "--effort "+tt.eff) {
				t.Fatal(string(b))
			}
		})
	}
}

func TestTranslationFailureKeepsChatCapability(t *testing.T) {
	s := testServer(t)
	c := AIConfig{Primary: "claude", Models: map[string]string{}, Capabilities: map[string]Capability{}}
	c.Capabilities["claude"] = Capability{Text: true, CheckedAt: "t", Fingerprint: configPrint(c, "claude")}
	if err := s.writeAIConfig(c); err != nil {
		t.Fatal(err)
	}
	s.taskGenerationService(c, taskTranslation).attemptFailed("claude", false, errors.New("unknown model"))
	if !capable(s.aiConfig(), "claude", false) {
		t.Fatal("translation failure disabled chat")
	}
	s.taskGenerationService(c, taskChat).attemptFailed("claude", false, errors.New("unknown model"))
	if capable(s.aiConfig(), "claude", false) {
		t.Fatal("chat failure was not recorded")
	}
}
