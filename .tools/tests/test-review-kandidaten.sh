#!/bin/bash
. "$(dirname "$0")/plattform.sh"
# review-kandidaten: geänderte Seiten seit Marker (sonst 30 Tage), Nachbarn aus graph.json, Feedback, Zahl verpasster Hinweise.
set -u; cd "$(dirname "$0")"; K="$(pwd)/../review-kandidaten.mjs"
V=$(mktemp -d /tmp/rkXXXX); trap 'rm -rf "$V"' EXIT
mkdir -p "$V/09_wiki/firma/x" "$V/.logs"; cp fixture/brain.config.json "$V/"
for n in a b c; do printf -- '---\nname: %s\ndescription: %s\ntyp: thema\nrev: 1\n---\n# %s\n' $n $n $n > "$V/09_wiki/firma/x/thema_$n.md"; done
g(){ git -C "$V" -c user.email=t@t -c user.name=t "$@"; }
g init -q; g add -- 09_wiki/firma/x/thema_c.md; GIT_COMMITTER_DATE="2026-01-01T10:00:00" g commit -qm alt
g add -- 09_wiki/firma/x/thema_a.md 09_wiki/firma/x/thema_b.md; g commit -qm neu
echo '{"nodes":[],"edges":[{"source":"09_wiki/firma/x/thema_a.md","target":"09_wiki/firma/x/thema_c.md"}]}' > "$V/graph.json"
printf '%s\n' "2099-01-01T10:00:00 art=fehlte seite=- notiz=asin fallen" > "$V/.logs/feedback.log"
printf '%s\n' "2099-01-01T10:00:00 sid=x len=40 weg=dienst top=0.5 hits=- unterdrueckt=0 kalt=0 refresh=0 ms=300" "2099-01-01T10:00:01 sid=x len=40 weg=dienst top=0.7 hits=09_wiki/a.md unterdrueckt=0 kalt=0 refresh=0 ms=300" > "$V/.logs/hint.log"
OUT=$(node "$K" "$V")
node -e "const r=JSON.parse(process.argv[1]); const s=r.seiten.join(); if(!s.includes('thema_a.md')||!s.includes('thema_b.md')||s.includes('thema_c.md')) process.exit(1); if(!r.nachbarn.join().includes('thema_c.md')) process.exit(2); if(r.feedback.length!==1||!r.feedback[0].includes('art=fehlte')) process.exit(3); if(r.hinweisOhneTreffer!==1) process.exit(4); if(!r.seit) process.exit(5)" "$OUT" || { echo "FAIL: Kandidaten falsch ($?): $OUT"; exit 1; }
echo "$OUT" | grep -q 'asin fallen' || { echo "FAIL: Feedback-Notiz fehlt"; exit 1; }
echo "PASS"
