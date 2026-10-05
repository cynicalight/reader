package reader

import (
	"context"
	"testing"
)

func TestClaudeUserSettingsWithoutLogin(t *testing.T) {
	fakeAgent(t, "claude", "user-settings")
	if providerStatus(context.Background(), "claude").Authenticated {
		t.Fatal("fixture must report no subscription login")
	}
	store, err := OpenStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer store.DB.Close()
	answer, err := invokeCLI(t.Context(), store.Root, "claude", "", AIInput{Prompt: "hello"}, nil)
	if err != nil || answer != "你好，世界" {
		t.Fatalf("user-configured CLI should work without subscription login: %q %v", answer, err)
	}
}
