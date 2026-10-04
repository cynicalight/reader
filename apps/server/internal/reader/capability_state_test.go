package reader

import (
	"context"
	"errors"
	"testing"
)

func TestRuntimeFailurePersistsCapability(t *testing.T) {
	for _, mode := range []string{"text", "vision", "canceled", "consumer", "new-model", "new-check", "fallback"} {
		t.Run(mode, func(t *testing.T) {
			store, err := OpenStore(t.TempDir())
			if err != nil {
				t.Fatal(err)
			}
			defer store.DB.Close()
			s := NewServer(store, "test", "")
			c := AIConfig{Primary: "codex", Models: map[string]string{"codex": "model-a"}, Capabilities: map[string]Capability{}}
			c.Capabilities["codex"] = Capability{Text: true, Vision: true, CheckedAt: "initial", Fingerprint: configPrint(c, "codex")}
			if err := s.writeAIConfig(c); err != nil {
				t.Fatal(err)
			}
			g := s.generationService(c)
			ctx, cancel := context.WithCancel(t.Context())
			defer cancel()
			connection := g.connections["codex"]
			connection.Adapter = adapterFunc(func(_ context.Context, _ GenerateRequest, emit func(ProviderEvent) error) (GenerateResult, error) {
				if mode == "canceled" {
					cancel()
				}
				if mode == "consumer" {
					_ = emit(ProviderEvent{Text: "partial"})
				}
				if mode == "new-model" || mode == "new-check" {
					latest := s.aiConfig()
					if mode == "new-model" {
						latest.Models["codex"] = "model-b"
					} else {
						cap := latest.Capabilities["codex"]
						cap.CheckedAt = "newer"
						latest.Capabilities["codex"] = cap
					}
					if err := s.writeAIConfig(latest); err != nil {
						t.Fatal(err)
					}
				}
				return GenerateResult{}, errors.New("provider unavailable")
			})
			g.connections["codex"] = connection
			if mode == "fallback" {
				g.connections["text-api"] = generationConnection{VerifiedText: true, Adapter: adapterFunc(func(_ context.Context, _ GenerateRequest, emit func(ProviderEvent) error) (GenerateResult, error) {
					_ = emit(ProviderEvent{Text: "backup"})
					return GenerateResult{"backup", "stop"}, nil
				})}
			}
			input := AIInput{Prompt: "test"}
			if mode == "vision" {
				input.Image = []byte{1}
			}
			_, err = g.Generate(ctx, input, true, func(ProviderEvent) error {
				if mode == "consumer" {
					return errors.New("client disconnected")
				}
				return nil
			})
			if mode == "fallback" && err != nil {
				t.Fatal(err)
			}
			saved := NewServer(store, "test", "").aiConfig().Capabilities["codex"]
			shouldFail := mode == "text" || mode == "vision" || mode == "fallback"
			if shouldFail {
				if saved.Vision || saved.Error != "provider unavailable" || saved.CheckedAt == "initial" {
					t.Fatalf("failure not persisted: %+v", saved)
				}
				if saved.Text != (mode == "vision") {
					t.Fatalf("wrong text capability: %+v", saved)
				}
			} else if !saved.Text || !saved.Vision || saved.Error != "" {
				t.Fatalf("unrelated cancellation or stale request changed capability: %+v", saved)
			}
		})
	}
}
