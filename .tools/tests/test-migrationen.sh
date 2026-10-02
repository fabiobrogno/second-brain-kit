#!/bin/bash
. "$(dirname "$0")/plattform.sh"
# .tools/tests/test-migrationen.sh — die Befehle in migrations/*.md laufen wörtlich so, wie ein Agent sie
# einsetzt: Platzhalter <vault>/<kit-klon> durch absolute Pfade ersetzt, Pfade mit Apostroph (bricht jedes
# JS-String-Literal) und — für die Step-1-Prüfung, außer unter Windows — mit „\v“ im Kit-Ordner (wie
# C:\…\kit\v0.2.0, wo ein Pfad im Literal zum Vertical Tab würde; Skripte selbst lädt Node unter POSIX aus
# einem Ordner mit Backslash im Namen gar nicht, darum nur dort). Prüft außerdem, dass Migration 0.2.0 AGENTS.md und die Codex-Skills neu
# erzeugt (Fund 1 der Gesamtprüfung), bei installiertem Claude-Code-Adapter auch dessen Commands (nur im
# Temp-Home) und kein Pfad mehr in einem JS-Literal steckt (Fund 2).
set -u; D="$(cd "$(dirname "$0")" && pwd)"
if [ -d "$D/../kit/repo" ]; then
  REPO="$D/../kit/repo"; KIT="$(cd "$D/../.." && pwd)"   # privates Monorepo: Kit-Inhalt = dieser Vault
else
  REPO="$(cd "$D/../.." && pwd)"; KIT="$REPO"             # exportiertes Kit: $D/../.. ist die Kit-Wurzel
fi
if [ ! -f "$REPO/migrations/0.2.0.md" ]; then
  echo "SKIP: keine migrations/ neben .tools (installierter Vault) — nichts zu prüfen"; echo "OK test-migrationen"; exit 0
fi

