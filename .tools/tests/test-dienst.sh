#!/bin/bash
. "$(dirname "$0")/plattform.sh"
# .tools/tests/test-dienst.sh — Ansicht-Dienst als echter Prozess: „brain zeig“ startet ihn (oder nutzt den
# laufenden wieder), /api braucht den Token, data.js wird nie ausgeliefert, --stopp und Leerlauf beenden ihn,
# ein gescheiterter Start fällt auf die file://-Ansicht zurück. Nie ein echter Browser (BRAIN_OEFFNER).
# Jeder gestartete Dienst wird am Ende sicher beendet (trap), es bleibt kein Hintergrundprozess übrig.
set -u; D="$(cd "$(dirname "$0")" && pwd)"; B="$D/../brain.mjs"
T="$(mktemp -d)"; V="$T/Mein Brain, Ü's"; cp -R "$D/fixture" "$V"
mkdir -p "$T/home"; export HOME="$T/home" USERPROFILE="$T/home"
export BRAIN_OEFFNER="$(node -p process.execPath)"   # „öffnet“ mit node selbst — garantiert kein Browser
unset BRAIN_DIENST_AUS BRAIN_DIENST_LEERLAUF_MS BRAIN_DIENST_RUHE_MS
export BRAIN_UPDATE_QUELLE="$T/kein-update.json"          # doctor: Update-Prüfung lokal, kein Netz
mit_tools() { mkdir -p "$1/.tools"; for e in "$D/.."/* "$D/.."/.[!.]*; do [ -e "$e" ] || continue; [ "$(basename "$e")" = tests ] && continue; cp -R "$e" "$1/.tools/"; done; }
mit_tools "$V"
DJ="$V/.logs/ansicht/dienst.json"

# Feld aus dienst.json (leer, wenn die Datei fehlt)
feld() { node -e 'try{const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.stdout.write(String(j[process.argv[2]]??""))}catch{}' "$1" "$2"; }
lebt() { node -e 'try{process.kill(Number(process.argv[1]),0)}catch{process.exit(1)}' "$1"; }
PIDS=""
aufraeumen() {
  for p in $PIDS $(feld "$DJ" pid); do [ -n "$p" ] && node -e 'try{process.kill(Number(process.argv[1]))}catch{}' "$p"; done
  rm -rf "$T"
}
trap aufraeumen EXIT
# HTTP-Anfrage per node:http (überall vorhanden, unabhängig von curl): druckt "<status> <körper>"
hole() { # hole <port> <pfad> [token] [methode] — <pfad> ist ein URL-Pfad, kein Dateipfad: nie umschreiben lassen
  ohne_pfadumbau node -e '
    const [port, pfad, token, methode] = process.argv.slice(1);
    const h = {}; if (token) h["X-Brain-Token"] = token;
    if (methode && methode !== "GET") h.Origin = "http://127.0.0.1:" + port;
    const r = require("http").request({ host: "127.0.0.1", port: Number(port), path: pfad, method: methode || "GET", headers: h }, (res) => {
      let b = ""; res.setEncoding("utf8"); res.on("data", (d) => b += d); res.on("end", () => process.stdout.write(res.statusCode + " " + b));
    });
    r.on("error", () => process.stdout.write("000 "));
    r.setTimeout(3000, () => r.destroy()); r.end();' "$1" "$2" "${3:-}" "${4:-}"
}
# Bis zu ~6 s warten, bis <bedingung> wahr ist
warte_bis() { for _ in $(seq 1 30); do eval "$1" && return 0; node -e 'setTimeout(()=>{},200)'; done; return 1; }

# 1) Erster Aufruf startet den Dienst
RC=0; OUT=$(BRAIN_VAULT="$V" node "$B" zeig 2>&1) || RC=$?
[ "$RC" = 0 ] || { echo "FAIL: zeig rc=$RC: $OUT"; exit 1; }
echo "$OUT" | grep -q 'http://127.0.0.1:' || { echo "FAIL: Ausgabe ohne http://127.0.0.1:: $OUT"; exit 1; }
[ -f "$DJ" ] || { echo "FAIL: dienst.json fehlt"; exit 1; }
PORT=$(feld "$DJ" port); PID=$(feld "$DJ" pid); SCHLUESSEL=$(feld "$DJ" token); PIDS="$PIDS $PID"
echo "$SCHLUESSEL" | grep -Eq '^[0-9a-f]{64}$' || { echo "FAIL: Token nicht 64 hex: $SCHLUESSEL"; exit 1; }
[ -n "$(feld "$DJ" vaultId)" ] && [ -n "$(feld "$DJ" start)" ] || { echo "FAIL: dienst.json unvollständig"; exit 1; }
echo "$OUT" | grep -q "$SCHLUESSEL" && { echo "FAIL: Token steht in der Ausgabe (soll nur im geöffneten Fragment stehen): $OUT"; exit 1; }
lebt "$PID" || { echo "FAIL: Dienst-Prozess $PID läuft nicht"; exit 1; }

# 2) Zweiter Aufruf nutzt ihn wieder (gleicher Port, gleiche PID)
RC=0; OUT2=$(BRAIN_VAULT="$V" node "$B" zeig 2>&1) || RC=$?
[ "$RC" = 0 ] || { echo "FAIL: zweites zeig rc=$RC: $OUT2"; exit 1; }
[ "$(feld "$DJ" port)" = "$PORT" ] && [ "$(feld "$DJ" pid)" = "$PID" ] || { echo "FAIL: zweites zeig hat neuen Dienst gestartet"; exit 1; }
echo "$OUT2" | grep -q "http://127.0.0.1:$PORT" || { echo "FAIL: zweites zeig nennt anderen Port: $OUT2"; exit 1; }

# 3) API: mit Token → JSON mit nodes; ohne Token → 403; data.js → 404; Startseite → 200
R=$(hole "$PORT" /api/daten "$SCHLUESSEL"); case "$R" in "200 "*'"nodes"'*) ;; *) echo "FAIL: /api/daten mit Schlüssel → ${R:0:200}"; exit 1;; esac
R=$(hole "$PORT" /api/daten); case "$R" in "403 "*) ;; *) echo "FAIL: /api/daten ohne Schlüssel → ${R:0:200}"; exit 1;; esac
R=$(hole "$PORT" /data.js); case "$R" in "404 "*) ;; *) echo "FAIL: /data.js: ${R:0:200}"; exit 1;; esac
R=$(hole "$PORT" /../../.logs/ansicht/data.js); case "$R" in "404 "*) ;; *) echo "FAIL: Ausbruch zu data.js: ${R:0:200}"; exit 1;; esac
R=$(hole "$PORT" /); case "$R" in "200 "*"<html"*) ;; *) echo "FAIL: Startseite: ${R:0:200}"; exit 1;; esac
R=$(hole "$PORT" /api/ping "$SCHLUESSEL"); case "$R" in "200 "*'"vaultId"'*) ;; *) echo "FAIL: ping: ${R:0:200}"; exit 1;; esac
# Fehlende Module paralleler Tasks → 503 statt Absturz (solange analyse.mjs fehlt)
if [ ! -f "$V/.tools/analyse.mjs" ]; then
  R=$(hole "$PORT" /api/analyse "$SCHLUESSEL"); case "$R" in "503 "*) ;; *) echo "FAIL: /api/analyse ohne Modul: ${R:0:200}"; exit 1;; esac
fi
R=$(hole "$PORT" /api/einstellungen "$SCHLUESSEL"); case "$R" in "200 "*'"werte"'*'"claudeGefunden"'*) ;; *) echo "FAIL: /api/einstellungen: ${R:0:200}"; exit 1;; esac
# Final-Review #1: PUT ichKarte → AGENTS.md im Vault enthält bzw. verliert den Ich-Karten-Satz
setze_ich() { # setze_ich true|false → druckt den HTTP-Status
  node -e '
    const [port, token, wert] = process.argv.slice(1), http = require("http");
    const anfrage = (methode, koerper) => new Promise((ok) => {
      const h = { "X-Brain-Token": token, Origin: "http://127.0.0.1:" + port, "Content-Type": "application/json" };
      const r = http.request({ host: "127.0.0.1", port: Number(port), path: "/api/einstellungen", method: methode, headers: h }, (res) => {
        let b = ""; res.setEncoding("utf8"); res.on("data", (d) => b += d); res.on("end", () => ok({ status: res.statusCode, b }));
      });
      r.on("error", () => ok({ status: 0, b: "" })); r.end(koerper);
    });
    (async () => {
      const { stand } = JSON.parse((await anfrage("GET")).b);
      process.stdout.write(String((await anfrage("PUT", JSON.stringify({ werte: { ichKarte: wert === "true" }, stand }))).status));
    })();' "$PORT" "$SCHLUESSEL" "$1"
}
[ "$(setze_ich true)" = 200 ] || { echo "FAIL: PUT ichKarte=true"; exit 1; }
grep -q 'Lies zuerst' "$V/AGENTS.md" 2>/dev/null || { echo "FAIL: AGENTS.md ohne Ich-Karten-Satz nach PUT"; exit 1; }
[ "$(setze_ich false)" = 200 ] || { echo "FAIL: PUT ichKarte=false"; exit 1; }
grep -q 'Lies zuerst' "$V/AGENTS.md" && { echo "FAIL: Ich-Karten-Satz nach PUT false noch da"; exit 1; }
lebt "$PID" || { echo "FAIL: Dienst nach den Anfragen abgestürzt"; exit 1; }

# 4) doctor meldet „läuft (Port n)“
OUT=$(BRAIN_VAULT="$V" node "$V/.tools/doctor.mjs" "$V" 2>&1)
echo "$OUT" | grep -qF "OK Ansicht-Dienst — läuft (Port $PORT)" || { echo "FAIL: doctor-Zeile (läuft) fehlt: $OUT"; exit 1; }

# 5) zeig --stopp → Prozess weg, dienst.json weg
RC=0; OUT=$(BRAIN_VAULT="$V" node "$B" zeig --stopp 2>&1) || RC=$?
[ "$RC" = 0 ] || { echo "FAIL: zeig --stopp rc=$RC: $OUT"; exit 1; }
warte_bis "! lebt $PID" || { echo "FAIL: Dienst läuft nach --stopp weiter"; exit 1; }
[ -f "$DJ" ] && { echo "FAIL: dienst.json nach --stopp noch da"; exit 1; }
OUT=$(BRAIN_VAULT="$V" node "$V/.tools/doctor.mjs" "$V" 2>&1)
echo "$OUT" | grep -qF "OK Ansicht-Dienst — aus (startet bei ‚zeig mir mein Brain‘)" || { echo "FAIL: doctor-Zeile (aus) fehlt: $OUT"; exit 1; }
# --stopp ohne laufenden Dienst: freundlich, Exit 0
RC=0; OUT=$(BRAIN_VAULT="$V" node "$B" zeig --stopp 2>&1) || RC=$?
[ "$RC" = 0 ] || { echo "FAIL: zweites --stopp rc=$RC: $OUT"; exit 1; }

# 6) Leerlauf: Dienst beendet sich selbst und räumt dienst.json auf
RC=0; OUT=$(BRAIN_DIENST_LEERLAUF_MS=1500 BRAIN_VAULT="$V" node "$B" zeig 2>&1) || RC=$?
[ "$RC" = 0 ] || { echo "FAIL: zeig (Leerlauf) rc=$RC: $OUT"; exit 1; }
PID=$(feld "$DJ" pid); PIDS="$PIDS $PID"
[ -n "$PID" ] || { echo "FAIL: kein Dienst für den Leerlauf-Test: $OUT"; exit 1; }
warte_bis "! lebt $PID" || { echo "FAIL: Dienst hat sich nach Leerlauf nicht beendet"; exit 1; }
warte_bis "[ ! -f \"$DJ\" ]" || { echo "FAIL: dienst.json nach Leerlauf noch da"; exit 1; }

# 7) Veraltete dienst.json (Prozess längst weg) → neuer Dienst statt Hänger
printf '{"port":1,"pid":999999,"token":"%s","vaultId":"x","start":"2026-01-01T00:00:00Z"}' "$(printf 'a%.0s' $(seq 1 64))" > "$DJ"
RC=0; OUT=$(BRAIN_VAULT="$V" node "$B" zeig 2>&1) || RC=$?
[ "$RC" = 0 ] || { echo "FAIL: zeig mit veralteter dienst.json rc=$RC: $OUT"; exit 1; }
PID=$(feld "$DJ" pid); PIDS="$PIDS $PID"
[ "$(feld "$DJ" port)" != 1 ] || { echo "FAIL: veraltete dienst.json nicht ersetzt"; exit 1; }
RC=0; BRAIN_VAULT="$V" node "$B" zeig --stopp >/dev/null 2>&1 || RC=$?
warte_bis "! lebt $PID" || { echo "FAIL: Dienst (veraltet-Test) läuft nach --stopp weiter"; exit 1; }

# 7b) Zwei gleichzeitige zeig → genau EIN Dienst (Start-Lock), beide nennen denselben Port
A_OUT="$T/zeig-a.txt"; B_OUT="$T/zeig-b.txt"
( BRAIN_VAULT="$V" node "$B" zeig >"$A_OUT" 2>&1 ) & PA=$!
( BRAIN_VAULT="$V" node "$B" zeig >"$B_OUT" 2>&1 ) & PB=$!
wait $PA; wait $PB
PID=$(feld "$DJ" pid); PORT=$(feld "$DJ" port); SCHLUESSEL=$(feld "$DJ" token); PIDS="$PIDS $PID"
grep -q "http://127.0.0.1:$PORT/" "$A_OUT" && grep -q "http://127.0.0.1:$PORT/" "$B_OUT" || { echo "FAIL: parallele zeig nennen verschiedene Dienste: $(cat "$A_OUT" "$B_OUT")"; exit 1; }
[ ! -f "$V/.logs/ansicht/dienst.lock" ] || { echo "FAIL: Start-Lock liegt nach dem Start noch da"; exit 1; }

# 7c) Ein zweiter, direkt gestarteter dienst.mjs merkt den laufenden Dienst und beendet sich ohne „bereit“
RC=0; OUT=$(node "$V/.tools/ansicht/dienst.mjs" "$V" 2>&1) || RC=$?
[ "$RC" = 0 ] && [ -z "$OUT" ] || { echo "FAIL: überzähliger Dienst rc=$RC: $OUT"; exit 1; }
[ "$(feld "$DJ" pid)" = "$PID" ] && lebt "$PID" || { echo "FAIL: laufender Dienst wurde verdrängt"; exit 1; }

# 7d) Öffnen scheitert → Adresse OHNE Schlüssel, Hinweis auf dienst.json
RC=0; OUT=$(BRAIN_OEFFNER="$T/gibt-es-nicht/kein-programm" BRAIN_VAULT="$V" node "$B" zeig 2>&1) || RC=$?
echo "$OUT" | grep -q "http://127.0.0.1:$PORT/" || { echo "FAIL: Adresse fehlt: $OUT"; exit 1; }
echo "$OUT" | grep -q "$SCHLUESSEL" && { echo "FAIL: Schlüssel steht in der Ausgabe: $OUT"; exit 1; }
echo "$OUT" | grep -q "dienst.json" || { echo "FAIL: Hinweis auf dienst.json fehlt: $OUT"; exit 1; }
RC=0; BRAIN_VAULT="$V" node "$B" zeig --stopp >/dev/null 2>&1 || RC=$?
warte_bis "! lebt $PID" || { echo "FAIL: Dienst (Parallel-Test) läuft nach --stopp weiter"; exit 1; }

# 7e) Leere TCP-Verbindung (kein Byte) wird geschlossen (Testhaken BRAIN_DIENST_RUHE_MS)
RC=0; OUT=$(BRAIN_DIENST_RUHE_MS=400 BRAIN_VAULT="$V" node "$B" zeig 2>&1) || RC=$?
PID=$(feld "$DJ" pid); PORT=$(feld "$DJ" port); PIDS="$PIDS $PID"
R=$(node -e '
  const s = require("net").connect(Number(process.argv[1]), "127.0.0.1");
  const t = setTimeout(() => { process.stdout.write("offen"); process.exit(0); }, 4000);
  s.on("close", () => { clearTimeout(t); process.stdout.write("zu"); });
  s.on("error", () => {});' "$PORT")
[ "$R" = zu ] || { echo "FAIL: leere Verbindung blieb offen"; exit 1; }
RC=0; BRAIN_VAULT="$V" node "$B" zeig --stopp >/dev/null 2>&1 || RC=$?
warte_bis "! lebt $PID" || { echo "FAIL: Dienst (Ruhe-Test) läuft nach --stopp weiter"; exit 1; }

# 8) Start scheitert (Testhaken BRAIN_DIENST_AUS=1) → file://-Rückfall, Exit 0
RC=0; OUT=$(BRAIN_DIENST_AUS=1 BRAIN_VAULT="$V" node "$B" zeig 2>/dev/null) || RC=$?
[ "$RC" = 0 ] || { echo "FAIL: zeig mit BRAIN_DIENST_AUS rc=$RC: $OUT"; exit 1; }
echo "$OUT" | grep -q 'file://.*/index\.html' || { echo "FAIL: kein file://-Rückfall: $OUT"; exit 1; }
[ -f "$DJ" ] && { echo "FAIL: dienst.json trotz BRAIN_DIENST_AUS"; exit 1; }

echo "OK test-dienst"
