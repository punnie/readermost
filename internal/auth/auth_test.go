package auth

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/url"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"testing"

	"github.com/punnie/readermost/internal/config"
	"github.com/punnie/readermost/internal/crypto"
	"github.com/punnie/readermost/internal/mattermost"
	"github.com/punnie/readermost/internal/miniflux"
	"github.com/punnie/readermost/internal/store"
)

// fakeMiniflux stands in for a Miniflux server, recording what the provisioning
// code asks of it.
type fakeMiniflux struct {
	mu sync.Mutex

	// existingUsers simulates accounts already present, keyed by username.
	existingUsers map[string]int64

	createCalls  []string
	lookupCalls  []string
	passwordSets map[int64]string
	nextUserID   int64
}

func newFakeMiniflux() *fakeMiniflux {
	return &fakeMiniflux{
		existingUsers: map[string]int64{},
		passwordSets:  map[int64]string{},
		nextUserID:    100,
	}
}

func (f *fakeMiniflux) server(t *testing.T) *httptest.Server {
	t.Helper()

	mux := http.NewServeMux()

	mux.HandleFunc("GET /v1/me", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]any{
			"id": 1, "username": "admin", "is_admin": true,
		})
	})

	mux.HandleFunc("POST /v1/users", func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Username string `json:"username"`
			Password string `json:"password"`
		}
		_ = json.NewDecoder(r.Body).Decode(&body)

		f.mu.Lock()
		defer f.mu.Unlock()
		f.createCalls = append(f.createCalls, body.Username)

		if _, taken := f.existingUsers[body.Username]; taken {
			// Miniflux reports a duplicate username as 400, not 409.
			writeJSON(w, http.StatusBadRequest, map[string]string{
				"error_message": "This user already exists.",
			})
			return
		}

		f.nextUserID++
		id := f.nextUserID
		f.existingUsers[body.Username] = id
		f.passwordSets[id] = body.Password

		writeJSON(w, http.StatusCreated, map[string]any{
			"id": id, "username": body.Username, "is_admin": false,
		})
	})

	mux.HandleFunc("GET /v1/users/{username}", func(w http.ResponseWriter, r *http.Request) {
		username := r.PathValue("username")

		f.mu.Lock()
		defer f.mu.Unlock()
		f.lookupCalls = append(f.lookupCalls, username)

		id, ok := f.existingUsers[username]
		if !ok {
			writeJSON(w, http.StatusNotFound, map[string]string{"error_message": "not found"})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"id": id, "username": username, "is_admin": false,
		})
	})

	mux.HandleFunc("PUT /v1/users/{id}", func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Password string `json:"password"`
		}
		_ = json.NewDecoder(r.Body).Decode(&body)

		f.mu.Lock()
		defer f.mu.Unlock()
		for username, id := range f.existingUsers {
			if r.PathValue("id") == strconv.FormatInt(id, 10) {
				f.passwordSets[id] = body.Password
				writeJSON(w, http.StatusOK, map[string]any{
					"id": id, "username": username, "is_admin": false,
				})
				return
			}
		}
		writeJSON(w, http.StatusNotFound, map[string]string{"error_message": "not found"})
	})

	server := httptest.NewServer(mux)
	t.Cleanup(server.Close)
	return server
}

// fakeMattermost stands in for the OAuth provider.
func fakeMattermostServer(t *testing.T, userID, username string) *httptest.Server {
	t.Helper()

	mux := http.NewServeMux()

	mux.HandleFunc("POST /oauth/access_token", func(w http.ResponseWriter, r *http.Request) {
		_ = r.ParseForm()
		if r.Form.Get("code") == "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"message": "missing code"})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"access_token": "token-for-" + userID,
			"token_type":   "bearer",
			"expires_in":   0,
		})
	})

	mux.HandleFunc("GET /api/v4/users/me", func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasPrefix(r.Header.Get("Authorization"), "Bearer ") {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"message": "no token"})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"id": userID, "username": username,
		})
	})

	server := httptest.NewServer(mux)
	t.Cleanup(server.Close)
	return server
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

type harness struct {
	service  *Service
	store    *store.Store
	miniflux *fakeMiniflux
	mmUserID string
}

