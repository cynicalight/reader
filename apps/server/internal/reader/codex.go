package reader

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"io"
	"os/exec"
	"strings"
	"sync"
	"time"
	"unicode/utf8"
)

type codexSession struct {
	cmd                                *exec.Cmd
	stdin                              io.WriteCloser
	stdout                             io.ReadCloser
	scan                               *bufio.Scanner
	work, model, threadID, actualModel string
	serial                             int
	total                              *TokenCounts
	usageComplete                      bool
	completedTurns                     map[string]bool
	closeOnce                          sync.Once
	rpcTiming                          func(string, time.Duration)
}

func (s *codexSession) close() {
	s.closeOnce.Do(func() { _ = s.cmd.Process.Kill(); _ = s.stdin.Close(); _ = s.stdout.Close(); _ = s.cmd.Wait() })
}
func newCodexSession(work, model string) (*codexSession, error) {
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
	cmd := exec.Command("codex", args...)
	cmd.Dir, cmd.Stderr, cmd.WaitDelay = work, io.Discard, 3*time.Second
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return nil, err
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		_ = stdin.Close()
		return nil, err
	}
	if err = cmd.Start(); err != nil {
		_ = stdin.Close()
		_ = stdout.Close()
		return nil, generationError(ErrorConfiguration, "无法启动 Codex App Server，请检查 CLI 安装及版本")
	}
	scan := bufio.NewScanner(stdout)
	scan.Buffer(make([]byte, 4096), maxProviderFrame)

	return &codexSession{cmd: cmd, stdin: stdin, stdout: stdout, scan: scan, work: work, model: model}, nil
}

func invokeCodex(ctx context.Context, work, model string, in AIInput, delta func(string), metrics ...func([]ModelTokens)) (string, error) {
	session, err := newCodexSession(work, model)
	if err != nil {
		return "", err
	}
	defer session.close()
	return session.generate(ctx, in, delta, metrics...)
}
func (s *codexSession) generate(ctx context.Context, in AIInput, delta func(string), metrics ...func([]ModelTokens)) (answerText string, err error) {
	lifecycle := newRPCLifecycle(ctx, s.cmd, s.stdin, s.stdout)
	defer func() {
		lifecycle.finish()
		if err != nil || ctx.Err() != nil {
			s.close()
		}
	}()
	scan, work, model := s.scan, s.work, s.model
	previousTotal := s.total
	usageReceived := false

	var answer strings.Builder
	items := map[string]*strings.Builder{}
	threadID, turnID := s.threadID, ""
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
		if p.TurnID != "" && (s.completedTurns[p.TurnID] || (turnID != "" && p.TurnID != turnID)) {
			return nil
		}
		if msg.Method == "thread/tokenUsage/updated" {
			var usage struct {
				TokenUsage struct {
					Total json.RawMessage `json:"total"`
				} `json:"tokenUsage"`
			}
			if json.Unmarshal(msg.Params, &usage) == nil {
				total := codexTokens(usage.TokenUsage.Total)
				if counts := codexUsageDelta(total, previousTotal); counts != nil && codexUsageDelta(total, s.total) != nil {
					usageReceived = true
					s.total = total
					emitMetrics(metrics, []ModelTokens{{Tokens: counts}})
				}
			}
			return nil
		}
		id := p.TurnID
		if strings.HasPrefix(msg.Method, "turn/") {
			id = p.Turn.ID
		}
		if id == "" || s.completedTurns[id] || (turnID != "" && id != turnID) {
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
	call := func(method string, params any) (json.RawMessage, error) {
		started := time.Now()
		defer func() {
			if s.rpcTiming != nil {
				s.rpcTiming(method, time.Since(started))
			}
		}()
		s.serial++
		id := s.serial
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
	var raw json.RawMessage
	if threadID == "" {
		if _, err = call("initialize", map[string]any{"clientInfo": map[string]string{"name": "reader", "title": "Reader", "version": "0.1.0"}}); err != nil {
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
		raw, err = call("thread/start", params)
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
		s.threadID, s.actualModel = threadID, thread.Model
	}
	emitMetrics(metrics, []ModelTokens{{Model: s.actualModel}})
	input := []any{map[string]string{"type": "text", "text": in.Prompt}}
	for _, image := range in.images() {
		input = append(input, map[string]string{"type": "image", "url": imageData(image)})
	}
	turnParams := map[string]any{"threadId": threadID, "input": input}
	if in.Effort != "" {
		turnParams["effort"] = in.Effort
	}
	raw, err = call("turn/start", turnParams)
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
	if s.completedTurns == nil {
		s.completedTurns = map[string]bool{}
	}
	s.completedTurns[turnID] = true
	s.usageComplete = usageReceived
	return answer.String(), nil
}
