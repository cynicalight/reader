package reader

import (
	"regexp"
	"strings"
)

var marginPageNumber = regexp.MustCompile(`(?i)^(?:page\s+)?[-–—]?\s*(?:\d{1,5}|[ivxlcdm]{1,8})\s*[-–—]?$`)

// Keep in sync with reader-core/pdf-content.ts. Semantic labels take precedence.
func isPDFPageDecoration(b PDFBlock) bool {
	switch b.Label {
	case "header", "footer", "number", "header_image", "footer_image":
		return true
	case "", "text":
		return (b.Bounds.Y < .1 || b.Bounds.Y+b.Bounds.Height > .9) && b.Bounds.Width < .18 && b.Bounds.Height < .045 && marginPageNumber.MatchString(strings.TrimSpace(b.Text))
	default:
		return false
	}
}
