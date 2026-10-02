#!/bin/bash
. "$(dirname "$0")/plattform.sh"
# Karten-Tor: meldet, bei welchen Negativ-/Kontrollfragen eine neue Karte anschlagen würde (Dienst oder Vektor-Rückfall).
set -u; cd "$(dirname "$0")"; T="$(pwd)"; K="$T/../karten-tor.mjs"
export BRAIN_VAULT="$T/fixture"; node ../brain-index.mjs "$BRAIN_VAULT" >/dev/null
E=$(mktemp); echo '{"negativ":["mach einen pull request auf"],"kontrolle_negativ":["erkläre mir diesen regex"]}' > "$E"; export BRAIN_EVAL_DATEI="$E"
J=$(mktemp); export FAKE_JSON="$J" BRAIN_HINT_SEARCH_MODULE="$T/fake-search.mjs"
# Windows (Git Bash) hat i. d. R. kein pkill (procps fehlt) — Aufräumen dort ohne Prozesskill (best effort).
# Sicherung der Fixture-Config in einer eigenen Temp-Datei (kein festes /tmp/…: parallele Suiten würden kollidieren)
KB=$(mktemp)
trap '[ "${OS:-}" = "Windows_NT" ] || pkill -f "suchdienst.mjs $BRAIN_VAULT" 2>/dev/null; rm -f "$E" "$J" "$BRAIN_VAULT/.logs/suchdienst.sock"; cp "$KB" "$BRAIN_VAULT/brain.config.json" 2>/dev/null; rm -f "$KB"' EXIT
cp "$BRAIN_VAULT/brain.config.json" "$KB"
# Vektor-Weg (Schalter aus)
echo '[{"file":"qmd://brainkarten/thema-alpha.md","score":0.6}]' > "$J"
node "$K" thema_alpha.md | grep -c 'KARTEN-TOR: thema_alpha.md schlägt an' | grep -q '^2$' || { echo "FAIL: Vektor-Weg meldet nicht beide Fragen: $(node "$K" thema_alpha.md)"; exit 1; }
echo '[{"file":"qmd://brainkarten/thema-alpha.md","score":0.2}]' > "$J"
[ -z "$(node "$K" thema_alpha.md)" ] || { echo "FAIL: Fehlalarm unter Schwelle"; exit 1; }
node "$K" thema_gibtsnicht.md | grep -q KARTEN-TOR && { echo "FAIL: fremde Karte gemeldet"; exit 1; }
# Suche kaputt → „nicht prüfbar" statt stiller Entwarnung
FAKE_THROW=SQLITE_BUSY node "$K" thema_alpha.md | grep -q 'KARTEN-TOR: nicht prüfbar' || { echo "FAIL: kaputte Suche wird verschwiegen"; exit 1; }
# Dienst-Weg (Schalter an, Fake-Dienst liefert rr 0.73) — braucht einen Unix-Socket unter
# $BRAIN_VAULT/.logs/; in einem tief verschachtelten Export-/Temp-Pfad kann der die macOS/Linux-Grenze
# (~100 Byte) sprengen (suchdienst.mjs verweigert dann bewusst mit fehler=SOCKPFAD) — dann SKIP statt FAIL.
SOCKPFAD="$BRAIN_VAULT/.logs/suchdienst.sock"
if [ "${OS:-}" = "Windows_NT" ]; then
  echo "SKIP: Dienst-Weg (Suchdienst unter Windows erst ab v0.3)"
  echo "PASS"
  exit 0
fi
if [ "$(printf '%s' "$SOCKPFAD" | wc -c | tr -d " ")" -gt 100 ]; then
  echo "SKIP: Dienst-Weg (Socket-Pfad zu lang: $(printf '%s' "$SOCKPFAD" | wc -c | tr -d " ") Byte)"
  echo "PASS"
  exit 0
fi
node -e "const f='$BRAIN_VAULT/brain.config.json',c=JSON.parse(require('fs').readFileSync(f,'utf8'));c.hinweis={...c.hinweis,rerankSchwelle:0.55};require('fs').writeFileSync(f,JSON.stringify(c))"
export BRAIN_DIENST_LIB="$T/fake-qmd-lib.mjs" BRAIN_DIENST_IDLE_MS=15000
node ../suchdienst.mjs "$BRAIN_VAULT" & for i in $(seq 1 40); do [ -S "$BRAIN_VAULT/.logs/suchdienst.sock" ] && break; sleep 0.1; done
node "$K" thema_alpha.md | grep -q 'KARTEN-TOR: thema_alpha.md schlägt an bei „mach einen pull request auf" (rr 0.73)' || { echo "FAIL: Dienst-Weg: $(node "$K" thema_alpha.md)"; exit 1; }
echo "PASS"
