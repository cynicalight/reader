package reader

import (
	"context"
	"time"
)

type modelCatalogEntry struct {
	models  []AgentModel
	expires time.Time
}

// Reuse metadata already loaded by the picker. Never hold a lock while a CLI
// starts; canceled callers should not block another conversation.
func (s *Server) modelCatalog(ctx context.Context, provider string) ([]AgentModel, error) {
	s.modelMu.Lock()
	entry, ok := s.modelCache[provider]
	s.modelMu.Unlock()
	if ok && time.Now().Before(entry.expires) {
		return entry.models, nil
	}
	ctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	models, err := discoverModels(ctx, s.Store.Root, provider)
	if err != nil {
		return nil, err
	}
	s.modelMu.Lock()
	if s.modelCache == nil {
		s.modelCache = map[string]modelCatalogEntry{}
	}
	s.modelCache[provider] = modelCatalogEntry{models: models, expires: time.Now().Add(5 * time.Minute)}
	s.modelMu.Unlock()
	return models, nil
}

// Reader exposes exactly four levels. Provider-specific values remain inside
// this adapter. Prefer the same semantic level; clamp to the closest supported
// tier when a model has fewer controls. Ultra is a delegation mode, not Max.
func nativeEffort(provider, level, modelID string, models []AgentModel) string {
	var selected *AgentModel
	for i := range models {
		m := &models[i]
		matches := m.ID == modelID || (modelID == "" && m.Default)
		for _, alias := range m.Aliases {
			matches = matches || alias == modelID
		}
		if matches {
			selected = m
			break
		}
	}
	preferences := map[string][]string{
		"low":    {"low", "minimal", "none", "off", "on", "medium", "high"},
		"medium": {"medium", "on", "high", "low", "minimal"},
		"high":   {"high", "xhigh", "max", "medium", "on", "low"},
		"max":    {"max", "xhigh", "high", "medium", "on", "low"},
	}
	if selected == nil {
		// Custom model IDs have no advertised capabilities. Use the SDK's common
		// vocabulary and let it report an unsupported configuration explicitly.
		if provider == "kimi" && level == "medium" {
			return "high"
		}
		return level
	}
	for _, candidate := range preferences[level] {
		for _, supported := range selected.SupportedEfforts {
			if supported == candidate {
				return candidate
			}
		}
	}
	// Models such as Haiku expose no reasoning control: omit the parameter.
	return ""
}
