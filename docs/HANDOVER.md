# Bomber Boat — Canonical Handover

> **Read this first in every new Bomber Boat chat.**
> Source of truth lives here, not in Google Drive. Edit via github.dev (press `.\ on any repo file) or the GitHub web UI.

---

## Live state (as of 29 April 2026)

- **Public site:** https://bomberboat.com.au — CF Pages project `bomber-boat`, build `bb-20260427-bugfix-v1`
- **Worker API:** `bomberboat.com.au/api/*` → worker `bomber-boat-api` (v9.19)
- **D1 database:** `bomber-boat-db` (UUID `c7dda294-5bba-41c1-a85d-bcc5a9bf1d29`)
- **Stripe:** Luck Dragon Pty Ltd, AUD, weekly payouts, 2-day delay
- **Resend (outbound email):** `bookings@bomberboat.com.au` + `hello@bomberboat.com.au` (DKIM+SPF+DMARC verified ✅)
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

1. `bash scripts/preflight.sh site` — refuses to ship if any required site file is under its min-size threshold.
2. Detects whether `site/` or `worker/` changed and deploys only what's needed.
3. `npx wrangler@4 pages deploy` for the site; `npx wrangler@4 deploy --keep-vars` for the worker.
4. `bash scripts/postflight.sh https://bomberboat.com.au` — confirms HTTP 200 + min byte size on every public URL.

Repo secrets (already configured): `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID = a6f47c17811ee2f8b6caeb8f38768c20`.

### Rollback (break-glass)
For instant rollback without a git revert: legacy `bomberboat-rollback.bat` lives in Drive root. Last known-good deployment was `674425bc` (25 Apr 2026). Preferred path: revert the offending commit on GitHub and let GH Actions auto-redeploy.

---

## Repo layout

```
bomber-boat/
├── .github/workflows/deploy.yml
├── site/
│   ├── index.html
│   ├── bomberboat-admin.html
│   ├── cancel.html
│   ├── manifest-public.json
│   ├── version.json
│   ├── logo.png
│   ├── hero.jpg
│   └── icon-public-192.png
├── worker/
│   ├── index.js                   # bomber-boat-api (v9.19)
│   └── wrangler.toml
├── scripts/
│   ├── preflight.sh
│   └── postflight.sh
└── docs/
    ├── HANDOVER.md                # this file
    ├── ARCHITECTURE.md
    ├── OPERATOR-EMAIL.md
    ├── SETUP-WORKFLOW.yml
    ├── bb-cheer-squad-email.html  # Round 8 cheer squad email (Outlook-safe HTML)
    └── posters/
        ├── bb-poster-ig.png       # Instagram 1080×1080
        ├── bb-poster-fb.png       # Facebook 1200×628
        ├── bb-poster-story.png    # Story 1080×1920
        └── bb-poster-a3.png       # A3 print
```

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

## Corporate / partnership strategy

These are the high-leverage growth plays beyond individual ticket sales. **Do not lose these.**

### 1. Essendon Football Club — annual partnership
Approach EFC directly for a **yearly deal (~$15–20k/yr)** rather than per-head. EFC officially endorses and promotes Bomber Boat to members. Approach after Saturday's maiden voyage — get photos/proof of concept first, then pitch.
- Contact: TBD (approach via official channels)
- Angle: club-endorsed experience, guaranteed revenue, member benefit

### 2. Corporate Friday night charters
Charter the whole boat for corporate groups. Friday evening sailing as a team outing.
- Target market: Maribyrnong / Footscray / CBD businesses
- Sell the whole boat as a private event

### 3. Yarra Cruises fleet partnership
**Key insight: Yarra Cruises operates the boats — Bomber Boat is the booking platform/brand layer (asset-light, scalable).** Yarra Cruises have 4 big boats. A fleet partnership could scale capacity dramatically beyond a single vessel without owning any assets.

### 4. Beer / beverage sponsorship
Approach a beer brand (e.g. Carlton, Great Northern, Pure Blonde) for boat branding, subsidised bar prices, co-marketing deal.

### 5. bulldogsboat.com.au (registered)
Domain already registered — model can be extended to other AFL clubs.

---

## Marketing assets — Round 8 (created 28–29 Apr 2026)

### Cheer Squad email
- **File:** `docs/bb-cheer-squad-email.html` (this repo)
- **To:** cheersquad@essendonfc.com.au
- **From:** hello@bomberboat.com.au via Resend
- **Subject:** Bomber Boat — group offer for the Cheer Squad (Sat vs Brisbane)
- **Status:** ✅ **SENT 29 Apr 2026** (Resend ID `cd599bb0`) — sent early (Wed morning), scheduled task `bb-cheer-squad-email-r8` disabled to prevent double-send
- **Content:** fares ($90 adult return / $40 child / one-way link), Maiden Voyage Bonus (free return trip on any other home game), photographer on board (shooteverything.com.au), 60 seats, CTA → bomberboat.com.au
- **HTML approach:** HTML 4.01 Transitional doctype, zero VML, zero conditional comments, zero `<div>` inside cells, plain `bgcolor` table button — Outlook-safe.

### Poster assets (4 formats)
Created 28 Apr 2026. **Canonical location: `docs/posters/` in this repo** (NOT Drive).
- `docs/posters/bb-poster-ig.png` — Instagram 1080×1080
- `docs/posters/bb-poster-fb.png` — Facebook 1200×628
- `docs/posters/bb-poster-story.png` — Story 1080×1920
- `docs/posters/bb-poster-a3.png` — A3 print

All feature QR code → bomberboat.com.au, Essendon red/black branding.

### Social post copy
Full copy (FB post + IG caption) emailed to pgallivan@outlook.com (Resend ID `bc61bffc`) with all 4 posters attached. Ready to go.

#### Facebook post — post to Bombers fan groups Thu/Fri
Use `bb-poster-fb.png` or `bb-poster-ig.png` as image.

#### Instagram — first post
Use `bb-poster-ig.png` as image. Story: `bb-poster-story.png`.

---

## Outlook email — lessons learnt (28 Apr 2026)

Root cause of raw HTML rendering in Outlook: VML conditional comments (`<!--[if mso]>` + `<!--[if !mso]><!-->\ …`<!--<![endif]-->`) leave Outlook's Word-engine parser in an undefined state, causing everything after them to render as raw text.

Rules for future Bomber Boat transactional emails:
1. Use HTML 4.01 Transitional doctype
2. No conditional comments of any kind
3. No VML
4. No `<div>` inside `<td>` — use `<br>` for spacing
5. No CSS `border` on `<td>` — use nested tables or `bgcolor`
6. Buttons via plain `<table><tr><td bgcolor="#C8102E">` — no `display:block` tricks

---

## Recent fixes (bugfix-v1, 27 Apr 2026)

1. `/api/bookings/count` made public.
2. Real `manifest-public.json` + `icon-public-192.png` shipped.
3. ~404 lines of dead CSS stripped from `index.html`.
4. Schema.org `streetAddress` fixed: `"55 Cumberland Dr"`.
5. `bomberboat-admin.html` restored from CF Pages preview `c3bc0a60` after 0-byte Drive-sync corruption. Preflight/postflight guards added.

---

## Outstanding business items

- 3 liability insurance quotes (BizCover, Aon, CoverHero) — ~$500–1000/yr expected
- Engage accountant
- Lawyer review of Terms of Service before first paying customer
- Cancel sole trader ABN 78 312 753 967 after Luck Dragon Pty Ltd migration complete
- Add DMARC record — ✅ DONE 29 Apr 2026

---

## Marketing — Round 8 launch checklist (Sat 2 May 2026)

- [x] Cheer squad email — sent 29 Apr 2026 (Resend `cd599bb0`)
- [x] DMARC DNS record added
- [x] All 4 posters on GitHub (`docs/posters/`)
- [x] Social post copy emailed to Paddy (FB + IG ready to go)
- [ ] Post to FB Bombers fan groups — Thu/Fri
- [ ] First Instagram post
- [ ] After maiden voyage: approach EFC for annual partnership

---

## Starter message for next chat

> Continuing Bomber Boat. Read `docs/HANDOVER.md` on https://github.com/PaddyGallivan/bomber-boat. Today I want to [edit copy / do IG post / fix bug X / etc].

---

*End of handover. Updated 29 April 2026.*
