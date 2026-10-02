#!/bin/bash
# pre-commit über core.hooksPath: blockiert neuen toten Link, lässt sauberen Commit durch, < 10 s, Hook ist 100755.
# Node-Suche des Hooks: PATH → $HOME/.brain-kit/node → sonst blockieren (fail closed).
# Exportierbar: der Test-Vault entsteht aus fixture-neutral + dem aktuellen .tools (kein privates Layout nötig).
set -u; D="$(cd "$(dirname "$0")" && pwd)"; R="$(cd "$D/../.." && pwd)"
if git -C "$R" rev-parse --is-inside-work-tree >/dev/null 2>&1 && git -C "$R" ls-files --error-unmatch .tools/git-hooks/pre-commit >/dev/null 2>&1; then
  [ "$(git -C "$R" ls-files -s .tools/git-hooks/pre-commit | cut -c1-6)" = "100755" ] || { echo "FAIL: pre-commit nicht als ausführbar eingecheckt"; exit 1; }
else
  [ -x "$R/.tools/git-hooks/pre-commit" ] || { echo "FAIL: pre-commit nicht ausführbar"; exit 1; }
fi
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
V="$T/Mein Brain"; mkdir -p "$V"
cp -R "$D/fixture-neutral/." "$V/"
mkdir -p "$V/.tools"; (cd "$R/.tools" && tar --exclude=./tests -cf - .) | (cd "$V/.tools" && tar -xf -)
g(){ git -C "$V" -c user.email=t@t -c user.name=t "$@"; }
# Portable Ersatz für „sed -i ''": Regex-Ersatz, ^/$ wirkt je Zeile; ersetzt nur den ERSTEN Treffer der Datei.
ersetze() { node -e 'const fs=require("fs");const [f,re,ers]=process.argv.slice(1);fs.writeFileSync(f,fs.readFileSync(f,"utf8").replace(new RegExp(re,"m"),ers))' "$@"; }
g init -q; g add --all; g commit -qm init --no-verify
node "$V/.tools/install-git-hooks.mjs" "$V" >/dev/null && [ "$(git -C "$V" config core.hooksPath)" = ".tools/git-hooks" ] || { echo "FAIL: Installer"; exit 1; }
node "$V/.tools/install-git-hooks.mjs" "$V" >/dev/null   # idempotent
P="wiki/firma/amazon/thema_beta.md"
echo '[[gibt_es_garantiert_nicht]]' >> "$V/$P"; ersetze "$V/$P" '^rev: [0-9]+$' 'rev: 99'; g add -- "$P"
S0=$(date +%s); OUT=$(g commit -qm kaputt 2>&1); RC=$?; D0=$(( $(date +%s) - S0 ))
[ $RC -ne 0 ] && echo "$OUT" | grep -q 'TOTER LINK' || { echo "FAIL: kaputter Commit angenommen (rc=$RC): $OUT"; exit 1; }
[ $D0 -lt 10 ] || { echo "FAIL: pre-commit zu langsam (${D0}s)"; exit 1; }
g checkout -q -- "$P" 2>/dev/null; g reset -q --hard HEAD
echo "notiz" > "$V/inbox/probe.md"; g add -- inbox/probe.md; g commit -qm sauber || { echo "FAIL: sauberer Commit abgelehnt"; exit 1; }

# Secret in .env wird über den Hook blockiert
KEY=api_key; VAL=sk-DUMMY1234567890; printf '%s=%s\n' "$KEY" "$VAL" > "$V/.env"; g add -f -- .env
OUT=$(g commit -qm geheim 2>&1) && { echo "FAIL: Secret in .env nicht blockiert"; exit 1; }
echo "$OUT" | grep -q 'SECRETS: .env' || { echo "FAIL: .env-Fundstelle fehlt: $OUT"; exit 1; }
g reset -q -- .env; rm -f "$V/.env"

# Node nicht im PATH, aber unter $HOME/.brain-kit/node → Hook findet es (Commit geht durch)
NODEBIN="$(command -v node)"; H="$T/home"; mkdir -p "$H/.brain-kit/node/bin"; ln -s "$NODEBIN" "$H/.brain-kit/node/bin/node"
# PATH nur mit git + sh (git findet seine Hilfsprogramme über die eigene exec-path)
OHNE="$T/ohne-node"; mkdir -p "$OHNE"; for W in git sh; do ln -sf "$(command -v $W)" "$OHNE/$W"; done
env -i HOME="$H" PATH="$OHNE" /bin/sh -c 'command -v node' >/dev/null 2>&1 && { echo "FAIL: node im Test-PATH"; exit 1; }
echo "x" > "$V/inbox/probe2.md"; g add -- inbox/probe2.md
OUT=$(env -i HOME="$H" PATH="$OHNE" "$OHNE/git" -C "$V" -c user.email=t@t -c user.name=t commit -qm privat-node 2>&1) || { echo "FAIL: Node unter ~/.brain-kit/node nicht gefunden: $OUT"; exit 1; }

# Node nirgends → blockiert mit einem Satz (fail closed)
rm -f "$H/.brain-kit/node/bin/node"
echo "y" > "$V/inbox/probe3.md"; g add -- inbox/probe3.md
RC=0; OUT=$(env -i HOME="$H" PATH="$OHNE" "$OHNE/git" -C "$V" -c user.email=t@t -c user.name=t commit -qm ohne-node 2>&1) || RC=$?
[ $RC -ne 0 ] && echo "$OUT" | grep -q 'Node wurde nicht gefunden' || { echo "FAIL: ohne Node nicht blockiert (rc=$RC): $OUT"; exit 1; }
g reset -q -- inbox/probe3.md; rm -f "$V/inbox/probe3.md"

# Hook ohne Prüfskript (alter Checkout) → Commit geht durch, keine Shell-Fehlermeldung
rm -f "$V/.tools/commit-pruefung.mjs"; echo "x" > "$V/inbox/probe4.md"; g add -- inbox/probe4.md
OUT=$(g commit -qm ohne-skript 2>&1) || { echo "FAIL: fehlendes Prüfskript blockiert: $OUT"; exit 1; }
echo "PASS"
