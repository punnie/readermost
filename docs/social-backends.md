# Pluggable social backends

Readermost currently has exactly one shape: Miniflux for feeds, Mattermost for
everything else. This document plans the work to make the social half a
*choice* — Mattermost, Slack, or nothing at all — without giving up what makes
the Mattermost integration good.

Nothing here is implemented yet. It is a map of the work and of the places
where Slack genuinely does not fit, so those get decided deliberately rather
than discovered halfway through.

## 1. What Mattermost actually does for us

The word "Mattermost" appears across the codebase in three unrelated roles, and
they have to be separated before anything else can happen:

| Role | Where it lives | Needed when there is no social backend? |
|---|---|---|
| **Identity** — OAuth login, the user record, display name, avatar | `internal/auth`, `handleMe`, `handleAvatar` | Yes — someone still has to sign in |
| **Social store** — the river is a channel, comments are a thread, share metadata is a post's `props` | `internal/api/share.go`, `channel.go`, `search.go`, part of `article.go` | No |
| **Event source** — live updates | `internal/hub`, `/api/ws` | No |

That table is the whole plan in miniature. "Install it with no social
connection" is not a matter of hiding the Shared tab; it forces the identity
role to exist independently, which is the single largest piece of new work.

## 2. Two axes, three supported profiles

There are really two independent choices — *who signs in* and *where the river
lives*. Supporting the full cross product is not worth it. The recommendation
is to keep the axes separate **in code** and offer three **configurations**:

| Profile | Identity | River | Live updates |
|---|---|---|---|
| `mattermost` | Mattermost OAuth | Mattermost channel | per-user WebSocket |
| `slack` | Slack OAuth (v2, user scopes) | Slack channel | Socket Mode |
| `none` | local accounts | — | — |

The internal split still pays for itself: `none` requires a local identity
provider to exist anyway, and once it does, "Slack river, local login" is
nearly free to add later if anyone wants it. It just is not a configuration we
document or test on day one.

## 3. The interfaces

A new package `internal/social` owns the vocabulary. Everything else stops
importing `internal/mattermost`.

```go
// Message is a post in the river, normalised across backends.
type Message struct {
    ID        string // Mattermost post ID, or Slack "1758200000.123456"
    RootID    string // thread root; empty for a root post
    AuthorID  string
    CreatedAt int64  // unix MILLIseconds, always — see §4.4
    DeletedAt int64
    Text      string // normalised to plain text/Markdown for the browser
    Link      *SharedLink
    IsSystem  bool
}

type Person struct {
    ID, Username, DisplayName string
}

// Provider is the backend as a whole: config-level facts and construction.
type Provider interface {
    ID() string   // "mattermost" | "slack"
    Name() string // "Mattermost" | "Slack" — user-facing
    AuthorizeURL(state string, pkce *PKCE) string
    Exchange(ctx context.Context, code, verifier string) (*Grant, error)
    Revoke(ctx context.Context, token string) error
    Session(token string) Session
    Permalink(messageID string) string
}

// Session acts as one signed-in person.
type Session interface {
    Me(ctx context.Context) (*Person, error)
    People(ctx context.Context, ids []string) ([]*Person, error)
    Avatar(ctx context.Context, id string) (io.ReadCloser, string, error)

    Messages(ctx context.Context, opts ListOptions) ([]*Message, error) // newest first, paged
    Thread(ctx context.Context, rootID string) ([]*Message, error)
    Message(ctx context.Context, id string) (*Message, error)
    Post(ctx context.Context, m *Outgoing) (*Message, error)
}

// Grant is what an OAuth exchange yields, whatever the backend.
type Grant struct {
    ExternalID, Username, DisplayName string
    Token, RefreshToken               string
    ExpiresAt                         time.Time // zero = never
}
```

The payoff is bigger than it looks. `channelSnapshot`, `normaliseURL`,
`linkFromPost`, `matchesShared`, `countNewerReplies`, the whole of `search.go`
and nearly all of `article.go` are already backend-agnostic *logic* — they only
touch Mattermost through the `*mattermost.Post` type. Re-typing them onto
`social.Message` is mostly mechanical, and afterwards those files never need to
know which backend is configured.

