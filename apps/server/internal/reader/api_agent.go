package reader

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"slices"
	"strings"
	"unicode/utf8"
)

// The "api" agent calls an OpenAI-compatible Chat Completions endpoint with a
// user-supplied key. Its models come from /models plus IDs the user adds, and
// each model is checked separately for text and vision. Requests use only
// models that passed: text requests the task's model, image requests the
// vision model. Effort is sent only when the model advertises it.
type apiAgentAdapter struct {
	conn         APIConnection
	text, vision apiModelChoice
	task         modelTask
	// catalog lists the endpoint's models with this snapshot's check results.
	catalog func(context.Context) ([]AgentModel, error)
}

// An empty model picks the recommended model among those that passed.
type apiModelChoice struct{ model, level string }

func apiCapabilityKey(model string) string { return "api:" + model }

// apiTaskModel is the user's choice for a task; empty means automatic.
func apiTaskModel(c AIConfig, task modelTask, vision bool) string {
	if vision {
		return c.VisionModels["api"]
	}
	if task == taskTranslation {
		return c.TranslationModels["api"]
	}
	return c.Models["api"]
}

// apiCapable reports whether the API agent can serve a task: the chosen model
// passed its check or, with no choice, some checked model passed.
func apiCapable(c AIConfig, task modelTask, vision bool) bool {
	if model := apiTaskModel(c, task, vision); model != "" {
		return capable(c, apiCapabilityKey(model), vision)
	}
	for key := range c.Capabilities {
		if strings.HasPrefix(key, "api:") && capable(c, key, vision) {
			return true
		}
	}
	return false
}

// primaryCapable reports whether the primary agent passed the text check
// for a task. Only the API agent picks models by its own per-model checks.
func primaryCapable(c AIConfig, task modelTask) bool {
	if c.Primary == "api" {
		return apiCapable(c, task, false)
	}
	return capable(c, c.Primary, false)
}

func (s *Server) apiAgentAdapter(c AIConfig, task modelTask) apiAgentAdapter {
	models, efforts := c.Models, c.Efforts
	if task == taskTranslation {
		models, efforts = c.TranslationModels, c.TranslationEfforts
	}
	choice := func(models map[string]string, efforts map[string]map[string]string) apiModelChoice {
		model := models["api"]
		level := efforts["api"][model]
		if level == "" {
			level = "medium"
		}
		return apiModelChoice{model, level}
	}
	return apiAgentAdapter{c.API, choice(models, efforts), choice(c.VisionModels, c.VisionEfforts), task, func(ctx context.Context) ([]AgentModel, error) {
		return s.apiAgentModels(ctx, c)
	}}
}

// resolve fixes the model and native effort for one request. A chosen model
// still works when the catalog is unavailable; only effort is then omitted.
func (a apiAgentAdapter) resolve(ctx context.Context, vision bool) (completionRequest, error) {
	if e := validateAgentAPI(a.conn); e != nil {
		return completionRequest{}, generationError(ErrorConfiguration, e.Error())
	}
	if a.conn.URL == "" {
		return completionRequest{}, generationError(ErrorConfiguration, "请在设置中填写 API 地址")
	}
	choice, task := a.text, a.task
	if vision {
		choice, task = a.vision, taskVision
	}
	req := completionRequest{Model: choice.model}
	models, err := a.catalog(ctx)
	if err != nil {
		if req.Model == "" {
			return req, err
		}
		return req, nil
	}
	for _, m := range models {
		if req.Model == "" && slices.Contains(m.RecommendedFor, string(task)) {
			req.Model = m.ID
		}
	}
	if req.Model == "" {
		if vision {
			return req, generationError(ErrorCapability, "没有通过图片理解检测的 API 模型")
		}
		return req, generationError(ErrorCapability, "没有通过文本推理检测的 API 模型")
	}
	for _, m := range models {
		if m.ID == req.Model && len(m.SupportedEfforts) > 0 && choice.level != "" {
			req.Effort = nativeEffort("api", choice.level, m.ID, models)
		}
	}
	return req, nil
}

func (a apiAgentAdapter) Stream(ctx context.Context, req GenerateRequest, emit func(ProviderEvent) error) (GenerateResult, error) {
	completion, err := a.resolve(ctx, len(req.Input.images()) > 0)
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
	completion, err := s.resolve(ctx, len(req.Input.images()) > 0)
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
func (s *Server) apiCatalog(c APIConnection) func(context.Context) ([]AgentModel, error) {
	sum := sha256.Sum256([]byte(c.URL + "\x00" + c.Key))
	key := "api:" + hex.EncodeToString(sum[:])
	return func(ctx context.Context) ([]AgentModel, error) {
		return s.cachedCatalog(ctx, key, func(ctx context.Context) ([]AgentModel, error) {
			return discoverAPIModels(ctx, c)
		})
	}
}

// apiAgentModels lists the endpoint's models and the user's added IDs, each
// with its current check result. Recommendations consider only models that
// passed what the task needs. Added IDs still list when /models fails.
func (s *Server) apiAgentModels(ctx context.Context, c AIConfig) ([]AgentModel, error) {
	listed, err := s.apiCatalog(c.API)(ctx)
	models := append([]AgentModel{}, listed...)
	for _, id := range c.APIModels {
		if !slices.ContainsFunc(models, func(m AgentModel) bool { return m.ID == id }) {
			models = append(models, AgentModel{ID: id, Name: id, Custom: true})
		}
	}
	if len(models) == 0 {
		if err == nil {
			err = errors.New("API 未返回可用模型")
		}
		return nil, err
	}
	for i := range models {
		key := apiCapabilityKey(models[i].ID)
		if result, ok := c.Capabilities[key]; ok && result.Fingerprint == configPrint(c, key) {
			models[i].Capability = &result
		}
	}
	for _, task := range []modelTask{taskChat, taskTranslation, taskVision} {
		passed := []AgentModel{}
		for _, m := range models {
			if m.Capability != nil && m.Capability.Text && (task != taskVision || m.Capability.Vision) {
				passed = append(passed, m)
			}
		}
		if len(passed) == 0 {
			continue
		}
		id := defaultTaskModel(task, "api", passed)
		if id == "" {
			id = passed[0].ID
		}
		for i := range models {
			if models[i].ID == id {
				models[i].RecommendedFor = append(models[i].RecommendedFor, string(task))
			}
		}
	}
	return models, nil
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
