#!/bin/bash
. "$(dirname "$0")/plattform.sh"
# search-refresh.mjs läuft nur, wenn sich seit dem letzten erfolgreichen Refresh eine Notiz geändert hat
# (sonst konkurriert der SessionStart-Refresh mit dem Hinweis-Hook um CPU/DB → Timeouts).
set -u; cd "$(dirname "$0")"; T="$(pwd)"; R="$T/../search-refresh.mjs"
V=$(mktemp -d); mkdir -p "$V/.logs/hint-karten" "$V/20_firma"; echo "# a" > "$V/20_firma/a.md"
CALLS=$(mktemp)
echo '{"hinweis":{"suche":"vektor"}}' > "$V/brain.config.json"   # Standard ist BM25 (ohne Karten-Embeddings) — hier die Vektor-Einstellung
# Fake-QMD als .mjs: search-refresh.mjs startet .mjs-QMD_BIN-Werte über process.execPath (node) — läuft so
# auf allen drei Plattformen ohne shell:true (Windows kann .cmd/.bat ohne shell:true nicht direkt spawnen).
QMD_BIN="$T/fake-qmd-cli.mjs"
export BRAIN_VAULT="$V" QMD_BIN FAKE_QMD_CALLS="$CALLS"
node "$R"; [ -s "$CALLS" ] && [ -f "$V/.logs/search-refreshed" ] || { echo "FAIL: erster Lauf muss indexieren + Stempel setzen"; exit 1; }
: > "$CALLS"; node "$R"; [ ! -s "$CALLS" ] || { echo "FAIL: ohne Änderung darf nicht neu indexiert werden ($(cat "$CALLS"))"; exit 1; }
sleep 1; echo "# neu" > "$V/.logs/hint-karten/thema_x.md"; node "$R"; grep -q 'embed -c brainkarten' "$CALLS" || { echo "FAIL: geänderte Karteikarte nicht eingebettet"; exit 1; }
: > "$CALLS"; sleep 1; echo "# b" > "$V/20_firma/b.md"; node "$R"; grep -q '^update' "$CALLS" || { echo "FAIL: neue Notiz nicht indexiert"; exit 1; }
[ ! -e "$V/.logs/search-refresh.running" ] || { echo "FAIL: Laufmarke bleibt liegen"; exit 1; }
export FAKE_QMD_MARKE_FILE="$V/.logs/search-refresh.running"; : > "$CALLS"
sleep 1; echo "# c" > "$V/20_firma/c.md"; node "$R"; grep -q MARKE "$CALLS" || { echo "FAIL: Laufmarke fehlt während Indexierung"; exit 1; }
# Aufwärmen nur, wenn nichts zu indexieren ist (sonst konkurriert es mit embed)
WA=$(mktemp); FJ=$(mktemp); echo '[]' > "$FJ"
export BRAIN_HINT_SEARCH_MODULE="$(pwd)/fake-search.mjs" FAKE_JSON="$FJ" FAKE_ARGS="$WA"
: > "$WA"; node "$R"; grep -q '"collection":"brainkarten"' "$WA" || { echo "FAIL: ohne Änderung kein Aufwärmen"; exit 1; }
: > "$WA"; sleep 1; echo "# d" > "$V/20_firma/d.md"; node "$R"; [ ! -s "$WA" ] || { echo "FAIL: Aufwärmen während Indexierung"; exit 1; }
unset BRAIN_HINT_SEARCH_MODULE FAKE_JSON FAKE_ARGS; rm -f "$WA" "$FJ"
# Standard (BM25): keine Karten-Sammlung, keine Karten-Embeddings, kein Aufwärmen der Vektorsuche
unset FAKE_QMD_MARKE_FILE; echo '{}' > "$V/brain.config.json"; : > "$CALLS"; sleep 1; echo "# e" > "$V/20_firma/e.md"; node "$R"
grep -q '^update' "$CALLS" && ! grep -q 'brainkarten' "$CALLS" || { echo "FAIL: BM25-Standard fasst brainkarten an ($(cat "$CALLS"))"; exit 1; }
WA=$(mktemp); : > "$WA"; export BRAIN_HINT_SEARCH_MODULE=; FAKE_ARGS="$WA" node ../hint-warm.mjs; [ ! -s "$WA" ] || { echo "FAIL: BM25-Standard wärmt die Vektorsuche auf"; exit 1; }
rm -f "$WA"
rm -rf "$V" "$CALLS"; echo "PASS"
