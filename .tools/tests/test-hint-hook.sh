#!/bin/bash
. "$(dirname "$0")/plattform.sh"
set -u; cd "$(dirname "$0")"; T=$(pwd); HOOK="$T/../adapters/claude-code/brain-hint.mjs"
export BRAIN_VAULT="$T/fixture" BRAIN_HINT_SEARCH_MODULE="$T/fake-search.mjs"
node ../brain-index.mjs "$BRAIN_VAULT" >/dev/null; rm -rf "$BRAIN_VAULT/.logs/hint-seen" "$BRAIN_VAULT/.logs/hint.log"
J=$(mktemp); echo '[{"file":"qmd://brain/10-projekte/alpha/notiz-a.md","score":0.6}]' > "$J"; export FAKE_JSON="$J"
run(){ printf '%s' "$1" | node "$HOOK"; }
P='{"prompt":"wie funktioniert das thema alpha genau","session_id":"s1"}'
OUT=$(run "$P"); echo "$OUT" | grep -q '09_wiki/thema_alpha.md' || { echo "FAIL: Rohquelle nicht auf Wiki-Seite geführt: [$OUT]"; exit 1; }
[ -z "$(run "$P")" ] || { echo "FAIL: Dedupe pro Session"; exit 1; }
S=$(date +%s); OUT=$(FAKE_HANG_AFTER=1 run '{"prompt":"wie funktioniert das thema alpha genau","session_id":"s1h"}'); D=$(( $(date +%s) - S ))
echo "$OUT" | grep -q thema_alpha && [ $D -le 3 ] || { echo "FAIL: Antwort da, aber Kind hängt beim Beenden → Hook wartet (${D}s, [$OUT])"; exit 1; }
A=$(mktemp); FAKE_ARGS="$A" run '{"prompt":"wie funktioniert das thema alpha genau","session_id":"s1b"}' >/dev/null
node -e "const a=JSON.parse(require('fs').readFileSync('$A','utf8')); if(a.collection!=='brainkarten'||a.limit<20) process.exit(1)" || { echo "FAIL: Hook fragt nicht brainkarten mit limit≥20 ($(cat "$A"))"; exit 1; }; rm -f "$A"
run '{"prompt":"wie funktioniert das thema alpha genau","session_id":"s2"}' | grep -q thema_alpha || { echo "FAIL: neue Session muss wieder melden"; exit 1; }
[ -z "$(run '{"prompt":"ok passt, weiter","session_id":"s3"}')" ] || { echo "FAIL: Kurzantwort nicht still"; exit 1; }
echo '[{"file":"qmd://brain/09-wiki/thema-alpha.md","score":0.2}]' > "$J"
[ -z "$(run '{"prompt":"wie funktioniert das thema alpha genau","session_id":"s4"}')" ] || { echo "FAIL: unter Schwelle nicht still"; exit 1; }
# Review Focus 1: riesiger Prompt mit Secret → nur 500 Zeichen an die Suche, kein Text im Log
A=$(mktemp); BIG=$(printf 'geheimestoken%.0s ' $(seq 1 5000))
FAKE_ARGS="$A" run "{\"prompt\":\"frage zum thema alpha $BIG\",\"session_id\":\"s5\"}" >/dev/null
node -e "const a=JSON.parse(require('fs').readFileSync('$A','utf8')); if(a.query.length>500) process.exit(1)" || { echo "FAIL: Anfrage nicht auf 500 Zeichen gekürzt"; exit 1; }; rm -f "$A"
grep -q geheimestoken "$BRAIN_VAULT/.logs/hint.log" && { echo "FAIL: Prompt-Text im Log"; exit 1; }
# Review Focus 2: Suche hängt / QMD fehlt / Suche wirft → still, Exit 0, Fehler geloggt
S=$(date +%s); OUT=$(FAKE_DELAY=10000 run '{"prompt":"wie funktioniert das thema alpha genau","session_id":"s6"}'); RC=$?; D=$(( $(date +%s) - S ))
[ $RC -eq 0 ] && [ -z "$OUT" ] && [ $D -le 6 ] || { echo "FAIL: hängende Suche (rc=$RC, ${D}s)"; exit 1; }
OUT=$(BRAIN_HINT_SEARCH_MODULE= QMD_MODULE=/gibt/es/nicht.js run '{"prompt":"wie funktioniert das thema alpha genau","session_id":"s7"}'); [ $? -eq 0 ] && [ -z "$OUT" ] || { echo "FAIL: fehlendes QMD"; exit 1; }
OUT=$(FAKE_THROW=SQLITE_BUSY run '{"prompt":"wie funktioniert das thema alpha genau","session_id":"s8"}'); [ $? -eq 0 ] && [ -z "$OUT" ] || { echo "FAIL: werfende Suche"; exit 1; }
[ -z "$(printf 'kaputt' | node "$HOOK")" ] || { echo "FAIL: kaputtes stdin"; exit 1; }
grep -q 'fehler=ETIMEDOUT' "$BRAIN_VAULT/.logs/hint.log" && grep -q 'fehler=SQLITE_BUSY' "$BRAIN_VAULT/.logs/hint.log" || { echo "FAIL: Fehler nicht geloggt"; exit 1; }
# Echter Adapter (falls QMD installiert): Exit-Code MUSS 0 sein — Claude Code übernimmt stdout nur bei Exit 0
if command -v qmd >/dev/null; then
  printf '%s' '{"prompt":"wie funktioniert das thema alpha genau","session_id":"s9"}' | BRAIN_HINT_SEARCH_MODULE= node "$HOOK" >/dev/null 2>&1
  RC=$?; [ $RC -eq 0 ] || { echo "FAIL: echter QMD-Adapter endet mit Exit $RC"; exit 1; }
