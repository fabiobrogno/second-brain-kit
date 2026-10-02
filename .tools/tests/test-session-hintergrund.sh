#!/bin/bash
# session-hintergrund.mjs muss bei jedem SessionStart AGENTS.md aus der Vorlage neu erzeugen (sie ist
# nicht getrackt — maschinenlokaler, absoluter Vault-Pfad) und darf dabei nie hart fehlschlagen.
set -u; cd "$(dirname "$0")"; H="$(pwd)/../adapters/claude-code/session-hintergrund.mjs"
V=$(mktemp -d)/"Mein Brain"; mkdir -p "$V"
echo '{}' > "$V/brain.config.json"
export BRAIN_VAULT="$V"
node "$H"
[ -f "$V/AGENTS.md" ] || { echo "FAIL: AGENTS.md wurde nicht erzeugt"; exit 1; }
grep -qF "$V" "$V/AGENTS.md" || { echo "FAIL: AGENTS.md enthält nicht den Vault-Pfad"; exit 1; }
grep -qF "node\" \"$V/.tools/brain.mjs\" search" "$V/AGENTS.md" || { echo "FAIL: Kommando-Pfad nicht gequotet"; cat "$V/AGENTS.md"; exit 1; }
rm -rf "$(dirname "$V")"
echo "PASS"
