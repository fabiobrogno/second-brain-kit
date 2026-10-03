#!/bin/bash
. "$(dirname "$0")/plattform.sh"
# .tools/tests/test-migrationen.sh — die Befehle in migrations/*.md laufen wörtlich so, wie ein Agent sie
# einsetzt: Platzhalter <vault>/<kit-klon> durch absolute Pfade ersetzt, Pfade mit Apostroph (bricht jedes
# JS-String-Literal) und — für die Step-1-Prüfung, außer unter Windows — mit „\v“ im Kit-Ordner (wie
# C:\…\kit\v0.2.0, wo ein Pfad im Literal zum Vertical Tab würde; Skripte selbst lädt Node unter POSIX aus
# einem Ordner mit Backslash im Namen gar nicht, darum nur dort). Prüft außerdem, dass Migration 0.2.0 AGENTS.md und die Codex-Skills neu
# erzeugt (Fund 1 der Gesamtprüfung), bei installiertem Claude-Code-Adapter auch dessen Commands (nur im
# Temp-Home) und kein Pfad mehr in einem JS-Literal steckt (Fund 2). Migration 0.3.0: AGENTS.md neu, ich.md nur
# anlegen (nie überschreiben), Adapter registriert werkzeug-protokoll.mjs (eigenes Temp-Home).
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
# Kit-Klon wie nach dem Export: unter .tools/kit nur AGENTS.md + publish-check.mjs, die Vorlage liegt in
# <kit-klon>/vorlage (export.mjs#zielPfadFuer) — sonst findet eine Migration im Monorepo, was im Kit fehlt.
for e in "$KK/.tools/kit"/* "$KK/.tools/kit"/.[!.]*; do
  [ -e "$e" ] || continue; case "$(basename "$e")" in AGENTS.md|publish-check.mjs) ;; *) rm -rf "$e" ;; esac
done
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

# 4) Migration 0.3.0, Block für Block in der Reihenfolge der Datei — eigenes Temp-Home (0.2-Stand der
# settings.json ohne werkzeug-protokoll.mjs), eigener Vault mit alter AGENTS.md und ohne ich.md.
M3="$REPO/migrations/0.3.0.md"
[ -f "$M3" ] || { echo "FAIL: migrations/0.3.0.md fehlt"; exit 1; }
if [ -d "$D/../kit/vorlage" ]; then VORL="$D/../kit/vorlage"; else VORL="$KIT/vorlage"; fi
mkdir -p "$KK/vorlage/wiki"; cp "$VORL/wiki/ich.md" "$VORL/wiki/_schema.md" "$KK/vorlage/wiki/"
H3="$T/home3"; mkdir -p "$H3"; export HOME="$H3" USERPROFILE="$H3"
V3="$T/Carla's Brain, neu"
cp -R "$D/fixture" "$V3"; printf 'alte AGENTS.md (0.2.0)\n' > "$V3/AGENTS.md"
B=(); while IFS= read -r -d '' b; do B+=("$b"); done < <(bloecke "$M3" "$V3" "$KK" "node"; printf '\0')
[ "${#B[@]}" = 10 ] || { echo "FAIL: 0.3.0.md hat ${#B[@]} node-Blöcke statt 10 (Step 1, Step 2 ×2 + Prüfung, Step 3 + Prüfung, Step 4 Erkennung + Adapter + Prüfung, Done)"; exit 1; }

# Step 1: Kit vollständig / Kit fehlt / Kit-Ordner mit Backslash
RC=0; eval "${B[0]}" || RC=$?
[ "$RC" = 0 ] || { echo "FAIL: 0.3.0 Step 1 Prüfung scheitert bei vorhandenem Kit (rc=$RC): ${B[0]}"; exit 1; }
RC=0; eval "${B[0]//"$KK"/$T/gibt-es-nicht}" || RC=$?
[ "$RC" = 1 ] || { echo "FAIL: 0.3.0 Step 1 Prüfung meldet fehlendes Kit nicht (rc=$RC)"; exit 1; }
if [ "$TEST_WIN" != 1 ]; then
  KB3="$T/kit3\\v0.3.0"
  for f in .tools/ansicht/dienst.mjs .tools/ansicht/steuer.js .tools/import/import.mjs vorlage/wiki/ich.md; do
    mkdir -p "$(dirname "$KB3/$f")"; cp "$KK/$f" "$KB3/$f"
  done
  IFS= read -r -d '' B1 < <(bloecke "$M3" "$V3" "$KB3" "node -e"; printf '\0')
  RC=0; eval "$B1" || RC=$?
  [ "$RC" = 0 ] || { echo "FAIL: 0.3.0 Step 1 Prüfung scheitert bei Kit-Ordner mit Backslash (rc=$RC): $B1"; exit 1; }
fi

# Step 2: AGENTS.md neu rendern
RC=0; eval "${B[3]}" || RC=$?
[ "$RC" = 1 ] || { echo "FAIL: 0.3.0 Step-2-Prüfung erkennt die alte AGENTS.md nicht (rc=$RC)"; exit 1; }
RC=0; OUT=$(eval "${B[1]}" 2>&1) || RC=$?
[ "$RC" = 0 ] || { echo "FAIL: 0.3.0 Step 2 (AGENTS.md rendern) rc=$RC: $OUT"; exit 1; }
RC=0; eval "${B[3]}" || RC=$?
[ "$RC" = 0 ] || { echo "FAIL: 0.3.0 Step-2-Prüfung nach dem Rendern rc=$RC"; exit 1; }
grep -q 'brain\.mjs" import' "$V3/AGENTS.md" || { echo "FAIL: AGENTS.md kennt import nicht"; exit 1; }

# Step 3: ich.md fehlt → angelegt (Wiki-Ordner aus der Config); vorhandene wird nie überschrieben
RC=0; eval "${B[5]}" || RC=$?
[ "$RC" = 1 ] || { echo "FAIL: 0.3.0 Step-3-Prüfung meldet fehlende ich.md nicht (rc=$RC)"; exit 1; }
RC=0; OUT=$(eval "${B[4]}" 2>&1) || RC=$?
[ "$RC" = 0 ] || { echo "FAIL: 0.3.0 Step 3 (ich.md anlegen) rc=$RC: $OUT"; exit 1; }
RC=0; eval "${B[5]}" || RC=$?
[ "$RC" = 0 ] || { echo "FAIL: 0.3.0 Step-3-Prüfung nach dem Anlegen rc=$RC"; exit 1; }
cmp -s "$VORL/wiki/ich.md" "$V3/09_wiki/ich.md" || { echo "FAIL: ich.md nicht aus der Vorlage im Wiki-Ordner der Config angelegt"; exit 1; }
printf 'meine eigene Ich-Karte\n' > "$V3/09_wiki/ich.md"
RC=0; OUT=$(eval "${B[4]}" 2>&1) || RC=$?
[ "$RC" = 0 ] || { echo "FAIL: 0.3.0 Step 3 zweiter Lauf rc=$RC: $OUT"; exit 1; }
[ "$(cat "$V3/09_wiki/ich.md")" = "meine eigene Ich-Karte" ] || { echo "FAIL: vorhandene ich.md wurde überschrieben"; exit 1; }

# Step 4: ohne Adapter (andere KI) → Erkennung 1, Schritt samt Prüfung entfällt
RC=0; eval "${B[6]}" || RC=$?
[ "$RC" = 1 ] || { echo "FAIL: 0.3.0 Step 4 erkennt einen Adapter, obwohl keiner installiert ist (rc=$RC)"; exit 1; }
# 0.2-Stand: Adapter-Command mit Marke, settings.json ohne werkzeug-protokoll, fremder Hook muss bleiben
mkdir -p "$H3/.claude/commands"
printf -- '---\ndescription: alt\n---\n<!-- brain-kit -->\nUpdate-Skill 0.2\n' > "$H3/.claude/commands/brain-update.md"
printf '{ "hooks": { "Stop": [ { "hooks": [ { "type": "command", "command": "echo fremd" } ] } ] } }\n' > "$H3/.claude/settings.json"
RC=0; eval "${B[6]}" || RC=$?
[ "$RC" = 0 ] || { echo "FAIL: 0.3.0 Step 4 erkennt den installierten Adapter nicht (rc=$RC)"; exit 1; }
RC=0; eval "${B[8]}" || RC=$?
[ "$RC" = 1 ] || { echo "FAIL: 0.3.0 Step-4-Prüfung erkennt die fehlenden v0.3-Hooks nicht (rc=$RC)"; exit 1; }
RC=0; OUT=$(eval "${B[7]}" 2>&1) || RC=$?
[ "$RC" = 0 ] || { echo "FAIL: 0.3.0 Step 4 (Adapter aus <kit-klon>) rc=$RC: $OUT"; exit 1; }
RC=0; eval "${B[8]}" || RC=$?
[ "$RC" = 0 ] || { echo "FAIL: 0.3.0 Step-4-Prüfung nach dem Adapter-Lauf rc=$RC"; exit 1; }
grep -qF "echo fremd" "$H3/.claude/settings.json" || { echo "FAIL: 0.3.0 fremder Hook in settings.json verloren"; exit 1; }
grep -qF "ernte-ausloeser.mjs" "$H3/.claude/settings.json" || { echo "FAIL: 0.3.0 Ernte-Auslöser nicht registriert"; exit 1; }
V3F="$(printf '%s' "$V3" | tr '\\' '/')"
grep -qF "$V3F/.tools/adapters/claude-code/werkzeug-protokoll.mjs" "$H3/.claude/settings.json" || { echo "FAIL: werkzeug-protokoll zeigt nicht auf <vault>/.tools"; exit 1; }
grep -qF "$KK" "$H3/.claude/settings.json" && { echo "FAIL: 0.3.0 settings.json verweist auf den Kit-Klon"; exit 1; }
RC=0; OUT=$(eval "${B[7]}" 2>&1) || RC=$?
[ "$RC" = 0 ] || { echo "FAIL: 0.3.0 Step 4 zweiter Lauf rc=$RC: $OUT"; exit 1; }
N=$(grep -o 'werkzeug-protokoll.mjs' "$H3/.claude/settings.json" | wc -l | tr -d ' ')
[ "$N" = 1 ] || { echo "FAIL: werkzeug-protokoll nach zweitem Lauf $N-mal statt 1-mal"; exit 1; }

# Done: .tools ersetzt → Einstellungen lesbar
kopiere_tools "$KK" "$V3"
RC=0; OUT=$(eval "${B[9]}" 2>&1) || RC=$?
[ "$RC" = 0 ] || { echo "FAIL: 0.3.0 Done-Prüfung (einstellungen) rc=$RC: $OUT"; exit 1; }
echo "$OUT" | grep -q '^liveAufleuchten=true' || { echo "FAIL: 0.3.0 Done-Prüfung ohne liveAufleuchten: $OUT"; exit 1; }

# 5) Migration 0.4.0, Block für Block in der Reihenfolge der Datei — eigenes Temp-Home (0.3-Stand: die
# Hook-Dateien ernte-ausloeser.mjs/session-start.mjs sind seit 0.3 registriert, 0.4.0 bringt keine neue
# Hook-Datei, nur neue interne Trigger — der Test prüft deshalb nur den idempotenten Rerun), eigener Vault
# mit alter AGENTS.md. Keine Datenmigration zu prüfen (Spec: „keine Datenmigration").
M4="$REPO/migrations/0.4.0.md"
[ -f "$M4" ] || { echo "FAIL: migrations/0.4.0.md fehlt"; exit 1; }
H4="$T/home4"; mkdir -p "$H4"; export HOME="$H4" USERPROFILE="$H4"
V4="$T/Deniz's Brain, v0.4"
cp -R "$D/fixture" "$V4"; printf 'alte AGENTS.md (0.3.0)\n' > "$V4/AGENTS.md"
B=(); while IFS= read -r -d '' b; do B+=("$b"); done < <(bloecke "$M4" "$V4" "$KK" "node"; printf '\0')
[ "${#B[@]}" = 10 ] || { echo "FAIL: 0.4.0.md hat ${#B[@]} node-Blöcke statt 10 (Step 1, Step 2 ×2 + Prüfung, Step 3 Erkennung + Adapter + Prüfung, Step 4 + Prüfung, Done)"; exit 1; }

# Step 1: Kit vollständig / Kit fehlt
RC=0; eval "${B[0]}" || RC=$?
[ "$RC" = 0 ] || { echo "FAIL: 0.4.0 Step 1 Prüfung scheitert bei vorhandenem Kit (rc=$RC): ${B[0]}"; exit 1; }
RC=0; eval "${B[0]//"$KK"/$T/gibt-es-nicht}" || RC=$?
[ "$RC" = 1 ] || { echo "FAIL: 0.4.0 Step 1 Prüfung meldet fehlendes Kit nicht (rc=$RC)"; exit 1; }

# Step 2: AGENTS.md neu rendern (+ Codex-Skills)
RC=0; eval "${B[3]}" || RC=$?
[ "$RC" = 1 ] || { echo "FAIL: 0.4.0 Step-2-Prüfung erkennt die alte AGENTS.md nicht (rc=$RC)"; exit 1; }
RC=0; OUT=$(eval "${B[1]}" 2>&1) || RC=$?
[ "$RC" = 0 ] || { echo "FAIL: 0.4.0 Step 2 (AGENTS.md rendern) rc=$RC: $OUT"; exit 1; }
RC=0; OUT=$(eval "${B[2]}" 2>&1) || RC=$?
[ "$RC" = 0 ] || { echo "FAIL: 0.4.0 Step 2 (Codex-Skills rendern) rc=$RC: $OUT"; exit 1; }
RC=0; eval "${B[3]}" || RC=$?
[ "$RC" = 0 ] || { echo "FAIL: 0.4.0 Step-2-Prüfung nach dem Rendern rc=$RC"; exit 1; }
grep -qF 'brain.mjs" pflege' "$V4/AGENTS.md" || { echo "FAIL: AGENTS.md kennt pflege nicht"; exit 1; }

# Step 3: ohne Adapter (andere KI) → Erkennung 1, Schritt samt Prüfung entfällt
RC=0; eval "${B[4]}" || RC=$?
[ "$RC" = 1 ] || { echo "FAIL: 0.4.0 Step 3 erkennt einen Adapter, obwohl keiner installiert ist (rc=$RC)"; exit 1; }
# 0.3-Stand: Adapter-Command mit Marke, settings.json noch ohne jeden Brain-Hook, fremder Hook muss bleiben
mkdir -p "$H4/.claude/commands"
printf -- '---\ndescription: alt\n---\n<!-- brain-kit -->\nUpdate-Skill 0.3\n' > "$H4/.claude/commands/brain-update.md"
printf '{ "hooks": { "Stop": [ { "hooks": [ { "type": "command", "command": "echo fremd" } ] } ] } }\n' > "$H4/.claude/settings.json"
RC=0; eval "${B[4]}" || RC=$?
[ "$RC" = 0 ] || { echo "FAIL: 0.4.0 Step 3 erkennt den installierten Adapter nicht (rc=$RC)"; exit 1; }
RC=0; eval "${B[6]}" || RC=$?
[ "$RC" = 1 ] || { echo "FAIL: 0.4.0 Step-3-Prüfung erkennt die fehlenden Hooks nicht (rc=$RC)"; exit 1; }
RC=0; OUT=$(eval "${B[5]}" 2>&1) || RC=$?
[ "$RC" = 0 ] || { echo "FAIL: 0.4.0 Step 3 (Adapter aus <kit-klon>) rc=$RC: $OUT"; exit 1; }
RC=0; eval "${B[6]}" || RC=$?
[ "$RC" = 0 ] || { echo "FAIL: 0.4.0 Step-3-Prüfung nach dem Adapter-Lauf rc=$RC"; exit 1; }
grep -qF "echo fremd" "$H4/.claude/settings.json" || { echo "FAIL: 0.4.0 fremder Hook in settings.json verloren"; exit 1; }
V4F="$(printf '%s' "$V4" | tr '\\' '/')"
grep -qF "$V4F/.tools/adapters/claude-code/ernte-ausloeser.mjs" "$H4/.claude/settings.json" || { echo "FAIL: 0.4.0 ernte-ausloeser zeigt nicht auf <vault>/.tools"; exit 1; }
grep -qF "$KK" "$H4/.claude/settings.json" && { echo "FAIL: 0.4.0 settings.json verweist auf den Kit-Klon"; exit 1; }
# Zweiter Lauf: idempotent (ernte-ausloeser steht für PreCompact UND SessionEnd — 2 ist korrekt, nicht dupliziert)
RC=0; OUT=$(eval "${B[5]}" 2>&1) || RC=$?
[ "$RC" = 0 ] || { echo "FAIL: 0.4.0 Step 3 zweiter Lauf rc=$RC: $OUT"; exit 1; }
N=$(grep -o 'ernte-ausloeser.mjs' "$H4/.claude/settings.json" | wc -l | tr -d ' ')
[ "$N" = 2 ] || { echo "FAIL: ernte-ausloeser nach zweitem Lauf $N-mal statt 2-mal (PreCompact+SessionEnd)"; exit 1; }

# Step 4 (Final-Review #6): ohne _schema.md nichts zu tun; alte _schema.md ohne pruefen_bis → Absatz ergänzt,
# zweiter Lauf ändert nichts; eine Schema-Datei, die pruefen_bis schon erklärt, bleibt byte-gleich.
RC=0; eval "${B[8]}" || RC=$?
[ "$RC" = 0 ] || { echo "FAIL: 0.4.0 Step-4-Prüfung ohne _schema.md rc=$RC"; exit 1; }
RC=0; eval "${B[7]}" || RC=$?
[ "$RC" = 0 ] && [ ! -e "$V4/09_wiki/_schema.md" ] || { echo "FAIL: 0.4.0 Step 4 ohne _schema.md (rc=$RC) oder legt eine an"; exit 1; }
printf '# Wiki-Schema (0.3)\n\n## Frontmatter\nname, description\n' > "$V4/09_wiki/_schema.md"
RC=0; eval "${B[8]}" || RC=$?
[ "$RC" = 1 ] || { echo "FAIL: 0.4.0 Step-4-Prüfung erkennt das alte Schema nicht (rc=$RC)"; exit 1; }
RC=0; OUT=$(eval "${B[7]}" 2>&1) || RC=$?
[ "$RC" = 0 ] || { echo "FAIL: 0.4.0 Step 4 rc=$RC: $OUT"; exit 1; }
RC=0; eval "${B[8]}" || RC=$?
[ "$RC" = 0 ] || { echo "FAIL: 0.4.0 Step-4-Prüfung nach dem Ergänzen rc=$RC"; exit 1; }
grep -q '^# Wiki-Schema (0.3)' "$V4/09_wiki/_schema.md" && grep -q '^- Gültigkeit: `stand: YYYY-MM-DD`' "$V4/09_wiki/_schema.md" \
  || { echo "FAIL: 0.4.0 Step 4 hat den Absatz nicht (oder den alten Inhalt nicht behalten)"; exit 1; }
VORHER=$(cksum < "$V4/09_wiki/_schema.md")
RC=0; eval "${B[7]}" || RC=$?
[ "$RC" = 0 ] && [ "$(cksum < "$V4/09_wiki/_schema.md")" = "$VORHER" ] || { echo "FAIL: 0.4.0 Step 4 zweiter Lauf ändert das Schema (rc=$RC)"; exit 1; }

# Done: .tools ersetzt → Pflegebericht lesbar
kopiere_tools "$KK" "$V4"
RC=0; OUT=$(eval "${B[9]}" 2>&1) || RC=$?
[ "$RC" = 0 ] || { echo "FAIL: 0.4.0 Done-Prüfung (pflege) rc=$RC: $OUT"; exit 1; }
echo "$OUT" | grep -q '^Pflegebericht' || { echo "FAIL: 0.4.0 Done-Prüfung ohne Pflegebericht-Zeile: $OUT"; exit 1; }

echo "OK test-migrationen"