func newHarness(t *testing.T) *harness {
	t.Helper()

	fake := newFakeMiniflux()
	minifluxServer := fake.server(t)

	const mmUserID = "mmuser000000000000000000001"
	mmServer := fakeMattermostServer(t, mmUserID, "punnie")

	db, err := store.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("store.Open: %v", err)
	}
	t.Cleanup(func() { db.Close() })

	encoded, err := crypto.GenerateKey()
	if err != nil {
		t.Fatalf("GenerateKey: %v", err)
	}
	key, _ := crypto.ParseKey(encoded)
	sealer, err := crypto.NewSealer(key)
	if err != nil {
		t.Fatalf("NewSealer: %v", err)
	}

	cfg := &config.Config{
		PublicURL:  "http://reader.test",
		SessionTTL: config.Duration(1e9 * 3600),
		Mattermost: config.Mattermost{
			URL:             mmServer.URL,
			OAuthClientID:   "client",
			SharedChannelID: "channel",
		},
		Miniflux: config.Miniflux{URL: minifluxServer.URL},
	}

	mmClient := mattermost.New(mattermost.Config{
		BaseURL:     mmServer.URL,
		ClientID:    "client",
		RedirectURI: cfg.CallbackURL(),
	})
	adminClient := miniflux.New(minifluxServer.URL, "admin", "admin-password")

	logger := slog.New(slog.NewTextHandler(io.Discard, nil))

	return &harness{
		service:  New(cfg, db, sealer, mmClient, adminClient, logger),
		store:    db,
		miniflux: fake,
		mmUserID: mmUserID,
	}
}

// login drives a full OAuth round trip and returns the session cookie.
func (h *harness) login(t *testing.T) *http.Cookie {
	t.Helper()

	loginReq := httptest.NewRequest(http.MethodGet, "/auth/login", nil)
	loginRec := httptest.NewRecorder()
	h.service.Login(loginRec, loginReq)

	if loginRec.Code != http.StatusFound {
		t.Fatalf("Login status = %d, want %d", loginRec.Code, http.StatusFound)
	}

	redirect, err := url.Parse(loginRec.Header().Get("Location"))
	if err != nil {
		t.Fatalf("parse redirect: %v", err)
	}
	state := redirect.Query().Get("state")
	if state == "" {
		t.Fatal("Login redirect carried no state parameter")
	}
	if redirect.Query().Get("code_challenge") == "" {
		t.Error("Login redirect carried no PKCE challenge")
	}

	var stateCookieValue *http.Cookie
	for _, cookie := range loginRec.Result().Cookies() {
		if cookie.Name == stateCookie {
			stateCookieValue = cookie
		}
	}
	if stateCookieValue == nil {
		t.Fatal("Login set no state cookie")
	}

	callbackReq := httptest.NewRequest(http.MethodGet,
		"/auth/callback?code=auth-code&state="+url.QueryEscape(state), nil)
	callbackReq.AddCookie(stateCookieValue)
	callbackRec := httptest.NewRecorder()
	h.service.Callback(callbackRec, callbackReq)

	if callbackRec.Code != http.StatusFound {
		t.Fatalf("Callback status = %d, want %d (body: %s)",
			callbackRec.Code, http.StatusFound, callbackRec.Body.String())
	}

	for _, cookie := range callbackRec.Result().Cookies() {
		if cookie.Name == sessionCookie && cookie.Value != "" {
			return cookie
		}
	}
	t.Fatal("Callback set no session cookie")
	return nil
}

func TestFirstLoginProvisionsMinifluxAccount(t *testing.T) {
	h := newHarness(t)

	cookie := h.login(t)
	if cookie.Value == "" {
		t.Fatal("session cookie was empty")
	}
	if !cookie.HttpOnly {
		t.Error("session cookie is not HttpOnly")
	}
	if cookie.SameSite != http.SameSiteLaxMode {
		t.Error("session cookie is not SameSite=Lax")
	}

	user, err := h.store.UserByMattermostID(context.Background(), h.mmUserID)
	if err != nil {
		t.Fatalf("UserByMattermostID: %v", err)
	}

	wantUsername := "mm_" + h.mmUserID
	if user.MinifluxUsername != wantUsername {
		t.Errorf("miniflux username = %q, want %q", user.MinifluxUsername, wantUsername)
	}
	if user.MattermostUsername != "punnie" {
		t.Errorf("mattermost username = %q, want %q", user.MattermostUsername, "punnie")
	}
	if user.OnboardedAt != nil {
		t.Error("a freshly provisioned user should not be marked onboarded")
	}
	if len(user.MinifluxPasswordEnc) == 0 {
		t.Error("no sealed miniflux password was stored")
	}

	// The stored password must be encrypted, not plaintext.
	if strings.Contains(string(user.MinifluxPasswordEnc), "=") &&
		len(user.MinifluxPasswordEnc) < 32 {
		t.Error("stored miniflux password looks like plaintext")
	}

	if got := h.miniflux.createCalls; len(got) != 1 || got[0] != wantUsername {
		t.Errorf("miniflux create calls = %v, want exactly [%s]", got, wantUsername)
	}
}

