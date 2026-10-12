#!/bin/bash
. "$(dirname "$0")/plattform.sh"
# Commit-Prüfung: reiner Pfadwechsel in quellen: bei gleichem Inhalt UND passendem Hash der Datei am neuen Ort
# braucht kein rev+1 (Import-Abschluss, Issue #6); jede andere Änderung weiter schon.
set -u; cd "$(dirname "$0")"; T="$(pwd)"; C="$T/../commit-pruefung.mjs"
V=$(mktemp -d /tmp/cpfXXXX); trap 'rm -rf "$V"' EXIT
g(){ git -C "$V" -c user.email=t@t -c user.name=t "$@"; }
mkdir -p "$V/09_wiki/firma/x" "$V/00_inbox/_import/q"; cp fixture/brain.config.json "$V/"; cp -R "$T/.." "$V/.tools"; rm -rf "$V/.tools/tests/fixture/.logs"
printf 'Rohnotiz eins\n' > "$V/00_inbox/_import/q/a.md"; printf 'Rohnotiz zwei\n' > "$V/00_inbox/_import/q/b.md"
SA=$(node -e 'process.stdout.write(require("crypto").createHash("sha256").update(require("fs").readFileSync(process.argv[1])).digest("hex").slice(0,16))' "$V/00_inbox/_import/q/a.md")
SB=$(node -e 'process.stdout.write(require("crypto").createHash("sha256").update(require("fs").readFileSync(process.argv[1])).digest("hex").slice(0,16))' "$V/00_inbox/_import/q/b.md")
seite(){ printf -- '---\nname: thema_a\ndescription: d\ntyp: thema\nquellen: %s\nquellen_sha: %s\nrev: %s\n---\n# A\n\n%s\n' "$1" "$2" "$3" "$4"; }
seite '["00_inbox/_import/q/a.md", "00_inbox/_import/q/b.md"]' "[\"$SA\", \"$SB\"]" 1 'Text.' > "$V/09_wiki/firma/x/thema_a.md"
printf '# Ingest-Protokoll (append-only, neuester Eintrag oben)\n\nFormat je Lauf:\n## <YYYY-MM-DD HH:MM> — <Quelle>\n- x\n' > "$V/09_wiki/_log.md"
g init -q; g add -- 09_wiki 00_inbox brain.config.json .tools; g commit -qm init
pruef(){ RC=0; OUT=$(node "$C" "$V" 2>&1) || RC=$?; }
zurueck(){ g reset -q --hard HEAD; g clean -fdq; }
ersetze() { node -e 'const fs=require("fs");const [f,re,ers]=process.argv.slice(1);fs.writeFileSync(f,fs.readFileSync(f,"utf8").replace(new RegExp(re,"m"),ers))' "$@"; }
verschiebe(){ mkdir -p "$V/30_wissen/q"; g mv 00_inbox/_import/q/$1 30_wissen/q/$1; }
NEU='["30_wissen/q/a.md", "30_wissen/q/b.md"]'
# (a) Quellen verschoben + Pfade angepasst, Hash gleich, sonst nichts → ok, auch ohne rev+1
verschiebe a.md; verschiebe b.md; seite "$NEU" "[\"$SA\", \"$SB\"]" 1 'Text.' > "$V/09_wiki/firma/x/thema_a.md"; g add 09_wiki; pruef
[ $RC -eq 0 ] || { echo "FAIL: reiner Pfadwechsel blockiert: $OUT"; exit 1; }; zurueck
# (b) Pfadwechsel + Body geändert, rev gleich → REV
verschiebe a.md; verschiebe b.md; seite "$NEU" "[\"$SA\", \"$SB\"]" 1 'Text geändert.' > "$V/09_wiki/firma/x/thema_a.md"; g add 09_wiki; pruef
echo "$OUT" | grep -q 'REV: firma/x/thema_a.md' || { echo "FAIL: Body-Änderung beim Pfadwechsel nicht erkannt: $OUT"; exit 1; }; zurueck
# (c) Pfadwechsel + Hash geändert → REV
verschiebe a.md; verschiebe b.md; seite "$NEU" "[\"$SA\", \"0000000000000000\"]" 1 'Text.' > "$V/09_wiki/firma/x/thema_a.md"; g add 09_wiki; pruef
echo "$OUT" | grep -q 'REV: firma/x/thema_a.md' || { echo "FAIL: Hash-Änderung beim Pfadwechsel nicht erkannt: $OUT"; exit 1; }; zurueck
# (d) Pfadwechsel auf eine Datei mit anderem Inhalt (Hash passt nicht zur Datei am neuen Ort) → REV
verschiebe a.md; mkdir -p "$V/30_wissen/q"; printf 'ganz anderer Inhalt\n' > "$V/30_wissen/q/b.md"; g add 30_wissen
seite "$NEU" "[\"$SA\", \"$SB\"]" 1 'Text.' > "$V/09_wiki/firma/x/thema_a.md"; g add 09_wiki; pruef
echo "$OUT" | grep -q 'REV: firma/x/thema_a.md' || { echo "FAIL: Pfad auf andere Datei nicht erkannt: $OUT"; exit 1; }; zurueck
# (e) Pfad zeigt auf eine Datei, die es nicht gibt → REV
seite '["30_wissen/q/a.md", "30_wissen/q/b.md"]' "[\"$SA\", \"$SB\"]" 1 'Text.' > "$V/09_wiki/firma/x/thema_a.md"; g add 09_wiki; pruef
echo "$OUT" | grep -q 'REV: firma/x/thema_a.md' || { echo "FAIL: toter Quellpfad nicht erkannt: $OUT"; exit 1; }; zurueck
# (f) Pfadwechsel, aber weniger Quellen (Anzahl geändert) → REV
verschiebe a.md; verschiebe b.md; seite '["30_wissen/q/a.md"]' "[\"$SA\"]" 1 'Text.' > "$V/09_wiki/firma/x/thema_a.md"; g add 09_wiki; pruef
echo "$OUT" | grep -q 'REV: firma/x/thema_a.md' || { echo "FAIL: weniger Quellen nicht erkannt: $OUT"; exit 1; }; zurueck
# (g) Bestehendes Verhalten: nur quellen_sha geändert → REV
seite '["00_inbox/_import/q/a.md", "00_inbox/_import/q/b.md"]' "[\"$SA\", \"abc\"]" 1 'Text.' > "$V/09_wiki/firma/x/thema_a.md"; g add 09_wiki; pruef
echo "$OUT" | grep -q 'REV: firma/x/thema_a.md' || { echo "FAIL: reine Hash-Änderung nicht erkannt: $OUT"; exit 1; }; zurueck
# (h) Wie unter Windows: core.autocrlf=true → der gestagte Schnappschuss hat CRLF, quellen_sha wurde über LF gebildet → ok
g config core.autocrlf true
verschiebe a.md; verschiebe b.md; seite "$NEU" "[\"$SA\", \"$SB\"]" 1 'Text.' > "$V/09_wiki/firma/x/thema_a.md"; g add 09_wiki; pruef
[ $RC -eq 0 ] || { echo "FAIL: reiner Pfadwechsel mit CRLF-Schnappschuss blockiert: $OUT"; exit 1; }; zurueck
g config --unset core.autocrlf
echo "OK test-commit-pruefung-pfad"