fi
# Review Important 1: ECHTE gehaltene SQLite-Schreibsperre (wie während qmd embed) → Hook muss trotzdem
# innerhalb von timeoutMs (4 s) enden; synchrones busy-wait darf den Timeout nicht aushebeln.
if command -v qmd >/dev/null && command -v sqlite3 >/dev/null; then
  D=$(mktemp -d); cp "$HOME/.cache/qmd/index.sqlite" "$D/idx.sqlite"
  ( printf 'BEGIN IMMEDIATE;\nCREATE TABLE IF NOT EXISTS _sperre(x);\nINSERT INTO _sperre VALUES(1);\n'; sleep 9; printf 'ROLLBACK;\n' ) | sqlite3 "$D/idx.sqlite" & SP=$!
  sleep 1; S=$(python3 -c 'import time;print(time.time())')
  printf '%s' '{"prompt":"wie funktioniert das thema alpha genau","session_id":"s10"}' | BRAIN_HINT_SEARCH_MODULE= QMD_DB="$D/idx.sqlite" node "$HOOK" >/dev/null 2>&1; RC=$?
  D2=$(python3 -c "import time;print(round(time.time()-$S,1))"); kill $SP 2>/dev/null; wait $SP 2>/dev/null; rm -rf "$D"
  [ $RC -eq 0 ] && python3 -c "import sys; sys.exit(0 if $D2 < 4.6 else 1)" || { echo "FAIL: gesperrte DB — Hook brauchte ${D2}s (rc=$RC), Timeout 4 s greift nicht"; exit 1; }
