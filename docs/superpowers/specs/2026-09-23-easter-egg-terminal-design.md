# Easter Egg — Bypass Terminal + Settings Tab (Sub-project 1 of 5)

Sub-projects: (1) Bypass Terminal + Settings tab — this doc; (2) Admin Live Terminal Monitor; (3) Custom 404/418; (4) Quiz enhancements; (5) App-wide rate limiting.

## Flow

Extends `apps/frontend/src/app/unauthorized/page.tsx` (reached via redirect in `dashboard/layout.tsx`).

Access Restricted → **Bypass Access** → Matrix takeover (~1.5s) → glass terminal types
`Searching route...` → `Route not found...` → `Abort mission?` → idle prompt (`Try your luck`) →
each submission: input → scan → category → canned text reply → idle prompt →
on the final attempt: existing **LULLZ YOU WISH** reveal → "Fine, take me back" → `/dashboard`.

If `easterEgg.enabled` is false, or settings fail to load: plain Access Restricted page, no Bypass button.

## Settings — `easterEgg` category

Added to `DEFAULT_SETTINGS` and validated in `validatePatch`:

| key | type | default | rule |
|---|---|---|---|
| `enabled` | boolean | `true` | boolean |
| `maxAttempts` | number | `40` | integer 30–50 |
| `matrixEffects` | boolean | `true` | boolean |
| `pasteCountsAsAttempt` | boolean | `false` | boolean |

UI: new admin-only "Easter Egg" tab in `dashboard/settings/page.tsx`, saved like other categories. The Live Monitor section is added in sub-project 2.

Non-admin read: `GET /settings` is already available to any authenticated user, so the unauthorized page reads `settings.easterEgg` from it.

## Backend

New `easter-egg` module with a `GET /easter-egg/uptime` endpoint (any authenticated user, protected by the global JwtAuthGuard). It returns `{ uptimeSeconds }` and nothing else. Sub-project 2 extends this module.

## Terminal engine — `apps/frontend/src/lib/easter-egg/terminal.ts`

Pure TypeScript with no React, DOM or network access. It exports `respond(input, ctx) → { lines: string[]; counts: boolean }`.

1. Trim the input and cap it at 256 characters. Empty input gives a short reply and doesn't count as an attempt.
2. Exact commands (case-insensitive): `whoami` (from `ctx.displayName`/`ctx.role`), `uptime` (from `ctx.uptimeSeconds`), `coffee` → `Dependency missing: coffee`, `hack` → `Nice try.`, `help` (hidden command list), `status` and `scan` (simulated multi-line responses).
3. Otherwise, fixed regexes are tested in priority order: Credential → XSS → SQL → Security → Shell → HTTP → JavaScript → HTML → JSON → Other. The first match wins.
4. The reply is a random canned line from that category. Rare lines fire at about 5%, and the previous line is never repeated.
5. Replies are canned. Only `whoami` and `uptime` fill in values, and those come from trusted context, never from the input.

## Paste

`onPaste` and `onDrop` call `preventDefault()` without ever reading `clipboardData`. The page shows a random line from the paste pool (never the same one twice in a row) paired with a random effect: shake, red scanner sweep, lock snap, Matrix burst, cursor blink, glass ripple, or text dissolve. A paste counts toward the attempt limit only when `pasteCountsAsAttempt` is on.

## Rendering and privacy

- All output is rendered as React text nodes. No `dangerouslySetInnerHTML`, `eval` or `new Function`.
- Input and history live only in component state, are cleared on unmount, and are never sent, logged, or written to storage or the URL.
- The attempt counter lives only in memory, so a refresh resets it.
- History is capped at 200 lines.

## Visuals

The Matrix background is a single `<canvas>` driven by `requestAnimationFrame`, with a scanline/HUD overlay in CSS. A circuit breaker halves the column density when the average fps drops below 30 and turns the canvas off if it stays there. The canvas is also off when `prefers-reduced-motion` is set or `matrixEffects` is false. The terminal uses the existing `.glass` styling with an emerald mono font.

## Testing

`apps/frontend/src/lib/easter-egg/terminal.check.ts` is an assert-based script run with Node. It covers:
- every category plus the priority case `<script>SELECT * FROM users</script>` → XSS
- oversized input
- Unicode and empty input
- exact commands
- no immediate repeats
- a 10,000-call run of random input that must never throw

The page is checked manually in a browser: the full sequence, paste with both settings values, the attempt limit, the disabled fallback, and reduced motion.
