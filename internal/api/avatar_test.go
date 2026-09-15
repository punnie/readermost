package api

import "testing"

func TestValidMattermostID(t *testing.T) {
	valid := []string{
		"kzx9zkz9kibn9mgqd511rnfhyo",
		"abcdefghijklmnopqrstuvwxyz",
		"00000000000000000000000000",
	}
	for _, id := range valid {
		if !validMattermostID(id) {
			t.Errorf("validMattermostID(%q) = false, want true", id)
		}
	}

	invalid := map[string]string{
		"too short":       "abc",
		"too long":        "kzx9zkz9kibn9mgqd511rnfhyoo",
		"uppercase":       "KZX9ZKZ9KIBN9MGQD511RNFHYO",
		"path traversal":  "../../../../etc/passwd00000",
		"slash":           "kzx9zkz9kibn9mgqd511rnfhy/",
		"url encoded":     "kzx9zkz9kibn9mgqd511rnfh%2",
		"empty":           "",
		"query injection": "kzx9zkz9kibn9mgqd511rnfh?x",
	}
	for name, id := range invalid {
		if validMattermostID(id) {
			t.Errorf("validMattermostID rejected nothing for %s (%q)", name, id)
		}
	}
}
