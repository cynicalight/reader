package reader

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestChatKeepsLongSourceWithoutRepeatingIt(t *testing.T) {
	fakeAgent(t, "codex", "fail-before")
	s := testServer(t)
	if _, err := s.Store.DB.Exec("INSERT INTO documents(id,type,title,author,size,created_at,last_opened_at) VALUES('doc','pdf','test','',1,?,?)", now(), now()); err != nil {
		t.Fatal(err)
	}
	source := strings.Repeat("中文长资料。", 1800) + "独有原文事实：维修费用471元。"
	for _, m := range []Message{{Role: "user", Content: "费用？", Context: source}, {Role: "assistant", Content: "471元"}, {Role: "user", Content: "再次核对", Context: source}, {Role: "assistant", Content: "471元"}} {
		m.DocumentID = "doc"
		if err := s.Store.saveMessage(m); err != nil {
			t.Fatal(err)
		}
	}
	captured := ""
	api := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			Messages []struct {
				Content string `json:"content"`
			} `json:"messages"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			t.Error(err)
		}
		captured = req.Messages[1].Content
		writeAPIReply(w, "471元")
	}))
	defer api.Close()
	c := AIConfig{Primary: "codex", Models: map[string]string{}, TextAPI: APIConnection{URL: api.URL, Model: "test"}, Capabilities: map[string]Capability{}}
	c.Capabilities["text-api"] = Capability{Text: true, Fingerprint: configPrint(c, "text-api")}
	if err := s.writeAIConfig(c); err != nil {
		t.Fatal(err)
	}
	r := request(t, s, "POST", "/api/documents/doc/chat", strings.NewReader(`{"provider":"codex","prompt":"根据原始依据确认费用","context":""}`))
	if !strings.Contains(r.Body.String(), "event: done") {
		t.Fatal(r.Body.String())
	}
	if n := strings.Count(captured, "独有原文事实：维修费用471元。"); n != 1 {
		t.Errorf("original source fact occurs %d times, want once", n)
	}
	if strings.Contains(captured, "\ufffd") {
		t.Error("history damaged UTF-8")
	}
	if !strings.Contains(captured, "再次核对") {
		t.Error("source budget dropped the user question")
	}
}

func TestChatHistoryKeepsQuestionAnswerBoundaries(t *testing.T) {
	source := strings.Repeat("完整中文证据。", 6000)
	messages := []Message{{Role: "assistant", Content: "不应出现的孤立回答"}, {Role: "user", Content: "需要保留的问题", Context: source}, {Role: "assistant", Content: strings.Repeat("很长的中文回答。", 6000)}}
	prompt, chat := makeChatInput("doc", "title", "本轮问题", source, "", messages)
	if strings.Contains(prompt, "不应出现的孤立回答") {
		t.Fatal("included an orphan answer")
	}
	if !strings.Contains(prompt, "需要保留的问题") || !strings.Contains(prompt, "历史回答已截短") {
		t.Fatal("missing paired question or truncation marker")
	}
	if len(chat.Sources) != 1 || chat.Sources[0].Text != source {
		t.Fatal("source was truncated or duplicated")
	}
	if strings.Contains(prompt, "\ufffd") {
		t.Fatal("damaged UTF-8")
	}
}
