package reader

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func runChatSessionProcess() {
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
		f, err := os.OpenFile(os.Getenv("READER_CHAT_CAPTURE"), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0600)
		if err != nil {
			os.Exit(2)
		}
		_ = json.NewEncoder(f).Encode(map[string]any{"pid": os.Getpid(), "method": req.Method, "params": req.Params})
		_ = f.Close()
		reply := func(v any) { _ = enc.Encode(map[string]any{"id": req.ID, "result": v}) }
		switch req.Method {
		case "initialize":
			reply(map[string]any{})
		case "model/list":
			reply(map[string]any{"data": []any{map[string]any{"model": "test-model", "isDefault": true}}})
		case "thread/start":
			reply(map[string]any{"thread": map[string]string{"id": "thread"}, "model": "test-model"})
		case "turn/start":
			turn++
			tid := fmt.Sprintf("turn-%d", turn)
			// Old turn notifications must not leak into a new response.
			if turn > 1 {
				_ = enc.Encode(map[string]any{"method": "item/agentMessage/delta", "params": map[string]any{"threadId": "thread", "turnId": fmt.Sprintf("turn-%d", turn-1), "itemId": "old", "delta": "stale"}})
			}
			reply(map[string]any{"turn": map[string]string{"id": tid}})
			notify := func(method string, p map[string]any) {
				p["threadId"] = "thread"
				p["turnId"] = tid
				_ = enc.Encode(map[string]any{"method": method, "params": p})
			}
			if os.Getenv("READER_CHAT_SKIP_USAGE") != "1" {
				notify("thread/tokenUsage/updated", map[string]any{"tokenUsage": map[string]any{"total": TokenCounts{InputTokens: int64(turn * 20), OutputTokens: int64(turn * 10), TotalTokens: int64(turn * 30), CachedInputTokens: tokenCount(int64(turn * 8))}}})
			}
			notify("item/agentMessage/delta", map[string]any{"itemId": "answer", "delta": "已收到"})
			notify("turn/completed", map[string]any{"turn": map[string]string{"id": tid, "status": "completed"}})
		}
	}
}
func chatFixture(t *testing.T) (*Server, string) {
	t.Helper()
	fakeAgent(t, "codex", "chat-session")
	capture := filepath.Join(t.TempDir(), "requests.jsonl")
	t.Setenv("READER_CHAT_CAPTURE", capture)
	s := testServer(t)
	for _, doc := range []string{"doc", "other"} {
		if _, err := s.Store.DB.Exec("INSERT INTO documents(id,type,title,author,size,created_at,last_opened_at) VALUES(?,'pdf','test','',1,?,?)", doc, now(), now()); err != nil {
			t.Fatal(err)
		}
	}
	c := AIConfig{Primary: "codex", Models: map[string]string{"codex": "test-model"}, Capabilities: map[string]Capability{}}
	if err := s.writeAIConfig(c); err != nil {
		t.Fatal(err)
	}
	return s, capture
}
func sendChat(t *testing.T, s *Server, doc, question, source string) string {
	t.Helper()
	b, _ := json.Marshal(map[string]any{"provider": "codex", "prompt": question, "context": source})
	return request(t, s, "POST", "/api/documents/"+doc+"/chat", strings.NewReader(string(b))).Body.String()
}
func capturedTurns(t *testing.T, path string) ([]int, []string) {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var pids []int
	var texts []string
	for _, line := range strings.Split(strings.TrimSpace(string(data)), "\n") {
		var req struct {
			PID    int    `json:"pid"`
			Method string `json:"method"`
			Params struct {
				Input []struct {
					Text string `json:"text"`
				} `json:"input"`
			} `json:"params"`
		}
		if err := json.Unmarshal([]byte(line), &req); err != nil {
			t.Fatal(err)
		}
		if req.Method == "turn/start" {
			pids = append(pids, req.PID)
			texts = append(texts, req.Params.Input[0].Text)
		}
	}
	return pids, texts
}
func TestCodexChatReuseAndUsage(t *testing.T) {
	s, path := chatFixture(t)
	for i := 0; i < 3; i++ {
		if body := sendChat(t, s, "doc", fmt.Sprintf("问题%d", i), "预算730元"); !strings.Contains(body, "event: done") || strings.Contains(body, "stale") {
			t.Fatal(body)
		}
	}
	pids, texts := capturedTurns(t, path)
	if len(pids) != 3 || pids[0] != pids[1] || pids[1] != pids[2] {
		t.Fatalf("not reused: %v", pids)
	}
	if !strings.Contains(texts[0], "预算730元") || strings.Contains(texts[1], "预算730元") || strings.Contains(texts[1], "问题0") || !strings.Contains(texts[1], "问题1") {
		t.Fatalf("incorrect inputs: %v", texts)
	}
	rows, err := s.Store.DB.Query("SELECT body FROM processing_usage WHERE json_extract(body,'$.stage')='chat'")
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	n := 0
	for rows.Next() {
		var b string
		var call UsageCall
		if err := rows.Scan(&b); err != nil {
			t.Fatal(err)
		}
		if err := json.Unmarshal([]byte(b), &call); err != nil {
			t.Fatal(err)
		}
		n++
		tok := call.Models[0].Tokens
		if tok == nil || tok.TotalTokens != 30 || tok.CachedInputTokens == nil || *tok.CachedInputTokens != 8 {
			t.Fatalf("per-turn usage: %s", b)
		}
	}
	if n != 3 {
		t.Fatalf("usage calls %d", n)
	}
}
func TestCodexChatResetsAndRehydrates(t *testing.T) {
	s, path := chatFixture(t)
	if b := sendChat(t, s, "doc", "第一问", "原始资料"); !strings.Contains(b, "event: done") {
		t.Fatal(b)
	}
	if b := sendChat(t, s, "other", "另一文档", ""); !strings.Contains(b, "event: done") {
		t.Fatal(b)
	}
	if b := sendChat(t, s, "doc", "回来核对", ""); !strings.Contains(b, "event: done") {
		t.Fatal(b)
	}
	pids, texts := capturedTurns(t, path)
	if len(pids) != 3 || pids[0] == pids[1] || pids[1] == pids[2] {
		t.Fatal(pids)
	}
	if !strings.Contains(texts[2], "第一问") || !strings.Contains(texts[2], "原始资料") || !strings.Contains(texts[2], "已收到") {
		t.Fatal(texts[2])
	}
	c := s.aiConfig()
	c.Models["codex"] = "different-model"
	if err := s.writeAIConfig(c); err != nil {
		t.Fatal(err)
	}
	if b := sendChat(t, s, "doc", "更换模型", ""); !strings.Contains(b, "event: done") {
		t.Fatal(b)
	}
	pids, _ = capturedTurns(t, path)
	if pids[2] == pids[3] {
		t.Fatal("model change reused session")
	}
}
func TestCodexChatDiscardsUnsavedTurn(t *testing.T) {
	s, path := chatFixture(t)
	if b := sendChat(t, s, "doc", "首问", "资料"); !strings.Contains(b, "event: done") {
		t.Fatal(b)
	}
	_, err := s.Store.DB.Exec(`CREATE TRIGGER reject_chat BEFORE INSERT ON messages WHEN json_extract(NEW.body,'$.role')='assistant' BEGIN SELECT RAISE(FAIL,'save failure'); END`)
	if err != nil {
		t.Fatal(err)
	}
	if b := sendChat(t, s, "doc", "保存失败", ""); !strings.Contains(b, "event: error") || strings.Contains(b, "event: done") {
		t.Fatal(b)
	}
	if s.codexChat.entry != nil {
		t.Fatal("kept unsaved provider state")
	}
	if _, err := s.Store.DB.Exec("DROP TRIGGER reject_chat"); err != nil {
		t.Fatal(err)
	}
	if b := sendChat(t, s, "doc", "恢复", ""); !strings.Contains(b, "event: done") {
		t.Fatal(b)
	}
	pids, _ := capturedTurns(t, path)
	if pids[0] != pids[1] || pids[1] == pids[2] {
		t.Fatal(pids)
	}
}
func TestCodexChatCancellation(t *testing.T) {
	fakeAgent(t, "codex", "protocol-cancel")
	s := testServer(t)
	chat := &chatInput{DocumentID: "doc"}
	session, in, err := s.codexChat.acquire(s.Store.Root, "test", AIInput{Prompt: "问", Chat: chat})
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	_, err = session.generate(ctx, in, func(string) { cancel() })
	if err == nil {
		t.Fatal("canceled turn succeeded")
	}
	s.codexChat.finish(chat, "", false)
	if s.codexChat.entry != nil {
		t.Fatal("canceled session retained")
	}
}