# 1) Statisch: kein Platzhalter direkt hinter einem Anführungszeichen eines JS-Literals ('<vault>…)
TREFFER=$(grep -nE "'<(vault|kit-klon)>" "$REPO"/migrations/*.md || true)
[ -z "$TREFFER" ] || { echo "FAIL: Platzhalter in einem JS-String-Literal (als argv übergeben): $TREFFER"; exit 1; }

T="$(mktemp -d)"
# Eigenes Home für ALLES in diesem Test: Migration 0.2.0 Step 3 liest/schreibt <home>/.claude — nie das echte.
# Windows: homedir() liest USERPROFILE, nicht HOME.
H="$T/home"; mkdir -p "$H"; export HOME="$H" USERPROFILE="$H"
# Hilfsskript: Codeblöcke einer Migration, Platzhalter ersetzt. node bloecke.mjs <md> <vault> <kit-klon> <praefix>
# → druckt die Blöcke, die mit <praefix> beginnen, NUL-getrennt.
cat > "$T/bloecke.mjs" <<'EOF'
import { readFileSync } from "node:fs";
const [md, vault, kit, praefix] = process.argv.slice(2);
const s = readFileSync(md, "utf8").replace(/\r\n/g, "\n");
const bloecke = [...s.matchAll(/^```\n([\s\S]*?)\n```$/gm)].map(m => m[1])
  .filter(b => b.startsWith(praefix))
  .map(b => b.split("<vault>").join(vault).split("<kit-klon>").join(kit));
process.stdout.write(bloecke.join("\0"));
EOF
bloecke() { node "$T/bloecke.mjs" "$@"; }
kopiere_tools() { mkdir -p "$2/.tools"; for e in "$1/.tools"/* "$1/.tools"/.[!.]*; do [ -e "$e" ] || continue; [ "$(basename "$e")" = tests ] && continue; cp -R "$e" "$2/.tools/"; done; }

KK="$T/Anna's kit/v0.2.0"
V="$T/Anna's Brain"
mkdir -p "$KK"; kopiere_tools "$KIT" "$KK"
if [ "$TEST_WIN" = 1 ]; then KB="$KK"; else KB="$T/kit\\v0.2.0"; mkdir -p "$KB/.tools/ansicht"; cp "$KK/.tools/ansicht/index.html" "$KB/.tools/ansicht/"; fi
cp -R "$D/fixture" "$V"; mkdir -p "$V/.agents/skills/update"
printf 'alte AGENTS.md (0.1.0)\n' > "$V/AGENTS.md"
printf -- '---\nname: update\n---\n<!-- brain-kit -->\nalter Skill\n' > "$V/.agents/skills/update/SKILL.md"

# 2) Migration 0.2.0, Block für Block in der Reihenfolge der Datei
M="$REPO/migrations/0.2.0.md"
B=(); while IFS= read -r -d '' b; do B+=("$b"); done < <(bloecke "$M" "$V" "$KK" "node"; printf '\0')
[ "${#B[@]}" = 8 ] || { echo "FAIL: 0.2.0.md hat ${#B[@]} node-Blöcke statt 8 (Step 1, Step 2 ×2 + Prüfung, Step 3 Erkennung + Adapter + Prüfung, Done)"; exit 1; }

RC=0; eval "${B[0]}" || RC=$?
[ "$RC" = 0 ] || { echo "FAIL: Step 1 Prüfung scheitert bei vorhandenem Kit (rc=$RC): ${B[0]}"; exit 1; }
IFS= read -r -d '' B1 < <(bloecke "$M" "$V" "$KB" "node -e"; printf '\0')
RC=0; eval "$B1" || RC=$?
[ "$RC" = 0 ] || { echo "FAIL: Step 1 Prüfung scheitert bei Kit-Ordner mit Backslash (rc=$RC): $B1"; exit 1; }
RC=0; eval "${B[0]//"$KK"/$T/gibt-es-nicht}" || RC=$?
[ "$RC" = 1 ] || { echo "FAIL: Step 1 Prüfung meldet fehlendes Kit nicht (rc=$RC)"; exit 1; }

RC=0; eval "${B[3]}" || RC=$?
[ "$RC" = 1 ] || { echo "FAIL: Step-2-Prüfung erkennt die alte AGENTS.md nicht (rc=$RC)"; exit 1; }
RC=0; OUT=$(eval "${B[1]}" 2>&1) || RC=$?
[ "$RC" = 0 ] || { echo "FAIL: Step 2 (AGENTS.md rendern) rc=$RC: $OUT"; exit 1; }
RC=0; OUT=$(eval "${B[2]}" 2>&1) || RC=$?
[ "$RC" = 0 ] || { echo "FAIL: Step 2 (Codex-Skills rendern) rc=$RC: $OUT"; exit 1; }
RC=0; eval "${B[3]}" || RC=$?
[ "$RC" = 0 ] || { echo "FAIL: Step-2-Prüfung nach dem Rendern rc=$RC"; exit 1; }
grep -q 'brain\.mjs" zeig' "$V/AGENTS.md" || { echo "FAIL: AGENTS.md kennt zeig nicht"; exit 1; }
grep -qF -- '--ziel agents "' "$V/.agents/skills/update/SKILL.md" || { echo "FAIL: Codex-Skill update nicht neu erzeugt (Schritt 6 rendert AGENTS.md)"; exit 1; }
ls "$V/.agents/skills/update/" | grep -q '\.bak-' && { echo "FAIL: eigener Brain-Skill wurde unnötig gesichert"; exit 1; }

# Step 3: Claude-Code-Commands — ohne Adapter (kein brain-update.md im Test-Home) meldet die Erkennung 1
RC=0; eval "${B[4]}" || RC=$?
[ "$RC" = 1 ] || { echo "FAIL: Step 3 erkennt einen Adapter, obwohl keiner installiert ist (rc=$RC)"; exit 1; }
# Fremdes brain-update.md ohne Marke zählt nicht als Adapter
mkdir -p "$H/.claude/commands"; printf 'mein eigener Command\n' > "$H/.claude/commands/brain-update.md"
RC=0; eval "${B[4]}" || RC=$?
[ "$RC" = 1 ] || { echo "FAIL: Step 3 hält ein fremdes brain-update.md für den Adapter (rc=$RC)"; exit 1; }
# 0.1.0-Stand: Adapter-Command mit Marke, alter Skill-Text; fremder Hook in settings.json muss bleiben
printf -- '---\ndescription: alt\n---\n<!-- brain-kit -->\nalter Update-Skill\n' > "$H/.claude/commands/brain-update.md"
printf '{ "hooks": { "Stop": [ { "hooks": [ { "type": "command", "command": "echo fremd" } ] } ] } }\n' > "$H/.claude/settings.json"
RC=0; eval "${B[4]}" || RC=$?
[ "$RC" = 0 ] || { echo "FAIL: Step 3 erkennt den installierten Adapter nicht (rc=$RC)"; exit 1; }
RC=0; eval "${B[6]}" || RC=$?
[ "$RC" = 1 ] || { echo "FAIL: Step-3-Prüfung erkennt den alten Update-Command nicht (rc=$RC)"; exit 1; }
RC=0; OUT=$(eval "${B[5]}" 2>&1) || RC=$?
[ "$RC" = 0 ] || { echo "FAIL: Step 3 (Adapter aus <kit-klon>) rc=$RC: $OUT"; exit 1; }
RC=0; eval "${B[6]}" || RC=$?
[ "$RC" = 0 ] || { echo "FAIL: Step-3-Prüfung nach dem Adapter-Lauf rc=$RC"; exit 1; }
grep -qF -- "adapters/claude-code/install.mjs" "$H/.claude/commands/brain-update.md" || { echo "FAIL: neuer brain-update.md ohne Adapter-Schritt"; exit 1; }
grep -qF "echo fremd" "$H/.claude/settings.json" || { echo "FAIL: fremder Hook in settings.json verloren"; exit 1; }
VF="$(printf '%s' "$V" | tr '\\' '/')"
grep -qF "$VF/.tools/adapters/claude-code/" "$H/.claude/settings.json" || { echo "FAIL: Hooks zeigen nicht auf <vault>/.tools (sondern z. B. auf <kit-klon>)"; exit 1; }
grep -qF "$KK" "$H/.claude/settings.json" && { echo "FAIL: settings.json verweist auf den Kit-Klon"; exit 1; }
# Zweiter Lauf: idempotent, Prüfung bleibt grün
RC=0; OUT=$(eval "${B[5]}" 2>&1) || RC=$?
[ "$RC" = 0 ] || { echo "FAIL: Step 3 zweiter Lauf rc=$RC: $OUT"; exit 1; }
N=$(grep -o 'session-start.mjs' "$H/.claude/settings.json" | wc -l | tr -d ' ')
[ "$N" = 1 ] || { echo "FAIL: SessionStart-Hook nach zweitem Lauf $N-mal statt 1-mal"; exit 1; }

# Update-Skill Schritt 6: .tools ersetzen → Done-Prüfung
rm -rf "$V/.tools"; kopiere_tools "$KK" "$V"
RC=0; OUT=$(eval "${B[7]}" 2>&1) || RC=$?
[ "$RC" = 0 ] || { echo "FAIL: Done-Prüfung (zeig --nur-daten) rc=$RC: $OUT"; exit 1; }
echo "$OUT" | grep -Eq '^[0-9]+ Seiten, [0-9]+ Verbindungen\.$' || { echo "FAIL: Done-Prüfung ohne Seitenzahl: $OUT"; exit 1; }

# doctor bei veralteter AGENTS.md: verweist auf „update mein Brain“ statt „nächste Sitzung automatisch“
# (stimmt ohne Claude Code nicht). update.pruefen=false: kein Versions-Check übers Netz.
node -e "const f=process.argv[1], fs=require('fs'), c=JSON.parse(fs.readFileSync(f,'utf8')); c.update={pruefen:false}; fs.writeFileSync(f, JSON.stringify(c))" "$V/brain.config.json"
printf 'veraltet\n' > "$V/AGENTS.md"
OUT=$(node "$V/.tools/doctor.mjs" 2>&1)
echo "$OUT" | grep -q '^WARN.*AGENTS\.md.*update mein Brain' || { echo "FAIL: doctor-Hinweis bei veralteter AGENTS.md: $OUT"; exit 1; }
echo "$OUT" | grep -q 'nächsten Sitzung automatisch' && { echo "FAIL: doctor verspricht noch die automatische Neuerzeugung: $OUT"; exit 1; }

# 3) Migration 0.1.0: die Prüf-/Setz-Befehle mit node -p/-e (Step 2, Step 3, Done)
V1="$T/Bob's altes Brain"; cp -R "$D/fixture" "$V1"; printf 'x\n' > "$V1/AGENTS.md"
printf '{ "module": { "teamWissen": false } }\n' > "$V1/brain.config.json"
B=(); while IFS= read -r -d '' b; do B+=("$b"); done < <(bloecke "$REPO/migrations/0.1.0.md" "$V1" "$KK" "node -"; printf '\0')
[ "${#B[@]}" = 3 ] || { echo "FAIL: 0.1.0.md hat ${#B[@]} node -p/-e-Blöcke statt 3"; exit 1; }
RC=0; OUT=$(eval "${B[0]}" 2>&1) || RC=$?
[ "$RC" = 0 ] && [ "$OUT" = '{"unbekannteSchluessel":[],"teamWissen":false}' ] || { echo "FAIL: 0.1.0 Step 2 Prüfung rc=$RC: $OUT"; exit 1; }
RC=0; eval "${B[1]}" || RC=$?
[ "$RC" = 0 ] || { echo "FAIL: 0.1.0 Step 3 Prüfung rc=$RC"; exit 1; }
RC=0; eval "${B[2]}" || RC=$?
[ "$RC" = 0 ] || { echo "FAIL: 0.1.0 Done rc=$RC"; exit 1; }
grep -q '"systemVersion": "0.1.0"' "$V1/brain.config.json" || { echo "FAIL: 0.1.0 Done hat systemVersion nicht gesetzt"; exit 1; }

echo "OK test-migrationen"
