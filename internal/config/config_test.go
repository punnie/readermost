package config

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// writeConfig writes a config file and returns its path.
func writeConfig(t *testing.T, body string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "readermost.toml")
	if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
		t.Fatalf("write config: %v", err)
	}
	return path
}

const validBody = `
public_url     = "https://reader.example.org"
encryption_key = "%s"

[mattermost]
url                 = "https://mm.example.org"
oauth_client_id     = "client-id"
oauth_client_secret = "client-secret"
shared_channel_id   = "channel-id"

[miniflux]
url            = "https://miniflux.internal"
admin_username = "admin"
admin_password = "admin-password"
`

func TestLoadValidConfig(t *testing.T) {
	cfg, err := Load(writeConfig(t, fmt.Sprintf(validBody, "a-key")))
	if err != nil {
		t.Fatalf("Load: %v", err)
	}

	if cfg.ListenAddr != ":8080" {
		t.Errorf("listen_addr = %q, want the default :8080", cfg.ListenAddr)
	}
	if cfg.DatabasePath != "readermost.db" {
		t.Errorf("database_path = %q, want the default", cfg.DatabasePath)
	}
	if cfg.SessionTTL.Std().Hours() != 720 {
		t.Errorf("session_ttl = %v, want the 720h default", cfg.SessionTTL.Std())
	}
	if want := "https://reader.example.org/auth/callback"; cfg.CallbackURL() != want {
		t.Errorf("CallbackURL() = %q, want %q", cfg.CallbackURL(), want)
	}
	if !cfg.IsHTTPS() {
		t.Error("IsHTTPS() = false for an https public_url")
	}
}

func TestCallbackURLIgnoresTrailingSlash(t *testing.T) {
	cfg := &Config{PublicURL: "https://reader.example.org/"}
	if want := "https://reader.example.org/auth/callback"; cfg.CallbackURL() != want {
		t.Errorf("CallbackURL() = %q, want %q", cfg.CallbackURL(), want)
	}
}

func TestSecretRedactsItself(t *testing.T) {
	secret := Secret("super-secret-password")

	// A stray %v or %s in a log line must not spill the value.
	for _, rendered := range []string{
		fmt.Sprintf("%v", secret),
		fmt.Sprintf("%s", secret),
		fmt.Sprint(secret),
	} {
		if strings.Contains(rendered, "super-secret-password") {
			t.Errorf("formatted secret leaked the value: %q", rendered)
		}
	}

	if secret.Value() != "super-secret-password" {
		t.Error("Value() did not return the real secret")
	}
	if Secret("").String() == Secret("x").String() {
		t.Error("an unset secret should be distinguishable from a set one")
	}
}

func TestSecretFromEnv(t *testing.T) {
	t.Setenv("READERMOST_TEST_SECRET", "from-the-environment")

	cfg, err := Load(writeConfig(t, fmt.Sprintf(validBody, "env:READERMOST_TEST_SECRET")))
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if cfg.EncryptionKey.Value() != "from-the-environment" {
		t.Errorf("encryption_key = %q, want the environment value", cfg.EncryptionKey.Value())
	}
}

func TestSecretFromEnvFailsWhenUnset(t *testing.T) {
	_, err := Load(writeConfig(t, fmt.Sprintf(validBody, "env:READERMOST_DEFINITELY_UNSET")))
	if err == nil {
		t.Fatal("Load succeeded with an unset environment variable")
	}
	if !strings.Contains(err.Error(), "READERMOST_DEFINITELY_UNSET") {
		t.Errorf("error %q does not name the missing variable", err)
	}
}

func TestSecretFromFile(t *testing.T) {
	// systemd LoadCredential hands secrets over as files, with a trailing
	// newline more often than not.
	path := filepath.Join(t.TempDir(), "key")
	if err := os.WriteFile(path, []byte("from-a-file\n"), 0o600); err != nil {
		t.Fatalf("write secret: %v", err)
	}

	cfg, err := Load(writeConfig(t, fmt.Sprintf(validBody, "file:"+path)))
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if cfg.EncryptionKey.Value() != "from-a-file" {
		t.Errorf("encryption_key = %q, want the trimmed file contents", cfg.EncryptionKey.Value())
	}
}

func TestSecretFromFileExpandsEnv(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "encryption_key"), []byte("credential"), 0o600); err != nil {
		t.Fatalf("write secret: %v", err)
	}
	t.Setenv("CREDENTIALS_DIRECTORY", dir)

	cfg, err := Load(writeConfig(t, fmt.Sprintf(validBody, "file:$CREDENTIALS_DIRECTORY/encryption_key")))
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if cfg.EncryptionKey.Value() != "credential" {
		t.Errorf("encryption_key = %q, want the credential file contents", cfg.EncryptionKey.Value())
	}
}

func TestLoadRejectsUnknownKeys(t *testing.T) {
	body := fmt.Sprintf(validBody, "a-key") + "\nlisten_add = \":9090\"\n"

	_, err := Load(writeConfig(t, body))
	if err == nil {
		t.Fatal("Load accepted an unknown key; a typo would be silently ignored")
	}
	if !strings.Contains(err.Error(), "listen_add") {
		t.Errorf("error %q does not name the offending key", err)
	}
}

func TestLoadRejectsMissingRequiredFields(t *testing.T) {
	tests := map[string]string{
		"public_url":                     `public_url     = "https://reader.example.org"`,
		"mattermost.shared_channel_id":   `shared_channel_id   = "channel-id"`,
		"miniflux.admin_username":        `admin_username = "admin"`,
		"mattermost.oauth_client_secret": `oauth_client_secret = "client-secret"`,
	}

	for field, line := range tests {
		body := strings.Replace(fmt.Sprintf(validBody, "a-key"), line, "", 1)

		_, err := Load(writeConfig(t, body))
		if err == nil {
			t.Errorf("Load succeeded without %s", field)
			continue
		}
		if !strings.Contains(err.Error(), field) {
			t.Errorf("error for missing %s was %q, which does not name the field", field, err)
		}
	}
}

func TestLoadRejectsBadURLs(t *testing.T) {
	for _, bad := range []string{"ftp://mm.example.org", "mm.example.org", "https://"} {
		body := strings.Replace(
			fmt.Sprintf(validBody, "a-key"),
			`url                 = "https://mm.example.org"`,
			fmt.Sprintf(`url                 = %q`, bad),
			1,
		)
		if _, err := Load(writeConfig(t, body)); err == nil {
			t.Errorf("Load accepted mattermost.url = %q", bad)
		}
	}
}

func TestDurationParsing(t *testing.T) {
	var d Duration
	if err := d.UnmarshalText([]byte("720h")); err != nil {
		t.Fatalf("UnmarshalText: %v", err)
	}
	if d.Std().Hours() != 720 {
		t.Errorf("parsed %v, want 720h", d.Std())
	}
	if err := d.UnmarshalText([]byte("not a duration")); err == nil {
		t.Error("UnmarshalText accepted nonsense")
	}
}
