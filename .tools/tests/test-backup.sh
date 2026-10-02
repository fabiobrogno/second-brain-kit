#!/bin/bash
. "$(dirname "$0")/plattform.sh"
# .tools/tests/test-backup.sh — Sicherung ohne GitHub: Bundle in Ordner, Rotation, Wiederherstellen
set -u; D="$(cd "$(dirname "$0")" && pwd)"; B="$D/../brain.mjs"; T="$(mktemp -d)"; V="$T/Mein Brain"; Z="$T/USB Stick"
cp -R "$D/fixture" "$V"; mkdir -p "$Z"; git -C "$V" init -q; git -C "$V" add . ; git -C "$V" -c user.email=t@example.com -c user.name=t commit -qm init
BRAIN_VAULT="$V" node "$B" backup einrichten "ordner:$Z" >/dev/null || { echo "FAIL: einrichten"; exit 1; }
[ "$(node -p "require('$V/brain.config.json').backup.art")" = "ordner" ] || { echo "FAIL: config"; exit 1; }
for i in 1 2 3 4 5 6 7 8 9; do touch -t "2026090${i}1200" "$Z/brain-2026-09-0$i.bundle"; done
BRAIN_VAULT="$V" node "$B" backup >/dev/null || { echo "FAIL: backup"; exit 1; }
[ "$(ls "$Z" | grep -c '\.bundle$')" = 7 ] || { echo "FAIL: Rotation ($(ls "$Z" | wc -l))"; exit 1; }
[ -f "$Z/brain-$(date +%F).bundle" ] || { echo "FAIL: heutiges Bundle fehlt"; exit 1; }
BRAIN_VAULT="$V" node "$B" backup wiederherstellen "$Z/brain-$(date +%F).bundle" "$T/zurück" >/dev/null || { echo "FAIL: wiederherstellen"; exit 1; }
# Zeilenenden ausgenommen: unter Windows (core.autocrlf) checkt der Klon CRLF aus, die Arbeitskopie hat LF
[ "$(tr -d "\r" < "$V/brain.config.json")" = "$(tr -d "\r" < "$T/zurück/brain.config.json")" ] || { echo "FAIL: Inhalt anders"; exit 1; }
# Ordner weg (USB abgezogen): freundlich melden, Exit 0, nichts kaputt
rm -rf "$Z"; RC=0; OUT=$(BRAIN_VAULT="$V" node "$B" backup 2>&1) || RC=$?
[ "$RC" = 0 ] && echo "$OUT" | grep -q 'Sicherungsordner ist gerade nicht da' || { echo "FAIL: fehlender Ordner rc=$RC $OUT"; exit 1; }

# einrichten committet NUR brain.config.json — andere bereits gestagte (fremde) Änderungen bleiben gestagt
T2="$(mktemp -d)"; V2="$T2/v"
cp -R "$D/fixture" "$V2"; git -C "$V2" init -q; git -C "$V2" add .
git -C "$V2" -c user.email=t@example.com -c user.name=t commit -qm init
echo "fremd" > "$V2/00_inbox/fremd.md"; git -C "$V2" add 00_inbox/fremd.md
BRAIN_VAULT="$V2" node "$B" backup einrichten keins >/dev/null || { echo "FAIL: einrichten keins"; exit 1; }
[ "$(git -C "$V2" diff --cached --name-only)" = "00_inbox/fremd.md" ] || { echo "FAIL: fremde Datei nicht mehr gestagt: $(git -C "$V2" diff --cached --name-only)"; exit 1; }
[ "$(git -C "$V2" diff --name-only HEAD~1 HEAD)" = "brain.config.json" ] || { echo "FAIL: Commit enthält mehr als brain.config.json: $(git -C "$V2" diff --name-only HEAD~1 HEAD)"; exit 1; }

# einrichten: Ausgabe ist ein Satz, kein rohes Objekt
OUT=$(BRAIN_VAULT="$V2" node "$B" backup einrichten "ordner:$T2/z")
echo "$OUT" | grep -qF "{" && { echo "FAIL: einrichten gibt rohes Objekt aus: $OUT"; exit 1; }
echo "$OUT" | grep -q "Sicherung eingerichtet: Ordner $T2/z" || { echo "FAIL: einrichten-Satz fehlt: $OUT"; exit 1; }
OUT=$(BRAIN_VAULT="$V2" node "$B" backup einrichten keins)
echo "$OUT" | grep -q "Sicherung eingerichtet: keine Sicherung" || { echo "FAIL: einrichten-Satz (keins) fehlt: $OUT"; exit 1; }
OUT=$(BRAIN_VAULT="$V2" node "$B" backup einrichten github)
echo "$OUT" | grep -q "Sicherung eingerichtet: GitHub" || { echo "FAIL: einrichten-Satz (github) fehlt: $OUT"; exit 1; }

