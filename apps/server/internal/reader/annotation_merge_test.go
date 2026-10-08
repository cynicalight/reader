package reader

import (
	"bytes"
	"encoding/json"
	"math"
	"sync"
	"testing"
)

func TestUnderlineMergeAPI(t *testing.T) {
	s := testServer(t)
	uploaded := upload(t, s, "reading-notes.pdf", sample(t, "reading-notes.pdf"))
	var doc Document
	if err := json.Unmarshal(uploaded.Body.Bytes(), &doc); err != nil {
		t.Fatal(err)
	}
	path := "/api/documents/" + doc.ID + "/annotations"
	save := func(x, width float64, quote string) Annotation {
		body, _ := json.Marshal(map[string]any{"kind": "underline", "quote": quote, "color": "#e6b94c", "location": map[string]any{"type": "pdf", "page": 1, "rects": []map[string]float64{{"x": x, "y": 0.2, "width": width, "height": 0.02}}}})
		w := request(t, s, "POST", path, bytes.NewReader(body))
		if w.Code != 201 {
			t.Fatalf("save: %d %s", w.Code, w.Body.String())
		}
		var a Annotation
		if err := json.Unmarshal(w.Body.Bytes(), &a); err != nil {
			t.Fatal(err)
		}
		return a
	}
	first := save(0.1, 0.3, "reading, describe")
	duplicate := save(0.1, 0.3, "reading, describe")
	if first.ID != duplicate.ID {
		t.Fatalf("duplicate underline created a new record: %s != %s", first.ID, duplicate.ID)
	}
	save(0.12, 0.04, "rea")
	merged := save(0.3, 0.3, "describe the question")
	var items []Annotation
	w := request(t, s, "GET", path, nil)
	if err := json.Unmarshal(w.Body.Bytes(), &items); err != nil {
		t.Fatal(err)
	}
	if len(items) != 1 {
		t.Fatalf("overlapping underlines remain: %d", len(items))
	}
	if merged.ID != first.ID || items[0].Quote != "reading, describe the question" {
		t.Fatalf("wrong merged record: %+v", items[0])
	}
	var location annotationPDFLocation
	json.Unmarshal(items[0].Location, &location)
	if len(location.Rects) != 1 || math.Abs(location.Rects[0].X-0.1) > 1e-8 || math.Abs(location.Rects[0].Width-0.5) > 1e-8 {
		t.Fatalf("wrong union: %+v", location.Rects)
	}
}

func pdfUnderline(id string, rects []annotationRect, quote string) Annotation {
	location, _ := json.Marshal(annotationPDFLocation{Type: "pdf", Page: 1, Rects: rects})
	return Annotation{ID: id, DocumentID: "doc", Kind: "underline", Location: location, Quote: quote, Color: "#e6b94c", CreatedAt: now()}
}
func TestUnderlineMergeBoundaries(t *testing.T) {
	a := pdfUnderline("a", []annotationRect{{0.1, 0.2, 0.3, 0.02}}, "阅读原文")
	for _, kind := range []string{"note", "highlight", "bookmark"} {
		b := a
		b.Kind = kind
		if _, ok := mergeUnderline(a, b); ok {
			t.Fatalf("merged %s into underline", kind)
		}
	}
	separate := []Annotation{
		pdfUnderline("disjoint", []annotationRect{{0.6, 0.2, 0.1, 0.02}}, "原文"),
		pdfUnderline("touching", []annotationRect{{0.4, 0.2, 0.1, 0.02}}, "原文"),
		pdfUnderline("other-line", []annotationRect{{0.1, 0.3, 0.3, 0.02}}, "阅读原文"),
	}
	otherPage := a
	otherPage.Location = json.RawMessage(`{"type":"pdf","page":2,"rects":[{"x":0.1,"y":0.2,"width":0.3,"height":0.02}]}`)
	otherDoc := a
	otherDoc.DocumentID = "other"
	separate = append(separate, otherPage, otherDoc)
	for _, b := range separate {
		if _, ok := mergeUnderline(a, b); ok {
			t.Fatalf("merged separate ranges: %+v", b)
		}
	}
	b := pdfUnderline("b", []annotationRect{{0.3, 0.2001, 0.3, 0.02}}, "原文内容")
	merged, ok := mergeUnderline(a, b)
	if !ok || merged.Quote != "阅读原文内容" {
		t.Fatalf("unicode overlap: %+v %v", merged, ok)
	}
}
func TestUnderlineMergeAcrossLines(t *testing.T) {
	a := pdfUnderline("a", []annotationRect{{0.1, 0.2, 0.6, 0.02}, {0.1, 0.3, 0.2, 0.02}}, "Before reading\nUse the outline")
	b := pdfUnderline("b", []annotationRect{{0.2, 0.3, 0.5, 0.02}, {0.1, 0.4, 0.4, 0.02}}, "outline to inspect\nSelect a sentence")
	merged, ok := mergeUnderline(a, b)
	if !ok {
		t.Fatal("cross-line overlap not merged")
	}
	var location annotationPDFLocation
	json.Unmarshal(merged.Location, &location)
	if len(location.Rects) != 3 || math.Abs(location.Rects[1].Width-0.6) > 1e-8 {
		t.Fatalf("lines or coverage lost: %+v", location.Rects)
	}
	if merged.Quote != "Before reading Use the outline to inspect Select a sentence" {
		t.Fatalf("wrong quote: %s", merged.Quote)
	}
}

