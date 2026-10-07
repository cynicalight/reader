package reader

import (
	"context"
	"encoding/json"
	"io"
	"os/exec"
	"sync"
	"time"
)

// The cancellation frame is sent while stdin remains open. A watchdog closes
// both pipes and kills the process even if encoding blocks on a full pipe.
// The owner keeps reading until the native terminal response or this deadline.
type rpcLifecycle struct {
	writeMu     sync.Mutex
	stateMu     sync.Mutex
	encoder     *json.Encoder
	cancelFrame any
	done        chan struct{}
	stopped     chan struct{}
	force       func()
}

func newRPCLifecycle(ctx context.Context, cmd *exec.Cmd, stdin io.WriteCloser, stdout io.ReadCloser) *rpcLifecycle {
	p := &rpcLifecycle{encoder: json.NewEncoder(stdin), done: make(chan struct{}), stopped: make(chan struct{})}
	p.force = func() { _ = cmd.Process.Kill(); _ = stdin.Close(); _ = stdout.Close() }
	go func() {
		defer close(p.stopped)
		select {
		case <-p.done:
			return
		case <-ctx.Done():
		}
		watchdog := time.AfterFunc(400*time.Millisecond, p.force)
		defer watchdog.Stop()
		p.stateMu.Lock()
		frame := p.cancelFrame
		p.stateMu.Unlock()
		if frame != nil {
			_ = p.send(frame)
		} else {
			p.force()
			return
		}
		select {
		case <-p.done:
		case <-time.After(450 * time.Millisecond):
			p.force()
		}
	}()
	return p
}
func (p *rpcLifecycle) send(v any) error {
	p.writeMu.Lock()
	defer p.writeMu.Unlock()
	return p.encoder.Encode(v)
}
func (p *rpcLifecycle) setCancel(v any) { p.stateMu.Lock(); p.cancelFrame = v; p.stateMu.Unlock() }
func (p *rpcLifecycle) close()          { close(p.done); p.force(); <-p.stopped }

// finish stops the per-turn cancellation watcher without closing a reusable connection.
func (p *rpcLifecycle) finish() { close(p.done); <-p.stopped }
