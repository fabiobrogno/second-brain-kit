#!/bin/bash
. "$(dirname "$0")/plattform.sh"
# .tools/tests/test-publish-check.sh — generische Regeln von publish-check.mjs (PFAD/EMAIL/ARTIFACT/SECRET/
# INHALT), die Namensliste über --namen, und --historie. Exportiert: läuft ohne privaten Vault, ohne Firmen-
# oder Personennamen im eigenen Quelltext (die würden sich sonst beim eigenen Export selbst melden).
set -u; D="$(cd "$(dirname "$0")" && pwd)"; K="$D/../kit"; T="$(mktemp -d)"
mkdir -p "$T/sauber/vorlage/inbox"; echo "# ok" > "$T/sauber/README.md"; : > "$T/sauber/vorlage/inbox/.gitkeep"
node "$K/publish-check.mjs" "$T/sauber" || { echo "FAIL: sauberes Repo blockiert"; exit 1; }

# Generische Regeln: Testwerte in Teilen aufgebaut (nie als ein Stück im Quelltext) — sonst meldet sich
# diese Datei bei ihrem eigenen Export an der Regel, die sie gerade testet.
arten=(PFAD EMAIL ARTIFACT SECRET)
teil1=("/Users" "jemand@example" "https://claude.ai/art" "api_key")
teil2=("/jemand/vault" ".org" "ifact/abc" "sk-DUMMY9")
sep=("" "" "" "=")
for i in "${!arten[@]}"; do
  art="${arten[$i]}"; inhalt="${teil1[$i]}${sep[$i]}${teil2[$i]}"
  rm -rf "$T/f"; cp -R "$T/sauber" "$T/f"; echo "x $inhalt" >> "$T/f/README.md"
  RC=0; OUT=$(node "$K/publish-check.mjs" "$T/f") || RC=$?
  [ "$RC" = 2 ] && echo "$OUT" | grep -q "^$art: README.md:2" || { echo "FAIL: $art nicht erkannt (rc=$RC) $OUT"; exit 1; }
  echo "$OUT" | grep -qF "$inhalt" && { echo "FAIL: Treffertext ausgegeben ($art)"; exit 1; }
done

# EMAIL-Ausnahme: erlaubte Adresse wird aus der Zeile herausgeschnitten, eine zweite echte Adresse bleibt ein Fund
rm -rf "$T/f"; cp -R "$T/sauber" "$T/f"
NR="noreply"; AT="@"; EX="example.com"; REAL="jemand${AT}wirklich.org"
printf 'kontakt %s%s%s und %s\n' "$NR" "$AT" "$EX" "$REAL" >> "$T/f/README.md"
RC=0; OUT=$(node "$K/publish-check.mjs" "$T/f") || RC=$?
[ "$RC" = 2 ] && echo "$OUT" | grep -q '^EMAIL: README.md:2' || { echo "FAIL: EMAIL-Ausnahme lässt echte Adresse durch (rc=$RC) $OUT"; exit 1; }
echo "$OUT" | grep -qF "$REAL" && { echo "FAIL: Treffertext ausgegeben (EMAIL)"; exit 1; }

# Vault-Inhalt: Datei unterhalb vorlage/, die nicht zum erlaubten Skelett gehört
rm -rf "$T/f"; cp -R "$T/sauber" "$T/f"; echo "# notiz" > "$T/f/vorlage/inbox/privat.md"
RC=0; node "$K/publish-check.mjs" "$T/f" >/dev/null || RC=$?; [ "$RC" = 2 ] || { echo "FAIL: Vault-Inhalt nicht erkannt"; exit 1; }

# Namensliste: ohne --namen nur generische Regeln (kein FIRMA-Fund), mit --namen wird der Name erkannt.
rm -rf "$T/f"; cp -R "$T/sauber" "$T/f"; echo "kontakt bei beispielfirma anfragen" >> "$T/f/README.md"
RC=0; node "$K/publish-check.mjs" "$T/f" >/dev/null || RC=$?; [ "$RC" = 0 ] || { echo "FAIL: FIRMA-Fund ohne Namensliste (rc=$RC)"; exit 1; }
echo "beispielfirma" > "$T/namen.txt"
RC=0; OUT=$(node "$K/publish-check.mjs" "$T/f" --namen "$T/namen.txt") || RC=$?
[ "$RC" = 2 ] && echo "$OUT" | grep -q '^FIRMA: README.md:2' || { echo "FAIL: FIRMA mit --namen nicht erkannt (rc=$RC) $OUT"; exit 1; }

