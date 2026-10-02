#!/bin/bash
. "$(dirname "$0")/plattform.sh"
# .tools/tests/test-cli.sh
set -u; D="$(cd "$(dirname "$0")" && pwd)"; B="$D/../brain.mjs"; T="$(mktemp -d)/Mein Brain"; cp -R "$D/fixture" "$T"
[ "$(node "$B" version)" = "$(tr -d "\r" < "$D/../VERSION")" ] || { echo "FAIL: version"; exit 1; }
RC=0; node "$B" gibtsnicht >/dev/null 2>&1 || RC=$?; [ "$RC" = 64 ] || { echo "FAIL: unbekannter Befehl rc=$RC"; exit 1; }
BRAIN_VAULT="$T" node "$B" index >/dev/null || { echo "FAIL: index"; exit 1; }
KEY=api_key; VAL=sk-DUMMY1; printf '%s=%s\n' "$KEY" "$VAL" > "$T/x.md"; RC=0; node "$B" ingest-check "$T/x.md" >/dev/null || RC=$?; [ "$RC" = 3 ] || { echo "FAIL: ingest-check rc=$RC"; exit 1; }
# Ohne qmd: Profil minimal (reine JS-Suche) findet trotzdem; Hinweis auf stderr; kein Stacktrace
# PATH nur mit node (der Homebrew-Ordner enthält sonst auch qmd)
mkdir -p "$T/nurnode"
if [ "${OS:-}" = "Windows_NT" ]; then cp "$(command -v node)" "$T/nurnode/node.exe"; else ln -s "$(command -v node)" "$T/nurnode/node"; fi
RC=0; OUT=$(PATH="/usr/bin:/bin:$(posixpfad "$T/nurnode")" BRAIN_VAULT="$T" node "$B" search "Testthema Alpha" 2>"$T/err") || RC=$?
[ "$RC" = 0 ] && echo "$OUT" | grep -q 'thema_alpha.md' && grep -q 'einfache Suche' "$T/err" && ! grep -q '    at ' "$T/err" || { echo "FAIL: ohne qmd rc=$RC: $OUT $(cat "$T/err")"; exit 1; }
# refresh ohne qmd darf nie fehlschlagen: Hinweis auf stderr, exit 0, kein Stacktrace
RC=0; PATH="/usr/bin:/bin:$(posixpfad "$T/nurnode")" BRAIN_VAULT="$T" node "$B" refresh >/dev/null 2>"$T/err-refresh" || RC=$?
[ "$RC" = 0 ] && grep -q 'Suchindex' "$T/err-refresh" && ! grep -q '    at ' "$T/err-refresh" || { echo "FAIL: refresh ohne qmd rc=$RC: $(cat "$T/err-refresh")"; exit 1; }
# Mit Fake-qmd: Profil leicht ruft search + vsearch, nicht query
mkdir -p "$T/bin"
if [ "${OS:-}" = "Windows_NT" ]; then
  # Windows: spawnSync kann .cmd/.bat ohne shell:true nicht direkt starten (CVE-2024-27980). qmdBefehl()
  # sucht deshalb nur die EXISTENZ von qmd.cmd im PATH (Inhalt egal) und löst daneben über
  # node_modules/@tobilu/qmd/package.json (bin-Feld) den echten JS-Entry auf, gestartet per `node <entry>`.
  : > "$T/bin/qmd.cmd"
  mkdir -p "$T/bin/node_modules/@tobilu/qmd"
  printf '{"name":"@tobilu/qmd","bin":{"qmd":"fake.mjs"}}' > "$T/bin/node_modules/@tobilu/qmd/package.json"
  cat > "$T/bin/node_modules/@tobilu/qmd/fake.mjs" <<'EOF'
import { appendFileSync } from "node:fs";
appendFileSync(process.env.FAKE_QMD_AUFRUFE, process.argv[2] + "\n");
console.log("#a,0.9,qmd://brain/10_projekte/alpha/notiz-a.md");
EOF
  export FAKE_QMD_AUFRUFE="$T/aufrufe"
