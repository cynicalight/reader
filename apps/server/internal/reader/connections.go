package reader

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"image"
	"image/color"
	"image/png"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

type APIConnection struct {
	URL    string `json:"url"`
	Model  string `json:"model"`
	Key    string `json:"key,omitempty"`
	HasKey bool   `json:"hasKey"`
}
type Capability struct {
	Text        bool   `json:"text"`
	Vision      bool   `json:"vision"`
	CheckedAt   string `json:"checkedAt"`
	Error       string `json:"error,omitempty"`
	Fingerprint string `json:"-"`
}
type AIConfig struct {
	Primary      string                `json:"primary"`
	Models       map[string]string     `json:"models"`
	TextAPI      APIConnection         `json:"textAPI"`
	ImageAPI     APIConnection         `json:"imageAPI"`
	Capabilities map[string]Capability `json:"capabilities"`
}
type savedConfig struct {
	Config       AIConfig          `json:"config"`
	Fingerprints map[string]string `json:"fingerprints"`
}
type AIInput struct {
	Prompt string
	Image  []byte
	Images [][]byte
}

func (in AIInput) images() [][]byte {
	if len(in.Images) > 0 {
		return in.Images
	}
	if len(in.Image) > 0 {
		return [][]byte{in.Image}
	}
	return nil
}

type AIResult struct {
	Text     string
	Provider string
	Fallback bool
}