fi
# Etappe 3.1: Eval-Sessions in eigenes Log, Alltag bleibt sauber; Ursachen-Felder
echo '[{"file":"qmd://brain/09-wiki/thema-alpha.md","score":0.6}]' > "$J"
rm -f "$BRAIN_VAULT/.logs/hint.log" "$BRAIN_VAULT/.logs/hint-eval-runs.log"
run '{"prompt":"wie funktioniert das thema alpha genau","session_id":"eval-1-1"}' >/dev/null
grep -q 'sid=eval-1-1' "$BRAIN_VAULT/.logs/hint-eval-runs.log" 2>/dev/null || { echo "FAIL: Eval-Zeile nicht im Eval-Log"; exit 1; }
[ ! -s "$BRAIN_VAULT/.logs/hint.log" ] || { echo "FAIL: Eval-Zeile im Alltagslog"; exit 1; }
run '{"prompt":"wie funktioniert das thema alpha genau","session_id":"alltag1"}' >/dev/null
grep -q 'sid=alltag1 .*unterdrueckt=0 kalt=1 refresh=0' "$BRAIN_VAULT/.logs/hint.log" || { echo "FAIL: Felder fehlen: $(cat "$BRAIN_VAULT/.logs/hint.log")"; exit 1; }
run '{"prompt":"wie funktioniert das thema alpha genau","session_id":"alltag1"}' >/dev/null
tail -1 "$BRAIN_VAULT/.logs/hint.log" | grep -q 'hits=- unterdrueckt=1 kalt=0' || { echo "FAIL: unterdrueckt/kalt falsch: $(tail -1 "$BRAIN_VAULT/.logs/hint.log")"; exit 1; }
touch "$BRAIN_VAULT/.logs/search-refresh.running"
run '{"prompt":"wie funktioniert das thema alpha genau","session_id":"alltag2"}' >/dev/null
tail -1 "$BRAIN_VAULT/.logs/hint.log" | grep -q 'refresh=1' || { echo "FAIL: refresh-Flag fehlt"; exit 1; }
rm -f "$BRAIN_VAULT/.logs/search-refresh.running"
FAKE_THROW=SQLITE_BUSY run '{"prompt":"wie funktioniert das thema alpha genau","session_id":"alltag3"}' >/dev/null
tail -1 "$BRAIN_VAULT/.logs/hint.log" | grep -q 'fehler=SQLITE_BUSY kalt=1 refresh=0' || { echo "FAIL: Fehlerzeile ohne Ursachen-Felder: $(tail -1 "$BRAIN_VAULT/.logs/hint.log")"; exit 1; }
# Rotation: > 2000 Zeilen → 1000
for i in $(seq 1 2100); do printf 'alt %0100d\n' "$i"; done > "$BRAIN_VAULT/.logs/hint.log"   # > 150 KB, damit die Größenprüfung greift
run '{"prompt":"wie funktioniert das thema alpha genau","session_id":"alltag4"}' >/dev/null
[ "$(wc -l < "$BRAIN_VAULT/.logs/hint.log")" -le 1001 ] || { echo "FAIL: hint.log nicht rotiert"; exit 1; }
ls "$BRAIN_VAULT/.logs/" | grep -q "hint.log.*tmp" && { echo "FAIL: Rotation hinterlässt tmp-Dateien"; exit 1; }
grep -q "renameSync" ../adapters/claude-code/brain-hint.mjs || { echo "FAIL: Rotation nicht atomar (tmp + rename)"; exit 1; }
# Review-Fix: veraltete Laufmarke (> 15 min, z. B. nach Absturz) zählt nicht; frühe Fehler melden kalt=-
touch -t 202001010000 "$BRAIN_VAULT/.logs/search-refresh.running"
run '{"prompt":"wie funktioniert das thema alpha genau","session_id":"alltag5"}' >/dev/null
tail -1 "$BRAIN_VAULT/.logs/hint.log" | grep -q 'refresh=0' || { echo "FAIL: veraltete Laufmarke zählt: $(tail -1 "$BRAIN_VAULT/.logs/hint.log")"; exit 1; }
rm -f "$BRAIN_VAULT/.logs/search-refresh.running"
mv "$BRAIN_VAULT/.logs/wiki-map.json" "$BRAIN_VAULT/.logs/wiki-map.bak"
run '{"prompt":"wie funktioniert das thema alpha genau","session_id":"alltag6"}' >/dev/null
mv "$BRAIN_VAULT/.logs/wiki-map.bak" "$BRAIN_VAULT/.logs/wiki-map.json"
tail -1 "$BRAIN_VAULT/.logs/hint.log" | grep -q 'fehler=.* kalt=- ' || { echo "FAIL: früher Fehler meldet kalt: $(tail -1 "$BRAIN_VAULT/.logs/hint.log")"; exit 1; }
# Etappe 3.3: Folgefrage nimmt die vorige User-Nachricht aus dem Transkript mit
TR=$(mktemp); printf '%s\n%s\n' '{"type":"user","message":{"content":"welche join fallen gibt es zwischen asin und sku"}}' '{"type":"user","message":{"content":"und beim zweiten account?"}}' > "$TR"
echo '[{"file":"qmd://brain/09-wiki/thema-alpha.md","score":0.6}]' > "$J"; A=$(mktemp)
FAKE_ARGS="$A" run "{\"prompt\":\"und beim zweiten account?\",\"session_id\":\"f1\",\"transcript_path\":\"$TR\"}" >/dev/null
grep -q 'join fallen' "$A" || { echo "FAIL: Folgefrage ohne vorige Nachricht: $(cat "$A")"; exit 1; }
FAKE_ARGS="$A" run '{"prompt":"und beim zweiten account?","session_id":"f2"}' >/dev/null
grep -q 'join fallen' "$A" && { echo "FAIL: ohne Transkript trotzdem Kontext"; exit 1; }
grep -q 'join fallen' "$BRAIN_VAULT/.logs/hint.log" && { echo "FAIL: Transkript-Text im Log"; exit 1; }
rm -f "$TR" "$A"
# Etappe 3.3: Suchdienst (Fake-QMD) mit Rückfall — braucht einen Unix-Socket unter $BRAIN_VAULT/.logs/;
# in einem tief verschachtelten Export-/Temp-Pfad kann der die macOS/Linux-Grenze (~100 Byte) sprengen
# (suchdienst.mjs verweigert dann bewusst mit fehler=SOCKPFAD) — dann SKIP statt FAIL für diesen Teil.
SOCKPFAD="$BRAIN_VAULT/.logs/suchdienst.sock"
if [ "$(printf '%s' "$SOCKPFAD" | wc -c | tr -d " ")" -gt 100 ]; then
  echo "SKIP: Suchdienst-Teil (Socket-Pfad zu lang: $(printf '%s' "$SOCKPFAD" | wc -c | tr -d " ") Byte)"
