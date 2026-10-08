package scholar

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
)

const pdfBytes = "%PDF-1.4\nfixture\n%%EOF\n"

const atom = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:arxiv="http://arxiv.org/schemas/atom">
 <entry>
  <id>http://arxiv.org/abs/1706.03762v7</id>
  <published>2017-06-12T17:57:34Z</published>
  <title>Attention Is All
   You Need</title>
  <summary>  The dominant sequence transduction models are based on complex recurrent networks. </summary>
  <author><name>Ashish Vaswani</name></author>
  <author><name>Noam Shazeer</name></author>
  <arxiv:doi>10.5555/3295222.3295349</arxiv:doi>
 </entry>
</feed>`

const crossref = `{"message":{"type":"proceedings-article","title":["Attention is all you need"],
 "container-title":["Advances in Neural Information Processing Systems"],"publisher":"Curran Associates",
 "page":"6000--6010","volume":"30","author":[{"given":"Ashish","family":"Vaswani"},{"name":"Google Brain"}],
 "issued":{"date-parts":[[2017,12]]},"abstract":"<jats:title>Abstract</jats:title><jats:p>Published &amp; reviewed.</jats:p>"}}`

const landing = `<!doctype html><html><head>
<meta name="citation_title" content="Don't Stop Pretraining: Adapt Language Models">
<meta content="Gururangan, Suchin" name="citation_author">
<meta name="citation_author" content='Noah A. Smith'>
<meta name="citation_conference_title" content="ACL 2020">
<meta name="citation_publication_date" content="2020/7/5">
<meta name="citation_firstpage" content="8342"><meta name="citation_lastpage" content="8360">
<meta name="citation_doi" content="10.18653/v1/2020.acl-main.740">
<meta name="citation_pdf_url" content="../2020.acl-main.740.pdf">
</head><body></body></html>`

type fixture struct {
	*httptest.Server
	hits atomic.Int32
}

func newFixture(t *testing.T) (*Client, *fixture) {
	t.Helper()
	f := &fixture{}
	mux := http.NewServeMux()
	pdf := func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/pdf")
		w.Write([]byte(pdfBytes))
	}
	mux.HandleFunc("/arxiv/api", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("id_list") == "0000.00000" {
			w.Write([]byte(`<feed xmlns="http://www.w3.org/2005/Atom"><entry><id>http://arxiv.org/api/errors#bad</id><title>Error</title></entry></feed>`))
			return
		}
		w.Write([]byte(atom))
	})
	mux.HandleFunc("/arxiv/pdf/1706.03762", pdf)
	mux.HandleFunc("/arxiv/pdf/1706.03762v9", http.NotFound)
	mux.HandleFunc("/crossref/", func(w http.ResponseWriter, r *http.Request) {
		if strings.Contains(r.URL.Path, "missing") {
			http.NotFound(w, r)
			return
		}
		w.Write([]byte(crossref))
	})
	mux.HandleFunc("/s2/", func(w http.ResponseWriter, r *http.Request) {
		switch {
		case strings.HasPrefix(r.URL.Path, "/s2/search/match"):
			if strings.Contains(r.URL.Query().Get("query"), "unrelated") {
				w.Write([]byte(`{"data":[{"title":"Something completely different"}]}`))
				return
			}
			w.Write([]byte(`{"data":[{"title":"Graph Attention Networks","year":2018,"externalIds":{"ArXiv":"1706.03762"},"authors":[{"name":"Petar Veličković"}]}]}`))
		case strings.Contains(r.URL.Path, "10.1000/oa"):
			w.Write([]byte(`{"title":"Open paper","externalIds":{"DOI":"10.1000/oa"},"openAccessPdf":{"url":"` + f.URL + `/files/open.pdf"}}`))
		default:
			http.NotFound(w, r)
		}
	})
	mux.HandleFunc("/files/open.pdf", pdf)
	mux.HandleFunc("/files/html.pdf", func(w http.ResponseWriter, r *http.Request) { w.Write([]byte("<html>login</html>")) })
	mux.HandleFunc("/acl/2020.acl-main.740/", func(w http.ResponseWriter, r *http.Request) { w.Write([]byte(landing)) })
	mux.HandleFunc("/acl/2020.acl-main.740.pdf", pdf)
	mux.HandleFunc("/paywall", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`<meta name="citation_title" content="Closed paper">`))
	})
	mux.HandleFunc("/openreview/pdf", pdf)
	mux.HandleFunc("/openreview/api", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`{"notes":[{"pdate":1700000000000,"content":{"title":{"value":"Review me"},"authors":{"value":["Ada Lovelace"]},"venue":{"value":"ICLR 2024"}}}]}`))
	})
	mux.HandleFunc("/big.pdf", func(w http.ResponseWriter, r *http.Request) { w.Write([]byte(pdfBytes + strings.Repeat("x", 2048))) })
	f.Server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		f.hits.Add(1)
		mux.ServeHTTP(w, r)
	}))
	t.Cleanup(f.Close)
	c := New(1 << 20)
	c.AllowPrivateHosts = true
	c.ArXivAPI = f.URL + "/arxiv/api"
	c.ArXivPDF = f.URL + "/arxiv/pdf/"
	c.Crossref = f.URL + "/crossref/"
	c.SemanticScholar = f.URL + "/s2/"
	c.OpenReview = f.URL + "/openreview/"
	c.OpenReviewAPI = f.URL + "/openreview/api"
	c.DOIResolver = f.URL + "/doi/"
	return c, f
}

