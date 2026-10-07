package reader

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestQuestionAnnotationsTrackAnswers(t *testing.T) {
	s := testServer(t)
	d := organizationDoc(t, s)
	w := request(t, s, "POST", "/api/documents/"+d.ID+"/annotations", strings.NewReader(`{"kind":"question","location":{"type":"pdf","page":1},"quote":"why?","note":"Why does this hold?","color":"#e6b94c"}`))
	if w.Code != 201 {
		t.Fatal(w.Body.String())
	}
	var q Annotation
	_ = json.Unmarshal(w.Body.Bytes(), &q)
	if got, _ := s.Store.Document(d.ID); got.OpenQuestionCount != 1 {
		t.Fatalf("open questions: %d", got.OpenQuestionCount)
	}
	path := "/api/documents/" + d.ID + "/annotations/" + q.ID
	if w = request(t, s, "PATCH", path, strings.NewReader(`{"answerId":"missing"}`)); w.Code != 400 {
		t.Fatalf("unknown answer accepted: %d", w.Code)
	}
	if err := s.Store.saveMessage(Message{DocumentID: d.ID, Role: "assistant", Content: "Because."}); err != nil {
		t.Fatal(err)
	}
	var message string
	s.Store.DB.QueryRow("SELECT id FROM messages WHERE document_id=?", d.ID).Scan(&message)
	if w = request(t, s, "PATCH", path, strings.NewReader(`{"answerId":"`+message+`"}`)); w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	_ = json.Unmarshal(w.Body.Bytes(), &q)
	if q.AnswerID != message || q.Note != "Why does this hold?" || q.Resolved {
		t.Fatalf("answered: %+v", q)
	}
	if got, _ := s.Store.Document(d.ID); got.OpenQuestionCount != 0 {
		t.Fatalf("answered question still open: %d", got.OpenQuestionCount)
	}
	// Clearing the answer reopens it; resolving closes it without an answer.
	request(t, s, "PATCH", path, strings.NewReader(`{"answerId":""}`))
	if got, _ := s.Store.Document(d.ID); got.OpenQuestionCount != 1 {
		t.Fatal("cleared answer did not reopen the question")
	}
	w = request(t, s, "PATCH", path, strings.NewReader(`{"resolved":true}`))
	_ = json.Unmarshal(w.Body.Bytes(), &q)
	if !q.Resolved {
		t.Fatal(w.Body.String())
	}
	// A note edit keeps the resolved flag as a JSON boolean.
	w = request(t, s, "PATCH", path, strings.NewReader(`{"note":"Edited"}`))
	if err := json.Unmarshal(w.Body.Bytes(), &q); err != nil || !q.Resolved || q.Note != "Edited" {
		t.Fatalf("note edit: %+v %v %s", q, err, w.Body.String())
	}
	if got, _ := s.Store.Document(d.ID); got.OpenQuestionCount != 0 {
		t.Fatal("resolved question counted as open")
	}
	// Underline compaction re-encodes every annotation of the document.
	for _, x := range []string{"0.1", "0.15"} {
		request(t, s, "POST", "/api/documents/"+d.ID+"/annotations", strings.NewReader(`{"kind":"underline","location":{"type":"pdf","page":1,"rects":[{"x":`+x+`,"y":0.1,"width":0.2,"height":0.02}]},"quote":"a","note":"","color":"#e6b94c"}`))
	}
	w = request(t, s, "GET", "/api/documents/"+d.ID+"/annotations", nil)
	if !strings.Contains(w.Body.String(), `"resolved":true`) {
		t.Fatalf("question state lost: %s", w.Body.String())
	}
}
func TestPaperNote(t *testing.T) {
	s := testServer(t)
	d := organizationDoc(t, s)
	w := request(t, s, "GET", "/api/documents/"+d.ID+"/note", nil)
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"body":""`) {
		t.Fatal(w.Body.String())
	}
	if w = request(t, s, "PUT", "/api/documents/"+d.ID+"/note", strings.NewReader(`{"body":"Main idea\nsecond line"}`)); w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	w = request(t, s, "GET", "/api/documents/"+d.ID+"/note", nil)
	if !strings.Contains(w.Body.String(), `Main idea\nsecond line`) {
		t.Fatal(w.Body.String())
	}
	if w = request(t, s, "PUT", "/api/documents/missing/note", strings.NewReader(`{"body":"x"}`)); w.Code != 404 {
		t.Fatalf("missing document: %d", w.Code)
	}
	if w = request(t, s, "PUT", "/api/documents/"+d.ID+"/note", strings.NewReader(`{"body":"`+strings.Repeat("长", 100001)+`"}`)); w.Code != 400 {
		t.Fatalf("oversized note: %d", w.Code)
	}
	// Permanent deletion removes the note with the document.
	request(t, s, "DELETE", "/api/documents/"+d.ID, nil)
	var count int
	s.Store.DB.QueryRow("SELECT count(*) FROM document_notes").Scan(&count)
	if count != 0 {
		t.Fatal("note left behind")
	}
}
