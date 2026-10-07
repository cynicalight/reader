package reader

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"
)

type ProcessingStage struct {
	Status  string `json:"status"`
	Detail  string `json:"detail"`
	Warning string `json:"warning,omitempty"`
}
type Processing struct {
	Enabled           bool             `json:"enabled"`
	Translating       *ProcessingStage `json:"translating,omitempty"`
	lane              string
	resetStages       bool
	wakeStages        bool
	recoverStages     bool
	queueTranslation  bool
	UsageTracked      bool   `json:"usageTracked,omitempty"`
	StartedAt         string `json:"startedAt,omitempty"`
	CompletedAt       string `json:"completedAt,omitempty"`
	Incomplete        bool   `json:"incomplete"`
	DocumentID        string `json:"documentId"`
	Phase             string `json:"phase"`
	Status            string `json:"status"`
	PagesDone         int    `json:"pagesDone"`
	PagesTotal        int    `json:"pagesTotal"`
	TranslationsDone  int    `json:"translationsDone"`
	TranslationsTotal int    `json:"translationsTotal"`
	Detail            string `json:"detail"`
	Warning           string `json:"warning,omitempty"`
	UpdatedAt         string `json:"updatedAt"`
}
type PDFBlock struct {
	ID     string `json:"id"`
	Page   int    `json:"page"`
	Label  string `json:"label"`
	Bounds struct {
		X      float64 `json:"x"`
		Y      float64 `json:"y"`
		Width  float64 `json:"width"`
		Height float64 `json:"height"`
	} `json:"bounds"`
	Text    string `json:"text"`
	Image   string `json:"image,omitempty"`
	Caption string `json:"caption,omitempty"`
}
type layoutManifest struct {
	ProcessedPages  []int      `json:"processedPages,omitempty"`
	IncompletePages []int      `json:"incompletePages"`
	Pages           int        `json:"pages"`
	Blocks          []PDFBlock `json:"blocks"`
	Warnings        []string   `json:"warnings"`
}

var blockIDPattern = regexp.MustCompile(`^p[1-9][0-9]*-b[1-9][0-9]*$`)

func (s *Store) processing(id string) (Processing, error) {
	var p Processing
	var body string
	e := s.DB.QueryRow("SELECT body FROM document_processing WHERE document_id=?", id).Scan(&body)
	if e == nil {
		e = json.Unmarshal([]byte(body), &p)
	}
	return p, e
}
func (s *Store) saveProcessing(p Processing) error {
	s.processingWriteMu.Lock()
	defer s.processingWriteMu.Unlock()
	if p.lane != "" || p.resetStages || p.wakeStages || p.recoverStages || p.queueTranslation {
		current, err := s.processing(p.DocumentID)
		if err != nil {
			return err
		}
		p = mergeProcessing(current, p)
	}
	p.UpdatedAt = now()
	b, e := json.Marshal(p)
	if e != nil {
		return e
	}
	_, e = s.DB.Exec("INSERT INTO document_processing(document_id,phase,status,body) VALUES(?,?,?,?) ON CONFLICT(document_id) DO UPDATE SET phase=excluded.phase,status=excluded.status,body=excluded.body", p.DocumentID, p.Phase, p.Status, b)
	return e
}
func initialProcessing(id string) Processing {
	return Processing{UsageTracked: true, DocumentID: id, Phase: "learning", Status: "paused", Detail: "翻译未开始", UpdatedAt: now()}
}

