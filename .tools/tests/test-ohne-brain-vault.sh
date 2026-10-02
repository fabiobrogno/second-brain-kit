#!/bin/bash
# .tools/tests/test-ohne-brain-vault.sh — ohne BRAIN_VAULT findet jedes Werkzeug den Vault über seinen eigenen Ort:
# Kit nach $HOME/Documents/Brain installiert (frisches $HOME), dann brain search|lint|doctor|index,
# session-start und wiki-guard ohne BRAIN_VAULT → richtiger Vault, nie ein ~/brain angelegt.
set -u; D="$(cd "$(dirname "$0")" && pwd)"; T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
export HOME="$T/home"; mkdir -p "$HOME/.claude"; unset BRAIN_VAULT
if [ -f "$D/../kit/export.mjs" ]; then
  node "$D/../kit/export.mjs" "$T/kit" >/dev/null || { echo "FAIL: Export"; exit 1; }
else
  mkdir -p "$T/kit"; (cd "$D/../.." && tar --exclude=./.git -cf - .) | (cd "$T/kit" && tar -xf -)
fi
V="$HOME/Documents/Brain"
BRAIN_KIT_OHNE_QMD=1 node "$T/kit/install.mjs" "$V" --agent claude-code --profil minimal --backup keins >/dev/null || { echo "FAIL: install"; exit 1; }
B="$V/.tools/brain.mjs"
# Aus einem fremden Arbeitsordner aufrufen — der Vault darf nicht vom cwd abhängen
cd "$T"
echo "# Leuchtturm-Notiz" > "$V/inbox/leuchtturm.md"
node "$B" index >/dev/null || { echo "FAIL: index"; exit 1; }
[ -f "$V/INDEX.md" ] || { echo "FAIL: index schrieb nicht in den Vault"; exit 1; }
node "$B" search "Leuchtturm" 2>/dev/null | grep -q 'inbox/leuchtturm.md' || { echo "FAIL: search findet die Notiz im Vault nicht"; exit 1; }
node "$B" lint >/dev/null 2>&1; RC=$?; [ "$RC" = 0 ] || [ "$RC" = 2 ] || { echo "FAIL: lint rc=$RC"; exit 1; }
OUT=$(node "$B" doctor 2>&1); echo "$OUT" | grep -q '^FEHLT' && { echo "FAIL: doctor meldet FEHLT: $OUT"; exit 1; }
echo "$OUT" | grep -q "Einstellungsdatei — gültig, Version" || { echo "FAIL: doctor prüft nicht den installierten Vault: $OUT"; exit 1; }
# session-start (wie Claude Code ihn aufruft: ohne Argument, ohne BRAIN_VAULT) schreibt ins richtige .logs
BRAIN_SESSION_NUR_STATUS=1 node "$V/.tools/adapters/claude-code/session-start.mjs" >/dev/null
grep -q 'session-start' "$V/.logs/hooks.log" 2>/dev/null || { echo "FAIL: session-start schrieb nicht nach $V/.logs"; exit 1; }
# wiki-guard schützt den Wiki-Ordner DIESES Vaults (ohne Lock blockiert, fremder Ordner frei)
j(){ printf '{"tool_name":"Edit","cwd":"/","tool_input":{"file_path":"%s"}}' "$1"; }
RC=0; j "$V/wiki/neu.md" | node "$V/.tools/adapters/claude-code/wiki-guard.mjs" 2>/dev/null || RC=$?
[ "$RC" = 2 ] || { echo "FAIL: wiki-guard schützt $V/wiki nicht (rc=$RC)"; exit 1; }
RC=0; j "$HOME/brain/09_wiki/x.md" | node "$V/.tools/adapters/claude-code/wiki-guard.mjs" 2>/dev/null || RC=$?
[ "$RC" = 0 ] || { echo "FAIL: wiki-guard blockiert einen fremden Pfad (rc=$RC)"; exit 1; }
# Hinweis-Zeilen und gerenderte Befehle nennen den echten Vault, nie ~/brain
grep -q '~/brain\|\$HOME/brain' "$V/AGENTS.md" && { echo "FAIL: AGENTS.md nennt ~/brain"; exit 1; }
grep -q "$V/.tools/brain.mjs" "$V/AGENTS.md" || { echo "FAIL: AGENTS.md nennt den Vault nicht"; exit 1; }
[ -e "$HOME/brain" ] && { echo "FAIL: ~/brain wurde angelegt"; exit 1; }
echo "OK test-ohne-brain-vault"
