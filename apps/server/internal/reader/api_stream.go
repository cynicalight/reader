package reader

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"mime"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"
)

// Only OpenAI Chat Completions SSE is supported. No automatic non-stream retry:
// that would create a second upstream generation after a malformed response.
type apiAdapter struct{ config APIConnection }

func invokeAPI(ctx context.Context, c APIConnection, in AIInput, delta func(string)) (string, error) {
	r, e := (apiAdapter{c}).Stream(ctx, GenerateRequest{in}, legacyEmitter(delta, nil))
	return r.Text, e
}
func (a apiAdapter) Stream(ctx context.Context, req GenerateRequest, emit func(ProviderEvent) error) (GenerateResult, error) {
	c, in := a.config, req.Input
	if e := validateAPI(c); e != nil {
		return GenerateResult{}, generationError(ErrorConfiguration, e.Error())
	}
	if c.URL == "" {
		return GenerateResult{}, generationError(ErrorConfiguration, "未配置 API")
	}
	var content any = in.Prompt
	if len(in.images()) > 0 {
		parts := []any{map[string]any{"type": "text", "text": in.Prompt}}
		for _, im := range in.images() {
			parts = append(parts, map[string]any{"type": "image_url", "image_url": map[string]string{"url": imageData(im)}})
		}
		content = parts
	}
	body, _ := json.Marshal(map[string]any{"model": c.Model, "messages": []any{
		map[string]any{"role": "system", "content": readerSystemPrompt},
		map[string]any{"role": "user", "content": content},
	}, "stream": true, "n": 1})
	request, e := http.NewRequestWithContext(ctx, "POST", strings.TrimRight(c.URL, "/")+"/chat/completions", bytes.NewReader(body))
	if e != nil {
		return GenerateResult{}, generationError(ErrorConfiguration, "API 地址无效")
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Accept", "text/event-stream")
	if c.Key != "" {
		request.Header.Set("Authorization", "Bearer "+c.Key)
	}
	client := &http.Client{Timeout: 3 * time.Minute, CheckRedirect: func(*http.Request, []*http.Request) error {
		return generationError(ErrorConfiguration, "API 重定向已拒绝")
	}}
	response, e := client.Do(request)
	if e != nil {
		if ctx.Err() != nil {
			return GenerateResult{}, ctx.Err()
		}
		return GenerateResult{}, generationError(ErrorNetwork, "API 网络请求失败或超时")
	}
	defer response.Body.Close()
	if response.StatusCode != 200 {
		kind := ErrorUpstream
		if response.StatusCode == 401 || response.StatusCode == 403 {
			kind = ErrorAuthentication
		}
		if response.StatusCode == 429 {
			kind = ErrorLimit
		}
		return GenerateResult{}, generationError(kind, fmt.Sprintf("API 返回 HTTP %d", response.StatusCode))
	}
	media, _, _ := mime.ParseMediaType(response.Header.Get("Content-Type"))
	if media != "text/event-stream" {
		return GenerateResult{}, generationError(ErrorProtocol, "API 未返回 SSE 流；此连接只支持 Chat Completions 流式协议")
	}
	return readCompletionStream(ctx, response.Body, emit)
}

const maxProviderFrame = 8 << 20 // 1 MiB text can expand sixfold in JSON escapes.
func readCompletionStream(ctx context.Context, r io.Reader, emit func(ProviderEvent) error) (GenerateResult, error) {
	scan := bufio.NewScanner(r)
	scan.Buffer(make([]byte, 4096), maxProviderFrame)
	var frame, text strings.Builder
	finished := false
	protocol := func() (GenerateResult, error) {
		return GenerateResult{}, generationError(ErrorProtocol, "API 流协议无效或缺少成功终态")
	}
	dispatch := func() (bool, error) {
		data := strings.TrimSuffix(frame.String(), "\n")
		frame.Reset()
		if data == "" {
			return false, nil
		}
		if data == "[DONE]" {
			if !finished || text.Len() == 0 {
				return false, generationError(ErrorProtocol, "API 流缺少成功结束原因")
			}
			return true, nil
		}
		if !utf8.ValidString(data) {
			return false, generationError(ErrorProtocol, "API 返回无效 UTF-8")
		}
		var chunk struct {
			Error   json.RawMessage `json:"error"`
			Choices []struct {
				Index *int `json:"index"`
				Delta struct {
					Content      *string         `json:"content"`
					Refusal      *string         `json:"refusal"`
					ToolCalls    json.RawMessage `json:"tool_calls"`
					FunctionCall json.RawMessage `json:"function_call"`
				} `json:"delta"`
				FinishReason *string `json:"finish_reason"`
			} `json:"choices"`
		}
		if json.Unmarshal([]byte(data), &chunk) != nil {
			return false, generationError(ErrorProtocol, "API 流事件无效")
		}
		if len(chunk.Error) > 0 && string(chunk.Error) != "null" {
			return false, generationError(ErrorUpstream, "API 上游报告生成失败")
		}
		selected := false
		for _, choice := range chunk.Choices {
			if choice.Index == nil {
				return false, generationError(ErrorProtocol, "API 候选编号缺失")
			}
			if *choice.Index != 0 {
				continue
			}
			if selected {
				return false, generationError(ErrorProtocol, "API 候选编号重复")
			}
			selected = true
			if finished {
				return false, generationError(ErrorProtocol, "API 成功终态后仍有候选事件")
			}
			if choice.Delta.Refusal != nil && *choice.Delta.Refusal != "" {
				return false, generationError(ErrorUpstream, "API 拒绝回答")
			}
			if len(choice.Delta.ToolCalls) > 0 && string(choice.Delta.ToolCalls) != "null" || len(choice.Delta.FunctionCall) > 0 && string(choice.Delta.FunctionCall) != "null" {
				return false, generationError(ErrorCapability, "API 返回了不支持的工具调用")
			}
			if choice.Delta.Content != nil && *choice.Delta.Content != "" {
				part := *choice.Delta.Content
				if text.Len()+len(part) > 1<<20 {
					return false, generationError(ErrorLimit, "API 回答超过 1 MiB 限制")
				}
				text.WriteString(part)
				if emit != nil {
					if e := emit(ProviderEvent{Text: part}); e != nil {
						return false, e
					}
				}
			}
			if choice.FinishReason != nil {
				switch *choice.FinishReason {
				case "stop":
					finished = true
				case "length":
					return false, generationError(ErrorLimit, "API 回答达到输出限制")
				case "content_filter":
					return false, generationError(ErrorUpstream, "API 拒绝回答")
				default:
					return false, generationError(ErrorProtocol, "API 未正常完成回答")
				}
			}
		}
		return false, nil
	}
	for scan.Scan() {
		if ctx.Err() != nil {
			return GenerateResult{}, ctx.Err()
		}
		line := scan.Text()
		if line == "" {
			done, e := dispatch()
			if e != nil {
				return GenerateResult{}, e
			}
			if done {
				return GenerateResult{text.String(), "stop"}, nil
			}
			continue
		}
		if strings.HasPrefix(line, ":") {
			continue
		}
		field, value, found := strings.Cut(line, ":")
		if !found {
			value = ""
		}
		value = strings.TrimPrefix(value, " ")
		if field == "data" {
			if frame.Len()+len(value)+1 > maxProviderFrame {
				return protocol()
			}
			frame.WriteString(value)
			frame.WriteByte('\n')
		}
	}
	if ctx.Err() != nil {
		return GenerateResult{}, ctx.Err()
	}
	if scan.Err() != nil {
		return GenerateResult{}, generationError(ErrorNetwork, "API 流中断或事件过大")
	}
	// EOF is never completion, including EOF after finish_reason without [DONE].
	return protocol()
}
