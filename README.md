# Bomber Boat

Fan ferry service to Essendon Bombers home games at Marvel Stadium. Departs Cafe Riviera on the Maribyrnong River, complimentary finger food and bar prices on board.

Live: **https://bomberboat.com.au**

## Repo layout

| Path | What |
|---|---|
| `site/` | Public CF Pages site (HTML/CSS/JS) |
| `worker/` | CF Worker API (`bomber-boat-api`) — bookings, Stripe, Resend, D1 |
| `scripts/` | `preflight.sh` + `postflight.sh` — deploy guards |
| `.github/workflows/deploy.yml` | CI/CD |
| `docs/HANDOVER.md` | **Read this first.** Live state, login URLs, deploy pipeline, open punch list |
| `docs/ARCHITECTURE.md` | System design |

## Edit + deploy

- Edit anywhere: github.com web UI, github.dev (press `.` on any repo file → full VS Code in browser), `git clone` locally if you must.
- Push to `main` → preflight checks size thresholds → wrangler deploys → postflight checks live URLs return HTTP 200 with non-blank bodies → done. Typical run takes ~1–2 minutes.
- Rollback: revert the offending commit on GitHub and push.

## Stack

- **Frontend:** vanilla HTML/CSS/JS (no framework). Single-file deploy.
- **Backend:** Cloudflare Worker (`bomber-boat-api`) on `bomberboat.com.au/api/*`.
- **DB:** Cloudflare D1 (`bomber-boat-db`).
- **Payments:** Stripe Checkout (Luck Dragon Pty Ltd, AUD).
- **Email:** Resend for outbound (`bookings@bomberboat.com.au`); CF Email Routing for inbound (`hello@bomberboat.com.au`).
