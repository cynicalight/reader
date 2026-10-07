package reader

import (
	"context"
	"os"
	"path/filepath"
)

const translationCodexModel = "gpt-5.6-luna"
const translationCodexEffort = "low"

// Owned by a single sequential translation run, independently of chat sessions.
// Failed turns discard the connection; a later batch can start a fresh thread.
type translationCodexAdapter struct {
	root, work string
	session    *codexSession
}

func (a *translationCodexAdapter) close() {
	if a.session != nil {
		a.session.close()
		a.session = nil
	}
	if a.work != "" {
		_ = os.RemoveAll(a.work)
		a.work = ""
	}
}

func (s *Server) translationService(config AIConfig) (*GenerationService, *translationCodexAdapter) {
	// Keep the user's selected chat model untouched. Track failures against the
	// translation model so they cannot invalidate another model's saved probe.
	ready := capable(config, "codex", false)
	models := make(map[string]string, len(config.Models)+1)
	for provider, model := range config.Models {
		models[provider] = model
	}
	models["codex"] = translationCodexModel
	config.Models = models
	service := s.generationService(config)
	adapter := &translationCodexAdapter{root: s.Store.Root}
	connection := service.connections["codex"]
	connection.Adapter = adapter
	// Preserve the existing CLI text-readiness gate without recording a
	// synthetic capability test for the translation model.
	connection.VerifiedText = ready
	service.connections["codex"] = connection
	service.timeout = translationBatchTimeout
	return service, adapter
}

func (a *translationCodexAdapter) Stream(ctx context.Context, req GenerateRequest, emit func(ProviderEvent) error) (GenerateResult, error) {
	if err := ctx.Err(); err != nil {
		return GenerateResult{}, err
	}
	if a.session == nil {
		work, err := os.MkdirTemp(filepath.Join(a.root, "ai-work"), "translation-")
		if err != nil {
			return GenerateResult{}, generationError(ErrorConfiguration, "无法创建隔离的翻译工作目录")
		}
		a.work = work
		a.session, err = newCodexSession(work, translationCodexModel)
		if err != nil {
			a.close()
			return GenerateResult{}, err
		}
	}
	req.Input.Effort = translationCodexEffort
	child, cancel := context.WithCancel(ctx)
	defer cancel()
	var emitErr error
	send := func(event ProviderEvent) {
		if emitErr == nil && emit != nil {
			emitErr = emit(event)
			if emitErr != nil {
				cancel()
			}
		}
	}
	text, err := a.session.generate(child, req.Input,
		func(part string) { send(ProviderEvent{Text: part}) },
		func(metrics []ModelTokens) { send(ProviderEvent{Metrics: metrics}) })
	if emitErr != nil {
		err = emitErr
	}
	if err != nil {
		a.close()
		return GenerateResult{}, err
	}
	return GenerateResult{Text: text, FinishReason: "stop"}, nil
}
