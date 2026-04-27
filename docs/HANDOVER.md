# Bomber Boat — Canonical Handover

> **Read this first in every new Bomber Boat chat.**
> Source of truth lives here, not in Google Drive. Edit via github.dev (press `.` on any repo file) or the GitHub web UI.

---

## Live state (as of 27 April 2026)

- **Public site:** https://bomberboat.com.au — CF Pages project `bomber-boat`, build `bb-20260427-bugfix-v1`
- **Worker API:** `bomberboat.com.au/api/*` → worker `bomber-boat-api` (v9.19)
- **D1 database:** `bomber-boat-db` (UUID `c7dda294-5bba-41c1-a85d-bcc5a9bf1d29`)
- **Stripe:** Luck Dragon Pty Ltd, AUD, weekly payouts, 2-day delay
- **Resend (outbound email):** `bookings@bomberboat.com.au` (DKIM+SPF verified)
- **Inbound email:** `hello@bomberboat.com.au` → CF Email Routing → `pgallivan@outlook.com`
- **Active bookable game:** Round 8 — Essendon v Brisbane Lions (Sat 2 May 2026, Marvel Stadium, 12:35pm)
- **Instagram:** @bomberboat — profile pic set, no posts yet

---

## Login URLs

| Role | URL | Password | What they see |
|---|---|---|---|
| Admin | https://bomberboat.com.au/admin | `$Falkor2967` | Full UI |
| Captain | https://bomberboat.com.au/captain | `bomberboatcaptain` | Same as admin |
| Staff | https://bomberboat.com.au/staff | `bomberstaff` | Boarding card + game picker only |

---

## Deploy pipeline (cloud-only)

Push to `main` on this repo → `.github/workflows/deploy.yml` runs:

1. `bash scripts/preflight.sh site` — refuses to ship if any required site file is under its min-size threshold (e.g. `bomberboat-admin.html < 50KB`).
2. Detects whether `site/` or `worker/` changed in the push and deploys only what's needed.
3. `npx wrangler@4 pages deploy` for the site (`bomber-boat`); `npx wrangler@4 deploy --keep-vars` for the worker (`bomber-boat-api`).
4. `bash scripts/postflight.sh https://bomberboat.com.au` — fetches every public URL and confirms HTTP 200 + min byte size; fails the GH run if anything blanks out, with a "rollback recommended" message.

Repo secrets (already configured): `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID = a6f47c17811ee2f8b6caeb8f38768c20`. Worker secrets (`API_KEY`, `ADMIN_PASSWORD`, etc.) live in CF and survive deploys via `--keep-vars`.

If GH Actions ever stops running: re-add the workflow file from `docs/SETUP-WORKFLOW.yml` after granting `workflow` scope to the GH PAT (`https://github.com/settings/tokens`).

### Why preflight + postflight exist (post-mortem 27 Apr 2026)
On 26 Apr ~12:13 UTC `bomberboat-admin.html` in the old Drive deploy folder went from 130855 bytes to 0 bytes (Drive-sync or interrupted-write corruption). The old chain shipped the empty file; CF Pages served HTTP 200 with a blank body; `/admin` was effectively dead until 27 Apr. `cancel.html` had the same fate. Recovery: restored both from CF Pages preview `c3bc0a60` via direct wrangler deploy. The min-size guards prevent any future "ship a 0-byte critical file" attempt.

### Rollback (break-glass)
For instant rollback without a git revert: legacy `bomberboat-rollback.bat` lives in Drive root and calls the CF Pages rollback API directly. Last known-good deployment was `674425bc` (25 Apr 2026). Preferred path is still: revert the offending commit on GitHub and let GH Actions auto-redeploy.

---

## Repo layout

```
bomber-boat/
├── .github/workflows/deploy.yml   # CI/CD entrypoint
├── site/                          # public CF Pages site
│   ├── index.html                 # ~98KB after dead-CSS strip
│   ├── bomberboat-admin.html      # ~131KB (admin/captain/staff portal)
│   ├── cancel.html                # Stripe cancel page
│   ├── manifest-public.json       # PWA manifest
│   ├── version.json               # build id, polled by client every 60s
│   ├── logo.png                   # hero logo (sourced from ChatGPT-generated artwork)
│   ├── hero.jpg                   # hero background (Yarra River Cruises boat)
│   └── icon-public-192.png        # PWA icon (regenerated from logo)
├── worker/                        # CF Worker API source
│   ├── index.js                   # bomber-boat-api (currently v9.19)
│   └── wrangler.toml              # worker bindings + D1 attachment
├── scripts/
│   ├── preflight.sh               # min-size guard before deploy
│   └── postflight.sh              # live URL health check after deploy
└── docs/
    ├── HANDOVER.md                # this file
    ├── ARCHITECTURE.md            # system design
    └── SETUP-WORKFLOW.yml         # workflow re-add template
```

---

## v10/bugfix-v1 design state (current site)

Hero: `logo.png` rounded image → subtitle "The Bombers fan boat to and from Marvel Stadium" → route pill "Cafe Riviera, Maribyrnong → Marvel Stadium" → countdown widget (hidden unless an active game is upcoming). Hero background is `hero.jpg` with a dark vignette.

Below hero: "What's Included" — 6 black tiles with red top accent (Free Drink / Finger Food / Cheap Bar / Card Payment / Departs 1.5 hrs before bounce / Returns 30 min after final siren).

