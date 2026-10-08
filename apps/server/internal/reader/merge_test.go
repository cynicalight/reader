package reader

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"
)

func uploadPapers(t *testing.T, s *Server, n int) []string {
	t.Helper()
	ids := []string{}
	for i := range n {
		w := uploadTo(t, s, "papers", fmt.Sprintf("p%d.pdf", i), testPDF(i+1))
		var d Document
		_ = json.Unmarshal(w.Body.Bytes(), &d)
		ids = append(ids, d.ID)
	}
	return ids
}

func TestMergeFoldsDuplicatesIntoTheChosenVersion(t *testing.T) {
	s := testServer(t)
	ids := uploadPapers(t, s, 3)
	request(t, s, "PATCH", "/api/documents/"+ids[0], strings.NewReader(`{"tags":["ML"],"metadata":{"venue":"NeurIPS"}}`))
	request(t, s, "PATCH", "/api/documents/"+ids[1], strings.NewReader(`{"tags":["ml","NLP"],"favorite":true,"readingStatus":"done","metadata":{"venue":"arXiv","doi":"10.1000/xyz","creators":[{"given":"Ashish","family":"Vaswani"}]}}`))
	request(t, s, "PUT", "/api/documents/"+ids[1]+"/note", strings.NewReader(`{"body":"preprint note"}`))
	request(t, s, "PUT", "/api/documents/"+ids[0]+"/note", strings.NewReader(`{"body":"main note"}`))
	if _, err := s.Store.DB.Exec(`INSERT INTO annotations VALUES('a1', ?, '{}')`, ids[1]); err != nil {
		t.Fatal(err)
	}

	w := request(t, s, "POST", "/api/documents/"+ids[0]+"/merge", strings.NewReader(`{"from":["`+ids[1]+`"]}`))
	if w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	var result mergeResult
	_ = json.Unmarshal(w.Body.Bytes(), &result)
	d := result.Document
	if strings.Join(d.Tags, ",") != "ML,NLP" || !d.Favorite || d.ReadingStatus != "done" {
		t.Fatalf("merged: %+v", d)
	}
	m := d.Metadata
	if m.Venue != "NeurIPS" || m.Sources["venue"] != "manual" || m.DOI != "10.1000/xyz" || d.Author != "Ashish Vaswani" {
		t.Fatalf("metadata: %+v author=%q", m, d.Author)
	}
	if len(result.Trashed) != 1 || result.Trashed[0] != ids[1] {
		t.Fatalf("trashed: %v", result.Trashed)
	}
	note := request(t, s, "GET", "/api/documents/"+ids[0]+"/note", nil).Body.String()
	if !strings.Contains(note, `main note\n\n---\n\npreprint note`) {
		t.Fatal(note)
	}
	// The duplicate keeps its own annotations in the trash.
	var count int
	s.Store.DB.QueryRow("SELECT count(*) FROM annotations WHERE document_id=?", ids[1]).Scan(&count)
	trash := listTrash(t, s, "papers")
	if count != 1 || len(trash) != 1 || trash[0].ID != ids[1] {
		t.Fatalf("duplicate data: annotations=%d trash=%+v", count, trash)
	}
}

func TestMergeRejectsInvalidRequests(t *testing.T) {
	s := testServer(t)
	ids := uploadPapers(t, s, 2)
	book := uploadTo(t, s, "books", "b.pdf", testPDF(9))
	var b Document
	_ = json.Unmarshal(book.Body.Bytes(), &b)
	cases := map[string]string{
		`{"from":[]}`:                                  "empty",
		`{"from":["` + ids[0] + `"]}`:                  "self",
		`{"from":["` + ids[1] + `","` + ids[1] + `"]}`: "repeat",
		`{"from":["` + b.ID + `"]}`:                    "other library",
	}
	for body, name := range cases {
		if w := request(t, s, "POST", "/api/documents/"+ids[0]+"/merge", strings.NewReader(body)); w.Code != 400 {
			t.Fatalf("%s: %d %s", name, w.Code, w.Body.String())
		}
	}
	request(t, s, "POST", "/api/documents/"+ids[1]+"/trash", nil)
	if w := request(t, s, "POST", "/api/documents/"+ids[0]+"/merge", strings.NewReader(`{"from":["`+ids[1]+`"]}`)); w.Code != 404 {
		t.Fatalf("trashed duplicate: %d", w.Code)
	}
	if d, _ := s.Store.Document(ids[0]); len(d.Tags) != 0 || d.DeletedAt != "" {
		t.Fatalf("failed merge changed the master: %+v", d)
	}
}