func TestUnderlineMergeRepeatedPhrase(t *testing.T) {
	a := pdfUnderline("a", []annotationRect{{0.1, 0.2, 0.2, 0.02}}, "word word")
	b := pdfUnderline("b", []annotationRect{{0.2, 0.2, 0.2, 0.02}}, "word word")
	merged, ok := mergeUnderline(a, b)
	if !ok || merged.Quote != "word word word" {
		t.Fatalf("repeated words lost: %q", merged.Quote)
	}
}
func TestUnderlineBridgeAndRestartRepair(t *testing.T) {
	s := testServer(t)
	var doc Document
	json.Unmarshal(upload(t, s, "reading-notes.pdf", sample(t, "reading-notes.pdf")).Body.Bytes(), &doc)
	insert := func(a Annotation) {
		a.DocumentID = doc.ID
		body, _ := json.Marshal(a)
		if _, err := s.Store.DB.Exec("INSERT INTO annotations VALUES(?,?,?)", a.ID, doc.ID, string(body)); err != nil {
			t.Fatal(err)
		}
	}
	left := pdfUnderline("left", []annotationRect{{0.1, 0.2, 0.2, 0.02}}, "one two")
	right := pdfUnderline("right", []annotationRect{{0.5, 0.2, 0.2, 0.02}}, "four five")
	bridge := pdfUnderline("bridge", []annotationRect{{0.2, 0.2, 0.4, 0.02}}, "two three four")
	left.Note = "keep this"
	right.Note = "and this"
	insert(left)
	insert(right)
	bridge.DocumentID = doc.ID
	result, err := s.Store.saveAnnotation(bridge)
	if err != nil {
		t.Fatal(err)
	}
	if result.ID != "left" || result.Quote != "one two three four five" || len(result.ReplacedIDs) != 1 || result.ReplacedIDs[0] != "right" || result.Note != "keep this\n\nand this" {
		t.Fatalf("wrong bridge result: %+v", result)
	}
	// Simulate historical duplicates written by the old insertion-only API.
	duplicate := result.Annotation
	duplicate.ID = "old-duplicate"
	insert(duplicate)
	note := left
	note.ID = "note"
	note.Kind = "note"
	note.Note = "Do not remove"
	insert(note)
	root := s.Store.Root
	s.Store.DB.Close()
	store, err := OpenStore(root)
	if err != nil {
		t.Fatal(err)
	}
	defer store.DB.Close()
	items, err := store.DB.Query("SELECT body FROM annotations ORDER BY rowid")
	if err != nil {
		t.Fatal(err)
	}
	var records []Annotation
	for items.Next() {
		var body []byte
		items.Scan(&body)
		var a Annotation
		json.Unmarshal(body, &a)
		records = append(records, a)
	}
	items.Close()
	if len(records) != 2 || records[0].ID != "left" || records[1].Note != "Do not remove" {
		t.Fatalf("legacy repair damaged records: %+v", records)
	}
	if err := store.compactUnderlines(); err != nil {
		t.Fatal(err)
	}
	var count int
	store.DB.QueryRow("SELECT COUNT(*) FROM annotations").Scan(&count)
	if count != 2 {
		t.Fatalf("repair not idempotent: %d", count)
	}
}
func TestConcurrentUnderlineSaves(t *testing.T) {
	s := testServer(t)
	var doc Document
	json.Unmarshal(upload(t, s, "reading-notes.pdf", sample(t, "reading-notes.pdf")).Body.Bytes(), &doc)
	var wg sync.WaitGroup
	failures := make(chan error, 12)
	for range 12 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			a := pdfUnderline(id(), []annotationRect{{0.1, 0.2, 0.2, 0.02}}, "same text")
			a.DocumentID = doc.ID
			_, err := s.Store.saveAnnotation(a)
			failures <- err
		}()
	}
	wg.Wait()
	close(failures)
	for err := range failures {
		if err != nil {
			t.Fatal(err)
		}
	}
	var count int
	s.Store.DB.QueryRow("SELECT COUNT(*) FROM annotations WHERE document_id=?", doc.ID).Scan(&count)
	if count != 1 {
		t.Fatalf("concurrent duplicate records: %d", count)
	}
}
func epubUnderline(id string, start, end int, quote string) Annotation {
	selector := "html:nth-of-type(1) > body:nth-of-type(1) > p:nth-of-type(1)"
	locator, _ := json.Marshal(map[string]any{"href": "chapter.xhtml", "type": "application/xhtml+xml", "locations": map[string]any{"domRange": annotationDOMRange{annotationDOMPoint{selector, 0, start}, annotationDOMPoint{selector, 0, end}}, "textRange": annotationTextRange{start, end}}, "text": map[string]string{"highlight": quote}})
	location, _ := json.Marshal(annotationEPUBLocation{Type: "epub", Href: "chapter.xhtml", Locator: string(locator)})
	return Annotation{ID: id, DocumentID: "doc", Kind: "underline", Location: location, Quote: quote}
}
func TestEPUBUnderlineUnion(t *testing.T) {
	a := epubUnderline("a", 0, 7, "one two")
	b := epubUnderline("b", 4, 13, "two three")
	merged, ok := mergeUnderline(a, b)
	if !ok || merged.Quote != "one two three" {
		t.Fatalf("EPUB merge: %+v %v", merged, ok)
	}
	var location annotationEPUBLocation
	json.Unmarshal(merged.Location, &location)
	var locator annotationLocator
	json.Unmarshal([]byte(location.Locator), &locator)
	if locator.Locations.DOMRange.Start.CharOffset != 0 || locator.Locations.DOMRange.End.CharOffset != 13 || locator.Locations.TextRange.End != 13 {
		t.Fatalf("wrong EPUB range: %+v", locator)
	}
	contained := epubUnderline("c", 4, 7, "two")
	merged, ok = mergeUnderline(a, contained)
	if !ok || merged.Quote != a.Quote {
		t.Fatal("contained EPUB underline changed quote")
	}
	separate := epubUnderline("d", 7, 13, "three")
	if _, ok = mergeUnderline(a, separate); ok {
		t.Fatal("merged touching EPUB ranges")
	}
	// Legacy exact DOM ranges can still merge without the newer text offsets.
	var raw map[string]any
	json.Unmarshal([]byte(location.Locator), &raw)
	delete(raw["locations"].(map[string]any), "textRange")
	encoded, _ := json.Marshal(raw)
	location.Locator = string(encoded)
	merged.Location, _ = json.Marshal(location)
	if _, ok = mergeUnderline(merged, b); !ok {
		t.Fatal("legacy DOM range did not merge")
	}
}

func TestLinkedAndTranslatedUnderlinesKeepTheirAnchors(t *testing.T) {
	for _, field := range []string{"translation", "sentenceLink"} {
		a := pdfUnderline("a", []annotationRect{{0.1, 0.2, 0.2, 0.02}}, "first")
		b := pdfUnderline("b", []annotationRect{{0.1, 0.2, 0.2, 0.02}}, "second")
		var location map[string]json.RawMessage
		if err := json.Unmarshal(b.Location, &location); err != nil {
			t.Fatal(err)
		}
		location[field] = json.RawMessage(`{"blockId":"p1-b1"}`)
		b.Location, _ = json.Marshal(location)
		if _, ok := mergeUnderline(a, b); ok {
			t.Fatalf("merged and lost %s anchor", field)
		}
		if _, ok := mergeUnderline(b, a); ok {
			t.Fatalf("merged incompatible %s anchors", field)
		}
	}
}
