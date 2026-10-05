package reader

import "testing"

func TestClaudeEventEnvelope(t *testing.T) {
	for _, frame := range []string{
		`{"type":"system","subtype":"ui_invalidate","event":"settings_changed"}`,
		`{"type":"system","subtype":"init"}`,
	} {
		text, done, failed := claudeEvent([]byte(frame))
		if text != "" || done || failed {
			t.Fatalf("informational envelope rejected: %s", frame)
		}
	}
	for _, frame := range []string{
		`{"type":"stream_event","event":"invalid"}`,
		`{"type":"stream_event","event":{"delta":{"text":42}}}`,
		`{"type":"result","subtype":"success","is_error":true}`,
		`{"type":"result","subtype":"error_during_execution"}`,
		`not json`,
	} {
		_, _, failed := claudeEvent([]byte(frame))
		if !failed {
			t.Fatalf("invalid/error frame accepted: %s", frame)
		}
	}
}
