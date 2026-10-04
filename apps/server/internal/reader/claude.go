package reader

import "encoding/json"

func claudeArgs() []string {
	return []string{"-p", "--safe-mode", "--output-format", "stream-json", "--verbose", "--include-partial-messages", "--tools", "", "--strict-mcp-config", "--mcp-config", "{\"mcpServers\":{}}", "--setting-sources", "", "--disable-slash-commands", "--no-session-persistence"}
}

// Only top-level assistant text crosses the provider boundary. The assistant
// snapshot and final result repeat earlier deltas and must not be appended.
func claudeEvent(line []byte) (text string, completed, failed bool) {
	var e struct {
		Type            string  `json:"type"`
		Subtype         string  `json:"subtype"`
		IsError         bool    `json:"is_error"`
		ParentToolUseID *string `json:"parent_tool_use_id"`
		Event           struct {
			Type  string `json:"type"`
			Delta struct {
				Type string `json:"type"`
				Text string `json:"text"`
			} `json:"delta"`
			Block struct {
				Type string `json:"type"`
				Text string `json:"text"`
			} `json:"content_block"`
		} `json:"event"`
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
		if e.Event.Type == "content_block_delta" && e.Event.Delta.Type == "text_delta" {
			return e.Event.Delta.Text, false, false
		}
		if e.Event.Type == "content_block_start" && e.Event.Block.Type == "text" {
			return e.Event.Block.Text, false, false
		}
	}
	return "", e.Type == "result" && e.Subtype == "success", false
}
