package reader

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestEditAnnotationNote(t *testing.T) {
	s := testServer(t)
	var doc Document
	json.Unmarshal(upload(t, s, "reading-notes.pdf", sample(t, "reading-notes.pdf")).Body.Bytes(), &doc)
	a := pdfUnderline("underline", []annotationRect{{0.1, 0.2, 0.2, 0.02}}, "Original passage")
	a.DocumentID = doc.ID
	saved, err := s.Store.saveAnnotation(a)
	if err != nil {
		t.Fatal(err)
	}
	// The editor may have opened before another selection extended this range.
	extension := pdfUnderline("extension", []annotationRect{{0.2, 0.2, 0.2, 0.02}}, "passage extended")
	extension.DocumentID = doc.ID
	saved, err = s.Store.saveAnnotation(extension)
	if err != nil {
		t.Fatal(err)
	}
	path := "/api/documents/" + doc.ID + "/annotations/" + a.ID
	for _, note := range []string{"Initial note", "Edited note", ""} {
		body, _ := json.Marshal(map[string]string{"note": note})
		w := request(t, s, "PATCH", path, strings.NewReader(string(body)))
		if w.Code != 200 {
			t.Fatalf("edit: %d %s", w.Code, w.Body.String())
		}
		var updated Annotation
		json.Unmarshal(w.Body.Bytes(), &updated)
		if updated.Note != note || updated.ID != saved.ID || updated.Kind != saved.Kind || updated.Quote != saved.Quote || string(updated.Location) != string(saved.Location) || updated.CreatedAt != saved.CreatedAt {
			t.Fatalf("edit changed annotation identity: %+v", updated)
		}
	}
	var count int
	s.Store.DB.QueryRow("SELECT COUNT(*) FROM annotations").Scan(&count)
	if count != 1 {
		t.Fatalf("edit duplicated annotation: %d", count)
	}
	if w := request(t, s, "PATCH", path, strings.NewReader(`{}`)); w.Code != 400 {
		t.Fatalf("missing note: %d", w.Code)
	}
	if w := request(t, s, "PATCH", "/api/documents/other/annotations/"+a.ID, strings.NewReader(`{"note":"wrong document"}`)); w.Code != 404 {
		t.Fatalf("cross-document edit: %d", w.Code)
	}
	request(t, s, "DELETE", path, nil)
	if w := request(t, s, "PATCH", path, strings.NewReader(`{"note":"late edit"}`)); w.Code != 404 {
		t.Fatalf("deleted annotation revived: %d", w.Code)
	}
}

func TestTagAnnotations(t *testing.T) {
	s := testServer(t)
	var doc Document
	json.Unmarshal(upload(t, s, "reading-notes.pdf", sample(t, "reading-notes.pdf")).Body.Bytes(), &doc)
	a := pdfUnderline("tagged", []annotationRect{{0.1, 0.2, 0.2, 0.02}}, "Passage")
	a.DocumentID = doc.ID
	if _, err := s.Store.saveAnnotation(a); err != nil {
		t.Fatal(err)
	}
	path := "/api/documents/" + doc.ID + "/annotations/" + a.ID
	patch := func(body string) Annotation {
		t.Helper()
		w := request(t, s, "PATCH", path, strings.NewReader(body))
		if w.Code != 200 {
			t.Fatalf("%s: %d %s", body, w.Code, w.Body.String())
		}
		var updated Annotation
		json.Unmarshal(w.Body.Bytes(), &updated)
		return updated
	}
	if got := patch(`{"tags":[" method ","Method","proof"]}`); strings.Join(got.Tags, ",") != "method,proof" {
		t.Fatalf("tags: %v", got.Tags)
	}
	// Other edits keep the tags.
	if got := patch(`{"note":"n","color":"#5b9fe8"}`); strings.Join(got.Tags, ",") != "method,proof" || got.Note != "n" {
		t.Fatalf("kept: %+v", got)
	}
	if got := patch(`{"tags":[]}`); len(got.Tags) != 0 {
		t.Fatalf("cleared: %v", got.Tags)
	}
	for _, bad := range []string{`{"tags":"x"}`, `{"tags":["a","b","c","d","e","f","g","h","i","j","k"]}`, `{"tags":[""]}`} {
		if w := request(t, s, "PATCH", path, strings.NewReader(bad)); w.Code != 400 {
			t.Fatalf("%s: %d", bad, w.Code)
		}
	}
	list := request(t, s, "GET", "/api/documents/"+doc.ID+"/annotations", nil)
	if !strings.Contains(list.Body.String(), `"note":"n"`) {
		t.Fatal(list.Body.String())
	}
}
