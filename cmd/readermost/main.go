// Command readermost serves a Google Reader-style frontend over a Miniflux feed
// engine and a Mattermost channel.
package main

import (
	"bufio"
	"context"
	"errors"
	"flag"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/punnie/readermost/internal/api"
	"github.com/punnie/readermost/internal/auth"
	"github.com/punnie/readermost/internal/config"
	"github.com/punnie/readermost/internal/crypto"
	"github.com/punnie/readermost/internal/hub"
	"github.com/punnie/readermost/internal/mattermost"
	"github.com/punnie/readermost/internal/miniflux"
	"github.com/punnie/readermost/internal/store"
	"github.com/punnie/readermost/web"
)

// version is set at build time by the Nix derivation.
var version = "dev"

func main() {
	if err := run(); err != nil {
		fmt.Fprintf(os.Stderr, "readermost: %v\n", err)
		os.Exit(1)
	}
}

func run() error {
	var (
		configPath = flag.String("config", "readermost.toml", "path to the configuration file")
		genKey     = flag.Bool("genkey", false, "print a fresh encryption key and exit")
		showVer    = flag.Bool("version", false, "print the version and exit")
	)
	flag.Parse()

	if *showVer {
		fmt.Println(version)
		return nil
	}
	if *genKey {
		key, err := crypto.GenerateKey()
		if err != nil {
			return err
		}
		fmt.Println(key)
		return nil
	}

	logger := slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelInfo}))

	cfg, err := config.Load(*configPath)
	if err != nil {
		return err
	}

	key, err := crypto.ParseKey(cfg.EncryptionKey.Value())
	if err != nil {
		return err
	}
	sealer, err := crypto.NewSealer(key)
	if err != nil {
		return err
	}

	db, err := store.Open(cfg.DatabasePath)
	if err != nil {
		return err
	}
	defer db.Close()

	mmClient := mattermost.New(mattermost.Config{
		BaseURL:      cfg.Mattermost.URL,
		ClientID:     cfg.Mattermost.OAuthClientID,
		ClientSecret: cfg.Mattermost.OAuthClientSecret.Value(),
		RedirectURI:  cfg.CallbackURL(),
	})

	adminClient := miniflux.New(
		cfg.Miniflux.URL,
		cfg.Miniflux.AdminUsername,
		cfg.Miniflux.AdminPassword.Value(),
	)

	// Fail fast: a bad admin credential turns every first login into a confusing
	// 502 much later, so check it once at boot.
	startupCtx, cancelStartup := context.WithTimeout(context.Background(), 15*time.Second)
	adminUser, err := adminClient.Me(startupCtx)
	cancelStartup()
	if err != nil {
		return fmt.Errorf("miniflux admin credentials rejected: %w", err)
	}
	if !adminUser.IsAdmin {
		return fmt.Errorf("miniflux user %q is not an administrator; it cannot provision accounts", adminUser.Username)
	}

	authService := auth.New(cfg, db, sealer, mmClient, adminClient, logger)
	events := hub.New(cfg.Mattermost.URL, cfg.Mattermost.SharedChannelID, logger)
	apiServer := api.New(cfg, authService, mmClient, events, logger)

	frontend, err := web.Handler()
	if err != nil {
		return fmt.Errorf("frontend assets: %w", err)
	}

	mux := apiServer.Routes()
	mux.HandleFunc("GET /auth/login", authService.Login)
	mux.HandleFunc("GET /auth/callback", authService.Callback)
	mux.Handle("POST /auth/logout", authService.RequireAuth(http.HandlerFunc(authService.Logout)))
	mux.Handle("/", frontend)

	handler := authService.Middleware(securityHeaders(requestLogger(logger, mux)))

	server := &http.Server{
		Addr:              cfg.ListenAddr,
		Handler:           handler,
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       120 * time.Second,
	}

	go pruneSessions(db, logger)

	shutdown := make(chan os.Signal, 1)
	signal.Notify(shutdown, os.Interrupt, syscall.SIGTERM)

	serverErrors := make(chan error, 1)
	go func() {
		logger.Info("readermost listening",
			"addr", cfg.ListenAddr,
			"public_url", cfg.PublicURL,
			"version", version)
		serverErrors <- server.ListenAndServe()
	}()

	select {
	case err := <-serverErrors:
		if errors.Is(err, http.ErrServerClosed) {
			return nil
		}
		return err

	case sig := <-shutdown:
		logger.Info("shutting down", "signal", sig.String())
		ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
		defer cancel()
		return server.Shutdown(ctx)
	}
}

// pruneSessions clears expired rows so the table does not grow without bound.
func pruneSessions(db *store.Store, logger *slog.Logger) {
	ticker := time.NewTicker(6 * time.Hour)
	defer ticker.Stop()

	for {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		removed, err := db.DeleteExpiredSessions(ctx)
		cancel()

		switch {
		case err != nil:
			logger.Warn("prune sessions failed", "error", err)
		case removed > 0:
			logger.Info("pruned expired sessions", "count", removed)
		}
		<-ticker.C
	}
}

// securityHeaders applies defaults appropriate for an app that renders feed
// content it does not control.
func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "same-origin")
		w.Header().Set("X-Frame-Options", "DENY")
		next.ServeHTTP(w, r)
	})
}

// requestLogger records failures and slow requests, not every hit.
func requestLogger(logger *slog.Logger, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		started := time.Now()
		recorder := &statusRecorder{ResponseWriter: w, status: http.StatusOK}

		next.ServeHTTP(recorder, r)

		elapsed := time.Since(started)

		// A WebSocket is meant to be long-lived; its duration says nothing about
		// whether anything is wrong.
		if r.URL.Path == "/api/ws" {
			return
		}
		if recorder.status >= 500 || elapsed > 2*time.Second {
			logger.Warn("request",
				"method", r.Method,
				"path", r.URL.Path,
				"status", recorder.status,
				"duration", elapsed.String())
		}
	})
}

type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (r *statusRecorder) WriteHeader(status int) {
	r.status = status
	r.ResponseWriter.WriteHeader(status)
}

// Hijack forwards to the underlying writer. Without this the wrapper hides the
// http.Hijacker interface and every WebSocket upgrade fails with 500.
func (r *statusRecorder) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	hijacker, ok := r.ResponseWriter.(http.Hijacker)
	if !ok {
		return nil, nil, fmt.Errorf("readermost: ResponseWriter does not support hijacking")
	}
	return hijacker.Hijack()
}

// Flush forwards to the underlying writer, for the same reason.
func (r *statusRecorder) Flush() {
	if flusher, ok := r.ResponseWriter.(http.Flusher); ok {
		flusher.Flush()
	}
}
