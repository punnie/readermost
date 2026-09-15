// Package hub relays Mattermost WebSocket events to connected browsers.
//
// One upstream connection is held per *user*, not per browser tab, and is
// authenticated with that user's own OAuth token — so Mattermost decides what
// they may see, and closing the last tab releases the connection.
package hub

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

// Event is what a browser receives.
type Event struct {
	Type   string `json:"type"`
	PostID string `json:"post_id,omitempty"`
	RootID string `json:"root_id,omitempty"`
}

// Event types.
const (
	EventPosted  = "posted"
	EventEdited  = "post_edited"
	EventDeleted = "post_deleted"
)

// Hub fans Mattermost events out to browser clients.
type Hub struct {
	mattermostURL string
	channelID     string
	log           *slog.Logger

	mu    sync.Mutex
	users map[int64]*userStream
}

// New builds a Hub for one Mattermost server and shared channel.
func New(mattermostURL, channelID string, log *slog.Logger) *Hub {
	return &Hub{
		mattermostURL: mattermostURL,
		channelID:     channelID,
		log:           log,
		users:         make(map[int64]*userStream),
	}
}

// userStream is the single upstream connection shared by one user's tabs.
type userStream struct {
	cancel  context.CancelFunc
	clients map[*Client]struct{}
}

// Client is one browser connection.
type Client struct {
	hub    *Hub
	userID int64
	send   chan Event
	once   sync.Once
}

// Events is the stream a caller pumps to the browser.
func (c *Client) Events() <-chan Event { return c.send }

// Close detaches the client, tearing down the upstream connection if it was the
// last one for that user.
func (c *Client) Close() {
	c.once.Do(func() { c.hub.remove(c) })
}

// Subscribe attaches a browser client for a user, starting the upstream
// connection if this is their first tab.
func (h *Hub) Subscribe(userID int64, token string) *Client {
	client := &Client{
		hub:    h,
		userID: userID,
		// Buffered: a slow browser must not stall the upstream reader.
		send: make(chan Event, 32),
	}

	h.mu.Lock()
	defer h.mu.Unlock()

	stream, ok := h.users[userID]
	if !ok {
		ctx, cancel := context.WithCancel(context.Background())
		stream = &userStream{cancel: cancel, clients: map[*Client]struct{}{}}
		h.users[userID] = stream

		go h.run(ctx, userID, token)
	}
	stream.clients[client] = struct{}{}

	return client
}

func (h *Hub) remove(client *Client) {
	h.mu.Lock()
	defer h.mu.Unlock()

	stream, ok := h.users[client.userID]
	if !ok {
		return
	}
	delete(stream.clients, client)
	close(client.send)

	if len(stream.clients) == 0 {
		stream.cancel()
		delete(h.users, client.userID)
	}
}

// broadcast delivers an event to every tab of one user.
func (h *Hub) broadcast(userID int64, event Event) {
	h.mu.Lock()
	defer h.mu.Unlock()

	stream, ok := h.users[userID]
	if !ok {
		return
	}
	for client := range stream.clients {
		select {
		case client.send <- event:
		default:
			// The browser is not keeping up. Dropping an event is fine: the
			// frontend refetches on reconnect and on window focus.
			h.log.Warn("dropped websocket event for slow client", "user_id", userID)
		}
	}
}

// run keeps an upstream connection alive until the context is cancelled.
func (h *Hub) run(ctx context.Context, userID int64, token string) {
	backoff := time.Second

	for ctx.Err() == nil {
		err := h.connect(ctx, userID, token)

		if ctx.Err() != nil {
			return
		}
		if err != nil {
			h.log.Warn("mattermost websocket closed", "user_id", userID, "error", err)
		}

		select {
		case <-ctx.Done():
			return
		case <-time.After(backoff):
		}

		// Exponential backoff, capped so a long outage still reconnects promptly
		// once the server returns.
		if backoff < 30*time.Second {
			backoff *= 2
		}
	}
}