func TestDetectIdentifiers(t *testing.T) {
	ids := Detect("Some header arXiv:2401.01234v2 [cs.CL] 5 Jan 2024 … https://doi.org/10.1145/3290605.3300857.")
	if ids.ArXiv != "2401.01234v2" || ids.DOI != "10.1145/3290605.3300857" {
		t.Fatalf("%+v", ids)
	}
	if ids = Detect("no identifiers here 2024"); ids != (Identifiers{}) {
		t.Fatalf("false positive: %+v", ids)
	}
}

func TestResolveArXivUsesPublishedVersionDetails(t *testing.T) {
	c, _ := newFixture(t)
	for _, ref := range []string{"1706.03762", "arXiv:1706.03762v9", "https://arxiv.org/abs/1706.03762", "https://www.alphaxiv.org/abs/1706.03762"} {
		r, err := c.Resolve(context.Background(), ref)
		if err != nil {
			t.Fatalf("%s: %v", ref, err)
		}
		m := r.Metadata
		if string(r.PDF) != pdfBytes || m.Title != "Attention is all you need" || m.ItemType != "conference" || m.Venue != "Advances in Neural Information Processing Systems" || m.Pages != "6000-6010" {
			t.Fatalf("%s: %+v", ref, m)
		}
		// arXiv keeps its own abstract and identifier.
		if !strings.HasPrefix(m.Abstract, "The dominant") || !strings.HasPrefix(m.ArXiv, "1706.03762") || m.Creators[0] != (Creator{Given: "Ashish", Family: "Vaswani"}) {
			t.Fatalf("%s: %+v", ref, m)
		}
	}
}

func TestResolveDOIFindsOpenAccessPDF(t *testing.T) {
	c, _ := newFixture(t)
	r, err := c.Resolve(context.Background(), "doi:10.1000/oa")
	if err != nil {
		t.Fatal(err)
	}
	if string(r.PDF) != pdfBytes || r.Metadata.DOI != "10.1000/oa" || r.Metadata.Abstract != "Published & reviewed." || r.Metadata.Creators[1].Name != "Google Brain" || r.Metadata.Date != "2017-12" {
		t.Fatalf("%+v", r.Metadata)
	}
}

func TestResolvePublisherPageMetadata(t *testing.T) {
	c, f := newFixture(t)
	r, err := c.Resolve(context.Background(), f.URL+"/acl/2020.acl-main.740/")
	if err != nil {
		t.Fatal(err)
	}
	m := r.Metadata
	if m.Title != "Don't Stop Pretraining: Adapt Language Models" || m.Pages != "8342-8360" || m.Date != "2020-07-05" || m.ItemType != "conference" || m.DOI != "10.18653/v1/2020.acl-main.740" {
		t.Fatalf("%+v", m)
	}
	if m.Creators[0] != (Creator{Given: "Suchin", Family: "Gururangan"}) || m.Creators[1] != (Creator{Given: "Noah A.", Family: "Smith"}) {
		t.Fatalf("authors: %+v", m.Creators)
	}
	_, err = c.Resolve(context.Background(), f.URL+"/paywall")
	if err == nil || !strings.Contains(err.Error(), "Closed paper") {
		t.Fatalf("paywall: %v", err)
	}
	if _, err = c.Resolve(context.Background(), f.URL+"/files/html.pdf"); err == nil {
		t.Fatal("HTML accepted as a paper")
	}
}

func TestResolveOpenReviewAndTitle(t *testing.T) {
	c, _ := newFixture(t)
	r, err := c.Resolve(context.Background(), "https://openreview.net/forum?id=abc-1")
	if err != nil || r.Metadata.Title != "Review me" || r.Metadata.Venue != "ICLR 2024" || r.Metadata.Date != "2023-11-14" {
		t.Fatalf("%+v %v", r.Metadata, err)
	}
	if r, err = c.Resolve(context.Background(), "Graph Attention Networks"); err != nil || string(r.PDF) != pdfBytes {
		t.Fatalf("title: %v", err)
	}
	if _, err = c.Resolve(context.Background(), "an unrelated long title query"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("weak title match accepted: %v", err)
	}
	if _, err = c.Resolve(context.Background(), "short"); err == nil {
		t.Fatal("short text accepted")
	}
}

func TestLookupRequiresCloseTitles(t *testing.T) {
	c, _ := newFixture(t)
	m, err := c.Lookup(context.Background(), Identifiers{ArXiv: "1706.03762"})
	if err != nil || m.Venue == "" {
		t.Fatalf("%+v %v", m, err)
	}
	if _, err = c.Lookup(context.Background(), Identifiers{ArXiv: "0000.00000"}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("missing arXiv: %v", err)
	}
	// "Graph Attention Networks!" is close enough; a loose topic is not.
	if _, err = c.Lookup(context.Background(), Identifiers{Title: "graph attention networks"}); err != nil {
		t.Fatal(err)
	}
	if _, err = c.Lookup(context.Background(), Identifiers{Title: "attention networks for graphs and more"}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("loose title accepted: %v", err)
	}
}

func TestRejectsPrivateHostsAndLargeFiles(t *testing.T) {
	c, f := newFixture(t)
	c.AllowPrivateHosts = false
	before := f.hits.Load()
	for _, ref := range []string{f.URL + "/files/open.pdf", "http://localhost/x.pdf", "http://192.168.1.2/x.pdf", "ftp://example.com/x.pdf"} {
		if _, err := c.Resolve(context.Background(), ref); err == nil {
			t.Fatalf("fetched %s", ref)
		}
	}
	if f.hits.Load() != before {
		t.Fatal("request reached a private host")
	}
	c.AllowPrivateHosts = true
	c.MaxPDF = 1024
	if _, err := c.Resolve(context.Background(), f.URL+"/big.pdf"); err == nil || !strings.Contains(err.Error(), "超过") {
		t.Fatalf("large file: %v", err)
	}
}
