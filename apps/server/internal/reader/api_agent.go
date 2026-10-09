package reader

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"strings"
	"unicode/utf8"
)

// The "api" agent calls an OpenAI-compatible Chat Completions endpoint with a
// user-supplied key. It sits beside the CLI agents: models are chosen per task
// from the endpoint's /models list, and effort is sent only when advertised.
type apiAgentAdapter struct {
	conn    APIConnection
	model   string // Empty picks the task default from the catalog.
	level   string // Reader effort level; empty omits reasoning_effort.
	task    modelTask
	catalog func(context.Context, string) ([]AgentModel, error)
}

// resolve fixes the model and native effort for one request. A chosen model
// still works when the catalog is unavailable; only effort is then omitted.
func (a apiAgentAdapter) resolve(ctx context.Context) (completionRequest, error) {
	if e := validateAgentAPI(a.conn); e != nil {
		return completionRequest{}, generationError(ErrorConfiguration, e.Error())
	}
	if a.conn.URL == "" {
		return completionRequest{}, generationError(ErrorConfiguration, "请在设置中填写 API 地址")
	}
	req := completionRequest{Model: a.model}
	models, err := a.catalog(ctx, "api")
	if err != nil {
		if req.Model == "" {
			return req, err
		}
		return req, nil
	}
	if req.Model == "" {
		req.Model = defaultTaskModel(a.task, "api", models)
	}
	if req.Model == "" {
		req.Model = models[0].ID
	}
	for _, m := range models {
		if m.ID == req.Model && len(m.SupportedEfforts) > 0 && a.level != "" {
			req.Effort = nativeEffort("api", a.level, m.ID, models)
		}
	}
	return req, nil
}

func (a apiAgentAdapter) Stream(ctx context.Context, req GenerateRequest, emit func(ProviderEvent) error) (GenerateResult, error) {
	completion, err := a.resolve(ctx)
	if err != nil {
		return GenerateResult{}, err
	}
	return streamCompletion(ctx, a.conn, completion, req.Input, emit)
}

// History beyond this size is trimmed from the oldest turns, down to half of
// it, so most batches reuse the provider's cached prompt prefix. One batch
// round trip is roughly 40–60 KB, so the budget keeps several recent batches
// and fits a 128K-token context window.
const apiTranslationHistoryBytes = 256 << 10

// apiTranslationSession keeps one conversation across the batches of a
// translation worker, like the Codex thread does. A failed turn is not
// recorded and the earlier history is kept for the next batch.
type apiTranslationSession struct {
	apiAgentAdapter
	history []completionMessage
	size    int
}

func (s *apiTranslationSession) Stream(ctx context.Context, req GenerateRequest, emit func(ProviderEvent) error) (GenerateResult, error) {
	completion, err := s.resolve(ctx)
	if err != nil {
		return GenerateResult{}, err
	}
	completion.History = s.history
	result, err := streamCompletion(ctx, s.conn, completion, req.Input, emit)
	if err != nil {
		return result, err
	}
	s.record(req.Input.Prompt, result.Text)
	return result, nil
}

func (s *apiTranslationSession) record(prompt, answer string) {
	s.history = append(s.history, completionMessage{"user", prompt}, completionMessage{"assistant", answer})
	s.size += len(prompt) + len(answer)
	if s.size <= apiTranslationHistoryBytes {
		return
	}
	// Keep at least the latest turn, even when it alone exceeds the budget.
	for len(s.history) > 2 && s.size > apiTranslationHistoryBytes/2 {
		s.size -= len(s.history[0].Content.(string)) + len(s.history[1].Content.(string))
		s.history = s.history[2:]
	}
}

func (s *apiTranslationSession) close() {
	s.history, s.size = nil, 0
}

// apiCatalog binds model discovery to one endpoint snapshot. The cache key
// covers the URL and key, so an edited connection never reuses another list.
func (s *Server) apiCatalog(c APIConnection) func(context.Context, string) ([]AgentModel, error) {
	sum := sha256.Sum256([]byte(c.URL + "\x00" + c.Key))
	key := "api:" + hex.EncodeToString(sum[:])
	return func(ctx context.Context, _ string) ([]AgentModel, error) {
		return s.cachedCatalog(ctx, key, func(ctx context.Context) ([]AgentModel, error) {
			return discoverAPIModels(ctx, c)
		})
	}
}

func discoverAPIModels(ctx context.Context, c APIConnection) ([]AgentModel, error) {
	if e := validateAgentAPI(c); e != nil {
		return nil, generationError(ErrorConfiguration, e.Error())
	}
	response, err := apiRequest(ctx, c, "GET", "/models", nil)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	body, err := io.ReadAll(io.LimitReader(response.Body, 4<<20))
	if err != nil {
		return nil, generationError(ErrorNetwork, "API 模型列表读取失败")
	}
	return decodeAPIModels(body)
}

// Only id is standard. Name and effort levels are optional provider extensions.
func decodeAPIModels(body []byte) ([]AgentModel, error) {
	var result struct {
		Data []struct {
			ID     string `json:"id"`
			Name   string `json:"name"`
			Effort struct {
				Levels  []string `json:"supported_levels"`
				Default string   `json:"default_level"`
			} `json:"effort"`
		} `json:"data"`
	}
	if !utf8.Valid(body) || json.Unmarshal(body, &result) != nil {
		return nil, generationError(ErrorProtocol, "API 模型列表格式无效")
	}
	seen := map[string]bool{}
	models := []AgentModel{}
	for _, m := range result.Data {
		id := strings.TrimSpace(m.ID)
		if id == "" || seen[id] {
			continue
		}
		seen[id] = true
		name := strings.TrimSpace(m.Name)
		if name == "" {
			name = id
		}
		models = append(models, AgentModel{ID: id, Name: name, SupportedEfforts: m.Effort.Levels, DefaultEffort: m.Effort.Default})
	}
	if len(models) == 0 {
		return nil, errors.New("API 未返回可用模型")
	}
	return models, nil
}
