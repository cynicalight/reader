package reader

import (
	"encoding/json"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
)

func undoRequest(t *testing.T, s *Server, session, method, path string, value any) *httptest.ResponseRecorder {
	t.Helper()
	body := ""
	if value != nil {
		data, err := json.Marshal(value)
		if err != nil {
			t.Fatal(err)
		}
		body = string(data)
	}
	r := httptest.NewRequest(method, "http://127.0.0.1:17840"+path, strings.NewReader(body))
	r.Header.Set("Authorization", "Bearer "+s.Token)
	r.Header.Set(annotationUndoHeader, session)
	w := httptest.NewRecorder()
	s.Handler().ServeHTTP(w, r)
	return w
}
func undoMark(t *testing.T, s *Server, session string, a Annotation) Annotation {
	t.Helper()
	w := undoRequest(t, s, session, "POST", "/api/documents/doc/annotations", a)
	if w.Code != 201 {
		t.Fatal(w.Body.String())
	}
	var result Annotation
	_ = json.Unmarshal(w.Body.Bytes(), &result)
	return result
}
func undoLast(t *testing.T, s *Server, session string) {
	t.Helper()
	w := undoRequest(t, s, session, "POST", "/api/documents/doc/annotations/undo", nil)
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"undone":true`) {
		t.Fatalf("%d %s", w.Code, w.Body.String())
	}
}
func TestAnnotationUndoRestoresEditsAndDeletedIdentity(t *testing.T) {
	s, _ := processingFixture(t)
	a := pdfUnderline("", []annotationRect{{.1, .2, .3, .02}}, "原文")
	a.Kind = "note"
	a.Note = "原始笔记"
	a.Tags = []string{"标签"}
	saved := undoMark(t, s, "client", a)
	original, _ := annotationSnapshot(s.Store.DB, "doc")
	w := undoRequest(t, s, "client", "PATCH", "/api/documents/doc/annotations/"+saved.ID, map[string]any{"note": "新笔记", "color": "#5b9fe8", "tags": []string{"新标签"}})
	if w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	edited, _ := annotationSnapshot(s.Store.DB, "doc")
	w = undoRequest(t, s, "client", "DELETE", "/api/documents/doc/annotations/"+saved.ID, nil)
	if w.Code != 204 {
		t.Fatal(w.Body.String())
	}
	undoLast(t, s, "client")
	restored, _ := annotationSnapshot(s.Store.DB, "doc")
	if !reflect.DeepEqual(restored, edited) {
		t.Fatal("delete undo lost saved fields")
	}
	undoLast(t, s, "client")
	restored, _ = annotationSnapshot(s.Store.DB, "doc")
	if !reflect.DeepEqual(restored, original) {
		t.Fatal("edit undo lost original fields")
	}
	undoLast(t, s, "client")
	restored, _ = annotationSnapshot(s.Store.DB, "doc")
	if len(restored) != 0 {
		t.Fatal("create undo left a mark")
	}
	w = undoRequest(t, s, "client", "POST", "/api/documents/doc/annotations/undo", nil)
	if !strings.Contains(w.Body.String(), `"undone":false`) {
		t.Fatal(w.Body.String())
	}
}
func TestAnnotationUndoRestoresAllMergedUnderlines(t *testing.T) {
	for _, kind := range []string{"pdf", "epub"} {
		t.Run(kind, func(t *testing.T) {
			s, _ := processingFixture(t)
			var a, b, bridge Annotation
			if kind == "epub" {
				_, _ = s.Store.DB.Exec("UPDATE documents SET type='epub' WHERE id='doc'")
				a, b, bridge = epubUnderline("a", 0, 5, "first"), epubUnderline("b", 10, 15, "third"), epubUnderline("", 3, 12, "middle")
			} else {
				a = pdfUnderline("a", []annotationRect{{.1, .2, .2, .02}}, "first")
				b = pdfUnderline("b", []annotationRect{{.5, .2, .2, .02}}, "third")
				bridge = pdfUnderline("", []annotationRect{{.2, .2, .4, .02}}, "middle")
			}
			if _, err := s.Store.saveAnnotation(a); err != nil {
				t.Fatal(err)
			}
			if _, err := s.Store.saveAnnotation(b); err != nil {
				t.Fatal(err)
			}
			before, _ := annotationSnapshot(s.Store.DB, "doc")
			undoMark(t, s, "client", bridge)
			after, _ := annotationSnapshot(s.Store.DB, "doc")
			if len(after) != 1 {
				t.Fatalf("expected one merged mark: %v", after)
			}
			undoLast(t, s, "client")
			restored, _ := annotationSnapshot(s.Store.DB, "doc")
			if !reflect.DeepEqual(before, restored) {
				t.Fatal("merged ranges or original identities lost")
			}
		})
	}
}
func TestAnnotationUndoPreservesOtherSessionsAndRejectsStaleChanges(t *testing.T) {
	s, _ := processingFixture(t)
	a := pdfUnderline("", []annotationRect{{.1, .2, .2, .02}}, "one")
	a.Kind = "highlight"
	first := undoMark(t, s, "one", a)
	second := undoMark(t, s, "two", a)
	undoLast(t, s, "one")
	items, _ := annotationSnapshot(s.Store.DB, "doc")
	if len(items) != 1 || items[second.ID] == "" || items[first.ID] != "" {
		t.Fatal("other client's annotation changed")
	}
	w := undoRequest(t, s, "one", "PATCH", "/api/documents/doc/annotations/"+second.ID, map[string]any{"note": "other client's edit"})
	if w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	before, _ := annotationSnapshot(s.Store.DB, "doc")
	w = undoRequest(t, s, "two", "POST", "/api/documents/doc/annotations/undo", nil)
	if w.Code != 409 {
		t.Fatal(w.Body.String())
	}
	after, _ := annotationSnapshot(s.Store.DB, "doc")
	if !reflect.DeepEqual(before, after) {
		t.Fatal("stale undo overwrote edits")
	}
}
func TestAnnotationUndoIgnoresFailedWritesAndIsDocumentScoped(t *testing.T) {
	s, _ := processingFixture(t)
	a := pdfUnderline("", []annotationRect{{.1, .2, .2, .02}}, "one")
	a.Kind = "highlight"
	undoMark(t, s, "client", a)
	w := undoRequest(t, s, "client", "PATCH", "/api/documents/doc/annotations/missing", map[string]any{"note": "bad"})
	if w.Code != 404 {
		t.Fatal(w.Code)
	}
	w = undoRequest(t, s, "client", "POST", "/api/documents/other/annotations/undo", nil)
	if strings.Contains(w.Body.String(), `"undone":true`) {
		t.Fatal("wrong document history")
	}
	undoLast(t, s, "client")
	items, _ := annotationSnapshot(s.Store.DB, "doc")
	if len(items) != 0 {
		t.Fatal("failed write consumed undo")
	}
}

func TestAnnotationUndoSkipsNoOpFieldNormalization(t *testing.T) {
	s, _ := processingFixture(t)
	a := pdfUnderline("", []annotationRect{{.1, .2, .2, .02}}, "one")
	a.Kind = "highlight"
	saved := undoMark(t, s, "client", a)
	w := undoRequest(t, s, "client", "PATCH", "/api/documents/doc/annotations/"+saved.ID, map[string]any{"color": saved.Color, "note": saved.Note})
	if w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	if len(s.annotationHistory) != 1 {
		t.Fatal("no-op edit consumed history")
	}
	undoLast(t, s, "client")
	items, _ := annotationSnapshot(s.Store.DB, "doc")
	if len(items) != 0 {
		t.Fatal("normalized defaults prevented undo")
	}
}
