package reader

import (
	"context"
	"encoding/json"
	"os"
	"strings"
	"testing"
	"time"
)

func listTrash(t *testing.T, s *Server, library string) []Document {
	t.Helper()
	w := request(t, s, "GET", "/api/trash?library="+library, nil)
	if w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	var docs []Document
	if err := json.Unmarshal(w.Body.Bytes(), &docs); err != nil {
		t.Fatal(err)
	}
	return docs
}
func TestTrashKeepsDataUntilPurged(t *testing.T) {
	s := testServer(t)
	d := organizationDoc(t, s)
	if _, err := s.Store.DB.Exec(`INSERT INTO annotations VALUES('note', ?, '{}')`, d.ID); err != nil {
		t.Fatal(err)
	}
	if w := request(t, s, "POST", "/api/documents/"+d.ID+"/trash", nil); w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	docs, _ := s.Store.Documents()
	if len(docs) != 0 {
		t.Fatalf("trashed document still listed: %+v", docs)
	}
	trash := listTrash(t, s, "books")
	if len(trash) != 1 || trash[0].ID != d.ID || trash[0].DeletedAt == "" {
		t.Fatalf("trash: %+v", trash)
	}
	if len(listTrash(t, s, "papers")) != 0 {
		t.Fatal("trash is not separated by library")
	}
	if _, _, err := s.beginDocumentTask(context.Background(), d.ID); err == nil {
		t.Fatal("trashed document can start work")
	}
	var notes int
	s.Store.DB.QueryRow("SELECT count(*) FROM annotations WHERE document_id=?", d.ID).Scan(&notes)
	if _, err := os.Stat(s.Store.File(d)); err != nil || notes != 1 {
		t.Fatalf("trash removed data: %v notes=%d", err, notes)
	}
	// Repeating the request is harmless.
	if w := request(t, s, "POST", "/api/documents/"+d.ID+"/trash", nil); w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	if w := request(t, s, "POST", "/api/documents/"+d.ID+"/restore", nil); w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	if docs, _ = s.Store.Documents(); len(docs) != 1 || docs[0].DeletedAt != "" {
		t.Fatalf("restore: %+v", docs)
	}
	if w := request(t, s, "POST", "/api/documents/missing/trash", nil); w.Code != 404 {
		t.Fatalf("missing: %d", w.Code)
	}
}
func TestTrashStopsAndRequeuesRunningWork(t *testing.T) {
	s := testServer(t)
	d := organizationDoc(t, s)
	p, _ := s.Store.processing(d.ID)
	p.Status = "running"
	if err := s.Store.saveProcessing(p); err != nil {
		t.Fatal(err)
	}
	ctx, finish, err := s.beginDocumentTask(context.Background(), d.ID)
	if err != nil {
		t.Fatal(err)
	}
	go func() {
		<-ctx.Done()
		// The worker reports an interrupted run as failed before it exits.
		p.Status, p.Detail = "failed", "PDF 解析未完成"
		_ = s.Store.saveProcessing(p)
		finish()
	}()
	if w := request(t, s, "POST", "/api/documents/"+d.ID+"/trash", nil); w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	got, _ := s.Store.processing(d.ID)
	if got.Status != "queued" {
		t.Fatalf("interrupted work not requeued: %+v", got)
	}
	// The processing queue skips trashed documents.
	var queued int
	s.Store.DB.QueryRow("SELECT count(*) FROM document_processing p JOIN documents d ON d.id=p.document_id WHERE p.status='queued' AND d.deleted_at=''").Scan(&queued)
	if queued != 0 {
		t.Fatal("trashed document is still eligible for processing")
	}
}
func TestReimportRestoresFromTrash(t *testing.T) {
	s := testServer(t)
	d := organizationDoc(t, s)
	request(t, s, "POST", "/api/documents/"+d.ID+"/trash", nil)
	w := upload(t, s, "reading-notes.pdf", sample(t, "reading-notes.pdf"))
	if w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	got, _ := s.Store.Document(d.ID)
	if got.DeletedAt != "" {
		t.Fatal("reimport left the document in the trash")
	}
}
func TestEmptyTrashPurgesOnlyThatLibrary(t *testing.T) {
	s := testServer(t)
	book := organizationDoc(t, s)
	w := uploadTo(t, s, "papers", "paper.pdf", testPDF(2))
	var paper Document
	_ = json.Unmarshal(w.Body.Bytes(), &paper)
	for _, id := range []string{book.ID, paper.ID} {
		if w := request(t, s, "POST", "/api/documents/"+id+"/trash", nil); w.Code != 200 {
			t.Fatal(w.Body.String())
		}
	}
	if w := request(t, s, "DELETE", "/api/trash?library=other", nil); w.Code != 400 {
		t.Fatalf("unknown library: %d", w.Code)
	}
	w = request(t, s, "DELETE", "/api/trash?library=papers", nil)
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"removed":1`) {
		t.Fatal(w.Body.String())
	}
	if _, err := s.Store.Document(paper.ID); err == nil {
		t.Fatal("paper not purged")
	}
	if _, err := os.Stat(s.Store.File(paper)); !os.IsNotExist(err) {
		t.Fatal("paper file kept")
	}
	if got, err := s.Store.Document(book.ID); err != nil || got.DeletedAt == "" {
		t.Fatalf("other library touched: %+v %v", got, err)
	}
	if w = request(t, s, "DELETE", "/api/documents/"+book.ID, nil); w.Code != 204 {
		t.Fatal(w.Code)
	}
	if len(listTrash(t, s, "books")) != 0 {
		t.Fatal("purged document still in trash")
	}
}
func TestRestoreRequeuesWorkLeftRunning(t *testing.T) {
	s := testServer(t)
	d := organizationDoc(t, s)
	request(t, s, "POST", "/api/documents/"+d.ID+"/trash", nil)
	p, _ := s.Store.processing(d.ID)
	p.Status = "running"
	_ = s.Store.saveProcessing(p)
	if w := request(t, s, "POST", "/api/documents/"+d.ID+"/restore", nil); w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	deadline := time.Now().Add(time.Second)
	for {
		got, _ := s.Store.processing(d.ID)
		if got.Status == "queued" {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("restore left %+v", got)
		}
		time.Sleep(10 * time.Millisecond)
	}
}