// connect dials Mattermost, authenticates, and reads until the socket dies.
func (h *Hub) connect(ctx context.Context, userID int64, token string) error {
	endpoint, err := websocketURL(h.mattermostURL)
	if err != nil {
		return err
	}

	dialer := websocket.Dialer{HandshakeTimeout: 15 * time.Second}
	conn, _, err := dialer.DialContext(ctx, endpoint, http.Header{})
	if err != nil {
		return fmt.Errorf("dial: %w", err)
	}
	defer conn.Close()

	// Mattermost authenticates over the socket itself rather than a header.
	challenge := map[string]any{
		"seq":    1,
		"action": "authentication_challenge",
		"data":   map[string]string{"token": token},
	}
	if err := conn.WriteJSON(challenge); err != nil {
		return fmt.Errorf("authentication challenge: %w", err)
	}

	// Close the socket when the user's last tab goes away.
	go func() {
		<-ctx.Done()
		_ = conn.Close()
	}()

	h.log.Info("mattermost websocket connected", "user_id", userID)

	conn.SetReadLimit(1 << 20)
	if err := conn.SetReadDeadline(time.Now().Add(90 * time.Second)); err != nil {
		return err
	}
	conn.SetPongHandler(func(string) error {
		return conn.SetReadDeadline(time.Now().Add(90 * time.Second))
	})

	go h.keepalive(ctx, conn)

	for {
		var frame struct {
			Event string          `json:"event"`
			Data  json.RawMessage `json:"data"`
		}
		if err := conn.ReadJSON(&frame); err != nil {
			return err
		}
		// Any traffic means the connection is alive.
		_ = conn.SetReadDeadline(time.Now().Add(90 * time.Second))

		event, ok := h.translate(frame.Event, frame.Data)
		h.log.Debug("mattermost frame", "event", frame.Event, "relayed", ok)
		if ok {
			h.broadcast(userID, event)
		}
	}
}

// keepalive pings so idle connections are not dropped by intermediaries.
func (h *Hub) keepalive(ctx context.Context, conn *websocket.Conn) {
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if err := conn.WriteControl(websocket.PingMessage, nil, time.Now().Add(10*time.Second)); err != nil {
				return
			}
		}
	}
}

// translate converts a Mattermost frame into a browser event, keeping only
// posts in the shared channel.
func (h *Hub) translate(name string, data json.RawMessage) (Event, bool) {
	switch name {
	case EventPosted, EventEdited:
		var payload struct {
			// Mattermost nests the post as a JSON-encoded *string*.
			Post      string `json:"post"`
			ChannelID string `json:"channel_id"`
		}
		if err := json.Unmarshal(data, &payload); err != nil {
			return Event{}, false
		}

		var post struct {
			ID        string `json:"id"`
			RootID    string `json:"root_id"`
			ChannelID string `json:"channel_id"`
		}
		if err := json.Unmarshal([]byte(payload.Post), &post); err != nil {
			return Event{}, false
		}
		if post.ChannelID != h.channelID {
			return Event{}, false
		}

		return Event{Type: name, PostID: post.ID, RootID: post.RootID}, true

	case EventDeleted:
		var payload struct {
			Post string `json:"post"`
		}
		if err := json.Unmarshal(data, &payload); err != nil {
			return Event{}, false
		}
		var post struct {
			ID        string `json:"id"`
			RootID    string `json:"root_id"`
			ChannelID string `json:"channel_id"`
		}
		if err := json.Unmarshal([]byte(payload.Post), &post); err != nil {
			return Event{}, false
		}
		if post.ChannelID != h.channelID {
			return Event{}, false
		}
		return Event{Type: name, PostID: post.ID, RootID: post.RootID}, true

	default:
		return Event{}, false
	}
}

// websocketURL converts an http(s) base URL into the Mattermost socket endpoint.
func websocketURL(base string) (string, error) {
	parsed, err := url.Parse(strings.TrimRight(base, "/"))
	if err != nil {
		return "", fmt.Errorf("parse mattermost url: %w", err)
	}
	switch parsed.Scheme {
	case "https":
		parsed.Scheme = "wss"
	case "http":
		parsed.Scheme = "ws"
	default:
		return "", fmt.Errorf("unsupported mattermost scheme %q", parsed.Scheme)
	}
	parsed.Path = strings.TrimRight(parsed.Path, "/") + "/api/v4/websocket"
	return parsed.String(), nil
}
