# Readermost

A Google Reader-style front end for a group of friends, built on two things you
probably already run: **Miniflux** for feeds and **Mattermost** for identity and
conversation.

- **Miniflux** is the feed engine and reading database — subscriptions, entries,
  read/unread, stars, folders. Users never get an account there directly.
- **Mattermost** is the identity provider *and* the social database. One
  configured channel is the shared river: each shared link is a root post, and
  its thread is the comment section. Comment from the app or from Mattermost —
  it is the same data either way.
- **Readermost** is an authenticating proxy over both, plus a React reader.

## How it fits together

```
browser ──┬── /api/*  ──► Readermost ──┬── Miniflux REST (Basic, per-user)
          └── /api/ws ──►              └── Mattermost v4 (Bearer, user's token)
```

Every Mattermost call is made with the signed-in user's own OAuth token, so
Mattermost's permissions apply for free and posts are genuinely authored by the
person who shared them. Only Miniflux account creation uses a privileged
credential.

### Why there is a local database

Miniflux has no act-on-behalf-of-user API, and API keys are self-service only —
an admin cannot mint one for someone else. So Readermost generates a random
password for each provisioned Miniflux account, stores it encrypted (AES-GCM),
and talks to Miniflux as that user over HTTP Basic. The SQLite file holds only
users and sessions; **shared links and comments are not stored** — Mattermost is
the source of truth, with share metadata living in each post's `props` bag.

## Setup

### 1. Mattermost

- System Console → Integrations → Integration Management → enable
  **OAuth 2.0 Service Provider**. Leave *Dynamic Client Registration* off: it
  lets anyone register a client without authenticating.
- Product menu → Integrations → OAuth 2.0 Applications → Add, as a
  **confidential** client, with callback `https://your-host/auth/callback`.
- Create the channel that will hold shared links and note its ID.

### 2. Miniflux

Create an administrator account for Readermost to provision with. It is checked
at startup, so a wrong credential fails immediately rather than at someone's
first login.

### 3. Run it

```sh
cp readermost.example.toml readermost.toml   # then edit
export READERMOST_KEY="$(nix run .# -- --genkey)"
nix run .#
```

## Development

```sh
nix develop          # Go + Node toolchain, nothing installed globally
go test ./...
(cd web && npm run dev)   # Vite on :5173, proxying /api and /auth to :8080
go run ./cmd/readermost --config readermost.toml
```

`nix flake check` is the gate: it builds both derivations, runs the Go tests in
a sandbox, and evaluates the NixOS module.

## Trying it locally

The `dev/` scripts bring up a throwaway Miniflux and Mattermost with podman, and
register the OAuth app for you — no clicking through System Console.

```sh
nix develop          # jq, curl and the toolchain
dev/up.sh            # postgres + miniflux + mattermost (first run pulls ~1.5GB)
dev/bootstrap.sh     # admin, friend, team, channel, OAuth app → readermost.local.toml
go run ./cmd/readermost --config readermost.local.toml
```

Then open <http://localhost:8080> and sign in as `admin` / `Readermost-dev-1`.

| Service | URL | Credentials |
|---|---|---|
| Readermost | http://localhost:8080 | via Mattermost |
| Mattermost | http://localhost:8065 | `admin` or `friend` / `Readermost-dev-1` |
| Miniflux | http://localhost:8081 | `admin` / `miniflux-dev-password` |

Bootstrap creates a second account, `friend`, already in the shared channel.
Sign in as them in a private window to watch a share appear for one user and a
reply land for the other, live over the WebSocket.

A round trip worth doing once, because it exercises every seam at once:

1. Subscribe to a feed (**+ Subscribe**, paste a blog's homepage — Miniflux
   discovers the feed).
2. Press `S` on an article to share it.
3. Open <http://localhost:8065> in the ~reader-shared channel: the post is there,
   authored by you, with the article rendered as a link.
4. Reply from Mattermost. The comment shows up in Readermost without a refresh.
5. Paste a bare URL into the channel from Mattermost — it appears in the river
   too, because the channel is the source of truth, not Readermost.

```sh
dev/down.sh            # stop, keep data
dev/down.sh --purge    # stop and wipe, including readermost.local.toml
```

`readermost.local.toml` holds a generated encryption key and the OAuth secret,
and is gitignored. The credentials in `dev/lib.sh` are deliberate throwaways —
that stack binds to localhost and should never be exposed.

## Deploying

`nix build` produces a single CGO-free binary with the frontend embedded — no Go,
Node, or system SQLite needed on the target.

The flake also ships `nixosModules.default`:

```nix
services.readermost = {
  enable = true;
  settings = {
    public_url = "https://reader.example.org";
    mattermost.url = "https://mm.example.org";
    mattermost.shared_channel_id = "...";
    miniflux.url = "https://miniflux.internal";
    miniflux.admin_username = "admin";
  };
  secrets = {
    encryption_key = "/run/secrets/readermost-key";
    mattermost_oauth_client_secret = "/run/secrets/readermost-mm";
    miniflux_admin_password = "/run/secrets/readermost-miniflux";
  };
};
```

Secrets go through systemd `LoadCredential`, never into `settings` — that is
rendered into the world-readable Nix store.

## Keyboard

`j`/`k` next/previous · `o` open · `m` toggle read · `s` star · `S` share ·
`v` open original · `r` refresh · `A` mark all read · `g u`/`g a` jump · `?` help

## Notes

- **Anyone on your Mattermost server can sign in** and gets a Miniflux account
  provisioned. That is deliberate. The `users.disabled` column is the kill
  switch if it ever stops being what you want.
- Miniflux polls per user, so a feed two people subscribe to is fetched twice.
  Fine at friend-group scale.
- Folders are one level deep, because Miniflux categories are flat. That also
  happens to be exactly what Google Reader's folders were.