Errors need the same treatment: `api.writeError` switches on
`mattermost.IsUnauthorized` / `IsForbidden` / `IsNotFound`. Those become
`social.ErrUnauthorized` / `ErrForbidden` / `ErrNotFound` sentinels that each
backend maps its own HTTP statuses (and, for Slack, its string error codes)
onto.

A **fake backend** lands in the same phase. It is not optional polish: Slack
cannot be run locally, so it is the only way `dev/` and the handler tests keep
working, and it unlocks HTTP-level tests for `share.go` that do not exist today.

## 4. Where Slack does not fit

Six real frictions. Each needs a decision, not a workaround discovered later.

### 4.1 There is no `props` bag

Mattermost's `props` is why the channel is genuinely the source of truth: the
title, feed, excerpt and published date ride along with the post and survive a
wiped database. Slack's nearest equivalent is **message metadata**
(`event_type` + `event_payload` on `chat.postMessage`, read back with
`include_all_metadata=true`). Two problems: it is unverified whether metadata
can be attached when posting with a *user* token rather than a bot token, and
the payload schema is more constrained than an arbitrary JSON bag.

**Recommendation:** on Slack, keep share metadata in Readermost's own SQLite,
keyed by `(channel_id, ts)`, and attach message metadata too *if* it turns out
user-token posts support it. The fallback already exists and already works —
`linkFromPost` parses the first URL out of the message text — so the failure
mode of a wiped database is "shares degrade to bare links", not "the river
breaks". Mattermost keeps `props` as truth; this is a documented difference in
durability between the two backends, not a regression to the Mattermost path.

### 4.2 Rate limits, and why the 600-post scan probably survives

Since May 2025 Slack throttles `conversations.history` and
`conversations.replies` to **1 request per minute, 15 objects per response**
for apps distributed outside the Marketplace. That would make the current
"scan 600 posts every 30 seconds" model impossible.

It does not apply to **internal apps** — an app created in your own workspace
and never submitted for distribution keeps Tier 3 (50+ requests/minute, up to
1000 messages per request). Readermost is self-hosted by a group of friends, so
every install is exactly that.

**Recommendation:** document loudly that the Slack app must be created in the
workspace and **must not have public distribution enabled**, and port the scan
as-is. On Slack the 600-post window is *one* request instead of Mattermost's
three, so this path is cheaper, not dearer.

**Worth doing later, not now:** a persistent `messages` table fed by incoming
events and backfilled by a bounded scan at startup. It removes the cold-start
scan, makes the river survive a rate-limited or unreachable upstream, and lifts
the 600-post horizon. It also benefits Mattermost. It is a phase of its own and
should not be entangled with getting Slack working at all.

### 4.3 Live updates need a bot, and invert the Hub

There is no per-user event socket on Slack. RTM is legacy, restricted to
classic apps. The two modern options are:

- **Socket Mode** — an app-level (`xapp-`) token opens one outbound WebSocket.
  No public ingress, no TLS termination, works behind NAT: the same posture as
  today's Mattermost WebSocket.
- **Events API** — Slack POSTs to `public_url/slack/events`. Needs a publicly
  reachable HTTPS endpoint, request-signature verification and the URL
  verification handshake.

**Recommendation:** Socket Mode as the default; leave Events API as a later
option for people who would rather not hold an app-level token.

Either way this is **one app-wide stream, not one per user**, and the app's bot
user must be invited to the shared channel to receive `message.channels`
events. Two consequences:

- The Slack backend needs a bot token in addition to each user's token. The
  "every call is made as the user" property holds for *posting and reading*,
  which is what matters for authorship and permissions, but not for the event
  feed.
