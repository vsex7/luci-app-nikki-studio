#!/bin/bash
# Round-trip test: load_doc -> write every editable section back unchanged -> data must be identical,
# comments outside edited sections preserved, non-managed keys untouched. Requires the simulated env.
set -u
cd "$(dirname "$0")"
CALL="sudo ucode /data/t/call.uc"
fail=0
cp /etc/nikki/mixin.yaml /tmp/rt.save
for f in fixtures/*.yaml; do
	sudo cp "$f" /etc/nikki/mixin.yaml
	doc=$($CALL load_doc '{"target":"mixin"}')
	patch=$(echo "$doc" | jq -c '.sections | to_entries | map(select(.value.present and (.value.locked | not))) | map({key, value: .value.items}) | from_entries')
	# also modify: append a rule to nikki-rules to force a write
	patch=$(echo "$patch" | jq -c '.["nikki-rules"] = ((.["nikki-rules"] // []) + ["DOMAIN,rt.test,DIRECT"])')
	out=$($CALL diff "$(jq -nc --argjson p "$patch" '{target:"mixin", patch:$p}')")
	echo "$out" | jq -r .after > /tmp/rt.after
	if [ "$(echo "$out" | jq -r '.error // empty')" != "" ]; then echo "FAIL $f: $(echo "$out" | jq -c .)"; fail=1; continue; fi
	exp=$(yq -o json -I0 'explode(.) | .["nikki-rules"] = ((.["nikki-rules"] // []) + ["DOMAIN,rt.test,DIRECT"]) | del(.base)' "$f")
	got=$(yq -o json -I0 'explode(.) | del(.base)' /tmp/rt.after)
	if [ "$exp" != "$got" ]; then echo "FAIL $f: data differs"; echo " exp $exp"; echo " got $got"; fail=1; continue; fi
	# comments outside managed sections should survive
	for c in "# only comments" "# 我的混入" "# keep me"; do
		if grep -qF "$c" "$f" && ! grep -qF "$c" /tmp/rt.after; then echo "FAIL $f: lost comment '$c'"; fail=1; fi
	done
	grep -q '\\U' /tmp/rt.after && { echo "FAIL $f: unicode escapes left"; fail=1; }
	echo "ok   $f"
done
sudo cp /tmp/rt.save /etc/nikki/mixin.yaml
exit $fail
