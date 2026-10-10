package reader

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math"
	"os"

	"rsc.io/pdf"
)

// Zotero positions are PDF user-space coordinates. Reader stores fractions of
// the displayed PDF.js viewport. Account for inherited crop boxes and rotation.
func zoteroConvertAnnotation(path, documentID string, library int, a zoteroAnnotation) (annotation *Annotation, warning string) {
	fallback := func() (*Annotation, string) {
		return nil, fmt.Sprintf("批注 %s 无法转换位置或类型，文本与原始位置转入论文笔记", a.Key)
	}
	defer func() {
		if recover() != nil {
			annotation, warning = fallback()
		}
	}()
	kind := map[int]string{1: "highlight", 2: "note", 5: "underline"}[a.Type]
	if kind == "" {
		return fallback()
	}
	var position struct {
		PageIndex     *int        `json:"pageIndex"`
		Rects         [][]float64 `json:"rects"`
		NextPageRects [][]float64 `json:"nextPageRects"`
	}
	if json.Unmarshal([]byte(a.Position), &position) != nil || position.PageIndex == nil || *position.PageIndex < 0 || len(position.Rects) == 0 || len(position.NextPageRects) > 0 {
		return fallback()
	}
	f, err := os.Open(path)
	if err != nil {
		return fallback()
	}
	defer f.Close()
	stat, err := f.Stat()
	if err != nil {
		return fallback()
	}
	reader, err := pdf.NewReader(f, stat.Size())
	if err != nil || *position.PageIndex >= reader.NumPage() {
		return fallback()
	}
	page := reader.Page(*position.PageIndex + 1)
	inherited := func(key string) pdf.Value {
		for v, i := page.V, 0; !v.IsNull() && i < 100; v, i = v.Key("Parent"), i+1 {
			if value := v.Key(key); !value.IsNull() {
				return value
			}
		}
		return pdf.Value{}
	}
	media := inherited("MediaBox")
	if media.Len() != 4 {
		return fallback()
	}
	box := [4]float64{}
	for i := range box {
		box[i] = media.Index(i).Float64()
	}
	crop := inherited("CropBox")
	if crop.Len() == 4 {
		box[0] = math.Max(box[0], crop.Index(0).Float64())
		box[1] = math.Max(box[1], crop.Index(1).Float64())
		box[2] = math.Min(box[2], crop.Index(2).Float64())
		box[3] = math.Min(box[3], crop.Index(3).Float64())
	}
	if box[2] <= box[0] || box[3] <= box[1] {
		return fallback()
	}
	rotation := 0
	for v, i := page.V, 0; !v.IsNull() && i < 100; v, i = v.Key("Parent"), i+1 {
		if !v.Key("Rotate").IsNull() {
			rotation = int(v.Key("Rotate").Int64())
			break
		}
	}
	rotation = ((rotation % 360) + 360) % 360
	if rotation%90 != 0 {
		return fallback()
	}
	rects := []annotationRect{}
	for _, rect := range position.Rects {
		if len(rect) != 4 {
			return fallback()
		}
		normalized, ok := zoteroRect(rect, box, rotation)
		if !ok {
			return fallback()
		}
		rects = append(rects, normalized)
	}
	loc, _ := json.Marshal(annotationPDFLocation{Type: "pdf", Page: *position.PageIndex + 1, Rects: rects})
	hash := sha256.Sum256([]byte(fmt.Sprintf("zotero:%s:%d:%s", documentID, library, a.Key)))
	tags, warnings := zoteroLabels(nil, a.Tags, "批注标签")
	if len(warnings) > 0 {
		warning = fmt.Sprintf("批注 %s 的部分标签超出限制，原标签保存在迁移记录中", a.Key)
	}
	color := a.Color
	if !zoteroColor(color) {
		color = "#ffd400"
	}
	return &Annotation{ID: hex.EncodeToString(hash[:16]), DocumentID: documentID, Kind: kind, Location: loc, Quote: a.Text, Note: a.Comment, Color: color, CreatedAt: zoteroDate(a.Added), Tags: tags}, warning
}
func zoteroColor(color string) bool {
	if len(color) != 7 || color[0] != '#' {
		return false
	}
	_, err := hex.DecodeString(color[1:])
	return err == nil
}
func zoteroRect(rect []float64, box [4]float64, rotation int) (annotationRect, bool) {
	for _, v := range rect {
		if math.IsNaN(v) || math.IsInf(v, 0) {
			return annotationRect{}, false
		}
	}
	x1, y1, x2, y2 := rect[0], rect[1], rect[2], rect[3]
	if x2 <= x1 || y2 <= y1 || x1 < box[0] || y1 < box[1] || x2 > box[2] || y2 > box[3] {
		return annotationRect{}, false
	}
	point := func(x, y float64) (float64, float64) {
		x = (x - box[0]) / (box[2] - box[0])
		y = (y - box[1]) / (box[3] - box[1])
		switch rotation {
		case 90:
			return y, x
		case 180:
			return 1 - x, y
		case 270:
			return 1 - y, 1 - x
		default:
			return x, 1 - y
		}
	}
	ax, ay := point(x1, y1)
	bx, by := point(x2, y2)
	return annotationRect{X: math.Min(ax, bx), Y: math.Min(ay, by), Width: math.Abs(bx - ax), Height: math.Abs(by - ay)}, true
}