- `hub.Hub` changes shape. Today `Subscribe(userID, token)` dials upstream per
  user. For Slack there is one connection owned by the process and `Subscribe`
  only registers a fan-out target. The public interface survives unchanged —
  the Slack implementation ignores the token — and the Slack version is the
  simpler of the two. The event source becomes a third interface:

  ```go
  type EventSource interface {
      Run(ctx context.Context) error          // app-level loop; no-op for Mattermost
      Subscribe(userID int64, token string) *hub.Client
  }
  ```

  Fan-out must be gated on channel membership rather than assumed, since events
  no longer arrive over a connection Slack has already access-checked.

### 4.4 IDs, timestamps and permalinks

- A Slack message is identified by `ts` (`"1758200000.123456"`), unique per
  channel. There is one channel, so `river_reads.post_id` stays a `TEXT` key
  and needs no migration. But `validMattermostID` in `avatar.go` (26 lowercase
  alphanumerics) becomes backend-specific — Slack user IDs are `U`/`W` followed
  by uppercase alphanumerics — and `routes.ts` / `routes.test.ts` carry the same
  assumption in their comments and tests. A `ts` is URL-safe, so routing itself
  is unaffected.
- Mattermost's `create_at` is **unix milliseconds**; Slack's `ts` is **seconds
  with six decimals**. `river_reads.seen_reply_at`, `sharedItem.created_at` and
  the frontend's `format.ts` all assume milliseconds. Normalise at the backend
  boundary: `CreatedAt` is always milliseconds, and the raw `ts` string stays
  the ID. Sub-millisecond ordering is lost, which for a friend group's river is
  nothing.
- Thread root is `thread_ts`, which maps cleanly onto `RootID`.
- Permalinks: `chat.getPermalink` is an extra round trip per item. Construct
  them instead — `https://<workspace>.slack.com/archives/<channel>/p<ts without
  the dot>` — taking the workspace domain from `auth.test` at startup.

### 4.5 Author lookups are not batched

`resolveAuthors` resolves every author in a river page with one
`POST /users/ids`. Slack has no batch equivalent: `users.info` is one user per
call, or `users.list` for the whole workspace.

**Recommendation:** a small in-memory user cache with a TTL behind
`Session.People`, warmed once from `users.list` and filled on miss from
`users.info`. Mattermost keeps its batch call; the interface hides the
difference.

### 4.6 Text is mrkdwn, not Markdown

Slack writes links as `<https://url|Title>`, mentions as `<@U0123>`, and
channels as `<#C0123|name>`. Three touch points:

- `shareMessage()` composes a Markdown link today; it becomes backend-specific
  rendering on `Outgoing`.
- `urlPattern`, which rescues bare links pasted straight into the channel, must
  strip the angle brackets and the `|label` suffix.
- The thread view renders `message.message` as plain text — there is no Markdown
  renderer in the frontend — so raw `<@U0123>` would be shown to readers. The
  Slack backend should resolve mentions to display names when normalising
  `Message.Text`, which the user cache above already makes cheap.

### 4.7 Two smaller things

**Token lifetime.** Slack user tokens do not expire unless token rotation is
enabled on the app. Recommend documenting "leave rotation off"; if it is ever
needed, `sessions` already stores an encrypted token and gains a refresh-token
column. `auth.revoke` on logout matches today's `RevokeToken`.

**Dependencies.** `slack-go` is large next to this repo's four direct
dependencies. Roughly eight endpoints are needed (`oauth.v2.access`,
`auth.test`, `users.info`, `users.list`, `conversations.history`,
`conversations.replies`, `chat.postMessage`, `apps.connections.open`).
Recommend hand-rolling the client in the shape of `internal/mattermost`, which
is about 350 lines and already proves the pattern.

## 5. `provider = "none"`, and the identity question

This is the decision that needs an answer before the work starts, because it is
the only part with no precedent in the codebase. With no social backend there
is no OAuth, so something has to authenticate people. Options:

1. **Local accounts** — username and password in the `users` table
   (argon2id), first account created at startup or by a `--create-user` flag.
   Self-contained, works for one person or two, no external dependency.
