package reader

import "strings"

// Translation operates on ordered text, independently of PDF geometry or EPUB DOM.
type translationInput interface {
	translationParagraphs() []translationParagraph
	translationFrontMatter() []string
	// Pending records for every translatable unit, including non-text work.
	translationItems() []TranslationBlock
}

func (m layoutManifest) translationParagraphs() []translationParagraph {
	out := []translationParagraph{}
	for _, b := range m.Blocks {
		if source := translationSource(b); source != "" {
			out = append(out, translationParagraph{b.ID, translationHash(source), source})
		}
	}
	return out
}
func (m layoutManifest) translationItems() []TranslationBlock {
	out := []TranslationBlock{}
	for _, b := range m.Blocks {
		if needsTranslation(b) {
			out = append(out, newTranslation(b))
		}
	}
	return out
}

// Keep verbatim title-page evidence when PDF author metadata is missing.
func (m layoutManifest) translationFrontMatter() []string {
	out := []string{}
	for _, b := range m.Blocks {
		if b.Page != 1 {
			break
		}
		text := strings.TrimSpace(b.Text)
		if b.Label == "paragraph_title" || strings.EqualFold(text, "abstract") || text == "摘要" {
			break
		}
		if text != "" && !isImageAsset(b) && !isPDFPageDecoration(b) {
			out = append(out, text)
		}
	}
	return out
}
func (s *Server) readTranslationSource(id string) (translationInput, error) {
	d, err := s.Store.Document(id)
	if err != nil {
		return nil, err
	}
	if d.Type == "epub" {
		return s.readEPUBBlocks(id)
	}
	return s.readLayout(id)
}
