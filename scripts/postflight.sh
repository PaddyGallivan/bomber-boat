#!/usr/bin/env bash
BASE="${1:-https://bomberboat.com.au}"
sleep 4
declare -A MIN=(
  ["/"]=20000
  ["/bomberboat-admin"]=50000
  ["/cancel.html"]=1000
  ["/manifest-public.json"]=100
  ["/icon-public-192.png"]=1000
  ["/logo.png"]=50000
  ["/hero.jpg"]=10000
  ["/version.json"]=10
  ["/api/bookings/count"]=10
  ["/api/schedule"]=50
)
fail=0
for path in "${!MIN[@]}"; do
  url="${BASE}${path}"
  resp=$(curl -sLo /tmp/_pf -w "%{http_code} %{size_download}" "$url")
  code=$(echo $resp | awk '{print $1}')
  size=$(echo $resp | awk '{print $2}')
  if [ "$code" != "200" ]; then
    echo "[postflight] $path -> HTTP $code"
    fail=1
  elif [ "$size" -lt "${MIN[$path]}" ]; then
    echo "[postflight] $path -> $size bytes < min ${MIN[$path]}"
    fail=1
  else
    echo "[postflight] OK  $path ($code, $size bytes)"
  fi
done
[ $fail -eq 0 ] || { echo "[postflight] FAIL - rollback recommended"; exit 1; }
echo "[postflight] all live URLs healthy"
