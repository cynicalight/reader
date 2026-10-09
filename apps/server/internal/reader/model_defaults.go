package reader

import (
	"regexp"
	"strconv"
	"strings"
)

type modelTask string

const (
	taskChat        modelTask = "chat"
	taskTranslation modelTask = "translation"
	// Only the API agent picks a separate model for image input.
	taskVision modelTask = "vision"
)

// Families are ordered by preference for each task. Chat prefers the most
// capable everyday tier; translation prefers the fast tier with acceptable quality.
// Kimi names carry no tier for chat, so its CLI default (the flagship) stays.
// Matching uses whole tokens, so "mini" never matches "gemini".
var taskFamilies = map[modelTask]map[string][]string{
	taskChat: {
		// Astra is too expensive and Fable is usually unavailable, so neither
		// is a default; users can still pick them.
		"codex":  {"sol", "terra"},
		"claude": {"opus", "sonnet"},
		// API endpoints without a matching tier fall back to their first model.
		"api": {"pro", "max", "plus"},
	},
	taskTranslation: {
		"codex":  {"luna", "mini", "terra"},
		"claude": {"sonnet", "haiku"},
		"kimi":   {"flash", "turbo", "lite", "mini"},
		"api":    {"flash", "turbo", "lite", "mini"},
		"":       {"luna", "sonnet", "flash", "mini", "lite", "haiku"},
	},
	taskVision: {
		"api": {"vl", "vision", "flash", "omni"},
	},
}

var (
	modelTokenPattern   = regexp.MustCompile(`[a-z]+|\d+(?:\.\d+)*`)
	modelVersionPattern = regexp.MustCompile(`\d+(?:[.-]\d+)*`)
)

func modelTokens(m AgentModel) map[string]bool {
	tokens := map[string]bool{}
	for _, text := range append([]string{m.ID, m.Name}, m.Aliases...) {
		for _, token := range modelTokenPattern.FindAllString(strings.ToLower(text), -1) {
			tokens[token] = true
		}
	}
	return tokens
}

// The generation is the first numeric run in the ID, compared part by part:
// gpt-6.1-sol → 6.1 beats gpt-6-sol → 6, and 6.10 beats 6.9. Later numbers
// and date snapshots (-20251001, -2026-01-15) never count as a newer version.
func modelVersion(id string) []int {
	match := modelVersionPattern.FindString(id)
	var version []int
	for _, part := range strings.FieldsFunc(match, func(r rune) bool { return r == '.' || r == '-' }) {
		if len(part) >= 4 {
			break
		}
		n, _ := strconv.Atoi(part)
		version = append(version, n)
	}
	return version
}

func newerVersion(a, b []int) bool {
	for i := 0; i < len(a) && i < len(b); i++ {
		if a[i] != b[i] {
			return a[i] > b[i]
		}
	}
	return len(a) > len(b)
}

// defaultTaskModel resolves an unset model choice from the live catalog.
// Within the first matching family, general models beat code-specialized
// variants and newer versions beat older ones; catalog order breaks ties.
// No match returns "" so the CLI keeps its own default.
func defaultTaskModel(task modelTask, provider string, models []AgentModel) string {
	families := append(append([]string{}, taskFamilies[task][provider]...), taskFamilies[task][""]...)
	for _, family := range families {
		var best *AgentModel
		bestCode := false
		var bestVersion []int
		for i := range models {
			tokens := modelTokens(models[i])
			if !tokens[family] {
				continue
			}
			code := tokens["code"] || tokens["codex"] || tokens["coder"]
			version := modelVersion(models[i].ID)
			if best == nil || bestCode && !code || bestCode == code && newerVersion(version, bestVersion) {
				best, bestCode, bestVersion = &models[i], code, version
			}
		}
		if best != nil {
			return best.ID
		}
	}
	return ""
}

func taskRecommendations(provider string, models []AgentModel) []AgentModel {
	out := append([]AgentModel{}, models...)
	for _, task := range []modelTask{taskChat, taskTranslation} {
		id := defaultTaskModel(task, provider, out)
		for i := range out {
			if out[i].ID == id {
				out[i].RecommendedFor = append(append([]string{}, out[i].RecommendedFor...), string(task))
			}
		}
	}
	return out
}
