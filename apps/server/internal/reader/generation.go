package reader

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"
)

type ErrorKind string

const (
	ErrorConfiguration  ErrorKind = "configuration"
	ErrorAuthentication ErrorKind = "authentication"
	ErrorCapability     ErrorKind = "capability"
	ErrorProtocol       ErrorKind = "protocol"
	ErrorUpstream       ErrorKind = "upstream"
	ErrorLimit          ErrorKind = "limit"
	ErrorNetwork        ErrorKind = "network"
	ErrorTimeout        ErrorKind = "timeout"
	ErrorCanceled       ErrorKind = "canceled"
	ErrorSave           ErrorKind = "save"
)

type GenerationError struct {
	Kind    ErrorKind
	Message string
}

func (e *GenerationError) Error() string                   { return e.Message }
func generationError(kind ErrorKind, message string) error { return &GenerationError{kind, message} }
func errorKind(err error) ErrorKind {
	if errors.Is(err, context.Canceled) {
		return ErrorCanceled
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return ErrorTimeout
	}
	var e *GenerationError
	if errors.As(err, &e) {
		return e.Kind
	}
	return ErrorUpstream
}

type ProviderEvent struct {
	Text     string
	Fallback string
}
type GenerateRequest struct{ Input AIInput }
type GenerateResult struct {
	Text         string
	FinishReason string
}
type Adapter interface {
	Stream(context.Context, GenerateRequest, func(ProviderEvent) error) (GenerateResult, error)
}

// Connections and secrets are request-local snapshots, never wire objects.
type generationConnection struct {
	Adapter                      Adapter
	VerifiedText, VerifiedVision bool
	Incremental                  bool
}
type GenerationService struct {
	primary     string
	connections map[string]generationConnection
}

func newGenerationService(root string, config AIConfig) *GenerationService {
	g := &GenerationService{primary: config.Primary, connections: map[string]generationConnection{}}
	for _, p := range []string{"codex", "claude", "kimi", "text-api", "image-api"} {
		var adapter Adapter = cliAdapter{root, p, config.Models[p]}
		if p == "text-api" {
			adapter = apiAdapter{config.TextAPI}
		}
		if p == "image-api" {
			adapter = apiAdapter{config.ImageAPI}
		}
		g.connections[p] = generationConnection{adapter, capable(config, p, false), capable(config, p, true), true}
	}
	return g
}

type cliAdapter struct{ root, provider, model string }

func (a cliAdapter) Stream(ctx context.Context, req GenerateRequest, emit func(ProviderEvent) error) (GenerateResult, error) {
	child, cancel := context.WithCancel(ctx)
	defer cancel()
	var emitErr error
	text, err := invokeCLI(child, a.root, a.provider, a.model, req.Input, func(part string) {
		if emitErr == nil && emit != nil {
			emitErr = emit(ProviderEvent{Text: part})
			if emitErr != nil {
				cancel()
			}
		}
	})
	if emitErr != nil {
		return GenerateResult{}, emitErr
	}
	if err != nil {
		return GenerateResult{}, err
	}
	return GenerateResult{text, "stop"}, nil
}
func legacyEmitter(delta, fallback func(string)) func(ProviderEvent) error {
	if delta == nil && fallback == nil {
		return nil
	}
	return func(e ProviderEvent) error {
		if e.Text != "" && delta != nil {
			delta(e.Text)
		}
		if e.Fallback != "" && fallback != nil {
			fallback(e.Fallback)
		}
		return nil
	}
}

