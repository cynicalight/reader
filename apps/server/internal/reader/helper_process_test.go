package reader

import (
	"bufio"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// Dispatch before testing parses CLI arguments. A copy/link of this native test
// executable acts as each provider on Windows as well as Unix, without a shell.
func TestMain(m *testing.M) {
	if os.Getenv("READER_AGENT_HELPER") != "" {
		switch os.Getenv("READER_AGENT_MODE") {
		case "translation-session":
			runTranslationSessionProcess()
		case "chat-session":
			runChatSessionProcess()
		case "models":
			runModelProcess()
		case "models-wait":
			time.Sleep(time.Minute)
		default:
			runAgentProcess()
		}
		os.Exit(0)
	}
	os.Exit(m.Run())
}

func runModelProcess() {
	cwd, err := os.Getwd()
	if err != nil || filepath.Base(filepath.Dir(cwd)) != "ai-work" || !strings.HasPrefix(filepath.Base(cwd), "models-") {
		os.Exit(9)
	}
	scanner := bufio.NewScanner(os.Stdin)
	for scanner.Scan() {
		line := scanner.Text()
		switch {
		case strings.Contains(line, `"subtype":"initialize"`):
			fmt.Println(`{"type":"control_response","response":{"request_id":"1","subtype":"success","response":{"models":[{"value":"default","resolvedModel":"model-a"},{"value":"alias","resolvedModel":"model-a","displayName":"Model A"}]}}}`)
		case strings.Contains(line, `"method":"initialize"`):
			fmt.Println(`{"id":1,"result":{}}`)
		case strings.Contains(line, `"method":"initialized"`):
		case strings.Contains(line, `"method":"model/list"`):
			fmt.Println(`{"id":2,"result":{"data":[{"model":"model-a","displayName":"Model A","isDefault":true}]}}`)
		case strings.Contains(line, `"method":"session/new"`):
			fmt.Println(`{"id":2,"result":{"configOptions":[{"id":"model","currentValue":"model-a","options":[{"value":"model-a","name":"Model A"}]}]}}`)
		default:
			os.Exit(8)
		}
	}
}
