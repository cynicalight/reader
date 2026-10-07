package reader

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func runTranslationSessionProcess() {
	scan := bufio.NewScanner(os.Stdin)
	scan.Buffer(make([]byte, 4096), maxProviderFrame)
	enc := json.NewEncoder(os.Stdout)
	turn := 0
	for scan.Scan() {
		var req struct {
			ID     json.RawMessage `json:"id"`
			Method string          `json:"method"`
			Params json.RawMessage `json:"params"`
		}
		if json.Unmarshal(scan.Bytes(), &req) != nil {
			os.Exit(1)
		}
		f, err := os.OpenFile(os.Getenv("READER_TRANSLATION_CAPTURE"), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0600)
		if err != nil {
			os.Exit(2)
		}
		_ = json.NewEncoder(f).Encode(map[string]any{"pid": os.Getpid(), "method": req.Method, "params": req.Params})
		_ = f.Close()
		reply := func(v any) { _ = enc.Encode(map[string]any{"id": req.ID, "result": v}) }
		switch req.Method {
		case "initialize":
			reply(map[string]any{})
		case "thread/start":
			reply(map[string]any{"thread": map[string]string{"id": "thread"}, "model": translationCodexModel})
		case "turn/start":
			turn++
			tid := fmt.Sprintf("turn-%d", turn)
			reply(map[string]any{"turn": map[string]string{"id": tid}})
			notify := func(method string, p map[string]any) {
				p["threadId"] = "thread"
				p["turnId"] = tid
				_ = enc.Encode(map[string]any{"method": method, "params": p})
			}
			var params struct {
				Input []struct {
					Text string `json:"text"`
				} `json:"input"`
			}
			_ = json.Unmarshal(req.Params, &params)
			_, raw, _ := strings.Cut(params.Input[0].Text, "输入资料：\n")
			var input translationTestInput
			if json.Unmarshal([]byte(raw), &input) != nil {
				os.Exit(3)
			}
			if turn > 1 {
				_ = enc.Encode(map[string]any{"method": "item/agentMessage/delta", "params": map[string]any{"threadId": "thread", "turnId": fmt.Sprintf("turn-%d", turn-1), "itemId": "old", "delta": "stale\n"}})
			}
			notify("thread/tokenUsage/updated", map[string]any{"tokenUsage": map[string]any{"total": TokenCounts{InputTokens: int64(turn * 20), OutputTokens: int64(turn * 10), TotalTokens: int64(turn * 30), CachedInputTokens: tokenCount(int64(turn * 8))}}})
			if os.Getenv("READER_TRANSLATION_FAIL_SECOND") == "1" && turn == 2 {
				notify("turn/completed", map[string]any{"turn": map[string]string{"id": tid, "status": "failed"}})
				continue
			}
			text := ""
			for _, p := range input.Batch.Paragraphs {
				text += translationParagraphLine(p)
			}
			notify("item/agentMessage/delta", map[string]any{"itemId": "answer", "delta": text})
			if os.Getenv("READER_TRANSLATION_CANCEL") == "1" {
				if !scan.Scan() {
					return
				}
				var interrupt struct {
					Method string `json:"method"`
				}
				_ = json.Unmarshal(scan.Bytes(), &interrupt)
				if interrupt.Method != "turn/interrupt" {
					os.Exit(4)
				}
				_ = os.WriteFile(os.Getenv("READER_AGENT_ACK"), []byte("interrupt"), 0600)
				return
			}
			notify("item/completed", map[string]any{"item": map[string]string{"id": "answer", "type": "agentMessage", "text": text}})
			notify("turn/completed", map[string]any{"turn": map[string]string{"id": tid, "status": "completed"}})
		}
	}
}
func translationSessionFixture(t *testing.T) (*Server, Processing, layoutManifest, string) {
	t.Helper()
	fakeAgent(t, "codex", "translation-session")
	capture := filepath.Join(t.TempDir(), "requests.jsonl")
	t.Setenv("READER_TRANSLATION_CAPTURE", capture)
	s, p, m := translationFixture(t)
	for i := range m.Blocks {
		m.Blocks[i].Text = strings.Repeat(fmt.Sprintf("Paragraph %d. ", i), 1000)
	}
	c := AIConfig{Primary: "codex", Models: map[string]string{"codex": "chat-model"}, Capabilities: map[string]Capability{}}
	c.Capabilities["codex"] = Capability{Text: true, Fingerprint: configPrint(c, "codex")}
	if err := s.writeAIConfig(c); err != nil {
		t.Fatal(err)
	}
	return s, p, m, capture
}
func TestTranslationCodexReusesThreadWithLunaLow(t *testing.T) {
	s, p, m, capture := translationSessionFixture(t)
	if err := s.settleTranslations(t.Context(), &p, m); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(capture)
	if err != nil {
		t.Fatal(err)
	}
	var pid, starts, initializes, turns int
	for _, line := range strings.Split(strings.TrimSpace(string(data)), "\n") {
		var r struct {
			PID    int    `json:"pid"`
			Method string `json:"method"`
			Params struct {
				Model    string `json:"model"`
				Effort   string `json:"effort"`
				ThreadID string `json:"threadId"`
			} `json:"params"`
		}
		if err := json.Unmarshal([]byte(line), &r); err != nil {
			t.Fatal(err)
		}
		if pid != 0 && pid != r.PID {
			t.Fatal("started another process")
		}
		pid = r.PID
		switch r.Method {
		case "initialize":
			initializes++
		case "thread/start":
			starts++
			if r.Params.Model != translationCodexModel {
				t.Fatal("wrong model")
			}
		case "turn/start":
			turns++
			if r.Params.Effort != "low" || r.Params.ThreadID != "thread" {
				t.Fatal("wrong effort or thread")
			}
		}
	}
	if initializes != 1 || starts != 1 || turns != 2 {
		t.Fatalf("initialize=%d threads=%d turns=%d", initializes, starts, turns)
	}
	items, err := s.translations("doc", m)
	if err != nil {
		t.Fatal(err)
	}
	for _, item := range items {
		if item.Status != "complete" {
			t.Fatalf("lost paragraph: %+v", item)
		}
	}
	report, err := s.Store.usageReport("doc")
	if err != nil {
		t.Fatal(err)
	}
	if len(report.Calls) != 2 {
		t.Fatalf("calls=%+v", report.Calls)
	}
	for _, call := range report.Calls {
		if len(call.Models) != 1 || call.Models[0].Model != translationCodexModel || call.Models[0].Tokens == nil || call.Models[0].Tokens.TotalTokens != 30 {
			t.Fatalf("usage double-counted: %+v", call)
		}
	}
	if s.aiConfig().Models["codex"] != "chat-model" {
		t.Fatal("changed chat model")
	}
	entries, err := os.ReadDir(filepath.Join(s.Store.Root, "ai-work"))
	if err != nil || len(entries) != 0 {
		t.Fatalf("leaked directory: %v %v", entries, err)
	}
}
func TestTranslationCodexCancellationClosesSession(t *testing.T) {
	s, _, m, _ := translationSessionFixture(t)
	t.Setenv("READER_TRANSLATION_CANCEL", "1")
	a := &translationCodexAdapter{root: s.Store.Root}
	defer a.close()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	batch := translationBatch{Paragraphs: []translationParagraph{{BlockID: m.Blocks[0].ID, SourceHash: translationHash(m.Blocks[0].Text), Source: m.Blocks[0].Text}}}
	_, err := a.Stream(ctx, GenerateRequest{AIInput{Prompt: translationPrompt(Document{}, m, batch)}}, func(e ProviderEvent) error {
		if e.Text != "" {
			cancel()
		}
		return nil
	})
	if !errors.Is(err, context.Canceled) || a.session != nil || a.work != "" {
		t.Fatalf("cancellation leaked session: %v %+v", err, a)
	}
}

