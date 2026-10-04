package reader

import (
	"bufio"
	"context"
	"encoding/json"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
)

// These fixtures also serve the frontend replay harness. Round-trip each frame
// through the real writer to guard event names, JSON shapes and append semantics.
func TestFrozenStreamFixtures(t *testing.T) {
	raw, err := os.ReadFile("../../../../docs/fixtures/agent-streaming-v1.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixtures []struct {
		Name, Wire, Text string
		Terminal         *string
	}
	if err = json.Unmarshal(raw, &fixtures); err != nil {
		t.Fatal(err)
	}
	for _, fixture := range fixtures {
		t.Run(fixture.Name, func(t *testing.T) {
			ctx, cancel := context.WithCancel(t.Context())
			defer cancel()
			recorder := httptest.NewRecorder()
			writer := &chatStreamWriter{w: recorder, cancel: cancel}
			scan := bufio.NewScanner(strings.NewReader(fixture.Wire))
			event, text, terminal := "", "", ""
			for scan.Scan() {
				line := scan.Text()
				if strings.HasPrefix(line, "event: ") {
					event = strings.TrimPrefix(line, "event: ")
				}
				if !strings.HasPrefix(line, "data: ") {
					continue
				}
				var value map[string]any
				if err = json.Unmarshal([]byte(strings.TrimPrefix(line, "data: ")), &value); err != nil {
					t.Fatal(err)
				}
				if len(value) != 1 {
					t.Fatal("unexpected fields")
				}
				switch event {
				case "status":
					if value["status"] != "reading" && value["status"] != "reading-image" {
						t.Fatal(value)
					}
				case "delta":
					part, ok := value["text"].(string)
					if !ok {
						t.Fatal(value)
					}
					text += part
				case "fallback":
					if _, ok := value["message"].(string); !ok {
						t.Fatal(value)
					}
				case "error":
					terminal = event
					if _, ok := value["error"].(string); !ok {
						t.Fatal(value)
					}
				case "done":
					terminal = event
					if value["ok"] != true {
						t.Fatal(value)
					}
				default:
					t.Fatal(event)
				}
				if err = writer.send(event, value); err != nil {
					t.Fatal(err)
				}
			}
			if scan.Err() != nil || text != fixture.Text || recorder.Body.String() != fixture.Wire || ctx.Err() != nil {
				t.Fatal("fixture does not match wire")
			}
			if fixture.Terminal != nil {
				if terminal != *fixture.Terminal || writer.send("delta", map[string]string{"text": "late"}) == nil {
					t.Fatal("terminal mismatch")
				}
			} else if terminal != "" {
				t.Fatal("unexpected terminal")
			}
		})
	}
}
