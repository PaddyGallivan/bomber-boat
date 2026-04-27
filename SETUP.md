# One-time setup (60 seconds, then forever cloud)

The PAT in the vault has `public_repo` scope only — not `workflow`, not `repo`. So this push doesn't include the GH Actions workflow file or auto-set the secrets. Two manual steps below and you're done forever.

## Step 1 — grant `workflow` scope to the GH token (or use a fine-grained one)

1. Go to https://github.com/settings/tokens
2. Edit the token, tick `workflow`, save.
3. Update the vault: `curl -s -X POST -H "X-Pin: 2967" -H "Content-Type: application/json" https://asgard-vault.pgallivan.workers.dev/secret/GITHUB_TOKEN -d '{"value":"NEW_TOKEN"}'` — only if the token value changes; ticking workflow on an existing token keeps the value.

## Step 2 — paste the workflow file + 2 secrets

1. `cp docs/SETUP-WORKFLOW.yml .github/workflows/deploy.yml`, commit, push. (After step 1, the push works.)
2. Go to https://github.com/PaddyGallivan/bomber-boat/settings/secrets/actions and click **New repository secret** twice:

| Secret name | Value |
|---|---|
| `CLOUDFLARE_API_TOKEN` | (paste from `https://asgard-vault.pgallivan.workers.dev/secret/CF_API_TOKEN` with PIN 2967) |
| `CLOUDFLARE_ACCOUNT_ID` | `a6f47c17811ee2f8b6caeb8f38768c20` |

That's it. Every push to `main` from now on:
- Runs `scripts/preflight.sh` (refuses to ship undersized files)
- Deploys `site/` to Cloudflare Pages project `bomber-boat`
- Deploys `worker/` to Cloudflare Worker `bomber-boat-api`
- Runs `scripts/postflight.sh` (verifies live URLs are healthy; fails the run if anything is broken)

No watcher. No Drive sync as a deploy path. No `.bat` files. No PowerShell. No local wrangler. NO LOCAL INFRA.

## After it's wired

1. Stop the local watcher: open Task Manager → kill any `powershell.exe` running `bb-watch.ps1`.
2. Rename `G:\My Drive\bb-deploy-stage\bb-watch.ps1` → `bb-watch.ps1.RETIRED` (so it can't be restarted by accident).
3. Rename `G:\My Drive\bb-deploy-stage\start-watcher.bat` → `start-watcher.bat.RETIRED`.
4. From now on, edit at https://github.com/PaddyGallivan/bomber-boat (or via github.dev — press `.` while viewing any repo file, get a full VS Code in browser, edit, commit, push, deploy).
