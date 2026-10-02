#!/bin/bash
. "$(dirname "$0")/plattform.sh"
# .tools/tests/test-module.sh — persönliche Prüfungen nur mit Schalter
set -u; D="$(cd "$(dirname "$0")" && pwd)"; T="$(mktemp -d)/v"; cp -R "$D/fixture" "$T"
mkdir -p "$T/fakehome/.claude/projects/p/memory"
printf '%s\n' $(seq 1 30) > "$T/fakehome/.claude/projects/p/memory/project_x.md"
printf -- '---\nname: b\ndescription: b\ntyp: thema\nquellen: []\nquellen_sha: []\nrev: 1\nteam_id: 1\nsaved_at: 2000-01-01\n---\n# b\n' > "$T/09_wiki/thema_b.md"
OUT=$(HOME="$T/fakehome" USERPROFILE="$T/fakehome" node "$D/../brain-lint.mjs" "$T")
echo "$OUT" | grep -qE 'MEMORY-ROUTING|ALT-BACKLOG|TEAM-DRIFT' && { echo "FAIL: Module ohne Schalter aktiv"; exit 1; }
node -e "const f='$T/brain.config.json',c=require(f);c.module={teamWissen:true,claudeMemory:true};require('fs').writeFileSync(f,JSON.stringify(c))"
OUT=$(HOME="$T/fakehome" USERPROFILE="$T/fakehome" node "$D/../brain-lint.mjs" "$T")
echo "$OUT" | grep -q 'MEMORY-ROUTING' || { echo "FAIL: claudeMemory an, aber kein Befund"; exit 1; }
echo "$OUT" | grep -q 'TEAM-DRIFT' || { echo "FAIL: teamWissen an, aber kein Befund"; exit 1; }
echo "OK test-module"