func TestCodexChatNewSourceAndHistoryMismatch(t *testing.T) {
	s, path := chatFixture(t)
	for _, pair := range [][2]string{{"第一问", "资料甲"}, {"第二问", "资料乙"}, {"第三问", "资料乙"}} {
		if b := sendChat(t, s, "doc", pair[0], pair[1]); !strings.Contains(b, "event: done") {
			t.Fatal(b)
		}
	}
	pids, texts := capturedTurns(t, path)
	if pids[0] != pids[1] || pids[1] != pids[2] || !strings.Contains(texts[1], "资料乙") || strings.Contains(texts[1], "资料甲") || strings.Contains(texts[2], "资料乙") {
		t.Fatalf("source reuse: %v %v", pids, texts)
	}
	if err := s.Store.saveMessage(Message{DocumentID: "doc", Role: "user", Content: "外部新增问题"}); err != nil {
		t.Fatal(err)
	}
	if b := sendChat(t, s, "doc", "第四问", ""); !strings.Contains(b, "event: done") {
		t.Fatal(b)
	}
	pids, texts = capturedTurns(t, path)
	if pids[2] == pids[3] || !strings.Contains(texts[3], "外部新增问题") {
		t.Fatal("did not rehydrate changed persisted history")
	}
}
func TestCodexChatLimitsEffortAndClose(t *testing.T) {
	for _, reason := range []string{"effort", "turns", "sources", "close", "delete"} {
		t.Run(reason, func(t *testing.T) {
			s, _ := chatFixture(t)
			if b := sendChat(t, s, "doc", "首问", "资料"); !strings.Contains(b, "event: done") {
				t.Fatal(b)
			}
			old := s.codexChat.entry
			work := old.work
			switch reason {
			case "effort":
				old.key = "old-effort"
			case "turns":
				old.turns = 64
			case "sources":
				old.sourceBytes = 256000
			case "close":
				s.Close()
			case "delete":
				s.codexChat.deleteDocument("doc")
			}
			if reason != "close" && reason != "delete" {
				if b := sendChat(t, s, "doc", "后续", ""); !strings.Contains(b, "event: done") {
					t.Fatal(b)
				}
				if s.codexChat.entry == old {
					t.Fatal("session limit/config change did not reset")
				}
			}
			if _, err := os.Stat(work); !os.IsNotExist(err) {
				t.Fatalf("work directory retained: %v", err)
			}
		})
	}
}
func TestCodexUsageRejectsDecreasingTotals(t *testing.T) {
	prior := &TokenCounts{InputTokens: 20, OutputTokens: 10, TotalTokens: 30, CachedInputTokens: tokenCount(8)}
	if got := codexUsageDelta(&TokenCounts{InputTokens: 19, OutputTokens: 10, TotalTokens: 29}, prior); got != nil {
		t.Fatal(got)
	}
	if got := codexUsageDelta(&TokenCounts{InputTokens: 40, OutputTokens: 20, TotalTokens: 60, CachedInputTokens: tokenCount(16)}, prior); got == nil || got.TotalTokens != 30 || got.CachedInputTokens == nil || *got.CachedInputTokens != 8 {
		t.Fatal(got)
	}
}

func TestCodexChatMissingUsageRebuildsBeforeNextTurn(t *testing.T) {
	s, path := chatFixture(t)
	t.Setenv("READER_CHAT_SKIP_USAGE", "1")
	for _, q := range []string{"第一问", "第二问"} {
		if b := sendChat(t, s, "doc", q, "原始资料"); !strings.Contains(b, "event: done") {
			t.Fatal(b)
		}
	}
	pids, texts := capturedTurns(t, path)
	if len(pids) != 2 || pids[0] == pids[1] || !strings.Contains(texts[1], "第一问") {
		t.Fatal("missing usage must rebuild and rehydrate instead of attributing two turns to one call")
	}
}
