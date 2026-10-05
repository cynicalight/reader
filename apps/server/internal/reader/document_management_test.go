package reader

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestDocumentMetadataPatch(t *testing.T) {
	s := testServer(t)
	d := organizationDoc(t, s)
	for _, body := range []string{`{"title":" "}`, `{"title":null}`, `{"author":null}`, `{"title":"bad\ntext"}`, `{"author":9}`} {
		if w := request(t, s, "PATCH", "/api/documents/"+d.ID, strings.NewReader(body)); w.Code != 400 {
			t.Fatalf("accepted %s: %d", body, w.Code)
		}
	}
	w := request(t, s, "PATCH", "/api/documents/"+d.ID, strings.NewReader(`{"title":" New title ","author":" New author "}`))
	if w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	got, _ := s.Store.Document(d.ID)
	if got.Title != "New title" || got.Author != "New author" || got.LastOpenedAt != d.LastOpenedAt || got.CategorySource != d.CategorySource {
		t.Fatalf("metadata patch: %+v", got)
	}
}
func TestDeleteDocumentCancelsWorkAndCleansOwnedData(t *testing.T) {
	s := testServer(t)
	d := organizationDoc(t, s)
	_, err := s.Store.DB.Exec(`INSERT INTO search_index(document_id,href,content) VALUES(?, 'p1', 'hello');`, d.ID)
	if err != nil {
		t.Fatal(err)
	}
	_, err = s.Store.DB.Exec(`INSERT INTO annotations VALUES('note', ?, '{}')`, d.ID)
	if err != nil {
		t.Fatal(err)
	}
	_, err = s.Store.DB.Exec(`INSERT INTO messages VALUES('message', ?, '{}', 'now')`, d.ID)
	if err != nil {
		t.Fatal(err)
	}
	_, err = s.Store.DB.Exec(`INSERT INTO translations VALUES(?, 'block', 'hash', 'complete', '{}', 0)`, d.ID)
	if err != nil {
		t.Fatal(err)
	}
	dir := filepath.Join(s.Store.Root, "cache", d.ID)
	if err := os.MkdirAll(dir, 0700); err != nil {
		t.Fatal(err)
	}
	ctx, finish, err := s.beginDocumentTask(context.Background(), d.ID)
	if err != nil {
		t.Fatal(err)
	}
	finished := make(chan struct{})
	go func() {
		defer close(finished)
		<-ctx.Done()
		// A final write before task exit must also be removed by deletion.
		_ = os.WriteFile(filepath.Join(dir, "last-write"), []byte("pending"), 0600)
		finish()
	}()
	w := request(t, s, "DELETE", "/api/documents/"+d.ID, nil)
	if w.Code != 204 {
		t.Fatal(w.Body.String())
	}
	select {
	case <-finished:
	case <-time.After(time.Second):
		t.Fatal("did not join document task")
	}
	for _, table := range []string{"documents", "annotations", "messages", "translations", "document_processing", "search_index"} {
		var count int
		if err := s.Store.DB.QueryRow("SELECT count(*) FROM " + table).Scan(&count); err != nil || count != 0 {
			t.Fatalf("%s: count=%d err=%v", table, count, err)
		}
	}
	for _, path := range []string{dir, s.Store.File(d)} {
		if _, err := os.Stat(path); !os.IsNotExist(err) {
			t.Fatalf("left files: %s %v", path, err)
		}
	}
	if _, _, err := s.beginDocumentTask(context.Background(), d.ID); err == nil {
		t.Fatal("deleted document can start work")
	}
	if w := request(t, s, "DELETE", "/api/documents/"+d.ID, nil); w.Code != 204 {
		t.Fatal("retry must be idempotent")
	}
}
func TestDeleteDocumentRollsBackOnDatabaseFailure(t *testing.T) {
	s := testServer(t)
	d := organizationDoc(t, s)
	_, err := s.Store.DB.Exec(`INSERT INTO search_index(document_id,href,content) VALUES(?, 'p1', 'keep');`, d.ID)
	if err != nil {
		t.Fatal(err)
	}
	_, err = s.Store.DB.Exec(`CREATE TRIGGER fail_delete BEFORE DELETE ON documents BEGIN SELECT RAISE(ABORT, 'blocked'); END`)
	if err != nil {
		t.Fatal(err)
	}
	if w := request(t, s, "DELETE", "/api/documents/"+d.ID, nil); w.Code != 500 {
		t.Fatal(w.Code)
	}
	if _, err := s.Store.Document(d.ID); err != nil {
		t.Fatal("lost document", err)
	}
	if _, err := os.Stat(s.Store.File(d)); err != nil {
		t.Fatal("lost original", err)
	}
	var count int
	s.Store.DB.QueryRow("SELECT count(*) FROM search_index WHERE document_id=?", d.ID).Scan(&count)
	if count != 1 {
		t.Fatal("lost search index")
	}
}