func TestTranslationCodexFailureRetryPreservesCompletedParagraphs(t *testing.T) {
	s, p, m, capture := translationSessionFixture(t)
	t.Setenv("READER_TRANSLATION_FAIL_SECOND", "1")
	if err := s.settleTranslations(t.Context(), &p, m); err == nil {
		t.Fatal("failed turn reported success")
	}
	items, err := s.translations("doc", m)
	if err != nil {
		t.Fatal(err)
	}
	if items[0].Status != "complete" || items[1].Status != "failed" {
		t.Fatalf("lost completed translation: %+v", items)
	}
	if !capable(s.aiConfig(), "codex", false) {
		t.Fatal("translation failure invalidated chat capability")
	}
	t.Setenv("READER_TRANSLATION_FAIL_SECOND", "")
	items[1].Status = "pending"
	items[1].Error = ""
	if err := s.saveTranslation("doc", items[1]); err != nil {
		t.Fatal(err)
	}
	if err := s.settleTranslations(t.Context(), &p, m); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(capture)
	if err != nil {
		t.Fatal(err)
	}
	starts, turns := 0, 0
	for _, line := range strings.Split(strings.TrimSpace(string(data)), "\n") {
		var r struct {
			Method string `json:"method"`
			Params struct {
				Input []struct {
					Text string `json:"text"`
				} `json:"input"`
			} `json:"params"`
		}
		if err := json.Unmarshal([]byte(line), &r); err != nil {
			t.Fatal(err)
		}
		if r.Method == "thread/start" {
			starts++
		}
		if r.Method == "turn/start" {
			turns++
			if turns == 3 {
				_, raw, _ := strings.Cut(r.Params.Input[0].Text, "输入资料：\n")
				var input translationTestInput
				if json.Unmarshal([]byte(raw), &input) != nil || len(input.Batch.Paragraphs) != 1 || input.Batch.Paragraphs[0].BlockID != m.Blocks[1].ID {
					t.Fatal("retry regenerated completed paragraph")
				}
			}
		}
	}
	if starts != 2 || turns != 3 {
		t.Fatalf("starts=%d turns=%d", starts, turns)
	}
}