Booking flow: game dropdown → 3 ticket-type tiles (Both ways / One-way to game / Return leg only) in a forced 3-col grid on desktop → BOOK MY SPOT button → Stripe Checkout.

Below booking: "Boat to any game" register-interest form (venue + game + party size + email).

Map: OpenStreetMap iframe of 55 Cumberland Dr, Maribyrnong. FAQ accordion. Footer.

### What was stripped along the way
- All emojis (perks ticker, route pill, FAQ, buttons, toasts, ticket icons)
- Scrolling perks marquee → static "What's Included" tiles
- `bomberboat.com.au` domain tag from the hero
- `BOMBERBOAT` typographic h1 (logo carries branding)
- Image carousel (AI-image vibe was too obvious)
- "Share with mates" button
- Journey-times line
- Diagonal stripe body texture
- Spots-remaining banner (don't reveal booking counts to public)
- Past games from the dropdown (parsed from label text since API doesn't return a `date` field)
- Misleading "(Mon TBC)" placeholder weekdays — rewritten client-side to "(day TBC)"
- ~404 lines of dead CSS

### Inactive games
Listed in dropdown with "(NOT YET TAKING BOOKINGS)" suffix and disabled.

---

## Worker v9.19 endpoints

```
/api/schedule              GET   public  — list games + boats + availability
/api/book or /api/bookings POST  public  — create booking + Stripe Checkout + Resend
/api/cancel                GET   public  — cancel via token in email
/api/interest              POST  public  — register interest
/api/interest              GET   admin   — list
/api/interest/{id}         DELETE admin  — remove
/api/interest/email        POST  admin   — bulk Resend
/api/bookings              GET   admin   — list all
/api/bookings/{id}         PATCH admin   — edit (incl. boarded toggle)
/api/bookings/{id}         DELETE admin  — remove
/api/bookings/count        GET   public  — totals (de-authed in v9.19; counts only, no PII)
/api/boats                 CRUD  admin   — fleet
/api/game-boats            CRUD  admin   — multi-boat per-game
/api/game-settings         POST  admin   — capacity / prices / active / boat_id
/api/waitlist              CRUD  admin   — per-game waitlist
/api/broadcast             POST  admin   — mass-email all bookings for a game
/api/reminders/send        POST  admin   — re-send confirmations
/api/scan?b=ID&t=TOKEN&leg=out|back     — captain QR scan
/api/roster, /api/board    GET   admin   — boarding lists
/admin /captain /staff     — 302 redirects to /bomberboat-admin?login=<role>
```

**Auth:** `requireApiKey` and `requireAdmin` accept `API_KEY`, `ADMIN_PASSWORD`, `CAPTAIN_PASSWORD`, or `STAFF_PASSWORD`.

### D1 tables

```
game_settings    — one row per home game (capacity, fare_mode, active, prices, boat_id)
bookings         — every booking. checked_in_out + checked_in_back per-leg flags
boats            — fleet
game_boats       — many-to-many games↔boats
waitlist         — per-game customer waitlist
interest         — register-interest entries
captain_pins     — game-scoped time-limited PINs
afl_fixtures     — fixture cache (not actively used)
charters         — ad-hoc charters
rate_limits      — per-IP throttling
```

Worker secrets currently set: `API_KEY`, `ADMIN_PASSWORD`, `CAPTAIN_PASSWORD`, `STAFF_PASSWORD`, `STRIPE_SECRET_KEY`, `RESEND_API_KEY`, `CF_API_TOKEN`, `ANTHROPIC_API_KEY`.

---

## Recent fixes (bugfix-v1, 27 Apr 2026)

1. `/api/bookings/count` made public (was 401-ing the public page's SOLD OUT detection logic).
2. Real `manifest-public.json` + `icon-public-192.png` shipped — no more 404s in `<head>`.
3. ~404 lines of dead CSS stripped from `index.html` (perks-strip, spots-banner, bb-carousel, modal-*, seats-*, cap-*, pax-row*, gallery-*, info-card, `.hero h1`, `@keyframes growl`, etc.). Every removed class verified absent from `class=`, `classList.*`, `className`, and JS string literals.
4. Schema.org `streetAddress` fixed in both JSON-LD blocks: `"55 Cumberland Dr"`.
5. Meta tag consistency: `og:title` and `meta description` now match body copy ("to and from Marvel Stadium").
6. `bomberboat-admin.html` restored from CF Pages preview `c3bc0a60` after the 0-byte Drive-sync corruption. Preflight/postflight guards added.

---

## Outstanding business items

- 3 liability insurance quotes (BizCover, Aon, CoverHero) — ~$500–1000/yr expected
- Engage accountant
- Lawyer review of Terms of Service before first paying customer
- Cancel sole trader ABN 78 312 753 967 after Luck Dragon Pty Ltd migration complete

---

## Marketing — Round 8 launch checklist (Sat 2 May 2026)

- First Instagram post (caption ready)
- FB group posts — Bombers fan groups, Thu/Fri before Round 8

---

## Starter message for next chat

> Continuing Bomber Boat. Read `docs/HANDOVER.md` on https://github.com/PaddyGallivan/bomber-boat. Today I want to [edit copy / do IG post / fix bug X / etc].

---

*End of handover. Updated 27 April 2026.*
