#!/bin/bash
. "$(dirname "$0")/plattform.sh"
# Commit-Prüfung auf Schnappschüssen (gestagt vs. HEAD): nur neue Befunde blockieren, REV, LOG nach Position.
set -u; cd "$(dirname "$0")"; T="$(pwd)"; C="$T/../commit-pruefung.mjs"
V=$(mktemp -d /tmp/cpXXXX); trap 'rm -rf "$V"' EXIT
g(){ git -C "$V" -c user.email=t@t -c user.name=t "$@"; }
mkdir -p "$V/09_wiki/firma/x" "$V/.tools"; cp fixture/brain.config.json "$V/"; cp -R "$T/.." "$V/.tools.src" 2>/dev/null; rm -rf "$V/.tools"; mv "$V/.tools.src" "$V/.tools"; rm -rf "$V/.tools/tests/fixture/.logs"
seite(){ printf -- '---\nname: %s\ndescription: %s\ntyp: thema\nquellen: []\nquellen_sha: []\nrev: %s\n---\n# %s\n\n%s\n' "$1" "$1" "$2" "$1" "$3"; }
seite thema_a 1 'Siehe [[thema_b]].' > "$V/09_wiki/firma/x/thema_a.md"; seite thema_b 1 'Zurück [[thema_a]].' > "$V/09_wiki/firma/x/thema_b.md"
printf '# Ingest-Protokoll (append-only, neuester Eintrag oben)\n\nFormat je Lauf:\n## <YYYY-MM-DD HH:MM> — <Quelle>\n- Seiten geändert/neu: <liste>\n\n## 2026-09-24 10:00 — alt2\n- x\n\n## 2026-09-23 — alt1\n- y\n' > "$V/09_wiki/_log.md"
g init -q; g add -- 09_wiki brain.config.json .tools; g commit -qm init
pruef(){ RC=0; OUT=$(node "$C" "$V" 2>&1) || RC=$?; }
zurueck(){ g reset -q --hard HEAD; g clean -fdq -- 09_wiki; }
# Portable Ersatz für „sed -i ''" (BSD-spezifisch, bricht unter GNU/Windows): Regex-Ersatz, ^/$ wirkt je Zeile wie bei sed.
# Unterschied zu sed: ersetzt nur den ERSTEN Treffer der GANZEN Datei (sed ersetzt ohne /g den ersten Treffer JE Zeile, über alle passenden Zeilen hinweg).
ersetze() { node -e 'const fs=require("fs");const [f,re,ers]=process.argv.slice(1);fs.writeFileSync(f,fs.readFileSync(f,"utf8").replace(new RegExp(re,"m"),ers))' "$@"; }
# (k) nichts gestagt → ok
pruef; [ $RC -eq 0 ] || { echo "FAIL: leerer Commit blockiert: $OUT"; exit 1; }
# (a) Body geändert, rev gleich → REV
echo "neu" >> "$V/09_wiki/firma/x/thema_a.md"; g add 09_wiki; pruef
[ $RC -eq 2 ] && echo "$OUT" | grep -q 'REV: firma/x/thema_a.md' && echo "$OUT" | grep -q 'Umgehen nur durch den User' && echo "$OUT" | grep -q '09_wiki/firma/x/thema_a.md' || { echo "FAIL: REV (rc=$RC): $OUT"; exit 1; }
# (b) rev erhöht → ok
ersetze "$V/09_wiki/firma/x/thema_a.md" '^rev: 1$' 'rev: 2'; g add 09_wiki; pruef; [ $RC -eq 0 ] || { echo "FAIL: rev erhöht, trotzdem blockiert: $OUT"; exit 1; }; zurueck
# (e) nur quellen_sha geändert, rev gleich → REV
ersetze "$V/09_wiki/firma/x/thema_a.md" '^quellen_sha: \[\]$' 'quellen_sha: ["abc"]'; g add 09_wiki; pruef; echo "$OUT" | grep -q 'REV: firma/x/thema_a.md' || { echo "FAIL: Hash-Änderung ohne rev nicht erkannt"; exit 1; }; zurueck
# (c) nur auch ergänzt → ok
mkdir -p "$V/09_wiki/firma/y"; seite thema_c 1 '[[thema_a]]' > "$V/09_wiki/firma/y/thema_c.md"; g add 09_wiki; g commit -qm c
ersetze "$V/09_wiki/firma/x/thema_b.md" '^rev: 1$' $'auch: ["firma/y"]\nrev: 1'; g add 09_wiki; pruef; [ $RC -eq 0 ] || { echo "FAIL: auch-Ergänzung blockiert: $OUT"; exit 1; }; zurueck
# (d) reine Umbenennung → ok
g mv 09_wiki/firma/x/thema_b.md 09_wiki/firma/y/thema_b.md; pruef; [ $RC -eq 0 ] || { echo "FAIL: git mv blockiert: $OUT"; exit 1; }; zurueck
# (g) neuer Log-Eintrag direkt unter der Vorlage → ok
node -e '
const fs = require("fs"); const p = process.argv[1];
let s = fs.readFileSync(p, "utf8");
s = s.replace("## 2026-09-24 10:00 — alt2", "## 2099-01-01 10:00 — neu\n- z\n\n## 2026-09-24 10:00 — alt2");
fs.writeFileSync(p, s);
' "$V/09_wiki/_log.md"
g add 09_wiki; pruef; [ $RC -eq 0 ] || { echo "FAIL: korrekter Log-Eintrag blockiert: $OUT"; exit 1; }; echo "$OUT" | grep -q 'LOG-ZEIT' || { echo "FAIL: abweichender Zeitstempel nicht gemeldet"; exit 1; }; zurueck
# (f) neuer Eintrag unter altem → LOG
printf '\n## 2026-09-25 09:00 — falsch\n- w\n' >> "$V/09_wiki/_log.md"; g add 09_wiki; pruef
[ $RC -eq 2 ] && echo "$OUT" | grep -q 'LOG-REIHENFOLGE' || { echo "FAIL: Log an falscher Stelle (rc=$RC): $OUT"; exit 1; }; zurueck
# (h) Bestandseintrag verändert → LOG
ersetze "$V/09_wiki/_log.md" '^- y$' '- y geändert'; g add 09_wiki; pruef; echo "$OUT" | grep -q 'LOG-REIHENFOLGE\|LOG-BESTAND' || { echo "FAIL: veränderter Bestandseintrag nicht erkannt"; exit 1; }; zurueck
# (i) Altlast (toter Link in HEAD) blockiert fremden Commit nicht; neuer toter Link schon
echo "[[weg_alt]]" >> "$V/09_wiki/firma/x/thema_a.md"; ersetze "$V/09_wiki/firma/x/thema_a.md" '^rev: 1$' 'rev: 2'; g add 09_wiki; g commit -qm --no-verify-altlast -q
echo "x" > "$V/.tools/notiz.md"; g add .tools/notiz.md; pruef; [ $RC -eq 0 ] || { echo "FAIL: Altlast blockiert fremden Commit: $OUT"; exit 1; }; zurueck
echo "[[weg_neu]]" >> "$V/09_wiki/firma/y/thema_c.md"; ersetze "$V/09_wiki/firma/y/thema_c.md" '^rev: 1$' 'rev: 2'; g add 09_wiki; pruef
[ $RC -eq 2 ] && echo "$OUT" | grep -q 'TOTER LINK: firma/y/thema_c.md' && ! echo "$OUT" | grep -q 'weg_alt' || { echo "FAIL: neuer toter Link (rc=$RC): $OUT"; exit 1; }; zurueck
# (j) kaputter, NICHT gestagter Arbeitsbaum blockiert nicht
echo "[[weg_unstaged]]" >> "$V/09_wiki/firma/y/thema_c.md"; echo "x" > "$V/.tools/notiz2.md"; g add .tools/notiz2.md; pruef
[ $RC -eq 0 ] || { echo "FAIL: ungestagte Arbeit blockiert: $OUT"; exit 1; }; zurueck
# Review-Fixes 3.4
# (l) Umlaut im Dateinamen: REV greift trotzdem
seite thema_größe 1 '[[thema_a]]' > "$V/09_wiki/firma/y/thema_größe.md"; g add 09_wiki; g commit -qm umlaut
echo "neu" >> "$V/09_wiki/firma/y/thema_größe.md"; g add 09_wiki; pruef
[ $RC -eq 2 ] && echo "$OUT" | grep -q 'REV: firma/y/thema_größe.md' || { echo "FAIL: Umlaut-Datei umgeht REV (rc=$RC): $OUT"; exit 1; }; zurueck
# (m) Archivieren: älteste Log-Einträge nach 90_archiv verschieben → erlaubt
mkdir -p "$V/90_archiv"; node -e '
const fs = require("fs"); const v = process.argv[1];
const p = v + "/09_wiki/_log.md";
const s = fs.readFileSync(p, "utf8");
const i = s.indexOf("## 2026-09-23 — alt1");
fs.writeFileSync(v + "/90_archiv/ingest-log-2026.md", "# Archiv\n\n" + s.slice(i));
fs.writeFileSync(p, s.slice(0, i).replace(/\s+$/, "") + "\n");
' "$V"
g add 09_wiki 90_archiv; pruef; [ $RC -eq 0 ] || { echo "FAIL: Archivierung blockiert: $OUT"; exit 1; }; zurueck
# (m2) Einträge löschen OHNE Archiv → weiterhin blockiert
node -e '
const fs = require("fs"); const p = process.argv[1] + "/09_wiki/_log.md";
const s = fs.readFileSync(p, "utf8");
fs.writeFileSync(p, s.slice(0, s.indexOf("## 2026-09-23 — alt1")).replace(/\s+$/, "") + "\n");
' "$V"
g add 09_wiki; pruef; echo "$OUT" | grep -q 'LOG-BESTAND' || { echo "FAIL: Löschen ohne Archiv nicht erkannt"; exit 1; }; zurueck
# (n) Umbenennung einer Seite mit Altlast (toter Link aus HEAD) → frei
g mv 09_wiki/firma/x/thema_a.md 09_wiki/firma/y/thema_a.md; pruef; [ $RC -eq 0 ] || { echo "FAIL: Umbenennung mit Altlast blockiert: $OUT"; exit 1; }; zurueck
# (o) Secret in einer gestagten Notiz blockiert den Commit, Treffertext wird NICHT ausgegeben
mkdir -p "$V/10_projekte"; KEY=api_key; VAL=sk-DUMMY1234567890; printf '# n\n%s=%s\n' "$KEY" "$VAL" > "$V/10_projekte/n.md"; g add -- 10_projekte/n.md; pruef
[ $RC -eq 2 ] || { echo "FAIL: Secret nicht blockiert (rc=$RC)"; exit 1; }
echo "$OUT" | grep -q 'SECRETS: 10_projekte/n.md Zeile 2' || { echo "FAIL: Fundstelle fehlt"; exit 1; }
echo "$OUT" | grep -q 'sk-DUMMY' && { echo "FAIL: Secret im Output"; exit 1; }
g reset -q -- 10_projekte/n.md; rm -rf "$V/10_projekte"
# (o2) Secrets in JEDER gestagten Text-Datei, egal welche Endung: .env, .csv, ohne Endung → blockiert
for DATEI in .env daten.csv OHNE_ENDUNG; do
  KEY=api_key; VAL=sk-DUMMY1234567890; printf 'x\n%s=%s\n' "$KEY" "$VAL" > "$V/$DATEI"; g add -f -- "$DATEI"; pruef
  [ $RC -eq 2 ] && echo "$OUT" | grep -q "SECRETS: $DATEI Zeile 2" || { echo "FAIL: Secret in $DATEI nicht blockiert (rc=$RC): $OUT"; exit 1; }
  echo "$OUT" | grep -q 'sk-DUMMY' && { echo "FAIL: Secret im Output ($DATEI)"; exit 1; }
  g reset -q -- "$DATEI"; rm -f "$V/$DATEI"
