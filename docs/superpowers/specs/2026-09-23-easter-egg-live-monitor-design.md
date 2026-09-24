# Easter Egg — Admin Live Terminal Monitor (Sub-project 2 of 5)

## Transport
- socket.io namespace `/easter-egg`, engine path `/ee-socket`, polling only, reached through the Next `/api` rewrite (`/api/ee-socket`).
- Same-origin, so the httpOnly `access_token` cookie is sent automatically.
- `maxHttpBufferSize` is 4 KB.

## Auth (shared with HTTP)
- `auth/verify-access-token.ts` holds the checks the guard already makes: JWT verify, active Redis session, user active. Both `JwtAuthGuard` and the socket gateways use it.
- Socket connection is rejected on any failure, including a pending forced password change.
- Every admin event re-checks `role === ADMIN`.
- **DashboardGateway fix:** it now uses the same verification. Previously it accepted any non-empty token. `join_team_room` is now limited to Admin, the TL themselves, or a member assigned to that TL.

## Sessions
- An in-memory `Map` keyed by socket id: user {id, name, role}, stage (`restricted | terminal | revealed`), attempts, max, lastActive, holding admin socket, and mode (`AUTO | MANUAL`).
- No DB, Redis or disk.
- Capped at 200 live sessions. Past the cap, users simply aren't listed.
- The admin list broadcast is throttled to once per 500 ms, and the list contains no content fields.
- Single-process ceiling: multi-instance deployments need the socket.io Redis adapter.

## Events
User → server:
- `ee:join {stage,max}`
- `ee:status {stage?,attempts?}`
- `ee:line {kind,text}`: accepted only while an admin holds the session. The client also sends lines only while an admin holds the session.

Admin → server:
- `ee:list`
- `ee:connect {sessionId}`: acked `{ok}`. One admin per session, first connect wins. Connecting to a new session releases the admin's previous one.
- `ee:mode {sessionId,mode}`
- `ee:say {sessionId,text}`: MANUAL mode only.
- `ee:release {sessionId}`

Server → user:
- `ee:admin {connected,mode}`
- `ee:reply {text}`

Server → admin:
- `ee:sessions {now,sessions}`
- `ee:mirror {sessionId,kind,text}`
- `ee:ended {sessionId}`

## Limits
- Text over 256 characters is dropped, not truncated.
- Each socket may send 10 events per second; extra events are dropped.
- Logs contain counts only.

## Behaviour
- **AUTO:** replies are generated locally in the user's browser; while an admin is connected, both sides are mirrored to them.
- **MANUAL:** user input is mirrored with no canned reply and doesn't count as an attempt. Admin text is shown as a plain-text operator line.
- **Disconnect**, or the admin's socket dropping, returns the session to AUTO.
- **Transparency:** the user sees an "Admin connected · Live session" pill plus system lines on connect, mode change and disconnect.
- **Failure:** if the socket is down, the terminal works locally. On reconnect it re-joins as a new session and nothing is replayed.

## UI
The Settings → Easter Egg tab gets a Live Monitor section:
- A table: User | Role | Session Status | Live Activity.
- Select a row → Connect / Disconnect, an AUTO ↔ MANUAL toggle, a mirrored console, and an input box that is enabled only in MANUAL.

## Tests
- Jest tests for the gateway: auth rejection, non-admin blocked, routing to the selected session only, busy lock, oversized and rate-limited messages dropped, release on admin disconnect.
- Two-browser Playwright run covering AUTO → MANUAL → Disconnect.
