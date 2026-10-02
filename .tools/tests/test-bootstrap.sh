#!/bin/bash
. "$(dirname "$0")/plattform.sh"
# .tools/tests/test-bootstrap.sh — Einsteiger-Weg mit lokalem Archiv statt Download, ohne node im PATH.
#
# Baut das Test-Kit-Archiv NICHT über kit/export.mjs: der echte Export läuft gegen die private
# brain.config.json (Firmennamen-Scrubber kit.sperrNamen), deren Sperrliste einen Firmennamen
# enthält, der zufällig als Präfix im GitHub-Konto des Maintainers steckt — die vom Controller
# fest vorgegebene öffentliche Kit-Adresse github.com/fbrogno/second-brain-kit trägt diesen
# Präfix und würde den Export ohne Gegenmaßnahme IMMER rot einfärben. Dafür gibt es bereits eine
# bewusste, eng gefasste Ausnahme des Maintainers in `brain.config.json` (`kit.erlaubt`, exaktes
# Token `fbrogno/second-brain-kit`) — keine, die dieser Test oder ein Agent selbst einführen darf.
# Der Bootstrap-Test geht dieser Prüfung trotzdem lieber ganz aus dem Weg: er baut sein Test-Kit
# direkt aus bootstrap.sh/.ps1 + lib/ + einem install.mjs-Stub, ohne über kit/export.mjs und
# publish-check.mjs zu laufen — siehe task-8b-bootstrap-report.md, Abschnitt "Bekannter Konflikt".
set -u; D="$(cd "$(dirname "$0")" && pwd)"; T="$(mktemp -d)"; export HOME="$T/home" USERPROFILE="$T/home"; mkdir -p "$HOME"
mkdir -p "$T/kit/lib"
if [ -d "$D/../kit/repo" ]; then
  REPO="$D/../kit/repo"            # privates Monorepo
else
  REPO="$(cd "$D/../.." && pwd)"   # schon ein exportiertes Kit: $D/../.. ist bereits die Kit-Wurzel
fi
cp "$REPO/bootstrap.sh" "$T/kit/bootstrap.sh"
cp "$REPO/bootstrap.ps1" "$T/kit/bootstrap.ps1"
cp "$REPO/lib/voraussetzungen.mjs" "$T/kit/lib/voraussetzungen.mjs"

# install.mjs bleibt bewusst ein Stub, auch mit dem echten install.mjs daneben (Task 8): dieser Test prüft
# NUR den Bootstrap-Vertrag (Node/Kit besorgen, install.mjs mit den richtigen Flags aufrufen) — das Verhalten
# von install.mjs selbst deckt test-install.sh ab.
cat > "$T/kit/install.mjs" <<'EOF'
#!/usr/bin/env node
// STUB für den Test — der echte install.mjs entsteht in einer anderen Aufgabe und ersetzt diese Datei.
// Verhält sich wie in der Controller-Vorgabe beschrieben: legt den Vault an, protokolliert seine argv
// und schließt mit genau den drei Sätzen aus Spec §3.7.
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
const ziel = process.argv[2];
mkdirSync(ziel, { recursive: true });
writeFileSync(join(ziel, "AGENTS.md"), "# Second Brain\n");
const heim = join(homedir(), ".brain-kit");
mkdirSync(heim, { recursive: true });
writeFileSync(join(heim, "install-argv.json"), JSON.stringify(process.argv.slice(2)));
console.log("Sag mir einfach „merk dir …“.");
console.log("Frag mich, was du wissen willst.");
console.log("Sag „update mein Brain“, wenn es eine neue Version gibt.");
EOF

tar -czf "$T/kit.tar.gz" -C "$T" kit || { echo "FAIL: Archiv"; exit 1; }
NODE_BIN="$(command -v node)"
# Fake-Node-Download: das Kit soll Node nach ~/.brain-kit/node legen; im Test kopieren wir das vorhandene Binary.
OUT=$(PATH="/usr/bin:/bin" BRAIN_KIT_ARCHIV="$T/kit.tar.gz" BRAIN_KIT_NODE_QUELLE="$NODE_BIN" BRAIN_KIT_OHNE_QMD=1 \
  bash "$T/kit/bootstrap.sh" --ziel "$HOME/MeinBrain" --backup keins 2>&1)
