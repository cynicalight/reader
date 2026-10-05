package reader

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestTagBoardsPersistAndDeleteIndependently(t *testing.T) {
	root := t.TempDir()
	store, err := OpenStore(root)
	if err != nil {
		t.Fatal(err)
	}
	s := NewServer(store, "test-secret", "")
	// test request helper uses test-secret.
	w := request(t, s, "POST", "/api/tag-boards", strings.NewReader(`{"name":" Security ","tags":[" Web ","web","Go"],"match":"all"}`))
	if w.Code != 201 {
		t.Fatal(w.Code, w.Body.String())
	}
	var board TagBoard
	json.Unmarshal(w.Body.Bytes(), &board)
	if board.Name != "Security" || len(board.Tags) != 2 {
		t.Fatalf("normalization: %+v", board)
	}
	store.DB.Close()
	store, err = OpenStore(root)
	if err != nil {
		t.Fatal(err)
	}
	defer store.DB.Close()
	s = NewServer(store, "test-secret", "")
	w = request(t, s, "GET", "/api/tag-boards", nil)
	if w.Code != 200 || !strings.Contains(w.Body.String(), board.ID) {
		t.Fatal("lost board on reopen", w.Body.String())
	}
	w = request(t, s, "PUT", "/api/tag-boards/"+board.ID, strings.NewReader(`{"name":"Either","tags":["Go","Web"],"match":"any"}`))
	if w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	d := organizationDoc(t, s)
	if w := request(t, s, "DELETE", "/api/tag-boards/"+board.ID, nil); w.Code != 204 {
		t.Fatal(w.Code)
	}
	if _, err := store.Document(d.ID); err != nil {
		t.Fatal("deleting board deleted document", err)
	}
	if w := request(t, s, "GET", "/api/tag-boards", nil); strings.TrimSpace(w.Body.String()) != "[]" {
		t.Fatal(w.Body.String())
	}
	w = request(t, s, "PUT", "/api/tag-boards/"+board.ID, strings.NewReader(`{"name":"Stale","tags":["Go"],"match":"all"}`))
	if w.Code != 404 {
		t.Fatal("update resurrected deleted board", w.Code)
	}
}
func TestTagBoardValidation(t *testing.T) {
	s := testServer(t)
	for _, body := range []string{`{}`, `{"name":"","tags":["A"],"match":"all"}`, `{"name":"x","tags":[],"match":"all"}`, `{"name":"x","tags":["A"],"match":"invalid"}`, `{"name":"x","tags":["a\nb"],"match":"all"}`} {
		if w := request(t, s, "POST", "/api/tag-boards", strings.NewReader(body)); w.Code != 400 {
			t.Fatal("accepted", body, w.Code)
		}
	}
}
