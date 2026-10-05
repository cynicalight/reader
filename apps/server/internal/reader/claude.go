package reader

import "encoding/json"

func claudeArgs() []string {
	// Let the CLI resolve user-managed API keys, gateways and model defaults.
	// Safe mode still disables customizations; project/local settings and tools
	// remain excluded from document requests. Reader never reads credentials.
	return []string{"-p", "--safe-mode", "--output-format", "stream-json", "--verbose", "--include-partial-messages", "--tools", "", "--strict-mcp-config", "--mcp-config", "{\"mcpServers\":{}}", "--setting-sources", "user", "--disable-slash-commands", "--no-session-persistence"}
}

// Only top-level assistant text crosses the provider boundary. The assistant
// snapshot and final result repeat earlier deltas and must not be appended.
func claudeEvent(line []byte) (text string, completed, failed bool) {
	var e struct {
		Type            string          `json:"type"`
		Subtype         string          `json:"subtype"`
		IsError         bool            `json:"is_error"`
		ParentToolUseID *string         `json:"parent_tool_use_id"`
		Event           json.RawMessage `json:"event"`
	}
	if json.Unmarshal(line, &e) != nil {
		return "", false, true
	}
	if e.ParentToolUseID != nil && *e.ParentToolUseID != "" {
		return "", false, false
	}
	if e.IsError || e.Type == "error" || (e.Type == "result" && e.Subtype != "success") {
		return "", false, true
	}
	if e.Type == "stream_event" {
		// System envelopes also use "event", sometimes as a string. Only stream
		// envelopes carry the model's content-block schema.
		var event struct {
			Type  string `json:"type"`
			Delta struct {
				Type string `json:"type"`
				Text string `json:"text"`
			} `json:"delta"`
			Block struct {
				Type string `json:"type"`
				Text string `json:"text"`
			} `json:"content_block"`
		}
		if json.Unmarshal(e.Event, &event) != nil {
			return "", false, true
		}
		if event.Type == "content_block_delta" && event.Delta.Type == "text_delta" {
			return event.Delta.Text, false, false
		}
		if event.Type == "content_block_start" && event.Block.Type == "text" {
			return event.Block.Text, false, false
		}
	}

	return "", e.Type == "result" && e.Subtype == "success", false
}
