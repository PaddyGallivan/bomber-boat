# Bomber Boat — Architecture & Stack Reference

> Original 23 April 2026 · refreshed 27 April 2026 (post GitHub migration)

## TL;DR

Everything runs on **Cloudflare** (Pages + Workers + D1 + Email Routing + DNS), with **Stripe** for payments and **Resend** for outbound email. Source code now lives in the GitHub repo at https://github.com/PaddyGallivan/bomber-boat (deployed via GitHub Actions on push to `main`). Total running cost well under $50/year at current volume; free tiers cover everything except card-transaction fees and the domain renewal.

---

## Components

### 1. Public site — `bomberboat.com.au`
- **File:** single `site/index.html` (~98 KB after v10/bugfix-v1 cleanup) with inline CSS + JS. No framework, no build step.
- **Hosting:** Cloudflare Pages project `bomber-boat`.
- **Co-deployed:** `bomberboat-admin.html` (~131 KB), `cancel.html`, `manifest-public.json`, `version.json`, `logo.png`, `hero.jpg`, `icon-public-192.png`.
- **Deploy:** push to `main` → GitHub Actions runs preflight → `npx wrangler@4 pages deploy site` → postflight (HTTP 200 + min byte size check on every public URL).

### 2. Admin page — `bomberboat.com.au/bomberboat-admin`
- Same single-HTML pattern as the main site.
- Tabs: **Bookings**, **Games**, **Boats**, **Edit Text**.
- Roles share the URL; password decides what's shown:
  - Admin: `$Falkor2967` (full)
  - Captain: `bomberboatcaptain` (full)
  - Staff: `bomberstaff` (boarding + game picker only)
- Quick-login shortcuts: `?login=admin`, `?login=captain`, `?login=staff`. Routes `/admin`, `/captain`, `/staff` 302 to those.

### 3. Backend API — `bomber-boat-api` Worker
- **Platform:** Cloudflare Worker
- **Version:** v9.19 (`/api/bookings/count` made public 27 Apr; rest unchanged from v9.18)
- **File:** single JS file (~70 KB) at `worker/index.js`
- **Auth:** `requireApiKey()` / `requireAdmin()` accept `API_KEY`, `ADMIN_PASSWORD`, `CAPTAIN_PASSWORD`, or `STAFF_PASSWORD`.

### 4. Database — Cloudflare D1
- **Name:** `bomber-boat-db` (UUID `c7dda294-5bba-41c1-a85d-bcc5a9bf1d29`)
- **Tables:** `game_settings`, `bookings`, `boats`, `game_boats`, `waitlist`, `interest`, `captain_pins`, `afl_fixtures`, `charters`, `rate_limits`

### 5. Payments — Stripe
- **Account:** Luck Dragon Pty Ltd (`acct_1TJng4Am8bVflPN0`) · AU · AUD · weekly payouts, 2-day delay
- **Statement descriptor:** `LUCK DRAGON PTY LTD`
- **Flow:** Worker creates a Checkout Session, redirects browser, returns to `?booked=1`.

### 6. Outbound email — Resend
- **Sender:** `bookings@bomberboat.com.au` (DKIM + SPF verified)

### 7. Inbound email — Cloudflare Email Routing
- `hello@bomberboat.com.au` → `pgallivan@outlook.com`

### 8. Domain + DNS — Cloudflare
- Zone: `bomberboat.com.au` (account `a6f47c17811ee2f8b6caeb8f38768c20`)
- Registrar: CrazyDomains (billing on Luck Dragon Pty Ltd)
- Apex + www → CF Pages; worker routes for `/api/*`, `/admin`, `/captain`, `/staff`

### 9. Auto-update mechanism
- `<meta name="build-id">` baked in. Browser polls `/version.json` every 60s + on tab focus; silent reload on mismatch.

### 10. Secrets
Stored as Cloudflare Worker secrets. Bindings: `DB` → D1 · `MEMORY` → KV namespace. GH Actions secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`.

---

## End-to-end booking flow

1. Customer opens `https://bomberboat.com.au`
2. CF Pages serves `index.html` from the nearest edge
3. JS calls `GET /api/schedule` → Worker reads D1
4. Customer picks tickets + email
5. JS POSTs to `/api/book` → Worker writes D1 + creates Stripe Checkout Session + calls Resend
6. Browser redirects to Stripe Checkout → customer pays
7. Stripe posts back to `?booked=1`; Resend sends confirmation
8. Weekly Stripe payout to Luck Dragon Pty Ltd

## Admin flow

1. `/bomberboat-admin` (or `?login=admin`)
2. Login → password stored in browser → used as `X-API-Key` header
3. Admin pulls `/api/schedule`, `/api/bookings`, `/api/boats`, `/api/bookings/count`
4. Setting changes POST to `/api/game-settings`, `/api/game-boats`, `/api/boats`
5. Main site auto-refreshes within 60s

---

## Cost estimate

| Item | Cost |
|---|---|
| CF Pages / Workers / D1 / Email Routing | Free (within limits) |
| Resend | Free (3k emails/month) |
| Stripe | ~1.7% + $0.30 per card txn |
| Domain renewal | ~$15/year |
| **Total fixed** | **~$15/year** |

---

## Source of truth

https://github.com/PaddyGallivan/bomber-boat

```
.github/workflows/deploy.yml
site/                # public CF Pages site
worker/              # CF Worker source
scripts/             # preflight.sh + postflight.sh deploy guards
docs/                # HANDOVER.md, ARCHITECTURE.md (this file), SETUP-WORKFLOW.yml
```

Drive is no longer the source of truth for code or docs.

---

## Useful URLs

- Public: https://bomberboat.com.au
- Admin: https://www.bomberboat.com.au/bomberboat-admin
- Stripe: https://dashboard.stripe.com
- Cloudflare: https://dash.cloudflare.com/a6f47c17811ee2f8b6caeb8f38768c20
- Resend: https://resend.com/domains
- Worker direct: https://bomber-boat-api.pgallivan.workers.dev
- Repo: https://github.com/PaddyGallivan/bomber-boat
- github.dev: https://github.dev/PaddyGallivan/bomber-boat
