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

### What lives where

**Miniflux owns feeds**: subscriptions, fetching, article text, and per-article
read and starred state. **Mattermost owns the conversation**: every shared link
is a post and every comment a reply, with share metadata in the post's `props`
bag. Neither is a copy — both are the source of truth for their half.

**Readermost owns the river**, and its SQLite file holds four things:

- **Users and sessions.** Miniflux has no act-on-behalf-of-user API, and API
  keys are self-service only — an admin cannot mint one for someone else. So
  Readermost generates a random password for each provisioned Miniflux account,
  stores it encrypted (AES-GCM), and talks to Miniflux as that user over Basic
  auth.
- **Cached article text** for shared links. A shared link carries only a URL,
  and Miniflux entry IDs are per-user, so without this a friend's share is
  unreadable unless you happen to follow the same feed. The sharer always has
  the full text, so it is copied at share time.
- **River read state**, per user. Feed read state is Miniflux's; the river is
  not something Miniflux knows about at all.

> The article cache is keyed by URL alone and readable by every user. That is
> sound only while feeds are public, which is the current assumption —
> Readermost has no private-feed support. Adding one means adding an access
> check on that table.

### Two upstream limits worth knowing

Neither Mattermost nor Miniflux indexes URLs in search — a full URL and a
hyphenated slug both match nothing, while titles match fine. So two questions
are answered by scanning and comparing rather than querying:

- *Has this been shared?* — from a cached snapshot of the channel, rebuilt when
  a post arrives and at most every 30 seconds. It reaches back 600 posts, which
  is also the river's horizon: older shares fall off the list.
- *Do I have this article?* — by searching Miniflux for the title and confirming
  on the URL.

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
   too, because the channel is where shared links live. Post a message with no
   link and confirm it does *not*: that is chat, not a shared article.
6. Subscribe `friend` to a feed `admin` does not have and share from it. As
   `admin`, confirm the full text still renders, and that Subscribe puts the
   feed in the folder you choose.

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

## Installing it

Readermost is a progressive web app: open it in a browser and use *Install* (or
*Add to Home Screen*) to get it in its own window, launching straight to your
unread list.

Once installed it opens with no network and shows whatever you had already
loaded — the app shell is precached by a service worker, and the articles,
folders and shared items you have fetched are kept in IndexedDB for a week.
Anything that needs the server is disabled while offline, with a banner saying
so; nothing is queued for later, so there is no sync to go wrong.

Signing out clears that cache, because it outlives the session cookie and the
next person to use the browser profile must not inherit your reading.

### URLs

Every view has an address, so the back button, bookmarks and reloads all work:

```
/unread  /all  /starred        /feed/12        /folder/5
/feed/12/345   ← article open  /shared         /shared/<post id>
```

**Only `/shared/<post id>` is worth sending to anyone else.** Miniflux numbers
feeds and articles per user, so `/feed/12` is a durable bookmark for *you* on
any of your devices, but opens a different feed for a friend. Mattermost post
IDs are global, so a link to a shared item resolves the same for everybody.

## Search

One box over three sources, at `/search?q=…`, reached from the top bar (or `/`)
on a desktop and the ⌕ in the list bar on a phone. A chip narrows the search to
the feed or folder you came from.

- **Feeds** are matched in the browser against the tree already loaded, so they
  appear as you type.
- **Articles** go to Miniflux, which searches titles and bodies and ANDs your
  terms.
- **The shared river** is searched server-side against the cached channel
  snapshot, which reaches back as far as the river itself.

> **Article search is accent-sensitive, and the other two are not.** Miniflux
> indexes with a Postgres text-search configuration that keeps accents, so
> `inflacao` finds nothing while `inflação` finds eight. Feed names and shared
> items are matched by Readermost, which folds accents on both sides, so
> `inflacao` finds them either way. The search screen says so when an article
> search comes up empty on an unaccented query.
>
> Fixing it properly means adding `unaccent` to Miniflux's own search
> configuration — a change on that side, not this one.

## Keyboard

`/` search · `j`/`k` next/previous · `o` open · `m` toggle read · `s` star · `S` share ·
`v` open original · `r` refresh · `A` mark all read · `g u`/`g a` jump · `?` help

## Notes

- **Anyone on your Mattermost server can sign in** and gets a Miniflux account
  provisioned. That is deliberate. The `users.disabled` column is the kill
  switch if it ever stops being what you want.
- Miniflux polls per user, so a feed two people subscribe to is fetched twice.
  Fine at friend-group scale.
- Folders are one level deep, because Miniflux categories are flat. That also
  happens to be exactly what Google Reader's folders were.