func TestSecondLoginReusesExistingAccount(t *testing.T) {
	h := newHarness(t)

	h.login(t)
	h.login(t)

	if got := len(h.miniflux.createCalls); got != 1 {
		t.Errorf("miniflux CreateUser called %d times across two logins, want 1", got)
	}
}

func TestLoginAdoptsOrphanedMinifluxAccount(t *testing.T) {
	h := newHarness(t)

	// Simulate the app database having been wiped while Miniflux kept the
	// account: the username is taken and its password is unknown to us.
	username := "mm_" + h.mmUserID
	h.miniflux.existingUsers[username] = 42
	h.miniflux.passwordSets[42] = "a-password-readermost-does-not-know"

	h.login(t)

	if len(h.miniflux.lookupCalls) != 1 || h.miniflux.lookupCalls[0] != username {
		t.Errorf("lookup calls = %v, want exactly [%s]", h.miniflux.lookupCalls, username)
	}

	if h.miniflux.passwordSets[42] == "a-password-readermost-does-not-know" {
		t.Error("the orphaned account's password was not reset")
	}

	user, err := h.store.UserByMattermostID(context.Background(), h.mmUserID)
	if err != nil {
		t.Fatalf("UserByMattermostID: %v", err)
	}
	if user.MinifluxUserID != 42 {
		t.Errorf("adopted miniflux user id = %d, want 42", user.MinifluxUserID)
	}
}

func TestCallbackRejectsMismatchedState(t *testing.T) {
	h := newHarness(t)

	loginRec := httptest.NewRecorder()
	h.service.Login(loginRec, httptest.NewRequest(http.MethodGet, "/auth/login", nil))

	var state *http.Cookie
	for _, cookie := range loginRec.Result().Cookies() {
		if cookie.Name == stateCookie {
			state = cookie
		}
	}

	req := httptest.NewRequest(http.MethodGet, "/auth/callback?code=x&state=forged", nil)
	req.AddCookie(state)
	rec := httptest.NewRecorder()
	h.service.Callback(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want %d for a forged state", rec.Code, http.StatusBadRequest)
	}
	if _, err := h.store.UserByMattermostID(context.Background(), h.mmUserID); err == nil {
		t.Error("a rejected callback still provisioned a user")
	}
}

func TestCallbackRejectsMissingStateCookie(t *testing.T) {
	h := newHarness(t)

	req := httptest.NewRequest(http.MethodGet, "/auth/callback?code=x&state=whatever", nil)
	rec := httptest.NewRecorder()
	h.service.Callback(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want %d without a state cookie", rec.Code, http.StatusBadRequest)
	}
}

func TestMiddlewareResolvesSession(t *testing.T) {
	h := newHarness(t)
	cookie := h.login(t)

	var seen *Identity
	handler := h.service.Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		identity, _ := FromContext(r.Context())
		seen = identity
	}))

	req := httptest.NewRequest(http.MethodGet, "/api/me", nil)
	req.AddCookie(cookie)
	handler.ServeHTTP(httptest.NewRecorder(), req)

	if seen == nil {
		t.Fatal("Middleware did not attach an identity")
	}
	if seen.MattermostToken != "token-for-"+h.mmUserID {
		t.Errorf("mattermost token = %q, want the one issued by the fake server", seen.MattermostToken)
	}
	if seen.MinifluxPassword == "" {
		t.Error("miniflux password was not decrypted onto the identity")
	}
}

func TestRequireAuthRejectsAnonymous(t *testing.T) {
	h := newHarness(t)

	rec := httptest.NewRecorder()
	h.service.RequireAuth(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Error("handler ran for an anonymous request")
	})).ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/me", nil))

	if rec.Code != http.StatusUnauthorized {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusUnauthorized)
	}
}
