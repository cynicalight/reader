package reader

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
)

func TestUsageLedgerKeepsConcurrentFailuresSnapshotsAndRetries(t *testing.T) {
	s, p := processingFixture(t)
	sink := s.processingUsageSink(p.DocumentID, "settling", "p1-b1")
	call := UsageCall{ID: "first", Provider: "codex", StartedAt: now(), Status: "running", Models: []ModelTokens{{Model: "actual", Tokens: &TokenCounts{InputTokens: 10, OutputTokens: 5, TotalTokens: 15, CachedInputTokens: tokenCount(7), ReasoningOutputTokens: tokenCount(2)}}}}
	if err := sink(call); err != nil {
		t.Fatal(err)
	}
	call.Status = "failed"
	call.FinishedAt = now()
	if err := sink(call); err != nil {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	for i := 0; i < 6; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			c := UsageCall{ID: fmt.Sprint("retry", i), Provider: "image-api", StartedAt: now(), FinishedAt: now(), Status: "complete", Models: []ModelTokens{{Model: "backup", Tokens: &TokenCounts{InputTokens: 2, OutputTokens: 1, TotalTokens: 3}}}}
			if err := sink(c); err != nil {
				t.Error(err)
			}
		}(i)
	}
	wg.Wait()
	call.ID = "unknown"
	call.Models = []ModelTokens{{Model: "", Tokens: nil}}
	if err := sink(call); err != nil {
		t.Fatal(err)
	}
	report, err := s.Store.usageReport("doc")
	if err != nil {
		t.Fatal(err)
	}
	if report.Total.TotalTokens != 33 || report.Total.InputTokens != 22 || report.Total.OutputTokens != 11 || (report.Total.CachedInputTokens == nil || *report.Total.CachedInputTokens != 7) || report.FailedCalls != 2 || report.PartialCalls != 1 || report.UnknownCalls != 1 || len(report.Calls) != 8 {
		t.Fatalf("%+v", report)
	}
	// A repeated snapshot must not count the same model's cumulative tokens twice.
	models := mergeModelTokens([]ModelTokens{{Model: "actual"}}, []ModelTokens{{Tokens: &TokenCounts{InputTokens: 1, OutputTokens: 2, TotalTokens: 3}}})
	models = mergeModelTokens(models, []ModelTokens{{Tokens: &TokenCounts{InputTokens: 2, OutputTokens: 4, TotalTokens: 6}}})
	if len(models) != 1 || models[0].Model != "actual" || models[0].Tokens.TotalTokens != 6 {
		t.Fatal(models)
	}
	// Durable through reopen, cascades with document deletion.
	reopened, err := OpenStore(s.Store.Root)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.DB.Close()
	r, err := reopened.usageReport("doc")
	if err != nil || r.Total.TotalTokens != report.Total.TotalTokens {
		t.Fatal(r, err)
	}
	if _, err = s.Store.DB.Exec("DELETE FROM documents WHERE id='doc'"); err != nil {
		t.Fatal(err)
	}
	var n int
	s.Store.DB.QueryRow("SELECT count(*) FROM processing_usage").Scan(&n)
	if n != 0 {
		t.Fatal(n)
	}
}
func TestUsageRecordsFallbackAndPreservesFailedUsage(t *testing.T) {
	s, _ := processingFixture(t)
	g := &GenerationService{primary: "codex", usageSink: s.processingUsageSink("doc", "settling", "p1-b1"), connections: map[string]generationConnection{
		"codex": {VerifiedText: true, VerifiedVision: true, Adapter: adapterFunc(func(ctx context.Context, req GenerateRequest, emit func(ProviderEvent) error) (GenerateResult, error) {
			emit(ProviderEvent{Metrics: []ModelTokens{{Model: "primary", Tokens: &TokenCounts{InputTokens: 4, OutputTokens: 1, TotalTokens: 5}}}})
			return GenerateResult{}, errors.New("upstream")
		})},
		"image-api": {VerifiedText: true, VerifiedVision: true, Adapter: adapterFunc(func(ctx context.Context, req GenerateRequest, emit func(ProviderEvent) error) (GenerateResult, error) {
			emit(ProviderEvent{Metrics: []ModelTokens{{Model: "backup", Tokens: &TokenCounts{InputTokens: 8, OutputTokens: 2, TotalTokens: 10}}}})
			emit(ProviderEvent{Text: "answer"})
			return GenerateResult{Text: "answer", FinishReason: "stop"}, nil
		})},
	}}
	result, err := g.Generate(t.Context(), AIInput{Image: []byte("png")}, false, nil)
	if err != nil || !result.Fallback {
		t.Fatal(result, err)
	}
	r, err := s.Store.usageReport("doc")
	if err != nil || len(r.Calls) != 2 || r.Total.TotalTokens != 15 || r.UnknownCalls != 0 || r.PartialCalls != 1 {
		t.Fatal(r, err)
	}
}
func TestUsageUnknownHistoryAndInterruptedAttempt(t *testing.T) {
	s, p := processingFixture(t)
	p.UsageTracked = false
	s.Store.saveProcessing(p)
	sink := s.processingUsageSink("doc", "translating", "p1-b1")
	sink(UsageCall{ID: "open", Provider: "kimi", StartedAt: now(), Status: "running", Models: []ModelTokens{{Model: "kimi", Tokens: nil}}})
	if err := s.Store.recoverUsage(); err != nil {
		t.Fatal(err)
	}
	r, err := s.Store.usageReport("doc")
	if err != nil || r.HistoryComplete || r.UnknownCalls != 1 || r.Calls[0].Status != "interrupted" {
		t.Fatal(r, err)
	}
	s.Token = "test-secret"
	response := request(t, s, "GET", "/api/documents/doc/processing-usage", nil)
	if response.Code != 200 {
		t.Fatal(response.Body.String())
	}
}
func TestAPIUsageOnlyFrameAfterFinishIsNotText(t *testing.T) {
	wire := `data: {"model":"actual-api","choices":[{"index":0,"delta":{"content":"answer"}}]}` + "\n\n" + `data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}` + "\n\n" + `data: {"choices":[],"usage":{"prompt_tokens":10,"completion_tokens":3,"total_tokens":13,"prompt_tokens_details":{"cached_tokens":7},"completion_tokens_details":{"reasoning_tokens":1}}}` + "\n\n" + "data: [DONE]\n\n"
	var models []ModelTokens
	var text string
	result, err := readCompletionStream(t.Context(), strings.NewReader(wire), func(event ProviderEvent) error {
		models = mergeModelTokens(models, event.Metrics)
		text += event.Text
		return nil
	})
	if err != nil || result.Text != "answer" || text != "answer" || len(models) != 1 || models[0].Model != "actual-api" || models[0].Tokens.TotalTokens != 13 {
		t.Fatal(result, models, err)
	}
	if completionTokens(&completionUsage{}) != nil {
		t.Fatal("missing counts became zero")
	}
}
func TestClaudeUsageNormalizesCacheAndMultipleModels(t *testing.T) {
	var metrics []ModelTokens
	reportClaudeMetrics([]byte(`{"type":"result","modelUsage":{"model-a":{"inputTokens":10,"outputTokens":5,"cacheReadInputTokens":7,"cacheCreationInputTokens":3},"model-b":{"inputTokens":2,"outputTokens":1}}}`), []func([]ModelTokens){func(m []ModelTokens) { metrics = m }})
	if len(metrics) != 2 || metrics[0].Tokens.TotalTokens != 25 || metrics[0].Tokens.InputTokens != 20 || metrics[1].Tokens.TotalTokens != 3 {
		t.Fatal(metrics)
	}
}
func TestCodexUsageUsesThreadTotalAndFiltersOtherThreads(t *testing.T) {
	// Real adapter with the existing CLI protocol fixture, no live credentials.
	fakeAgent(t, "codex", "usage")
	root := t.TempDir()
	os.MkdirAll(filepath.Join(root, "ai-work"), 0700)
	var models []ModelTokens
	text, err := invokeCLI(t.Context(), root, "codex", "", AIInput{Prompt: "test"}, nil, func(m []ModelTokens) { models = mergeModelTokens(models, m) })
	if err != nil || text != "你好，世界" || len(models) != 1 || models[0].Model != "actual-codex" || models[0].Tokens == nil || models[0].Tokens.TotalTokens != 30 {
		b, _ := json.Marshal(models)
		t.Fatalf("%s %s %v", text, b, err)
	}
}

