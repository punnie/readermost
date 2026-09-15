package hub

import (
	"encoding/json"
	"io"
	"log/slog"
	"testing"
)

func testHub() *Hub {
	return New("https://mm.example.org", "shared-channel", slog.New(slog.NewTextHandler(io.Discard, nil)))
}

func TestWebsocketURL(t *testing.T) {
	tests := []struct {
		base string
		want string
	}{
		{"https://mm.example.org", "wss://mm.example.org/api/v4/websocket"},
		{"https://mm.example.org/", "wss://mm.example.org/api/v4/websocket"},
		{"http://localhost:8065", "ws://localhost:8065/api/v4/websocket"},
		{"https://example.org/mattermost", "wss://example.org/mattermost/api/v4/websocket"},
	}

	for _, test := range tests {
		got, err := websocketURL(test.base)
		if err != nil {
			t.Errorf("websocketURL(%q): %v", test.base, err)
			continue
		}
		if got != test.want {
			t.Errorf("websocketURL(%q) = %q, want %q", test.base, got, test.want)
		}
	}
}

func TestWebsocketURLRejectsUnknownScheme(t *testing.T) {
	if _, err := websocketURL("ftp://mm.example.org"); err == nil {
		t.Fatal("websocketURL accepted a non-http scheme")
	}
}

// frame builds a Mattermost event payload, in which the post is nested as a
// JSON-encoded string rather than an object.
func frame(t *testing.T, channelID, postID, rootID string) json.RawMessage {
	t.Helper()

	post, err := json.Marshal(map[string]string{
		"id": postID, "root_id": rootID, "channel_id": channelID,
	})
	if err != nil {
		t.Fatalf("marshal post: %v", err)
	}
	data, err := json.Marshal(map[string]string{
		"post": string(post), "channel_id": channelID,
	})
	if err != nil {
		t.Fatalf("marshal data: %v", err)
	}
	return data
}

func TestTranslateAcceptsSharedChannelPost(t *testing.T) {
	h := testHub()

	event, ok := h.translate(EventPosted, frame(t, "shared-channel", "post1", ""))
	if !ok {
		t.Fatal("translate rejected a post in the shared channel")
	}
	if event.Type != EventPosted || event.PostID != "post1" {
		t.Errorf("event = %+v, want posted/post1", event)
	}
	if event.RootID != "" {
		t.Errorf("root id = %q, want empty for a root post", event.RootID)
	}
}

func TestTranslateCarriesRootIDForReplies(t *testing.T) {
	h := testHub()

	event, ok := h.translate(EventPosted, frame(t, "shared-channel", "reply1", "post1"))
	if !ok {
		t.Fatal("translate rejected a reply")
	}
	if event.RootID != "post1" {
		t.Errorf("root id = %q, want post1 — the thread query depends on it", event.RootID)
	}
}

func TestTranslateIgnoresOtherChannels(t *testing.T) {
	h := testHub()

	// A user is in many channels; only the configured one is this app's concern.
	if _, ok := h.translate(EventPosted, frame(t, "some-other-channel", "post1", "")); ok {
		t.Fatal("translate accepted a post from an unrelated channel")
	}
}

func TestTranslateIgnoresUninterestingEvents(t *testing.T) {
	h := testHub()

	for _, name := range []string{"typing", "status_change", "channel_viewed"} {
		if _, ok := h.translate(name, frame(t, "shared-channel", "post1", "")); ok {
			t.Errorf("translate accepted event %q", name)
		}
	}
}

func TestTranslateHandlesMalformedPayloads(t *testing.T) {
	h := testHub()

	for _, payload := range []string{`{}`, `{"post":"not json"}`, `not json at all`} {
		if _, ok := h.translate(EventPosted, json.RawMessage(payload)); ok {
			t.Errorf("translate accepted malformed payload %q", payload)
		}
	}
}

func TestSubscribeRefCountsPerUser(t *testing.T) {
	h := testHub()

	first := h.Subscribe(1, "token")
	second := h.Subscribe(1, "token")

	h.mu.Lock()
	streams := len(h.users)
	clients := len(h.users[1].clients)
	h.mu.Unlock()

	if streams != 1 {
		t.Errorf("upstream streams = %d, want 1 shared across both tabs", streams)
	}
	if clients != 2 {
		t.Errorf("clients = %d, want 2", clients)
	}

	// Closing one tab must not tear down the other's stream.
	first.Close()

	h.mu.Lock()
	streams = len(h.users)
	h.mu.Unlock()
	if streams != 1 {
		t.Errorf("stream torn down while a tab remained open (streams = %d)", streams)
	}

	second.Close()

	h.mu.Lock()
	streams = len(h.users)
	h.mu.Unlock()
	if streams != 0 {
		t.Errorf("stream survived the last tab closing (streams = %d)", streams)
	}
}

func TestBroadcastReachesEveryTab(t *testing.T) {
	h := testHub()

	first := h.Subscribe(7, "token")
	second := h.Subscribe(7, "token")
	defer first.Close()
	defer second.Close()

	h.broadcast(7, Event{Type: EventPosted, PostID: "abc"})

	for i, client := range []*Client{first, second} {
		select {
		case event := <-client.Events():
			if event.PostID != "abc" {
				t.Errorf("client %d got post %q, want abc", i, event.PostID)
			}
		default:
			t.Errorf("client %d received nothing", i)
		}
	}
}