# sichern: warnt bei nicht eingearbeiteten Notizen (uncommitted/untracked), kein Auto-Commit der Inbox
T3="$(mktemp -d)"; V3="$T3/v"; Z3="$T3/z"; mkdir -p "$Z3"
cp -R "$D/fixture" "$V3"; git -C "$V3" init -q; git -C "$V3" add .
git -C "$V3" -c user.email=t@example.com -c user.name=t commit -qm init
BRAIN_VAULT="$V3" node "$B" backup einrichten "ordner:$Z3" >/dev/null
echo "neue notiz" > "$V3/00_inbox/notiz.md"
OUT=$(BRAIN_VAULT="$V3" node "$B" backup)
echo "$OUT" | grep -qF "Achtung: 1 Notiz(en) sind noch nicht eingearbeitet und deshalb nicht in der Sicherung — sag" || { echo "FAIL: Warnung fehlt: $OUT"; exit 1; }
[ "$(git -C "$V3" status --porcelain | wc -l | tr -d ' ')" = "1" ] || { echo "FAIL: Notiz wurde doch committet"; exit 1; }

# wiederherstellen: nicht leerer Zielordner wird abgelehnt (Exit 1, freundlicher Satz)
BELEGT="$T3/belegt"; mkdir -p "$BELEGT"; echo x > "$BELEGT/datei"
RC=0; OUT=$(BRAIN_VAULT="$V3" node "$B" backup wiederherstellen "$Z3/brain-$(date +%F).bundle" "$BELEGT" 2>&1) || RC=$?
[ "$RC" = 1 ] || { echo "FAIL: nicht-leerer Zielordner — falscher Exitcode rc=$RC"; exit 1; }
echo "$OUT" | grep -qF "ist nicht leer" || { echo "FAIL: nicht-leerer Zielordner nicht erkannt: $OUT"; exit 1; }

# wiederherstellen: ungültige Quelle meldet sich freundlich (Exit 1), kein Rohtext
RC=0; OUT=$(BRAIN_VAULT="$V3" node "$B" backup wiederherstellen "$T3/gibt-es-nicht.bundle" "$T3/leer" 2>&1) || RC=$?
[ "$RC" = 1 ] || { echo "FAIL: ungültige Quelle — falscher Exitcode rc=$RC"; exit 1; }
echo "$OUT" | grep -qF "Wiederherstellen hat nicht geklappt" || { echo "FAIL: Fehlermeldung wiederherstellen fehlt: $OUT"; exit 1; }
echo "$OUT" | grep -qiE 'fatal|does not exist|ENOENT|repository' && { echo "FAIL: Rohtext in Fehlermeldung: $OUT"; exit 1; }

# sichern ohne backup-Eintrag, aber mit Git-Remote: pusht (gleicher Rückfall wie im Sitzungsstart)
T4="$(mktemp -d)"; V4="$T4/v"; R4="$T4/remote.git"
cp -R "$D/fixture" "$V4"; node -e 'const f=process.argv[1],c=JSON.parse(require("fs").readFileSync(f,"utf8"));delete c.backup;require("fs").writeFileSync(f,JSON.stringify(c))' "$V4/brain.config.json"
git init -q --bare "$R4"; git -C "$V4" init -q; git -C "$V4" add .; git -C "$V4" -c user.email=t@example.com -c user.name=t commit -qm init
git -C "$V4" remote add origin "$R4"; git -C "$V4" push -q -u origin HEAD 2>/dev/null
echo "neu" > "$V4/00_inbox/n.md"; git -C "$V4" add 00_inbox/n.md; git -C "$V4" -c user.email=t@example.com -c user.name=t commit -qm zwei --no-verify
OUT=$(BRAIN_VAULT="$V4" node "$B" backup)
echo "$OUT" | grep -q "Online gesichert" || { echo "FAIL: ohne backup-Eintrag + Remote kein Push: $OUT"; exit 1; }
[ "$(git -C "$R4" rev-parse HEAD 2>/dev/null || git -C "$R4" rev-parse refs/heads/main)" = "$(git -C "$V4" rev-parse HEAD)" ] || { echo "FAIL: Remote nicht auf neuem Stand"; exit 1; }
# ohne backup-Eintrag und ohne Remote: freundlicher Satz, kein Push-Versuch
git -C "$V4" remote remove origin
OUT=$(BRAIN_VAULT="$V4" node "$B" backup)
echo "$OUT" | grep -q "Keine Sicherung eingerichtet" || { echo "FAIL: ohne Remote falscher Satz: $OUT"; exit 1; }

echo "OK test-backup"