// Only document creation reads this preference; updating settings never wakes a job.
func importedProcessing(id, value string) Processing {
	p := initialProcessing(id)
	var settings struct {
		AutoTranslatePDF *bool `json:"autoTranslatePDF"`
	}
	if (value == "" || json.Unmarshal([]byte(value), &settings) == nil) && (settings.AutoTranslatePDF == nil || *settings.AutoTranslatePDF) {
		p.Enabled, p.Status, p.Detail = true, "queued", "等待解析 PDF"
	}
	return p
}
func (s *Store) enqueuePDF(d Document) error {
	if d.Type != "pdf" {
		return nil
	}
	var value string
	_ = s.DB.QueryRow("SELECT value FROM settings WHERE key='reader'").Scan(&value)
	p := importedProcessing(d.ID, value)
	b, _ := json.Marshal(p)
	_, e := s.DB.Exec("INSERT OR IGNORE INTO document_processing(document_id,phase,status,body) VALUES(?,?,?,?)", d.ID, p.Phase, p.Status, b)
	return e
}
func (s *Server) processingList(w http.ResponseWriter, r *http.Request) {
	rows, e := s.Store.DB.Query("SELECT body FROM document_processing ORDER BY rowid DESC")
	if e != nil {
		fail(w, 500, "无法读取解析进度")
		return
	}
	defer rows.Close()
	out := []Processing{}
	for rows.Next() {
		var b string
		var p Processing
		if rows.Scan(&b) != nil || json.Unmarshal([]byte(b), &p) != nil {
			fail(w, 500, "解析进度损坏")
			return
		}
		out = append(out, p)
	}
	respond(w, 200, out)
}
func (s *Server) retryProcessing(w http.ResponseWriter, r *http.Request) {
	d, e := s.Store.Document(r.PathValue("id"))
	if e != nil {
		fail(w, 404, "文档不存在")
		return
	}
	if d.Type != "pdf" {
		fail(w, 400, "此解析流程用于 PDF")
		return
	}
	s.processingMu.Lock()
	defer s.processingMu.Unlock()
	p, e := s.Store.processing(d.ID)
	if e != nil {
		e = s.Store.enqueuePDF(d)
		p = initialProcessing(d.ID)
	}
	if e != nil {
		fail(w, 500, "无法创建解析任务")
		return
	}
	if !p.Enabled {
		fail(w, 409, "请先开始翻译")
		return
	}
	if p.Status == "complete" || (p.Status == "running" && !hasFailedStage(p)) {
		respond(w, 200, p)
		return
	}
	p.Status = "queued"
	p.Detail = "等待继续处理"
	p.resetStages = true
	if e = s.retryFailedTranslations(d.ID); e != nil {
		fail(w, 500, "无法恢复翻译任务")
		return
	}
	if e = s.Store.saveProcessing(p); e != nil {
		fail(w, 500, "无法继续处理")
		return
	}
	latest, err := s.Store.processing(d.ID)
	if err != nil {
		fail(w, 500, "无法读取处理状态")
		return
	}
	respond(w, 200, latest)
}
func (s *Server) documentBlocks(w http.ResponseWriter, r *http.Request) {
	d, e := s.Store.Document(r.PathValue("id"))
	if e != nil {
		fail(w, 404, "文档不存在")
		return
	}
	manifest, e := s.readLayout(d.ID)
	if e != nil {
		respond(w, 200, []PDFBlock{})
		return
	}
	blocks := []PDFBlock{}
	for _, b := range manifest.Blocks {
		if b.Image != "" || strings.TrimSpace(b.Text) != "" {
			blocks = append(blocks, b)
		}
	}
	respond(w, 200, blocks)
}
func (s *Server) analysisDir(id string) string {
	return filepath.Join(s.Store.Root, "cache", id, "analysis")
}
func (s *Server) readLayout(id string) (layoutManifest, error) {
	return readLayoutDirectory(s.analysisDir(id))
}
func readLayoutDirectory(dir string) (layoutManifest, error) {
	var m layoutManifest
	b, e := os.ReadFile(filepath.Join(dir, "manifest.json"))
	if e != nil {
		return m, e
	}
	if len(b) > 32<<20 {
		return m, errors.New("版面索引过大")
	}
	e = json.Unmarshal(b, &m)
	if e != nil || m.Pages < 1 || m.Pages > 1000 {
		return m, errors.New("版面索引无效")
	}
	known := processedPages(m)
	for _, page := range m.ProcessedPages {
		if page < 1 || page > m.Pages {
			return m, errors.New("缓存页码无效")
		}
	}
	for _, b := range m.Blocks {
		r := b.Bounds
		if !known[b.Page] || !blockIDPattern.MatchString(b.ID) || b.Page < 1 || b.Page > m.Pages || r.X < 0 || r.Y < 0 || r.Width <= 0 || r.Height <= 0 || r.X+r.Width > 1.001 || r.Y+r.Height > 1.001 || (b.Image != "" && b.Image != "assets/"+b.ID+".png") {
			return m, errors.New("版面位置无效")
		}
	}
	return m, nil
}

