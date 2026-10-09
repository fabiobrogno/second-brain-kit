#!/bin/bash
. "$(dirname "$0")/plattform.sh"
# session-hintergrund.mjs muss bei jedem SessionStart AGENTS.md aus der Vorlage neu erzeugen (sie ist
# nicht getrackt — maschinenlokaler, absoluter Vault-Pfad) und darf dabei nie hart fehlschlagen.
set -u; cd "$(dirname "$0")"; H="$(pwd)/../adapters/claude-code/session-hintergrund.mjs"
V=$(mktemp -d)/"Mein Brain"; mkdir -p "$V"
echo '{}' > "$V/brain.config.json"
export BRAIN_VAULT="$V"
# Temp-Home: das echte ~/.claude (Memory-Sync) und echte Home-Configs werden nie gelesen oder geschrieben.
TH0=$(mktemp -d); export HOME="$TH0" USERPROFILE="$TH0"
node "$H"
[ -f "$V/AGENTS.md" ] || { echo "FAIL: AGENTS.md wurde nicht erzeugt"; exit 1; }
grep -qF "$V" "$V/AGENTS.md" || { echo "FAIL: AGENTS.md enthält nicht den Vault-Pfad"; exit 1; }
# Node-Pfad endet unter Windows auf node.exe
grep -F "\"$V/.tools/brain.mjs\" search" "$V/AGENTS.md" | grep -qE 'node(\.exe)?" "' || { echo "FAIL: Kommando-Pfad nicht gequotet"; cat "$V/AGENTS.md"; exit 1; }
# v0.3: Schalter updateHinweis=false → kein Update-Check im Hintergrund
echo '{"automatik":{"updateHinweis":false}}' > "$V/brain.config.json"; rm -f "$V/.logs/hooks.log"
node "$H"
grep -q 'Update-Check:' "$V/.logs/hooks.log" 2>/dev/null && { echo "FAIL: Update-Check trotz updateHinweis=false"; exit 1; }
# v0.4: Pflegebericht wird im Hintergrund gerechnet (Cache für die Wochen-Zeile); Schalter wochenbericht=false → nicht
[ -f "$V/.logs/pflege-bericht.json" ] || { echo "FAIL: Pflegebericht-Cache fehlt"; exit 1; }
rm -f "$V/.logs/pflege-bericht.json"; echo '{"automatik":{"updateHinweis":false,"wochenbericht":false}}' > "$V/brain.config.json"
node "$H"
[ -f "$V/.logs/pflege-bericht.json" ] && { echo "FAIL: Pflegebericht-Cache trotz wochenbericht=false"; exit 1; }
# Schalter sicherungTaeglich=false → keine tägliche Ordner-Sicherung (Standard: Bundle wird geschrieben)
git -C "$V" init -q 2>/dev/null; git -C "$V" -c user.name=t -c user.email=t@t commit -q --allow-empty -m init 2>/dev/null
BK=$(mktemp -d)
echo "{\"backup\":{\"art\":\"ordner\",\"pfad\":\"$BK\"},\"automatik\":{\"updateHinweis\":false,\"wochenbericht\":false,\"sicherungTaeglich\":false}}" > "$V/brain.config.json"
node "$H"
ls "$BK"/brain-*.bundle >/dev/null 2>&1 && { echo "FAIL: Sicherung trotz sicherungTaeglich=false"; exit 1; }
echo "{\"backup\":{\"art\":\"ordner\",\"pfad\":\"$BK\"},\"automatik\":{\"updateHinweis\":false,\"wochenbericht\":false}}" > "$V/brain.config.json"
node "$H"
ls "$BK"/brain-*.bundle >/dev/null 2>&1 || { echo "FAIL: Sicherung im Standard (sicherungTaeglich nicht gesetzt) fehlt"; exit 1; }
rm -rf "$BK"