// Each attempt owns its accumulator. An emit error closes the gate immediately;
// late callbacks cannot escape even if a faulty adapter ignores cancellation.
func runAttempt(ctx context.Context, adapter Adapter, in AIInput, emit func(ProviderEvent) error) (GenerateResult, error) {
	child, cancel := context.WithCancel(ctx)
	defer cancel()
	var mu sync.Mutex
	var text strings.Builder
	var emitErr error
	closed := false
	result, err := adapter.Stream(child, GenerateRequest{in}, func(e ProviderEvent) error {
		mu.Lock()
		defer mu.Unlock()
		if closed {
			return generationError(ErrorProtocol, "生成已结束")
		}
		if emitErr != nil {
			return emitErr
		}
		if child.Err() != nil {
			return child.Err()
		}
		if e.Fallback != "" {
			emitErr = generationError(ErrorProtocol, "适配器事件无效")
		} else if text.Len()+len(e.Text) > 1<<20 {
			emitErr = generationError(ErrorLimit, "回答超过 1 MiB 限制")
		} else if e.Text != "" {
			text.WriteString(e.Text)
			if emit != nil {
				emitErr = emit(e)
			}
		}
		if emitErr != nil {
			cancel()
		}
		return emitErr
	})
	mu.Lock()
	defer mu.Unlock()
	closed = true
	if emitErr != nil {
		return GenerateResult{}, emitErr
	}
	if ctx.Err() != nil {
		return GenerateResult{}, ctx.Err()
	}
	if err != nil {
		return GenerateResult{}, err
	}
	if result.FinishReason != "stop" || text.Len() == 0 || result.Text != text.String() {
		return GenerateResult{}, generationError(ErrorProtocol, "完整回答与流式片段或成功终态不一致")
	}
	return result, nil
}
func (g *GenerationService) Generate(ctx context.Context, in AIInput, interactive bool, emit func(ProviderEvent) error) (AIResult, error) {
	ctx, cancel := context.WithTimeout(ctx, 3*time.Minute)
	defer cancel()
	if !validAgent(g.primary) {
		return AIResult{}, generationError(ErrorConfiguration, "请在设置中指定主 Agent 并测试")
	}
	vision := len(in.images()) > 0
	primary := g.connections[g.primary]
	visible := false
	send := func(e ProviderEvent) error {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if emit != nil {
			if e.Text != "" {
				visible = true
			}
			if err := emit(e); err != nil {
				cancel()
				return err
			}
		}
		return nil
	}
	var result GenerateResult
	err := generationError(ErrorCapability, "主 Agent 尚未通过所需能力测试")
	// Existing Codex/Claude text chat works with CLI login without a saved probe.
	if primary.VerifiedText && (!vision || primary.VerifiedVision) || interactive && !vision && g.primary != "kimi" {
		result, err = runAttempt(ctx, primary.Adapter, in, send)
	}
	if err == nil {
		return AIResult{result.Text, g.primary, false}, nil
	}
	if ctx.Err() != nil {
		return AIResult{}, ctx.Err()
	}
	if visible {
		return AIResult{}, err
	}
	target := "text-api"
	if vision {
		target = "image-api"
	}
	backup := g.connections[target]
	if !backup.VerifiedText || vision && !backup.VerifiedVision {
		return AIResult{}, err
	}
	if err = send(ProviderEvent{Fallback: fmt.Sprintf("%s 调用失败，已切换到 %s", g.primary, target)}); err != nil {
		return AIResult{}, err
	}
	result, err = runAttempt(ctx, backup.Adapter, in, send)
	return AIResult{result.Text, target, true}, err
}

func (g *GenerationService) ValidateInput(in AIInput, interactive bool) error {
	if !validAgent(g.primary) {
		return generationError(ErrorConfiguration, "请选择主 Agent")
	}
	vision := len(in.images()) > 0
	p := g.connections[g.primary]
	if p.VerifiedText && (!vision || p.VerifiedVision) || interactive && !vision && g.primary != "kimi" {
		return nil
	}
	target := "text-api"
	if vision {
		target = "image-api"
	}
	b := g.connections[target]
	if b.VerifiedText && (!vision || b.VerifiedVision) {
		return nil
	}
	return generationError(ErrorCapability, "当前助手尚未通过所需能力测试，请在设置中测试连接或配置备用 API")
}