2. **Trusted header** — take `X-Forwarded-User` from an authenticating reverse
   proxy (Authelia, oauth2-proxy, Tailscale serve). Tiny to implement, but
   catastrophic if the app is ever reachable without the proxy in front.
3. **Single user, no auth** — bind to localhost and let the operator handle it.
   Smallest possible, but makes `users` a special case everywhere.
4. **Generic OIDC** — the most general, and by far the most work.

**Recommendation: (1) as the baseline**, with (2) as a cheap follow-on for
people already running SSO, gated behind an explicit
`auth.mode = "proxy_header"` plus a required trusted-proxy address so it cannot
be enabled by accident. (4) can wait until someone asks.

Beyond login, `none` means: the river, thread, share, search-shared, avatar and
WebSocket routes are not mounted at all (not merely hidden); `shared_content`
and `river_reads` become inert but keep their schema; and `/api/me` reports the
absence so the frontend can adapt.

## 6. Configuration

`config.Load` refuses unknown keys, so the section layout is a breaking change
unless the old one is kept. There is a live install, so keep it:

```toml
[social]
provider = "mattermost"   # "mattermost" | "slack" | "none"

[social.mattermost]
url                 = "https://mattermost.example.org"
oauth_client_id     = "env:READERMOST_MM_CLIENT_ID"
oauth_client_secret = "env:READERMOST_MM_SECRET"
shared_channel_id   = "env:READERMOST_MM_CHANNEL"

[social.slack]
client_id         = "env:READERMOST_SLACK_CLIENT_ID"
client_secret     = "env:READERMOST_SLACK_SECRET"
app_token         = "env:READERMOST_SLACK_APP_TOKEN"   # Socket Mode
bot_token         = "env:READERMOST_SLACK_BOT_TOKEN"   # events; channel reads
shared_channel_id = "C0123456789"

[auth]
mode = "local"   # only when provider = "none"
```

- A top-level `[mattermost]` table keeps working as a deprecated alias for
  `[social.mattermost]` with `provider = "mattermost"` implied, so the existing
  deployment upgrades without a flag day. Warn once at startup.
- `validate()` becomes per-backend: today it hard-requires all four Mattermost
  fields. Only the selected backend's section is checked, plus a clear error
  when `provider = "none"` and no `[auth]` mode is set.
- Startup fail-fast should extend to the new backend the way it already does
  for the Miniflux admin credential: `auth.test` for Slack (also yielding the
  workspace domain for permalinks) and a `conversations.info` on the configured
  channel, so a wrong channel ID fails at boot rather than at someone's first
  river load.

## 7. Schema and migrations

`store.Open` applies one `CREATE TABLE IF NOT EXISTS` block and nothing else —
there is no migration mechanism. One is a prerequisite: a `PRAGMA user_version`
counter plus an ordered list of steps, roughly thirty lines. Then:

```sql
-- users: mm_user_id → a backend-qualified identity
ALTER TABLE users ADD COLUMN auth_provider TEXT NOT NULL DEFAULT 'mattermost';
ALTER TABLE users ADD COLUMN external_id   TEXT;   -- backfilled from mm_user_id
ALTER TABLE users ADD COLUMN display_name  TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN password_hash TEXT;   -- local accounts only
CREATE UNIQUE INDEX users_identity ON users(auth_provider, external_id);

-- sessions: the column name stops being backend-specific
--   mm_access_token_enc → access_token_enc  (+ refresh_token_enc, expires_at)
```

Two details worth deciding rather than inheriting:

- `miniflux_username` is `"mm_" + mattermostID`. New users get a
  backend-derived prefix (`slack_`, `local_`); existing users keep theirs,
  since the value is stored per row.
- **Switching backend on an existing database must fail, loudly.** Every user
  row, every session and every `river_reads` row is keyed to the old backend's
  IDs. Record the configured backend in a `meta` table and refuse to start on a
  mismatch, with a message explaining that the Miniflux accounts are intact and
  what the operator's options are. Silently provisioning a parallel set of users
  is the worst outcome available here.

## 8. Frontend

