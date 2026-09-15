// Package crypto seals the secrets Readermost must keep at rest: each user's
// generated Miniflux password and their Mattermost access token.
//
// Both are needed in plaintext on every request, so this is authenticated
// encryption with a key from config — not password hashing. Losing the key means
// losing every stored credential, which is recoverable (see store.User) but not
// free: Miniflux passwords can be reset by the admin, Mattermost tokens cannot,
// so users would simply log in again.
package crypto

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
)

// KeySize is the required length of the raw encryption key, in bytes.
const KeySize = 32

// ErrShortCiphertext is returned when a stored blob is too small to contain a nonce.
var ErrShortCiphertext = errors.New("crypto: ciphertext too short")

// Sealer encrypts and decrypts small secrets with AES-256-GCM.
type Sealer struct {
	aead cipher.AEAD
}

// NewSealer builds a Sealer from a raw 32-byte key.
func NewSealer(key []byte) (*Sealer, error) {
	if len(key) != KeySize {
		return nil, fmt.Errorf("crypto: key must be %d bytes, got %d", KeySize, len(key))
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, fmt.Errorf("crypto: new cipher: %w", err)
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("crypto: new GCM: %w", err)
	}
	return &Sealer{aead: aead}, nil
}

// Seal encrypts plaintext, returning nonce||ciphertext.
func (s *Sealer) Seal(plaintext []byte) ([]byte, error) {
	nonce := make([]byte, s.aead.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return nil, fmt.Errorf("crypto: read nonce: %w", err)
	}
	// Seal appends to its first argument, so the nonce is prefixed for free.
	return s.aead.Seal(nonce, nonce, plaintext, nil), nil
}

// SealString is Seal for the common case of a textual secret.
func (s *Sealer) SealString(plaintext string) ([]byte, error) {
	return s.Seal([]byte(plaintext))
}

// Open reverses Seal.
func (s *Sealer) Open(blob []byte) ([]byte, error) {
	n := s.aead.NonceSize()
	if len(blob) < n {
		return nil, ErrShortCiphertext
	}
	plaintext, err := s.aead.Open(nil, blob[:n], blob[n:], nil)
	if err != nil {
		// Deliberately opaque: a decryption failure usually means the key
		// changed, and echoing GCM's error adds nothing.
		return nil, errors.New("crypto: decryption failed")
	}
	return plaintext, nil
}

// OpenString is Open for a textual secret.
func (s *Sealer) OpenString(blob []byte) (string, error) {
	plaintext, err := s.Open(blob)
	if err != nil {
		return "", err
	}
	return string(plaintext), nil
}

// ParseKey decodes a base64 key as it appears in configuration.
func ParseKey(encoded string) ([]byte, error) {
	key, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		return nil, fmt.Errorf("crypto: key is not valid base64: %w", err)
	}
	if len(key) != KeySize {
		return nil, fmt.Errorf("crypto: key must decode to %d bytes, got %d", KeySize, len(key))
	}
	return key, nil
}

// GenerateKey produces a fresh base64-encoded key, for `readermost genkey`.
func GenerateKey() (string, error) {
	key := make([]byte, KeySize)
	if _, err := io.ReadFull(rand.Reader, key); err != nil {
		return "", fmt.Errorf("crypto: generate key: %w", err)
	}
	return base64.StdEncoding.EncodeToString(key), nil
}

// RandomPassword returns the password assigned to a freshly provisioned Miniflux
// user. It is never shown to anyone: the app is the only thing that uses it.
func RandomPassword() (string, error) {
	buf := make([]byte, 32)
	if _, err := io.ReadFull(rand.Reader, buf); err != nil {
		return "", fmt.Errorf("crypto: generate password: %w", err)
	}
	return base64.RawURLEncoding.EncodeToString(buf), nil
}

// RandomID returns a hex token suitable for session identifiers and OAuth state.
func RandomID() (string, error) {
	buf := make([]byte, 32)
	if _, err := io.ReadFull(rand.Reader, buf); err != nil {
		return "", fmt.Errorf("crypto: generate id: %w", err)
	}
	return hex.EncodeToString(buf), nil
}
