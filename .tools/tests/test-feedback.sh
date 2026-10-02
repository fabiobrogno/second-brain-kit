#!/bin/bash
. "$(dirname "$0")/plattform.sh"
set -u; cd "$(dirname "$0")"; F="$(pwd)/../feedback.mjs"; V=$(mktemp -d); export BRAIN_VAULT="$V"
node "$F" falsch thema_x.md "passte gar nicht" >/dev/null || { echo "FAIL: gültiger Aufruf"; exit 1; }
grep -q 'art=falsch seite=thema_x.md notiz=passte gar nicht' "$V/.logs/feedback.log" || { echo "FAIL: Zeile falsch: $(cat "$V/.logs/feedback.log")"; exit 1; }
node "$F" quatsch >/dev/null 2>&1 && { echo "FAIL: ungültige Art akzeptiert"; exit 1; }
node "$F" fehlte >/dev/null; tail -1 "$V/.logs/feedback.log" | grep -q 'art=fehlte seite=- notiz=$' || { echo "FAIL: Aufruf ohne Seite/Notiz: $(tail -1 "$V/.logs/feedback.log")"; exit 1; }
node "$F" fehlte - "$(printf 'zeile1\nzeile2 %0.s' $(seq 1 100))" >/dev/null
[ "$(wc -l < "$V/.logs/feedback.log")" -eq 3 ] || { echo "FAIL: Umbruch erzeugt mehrere Zeilen"; exit 1; }
[ "$(tail -1 "$V/.logs/feedback.log" | sed 's/.*notiz=//' | wc -c)" -le 201 ] || { echo "FAIL: Notiz nicht gekürzt"; exit 1; }
node "$F" falsch "$(printf 'thema x\nböse;rm -rf')" "n" >/dev/null
tail -1 "$V/.logs/feedback.log" | grep -q 'seite=themaxbserm-rf\|seite=themax' && [ "$(wc -l < "$V/.logs/feedback.log")" -eq 4 ] || { echo "FAIL: Seitenname nicht bereinigt: $(tail -1 "$V/.logs/feedback.log")"; exit 1; }
rm -rf "$V"; echo "PASS"