func TestCodexMissingCountersRemainUnknown(t *testing.T) {
	for _, raw := range []string{`{}`, `{"inputTokens":null,"outputTokens":0,"totalTokens":0}`, `{"inputTokens":-1,"outputTokens":1,"totalTokens":0}`} {
		if codexTokens(json.RawMessage(raw)) != nil {
			t.Fatal(raw)
		}
	}
	metrics := []ModelTokens{}
	reportClaudeMetrics([]byte(`{"type":"result","modelUsage":{"model":{}}}`), []func([]ModelTokens){func(m []ModelTokens) { metrics = m }})
	if len(metrics) != 1 || metrics[0].Tokens != nil {
		t.Fatal(metrics)
	}
}
func TestUsageStorageFailureDoesNotTriggerFallback(t *testing.T) {
	attempts := 0
	g := &GenerationService{primary: "codex", usageSink: func(UsageCall) error { return errors.New("storage unavailable") }, connections: map[string]generationConnection{}}
	for _, provider := range []string{"codex", "text-api"} {
		g.connections[provider] = generationConnection{VerifiedText: true, Adapter: adapterFunc(func(context.Context, GenerateRequest, func(ProviderEvent) error) (GenerateResult, error) {
			attempts++
			return GenerateResult{}, nil
		})}
	}
	_, err := g.Generate(t.Context(), AIInput{}, false, nil)
	if errorKind(err) != ErrorSave || attempts != 0 {
		t.Fatal(err, attempts)
	}
}