# Ganzwort- vs. Teilstring-Namen: "=name" verlangt eine Wortgrenze beidseitig (auch am Satzzeichen/Zeilenende),
# ein Name ohne "=" bleibt Teilstring überall.
rm -rf "$T/f"; cp -R "$T/sauber" "$T/f"
printf '=beispiel\nfirmax\n' > "$T/namen2.txt"
printf 'Beispiel.\nBeispiel,\n(Beispiel)\nBeispielhaft bleibt unauffaellig\nsuperfirmax taucht auf\nBeispiel\n' > "$T/f/NAMEN.md"
RC=0; OUT=$(node "$K/publish-check.mjs" "$T/f" --namen "$T/namen2.txt") || RC=$?
[ "$RC" = 2 ] || { echo "FAIL: Ganzwort/Teilstring-Mix nicht erkannt (rc=$RC)"; exit 1; }
echo "$OUT" | grep -q '^FIRMA: NAMEN.md:1$' || { echo "FAIL: 'Beispiel.' nicht erkannt"; exit 1; }
echo "$OUT" | grep -q '^FIRMA: NAMEN.md:2$' || { echo "FAIL: 'Beispiel,' nicht erkannt"; exit 1; }
echo "$OUT" | grep -q '^FIRMA: NAMEN.md:3$' || { echo "FAIL: '(Beispiel)' nicht erkannt"; exit 1; }
echo "$OUT" | grep -q '^FIRMA: NAMEN.md:4$' && { echo "FAIL: 'Beispielhaft' fälschlich erkannt"; exit 1; }
echo "$OUT" | grep -q '^FIRMA: NAMEN.md:5$' || { echo "FAIL: Teilstring 'superfirmax' nicht erkannt"; exit 1; }
echo "$OUT" | grep -q '^FIRMA: NAMEN.md:6$' || { echo "FAIL: 'Beispiel' am Zeilenende nicht erkannt"; exit 1; }

# erlaubt: exakte Strings werden NUR vor der FIRMA-Prüfung entfernt, und nur als exaktes Token (keine
# Buchstaben/Ziffern/_/- direkt davor oder danach) — sonst bleibt der Fund stehen.
rm -rf "$T/f"; cp -R "$T/sauber" "$T/f"
printf 'firmax\n' > "$T/namen3.txt"
printf 'firmax/kit\n' > "$T/erlaubt.txt"
printf 'siehe github.com/firmax/kit\nfirmax intern\nfirmax/kit-privat\n' > "$T/f/ERLAUBT.md"
RC=0; OUT=$(node "$K/publish-check.mjs" "$T/f" --namen "$T/namen3.txt" --erlaubt "$T/erlaubt.txt") || RC=$?
[ "$RC" = 2 ] || { echo "FAIL: erlaubt-Test liefert kein Exit 2 (rc=$RC)"; exit 1; }
echo "$OUT" | grep -q '^FIRMA: ERLAUBT.md:1$' && { echo "FAIL: erlaubte Repo-Adresse fälschlich gemeldet"; exit 1; }
echo "$OUT" | grep -q '^FIRMA: ERLAUBT.md:2$' || { echo "FAIL: 'firmax intern' nicht erkannt"; exit 1; }
echo "$OUT" | grep -q '^FIRMA: ERLAUBT.md:3$' || { echo "FAIL: 'firmax/kit-privat' wurde fälschlich entschärft"; exit 1; }
# Ohne --erlaubt bleibt dieselbe Adresse ein Fund (nichts wird global gelockert)
RC=0; OUT2=$(node "$K/publish-check.mjs" "$T/f" --namen "$T/namen3.txt") || RC=$?
[ "$RC" = 2 ] && echo "$OUT2" | grep -q '^FIRMA: ERLAUBT.md:1$' || { echo "FAIL: ohne --erlaubt wird die Adresse übersehen (rc=$RC)"; exit 1; }

