#!/bin/bash
# Suchdienst mit Fake-QMD: Socket als Lock (eine Instanz), Rechte 0600, Antwort mit rr, Leerlauf-Ende, Socket-Leiche.
# Ruling: Suchdienst (suchdienst.mjs, Reranker, Profil "voll") wird unter Windows erst ab v0.3 unterstützt.
[ "${OS:-}" = "Windows_NT" ] && { echo "SKIP test-suchdienst.sh (Suchdienst unter Windows erst ab v0.3)"; exit 0; }
set -u; cd "$(dirname "$0")"; T="$(pwd)"; D="$T/../suchdienst.mjs"
V=$(mktemp -d /tmp/bdXXXX); trap 'pkill -f "suchdienst.mjs $V" 2>/dev/null; rm -rf "$V"' EXIT
mkdir -p "$V/.logs/hint-karten"; echo "# Alpha" > "$V/.logs/hint-karten/thema_alpha.md"
echo '{"paths":{"thema-alpha.md":"09_wiki/thema_alpha.md"},"pages":{"09_wiki/thema_alpha.md":{"description":"Alpha"}},"bySource":{}}' > "$V/.logs/wiki-map.json"
export BRAIN_DIENST_LIB="$T/fake-qmd-lib.mjs" BRAIN_DIENST_IDLE_MS=3000
S="$V/.logs/suchdienst.sock"
warte(){ for i in $(seq 1 50); do [ -S "$S" ] && return 0; sleep 0.1; done; return 1; }
frag(){ node --input-type=module -e "import { frageDienst } from '$T/../dienst-client.mjs'; frageDienst('$V', { query: 'alpha frage', limit: 20, top: 3 }, { antwortMs: 2000 }).then(r => console.log(JSON.stringify(r)), e => console.log('FEHLER ' + e.code))"; }
node "$D" "$V" & warte || { echo "FAIL: Dienst legt keinen Socket an"; exit 1; }
# Portabler Ersatz für `stat -f %Lp` (BSD, bricht unter GNU) — das ganze Skript ist unter Windows schon oben per SKIP beendet.
RECHTE=$(node -e 'console.log((require("fs").statSync(process.argv[1]).mode & 0o777).toString(8).padStart(3,"0"))' "$S")
[ "$RECHTE" = "600" ] || { echo "FAIL: Socket-Rechte $RECHTE"; exit 1; }
frag | grep -q '"rr":0.73' || { echo "FAIL: Antwort ohne rr: $(frag)"; exit 1; }
node "$D" "$V"; [ $? -eq 0 ] || { echo "FAIL: Zweitstart nicht still beendet"; exit 1; }
[ "$(pgrep -f "suchdienst.mjs $V" | wc -l | tr -d ' ')" = "1" ] || { echo "FAIL: nicht genau eine Instanz"; exit 1; }
[ -f "$V/.logs/suchdienst.pid" ] || { echo "FAIL: PID-Datei fehlt"; exit 1; }
sleep 4; [ ! -e "$S" ] && [ ! -e "$V/.logs/suchdienst.pid" ] || { echo "FAIL: Leerlauf-Ende räumt nicht auf"; exit 1; }
# Socket-Leiche (Prozess hart beendet) → neuer Dienst räumt sie weg und läuft
node -e "require('net').createServer().listen('$S', () => process.kill(process.pid, 'SIGKILL'))"; [ -S "$S" ] || { echo "FAIL: Leiche nicht erzeugt"; exit 1; }
frag | grep -q 'FEHLER EDIENST' || { echo "FAIL: Leiche nicht als EDIENST erkannt"; exit 1; }
node "$D" "$V" & sleep 1; frag | grep -q '"rr":0.73' || { echo "FAIL: Dienst übernimmt Leiche nicht"; exit 1; }
# Reranker wirft → Dienst antwortet trotzdem mit Vektor-Scores (rr null)
pkill -f "suchdienst.mjs $V"; sleep 0.5; FAKE_DIENST_RR_FEHLER=1 node "$D" "$V" & warte
frag | grep -q '"rr":null' || { echo "FAIL: Rerank-Fehler bricht Antwort"; exit 1; }
# Hängender Rerank → Client läuft in ETIMEDOUT
pkill -f "suchdienst.mjs $V"; sleep 0.5; FAKE_DIENST_HAENGT=1 node "$D" "$V" & warte
node --input-type=module -e "import { frageDienst } from '$T/../dienst-client.mjs'; const t=Date.now(); frageDienst('$V', { query: 'x' }, { antwortMs: 500 }).catch(e => { console.log(e.code, Date.now()-t < 1500 ? 'schnell' : 'langsam'); })" | grep -q 'ETIMEDOUT schnell' || { echo "FAIL: Hänger nicht per Frist abgebrochen"; exit 1; }
# Aufwärmphase: Anfragen vor „bereit" bekommen sofort EWARM statt zu hängen
pkill -f "suchdienst.mjs $V"; sleep 0.5; FAKE_DIENST_WARM_MS=3000 node "$D" "$V" & warte
node --input-type=module -e "import { frageDienst } from '$T/../dienst-client.mjs'; const t=Date.now(); frageDienst('$V', { query: 'x' }, { antwortMs: 2000 }).catch(e => console.log(e.code, Date.now()-t < 500 ? 'sofort' : 'langsam'))" | grep -q 'EWARM sofort' || { echo "FAIL: kein EWARM während Aufwärmen"; exit 1; }
sleep 3.5; frag | grep -q '"rr":0.73' || { echo "FAIL: nach Aufwärmen nicht bereit"; exit 1; }
echo "PASS"
