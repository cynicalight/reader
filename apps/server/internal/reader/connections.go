package reader

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"io"
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
	Primary      string                       `json:"primary"`
	Models       map[string]string            `json:"models"`
	Efforts      map[string]map[string]string `json:"efforts,omitempty"`
	TextAPI      APIConnection                `json:"textAPI"`
	ImageAPI     APIConnection                `json:"imageAPI"`
	Capabilities map[string]Capability        `json:"capabilities"`
}
type savedConfig struct {
	Config       AIConfig          `json:"config"`
	Fingerprints map[string]string `json:"fingerprints"`
}
type AIInput struct {
	Effort string
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
	for provider, models := range c.Efforts {
		for _, effort := range models {
			if !validEffort(provider, effort) {
				fail(w, 400, "无效的 Effort 档位")
				return
			}
		}
	}
	s.configMu.Lock()
	defer s.configMu.Unlock()
	old := s.readAIConfig()
	if c.Efforts == nil {
		c.Efforts = old.Efforts
	}
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
	if !validAgent(c.Primary) {
		return AIResult{}, errors.New("请在设置中指定主 Agent 并测试")
	}
	p := c.Primary
	var text string
	var err error
	streamed := false
	var emit func(string)
	if delta != nil {
		emit = func(part string) {
			if part != "" {
				streamed = true
				delta(part)
			}
		}
	}
	if capable(c, p, len(in.images()) > 0) {
		text, err = s.invoke(ctx, c, p, in, emit)
	} else {
		err = errors.New("主 Agent 尚未通过所需能力测试")
	}
	if err == nil {
		return AIResult{text, p, false}, nil
	}
	if ctx.Err() != nil {
		return AIResult{}, ctx.Err()
	}
	// Once text is visible, fallback would append a second answer to the first.
	// Background jobs (nil delta) can still retry through the configured API.
	if streamed {
		return AIResult{}, fmt.Errorf("%s 流式回答中断，请重试：%w", p, err)
	}
	target := "text-api"
	if len(in.images()) > 0 {
		target = "image-api"
	}
	if !capable(c, target, len(in.images()) > 0) {
		return AIResult{}, fmt.Errorf("%s：%s；没有经过验证的备用 %s", p, err, target)
	}
	if fallback != nil {
		fallback(fmt.Sprintf("%s 调用失败，已切换到 %s", p, target))
	}
	text, err = s.invoke(ctx, c, target, in, delta)
	return AIResult{text, target, true}, err
}
func (s *Server) invoke(ctx context.Context, c AIConfig, p string, in AIInput, delta func(string)) (string, error) {
	if p == "text-api" {
		return invokeAPI(ctx, c.TextAPI, in, delta)
	}
	if p == "image-api" {
		return invokeAPI(ctx, c.ImageAPI, in, delta)
	}
	level := c.Efforts[p][c.Models[p]]
	if level == "" {
		level = "medium"
	}
	models, err := s.modelCatalog(ctx, p)
	if err != nil {
		return "", errors.New("无法获取模型的 Effort 配置，请重试")
	}
	in.Effort = nativeEffort(p, level, c.Models[p], models)
	return invokeCLI(ctx, s.Store.Root, p, c.Models[p], in, delta)
}

func validEffort(provider, effort string) bool {
	return validAgent(provider) && (effort == "low" || effort == "medium" || effort == "high" || effort == "max")
}

func invokeAPI(ctx context.Context, c APIConnection, in AIInput, delta func(string)) (string, error) {
	if e := validateAPI(c); e != nil {
		return "", e
	}
	if c.URL == "" {
		return "", errors.New("未配置 API")
	}
	var content any = in.Prompt
	if len(in.images()) > 0 {
		parts := []any{map[string]any{"type": "text", "text": in.Prompt}}
		for _, image := range in.images() {
			parts = append(parts, map[string]any{"type": "image_url", "image_url": map[string]string{"url": imageData(image)}})
		}
		content = parts
	}
	body, _ := json.Marshal(map[string]any{"model": c.Model, "messages": []any{map[string]any{"role": "user", "content": content}}, "stream": false})
	req, e := http.NewRequestWithContext(ctx, "POST", strings.TrimRight(c.URL, "/")+"/chat/completions", bytes.NewReader(body))
	if e != nil {
		return "", errors.New("API 地址无效")
	}
	req.Header.Set("Content-Type", "application/json")
	if c.Key != "" {
		req.Header.Set("Authorization", "Bearer "+c.Key)
	}
	client := &http.Client{Timeout: 3 * time.Minute, CheckRedirect: func(*http.Request, []*http.Request) error { return errors.New("API 重定向已拒绝") }}
	res, e := client.Do(req)
	if e != nil {
		return "", errors.New("API 网络请求失败或超时")
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		return "", fmt.Errorf("API 返回 HTTP %d", res.StatusCode)
	}
	b, e := io.ReadAll(io.LimitReader(res.Body, (2<<20)+1))
	if e != nil || len(b) > 2<<20 {
		return "", errors.New("API 响应无效或过大")
	}
	var out struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	if json.Unmarshal(b, &out) != nil || len(out.Choices) == 0 || strings.TrimSpace(out.Choices[0].Message.Content) == "" {
		return "", errors.New("API 没有返回文字回答")
	}
	text := out.Choices[0].Message.Content
	if delta != nil {
		delta(text)
	}
	return text, nil
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
