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
)

// Families are ordered by preference for each task. Chat prefers the most
// capable tier; translation prefers the fast tier with acceptable quality.
// Kimi names carry no tier for chat, so its CLI default (the flagship) stays.
// Matching uses whole tokens, so "mini" never matches "gemini".
var taskFamilies = map[modelTask]map[string][]string{
	taskChat: {
		"codex": {"astra", "sol", "terra"},
		// Fable is usually unavailable, so it is never a default; users can still pick it.
		"claude": {"opus", "sonnet"},
	},
	taskTranslation: {
		"codex":  {"luna", "mini", "terra"},
		"claude": {"sonnet", "haiku"},
		"kimi":   {"flash", "turbo", "lite", "mini"},
		"":       {"luna", "sonnet", "flash", "mini", "lite", "haiku"},
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

// Versions come from the ID: claude-sonnet-5-5 → 5.5, gpt-5.6-luna → 5.6.
// Date snapshots such as -20251001 are not versions.
func modelVersion(id string) []int {
	var version []int
	for _, match := range modelVersionPattern.FindAllString(id, -1) {
		for _, part := range strings.FieldsFunc(match, func(r rune) bool { return r == '.' || r == '-' }) {
			if len(part) >= 6 {
				return version
			}
			n, _ := strconv.Atoi(part)
			version = append(version, n)
		}
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