else
  export BRAIN_DIENST_LIB="$T/fake-qmd-lib.mjs" BRAIN_DIENST_IDLE_MS=20000
  # Windows (Git Bash) hat i. d. R. kein pkill/pgrep (procps fehlt) — Aufräumen dort ohne Prozesskill (best effort).
  DS="$BRAIN_VAULT/.logs/suchdienst.sock"; dstop(){ [ "${OS:-}" = "Windows_NT" ] || pkill -f "suchdienst.mjs $BRAIN_VAULT" 2>/dev/null; sleep 0.3; rm -f "$DS" "$BRAIN_VAULT/.logs/dienst-haengt" "$BRAIN_VAULT/.logs/dienst-start" "$BRAIN_VAULT/.logs/dienst-timeouts"; }
  dwarte(){ for i in $(seq 1 40); do [ -S "$DS" ] && return 0; sleep 0.1; done; return 1; }
  trap 'dstop' EXIT
  cp "$BRAIN_VAULT/brain.config.json" /tmp/brain-hint-cfg.bak
  cfg(){ node -e "const f='$BRAIN_VAULT/brain.config.json',c=JSON.parse(require('fs').readFileSync('/tmp/brain-hint-cfg.bak','utf8'));c.hinweis={...c.hinweis,...JSON.parse(process.argv[1])};require('fs').writeFileSync(f,JSON.stringify(c))" "$1"; }
  zurueck(){ cp /tmp/brain-hint-cfg.bak "$BRAIN_VAULT/brain.config.json"; }
  F=$(mktemp); echo '[{"filepath":"qmd://brainkarten/thema-alpha.md","score":0.33}]' > "$F"; export FAKE_DIENST_JSON="$F"
  echo '[{"file":"qmd://brain/09-wiki/thema-alpha.md","score":0.6}]' > "$J"
  cfg '{"rerankSchwelle":0.55,"dienstMs":2500}'
  # (a) Dienst läuft → Treffer über Reranker, obwohl Vektor-Score 0.33 unter Schwelle
  dstop; node ../suchdienst.mjs "$BRAIN_VAULT" & dwarte || { zurueck; echo "FAIL: Fake-Dienst startet nicht"; exit 1; }
  run '{"prompt":"wie funktioniert das thema alpha genau","session_id":"d1"}' | grep -q thema_alpha || { zurueck; echo "FAIL: kein Treffer über Dienst"; exit 1; }
  tail -1 "$BRAIN_VAULT/.logs/hint.log" | grep -q 'weg=dienst ' || { zurueck; echo "FAIL: Log ohne weg=dienst: $(tail -1 "$BRAIN_VAULT/.logs/hint.log")"; exit 1; }
  # (e) Reranker scheitert → Vektor-Scores aus dem Dienst entscheiden (weg=dienst-vektor, kein zweiter Kindprozess)
  dstop; echo '[{"filepath":"qmd://brainkarten/thema-alpha.md","score":0.6}]' > "$F"; FAKE_DIENST_RR_FEHLER=1 node ../suchdienst.mjs "$BRAIN_VAULT" & dwarte
  run '{"prompt":"wie funktioniert das thema alpha genau","session_id":"d5"}' | grep -q thema_alpha && tail -1 "$BRAIN_VAULT/.logs/hint.log" | grep -q 'weg=dienst-vektor' || { zurueck; echo "FAIL: Rerank-Fehler ohne dienst-vektor: $(tail -1 "$BRAIN_VAULT/.logs/hint.log")"; exit 1; }
  echo '[{"filepath":"qmd://brainkarten/thema-alpha.md","score":0.33}]' > "$F"
  # (b) Dienst fehlt → Vektor-Weg, Dienst wird im Hintergrund gestartet
  dstop; run '{"prompt":"wie funktioniert das thema alpha genau","session_id":"d2"}' | grep -q thema_alpha || { zurueck; echo "FAIL: kein Rückfall"; exit 1; }
  tail -1 "$BRAIN_VAULT/.logs/hint.log" | grep -q 'weg=vektor' || { zurueck; echo "FAIL: Rückfall nicht geloggt"; exit 1; }
  dwarte || { zurueck; echo "FAIL: Hook startet Dienst nicht"; exit 1; }
  # (c) Dienst hängt → Rückfall in Frist, Sperre gesetzt, nächste Frage fragt den Dienst nicht
  dstop; cfg '{"rerankSchwelle":0.55,"dienstMs":800}'; FAKE_DIENST_HAENGT=1 node ../suchdienst.mjs "$BRAIN_VAULT" & dwarte
  rm -f "$BRAIN_VAULT/.logs/dienst-timeouts"
  S0=$(date +%s); OUT=$(run '{"prompt":"wie funktioniert das thema alpha genau","session_id":"d3"}'); D0=$(( $(date +%s) - S0 ))
  echo "$OUT" | grep -q thema_alpha && [ $D0 -le 4 ] && [ ! -f "$BRAIN_VAULT/.logs/dienst-haengt" ] || { zurueck; echo "FAIL: erster Hänger (${D0}s) — Rückfall ja, Sperre noch nein"; exit 1; }
  if [ "${OS:-}" = "Windows_NT" ]; then echo "SKIP: pgrep-Prüfung (nach erstem Hänger noch aktiv) — kein pgrep unter Windows"; else
    pgrep -f "suchdienst.mjs $BRAIN_VAULT" >/dev/null || { zurueck; echo "FAIL: nach erstem Hänger schon beendet"; exit 1; }
  fi
  OUT=$(run '{"prompt":"wie funktioniert das thema alpha genau","session_id":"d3b"}')
  echo "$OUT" | grep -q thema_alpha && [ -f "$BRAIN_VAULT/.logs/dienst-haengt" ] || { zurueck; echo "FAIL: zweiter Hänger setzt keine Sperre"; exit 1; }
  if [ "${OS:-}" = "Windows_NT" ]; then echo "SKIP: pgrep-Prüfung (hängender Dienst beendet) — kein pgrep unter Windows"; else
    sleep 0.5; pgrep -f "suchdienst.mjs $BRAIN_VAULT" >/dev/null && { zurueck; echo "FAIL: hängender Dienst nicht beendet"; exit 1; }
  fi
  S0=$(date +%s); run '{"prompt":"wie funktioniert das thema alpha genau","session_id":"d4"}' >/dev/null; [ $(( $(date +%s) - S0 )) -le 1 ] && tail -1 "$BRAIN_VAULT/.logs/hint.log" | grep -q 'weg=vektor' || { zurueck; echo "FAIL: Sperre greift nicht"; exit 1; }
  if [ "${OS:-}" = "Windows_NT" ]; then echo "SKIP: pgrep-Prüfung (trotz Sperre nicht neu gestartet) — kein pgrep unter Windows"; else
    sleep 0.5; pgrep -f "suchdienst.mjs $BRAIN_VAULT" >/dev/null && { zurueck; echo "FAIL: trotz Sperre neu gestartet"; exit 1; }
  fi
  [ ! -e "$DS" ] || { zurueck; echo "FAIL: Socket-Leiche nach Hänger bleibt"; exit 1; }
  # (f) Kein Dienst (oder noch am Aufwärmen) → Rückfall rerankt selbst: auch der erste Prompt ist sauber
  dstop; cfg '{"rerankSchwelle":0.55,"dienstMs":2500}'; touch "$BRAIN_VAULT/.logs/dienst-start"   # Start gedrosselt → kein Dienst
  echo '[{"file":"qmd://brainkarten/thema-alpha.md","score":0.33}]' > "$J"
  FAKE_RR=0.73 run '{"prompt":"wie funktioniert das thema alpha genau","session_id":"k1"}' | grep -q thema_alpha && tail -1 "$BRAIN_VAULT/.logs/hint.log" | grep -q 'weg=kalt-rerank' || { zurueck; echo "FAIL: kein Kaltstart-Rerank: $(tail -1 "$BRAIN_VAULT/.logs/hint.log")"; exit 1; }
  FAKE_RR=0.50 run '{"prompt":"wie funktioniert das thema alpha genau","session_id":"k2"}' | grep -q thema_alpha && { zurueck; echo "FAIL: Kaltstart-Rerank lässt Fremdfrage durch"; exit 1; }
  echo '[{"file":"qmd://brain/09-wiki/thema-alpha.md","score":0.6}]' > "$J"
  # (d) Schalter aus → nie Dienst
  dstop; zurueck; node ../suchdienst.mjs "$BRAIN_VAULT" & dwarte
  run '{"prompt":"wie funktioniert das thema alpha genau","session_id":"d6"}' >/dev/null; tail -1 "$BRAIN_VAULT/.logs/hint.log" | grep -q 'weg=vektor' || { echo "FAIL: ohne rerankSchwelle trotzdem Dienst"; exit 1; }
  dstop; unset BRAIN_DIENST_LIB FAKE_DIENST_JSON; rm -f "$F"
fi
rm -rf "$BRAIN_VAULT/.logs"; rm -f "$J"; echo "PASS"
