package reader

import (
	"context"
	"encoding/json"
	"net/http"
	"os/exec"
	"strings"
	"time"
)

type Provider struct {
	ID            string `json:"id"`
	Installed     bool   `json:"installed"`
	Authenticated bool   `json:"authenticated"`
	Status        string `json:"status"`
}

func providerStatus(ctx context.Context, name string) Provider {
	p := Provider{ID: name, Status: "未安装"}
	exe, err := exec.LookPath(name)
	if err != nil {
		return p
	}
	p.Installed = true
	if name == "kimi" {
		p.Status = "请测试可用性"
		return p
	}
	args := []string{"login", "status"}
	if name == "claude" {
		args = []string{"auth", "status"}
	}
	child, cancel := context.WithTimeout(ctx, 8*time.Second)
	defer cancel()
	cmd := exec.CommandContext(child, exe, args...)
	output, err := cmd.Output()
	p.Authenticated = err == nil
	if name == "claude" && err == nil {
		var auth struct {
			LoggedIn bool `json:"loggedIn"`
		}
		if json.Unmarshal(output, &auth) == nil {
			p.Authenticated = auth.LoggedIn
		}
	}
	if p.Authenticated {
		p.Status = "已登录"
	} else {
		p.Status = "登录状态未确认，请测试实际可用性"
	}
	return p
}
func (s *Server) providers(w http.ResponseWriter, r *http.Request) {
	out := []Provider{}
	for _, name := range []string{"codex", "claude", "kimi"} {
		if r.URL.Query().Get("auth") == "skip" {
			_, err := exec.LookPath(name)
			status := "未安装"
			if err == nil {
				status = "待检测"
			}
			out = append(out, Provider{ID: name, Installed: err == nil, Status: status})
		} else {
			out = append(out, providerStatus(r.Context(), name))
		}
	}
	respond(w, 200, out)
}
func (s *Server) chat(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Provider    string          `json:"provider"`
		Prompt      string          `json:"prompt"`
		Context     *string         `json:"context"`
		References  json.RawMessage `json:"references"`
		Attachments []string        `json:"attachments"`
	}
	if !decode(w, r, &req) {
		return
	}
	if req.Context == nil {
		fail(w, 400, "缺少 context 字段")
		return
	}
	if !validAgent(req.Provider) {
		fail(w, 400, "未知 AI 服务")
		return
	}
	if strings.TrimSpace(req.Prompt) == "" || len(req.Prompt) > 16000 || len(*req.Context) > 64000 {
		fail(w, 400, "问题或上下文长度无效")
		return
	}
	d, err := s.Store.Document(r.PathValue("id"))
	if err != nil {
		fail(w, 404, "文档不存在")
		return
	}
	s.chatDocument(w, r, d.ID, d.Title, req.Provider, req.Prompt, *req.Context, req.References, req.Attachments)
}