RC=$?
# Auf windows-latest läuft derselbe Ablauf über: pwsh -File "$T/kit/bootstrap.ps1" -Ziel "$HOME/MeinBrain" -Backup keins
[ "$RC" = 0 ] || { echo "FAIL: bootstrap rc=$RC: $OUT"; exit 1; }
[ -x "$HOME/.brain-kit/node/bin/node" ] || { echo "FAIL: Node nicht nach ~/.brain-kit"; exit 1; }
[ -f "$HOME/MeinBrain/AGENTS.md" ] || { echo "FAIL: Vault fehlt"; exit 1; }
echo "$OUT" | grep -qiE 'error|exception|stack|ENOENT' && { echo "FAIL: Fachmeldung im Output: $OUT"; exit 1; }
echo "$OUT" | tail -3 | grep -q 'merk dir' || { echo "FAIL: Drei-Sätze-Anleitung fehlt: $OUT"; exit 1; }

# bootstrap muss install.mjs mit ziel + den vereinbarten Flags aufrufen (Interface zum Installer).
node -e "
const fs = require('node:fs');
const a = JSON.parse(fs.readFileSync('$HOME/.brain-kit/install-argv.json', 'utf8'));
const ziel = '$HOME/MeinBrain';
if (a[0] !== ziel) { console.error('FAIL: ziel falsch:', a); process.exit(1); }
const txt = a.join(' ');
for (const f of ['--agent auto', '--profil auto', '--sprache auto', '--backup keins']) {
  if (!txt.includes(f)) { console.error('FAIL: Flag fehlt:', f, '-', a); process.exit(1); }
}
" || exit 1

# Controller-Vorgabe: Ohne --ziel landet der Vault bei "Documents/Brain" (ECHTER Ordnername auf
# macOS/Windows — Finder/Explorer zeigen ihn nur als "Dokumente" AN; "$HOME/Dokumente/Brain" wäre ein
# zweiter, falscher Ordner). Eigenes $HOME, damit nichts mit dem Test oben kollidiert.
HOME2="$T/home2"; mkdir -p "$HOME2"
OUT3=$(HOME="$HOME2" USERPROFILE="$HOME2" PATH="/usr/bin:/bin" BRAIN_KIT_ARCHIV="$T/kit.tar.gz" BRAIN_KIT_NODE_QUELLE="$NODE_BIN" BRAIN_KIT_OHNE_QMD=1 \
  bash "$T/kit/bootstrap.sh" --backup keins 2>&1)
RC3=$?
[ "$RC3" = 0 ] || { echo "FAIL: bootstrap (Default-Ziel) rc=$RC3: $OUT3"; exit 1; }
[ -f "$HOME2/Documents/Brain/AGENTS.md" ] || { echo "FAIL: Default-Ziel ist nicht Documents/Brain: $OUT3"; exit 1; }

# Negativtest (Fix round 1): unbeschreibbares BRAIN_KIT_HOME → kein Fachjargon im Output, Exit 1,
# genau der freundliche Alltagssatz. Simuliert z. B. einen USB-Stick/Ordner ohne Schreibrechte.
SPERR="$T/sperr"; mkdir -p "$SPERR"; chmod 500 "$SPERR"
OUT2=$(PATH="/usr/bin:/bin" BRAIN_KIT_HOME="$SPERR" BRAIN_KIT_ARCHIV="$T/kit.tar.gz" BRAIN_KIT_NODE_QUELLE="$NODE_BIN" \
  bash "$T/kit/bootstrap.sh" --ziel "$HOME/MeinBrain2" --backup keins 2>&1)
RC2=$?
chmod 700 "$SPERR" 2>/dev/null || true
[ "$RC2" = 1 ] || { echo "FAIL: unbeschreibbares Home müsste Exit 1 liefern, rc=$RC2: $OUT2"; exit 1; }
echo "$OUT2" | grep -qi "permission denied" && { echo "FAIL: Permission denied im Output: $OUT2"; exit 1; }
echo "$OUT2" | grep -q "nicht geklappt" || { echo "FAIL: freundlicher Satz fehlt: $OUT2"; exit 1; }

echo "OK test-bootstrap"
