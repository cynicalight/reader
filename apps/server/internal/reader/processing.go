package reader

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"os"
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
	Enabled bool `json:"enabled"`
	// Chapter is a book chapter waiting for its pages to be parsed.
	Chapter           *PageRange       `json:"chapter,omitempty"`
	Translating       *ProcessingStage `json:"translating,omitempty"`
	lane              string
	resetStages       bool
	wakeStages        bool
	recoverStages     bool
	queueTranslation  bool
	enable            bool
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
	// PDF document information (Title, Author, …) as read by PDF.js.
	Metadata        map[string]any `json:"metadata"`
	IncompletePages []int          `json:"incompletePages"`
	// ParsedPages lists the pages of a book parsed so far; empty means all.
	ParsedPages []int      `json:"parsedPages,omitempty"`
	Pages       int        `json:"pages"`
	Blocks      []PDFBlock `json:"blocks"`
	Warnings    []string   `json:"warnings"`
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
	if p.lane != "" || p.resetStages || p.wakeStages || p.recoverStages || p.queueTranslation || p.enable {
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

// Rows written before pause controls always ran; keep them runnable so queued,
// interrupted and retried work still continues.
func (s *Store) enableLegacyProcessing() error {
	_, err := s.DB.Exec("UPDATE document_processing SET body=json_set(body,'$.enabled',json('true')) WHERE json_type(body,'$.enabled') IS NULL")
	return err
}

// Only document creation reads this preference; updating settings never wakes a job.
// Books always run the local layout pass; their paragraphs translate on request.
func importedProcessing(id, library, value string) Processing {
	p := initialProcessing(id)
	var settings struct {
		AutoTranslatePDF *bool `json:"autoTranslatePDF"`
	}
	if library == "books" {
		// Book chapters are parsed and translated when the reader asks.
		p.Enabled = true
		p.Translating = &ProcessingStage{Status: "complete", Detail: "可按章节翻译"}
		aggregateProcessing(&p)
		return p
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
	p := importedProcessing(d.ID, d.Library, value)
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
	var m layoutManifest
	b, e := os.ReadFile(filepath.Join(s.analysisDir(id), "manifest.json"))
	if e != nil {
		return m, e
	}
	if len(b) > 32<<20 {
		return m, errors.New("版面索引过大")
	}
	e = json.Unmarshal(b, &m)
	if e != nil || m.Pages < 1 {
		return m, errors.New("版面索引无效")
	}
	for _, b := range m.Blocks {
		r := b.Bounds
		if !blockIDPattern.MatchString(b.ID) || b.Page < 1 || b.Page > m.Pages || r.X < 0 || r.Y < 0 || r.Width <= 0 || r.Height <= 0 || r.X+r.Width > 1.001 || r.Y+r.Height > 1.001 || (b.Image != "" && b.Image != "assets/"+b.ID+".png") {
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
	if err := s.Store.enableLegacyProcessing(); err != nil {
		log.Printf("cannot migrate processing state: %v", err)
	}
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
				// Documents in the trash keep their queue position until restored.
				e := s.Store.DB.QueryRow("SELECT p.body FROM document_processing p JOIN documents d ON d.id=p.document_id WHERE p.phase=? AND p.status='queued' AND json_extract(p.body,'$.enabled')=1 AND d.deleted_at='' ORDER BY p.rowid LIMIT 1", phase).Scan(&body)
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
	workers.Add(1)
	go func() { defer workers.Done(); s.metadataWorker(ctx) }()
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
	if d.Library == "books" {
		if e = s.learnBookChapter(ctx, d, p); e != nil {
			return e
		}
	}
	m, e := s.readLayout(d.ID)
	if e != nil && d.Library != "books" {
		work := filepath.Join(s.Store.Root, "cache", d.ID, "analysis-work")
		if e = s.runLayout(ctx, d, work, 0, 0, p); e != nil {
			return e
		}
		// A successful worker writes its manifest last. Publish the directory once.
		if _, e = os.Stat(s.analysisDir(d.ID)); e == nil {
			return errors.New("已有解析目录异常，已保留，未覆盖")
		}
		if e = os.Rename(work, s.analysisDir(d.ID)); e != nil {
			return errors.New("无法保存解析附件")
		}
		m, e = s.readLayout(d.ID)
	}
	if e != nil && d.Library == "books" {
		// No chapter has been parsed yet; nothing waits for translation.
		p.Translating = &ProcessingStage{Status: "complete", Detail: "可按章节翻译"}
		aggregateProcessing(p)
		return s.Store.saveProcessing(*p)
	}
	if e != nil {
		return e
	}
	p.PagesDone = m.Pages
	p.PagesTotal = m.Pages
	if len(m.Warnings) > 0 {
		p.Warning = strings.Join(m.Warnings, " ")
	}
	p.Incomplete = len(m.IncompletePages) > 0 || strings.Contains(p.Warning, "无可提取文字")
	items, e := s.translations(d.ID, m)
	if e != nil {
		return e
	}
	p.TranslationsDone, p.TranslationsTotal = translationCounts(items)
	p.Translating = &ProcessingStage{Status: "queued", Detail: "等待翻译正文与公式"}
	if p.TranslationsDone == p.TranslationsTotal {
		p.Translating.Status = "complete"
	}
	aggregateProcessing(p)
	return s.Store.saveProcessing(*p)
}
