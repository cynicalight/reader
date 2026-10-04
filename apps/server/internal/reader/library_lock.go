package reader

import (
	"fmt"
	"github.com/gofrs/flock"
	"os"
	"path/filepath"
)

// Keep the OS lock for the server lifetime. Kernel release also covers crashes.
func LockLibrary(root string) (func(), error) {
	if err := os.MkdirAll(root, 0700); err != nil {
		return nil, err
	}
	lock := flock.New(filepath.Join(root, "reader.lock"))
	ok, err := lock.TryLock()
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, fmt.Errorf("书库已在另一个 Reader 实例中打开，请先关闭该实例")
	}
	return func() { _ = lock.Unlock() }, nil
}
