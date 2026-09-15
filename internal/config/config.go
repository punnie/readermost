// Package config loads readermost.toml and resolves the secrets it references.
//
// Secrets are never written literally into the config file in production: the
// NixOS module renders the TOML into the world-readable Nix store, so secret
// fields use "env:NAME" or "file:/path" indirection and are resolved at startup.
package config

import (
	"fmt"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/BurntSushi/toml"
)

// Config is the full application configuration.
type Config struct {
	ListenAddr    string     `toml:"listen_addr"`
	PublicURL     string     `toml:"public_url"`
	DatabasePath  string     `toml:"database_path"`
	EncryptionKey Secret     `toml:"encryption_key"`
	SessionTTL    Duration   `toml:"session_ttl"`
	Mattermost    Mattermost `toml:"mattermost"`
	Miniflux      Miniflux   `toml:"miniflux"`
}

// Mattermost identifies the upstream that provides both identity and the
// shared-links channel.
type Mattermost struct {
	URL               string `toml:"url"`
	OAuthClientID     string `toml:"oauth_client_id"`
	OAuthClientSecret Secret `toml:"oauth_client_secret"`
	SharedChannelID   string `toml:"shared_channel_id"`
}

// Miniflux identifies the feed engine and the admin credential used solely to
// provision per-user accounts.
type Miniflux struct {
	URL           string `toml:"url"`
	AdminUsername string `toml:"admin_username"`
	AdminPassword Secret `toml:"admin_password"`
}

// Secret is a configuration value that must not be logged.
//
// It resolves three forms at load time:
//
//	env:NAME     read from the environment
//	file:/path   read from a file, trimmed (works with systemd LoadCredential,
//	             e.g. "file:$CREDENTIALS_DIRECTORY/encryption_key")
//	anything     used literally (development only)
type Secret string

// UnmarshalText implements encoding.TextUnmarshaler for the forms above.
func (s *Secret) UnmarshalText(text []byte) error {
	raw := strings.TrimSpace(string(text))

	switch {
	case strings.HasPrefix(raw, "env:"):
		name := strings.TrimPrefix(raw, "env:")
		value, ok := os.LookupEnv(name)
		if !ok {
			return fmt.Errorf("environment variable %q is not set", name)
		}
		*s = Secret(value)

	case strings.HasPrefix(raw, "file:"):
		path := os.ExpandEnv(strings.TrimPrefix(raw, "file:"))
		contents, err := os.ReadFile(path)
		if err != nil {
			return fmt.Errorf("reading secret file: %w", err)
		}
		*s = Secret(strings.TrimSpace(string(contents)))

	default:
		*s = Secret(raw)
	}
	return nil
}

// String redacts the value so a stray %v or %s in a log line cannot leak it.
// Use Value to get the real thing.
func (s Secret) String() string {
	if s == "" {
		return "«unset»"
	}
	return "«redacted»"
}

// Value returns the resolved secret.
func (s Secret) Value() string { return string(s) }

// Duration wraps time.Duration so TOML can carry "720h".
type Duration time.Duration

// UnmarshalText implements encoding.TextUnmarshaler.
func (d *Duration) UnmarshalText(text []byte) error {
	parsed, err := time.ParseDuration(string(text))
	if err != nil {
		return fmt.Errorf("invalid duration %q: %w", text, err)
	}
	*d = Duration(parsed)
	return nil
}

// Std returns the standard library duration.
func (d Duration) Std() time.Duration { return time.Duration(d) }

// Load reads, defaults, and validates the configuration at path.
func Load(path string) (*Config, error) {
	cfg := &Config{
		ListenAddr:   ":8080",
		DatabasePath: "readermost.db",
		SessionTTL:   Duration(30 * 24 * time.Hour),
	}

	meta, err := toml.DecodeFile(path, cfg)
	if err != nil {
		return nil, fmt.Errorf("config: %w", err)
	}
	if undecoded := meta.Undecoded(); len(undecoded) > 0 {
		// Typos in a config file are a common and very confusing failure; refuse
		// rather than silently ignoring a key the user believes is in effect.
		keys := make([]string, 0, len(undecoded))
		for _, key := range undecoded {
			keys = append(keys, key.String())
		}
		return nil, fmt.Errorf("config: unknown keys: %s", strings.Join(keys, ", "))
	}

	if err := cfg.validate(); err != nil {
		return nil, fmt.Errorf("config: %w", err)
	}
	return cfg, nil
}

func (c *Config) validate() error {
	required := []struct {
		name  string
		value string
	}{
		{"public_url", c.PublicURL},
		{"encryption_key", c.EncryptionKey.Value()},
		{"mattermost.url", c.Mattermost.URL},
		{"mattermost.oauth_client_id", c.Mattermost.OAuthClientID},
		{"mattermost.oauth_client_secret", c.Mattermost.OAuthClientSecret.Value()},
		{"mattermost.shared_channel_id", c.Mattermost.SharedChannelID},
		{"miniflux.url", c.Miniflux.URL},
		{"miniflux.admin_username", c.Miniflux.AdminUsername},
		{"miniflux.admin_password", c.Miniflux.AdminPassword.Value()},
	}
	for _, field := range required {
		if strings.TrimSpace(field.value) == "" {
			return fmt.Errorf("%s is required", field.name)
		}
	}

	for _, field := range []struct {
		name  string
		value string
	}{
		{"public_url", c.PublicURL},
		{"mattermost.url", c.Mattermost.URL},
		{"miniflux.url", c.Miniflux.URL},
	} {
		parsed, err := url.Parse(field.value)
		if err != nil {
			return fmt.Errorf("%s is not a valid URL: %w", field.name, err)
		}
		if parsed.Scheme != "http" && parsed.Scheme != "https" {
			return fmt.Errorf("%s must be http or https, got %q", field.name, parsed.Scheme)
		}
		if parsed.Host == "" {
			return fmt.Errorf("%s must include a host", field.name)
		}
	}

	if c.SessionTTL.Std() <= 0 {
		return fmt.Errorf("session_ttl must be positive")
	}
	return nil
}

// CallbackURL is the OAuth redirect URI, derived from PublicURL so the two can
// never drift apart.
func (c *Config) CallbackURL() string {
	return strings.TrimRight(c.PublicURL, "/") + "/auth/callback"
}

// IsHTTPS reports whether the public URL is TLS-protected, which decides the
// Secure flag on session cookies.
func (c *Config) IsHTTPS() bool {
	return strings.HasPrefix(c.PublicURL, "https://")
}