The goal is one object from `/api/me` rather than provider checks scattered
through components:

```ts
interface Me {
  // …
  social: {
    provider: "mattermost" | "slack" | "none";
    name: string;          // "Mattermost" | "Slack"
    channel_url?: string;  // absent when provider is "none"
  };
}
```

Then, in rough order of size:

- `App.tsx` — the sign-in card ("A shared reader for your Mattermost crowd",
  "Sign in with Mattermost"), and not rendering the river views under `none`.
- `TabBar.tsx` / `Sidebar.tsx` — the Shared entry, and its unread badge.
- `EntryView.tsx` — three strings, the share button, and the empty-state copy.
- `ShareDialog.tsx`, `SharedArticle.tsx`, `Shortcuts.tsx` — labels and the "↗"
  permalink, which has nothing to point at under `none`.
- `useLiveUpdates.ts` — do not open the socket when there is no backend.
- `routes.ts` / `routes.test.ts` — the 26-character assumption in comments and
  tests.
- `Avatar.tsx` — unchanged, as long as the avatar proxy endpoint stays. It
  should: Slack avatar URLs are public CDN links, but proxying keeps the
  frontend uniform and avoids leaking readers' IPs to Slack.

## 9. Packaging, dev and docs

- **`nix/module.nix`** — the `secrets` option documents three fixed keys. It
  becomes backend-dependent (`slack_client_secret`, `slack_app_token`,
  `slack_bot_token`) with an assertion that the right ones are present for the
  chosen backend. `nix/checks.nix` builds a NixOS fixture that names the
  Mattermost secrets; it should grow a second fixture per profile, which is the
  cheapest possible regression test for the config plumbing.
- **`dev/`** — Slack cannot be self-hosted, so `dev/up.sh` can never stand one
  up. Development against Slack needs a real (free) workspace *and* an HTTPS
  tunnel, because Slack rejects plain-HTTP redirect URLs. This is why the fake
  backend from §3 matters: `dev/` should be able to run the whole app against
  Miniflux plus a fake river, with the real Slack path exercised deliberately
  rather than constantly.
- **README** — the opening currently defines the project as Miniflux plus
  Mattermost. It needs restructuring around the three profiles, with setup
  sections per backend, the internal-app warning from §4.2, and the
  durability difference from §4.1 stated plainly.

## 10. Phasing

Each phase should leave the tree green and deployable.

| Phase | Work | Rough size |
|---|---|---|
| **0** | Migration mechanism; new config layout with the `[mattermost]` alias; `meta` table recording the backend | half a session |
| **1** | Extract `internal/social`; move Mattermost behind it; add the fake; re-type the existing tests | 1–2 sessions — the bulk of the risk |
| **2** | `provider = "none"` + local accounts; conditional routes; frontend `me.social` | 1 session |
| **3** | Slack backend: OAuth, river, threads, posting, avatars, permalinks — polling only, no live updates | 2–3 sessions |
| **4** | Slack Socket Mode; invert the Hub | 1 session |
| **5** | README, example config, NixOS module and checks, `dev/` | 1 session |
| **6** | *(optional, later)* persistent message index for both backends | 1–2 sessions |

Phase 1 is deliberately behaviour-neutral: nothing about the running system
changes, every test still passes, and the only observable difference is which
package the types come from. It should land on its own before anything Slack
touches the tree.

## 11. Decisions needed before starting

1. **Identity under `provider = "none"`** — local accounts (recommended),
   trusted proxy header, single-user, or generic OIDC? This gates phase 2 and
   nothing else.
2. **Slack events** — Socket Mode (recommended) or Events API? Socket Mode
   costs an app-level token; Events API costs a publicly reachable endpoint and
   signature verification.
3. **Slack share metadata** — is the local-index-with-text-fallback trade in
   §4.1 acceptable, given it means Slack shares are less durable than
   Mattermost ones?
4. **Backend switching** — confirm that refusing to start on a mismatch (§7) is
   the wanted behaviour, rather than attempting any kind of migration between
   backends.