else
  printf '#!/bin/bash\necho "$1" >> "%s/aufrufe"\necho "#a,0.9,qmd://brain/10_projekte/alpha/notiz-a.md"\n' "$T" > "$T/bin/qmd"; chmod +x "$T/bin/qmd"
fi
PATH="$(posixpfad "$T/bin"):$PATH" BRAIN_VAULT="$T" node "$B" search "alpha" | grep -q 'notiz-a.md' || { echo "FAIL: search Ausgabe"; exit 1; }
grep -qx search "$T/aufrufe" && grep -qx vsearch "$T/aufrufe" && ! grep -qx query "$T/aufrufe" || { echo "FAIL: Profil leicht"; exit 1; }
# Skill-Helfer (plattformneutral statt date/rm -f/shasum)
J=$(BRAIN_VAULT="$T" node "$B" jetzt); echo "$J" | grep -Eq '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}$' || { echo "FAIL: jetzt-Format: $J"; exit 1; }
rm -f "$T/.logs/ingest.lock"
BRAIN_VAULT="$T" node "$B" lock >/dev/null || { echo "FAIL: lock"; exit 1; }
[ -f "$T/.logs/ingest.lock" ] && grep -Eq '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}$' "$T/.logs/ingest.lock" || { echo "FAIL: Lock-Datei/Zeitstempel"; exit 1; }
RC=0; OUT=$(BRAIN_VAULT="$T" node "$B" lock) || RC=$?
[ "$RC" = 1 ] && echo "$OUT" | grep -q 'andere Sitzung' || { echo "FAIL: frischer Lock nicht respektiert rc=$RC $OUT"; exit 1; }
touch -t 202601010000 "$T/.logs/ingest.lock"
BRAIN_VAULT="$T" node "$B" lock | grep -q 'liegengeblieben' || { echo "FAIL: alter Lock nicht übernommen"; exit 1; }
BRAIN_VAULT="$T" node "$B" unlock >/dev/null && [ ! -e "$T/.logs/ingest.lock" ] || { echo "FAIL: unlock"; exit 1; }
BRAIN_VAULT="$T" node "$B" unlock >/dev/null || { echo "FAIL: unlock ohne Lock"; exit 1; }
printf 'abc' > "$T/sha.txt"; [ "$(node "$B" sha "$T/sha.txt")" = "ba7816bf8f01cfea" ] || { echo "FAIL: sha"; exit 1; }
RC=0; node "$B" sha "$T/gibtsnicht" >/dev/null 2>&1 || RC=$?; [ "$RC" = 64 ] || { echo "FAIL: sha ohne Datei rc=$RC"; exit 1; }
BRAIN_VAULT="$T" node "$B" review-erledigt >/dev/null && [ -f "$T/.logs/letzter-review" ] || { echo "FAIL: review-erledigt"; exit 1; }
# Update-Prüfung abschaltbar: update.pruefen=false → kein Netz, klare Zeile
cp "$T/brain.config.json" "$T/cfg.bak"
node -e 'const f=process.argv[1],c=JSON.parse(require("fs").readFileSync(f,"utf8"));c.update={pruefen:false};require("fs").writeFileSync(f,JSON.stringify(c))' "$T/brain.config.json"
OUT=$(BRAIN_UPDATE_QUELLE="$T/gibtsnicht.json" BRAIN_VAULT="$T" node "$B" update-check); echo "$OUT" | grep -q 'ausgeschaltet' || { echo "FAIL: update.pruefen=false: $OUT"; exit 1; }
cp "$T/cfg.bak" "$T/brain.config.json"
# Quell-Vault (Entwicklung): doctor meldet OK statt FEHLT bei fehlender systemVersion
mkdir -p "$T/.tools/kit"; : > "$T/.tools/kit/export.mjs"
OUT=$(BRAIN_VAULT="$T" node "$B" doctor 2>&1); echo "$OUT" | grep -q '^OK Quell-Vault (Entwicklung) — systemVersion nicht nötig$' || { echo "FAIL: doctor Quell-Vault: $OUT"; exit 1; }
echo "$OUT" | grep -q '^FEHLT Einstellungsdatei' && { echo "FAIL: doctor FEHLT trotz Quell-Vault"; exit 1; }
rm -rf "$T/.tools"
echo "OK test-cli"
