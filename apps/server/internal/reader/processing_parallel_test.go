package reader

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
)

func TestProcessingWakeDoesNotResetFailedTranslation(t *testing.T) {
	s, p := processingFixture(t)
	if err := s.learnPDF(context.Background(), &p); err != nil {
		t.Fatal(err)
	}
	p.Translating = &ProcessingStage{Status: "failed", Detail: "text failed"}
	aggregateProcessing(&p)
	if err := s.Store.saveProcessing(p); err != nil {
		t.Fatal(err)
	}
	s.wakeProcessing()
	state, _ := s.Store.processing("doc")
	if state.Translating.Status != "failed" || state.Status != "failed" {
		t.Fatalf("wake altered failed translation: %+v", state)
	}
}
func TestProcessingRetryKeepsCompletedTranslation(t *testing.T) {
	s, p := processingFixture(t)
	s.Token = "test-secret"
	if err := s.learnPDF(context.Background(), &p); err != nil {
		t.Fatal(err)
	}
	p.Translating = &ProcessingStage{Status: "complete"}
	p.TranslationsDone = 5
	aggregateProcessing(&p)
	if err := s.Store.saveProcessing(p); err != nil {
		t.Fatal(err)
	}
	w := request(t, s, "POST", "/api/documents/doc/processing", nil)
	if w.Code != 200 {
		t.Fatalf("%s", w.Body.String())
	}
	state, _ := s.Store.processing("doc")
	if state.Translating.Status != "complete" || state.TranslationsDone != 5 {
		t.Fatalf("retry altered completed translation: %+v", state)
	}
}

// Rows saved while image consolidation existed must not stay blocked on it.
func TestStartupDropsLegacyConsolidationState(t *testing.T) {
	cases := []struct {
		name, phase, status, body string
		wantPhase, wantStatus     string
	}{
		{"waiting consolidation, translated", "settling", "waiting",
			`{"documentId":"doc","phase":"settling","status":"waiting","settling":{"status":"waiting","detail":"请选择主 Agent"},"translating":{"status":"complete","detail":"已完成"},"assetsDone":0,"assetsTotal":3}`,
			"ready", "complete"},
		{"failed consolidation, translation running", "settling", "failed",
			`{"documentId":"doc","phase":"settling","status":"failed","settling":{"status":"failed","detail":"image failed"},"translating":{"status":"running","detail":"翻译中"}}`,
			"translating", "queued"},
		{"queued before translation lane existed", "settling", "queued",
			`{"documentId":"doc","phase":"settling","status":"queued","detail":"等待解析图表"}`,
			"translating", "queued"},
		{"completed before translation lane existed", "ready", "complete",
			`{"documentId":"doc","phase":"ready","status":"complete","completedAt":"2026-01-01T00:00:00Z","settling":{"status":"complete"}}`,
			"ready", "complete"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			s, _ := processingFixture(t)
			if _, err := s.Store.DB.Exec("UPDATE document_processing SET phase=?, status=?, body=? WHERE document_id='doc'", c.phase, c.status, c.body); err != nil {
				t.Fatal(err)
			}
			ctx, cancel := context.WithCancel(context.Background())
			cancel()
			s.StartProcessing(ctx)()
			var phase, status, body string
			if err := s.Store.DB.QueryRow("SELECT phase,status,body FROM document_processing WHERE document_id='doc'").Scan(&phase, &status, &body); err != nil {
				t.Fatal(err)
			}
			if phase != c.wantPhase || status != c.wantStatus || strings.Contains(body, "settling") || strings.Contains(body, "assets") {
				t.Fatalf("phase=%s status=%s body=%s", phase, status, body)
			}
			var p Processing
			if err := json.Unmarshal([]byte(body), &p); err != nil || p.Translating == nil {
				t.Fatalf("translation stage missing: %s", body)
			}
			if c.name == "completed before translation lane existed" && p.CompletedAt != "2026-01-01T00:00:00Z" {
				t.Fatalf("completion time rewritten: %s", p.CompletedAt)
			}
		})
	}
}
