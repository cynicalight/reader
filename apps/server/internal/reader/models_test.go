package reader

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestDecodeAgentModels(t *testing.T) {
	for _, test := range []struct{ provider, raw, id string }{
		{"codex", `{"data":[{"model":"hidden","hidden":true},{"model":"gpt-model","displayName":"GPT Model","isDefault":true}]}`, "gpt-model"},
		{"claude", `{"models":[{"value":"default","resolvedModel":"claude-test"},{"value":"sonnet","resolvedModel":"claude-test","displayName":"Sonnet"}]}`, "claude-test"},
		{"kimi", `{"configOptions":[{"id":"model","category":"model","currentValue":"kimi-test","options":[{"value":"kimi-test","name":"Kimi"}]}]}`, "kimi-test"},
		{"kimi", `{"models":{"currentModelId":"kimi-old","availableModels":[{"modelId":"kimi-old","name":"Kimi"}]}}`, "kimi-old"},
	} {
		t.Run(test.provider+test.id, func(t *testing.T) {
			models, err := decodeAgentModels(test.provider, json.RawMessage(test.raw))
			if err != nil || len(models) != 1 || models[0].ID != test.id || !models[0].Default {
				t.Fatalf("unexpected models: %+v, %v", models, err)
			}
			if test.provider == "claude" && models[0].Aliases[0] != "sonnet" {
				t.Fatal("lost configured alias")
			}
		})
	}
	if _, err := decodeAgentModels("kimi", json.RawMessage(`{}`)); err == nil {
		t.Fatal("empty catalog must report failure")
	}
}

func TestDiscoverModelsProtocol(t *testing.T) {
	// The fake CLI rejects generation requests and verifies its isolated cwd.
	for _, provider := range []string{"codex", "claude", "kimi"} {
		t.Run(provider, func(t *testing.T) {
			s := testServer(t)
			fakeAgent(t, provider, "models")
			ctx, cancel := context.WithTimeout(t.Context(), 3*time.Second)
			defer cancel()
			models, err := discoverModels(ctx, s.Store.Root, provider)
			if err != nil || len(models) != 1 || models[0].ID != "model-a" {
				t.Fatalf("models %+v: %v", models, err)
			}
			files, err := os.ReadDir(filepath.Join(s.Store.Root, "ai-work"))
			if err != nil || len(files) != 0 {
				t.Fatalf("discovery workdir leaked: %v", err)
			}
			response := request(t, s, "GET", "/api/ai/models?provider="+provider, nil)
			if response.Code != 200 || !strings.Contains(response.Body.String(), "model-a") {
				t.Fatalf("HTTP discovery failed: %s", response.Body)
			}
		})
	}
}

func TestModelDiscoveryRejectsUnknownProviderAndCancels(t *testing.T) {
	s := testServer(t)
	if r := request(t, s, "GET", "/api/ai/models?provider=invalid", nil); r.Code != 400 {
		t.Fatal(r.Code)
	}
	fakeAgent(t, "codex", "models-wait")
	ctx, cancel := context.WithTimeout(t.Context(), 50*time.Millisecond)
	defer cancel()
	started := time.Now()
	if _, err := discoverModels(ctx, s.Store.Root, "codex"); err == nil {
		t.Fatal("expected cancellation")
	}
	if time.Since(started) > 2*time.Second {
		t.Fatal("CLI did not stop after cancellation")
	}
}
