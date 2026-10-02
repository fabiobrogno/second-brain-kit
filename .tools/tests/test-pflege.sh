#!/bin/bash
# Pflege-Signale: VERFALL (git-Datum), LOG-LANG, REVIEW/FEEDBACK im Lint; SessionStart-Sammelzeile (nur Status-Modus, kein Push).
set -u; cd "$(dirname "$0")"; T="$(pwd)"
V=$(mktemp -d /tmp/pfXXXX); trap 'rm -rf "$V"' EXIT
mkdir -p "$V/09_wiki/firma/x" "$V/.logs"; cp fixture/brain.config.json "$V/"
printf -- '---\nname: a\ndescription: a\ntyp: thema\nquellen: []\nquellen_sha: []\nverfall: 30\nrev: 1\n---\n# A\n\n[[thema_b]]\n' > "$V/09_wiki/firma/x/thema_a.md"
printf -- '---\nname: b\ndescription: b\ntyp: thema\nquellen: []\nquellen_sha: []\nrev: 1\n---\n# B\n\n[[thema_a]]\n' > "$V/09_wiki/firma/x/thema_b.md"
( for i in $(seq 1 520); do echo "zeile $i"; done ) > "$V/09_wiki/_log.md"
git -C "$V" init -q; git -C "$V" add -- 09_wiki brain.config.json
GIT_COMMITTER_DATE="2026-01-01T10:00:00" GIT_AUTHOR_DATE="2026-01-01T10:00:00" git -C "$V" -c user.email=t@t -c user.name=t commit -qm alt
L(){ node ../brain-lint.mjs "$V" 2>/dev/null || true; }
L | grep -q 'VERFALL: firma/x/thema_a.md' || { echo "FAIL: VERFALL fehlt: $(L)"; exit 1; }
L | grep -q 'VERFALL: firma/x/thema_b.md' && { echo "FAIL: Seite ohne verfall gemeldet"; exit 1; }
L | grep -q 'LOG-LANG' || { echo "FAIL: LOG-LANG fehlt"; exit 1; }
L | grep -q 'REVIEW fällig' || { echo "FAIL: REVIEW ohne Marker nicht gemeldet"; exit 1; }
date +%F > "$V/.logs/letzter-review"; L | grep -q 'REVIEW fällig' && { echo "FAIL: frischer Marker trotzdem REVIEW"; exit 1; }
sleep 1; echo "$(date '+%Y-%m-%dT%H:%M:%S') art=fehlte seite=- notiz=x" >> "$V/.logs/feedback.log"
L | grep -q 'FEEDBACK: 1 offene' || { echo "FAIL: FEEDBACK fehlt"; exit 1; }
# SessionStart im Status-Modus: genau eine Sammelzeile, kein Hintergrund (kein Push)
OUT=$(BRAIN_VAULT="$V" BRAIN_SESSION_NUR_STATUS=1 node ../adapters/claude-code/session-start.mjs)
echo "$OUT" | grep -q '1 offene Rückmeldung' && [ "$(echo "$OUT" | grep -c 'brain-review')" = "1" ] || { echo "FAIL: SessionStart-Zeile: [$OUT]"; exit 1; }
rm -f "$V/.logs/feedback.log"; OUT=$(BRAIN_VAULT="$V" BRAIN_SESSION_NUR_STATUS=1 node ../adapters/claude-code/session-start.mjs)
[ -z "$OUT" ] || { echo "FAIL: SessionStart ohne Anlass nicht still: [$OUT]"; exit 1; }
touch -t 202601010000 "$V/.logs/letzter-review"; OUT=$(BRAIN_VAULT="$V" BRAIN_SESSION_NUR_STATUS=1 node ../adapters/claude-code/session-start.mjs)
echo "$OUT" | grep -q 'Review fällig' || { echo "FAIL: SessionStart meldet fälligen Review nicht: [$OUT]"; exit 1; }
echo "PASS"