done
# (o3) echte Binärdatei (NUL in den ersten 8000 Bytes) wird nicht als Text geprüft
KEY=api_key; VAL=sk-DUMMY1234567890; { printf 'BIN\000\000'; printf '\n%s=%s\n' "$KEY" "$VAL"; } > "$V/bild.bin"; g add -- bild.bin; pruef
[ $RC -eq 0 ] || { echo "FAIL: Binärdatei als Secret geprüft (rc=$RC): $OUT"; exit 1; }
g reset -q -- bild.bin; rm -f "$V/bild.bin"
# (o4) Secrets-Prüfung kaputt (Muster-Modul fehlt) → fail closed: blockiert mit einfachem Satz, kein Stacktrace
cp "$V/.tools/secrets-muster.mjs" "$V/sm.bak"; printf 'export function findeSecrets() { throw new Error("kaputt"); }\n' > "$V/.tools/secrets-muster.mjs"
echo "notiz" > "$V/harmlos.md"; g add -- harmlos.md; RC=0; OUT=$(node "$V/.tools/commit-pruefung.mjs" "$V" 2>&1) || RC=$?
[ $RC -eq 2 ] && echo "$OUT" | grep -q 'Sicherheitsprüfung' && ! echo "$OUT" | grep -q '    at ' || { echo "FAIL: kaputte Secrets-Prüfung nicht fail-closed (rc=$RC): $OUT"; exit 1; }
mv "$V/sm.bak" "$V/.tools/secrets-muster.mjs"; g reset -q -- harmlos.md; rm -f "$V/harmlos.md"
# (p) CLI-Zweig von secrets-muster.mjs erkennt Secret auch über Symlink-Aufruf (argv[1] ≠ realpath)
SLD=$(mktemp -d /tmp/slXXXX)
if ln -s "$T/../secrets-muster.mjs" "$SLD/link.mjs" 2>/dev/null; then
  KEY=api_key; VAL=sk-DUMMY1234567890; printf '%s=%s\n' "$KEY" "$VAL" > "$SLD/secret.md"
  RC=0; OUT=$(node "$SLD/link.mjs" "$SLD/secret.md" 2>&1) || RC=$?
  [ $RC -eq 3 ] || { echo "FAIL: Symlink-Aufruf erkennt Secret nicht (rc=$RC): $OUT"; exit 1; }
  echo "$OUT" | grep -q 'sk-DUMMY' && { echo "FAIL: Secret im Output (Symlink)"; exit 1; }