// A layout queue keeps imports responsive; the post-layout queue translates.
// Stop waits for children before the library database is closed.
func (s *Server) StartProcessing(parent context.Context) func() {
	ctx, cancel := context.WithCancel(parent)
	if err := s.Store.recoverUsage(); err != nil {
		log.Printf("cannot recover processing usage: %v", err)
	}
	if err := s.Store.dropSettlingState(); err != nil {
		log.Printf("cannot migrate processing state: %v", err)
	}
	s.pauseLegacyProcessing()
	var workers sync.WaitGroup
	rows, e := s.Store.DB.Query("SELECT body FROM document_processing WHERE status='running' OR json_extract(body,'$.translating.status')='running'")
	if e == nil {
		var pending []Processing
		for rows.Next() {
			var b string
			var p Processing
			if rows.Scan(&b) == nil && json.Unmarshal([]byte(b), &p) == nil {
				pending = append(pending, p)
			}
		}
		rows.Close()
		for _, p := range pending {
			if !p.Enabled {
				continue
			}
			p.Status = "queued"
			p.Detail = "继续上次的处理"
			p.recoverStages = true
			_ = s.Store.saveProcessing(p)
		}
	}
	for _, phase := range []string{"learning", "translating"} {
		workers.Add(1)
		go func(phase string) {
			defer workers.Done()
			tick := time.NewTicker(time.Second)
			defer tick.Stop()
			for {
				select {
				case <-ctx.Done():
					return
				case <-tick.C:
				}
				s.processingMu.Lock()
				var body string
				e := s.Store.DB.QueryRow("SELECT body FROM document_processing WHERE phase=? AND status='queued' AND json_extract(body,'$.enabled')=1 ORDER BY rowid LIMIT 1", phase).Scan(&body)
				var p Processing
				if e == nil {
					e = json.Unmarshal([]byte(body), &p)
				}
				if e == nil && (s.activeProcessing[p.DocumentID] != nil || s.blockedProcessing[p.DocumentID]) {
					e = errors.New("processing still finishing")
				}
				var task *documentTask
				workContext := ctx
				if e == nil {
					task = &documentTask{done: make(chan struct{})}
					workContext, task.cancel = context.WithCancel(ctx)
					if s.activeProcessing == nil {
						s.activeProcessing = map[string]*documentTask{}
					}
					s.activeProcessing[p.DocumentID] = task
					p.Status = "running"
					if p.StartedAt == "" {
						p.StartedAt = now()
					}
					p.CompletedAt = ""
					e = s.Store.saveProcessing(p)
				}
				s.processingMu.Unlock()
				if e != nil {
					s.finishProcessingTask(p.DocumentID, task)
					continue
				}
				work, finish, startErr := s.beginDocumentTask(workContext, p.DocumentID)
				if startErr != nil {
					s.finishProcessingTask(p.DocumentID, task)
					continue
				}
				if phase == "learning" {
					finishStage, stageErr := s.startUsageStage(p.DocumentID, "learning")
					if stageErr != nil {
						e = stageErr
					} else {
						e = s.learnPDF(work, &p)
						if endErr := finishStage(); e == nil {
							e = endErr
						}
					}
				} else {
					e = s.processPDF(work, &p)
				}
				if e != nil && phase == "learning" {
					if ctx.Err() != nil {
						p.Status = "queued"
						p.Detail = "已暂停，将在下次启动时继续"
					} else {
						p.Status = "failed"
						p.Detail = e.Error()
					}
					_ = s.Store.saveProcessing(p)
				}
				finish()
				s.finishProcessingTask(p.DocumentID, task)
			}
		}(phase)
	}
	workers.Add(1)
	go func() { defer workers.Done(); s.classificationWorker(ctx) }()
	return func() { cancel(); workers.Wait() }
}
func (s *Server) wakeProcessing() {
	s.processingMu.Lock()
	defer s.processingMu.Unlock()
	// Reset only jobs blocked on a missing connection, never interrupted/failed jobs.
	rows, e := s.Store.DB.Query("SELECT body FROM document_processing WHERE status='waiting' OR json_extract(body,'$.translating.status')='waiting'")
	if e != nil {
		return
	}
	var pending []Processing
	for rows.Next() {
		var b string
		var p Processing
		if rows.Scan(&b) == nil && json.Unmarshal([]byte(b), &p) == nil {
			pending = append(pending, p)
		}
	}
	rows.Close()
	for _, p := range pending {
		if !p.Enabled {
			continue
		}
		p.Status = "queued"
		p.Detail = "等待继续处理"
		p.wakeStages = true
		_ = s.Store.saveProcessing(p)
	}
}
func (s *Server) learnPDF(ctx context.Context, p *Processing) error {
	d, e := s.Store.Document(p.DocumentID)
	if e != nil {
		return e
	}
	m, e := s.readLayout(d.ID)
	missing := missingPages(m, 1, m.Pages)
	if e != nil || len(missing) > 0 {
		worker := os.Getenv("READER_PROCESSOR")
		node := os.Getenv("READER_NODE")
		if worker == "" || node == "" {
			return errors.New("本地解析程序未启动，请重新构建并打开 Reader")
		}
		work := filepath.Join(s.Store.Root, "cache", d.ID, "analysis-work")
		if e = os.RemoveAll(work); e != nil {
			return errors.New("无法清理未完成的解析")
		}
		child, cancel := context.WithTimeout(ctx, 30*time.Minute)
		defer cancel()
		args := []string{worker, "--input", s.Store.File(d), "--output", work, "--model-cache", filepath.Join(s.Store.Root, "models")}
		if len(missing) > 0 {
			args = append(args, "--pages", pageArguments(missing))
		}
		cmd := exec.CommandContext(child, node, args...)
		cmd.Env = append(os.Environ(), "ELECTRON_RUN_AS_NODE=1", "NODE_USE_ENV_PROXY=1")
		cmd.WaitDelay = 3 * time.Second
		cmd.Dir = s.Store.Root
		cmd.Stderr = io.Discard
		out, e := cmd.StdoutPipe()
		if e != nil {
			return e
		}
		if e = cmd.Start(); e != nil {
			return errors.New("无法启动本地 PDF 解析程序")
		}
		scan := bufio.NewScanner(out)
		scan.Buffer(make([]byte, 4096), 1<<20)
		var saveErr error
		for scan.Scan() {
			var event struct {
				Event      string `json:"event"`
				Page       int    `json:"page"`
				Total      int    `json:"total"`
				Downloaded int64  `json:"downloaded"`
				Bytes      int64  `json:"bytes"`
			}
			if json.Unmarshal(scan.Bytes(), &event) != nil {
				continue
			}
			switch event.Event {
			case "model-download":
				p.Detail = "首次准备版面模型（约 130 MB）"
			case "model-progress":
				p.Detail = fmt.Sprintf("正在下载版面模型 %.0f / %.0f MB", float64(event.Downloaded)/1e6, float64(event.Bytes)/1e6)
			case "page":
				p.PagesDone++
				p.PagesTotal = event.Total
				p.Detail = fmt.Sprintf("已解析 %d / %d 页", event.Page, event.Total)
			default:
				continue
			}
			if saveErr = s.Store.saveProcessing(*p); saveErr != nil {
				cancel()
				break
			}
		}
		if scan.Err() != nil {
			cancel()
		}
		e = cmd.Wait()
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if saveErr != nil {
			return errors.New("无法保存解析进度")
		}
		if e != nil || scan.Err() != nil {
			return errors.New("PDF 解析未完成。请检查网络、模型缓存或文件后重试")
		}
		if e = s.mergeLayout(d.ID, work, missing); e != nil {
			return e
		}

		m, e = s.readLayout(d.ID)
		if e != nil {
			return e
		}
	}
	p.PagesTotal = m.Pages
	p.PagesDone = p.PagesTotal
	p.Warning = strings.Join(m.Warnings, " ")
	p.Incomplete = len(m.IncompletePages) > 0 || strings.Contains(p.Warning, "无可提取文字")
	p.TranslationsTotal = 0
	for _, b := range m.Blocks {
		if needsTranslation(b) {
			p.TranslationsTotal++
		}
	}
	p.Translating = &ProcessingStage{Status: "queued", Detail: "等待翻译正文与公式"}
	if p.TranslationsTotal == 0 {
		p.Translating.Status = "complete"
	}
	aggregateProcessing(p)
	return s.Store.saveProcessing(*p)
}
