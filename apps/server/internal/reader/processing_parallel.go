package reader

import (
	"context"
	"errors"
	"sync"
)

// Each lane owns its counters and state. Serialize read/merge/write in Store so
// concurrent progress never overwrites the other lane or its completed results.
func mergeProcessing(current, update Processing) Processing {
	if update.lane != "" {
		stage := &ProcessingStage{Status: update.Status, Detail: update.Detail, Warning: update.Warning}
		if update.lane == "settling" {
			current.Settling = stage
			current.AssetsDone, current.AssetsTotal = update.AssetsDone, update.AssetsTotal
		} else {
			current.Translating = stage
			current.TranslationsDone, current.TranslationsTotal = update.TranslationsDone, update.TranslationsTotal
		}
	} else {
		for _, stage := range []*ProcessingStage{current.Settling, current.Translating} {
			if stage == nil {
				continue
			}
			if (update.resetStages && (stage.Status == "failed" || stage.Status == "waiting")) || (update.wakeStages && stage.Status == "waiting") || (update.recoverStages && stage.Status == "running") {
				stage.Status = "queued"
				stage.Detail = "等待继续处理"
			}
		}
		if update.queueTranslation && (current.Translating == nil || current.Translating.Status != "running") {
			current.Translating = &ProcessingStage{Status: "queued", Detail: "等待翻译正文与公式"}
		}
		if current.Settling == nil && current.Translating == nil {
			current.Status, current.Detail = update.Status, update.Detail
		}
	}
	if current.Settling != nil || current.Translating != nil {
		aggregateProcessing(&current)
	}
	return current
}
func aggregateProcessing(p *Processing) {
	stages := []struct {
		phase string
		value *ProcessingStage
	}{{"settling", p.Settling}, {"translating", p.Translating}}
	for _, status := range []string{"running", "queued", "failed", "waiting"} {
		for _, stage := range stages {
			if stage.value != nil && stage.value.Status == status {
				p.Phase, p.Status, p.Detail = stage.phase, status, stage.value.Detail
				p.CompletedAt = ""
				return
			}
		}
	}
	p.Phase, p.Status, p.Detail = "ready", "complete", "正文翻译与图表沉淀已就绪"
	p.CompletedAt = now()
	if p.Incomplete {
		p.Detail = "部分就绪：有页面缺少可提取文字，尚未接入 OCR"
	}
}

// Both lanes start after the manifest is published, under one document lifetime.
// A provider failure or missing capability in one lane does not cancel the other.
func (s *Server) processPDF(ctx context.Context, p *Processing) error {
	m, err := s.readLayout(p.DocumentID)
	if err != nil {
		p.Settling = &ProcessingStage{Status: "failed", Detail: err.Error()}
		p.Translating = &ProcessingStage{Status: "failed", Detail: err.Error()}
		aggregateProcessing(p)
		return errors.Join(err, s.Store.saveProcessing(*p))
	}
	var workers sync.WaitGroup
	results := make(chan error, 2)
	for _, lane := range []string{"settling", "translating"} {
		stage := p.Settling
		if lane == "translating" {
			stage = p.Translating
		}
		if stage != nil && stage.Status == "complete" {
			continue
		}
		if stage != nil && (stage.Status == "failed" || stage.Status == "waiting") {
			if stage.Status == "failed" {
				results <- errors.New(stage.Detail)
			}
			continue
		}
		work := *p
		work.lane, work.Phase, work.Status = lane, lane, "running"
		work.Warning = ""
		workers.Add(1)
		go func() {
			defer workers.Done()
			var runErr error
			if runErr = s.Store.saveProcessing(work); runErr == nil {
				if work.lane == "settling" {
					runErr = s.settleAssets(ctx, &work)
				} else {
					runErr = s.translatePDFContent(ctx, &work, m)
				}
			}
			if ctx.Err() != nil {
				work.Status, work.Detail = "queued", "已暂停，将在下次启动时继续"
			} else if runErr != nil {
				work.Status, work.Detail = "failed", runErr.Error()
			} else if work.Status != "waiting" {
				work.Status, work.Detail = "complete", "已完成"
			}
			s.processingMu.Lock()
			if work.lane == "translating" && ctx.Err() == nil && work.Status != "waiting" {
				items, readErr := s.translations(work.DocumentID, m)
				if readErr == nil {
					for _, item := range items {
						if item.Status == "pending" || item.Status == "running" {
							work.Status, work.Detail = "queued", "等待继续翻译"
							break
						}
					}
				}
			}
			var saveErr error
			// Capability waits are already published under configMu. Do not overwrite a
			// configuration wake that requeued this lane between return and finalization.
			if work.Status != "waiting" || runErr != nil {
				saveErr = s.Store.saveProcessing(work)
			}
			s.processingMu.Unlock()
			results <- errors.Join(runErr, saveErr)
		}()
	}
	workers.Wait()
	close(results)
	var failures []error
	for result := range results {
		failures = append(failures, result)
	}
	latest, readErr := s.Store.processing(p.DocumentID)
	if readErr == nil {
		*p = latest
	}
	return errors.Join(append(failures, readErr)...)
}

func hasFailedStage(p Processing) bool {
	return (p.Settling != nil && p.Settling.Status == "failed") || (p.Translating != nil && p.Translating.Status == "failed")
}
