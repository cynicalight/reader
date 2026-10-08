package reader

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestRelatedDocumentsLinkBothWays(t *testing.T) {
	s := testServer(t)
	ids := uploadPapers(t, s, 3)
	w := request(t, s, "PUT", "/api/documents/"+ids[1]+"/related/"+ids[0], nil)
	if w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	var d Document
	_ = json.Unmarshal(w.Body.Bytes(), &d)
	if strings.Join(d.Related, ",") != ids[0] {
		t.Fatalf("related: %v", d.Related)
	}
	// Repeating the link is harmless and it shows on the other side too.
	request(t, s, "PUT", "/api/documents/"+ids[0]+"/related/"+ids[1], nil)
	other, _ := s.Store.Document(ids[0])
	if strings.Join(other.Related, ",") != ids[1] {
		t.Fatalf("reverse: %v", other.Related)
	}
	if w = request(t, s, "PUT", "/api/documents/"+ids[0]+"/related/"+ids[0], nil); w.Code != 400 {
		t.Fatalf("self: %d", w.Code)
	}
	if w = request(t, s, "PUT", "/api/documents/"+ids[0]+"/related/missing", nil); w.Code != 404 {
		t.Fatalf("missing: %d", w.Code)
	}
	// Merging moves the duplicate's links to the version kept.
	request(t, s, "PUT", "/api/documents/"+ids[2]+"/related/"+ids[1], nil)
	if w = request(t, s, "POST", "/api/documents/"+ids[0]+"/merge", strings.NewReader(`{"from":["`+ids[2]+`"]}`)); w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	if kept, _ := s.Store.Document(ids[0]); strings.Join(kept.Related, ",") != ids[1] {
		t.Fatalf("after merge: %v", kept.Related)
	}
	if w = request(t, s, "DELETE", "/api/documents/"+ids[1]+"/related/"+ids[0], nil); w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	if d, _ = s.Store.Document(ids[0]); len(d.Related) != 0 {
		t.Fatalf("unlink: %v", d.Related)
	}
	// Purging removes the links with the document.
	request(t, s, "PUT", "/api/documents/"+ids[0]+"/related/"+ids[1], nil)
	request(t, s, "POST", "/api/documents/"+ids[1]+"/trash", nil)
	if w = request(t, s, "DELETE", "/api/documents/"+ids[1], nil); w.Code != 200 && w.Code != 204 {
		t.Fatalf("purge: %d %s", w.Code, w.Body.String())
	}
	var count int
	s.Store.DB.QueryRow("SELECT count(*) FROM document_relations").Scan(&count)
	if count != 0 {
		t.Fatalf("relations left after purge: %d", count)
	}
}
