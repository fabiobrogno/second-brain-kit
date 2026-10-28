#!/bin/bash
. "$(dirname "$0")/plattform.sh"
# .tools/tests/test-bootstrap.sh — Einsteiger-Weg mit lokalem Archiv statt Download, ohne node im PATH.
#
# Baut das Test-Kit-Archiv NICHT über kit/export.mjs: der echte Export läuft gegen die private
# brain.config.json (Firmennamen-Scrubber kit.sperrNamen), deren Sperrliste einen Firmennamen
# enthält, der zufällig als Präfix im GitHub-Konto des Maintainers steckt — die vom Controller
# fest vorgegebene öffentliche Kit-Adresse github.com/fabiobrogno/second-brain-kit trägt diesen
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
# Standard-Version der Bootstrap-Skripte = .tools/VERSION (sonst installiert ein neues Release die alte Version)
KV="v$(tr -d '\r\n' < "$D/../VERSION")"
grep -qF "BRAIN_KIT_VERSION:-$KV}" "$REPO/bootstrap.sh" || { echo "FAIL: bootstrap.sh nutzt nicht $KV als Standard"; exit 1; }
grep -qF "\$Version = \"$KV\"" "$REPO/bootstrap.ps1" || { echo "FAIL: bootstrap.ps1 nutzt nicht $KV als Standard"; exit 1; }
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
// STUB_NUR_ARGV: nur argv protokollieren, nichts anlegen (Windows-Default-Ziel = echter Dokumente-Ordner des Rechners)
if (!process.env.STUB_NUR_ARGV) {
  mkdirSync(ziel, { recursive: true });
  writeFileSync(join(ziel, "AGENTS.md"), "# Second Brain\n");
}
const heim = join(homedir(), ".brain-kit");
mkdirSync(heim, { recursive: true });
writeFileSync(join(heim, "install-argv.json"), JSON.stringify(process.argv.slice(2)));
console.log("Sag mir einfach „merk dir …“.");
console.log("Frag mich, was du wissen willst.");
console.log("Sag „update mein Brain“, wenn es eine neue Version gibt.");
EOF

# POSIX-Form: GNU tar hielte "C:/…" für einen entfernten Rechner
tar -czf "$(posixpfad "$T/kit.tar.gz")" -C "$(posixpfad "$T")" kit || { echo "FAIL: Archiv"; exit 1; }

