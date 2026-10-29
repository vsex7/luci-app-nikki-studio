#!/bin/bash
# Run all offline tests. roundtrip.sh additionally needs the simulated Nikki environment (see README).
set -e
cd "$(dirname "$0")"
for f in ../htdocs/luci-static/resources/tools/*.js ../htdocs/luci-static/resources/view/nikki-studio/*.js; do
	node -e "new Function(require('fs').readFileSync('$f','utf8'))" || { echo "syntax error: $f"; exit 1; }
done
echo "js syntax ok"
node parse.test.js
node yaml-dump.test.js
[ -x /usr/bin/ucode ] && [ -f /data/t/call.uc ] && ./roundtrip.sh || echo "(roundtrip skipped: no simulated env)"