# LICENSE-Ausnahme gilt nur für die Copyright-Zeile, nicht für die ganze Datei
rm -rf "$T/f"; cp -R "$T/sauber" "$T/f"
printf 'MIT License\n\nCopyright (c) 2026 Beispielfirma GmbH\n\nSonstige Erwaehnung von Beispielfirma hier\n' > "$T/f/LICENSE"
RC=0; OUT=$(node "$K/publish-check.mjs" "$T/f" --namen "$T/namen.txt") || RC=$?
[ "$RC" = 2 ] && echo "$OUT" | grep -q '^FIRMA: LICENSE:5' || { echo "FAIL: FIRMA in LICENSE außerhalb Copyright-Zeile nicht erkannt (rc=$RC) $OUT"; exit 1; }
echo "$OUT" | grep -q '^FIRMA: LICENSE:3' && { echo "FAIL: Copyright-Zeile fälschlich gemeldet"; exit 1; }

# --historie: ein alter Commit enthält ein (erfundenes) Secret, ein späterer entfernt es wieder —
# die normale Prüfung des aktuellen Stands findet nichts mehr, --historie findet es in der alten Revision.
RH="$(mktemp -d)"
git -C "$RH" init -q; git -C "$RH" config user.email t@example.com; git -C "$RH" config user.name test
HKEY="api_key"; HVAL="sk-DUMMY-HISTORIE"; printf '%s=%s\n' "$HKEY" "$HVAL" > "$RH/geheim.md"
git -C "$RH" add geheim.md; git -C "$RH" commit -q -m "oops"
echo "# bereinigt" > "$RH/geheim.md"; git -C "$RH" add geheim.md; git -C "$RH" commit -q -m "fix"
RC=0; node "$K/publish-check.mjs" "$RH" >/dev/null || RC=$?
[ "$RC" = 0 ] || { echo "FAIL: normale Prüfung findet bereinigten Stand fälschlich (rc=$RC)"; exit 1; }
ART="SECRET"
RC=0; OUT=$(node "$K/publish-check.mjs" --historie "$RH") || RC=$?
[ "$RC" = 2 ] && echo "$OUT" | grep -qE "^${ART}: [0-9a-f]{7}:geheim\\.md:1\$" || { echo "FAIL: --historie findet alte Revision nicht (rc=$RC) $OUT"; exit 1; }
echo "$OUT" | grep -qF "$HVAL" && { echo "FAIL: Treffertext in --historie ausgegeben"; exit 1; }

# Große Datei (deutlich über Nodes Default-maxBuffer von 1 MB) mit Secret am Ende, in einer alten Revision
node -e "process.stdout.write('a'.repeat(1500000))" > "$RH/gross.md"
GKEY="api_key"; GVAL="sk-DUMMY-GROSS"; printf '\n%s=%s\n' "$GKEY" "$GVAL" >> "$RH/gross.md"
git -C "$RH" add gross.md; git -C "$RH" commit -q -m "gross mit secret"
echo "# bereinigt" > "$RH/gross.md"; git -C "$RH" add gross.md; git -C "$RH" commit -q -m "fix gross"

# Textsecret in einer Datei namens x.pdf — Binärerkennung läuft am Inhalt, nicht an der Endung
PKEY="api_key"; PVAL="sk-DUMMY-PDF"; printf '%s=%s\n' "$PKEY" "$PVAL" > "$RH/x.pdf"
git -C "$RH" add x.pdf; git -C "$RH" commit -q -m "secret in pdf-benannter datei"

# Echte Binärdatei mit NUL-Byte — darf nie crashen oder fälschlich als Treffer gemeldet werden
node -e "const b=Buffer.alloc(200); for(let i=0;i<200;i++) b[i]=Math.floor(Math.random()*256); b[50]=0; require('fs').writeFileSync(process.argv[1], b)" "$RH/echo.bin"
git -C "$RH" add echo.bin; git -C "$RH" commit -q -m "binaerdatei"

