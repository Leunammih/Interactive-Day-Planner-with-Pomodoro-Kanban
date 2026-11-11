#!/usr/bin/env bash
# Turns the planner page (planner.html) into the self-hosted app in ../site
set -euo pipefail
cd "$(dirname "$0")"; OUT=../docs; mkdir -p "$OUT"
python3 scrub.py planner.html
python3 - <<'PY'
src=open("planner.html",encoding="utf8").read()
head='''<link rel="manifest" href="manifest.webmanifest">
<meta name="theme-color" content="#0d7377">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="Day Planner">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<link rel="apple-touch-icon" href="apple-touch-icon.png">
<script src="shim.js"></script>
'''
src=src.replace("<meta charset=utf8>","<meta charset=utf-8>",1)
assert src.count("</head>")>=1
src=src.replace("</head>",head+"</head>",1)
# wording: the account is now the GitHub sync
src=src.replace("Synced to your account","Synced").replace("Account not reachable yet · saved on device","Sync not reachable · saved on device")
open("../docs/index.html","w",encoding="utf8").write(src)
PY
cp shim.js sw.js manifest.webmanifest icon-192.png icon-512.png apple-touch-icon.png "$OUT"/
touch "$OUT/.nojekyll"
echo built
