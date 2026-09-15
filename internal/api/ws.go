package api

import (
	"net/http"
	"time"

	"github.com/gorilla/websocket"

	"github.com/punnie/readermost/internal/auth"
)

const (
	writeWait  = 10 * time.Second
	pongWait   = 60 * time.Second
	pingPeriod = 50 * time.Second
)

// handleWS upgrades a browser connection and streams shared-channel events.
func (s *Server) handleWS(w http.ResponseWriter, r *http.Request, identity *auth.Identity) error {
	if s.hub == nil {
		return errBadRequest("real-time updates are not enabled")
	}

	upgrader := websocket.Upgrader{
		HandshakeTimeout: 10 * time.Second,
		// Same-origin only: the session cookie travels with the handshake, and
		// browsers do not apply CORS to WebSockets.
		CheckOrigin: func(req *http.Request) bool {
			origin := req.Header.Get("Origin")
			if origin == "" {
				return true // non-browser client
			}
			return origin == s.cfg.PublicURL
		},
	}

	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		// Upgrade already wrote a response.
		s.log.Warn("websocket upgrade failed", "error", err)
		return nil
	}
	defer conn.Close()

	client := s.hub.Subscribe(identity.User.ID, identity.MattermostToken)
	defer client.Close()

	// Reader goroutine: we expect nothing from the browser, but reading is what
	// surfaces a closed connection and keeps pong deadlines honest.
	done := make(chan struct{})
	go func() {
		defer close(done)
		conn.SetReadLimit(512)
		_ = conn.SetReadDeadline(time.Now().Add(pongWait))
		conn.SetPongHandler(func(string) error {
			return conn.SetReadDeadline(time.Now().Add(pongWait))
		})
		for {
			if _, _, err := conn.ReadMessage(); err != nil {
				return
			}
		}
	}()

	ticker := time.NewTicker(pingPeriod)
	defer ticker.Stop()

	for {
		select {
		case <-done:
			return nil

		case event, ok := <-client.Events():
			if !ok {
				return nil
			}
			_ = conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := conn.WriteJSON(event); err != nil {
				return nil
			}

		case <-ticker.C:
			_ = conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return nil
			}

		case <-r.Context().Done():
			return nil
		}
	}
}
