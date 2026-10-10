package reader

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"golang.org/x/net/html"
)

// A preview is a consistent SQLite read transaction, held in memory after the
// database is closed. Imports use only these server-owned paths and records.
type zoteroScan struct {
	ID        string         `json:"id"`
	Directory string         `json:"directory"`
	Entries   []*zoteroEntry `json:"entries"`
	Warnings  []string       `json:"warnings"`
	expires   time.Time
}
type zoteroEntry struct {
	ID                                      string   `json:"id"`
	Title                                   string   `json:"title"`
	Filename                                string   `json:"filename"`
	Collections                             []string `json:"collections"`
	Tags                                    []string `json:"tags"`
	Notes                                   int      `json:"notes"`
	Annotations                             int      `json:"annotations"`
	Size                                    int64    `json:"size"`
	Issue                                   string   `json:"issue,omitempty"`
	Warnings                                []string `json:"warnings"`
	sourceInfo                              os.FileInfo
	path                                    string
	root                                    string
	library                                 int
	itemKey, attachmentKey, itemType, added string
	fields                                  map[string]string
	creators                                []Creator
	notes                                   []zoteroNote
	annotations                             []zoteroAnnotation
}
type zoteroNote struct{ Key, HTML string }
type zoteroAnnotation struct {
	Key                                   string
	Type                                  int
	Text, Comment, Color, Position, Added string
	Tags                                  []string
}
type zoteroCollection struct {
	name   string
	parent int
}

func zoteroRows(ctx context.Context, tx *sql.Tx, query string, args []any, read func(*sql.Rows) error) error {
	rows, err := tx.QueryContext(ctx, query, args...)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		if err := read(rows); err != nil {
			return err
		}
	}
	return rows.Err()
}

