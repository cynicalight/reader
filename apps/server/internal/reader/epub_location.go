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
			TextRange *annotationTextRange `json:"textRange"`
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
	if r := locator.Locations.TextRange; r != nil && (r.Start < 0 || r.End <= r.Start) {
		return false
	}
	return true
}
