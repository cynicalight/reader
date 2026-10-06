package reader

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"io"
	"os/exec"
	"strings"
	"time"
	"unicode/utf8"
)

// App Server exposes agentMessage deltas; exec --json only exposes completed
// assistant messages. Use one private stdio connection and ephemeral thread per
// invocation, retaining the CLI's own login without reading its credentials.
func invokeCodex(ctx context.Context, work, model string, in AIInput, delta func(string), metrics ...func([]ModelTokens)) (string, error) {
	child, cancel := context.WithCancel(context.WithoutCancel(ctx))
	defer cancel()
	args := []string{"app-server", "--listen", "stdio://"}
	for _, setting := range []string{
		`approval_policy="never"`, `sandbox_mode="read-only"`,
		`features.shell_tool=false`, `features.unified_exec=false`,
		`features.hooks=false`, `features.plugins=false`, `features.apps=false`,
		`features.multi_agent=false`, `features.code_mode=false`,
		`features.view_image=false`, `features.image_generation=false`,
		`web_search="disabled"`, `mcp_servers={}`, `notify=[]`, `project_doc_max_bytes=0`,
	} {
		args = append(args, "-c", setting)
	}
	cmd := exec.CommandContext(child, "codex", args...)
	cmd.Dir, cmd.Stderr, cmd.WaitDelay = work, io.Discard, 3*time.Second
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return "", err
	}
	defer stdin.Close()
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return "", err
	}
	defer stdout.Close()
	if err = cmd.Start(); err != nil {
		return "", generationError(ErrorConfiguration, "无法启动 Codex App Server，请检查 CLI 安装及版本")
	}
	lifecycle := newRPCLifecycle(ctx, cmd, stdin, stdout)
	defer func() { lifecycle.close(); cancel(); _ = cmd.Wait() }()
	scan := bufio.NewScanner(stdout)
	scan.Buffer(make([]byte, 4096), maxProviderFrame)

	var answer strings.Builder
	items := map[string]*strings.Builder{}
	threadID, turnID := "", ""
	completed := false
	providerError := errors.New("Codex 未完成回答，请检查登录、网络、模型或额度")
	appendText := func(itemID, part string) error {
		if ctx.Err() != nil {
			return nil
		}
		if itemID == "" {
			return generationError(ErrorProtocol, "Codex 消息编号无效")
		}
		if answer.Len()+len(part) > 1<<20 {
			return generationError(ErrorLimit, "Codex 回答过长")
		}
		if part == "" {
			return nil
		}
		if items[itemID] == nil {
			items[itemID] = &strings.Builder{}
		}
		items[itemID].WriteString(part)
		answer.WriteString(part)
		if part != "" && delta != nil {
			delta(part)
		}
		return nil
	}
	type message struct {
		ID     json.RawMessage `json:"id"`
		Method string          `json:"method"`
		Params json.RawMessage `json:"params"`
		Result json.RawMessage `json:"result"`
		Error  json.RawMessage `json:"error"`
	}
	// Notifications can interleave with RPC responses, including turn/start.
	handle := func(msg message) error {
		if completed {
			return nil
		}
		if len(msg.ID) > 0 && msg.Method != "" {
			// No client-side tools, permission grants, or credential exchange.
			return lifecycle.send(map[string]any{"id": msg.ID, "error": map[string]any{"code": -32601, "message": "Reader does not expose this operation"}})
		}
		var p struct {
			ThreadID  string `json:"threadId"`
			TurnID    string `json:"turnId"`
			ItemID    string `json:"itemId"`
			Delta     string `json:"delta"`
			WillRetry bool   `json:"willRetry"`
			Item      struct {
				ID   string `json:"id"`
				Type string `json:"type"`
				Text string `json:"text"`
			} `json:"item"`
			Turn struct {
				ID     string `json:"id"`
				Status string `json:"status"`
			} `json:"turn"`
		}
		if json.Unmarshal(msg.Params, &p) != nil || threadID == "" || p.ThreadID != threadID {
			return nil
		}
		if msg.Method == "thread/tokenUsage/updated" {
			var usage struct {
				TokenUsage struct {
					Total json.RawMessage `json:"total"`
				} `json:"tokenUsage"`
			}
			if json.Unmarshal(msg.Params, &usage) == nil {
				emitMetrics(metrics, []ModelTokens{{Tokens: codexTokens(usage.TokenUsage.Total)}})
			}
			return nil
		}
		id := p.TurnID
		if strings.HasPrefix(msg.Method, "turn/") {
			id = p.Turn.ID
		}
		if id == "" || (turnID != "" && id != turnID) {
			return nil
		}
		lifecycle.setCancel(map[string]any{"id": 99, "method": "turn/interrupt", "params": map[string]string{"threadId": threadID, "turnId": id}})
		switch msg.Method {
		case "item/agentMessage/delta":
			turnID = id
			return appendText(p.ItemID, p.Delta)
		case "item/completed":
			if p.Item.Type != "agentMessage" {
				return nil
			}
			turnID = id
			// Completion repeats the accumulated text. Only forward a missing
			// suffix, and reject rewrites that an append-only SSE client cannot apply.
			previous := ""
			if item := items[p.Item.ID]; item != nil {
				previous = item.String()
			}
			if !strings.HasPrefix(p.Item.Text, previous) {
				return generationError(ErrorProtocol, "Codex 完整回答与流式片段不一致，请重试")
			}
			return appendText(p.Item.ID, strings.TrimPrefix(p.Item.Text, previous))
		case "error":
			if !p.WillRetry {
				return providerError
			}
		case "turn/completed":
			if ctx.Err() != nil {
				return ctx.Err()
			}
			turnID = id
			if p.Turn.Status != "completed" {
				return providerError
			}
			completed = true
		}
		return nil
	}
	read := func() (message, error) {
		var msg message
		if !scan.Scan() {
			if ctx.Err() != nil {
				return msg, ctx.Err()
			}
			return msg, generationError(ErrorNetwork, "Codex 输出连接中断或事件过大")
		}
		if !utf8.Valid(scan.Bytes()) || json.Unmarshal(scan.Bytes(), &msg) != nil {
			return msg, generationError(ErrorProtocol, "Codex 输出协议无效")
		}
		return msg, nil
	}
	call := func(id int, method string, params any) (json.RawMessage, error) {
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		if err := lifecycle.send(map[string]any{"id": id, "method": method, "params": params}); err != nil {
			return nil, err
		}
		for {
			msg, err := read()
			if err != nil {
				return nil, err
			}
			if err = handle(msg); err != nil {
				return nil, err
			}
			var responseID int
			if msg.Method == "" && json.Unmarshal(msg.ID, &responseID) == nil && responseID == id {
				if len(msg.Error) > 0 && string(msg.Error) != "null" {
					return nil, providerError
				}
				return msg.Result, nil
			}
		}
	}
	if _, err = call(1, "initialize", map[string]any{"clientInfo": map[string]string{"name": "reader", "title": "Reader", "version": "0.1.0"}}); err != nil {
		return "", err
	}
	if err = lifecycle.send(map[string]any{"method": "initialized", "params": map[string]any{}}); err != nil {
		return "", err
	}
	params := map[string]any{"cwd": work, "ephemeral": true, "sandbox": "read-only", "approvalPolicy": "never",
		"baseInstructions": readerSystemPrompt}
	if model != "" {
		params["model"] = model
	}
	raw, err := call(2, "thread/start", params)
	if err != nil {
		return "", err
	}
	var thread struct {
		Model  string `json:"model"`
		Thread struct {
			ID string `json:"id"`
		} `json:"thread"`
	}
	if json.Unmarshal(raw, &thread) != nil || thread.Thread.ID == "" {
		return "", generationError(ErrorProtocol, "Codex 会话无效")
	}
	threadID = thread.Thread.ID
	emitMetrics(metrics, []ModelTokens{{Model: thread.Model}})
	input := []any{map[string]string{"type": "text", "text": in.Prompt}}
	for _, image := range in.images() {
		input = append(input, map[string]string{"type": "image", "url": imageData(image)})
	}
	turnParams := map[string]any{"threadId": threadID, "input": input}
	if in.Effort != "" {
		turnParams["effort"] = in.Effort
	}
	raw, err = call(3, "turn/start", turnParams)
	if err != nil {
		return "", err
	}
	var turn struct {
		Turn struct {
			ID string `json:"id"`
		} `json:"turn"`
	}
	if json.Unmarshal(raw, &turn) != nil || turn.Turn.ID == "" || (turnID != "" && turnID != turn.Turn.ID) {
		return "", generationError(ErrorProtocol, "Codex 回答编号无效")
	}
	turnID = turn.Turn.ID
	lifecycle.setCancel(map[string]any{"id": 99, "method": "turn/interrupt", "params": map[string]string{"threadId": threadID, "turnId": turnID}})
	for !completed {
		msg, err := read()
		if err != nil {
			return "", err
		}
		if err = handle(msg); err != nil {
			return "", err
		}
	}
	if ctx.Err() != nil {
		return "", ctx.Err()
	}
	if answer.Len() == 0 {
		return "", providerError
	}
	return answer.String(), nil
}