func readZotero(ctx context.Context, directory, linkedBase string) (*zoteroScan, error) {
	if strings.TrimSpace(directory) == "" {
		return nil, errors.New("请选择包含 zotero.sqlite 的资料目录")
	}
	directory, err := filepath.Abs(directory)
	if err != nil {
		return nil, err
	}
	directory, err = filepath.EvalSymlinks(directory)
	if err != nil {
		return nil, errors.New("Zotero 资料目录不存在或无法访问")
	}
	dbPath := filepath.Join(directory, "zotero.sqlite")
	info, err := os.Stat(dbPath)
	if err != nil || !info.Mode().IsRegular() {
		return nil, errors.New("目录中没有 zotero.sqlite，请在 Zotero 设置 → 高级中查看资料目录")
	}
	u := url.URL{Scheme: "file", Path: filepath.ToSlash(dbPath)}
	q := url.Values{"mode": {"ro"}, "_pragma": {"query_only(1)", "busy_timeout(3000)"}}
	u.RawQuery = q.Encode()
	db, err := sql.Open("sqlite", u.String())
	if err != nil {
		return nil, err
	}
	defer db.Close()
	db.SetMaxOpenConns(1)
	tx, err := db.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	scan := &zoteroScan{ID: id(), Directory: directory, Entries: []*zoteroEntry{}, Warnings: []string{}, expires: time.Now().Add(time.Hour)}
	collections := map[int]zoteroCollection{}
	err = zoteroRows(ctx, tx, `SELECT collectionID,collectionName,COALESCE(parentCollectionID,0) FROM collections`, nil, func(r *sql.Rows) error {
		var key int
		var c zoteroCollection
		if err := r.Scan(&key, &c.name, &c.parent); err != nil {
			return err
		}
		collections[key] = c
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("无法读取 Zotero 分类：%w", err)
	}
	collectionPath := func(key int) (string, error) {
		parts := []string{}
		seen := map[int]bool{}
		for key != 0 {
			c, ok := collections[key]
			if !ok || seen[key] {
				return "", errors.New("分类层级损坏")
			}
			seen[key] = true
			// A slash within a Zotero name is literal, not a Reader hierarchy separator.
			parts = append([]string{strings.ReplaceAll(c.name, "/", "／")}, parts...)
			key = c.parent
		}
		return strings.Join(parts, "/"), nil
	}
	type item struct {
		id, library      int
		key, kind, added string
	}
	items := []item{}
	err = zoteroRows(ctx, tx, `SELECT i.itemID,i.libraryID,i.key,t.typeName,i.dateAdded FROM items i JOIN itemTypes t USING(itemTypeID) JOIN libraries l USING(libraryID) WHERE t.typeName NOT IN ('attachment','note','annotation') AND l.type != 'feed' AND NOT EXISTS(SELECT 1 FROM deletedItems d WHERE d.itemID=i.itemID) ORDER BY i.itemID LIMIT 20001`, nil, func(r *sql.Rows) error {
		var v item
		if err := r.Scan(&v.id, &v.library, &v.key, &v.kind, &v.added); err != nil {
			return err
		}
		items = append(items, v)
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("无法读取 Zotero 条目，请检查资料库版本：%w", err)
	}
	if len(items) > 20000 {
		return nil, errors.New("资料库超过 20000 条，暂不支持一次扫描")
	}
	for _, v := range items {
		base := zoteroEntry{Title: v.key, library: v.library, itemKey: v.key, itemType: v.kind, added: v.added, fields: map[string]string{}, Collections: []string{}, Tags: []string{}, Warnings: []string{}}
		err = zoteroRows(ctx, tx, `SELECT f.fieldName,CAST(v.value AS TEXT) FROM itemData d JOIN fields f USING(fieldID) JOIN itemDataValues v USING(valueID) WHERE d.itemID=?`, []any{v.id}, func(r *sql.Rows) error {
			var k, value string
			if err := r.Scan(&k, &value); err != nil {
				return err
			}
			base.fields[k] = value
			return nil
		})
		if err != nil {
			return nil, err
		}
		if title := base.fields["title"]; title != "" {
			base.Title = title
		}
		err = zoteroRows(ctx, tx, `SELECT COALESCE(c.firstName,''),COALESCE(c.lastName,''),COALESCE(c.fieldMode,0) FROM itemCreators ic JOIN creators c USING(creatorID) JOIN creatorTypes ct USING(creatorTypeID) WHERE ic.itemID=? AND ct.creatorType IN ('author','bookAuthor') ORDER BY ic.orderIndex`, []any{v.id}, func(r *sql.Rows) error {
			var c Creator
			var mode int
			if err := r.Scan(&c.Given, &c.Family, &mode); err != nil {
				return err
			}
			if mode == 1 {
				c.Name = c.Family
				c.Given = ""
				c.Family = ""
			}
			base.creators = append(base.creators, c)
			return nil
		})
		if err != nil {
			return nil, err
		}
		base.Tags, err = zoteroTags(ctx, tx, v.id)
		if err != nil {
			return nil, err
		}
		err = zoteroRows(ctx, tx, `SELECT collectionID FROM collectionItems WHERE itemID=? ORDER BY collectionID`, []any{v.id}, func(r *sql.Rows) error {
			var key int
			if err := r.Scan(&key); err != nil {
				return err
			}
			name, e := collectionPath(key)
			if e != nil {
				return e
			}
			base.Collections = append(base.Collections, name)
			return nil
		})
		if err != nil {
			return nil, err
		}
		base.notes, err = zoteroNotes(ctx, tx, v.id)
		if err != nil {
			return nil, err
		}
		type attachment struct {
			id        int
			key, path string
			mode      int
		}
		attachments := []attachment{}
		err = zoteroRows(ctx, tx, `SELECT a.itemID,i.key,COALESCE(a.path,''),a.linkMode FROM itemAttachments a JOIN items i USING(itemID) WHERE a.parentItemID=? AND (a.contentType='application/pdf' OR lower(a.path) LIKE '%.pdf') AND NOT EXISTS(SELECT 1 FROM deletedItems d WHERE d.itemID=a.itemID) ORDER BY a.itemID`, []any{v.id}, func(r *sql.Rows) error {
			var a attachment
			if err := r.Scan(&a.id, &a.key, &a.path, &a.mode); err != nil {
				return err
			}
			attachments = append(attachments, a)
			return nil
		})
		if err != nil {
			return nil, err
		}
		if len(attachments) == 0 {
			base.ID = fmt.Sprintf("%d/%s", v.library, v.key)
			base.Issue = "没有 PDF 附件（仅元数据条目尚不能导入）"
			base.Notes = len(base.notes)
			scan.Entries = append(scan.Entries, &base)
			continue
		}
		for _, a := range attachments {
			entry := base
			entry.ID = fmt.Sprintf("%d/%s", v.library, a.key)
			entry.attachmentKey = a.key
			entry.Warnings = append([]string{}, base.Warnings...)
			entry.notes = append([]zoteroNote{}, base.notes...)
			notes, e := zoteroNotes(ctx, tx, a.id)
			if e != nil {
				return nil, e
			}
			entry.notes = append(entry.notes, notes...)
			entry.Notes = len(entry.notes)
			entry.path, entry.root, e = zoteroAttachmentPath(directory, linkedBase, a.key, a.path, a.mode)
			entry.Filename = filepath.Base(entry.path)
			if e != nil {
				entry.Issue = e.Error()
				entry.Filename = filepath.Base(a.path)
			} else if stat, e := os.Stat(entry.path); e != nil || !stat.Mode().IsRegular() {
				entry.Issue = "PDF 不在本机或无法读取，请先在 Zotero 下载附件"
			} else {
				entry.sourceInfo = stat
				entry.Size = stat.Size()
				entry.Issue = paperLimit("pdf", entry.Size, entry.path)
			}
			err = zoteroRows(ctx, tx, `SELECT i.key,a.type,COALESCE(a.text,''),COALESCE(a.comment,''),COALESCE(a.color,''),a.position,i.dateAdded FROM itemAnnotations a JOIN items i USING(itemID) WHERE a.parentItemID=? AND NOT EXISTS(SELECT 1 FROM deletedItems d WHERE d.itemID=a.itemID) ORDER BY a.sortIndex`, []any{a.id}, func(r *sql.Rows) error {
				var x zoteroAnnotation
				if err := r.Scan(&x.Key, &x.Type, &x.Text, &x.Comment, &x.Color, &x.Position, &x.Added); err != nil {
					return err
				}
				entry.annotations = append(entry.annotations, x)
				return nil
			})
			if err != nil {
				return nil, fmt.Errorf("无法读取 Zotero 批注：%w", err)
			}
			// Tags on annotations are independent from their parent item's tags.
			for j := range entry.annotations {
				var itemID int
				err = tx.QueryRowContext(ctx, `SELECT itemID FROM items WHERE libraryID=? AND key=?`, v.library, entry.annotations[j].Key).Scan(&itemID)
				if err != nil {
					return nil, err
				}
				entry.annotations[j].Tags, err = zoteroTags(ctx, tx, itemID)
				if err != nil {
					return nil, err
				}
			}
			entry.Annotations = len(entry.annotations)
			if len(attachments) > 1 {
				entry.Warnings = append(entry.Warnings, "同一条目的多个 PDF 分别导入，共享论文信息和笔记")
			}
			scan.Entries = append(scan.Entries, &entry)
		}
	}
	var standalone int
	err = tx.QueryRowContext(ctx, `SELECT count(*) FROM items i JOIN itemTypes t USING(itemTypeID) WHERE t.typeName IN ('attachment','note') AND NOT EXISTS(SELECT 1 FROM deletedItems d WHERE d.itemID=i.itemID) AND (EXISTS(SELECT 1 FROM itemAttachments a WHERE a.itemID=i.itemID AND a.parentItemID IS NULL) OR EXISTS(SELECT 1 FROM itemNotes n WHERE n.itemID=i.itemID AND n.parentItemID IS NULL))`).Scan(&standalone)
	if err != nil {
		return nil, err
	}
	if standalone > 0 {
		scan.Warnings = append(scan.Warnings, fmt.Sprintf("%d 条独立附件或独立笔记没有所属论文，本次不导入", standalone))
	}
	return scan, tx.Commit()
}

func zoteroTags(ctx context.Context, tx *sql.Tx, item int) ([]string, error) {
	tags := []string{}
	err := zoteroRows(ctx, tx, `SELECT t.name FROM itemTags it JOIN tags t USING(tagID) WHERE it.itemID=? ORDER BY t.name`, []any{item}, func(r *sql.Rows) error {
		var tag string
		if err := r.Scan(&tag); err != nil {
			return err
		}
		tags = append(tags, tag)
		return nil
	})
	return tags, err
}
func zoteroNotes(ctx context.Context, tx *sql.Tx, item int) ([]zoteroNote, error) {
	notes := []zoteroNote{}
	err := zoteroRows(ctx, tx, `SELECT i.key,COALESCE(n.note,'') FROM itemNotes n JOIN items i USING(itemID) WHERE (n.parentItemID=? OR n.itemID=?) AND NOT EXISTS(SELECT 1 FROM deletedItems d WHERE d.itemID=n.itemID) ORDER BY n.itemID`, []any{item, item}, func(r *sql.Rows) error {
		var n zoteroNote
		if err := r.Scan(&n.Key, &n.HTML); err != nil {
			return err
		}
		if n.HTML != "" {
			notes = append(notes, n)
		}
		return nil
	})
	return notes, err
}

func zoteroAttachmentPath(directory, base, key, path string, mode int) (string, string, error) {
	switch mode {
	case 0, 1:
		if len(key) != 8 || strings.ContainsAny(key, "/\\.") {
			return "", "", errors.New("附件标识无效")
		}
		name := strings.TrimPrefix(path, "storage:")
		if name == path || name == "" || strings.ContainsAny(name, "/\\") || name == "." || name == ".." {
			return "", "", errors.New("附件存储路径无效")
		}
		root := filepath.Join(directory, "storage", key)
		return filepath.Join(root, name), root, nil
	case 2:
		if strings.HasPrefix(path, "attachments:") {
			if base == "" {
				return "", "", errors.New("此链接附件需要填写 Zotero 的链接附件基目录")
			}
			name := filepath.FromSlash(strings.TrimPrefix(path, "attachments:"))
			if !filepath.IsLocal(name) {
				return "", "", errors.New("链接附件路径无效")
			}
			root, err := filepath.Abs(base)
			if err != nil {
				return "", "", err
			}
			return filepath.Join(root, name), root, nil
		}
		if !filepath.IsAbs(path) {
			return "", "", errors.New("链接附件路径不是本机绝对路径")
		}
		return filepath.Clean(path), "", nil
	default:
		return "", "", errors.New("此附件不是本地 PDF 文件")
	}
}

// Extract inert text only. The original HTML is archived in the migration record.
func zoteroNoteText(source string) string {
	node, err := html.Parse(strings.NewReader(source))
	if err != nil {
		return ""
	}
	var out strings.Builder
	var walk func(*html.Node)
	walk = func(n *html.Node) {
		if n.Type == html.ElementNode {
			switch n.Data {
			case "script", "style", "iframe", "object":
				return
			case "img":
				out.WriteString("[图片保留在 Zotero 原笔记中]")
			case "br":
				out.WriteByte('\n')
			}
		}
		if n.Type == html.TextNode {
			out.WriteString(n.Data)
		}
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			walk(c)
		}
		if n.Type == html.ElementNode {
			switch n.Data {
			case "p", "div", "li", "h1", "h2", "h3", "tr", "blockquote":
				out.WriteByte('\n')
			}
		}
	}
	walk(node)
	return strings.TrimSpace(out.String())
}

func zoteroDate(value string) string {
	for _, layout := range []string{time.RFC3339Nano, "2006-01-02 15:04:05"} {
		if t, e := time.Parse(layout, value); e == nil {
			return t.UTC().Format(time.RFC3339Nano)
		}
	}
	return now()
}

func (e *zoteroEntry) archive() []byte {
	data, _ := json.Marshal(struct {
		Fields            map[string]string
		Creators          []Creator
		Collections, Tags []string
		Notes             []zoteroNote
		Annotations       []zoteroAnnotation
	}{e.fields, e.creators, e.Collections, e.Tags, e.notes, e.annotations})
	return data
}