if [ "$TEST_WIN" = 1 ]; then
  # Windows-Weg: bootstrap.ps1 (bootstrap.sh ist der macOS/Linux-Weg). PATH nur mit den Windows-Systemordnern
  # (tar.exe liegt in System32) — also ohne node; pwsh über den vollen Pfad.
  PWSH="$(command -v pwsh)"; NODE_EXE="$(node -p process.execPath)"; SR="$(cygpath -u "$SYSTEMROOT")"
  SYS="$SR/System32:$SR"
  ( PATH="$SYS"; hash -r; command -v node >/dev/null 2>&1 ) && { echo "FAIL: node im Test-PATH"; exit 1; }
  # Windows-Pfade VORHER berechnen: in den Präfix-Zuweisungen unten gälte schon PATH="$SYS" (kein cygpath)
  ARCHIV_W="$(cygpath -w "$T/kit.tar.gz")"; PS1_W="$(cygpath -w "$T/kit/bootstrap.ps1")"
  ps1() { PATH="$SYS" BRAIN_KIT_ARCHIV="$ARCHIV_W" BRAIN_KIT_NODE_QUELLE="$NODE_EXE" BRAIN_KIT_OHNE_QMD=1 \
    "$PWSH" -NoProfile -NonInteractive -File "$PS1_W" "$@" 2>&1; }
  ZIEL_W="$(cygpath -w "$HOME/MeinBrain")"
  OUT=$(ps1 -Ziel "$ZIEL_W" -Backup keins); RC=$?
  [ "$RC" = 0 ] || { echo "FAIL: bootstrap.ps1 rc=$RC: $OUT"; exit 1; }
  [ -f "$HOME/.brain-kit/node/node.exe" ] || { echo "FAIL: Node nicht nach ~/.brain-kit/node"; exit 1; }
  [ -f "$HOME/MeinBrain/AGENTS.md" ] || { echo "FAIL: Vault fehlt"; exit 1; }
  echo "$OUT" | grep -qiE 'error|exception|stack|ENOENT' && { echo "FAIL: Fachmeldung im Output: $OUT"; exit 1; }
  echo "$OUT" | tail -3 | grep -q 'merk dir' || { echo "FAIL: Drei-Sätze-Anleitung fehlt: $OUT"; exit 1; }
  pruef_argv() { node -e "
const a = JSON.parse(require('node:fs').readFileSync(process.argv[1], 'utf8'));
if (a[0] !== process.argv[2]) { console.error('FAIL: ziel falsch:', a, 'erwartet', process.argv[2]); process.exit(1); }
const txt = a.join(' ');
for (const f of ['--agent auto', '--profil auto', '--sprache auto', '--backup keins']) if (!txt.includes(f)) { console.error('FAIL: Flag fehlt:', f, a); process.exit(1); }
" "$1" "$2"; }
  pruef_argv "$HOME/.brain-kit/install-argv.json" "$ZIEL_W" || exit 1
  # Ohne -Ziel: [Environment]::GetFolderPath('MyDocuments')\Brain — der echte Dokumente-Ordner (auch OneDrive-
  # umgeleitet) lässt sich per Umgebung nicht umbiegen, darum legt der Stub hier nichts an und protokolliert nur.
  # Eigenes Profil ohne Documents-Ordner: GetFolderPath liefert dann "" → Rückfall %USERPROFILE%\Documents\Brain.
  HOME2="$T/home2"; mkdir -p "$HOME2"; HOME2_W="$(cygpath -w "$HOME2")"
  DOK="$(USERPROFILE="$HOME2_W" "$PWSH" -NoProfile -NonInteractive -Command "[Environment]::GetFolderPath('MyDocuments')" | tr -d "\r")"
  [ -n "$DOK" ] || DOK="$HOME2_W\\Documents"
  OUT3=$(USERPROFILE="$HOME2_W" STUB_NUR_ARGV=1 ps1 -Backup keins); RC3=$?
  [ "$RC3" = 0 ] || { echo "FAIL: bootstrap.ps1 (Default-Ziel) rc=$RC3: $OUT3"; exit 1; }
  pruef_argv "$HOME2/.brain-kit/install-argv.json" "$DOK\\Brain" || { echo "FAIL: Default-Ziel ist nicht Documents\\Brain"; exit 1; }
  # Negativtest: BRAIN_KIT_HOME ist eine Datei (nicht anlegbar) → Exit 1, genau der freundliche Satz, kein Fachjargon
  SPERR="$T/sperr-datei"; : > "$SPERR"
  SPERR_W="$(cygpath -w "$SPERR")"; ZIEL2_W="$(cygpath -w "$HOME/MeinBrain2")"
  OUT2=$(BRAIN_KIT_HOME="$SPERR_W" ps1 -Ziel "$ZIEL2_W" -Backup keins); RC2=$?
  [ "$RC2" = 1 ] || { echo "FAIL: nicht anlegbares Home müsste Exit 1 liefern, rc=$RC2: $OUT2"; exit 1; }
  echo "$OUT2" | grep -qiE 'exception|permission denied|at line' && { echo "FAIL: Fachmeldung im Output: $OUT2"; exit 1; }
  echo "$OUT2" | grep -q "nicht geklappt" || { echo "FAIL: freundlicher Satz fehlt: $OUT2"; exit 1; }
  echo "OK test-bootstrap (Windows, bootstrap.ps1)"
  exit 0
fi
NODE_BIN="$(command -v node)"
# Fake-Node-Download: das Kit soll Node nach ~/.brain-kit/node legen; im Test kopieren wir das vorhandene Binary.
OUT=$(PATH="/usr/bin:/bin" BRAIN_KIT_ARCHIV="$T/kit.tar.gz" BRAIN_KIT_NODE_QUELLE="$NODE_BIN" BRAIN_KIT_OHNE_QMD=1 \
  bash "$T/kit/bootstrap.sh" --ziel "$HOME/MeinBrain" --backup keins 2>&1)
RC=$?
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