# ---------- v0.3: session-start — Ich-Karte, Projektseite, Vorschläge (Temp-HOME, eigener Temp-Vault) ----------
S="$(pwd)/../adapters/claude-code/session-start.mjs"
TH=$(mktemp -d); W=$(mktemp -d); V2="$W/Brain, Jo's Ü"; mkdir -p "$V2/09_wiki/projekte"
echo '{}' > "$V2/brain.config.json"
auto(){ node -e "const f=process.argv[1],c=JSON.parse(require('fs').readFileSync(f,'utf8'));c.automatik=JSON.parse(process.argv[2]);require('fs').writeFileSync(f,JSON.stringify(c))" "$V2/brain.config.json" "$1"; }
start(){ printf '{"session_id":"s1","cwd":"%s"}' "$1" | HOME="$TH" USERPROFILE="$TH" BRAIN_VAULT="$V2" BRAIN_SESSION_NUR_STATUS=1 node "$S"; }
mkdir -p "$W/arbeit/garten-app/src" "$W/arbeit/Obstwiese" "$W/arbeit/doppelt" "$W/arbeit/nirgends"
# Ich-Karte: BOM + Frontmatter weg, ≤ 1500 Zeichen
node -e "require('fs').writeFileSync(process.argv[1], '﻿---\nname: ich\ndescription: Ich-Karte\n---\nIch heiße Jo und gärtnere gern.\n' + 'x'.repeat(2000) + '\n')" "$V2/09_wiki/ich.md"
OUT=$(start "$W/arbeit/nirgends"); echo "$OUT" | grep -q 'gärtnere' && { echo "FAIL: Ich-Karte ohne Schalter"; exit 1; }
auto '{"ichKarte":true,"projektAutomatik":false}'; OUT=$(start "$W/arbeit/nirgends")
echo "$OUT" | grep -q '^Ich heiße Jo und gärtnere gern.' || { echo "FAIL: Ich-Karte fehlt: [$OUT]"; exit 1; }
echo "$OUT" | grep -q 'description:' && { echo "FAIL: Frontmatter in der Ich-Karte"; exit 1; }
L=$(printf '%s' "$OUT" | node -e "let d='';process.stdin.setEncoding('utf8').on('data',c=>d+=c).on('end',()=>{const i=d.indexOf('Ich heiße');console.log(d.slice(i).length)})")
[ "$L" -le 1502 ] || { echo "FAIL: Ich-Karte zu lang ($L Zeichen)"; exit 1; }
# Projektseite: Frontmatter repo:/pfade: (auch Git-Toplevel aus Unterordner), sonst Seitenname; genau ein Treffer
printf -- '---\nname: Gartenbau\nrepo: jo/garten-app\n---\n# Gartenbau\n' > "$V2/09_wiki/projekte/entitaet_gartenbau.md"
printf -- '---\nname: Wiese\n---\n# Obstwiese\n' > "$V2/09_wiki/projekte/thema_obstwiese.md"
printf -- '---\nname: A\npfade:\n  - ~/arbeit/doppelt\n---\n' > "$V2/09_wiki/projekte/thema_a.md"
printf -- '---\nname: B\npfade: [/x/doppelt, /y/sonst]\n---\n' > "$V2/09_wiki/projekte/thema_b.md"
auto '{}'
OUT=$(start "$W/arbeit/garten-app"); echo "$OUT" | grep -q '^Projektseite: .*09_wiki/projekte/entitaet_gartenbau.md$' || { echo "FAIL: Projektseite per repo: fehlt: [$OUT]"; exit 1; }
git -C "$W/arbeit/garten-app" init -q 2>/dev/null
OUT=$(start "$W/arbeit/garten-app/src"); echo "$OUT" | grep -q 'entitaet_gartenbau.md' || { echo "FAIL: Projektseite über Git-Toplevel fehlt: [$OUT]"; exit 1; }
OUT=$(start "$W/arbeit/Obstwiese"); echo "$OUT" | grep -q '^Projektseite: .*thema_obstwiese.md$' || { echo "FAIL: Projektseite per Seitenname fehlt: [$OUT]"; exit 1; }
OUT=$(start "$W/arbeit/doppelt"); echo "$OUT" | grep -q 'Projektseite' && { echo "FAIL: zwei Treffer müssen still bleiben: [$OUT]"; exit 1; }
OUT=$(start "$W/arbeit/nirgends"); echo "$OUT" | grep -q 'Projektseite' && { echo "FAIL: Projektseite ohne Treffer"; exit 1; }
[ "$(start "$W/arbeit/Obstwiese" | grep -c 'Projektseite')" = 1 ] || { echo "FAIL: Projektzeile nicht genau einmal"; exit 1; }
auto '{"projektAutomatik":false}'; OUT=$(start "$W/arbeit/Obstwiese"); echo "$OUT" | grep -q 'Projektseite' && { echo "FAIL: Projektseite trotz Schalter aus"; exit 1; }
# Schalter-Wirkung: ichKarte/projektAutomatik je true und false (Ich-Karte aus: weiter oben schon ohne Schalter geprüft)
auto '{"ichKarte":false,"projektAutomatik":true}'; OUT=$(start "$W/arbeit/Obstwiese")
echo "$OUT" | grep -q 'gärtnere' && { echo "FAIL: Ich-Karte trotz ichKarte=false"; exit 1; }
echo "$OUT" | grep -q 'Projektseite' || { echo "FAIL: Projektseite fehlt bei projektAutomatik=true: [$OUT]"; exit 1; }
auto '{"ichKarte":true,"projektAutomatik":false}'; OUT=$(start "$W/arbeit/Obstwiese")
echo "$OUT" | grep -q 'gärtnere' || { echo "FAIL: Ich-Karte fehlt bei ichKarte=true"; exit 1; }
echo "$OUT" | grep -q 'Projektseite' && { echo "FAIL: Projektseite trotz projektAutomatik=false"; exit 1; }
auto '{"projektAutomatik":false}'
# Vorschläge: Zahl nur wenn > 0
OUT=$(start "$W/arbeit/nirgends"); echo "$OUT" | grep -q 'Vorschläge' && { echo "FAIL: Vorschlagszeile ohne Vorschläge"; exit 1; }
# import() braucht unter Windows eine file://-URL (D:/… wäre ein unbekanntes URL-Schema) → pathToFileURL
node --input-type=module -e "const { pathToFileURL } = await import('node:url'); const { schreibeVorschlag } = await import(pathToFileURL(process.argv[1]).href); schreibeVorschlag(process.argv[2], { art: 'fakt', titel: 'Beet im Frühling', text: 'Kompost zuerst.' })" "$(pwd)/../vorschlaege.mjs" "$V2" >/dev/null || { echo "FAIL: Vorschlag anlegen"; exit 1; }
OUT=$(start "$W/arbeit/nirgends"); echo "$OUT" | grep -qx '1 neuer Vorschlag — im Gehirn prüfen („zeig mir mein Brain“)' || { echo "FAIL: Vorschlagszeile fehlt: [$OUT]"; exit 1; }
# Final-Review #6: Vorschläge und Importe zählen nicht als „warten auf /ingest"; normale Inbox-Dateien schon
mkdir -p "$V2/00_inbox/_import/alt/Technik"; echo '# a' > "$V2/00_inbox/_import/alt/Technik/a.md"; echo '{}' > "$V2/00_inbox/_import/alt/_import.json"
OUT=$(start "$W/arbeit/nirgends"); echo "$OUT" | grep -q 'Brain-Inbox' && { echo "FAIL: Vorschläge/Importe als Inbox gezählt: [$OUT]"; exit 1; }
echo 'notiz' > "$V2/00_inbox/notiz.md"
OUT=$(start "$W/arbeit/nirgends"); echo "$OUT" | grep -qx 'Brain-Inbox: 1 Datei(en) warten auf /ingest.' || { echo "FAIL: Inbox-Zeile falsch: [$OUT]"; exit 1; }
# ohne stdin (Hand-Aufruf, offenes stdin) darf session-start nicht hängen
S0=$(date +%s); HOME="$TH" USERPROFILE="$TH" BRAIN_VAULT="$V2" BRAIN_SESSION_NUR_STATUS=1 node "$S" < <(sleep 5) >/dev/null; [ $(( $(date +%s) - S0 )) -le 3 ] || { echo "FAIL: session-start wartet auf stdin"; exit 1; }
rm -rf "$W" "$TH"
rm -rf "$(dirname "$V")" "$TH0"
echo "PASS"
