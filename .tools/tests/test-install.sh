#!/bin/bash
. "$(dirname "$0")/plattform.sh"
# .tools/tests/test-install.sh — frisches $HOME, Fake-qmd, zweimal installieren
set -u; D="$(cd "$(dirname "$0")" && pwd)"; T="$(mktemp -d)"; export HOME="$T/home" USERPROFILE="$T/home"; mkdir -p "$HOME/.claude"
if [ -f "$D/../kit/export.mjs" ]; then
  # Privates Monorepo: frisch exportieren, damit der Test isoliert gegen eine echte Export-Kopie läuft.
  node "$D/../kit/export.mjs" "$T/kit" >/dev/null || { echo "FAIL: Export"; exit 1; }
else
  # Schon ein exportiertes Kit (z. B. CI gegen das öffentliche Repo) — export.mjs gibt es hier nicht
  # mehr (maintainer-only), $D/../.. ist bereits die fertige Kit-Wurzel, kein Re-Export nötig.
  mkdir -p "$T/kit"
  (cd "$D/../.." && tar --exclude=./.git -cf - .) | (cd "$T/kit" && tar -xf -)
fi
mkdir -p "$T/bin"; printf '#!/bin/bash\nexit 0\n' > "$T/bin/qmd"; chmod +x "$T/bin/qmd"; export PATH="$T/bin:$PATH"
V="$HOME/Mein Brain"
OUT=$(node "$T/kit/install.mjs" "$V" --agent claude-code --sprache de --profil leicht --backup keins 2>&1) || { echo "FAIL: install 1: $OUT"; exit 1; }
for p in inbox wiki/_schema.md AGENTS.md brain.config.json .tools/brain.mjs; do [ -e "$V/$p" ] || { echo "FAIL: fehlt $p"; exit 1; }; done
[ "$(git -C "$V" config core.hooksPath)" = ".tools/git-hooks" ] || { echo "FAIL: pre-commit nicht aktiv"; exit 1; }
[ "$(node -p "require('$V/brain.config.json').systemVersion")" = "0.1.0" ] || { echo "FAIL: systemVersion"; exit 1; }
echo "# meine notiz" > "$V/inbox/eigen.md"
OUT=$(node "$T/kit/install.mjs" "$V" --agent claude-code --sprache de --profil leicht --backup keins 2>&1) || { echo "FAIL: install 2: $OUT"; exit 1; }
[ "$(cat "$V/inbox/eigen.md")" = "# meine notiz" ] || { echo "FAIL: Notiz überschrieben"; exit 1; }
[ "$(ls "$HOME/.claude" | grep -c 'settings.json.bak-')" -le 1 ] || { echo "FAIL: zweiter Lauf hat settings erneut geändert"; exit 1; }
BRAIN_VAULT="$V" node "$V/.tools/brain.mjs" doctor | grep -q '^FEHLT' && { echo "FAIL: doctor meldet FEHLT"; exit 1; }

# --- Fix round 1 (Review): werkzeuge.git/werkzeuge.node in brain.config.json, wenn private Werkzeuge
# im Spiel waren — andere Felder (systemVersion/sprache/suche/backup) bleiben dabei unberührt. -----

# Normalfall (oben, "$V"): echtes System-git + echter System-Node → gar kein werkzeuge-Schlüssel.
node -e "
const cfg = require('$V/brain.config.json');
if (cfg.werkzeuge) { console.error('FAIL: werkzeuge im Normalfall gesetzt:', JSON.stringify(cfg.werkzeuge)); process.exit(1); }
" || exit 1

# werkzeuge.node: Lauf über einen "privaten" Node (<BRAIN_KIT_HOME>/node/bin/node), gleiche Technik wie
# test-bootstrap.sh (echtes System-Node-Binary an den privaten Ort kopieren) — inklusive derselben
# libnode-Mitnahme wie bootstrap.sh: ein dynamisch gelinktes System-Node (z. B. Homebrew) braucht seine
# libnode-Datei daneben, sonst bricht es nach dem Kopieren mit "Library not loaded" ab.
NODE_BIN="$(command -v node)"
V4="$HOME/Privater Node"
HEIM4="$T/heim-node"; mkdir -p "$HEIM4/node/bin"
cp "$NODE_BIN" "$HEIM4/node/bin/node"; chmod +x "$HEIM4/node/bin/node"
P="$(dirname "$(dirname "$NODE_BIN")")"
for L in "$P"/lib/libnode*.dylib "$P"/lib/libnode*.so*; do
  [ -f "$L" ] && { mkdir -p "$HEIM4/node/lib"; cp "$L" "$HEIM4/node/lib/"; }
done
BRAIN_KIT_HOME="$HEIM4" "$HEIM4/node/bin/node" "$T/kit/install.mjs" "$V4" --agent keiner --sprache de --profil minimal --backup keins >/dev/null \
  || { echo "FAIL: install mit privatem Node"; exit 1; }
WZ_NODE=$(node -p "const c=require('$V4/brain.config.json'); (c.werkzeuge && c.werkzeuge.node) || ''")
# process.execPath ist IMMER real aufgelöst (macOS: $TMPDIR real unter /private/...) — der gespeicherte
# Wert also ebenso; erwarteter Pfad hier daher auch über realpath, nicht der rohe mktemp-Pfad.
WZ_NODE_ERWARTET=$(node -e "console.log(require('node:fs').realpathSync('$HEIM4/node/bin/node'))")
[ "$WZ_NODE" = "$WZ_NODE_ERWARTET" ] || { echo "FAIL: werkzeuge.node fehlt/falsch: '$WZ_NODE' erwartet '$WZ_NODE_ERWARTET'"; exit 1; }
[ "$(node -p "require('$V4/brain.config.json').sprache")" = "de" ] || { echo "FAIL: sprache wurde durch die werkzeuge-Logik verändert"; exit 1; }

# werkzeuge.git: Lauf mit erzwungenem win32-Zweig + lokaler Fixture-"Quelle" (keine echte Installation;
# siehe BRAIN_KIT_GIT_PLATTFORM/BRAIN_KIT_GIT_QUELLE-Kommentar in install.mjs). HOME bleibt der sandboxte
# Test-Ordner von oben — sorgeFuerGit() legt seinen Zielordner unter homedir()/.brain-kit an.
V5="$HOME/Privates MinGit"
echo "keine echte Zip, nur zum Pfad-Test" > "$T/fake-mingit.zip"
BRAIN_KIT_GIT_PLATTFORM=win32 BRAIN_KIT_GIT_QUELLE="$T/fake-mingit.zip" BRAIN_KIT_GIT_SIMULIERE_FEHLEND=1 \
  node "$T/kit/install.mjs" "$V5" --agent keiner --sprache de --profil minimal --backup keins >/dev/null \
  || { echo "FAIL: install mit erzwungenem MinGit-Zweig"; exit 1; }
WZ_GIT=$(node -p "const c=require('$V5/brain.config.json'); (c.werkzeuge && c.werkzeuge.git) || ''")
echo "$WZ_GIT" | grep -q '\.brain-kit/git/cmd/git\.exe$' || { echo "FAIL: werkzeuge.git fehlt/falsch: '$WZ_GIT'"; exit 1; }
[ "$(node -p "require('$V5/brain.config.json').backup.art")" = "keins" ] || { echo "FAIL: backup wurde durch die werkzeuge-Logik verändert"; exit 1; }

echo "OK test-install"
