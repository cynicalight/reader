package reader

import (
	"encoding/json"
	"strings"
)

// An empty locator is accepted for older progress records. A populated locator
// must agree with the outer EPUB location, which is what the API authorizes.
func validEPUBLocator(encoded, href string) bool {
	if encoded == "" {
		return true
	}
	var fields map[string]json.RawMessage
	if json.Unmarshal([]byte(encoded), &fields) != nil || fields == nil {
		return false
	}
	if len(fields) == 0 {
		return true
	}
	var locator struct {
		Href      string `json:"href"`
		Type      string `json:"type"`
		Locations struct {
			Progression      *float64 `json:"progression"`
			TotalProgression *float64 `json:"totalProgression"`
			DOMRange         *struct {
				Start *annotationDOMPoint `json:"start"`
				End   *annotationDOMPoint `json:"end"`
			} `json:"domRange"`
			SourceSlice *annotationTextRange `json:"sourceSlice"`
			TextRange   *annotationTextRange `json:"textRange"`
		} `json:"locations"`
	}
	if json.Unmarshal([]byte(encoded), &locator) != nil || locator.Href == "" || locator.Type == "" {
		return false
	}
	inner, err := safeResource(locator.Href)
	outer, outerErr := safeResource(href)
	if err != nil || outerErr != nil || inner != outer {
		return false
	}
	for _, p := range []*float64{locator.Locations.Progression, locator.Locations.TotalProgression} {
		if p != nil && (*p < 0 || *p > 1) {
			return false
		}
	}
	if r := locator.Locations.DOMRange; r != nil {
		validPoint := func(p *annotationDOMPoint) bool {
			return p != nil && strings.TrimSpace(p.CSSSelector) != "" && p.TextNodeIndex >= 0 && p.CharOffset >= 0
		}
		if !validPoint(r.Start) || (r.End != nil && !validPoint(r.End)) {
			return false
		}
	}
	for _, r := range []*annotationTextRange{locator.Locations.TextRange, locator.Locations.SourceSlice} {
		if r != nil && (r.Start < 0 || r.End <= r.Start) {
			return false
		}
	}
	return true
}

// Translation annotations retain original chapter locations for every selected
// paragraph. Validate them at the same boundary as the outer location.
func validEPUBTranslationLocations(data json.RawMessage) bool {
	var outer struct {
		Translation *struct {
			Ranges []struct {
				Location json.RawMessage `json:"location"`
			} `json:"ranges"`
		} `json:"translation"`
	}
	if json.Unmarshal(data, &outer) != nil {
		return false
	}
	if outer.Translation == nil {
		return true
	}
	for _, r := range outer.Translation.Ranges {
		if len(r.Location) == 0 {
			continue
		}
		var source struct {
			Type        string          `json:"type"`
			Href        string          `json:"href"`
			Locator     string          `json:"locator"`
			Progression float64         `json:"progression"`
			Translation json.RawMessage `json:"translation"`
		}
		if json.Unmarshal(r.Location, &source) != nil || source.Type != "epub" || len(source.Translation) > 0 || !validEPUBBlockLocation(r.Location) {
			return false
		}
		if _, err := safeResource(source.Href); err != nil || source.Href == "" || source.Progression < 0 || source.Progression > 1 || !validEPUBLocator(source.Locator, source.Href) {
			return false
		}
	}
	return true
}

func validEPUBBlockLocation(data json.RawMessage) bool {
	var value struct {
		BlockID    *string `json:"blockId"`
		Start      *int    `json:"start"`
		End        *int    `json:"end"`
		EndBlockID *string `json:"endBlockId"`
	}
	if json.Unmarshal(data, &value) != nil {
		return false
	}
	if value.BlockID == nil {
		return value.Start == nil && value.End == nil && value.EndBlockID == nil
	}
	if strings.TrimSpace(*value.BlockID) == "" {
		return false
	}
	if value.Start == nil || value.End == nil || *value.Start < 0 || *value.End < 0 {
		return false
	}
	if value.EndBlockID != nil {
		return strings.TrimSpace(*value.EndBlockID) != "" && (*value.EndBlockID != *value.BlockID || *value.End >= *value.Start)
	}
	return *value.End >= *value.Start
}
