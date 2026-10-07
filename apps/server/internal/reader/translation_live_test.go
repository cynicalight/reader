package reader

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"
)

// Explicitly opt in: sends only the original English fixture below through the
// installed Codex CLI. No user documents or credential files are read.
func TestLiveTranslationThreadSpeed(t *testing.T) {
	if os.Getenv("READER_TEST_TRANSLATION_SPEED") != "1" {
		t.Skip("set READER_TEST_TRANSLATION_SPEED=1 for real Codex calls")
	}
	type timing struct {
		Mode             string        `json:"mode"`
		Batch            int           `json:"batch"`
		ProcessMs        int64         `json:"processMs"`
		InitializeMs     int64         `json:"initializeMs"`
		ThreadMs         int64         `json:"threadMs"`
		FirstDeltaMs     int64         `json:"firstDeltaMs"`
		FirstParagraphMs int64         `json:"firstParagraphMs"`
		TotalMs          int64         `json:"totalMs"`
		Characters       int           `json:"characters"`
		Models           []ModelTokens `json:"models"`
		Error            string        `json:"error,omitempty"`
	}
	paragraphs := []string{
		"A reading application stores imported documents in a local library. The library keeps the original file and records the reading position separately. When a reader opens a document again, the application restores the previous position. Paragraph translations are associated with stable identifiers so that the original text and the translated text can be displayed together. If the original paragraph changes, its previous translation must be checked before it is reused. A completed translation is saved as soon as the application has received a complete and valid record. An interrupted request must not overwrite paragraphs that have already been translated successfully.",
		"The translation system divides a document into batches while keeping each paragraph intact. Every batch contains the paragraphs to translate and a small amount of surrounding context. Titles, author information, and neighboring paragraphs help the model interpret terminology, but they should not produce extra translation records. The output contains the original sentences and their corresponding Chinese translations. The application checks paragraph identifiers, source versions, and sentence coverage before accepting a record. Numbers, mathematical expressions, and technical terms should retain their meaning. A retry should request only the paragraphs that still need a valid translation.",
		"A persistent conversation can accept several translation requests in sequence. The first request initializes a connection and starts a conversation, while later requests add new turns to the same conversation. Each new turn still requires the model to process new input and generate the requested output. Earlier context may help maintain consistent terminology, but the conversation becomes longer as more batches are translated. Concurrent requests can improve document throughput when the service has sufficient capacity. Sequential requests may simplify scheduling and reduce repeated setup work. Actual performance must be measured with the same model, reasoning settings, source text, and output format.",
	}
	batches := make([]translationBatch, len(paragraphs))
	m := layoutManifest{}
	for i, text := range paragraphs {
		// Two distinct paragraphs per batch exercise incremental JSONL delivery.
		for j := 0; j < 2; j++ {
			source := fmt.Sprintf("Section %d.%d. %s", i+1, j+1, text)
			b := PDFBlock{ID: fmt.Sprintf("p%d-b%d", i+1, j+1), Page: i + 1, Label: "text", Text: source}
			m.Blocks = append(m.Blocks, b)
			batches[i].Paragraphs = append(batches[i].Paragraphs, translationParagraph{b.ID, translationHash(source), source})
		}
	}
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "ai-work"), 0700); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(t.Context(), 10*time.Minute)
	defer cancel()
	var all []timing
	modes := []string{"independent-parallel", "shared-sequential"}
	if os.Getenv("READER_TRANSLATION_SPEED_REVERSE") == "1" {
		modes[0], modes[1] = modes[1], modes[0]
	}
	for _, mode := range modes {
		started := time.Now()
		results := make([]timing, len(batches))
		makeAdapter := func() (*translationCodexAdapter, time.Duration, error) {
			begin := time.Now()
			work, err := os.MkdirTemp(filepath.Join(root, "ai-work"), "speed-")
			if err != nil {
				return nil, 0, err
			}
			session, err := newCodexSession(work, translationCodexModel)
			if err != nil {
				_ = os.RemoveAll(work)
				return nil, 0, err
			}
			return &translationCodexAdapter{root: root, work: work, session: session}, time.Since(begin), nil
		}
		run := func(i int, a *translationCodexAdapter, process time.Duration) {
			row := timing{Mode: mode, Batch: i + 1, ProcessMs: process.Milliseconds()}
			begin := time.Now()
			for _, p := range batches[i].Paragraphs {
				row.Characters += len([]rune(p.Source))
			}
			a.session.rpcTiming = func(method string, d time.Duration) {
				switch method {
				case "initialize":
					row.InitializeMs = d.Milliseconds()
				case "thread/start":
					row.ThreadMs = d.Milliseconds()
				}
			}
			decoder := newTranslationJSONL(batches[i], func(TranslationBlock) error {
				if row.FirstParagraphMs == 0 {
					row.FirstParagraphMs = time.Since(begin).Milliseconds()
				}
				return nil
			})
			_, err := a.Stream(ctx, GenerateRequest{AIInput{Prompt: translationPrompt(Document{Title: "Original Reader translation fixture"}, m, batches[i])}}, func(e ProviderEvent) error {
				if len(e.Metrics) > 0 {
					row.Models = mergeModelTokens(row.Models, e.Metrics)
				}
				if e.Text != "" {
					if row.FirstDeltaMs == 0 {
						row.FirstDeltaMs = time.Since(begin).Milliseconds()
					}
					return decoder.feed(e.Text)
				}
				return nil
			})
			if err == nil && decoder.buffer != "" {
				err = decoder.line(decoder.buffer)
			}
			if err == nil && len(decoder.completed) != len(batches[i].Paragraphs) {
				err = fmt.Errorf("valid paragraphs %d/%d; invalid=%v", len(decoder.completed), len(batches[i].Paragraphs), decoder.invalid)
			}
			row.TotalMs = time.Since(begin).Milliseconds()
			if err != nil {
				row.Error = err.Error()
			}
			results[i] = row
		}
		if mode == "shared-sequential" {
			a, d, err := makeAdapter()
			if err != nil {
				t.Fatal(err)
			}
			for i := range batches {
				if a.session == nil {
					break
				}
				run(i, a, d)
				d = 0
			}
			a.close()
		} else {
			var wg sync.WaitGroup
			for i := range batches {
				wg.Add(1)
				go func(i int) {
					defer wg.Done()
					a, d, err := makeAdapter()
					if err != nil {
						results[i] = timing{Mode: mode, Batch: i + 1, Error: err.Error()}
						return
					}
					defer a.close()
					run(i, a, d)
				}(i)
			}
			wg.Wait()
		}
		for _, row := range results {
			raw, _ := json.Marshal(row)
			t.Log(string(raw))
			all = append(all, row)
		}
		t.Logf("MODE_TOTAL mode=%s elapsedMs=%d", mode, time.Since(started).Milliseconds())
	}
	if path := os.Getenv("READER_TRANSLATION_SPEED_OUTPUT"); path != "" {
		raw, _ := json.MarshalIndent(all, "", "  ")
		if err := os.WriteFile(path, raw, 0600); err != nil {
			t.Fatal(err)
		}
	}
	for _, row := range all {
		if row.Error != "" || row.Batch == 0 {
			t.Errorf("incomplete benchmark: %+v", row)
		}
	}
}
