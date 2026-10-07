package reader

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"time"
)

type chatStreamWriter struct {
	w          http.ResponseWriter
	cancel     context.CancelFunc
	terminal   bool
	firstFlush time.Time
}

func (s *chatStreamWriter) send(event string, value any) error {
	if s.terminal {
		return generationError(ErrorProtocol, "输出流已结束")
	}
	if event == "done" || event == "error" {
		s.terminal = true
	}
	b, err := json.Marshal(value)
	if err == nil {
		_, err = fmt.Fprintf(s.w, "event: %s\ndata: %s\n\n", event, b)
	}
	if err == nil {
		err = http.NewResponseController(s.w).Flush()
	}
	if err != nil {
		s.terminal = true
		s.cancel()
	}
	if err == nil && event == "delta" && s.firstFlush.IsZero() {
		s.firstFlush = time.Now()
	}
	return err
}
func (s *Server) streamChat(ctx context.Context, cancel context.CancelFunc, w http.ResponseWriter, documentID string, config AIConfig, in AIInput) {
	if config.Primary != "codex" || len(in.images()) > 0 {
		s.codexChat.reset()
	}
	committed := false
	defer func() {
		if !committed {
			s.codexChat.finish(in.Chat, "", false)
		}
	}()
	// Bound a blocked network write by the request deadline and interrupt it on
	// cancellation. Reset the deadline before this keep-alive connection is reused.
	controller := http.NewResponseController(w)
	if deadline, ok := ctx.Deadline(); ok {
		_ = controller.SetWriteDeadline(deadline)
	}
	writeCanceled := make(chan struct{})
	stopWrite := context.AfterFunc(ctx, func() { _ = controller.SetWriteDeadline(time.Now()); close(writeCanceled) })
	defer func() {
		if !stopWrite() {
			<-writeCanceled
		}
		_ = controller.SetWriteDeadline(time.Time{})
	}()
	started := time.Now()
	requestID := id()
	var firstText time.Time
	var finalErr error
	out := &chatStreamWriter{w: w, cancel: cancel}
	defer func() {
		attrs := []any{"request", requestID, "duration_ms", time.Since(started).Milliseconds()}
		if !firstText.IsZero() {
			attrs = append(attrs, "first_text_ms", firstText.Sub(started).Milliseconds())
		}
		if !out.firstFlush.IsZero() {
			attrs = append(attrs, "first_flush_ms", out.firstFlush.Sub(started).Milliseconds())
		}
		if finalErr != nil {
			attrs = append(attrs, "error_kind", errorKind(finalErr))
		}
		slog.Info("chat generation finished", attrs...)
	}()
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("X-Accel-Buffering", "no")
	status := "reading"
	if len(in.images()) > 0 {
		status = "reading-image"
	}
	if finalErr = out.send("status", map[string]string{"status": status}); finalErr != nil {
		return
	}
	service := s.generationService(config)
	if _, err := s.Store.DB.Exec("INSERT OR IGNORE INTO chat_usage_coverage(document_id,history_complete) VALUES(?,1)", documentID); err != nil {
		finalErr = generationError(ErrorSave, "无法保存聊天统计")
		_ = out.send("error", map[string]string{"error": finalErr.Error()})
		return
	}
	service.usageSink = s.processingUsageSink(documentID, "chat", requestID)
	result, err := service.Generate(ctx, in, true, func(e ProviderEvent) error {
		if e.Fallback != "" {
			return out.send("fallback", map[string]string{"message": e.Fallback})
		}
		if firstText.IsZero() {
			firstText = time.Now()
		}
		return out.send("delta", map[string]string{"text": e.Text})
	})
	if err == nil {
		err = ctx.Err()
	}
	if err == nil {
		if _, err = s.Store.Document(documentID); err != nil {
			err = generationError(ErrorCanceled, "文档已不可用")
		} else if err = s.Store.saveMessage(Message{DocumentID: documentID, Role: "assistant", Content: result.Text}); err != nil {
			err = generationError(ErrorSave, "回答已收到，但无法保存到本地数据库")
		}
	}
	finalErr = err
	if err != nil {
		if ctx.Err() == nil {
			_ = out.send("error", map[string]string{"error": err.Error()})
		}
		return
	}
	finalErr = out.send("done", map[string]bool{"ok": true})
	if finalErr == nil && result.Provider == "codex" {
		savedID, saveErr := s.Store.lastChatMessageID(documentID)
		if saveErr == nil {
			s.codexChat.finish(in.Chat, savedID, true)
			committed = true
		}
	}
}
