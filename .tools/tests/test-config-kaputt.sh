#!/bin/bash
. "$(dirname "$0")/plattform.sh"
# brain.config.json kaputt (ungültiges JSON): ladeConfig() liefert dafür still {} (Defaults) — das muss
# dem User trotzdem gemeldet werden. lint meldet CONFIG und blockiert (auch --struktur → pre-commit),
# session-start informiert klartextlich (bleibt Exit 0, kein Abbruch), wiki-guard crasht auf einem
# Nicht-Wiki-Pfad nicht (kein Stacktrace, Exit 0).
set -u; D="$(cd "$(dirname "$0")" && pwd)"; V="$(mktemp -d)/v"; cp -R "$D/fixture" "$V"
echo '{ kaputt' > "$V/brain.config.json"

OUT=$(node "$D/../brain-lint.mjs" "$V" 2>/dev/null); RC=$?
echo "$OUT" | grep -q 'CONFIG: brain.config.json ist kein gültiges JSON' || { echo "FAIL: CONFIG-Fund fehlt (normal): $OUT"; exit 1; }
[ $RC -eq 2 ] || { echo "FAIL: normal-Modus blockiert nicht (rc=$RC)"; exit 1; }

OUT=$(node "$D/../brain-lint.mjs" "$V" --struktur 2>/dev/null); RC=$?
echo "$OUT" | grep -q 'CONFIG: brain.config.json ist kein gültiges JSON' || { echo "FAIL: CONFIG-Fund fehlt (struktur): $OUT"; exit 1; }
[ $RC -eq 2 ] || { echo "FAIL: struktur-Modus blockiert nicht (rc=$RC)"; exit 1; }

OUT=$(BRAIN_VAULT="$V" BRAIN_SESSION_NUR_STATUS=1 node "$D/../adapters/claude-code/session-start.mjs"); RC=$?
echo "$OUT" | grep -q 'Brain: Die Einstellungsdatei brain.config.json ist beschädigt' || { echo "FAIL: session-start meldet kaputte Config nicht: $OUT"; exit 1; }
[ $RC -eq 0 ] || { echo "FAIL: session-start bricht ab (rc=$RC)"; exit 1; }

ERR=$(mktemp)
printf '{"tool_name":"Edit","cwd":"/","tool_input":{"file_path":"%s/00_inbox/x.md"}}' "$V" | BRAIN_VAULT="$V" node "$D/../adapters/claude-code/wiki-guard.mjs" 2>"$ERR"; RC=$?
[ $RC -eq 0 ] || { echo "FAIL: wiki-guard blockiert Nicht-Wiki-Pfad (rc=$RC): $(cat "$ERR")"; rm -f "$ERR"; exit 1; }
grep -qiE 'at |stack|typeerror|syntaxerror' "$ERR" && { echo "FAIL: wiki-guard wirft Stacktrace: $(cat "$ERR")"; rm -f "$ERR"; exit 1; }
rm -f "$ERR"

rm -rf "$(dirname "$V")"
echo "PASS"
