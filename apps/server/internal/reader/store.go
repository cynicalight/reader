package reader

import (
	"database/sql"
	"encoding/json"
	_ "modernc.org/sqlite"
	"os"
	"path/filepath"
	"time"
)

type Document struct {
	Category             string          `json:"category"`
	CategorySource       string          `json:"categorySource"`
	ClassificationStatus string          `json:"classificationStatus"`
	ClassificationError  string          `json:"classificationError"`
	Tags                 []string        `json:"tags"`
	ID                   string          `json:"id"`
	Type                 string          `json:"type"`
	Title                string          `json:"title"`
	Author               string          `json:"author"`
	Size                 int64           `json:"size"`
	CreatedAt            string          `json:"createdAt"`
	LastOpenedAt         string          `json:"lastOpenedAt"`
	Favorite             bool            `json:"favorite"`
	Progress             json.RawMessage `json:"progress,omitempty"`
	Percentage           float64         `json:"percentage"`
}
type Annotation struct {
	ID         string          `json:"id"`
	DocumentID string          `json:"documentId"`
	Kind       string          `json:"kind"`
	Location   json.RawMessage `json:"location"`
	Quote      string          `json:"quote"`
	Note       string          `json:"note"`
	Color      string          `json:"color"`
	CreatedAt  string          `json:"createdAt"`
}
type Message struct {
	Attachments []ImageAttachment `json:"attachments,omitempty"`
	Context     string            `json:"context,omitempty"`
	References  json.RawMessage   `json:"references,omitempty"`
	ID          string            `json:"id"`
	DocumentID  string            `json:"documentId"`
	Role        string            `json:"role"`
	Content     string            `json:"content"`
	CreatedAt   string            `json:"createdAt"`
}
type Store struct {
	DB   *sql.DB
	Root string
}

func OpenStore(root string) (*Store, error) {
	for _, dir := range []string{"books", "papers", "cache", "ai-work"} {
		if err := os.MkdirAll(filepath.Join(root, dir), 0700); err != nil {
			return nil, err
		}
	}
	db, err := sql.Open("sqlite", filepath.Join(root, "reader.sqlite"))
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	_, err = db.Exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
 CREATE TABLE IF NOT EXISTS documents(id TEXT PRIMARY KEY,type TEXT NOT NULL,title TEXT NOT NULL,author TEXT NOT NULL,size INTEGER NOT NULL,created_at TEXT NOT NULL,last_opened_at TEXT NOT NULL,favorite INTEGER NOT NULL DEFAULT 0,progress TEXT,percentage REAL NOT NULL DEFAULT 0);
 CREATE TABLE IF NOT EXISTS annotations(id TEXT PRIMARY KEY,document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,body TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS messages(id TEXT PRIMARY KEY,document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,body TEXT NOT NULL,created_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS document_processing(document_id TEXT PRIMARY KEY REFERENCES documents(id) ON DELETE CASCADE,phase TEXT NOT NULL,status TEXT NOT NULL,body TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS translations(document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,block_id TEXT NOT NULL,source_hash TEXT NOT NULL,status TEXT NOT NULL,body TEXT NOT NULL,priority INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(document_id,block_id,source_hash));
 CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
 CREATE VIRTUAL TABLE IF NOT EXISTS search_index USING fts5(document_id UNINDEXED,href UNINDEXED,content,tokenize='unicode61');`)
	if err != nil {
		db.Close()
		return nil, err
	}
	store := &Store{db, root}
	if err = store.migrateOrganization(); err != nil {
		db.Close()
		return nil, err
	}
	return store, nil
}
func now() string { return time.Now().UTC().Format(time.RFC3339Nano) }
func (s *Store) Documents() ([]Document, error) {
	rows, err := s.DB.Query(`SELECT id,type,title,author,size,created_at,last_opened_at,favorite,COALESCE(progress,''),percentage,category,category_source,classification_status,classification_error,tags FROM documents ORDER BY last_opened_at DESC,created_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	docs := []Document{}
	for rows.Next() {
		var d Document
		var progress, tags string
		if err = rows.Scan(&d.ID, &d.Type, &d.Title, &d.Author, &d.Size, &d.CreatedAt, &d.LastOpenedAt, &d.Favorite, &progress, &d.Percentage, &d.Category, &d.CategorySource, &d.ClassificationStatus, &d.ClassificationError, &tags); err != nil {
			return nil, err
		}
		if err == nil {
			err = json.Unmarshal([]byte(tags), &d.Tags)
		}
		if progress != "" {
			d.Progress = json.RawMessage(progress)
		}
		if err != nil {
			return nil, err
		}
		docs = append(docs, d)
	}
	return docs, rows.Err()
}
func (s *Store) Document(id string) (Document, error) {
	var d Document
	var progress, tags string
	err := s.DB.QueryRow(`SELECT id,type,title,author,size,created_at,last_opened_at,favorite,COALESCE(progress,''),percentage,category,category_source,classification_status,classification_error,tags FROM documents WHERE id=?`, id).Scan(&d.ID, &d.Type, &d.Title, &d.Author, &d.Size, &d.CreatedAt, &d.LastOpenedAt, &d.Favorite, &progress, &d.Percentage, &d.Category, &d.CategorySource, &d.ClassificationStatus, &d.ClassificationError, &tags)
	if err == nil {
		err = json.Unmarshal([]byte(tags), &d.Tags)
	}
	if progress != "" {
		d.Progress = json.RawMessage(progress)
	}
	return d, err
}
func (s *Store) File(d Document) string {
	dir := "books"
	if d.Type == "pdf" {
		dir = "papers"
	}
	return filepath.Join(s.Root, dir, d.ID+"."+d.Type)
}