func validAgent(p string) bool { return p == "codex" || p == "claude" || p == "kimi" }
func (s *Server) aiConfig() AIConfig {
	s.configMu.Lock()
	defer s.configMu.Unlock()
	return s.readAIConfig()
}
func (s *Server) readAIConfig() AIConfig {
	c := AIConfig{Models: map[string]string{}, Capabilities: map[string]Capability{}}
	b, err := os.ReadFile(filepath.Join(s.Store.Root, "ai-connections.json"))
	if err != nil {
		return c
	}
	var stored savedConfig
	if json.Unmarshal(b, &stored) != nil {
		return c
	}
	c = stored.Config
	if c.Models == nil {
		c.Models = map[string]string{}
	}
	if c.Capabilities == nil {
		c.Capabilities = map[string]Capability{}
	}
	for k, v := range c.Capabilities {
		v.Fingerprint = stored.Fingerprints[k]
		c.Capabilities[k] = v
	}
	return c
}
func (s *Server) writeAIConfig(c AIConfig) error {
	saved := savedConfig{Config: c, Fingerprints: map[string]string{}}
	for k, v := range c.Capabilities {
		saved.Fingerprints[k] = v.Fingerprint
	}
	b, e := json.MarshalIndent(saved, "", "  ")
	if e != nil {
		return e
	}
	return atomicFile(filepath.Join(s.Store.Root, "ai-connections.json"), b)
}
func atomicFile(path string, b []byte) error {
	if e := os.MkdirAll(filepath.Dir(path), 0700); e != nil {
		return e
	}
	f, e := os.CreateTemp(filepath.Dir(path), ".write-*")
	if e != nil {
		return e
	}
	name := f.Name()
	defer os.Remove(name)
	if _, e = f.Write(b); e != nil {
		f.Close()
		return e
	}
	if e = f.Sync(); e != nil {
		f.Close()
		return e
	}
	if e = f.Close(); e != nil {
		return e
	}
	return os.Rename(name, path)
}
func configPrint(c AIConfig, p string) string {
	var value any
	if p == "text-api" {
		value = c.TextAPI
	} else if p == "image-api" {
		value = c.ImageAPI
	} else {
		path, _ := exec.LookPath(p)
		value = []string{p, path, c.Models[p]}
	}
	b, _ := json.Marshal(value)
	h := sha256.Sum256(b)
	return hex.EncodeToString(h[:])
}
func capable(c AIConfig, p string, vision bool) bool {
	v := c.Capabilities[p]
	return v.Fingerprint == configPrint(c, p) && v.Text && (!vision || v.Vision)
}
func publicConfig(c AIConfig) AIConfig {
	c.TextAPI.HasKey = c.TextAPI.Key != ""
	c.TextAPI.Key = ""
	c.ImageAPI.HasKey = c.ImageAPI.Key != ""
	c.ImageAPI.Key = ""
	return c
}
func validateAPI(c APIConnection) error {
	if c.URL == "" && c.Model == "" && c.Key == "" {
		return nil
	}
	u, e := url.Parse(c.URL)
	if e != nil || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" {
		return errors.New("API 地址无效")
	}
	if u.Scheme != "https" && !(u.Scheme == "http" && (u.Hostname() == "localhost" || u.Hostname() == "127.0.0.1" || u.Hostname() == "::1")) {
		return errors.New("API 需要 HTTPS，本机服务可使用 HTTP")
	}
	if strings.TrimSpace(c.Model) == "" {
		return errors.New("请填写 API 模型")
	}
	return nil
}
func (s *Server) getAIConfig(w http.ResponseWriter, r *http.Request) {
	respond(w, 200, publicConfig(s.aiConfig()))
}
func (s *Server) putAIConfig(w http.ResponseWriter, r *http.Request) {
	var c AIConfig
	if !decode(w, r, &c) {
		return
	}
	if c.Primary != "" && !validAgent(c.Primary) {
		fail(w, 400, "请选择主 Agent")
		return
	}
	s.configMu.Lock()
	defer s.configMu.Unlock()
	old := s.readAIConfig()
	// Omitted keys preserve secrets; hasKey=false plus empty key explicitly clears one.
	if c.TextAPI.Key == "" && c.TextAPI.HasKey {
		c.TextAPI.Key = old.TextAPI.Key
	}
	if c.ImageAPI.Key == "" && c.ImageAPI.HasKey {
		c.ImageAPI.Key = old.ImageAPI.Key
	}
	c.TextAPI.HasKey = false
	c.ImageAPI.HasKey = false
	for _, a := range []APIConnection{c.TextAPI, c.ImageAPI} {
		if e := validateAPI(a); e != nil {
			fail(w, 400, e.Error())
			return
		}
	}
	c.Capabilities = old.Capabilities
	if c.Models == nil {
		c.Models = map[string]string{}
	}
	for k, v := range c.Capabilities {
		if v.Fingerprint != configPrint(c, k) {
			delete(c.Capabilities, k)
		}
	}
	if e := s.writeAIConfig(c); e != nil {
		fail(w, 500, "无法保存连接配置")
		return
	}
	respond(w, 200, publicConfig(c))
	s.wakeProcessing()
}
func (s *Server) testConnection(w http.ResponseWriter, r *http.Request) {
	p := r.PathValue("provider")
	if !validAgent(p) && p != "text-api" && p != "image-api" {
		fail(w, 400, "未知连接")
		return
	}
	c := s.aiConfig()
	fingerprint := configPrint(c, p)
	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Minute)
	defer cancel()
	cap := Capability{CheckedAt: now(), Fingerprint: fingerprint}
	answer, e := s.invoke(ctx, c, p, AIInput{Prompt: "Reply with exactly READER_OK. Do not use any tools."}, nil)
	if e != nil {
		cap.Error = e.Error()
	} else if strings.TrimSpace(answer) != "READER_OK" {
		cap.Error = "测试响应不符合预期"
	} else {
		cap.Text = true
	}
	if cap.Text && p != "text-api" {
		// Random challenge answers exist only in the pixels; guessing all 8 has probability 1/65536.
		data, expected, probeErr := visionProbe()
		if probeErr != nil {
			cap.Error = "无法生成图片测试"
		} else {
			answer, e = s.invoke(ctx, c, p, AIInput{Prompt: visionPrompt, Image: data}, nil)
			if e != nil {
				cap.Error = "文字可用；识图测试失败：" + e.Error()
			} else if strings.ToUpper(strings.Join(strings.Fields(answer), " ")) != expected {
				cap.Error = "文字可用；识图测试未通过"
			} else {
				cap.Vision = true
			}
		}
	}
	if r.Context().Err() != nil {
		return
	}
	s.configMu.Lock()
	latest := s.readAIConfig()
	if configPrint(latest, p) != fingerprint {
		s.configMu.Unlock()
		fail(w, 409, "配置已改变，请重新检测")
		return
	}
	latest.Capabilities[p] = cap
	err := s.writeAIConfig(latest)
	s.configMu.Unlock()
	if err != nil {
		fail(w, 500, "无法保存测试结果")
		return
	}
	respond(w, 200, cap)
	s.wakeProcessing()
}
func (s *Server) generate(ctx context.Context, in AIInput, delta func(string), fallback func(string)) (AIResult, error) {
	return s.generateWithConfig(ctx, s.aiConfig(), in, delta, fallback)
}
func (s *Server) generateWithConfig(ctx context.Context, c AIConfig, in AIInput, delta func(string), fallback func(string)) (AIResult, error) {
	return newGenerationService(s.Store.Root, c).Generate(ctx, in, false, legacyEmitter(delta, fallback))
}
func (s *Server) invoke(ctx context.Context, c AIConfig, p string, in AIInput, delta func(string)) (string, error) {
	service := newGenerationService(s.Store.Root, c)
	conn, ok := service.connections[p]
	if !ok {
		return "", generationError(ErrorConfiguration, "未知连接")
	}
	result, err := conn.Adapter.Stream(ctx, GenerateRequest{Input: in}, legacyEmitter(delta, nil))
	return result.Text, err
}

const visionPrompt = "Inspect the attached image. It contains one horizontal row of 8 colored squares. Reply with exactly 8 uppercase color names in left-to-right order, separated by single spaces. Allowed names: RED BLUE GREEN YELLOW. No punctuation or tools."

func visionProbe() ([]byte, string, error) {
	choices := make([]byte, 8)
	if _, err := rand.Read(choices); err != nil {
		return nil, "", err
	}
	colors := []color.RGBA{{230, 30, 30, 255}, {25, 70, 235, 255}, {30, 175, 65, 255}, {245, 210, 20, 255}}
	names := []string{"RED", "BLUE", "GREEN", "YELLOW"}
	im := image.NewRGBA(image.Rect(0, 0, 800, 140))
	for y := 0; y < 140; y++ {
		for x := 0; x < 800; x++ {
			im.Set(x, y, color.White)
		}
	}
	answer := make([]string, 8)
	for i, v := range choices {
		choice := int(v) % 4
		answer[i] = names[choice]
		for y := 30; y < 110; y++ {
			for x := i*100 + 10; x < i*100+90; x++ {
				im.Set(x, y, colors[choice])
			}
		}
	}
	var data bytes.Buffer
	if err := png.Encode(&data, im); err != nil {
		return nil, "", err
	}
	return data.Bytes(), strings.Join(answer, " "), nil
}
