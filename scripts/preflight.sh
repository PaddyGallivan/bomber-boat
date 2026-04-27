#!/usr/bin/env bash
set -e
SITE_DIR="${1:-site}"
declare -A MIN=(
  [index.html]=20000
  [bomberboat-admin.html]=50000
  [cancel.html]=1000
  [manifest-public.json]=100
  [icon-public-192.png]=1000
  [logo.png]=50000
  [hero.jpg]=10000
  [version.json]=10
)
fail=0
for f in "${!MIN[@]}"; do
  p="$SITE_DIR/$f"
  if [ ! -f "$p" ]; then
    echo "[preflight] MISSING $f"
    fail=1
  else
    sz=$(stat -c%s "$p")
    if [ "$sz" -lt "${MIN[$f]}" ]; then
      echo "[preflight] $f: $sz bytes < min ${MIN[$f]}"
      fail=1
    else
      echo "[preflight] OK  $f ($sz bytes)"
    fi
  fi
done
[ $fail -eq 0 ] || { echo "[preflight] ABORT"; exit 1; }
echo "[preflight] all checks pass"
