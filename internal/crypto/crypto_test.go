package crypto

import (
	"bytes"
	"testing"
)

func newTestSealer(t *testing.T) *Sealer {
	t.Helper()
	encoded, err := GenerateKey()
	if err != nil {
		t.Fatalf("GenerateKey: %v", err)
	}
	key, err := ParseKey(encoded)
	if err != nil {
		t.Fatalf("ParseKey: %v", err)
	}
	sealer, err := NewSealer(key)
	if err != nil {
		t.Fatalf("NewSealer: %v", err)
	}
	return sealer
}

func TestSealOpenRoundTrip(t *testing.T) {
	sealer := newTestSealer(t)

	for _, plaintext := range []string{"", "hunter2", "a much longer miniflux password with = padding"} {
		sealed, err := sealer.SealString(plaintext)
		if err != nil {
			t.Fatalf("SealString(%q): %v", plaintext, err)
		}
		got, err := sealer.OpenString(sealed)
		if err != nil {
			t.Fatalf("OpenString(%q): %v", plaintext, err)
		}
		if got != plaintext {
			t.Errorf("round trip = %q, want %q", got, plaintext)
		}
	}
}

func TestSealIsNondeterministic(t *testing.T) {
	sealer := newTestSealer(t)

	first, err := sealer.SealString("same input")
	if err != nil {
		t.Fatalf("SealString: %v", err)
	}
	second, err := sealer.SealString("same input")
	if err != nil {
		t.Fatalf("SealString: %v", err)
	}
	if bytes.Equal(first, second) {
		t.Error("sealing the same plaintext twice produced identical ciphertext; the nonce is not random")
	}
}

func TestOpenWithWrongKeyFails(t *testing.T) {
	sealed, err := newTestSealer(t).SealString("secret")
	if err != nil {
		t.Fatalf("SealString: %v", err)
	}
	if _, err := newTestSealer(t).Open(sealed); err == nil {
		t.Fatal("Open with a different key succeeded; it must not")
	}
}

func TestOpenRejectsTamperedCiphertext(t *testing.T) {
	sealer := newTestSealer(t)

	sealed, err := sealer.SealString("secret")
	if err != nil {
		t.Fatalf("SealString: %v", err)
	}
	sealed[len(sealed)-1] ^= 0xff

	if _, err := sealer.Open(sealed); err == nil {
		t.Fatal("Open accepted tampered ciphertext; GCM authentication is not working")
	}
}

func TestOpenRejectsShortInput(t *testing.T) {
	if _, err := newTestSealer(t).Open([]byte{1, 2, 3}); err == nil {
		t.Fatal("Open accepted a blob shorter than a nonce")
	}
}

func TestParseKeyRejectsWrongLength(t *testing.T) {
	// Valid base64, wrong number of bytes.
	if _, err := ParseKey("c2hvcnQ="); err == nil {
		t.Fatal("ParseKey accepted a short key")
	}
	if _, err := ParseKey("not base64!"); err == nil {
		t.Fatal("ParseKey accepted invalid base64")
	}
}

func TestRandomPasswordIsUnique(t *testing.T) {
	seen := make(map[string]bool, 100)
	for i := 0; i < 100; i++ {
		password, err := RandomPassword()
		if err != nil {
			t.Fatalf("RandomPassword: %v", err)
		}
		if seen[password] {
			t.Fatal("RandomPassword returned a duplicate")
		}
		seen[password] = true
	}
}