RC=0; OUT=$(node "$K/publish-check.mjs" --historie "$RH") || RC=$?
[ "$RC" = 2 ] || { echo "FAIL: --historie (erweitert) liefert kein Exit 2 (rc=$RC)"; exit 1; }
echo "$OUT" | grep -qE "^${ART}: [0-9a-f]{7}:gross\\.md:[0-9]+\$" || { echo "FAIL: Secret am Ende einer 1,5-MB-Datei nicht gefunden: $OUT"; exit 1; }
echo "$OUT" | grep -qE "^${ART}: [0-9a-f]{7}:x\\.pdf:1\$" || { echo "FAIL: Textsecret in x.pdf nicht gefunden: $OUT"; exit 1; }
echo "$OUT" | grep -q 'echo\.bin' && { echo "FAIL: Binärdatei fälschlich gemeldet"; exit 1; }
echo "$OUT" | grep -qF "$GVAL" && { echo "FAIL: Treffertext (große Datei) ausgegeben"; exit 1; }
echo "$OUT" | grep -qF "$PVAL" && { echo "FAIL: Treffertext (pdf) ausgegeben"; exit 1; }
rm -rf "$RH"

# Security-Nachbesserung: EMAIL-Regex darf bei einer sehr langen "@"-Zeile nicht katastrophal zurückverfolgen
# (vorher ohne Obergrenze auf Lokalteil/Domain: mehrere Sekunden bis Minuten bei 200 KB ohne gültige Domain).
# Echte Adresse in Teilen aufgebaut (wie REAL oben) — sonst meldet sich diese Zeile beim eigenen Export selbst.
rm -rf "$T/f"; cp -R "$T/sauber" "$T/f"
ECHT="jemand${AT}wirklich.org"
node -e '
  const fs = require("fs");
  const [datei, echt] = process.argv.slice(1);
  const lang = "a".repeat(200000) + "@" + "a".repeat(200000) + " " + echt;
  fs.writeFileSync(datei, lang + "\n");
' "$T/f/GROSS.md" "$ECHT"
S0=$(node -e 'console.log(Date.now())')
RC=0; OUT=$(node "$K/publish-check.mjs" "$T/f") || RC=$?
D0=$(node -e "console.log(Date.now()-$S0)")
[ "$RC" = 2 ] || { echo "FAIL: 200-KB-EMAIL-Zeile liefert kein Exit 2 (rc=$RC)"; exit 1; }
echo "$OUT" | grep -q '^EMAIL: GROSS.md:1$' || { echo "FAIL: echte Adresse am Ende der langen Zeile nicht gefunden: $OUT"; exit 1; }
[ "$D0" -lt 1000 ] || { echo "FAIL: EMAIL-Regex zu langsam bei 200-KB-Zeile (${D0}ms) — Backtracking-Verdacht"; exit 1; }

# Security-Nachbesserung: --historie nutzt ls-tree -z (NUL-getrennt) — ohne -z quotet/escaped git jeden
# Pfad mit Nicht-ASCII-Zeichen, der Fund würde dann einen kaputten statt den echten Pfad zeigen.
# ART (oben = "SECRET") statt des Wortlauts, Schlüssel/Wert wie HKEY/HVAL oben in Teilen — aus demselben Grund.
RU="$(mktemp -d)"
git -C "$RU" init -q; git -C "$RU" config user.email t@example.com; git -C "$RU" config user.name test
UKEY="api_key"; UVAL="sk-DUMMY-UMLAUT"; printf '%s=%s\n' "$UKEY" "$UVAL" > "$RU/geheim_ü.md"
git -C "$RU" add -- "geheim_ü.md"; git -C "$RU" commit -q -m "umlaut-pfad"
RC=0; OUT=$(node "$K/publish-check.mjs" --historie "$RU") || RC=$?
[ "$RC" = 2 ] && echo "$OUT" | grep -qE "^${ART}: [0-9a-f]{7}:geheim_ü\\.md:1\$" || { echo "FAIL: Nicht-ASCII-Pfad in --historie kaputt oder nicht gefunden: $OUT"; exit 1; }
rm -rf "$RU"

echo "OK test-publish-check"
