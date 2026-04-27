# bomber-boat

bomberboat.com.au — public site (`/site`) + worker API (`/worker`).

**Deploys are 100% GitHub-driven. NO LOCAL INFRA.**

## Layout

- `site/` — static site shipped to Cloudflare Pages project `bomber-boat`
- `worker/` — Cloudflare Worker `bomber-boat-api` (handles `/api/*`, `/admin`, `/captain`, `/staff`, `/board`)
- `.github/workflows/deploy.yml` — push to `main` → Pages + Worker deploy

## Edit anywhere

GitHub web UI, github.dev, VS Code, your phone. No watcher, no Drive sync, no `.bat` files.

## Required GH Actions secrets (one-time)

| Secret | Value source |
|---|---|
| `CLOUDFLARE_API_TOKEN` | `https://asgard-vault.pgallivan.workers.dev/secret/CF_API_TOKEN` (PIN 2967) |
| `CLOUDFLARE_ACCOUNT_ID` | `a6f47c17811ee2f8b6caeb8f38768c20` |

## Worker secrets (already set in CF, NOT in this repo)

`API_KEY`, `ADMIN_PASSWORD`, `CAPTAIN_PASSWORD`, `STAFF_PASSWORD`, `STRIPE_SECRET_KEY`, `RESEND_API_KEY`, `CF_API_TOKEN`, `ANTHROPIC_API_KEY`. The deploy uses `--keep-vars` so secrets are preserved across deploys.

## Safety guards

The deploy workflow runs `scripts/preflight.sh` before pushing the site (refuses to deploy a too-small `bomberboat-admin.html` etc.) and `scripts/postflight.sh` after (verifies live URL sizes; fails the run if anything blanks out).

## D1

```
DB binding -> bomber-boat-db (c7dda294-5bba-41c1-a85d-bcc5a9bf1d29)
```

## KV

```
MEMORY binding -> 33318695818d4235b358165b4a6f88dc
```