else
  echo "SKIP: ln -s nicht verfügbar — Symlink-Test übersprungen"
fi
rm -rf "$SLD"

# BRAIN_ERSTCOMMIT=1 (nur install.mjs, allererster Commit): Unit-Tests des Kits entfallen, Secrets blockieren weiter.
VE=$(mktemp -d); mkdir -p "$VE/09_wiki" "$VE/.tools/tests"; cp fixture/brain.config.json "$VE/"
printf 'import { test } from "node:test";\ntest("rot", () => { throw new Error("rot"); });\n' > "$VE/.tools/tests/test-rot.mjs"
echo 'export const x = 1;' > "$VE/.tools/x.mjs"
git -C "$VE" init -q; git -C "$VE" add -- .tools brain.config.json
RC=0; OUT=$(node "$C" "$VE" 2>&1) || RC=$?
[ $RC -eq 2 ] && echo "$OUT" | grep -q 'UNIT-TESTS' || { echo "FAIL: roter Unit-Test blockiert nicht (rc=$RC): $OUT"; exit 1; }
RC=0; OUT=$(BRAIN_ERSTCOMMIT=1 node "$C" "$VE" 2>&1) || RC=$?
[ $RC -eq 0 ] || { echo "FAIL: BRAIN_ERSTCOMMIT=1 lässt Unit-Tests trotzdem laufen (rc=$RC): $OUT"; exit 1; }
KEY=api_key; VAL=sk-DUMMY1234567890; printf '# n\n%s=%s\n' "$KEY" "$VAL" > "$VE/n.md"; git -C "$VE" add -- n.md
RC=0; OUT=$(BRAIN_ERSTCOMMIT=1 node "$C" "$VE" 2>&1) || RC=$?
[ $RC -eq 2 ] && echo "$OUT" | grep -q 'SECRETS: n.md' || { echo "FAIL: BRAIN_ERSTCOMMIT=1 übergeht Secrets (rc=$RC): $OUT"; exit 1; }
rm -rf "$VE"
echo "PASS"
