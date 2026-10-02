#!/bin/bash
. "$(dirname "$0")/plattform.sh"
# .tools/tests/test-install-safety.sh — Fix round 1 (Koordinator-Review): gefährliche Ziele, echtes
# Argument-Parsing, nie CLAUDE.md/GEMINI.md überschreiben, kaputte Config bricht ab, --profil minimal
# installiert qmd nie.
set -u; D="$(cd "$(dirname "$0")" && pwd)"; T="$(mktemp -d)"; export HOME="$T/home" USERPROFILE="$T/home"; mkdir -p "$HOME"
if [ -f "$D/../kit/export.mjs" ]; then
  node "$D/../kit/export.mjs" "$T/kit" >/dev/null || { echo "FAIL: Export"; exit 1; }
else
  # Exportiertes Kit (evtl. selbst ein git-Checkout): ohne .git kopieren, sonst sähe „.git wurde angelegt"
  # unten den mitkopierten Ordner des Kits statt eines neuen.
  mkdir -p "$T/kit"
  (cd "$D/../.." && tar --exclude=./.git -cf - .) | (cd "$T/kit" && tar -xf -)
fi
INSTALL="$T/kit/install.mjs"
mkdir -p "$T/bin"; printf '#!/bin/bash\nexit 0\n' > "$T/bin/qmd"; chmod +x "$T/bin/qmd"; export PATH="$T/bin:$PATH"

# --- 1. Gefährliche Ziele: exit 1, nichts angelegt/gelöscht, kein git init ------------------------
pruefe_abgelehnt() {
  local ziel="$1" label="$2" gitVorher=0
  [ -d "$ziel/.git" ] && gitVorher=1
  OUT=$(node "$INSTALL" "$ziel" --agent keiner --sprache de --backup keins 2>&1); RC=$?
  [ "$RC" = 1 ] || { echo "FAIL ($label): erwartete exit 1, bekam $RC: $OUT"; exit 1; }
  [ "$gitVorher" = 0 ] && [ -d "$ziel/.git" ] && { echo "FAIL ($label): .git wurde trotzdem angelegt"; exit 1; }
  return 0
}
pruefe_abgelehnt "$HOME" "vault=HOME"
pruefe_abgelehnt "/" "vault=/"
pruefe_abgelehnt "$T/kit" "vault=kitdir"
pruefe_abgelehnt "$T/kit/sub" "vault=kitdir/sub"
# Ziel enthält den Kit-Ordner (Vorfahr) → abgelehnt
pruefe_abgelehnt "$T" "vault=Elternordner des Kits"
# Quell-Vault (Entwicklung: .tools/kit/export.mjs vorhanden) → abgelehnt, mit Satz
QV="$T/quellvault"; mkdir -p "$QV/.tools/kit"; echo '{}' > "$QV/brain.config.json"; : > "$QV/.tools/kit/export.mjs"
OUT=$(node "$INSTALL" "$QV" --agent keiner --sprache de --backup keins 2>&1); RC=$?
[ "$RC" = 1 ] && echo "$OUT" | grep -q "Entwicklungs-Vault" || { echo "FAIL (Quell-Vault): rc=$RC $OUT"; exit 1; }
[ -d "$QV/.git" ] && { echo "FAIL (Quell-Vault): .git angelegt"; exit 1; }
NICHTLEER="$T/nichtleer"; mkdir -p "$NICHTLEER"; echo fremd > "$NICHTLEER/datei.txt"
OUT=$(node "$INSTALL" "$NICHTLEER" --agent keiner --sprache de --backup keins 2>&1); RC=$?
[ "$RC" = 1 ] || { echo "FAIL (nicht leer): erwartete exit 1, bekam $RC: $OUT"; exit 1; }
echo "$OUT" | grep -q "ist nicht leer und kein Brain" || { echo "FAIL (nicht leer): Wortlaut fehlt: $OUT"; exit 1; }
echo "$OUT" | grep -q "Documents/Brain" || { echo "FAIL (nicht leer): Vorschlag muss Documents/Brain nennen (nicht Dokumente): $OUT"; exit 1; }
[ "$(cat "$NICHTLEER/datei.txt")" = "fremd" ] || { echo "FAIL (nicht leer): fremde Datei verändert"; exit 1; }
[ -d "$NICHTLEER/.git" ] && { echo "FAIL (nicht leer): .git wurde trotzdem angelegt"; exit 1; }
HEIM_ANCESTOR="$T/home-ancestor-test"; mkdir -p "$HEIM_ANCESTOR/home2"
HOME="$HEIM_ANCESTOR/home2" USERPROFILE="$HEIM_ANCESTOR/home2" node "$INSTALL" "$HEIM_ANCESTOR" --agent keiner --sprache de --backup keins >/tmp/out-ancestor.$$ 2>&1; RC=$?
rm -f /tmp/out-ancestor.$$
[ "$RC" = 1 ] || { echo "FAIL (ancestor-of-home): erwartete exit 1, bekam $RC"; exit 1; }

# --- 1b. Fix round 2: Groß-/Kleinschreibung darf die Kit-Ordner-Prüfung nicht umgehen — nur relevant
# auf case-insensitiven Dateisystemen (Standard macOS/Windows; auf Linux ist "KIT" dort schlicht ein
# anderer, nicht existenter Pfad und das Verhalten damit kein Sicherheitsthema).
PLATTFORM="$(node -e 'console.log(process.platform)')"
if [ "$PLATTFORM" = "darwin" ] || [ "$PLATTFORM" = "win32" ]; then
  KIT_GROSS="$(dirname "$T")/$(basename "$T" | tr '[:lower:]' '[:upper:]')"
  # $T selbst umbenennen hilft nichts (eigener Name bleibt klein) — stattdessen den Kit-Unterordner
  # in anderer Schreibweise ansprechen: "$T/kit" existiert klein, wir zielen auf "$T/KIT/sub".
  KIT_ANDERE_SCHREIBWEISE="$(dirname "$T/kit")/$(basename "$T/kit" | tr '[:lower:]' '[:upper:]')"
  OUT=$(node "$INSTALL" "$KIT_ANDERE_SCHREIBWEISE/sub" --agent keiner --sprache de --backup keins 2>&1); RC=$?
  [ "$RC" = 1 ] || { echo "FAIL (Kit-Ordner, andere Schreibweise): erwartete exit 1, bekam $RC: $OUT"; exit 1; }
  [ -e "$T/kit/sub" ] && { echo "FAIL (Kit-Ordner, andere Schreibweise): wurde trotzdem im Kit-Ordner angelegt"; exit 1; }
  # HOME in anderer Schreibweise prüfen (gleiches Prinzip, diesmal HOME statt Kit-Ordner).
  HOME_ANDERE_SCHREIBWEISE="$(dirname "$HOME")/$(basename "$HOME" | tr '[:lower:]' '[:upper:]')"
  OUT=$(node "$INSTALL" "$HOME_ANDERE_SCHREIBWEISE" --agent keiner --sprache de --backup keins 2>&1); RC=$?
  [ "$RC" = 1 ] || { echo "FAIL (HOME, andere Schreibweise): erwartete exit 1, bekam $RC: $OUT"; exit 1; }
fi

# --- Bestehender Vault: Reinstall funktioniert weiterhin ------------------------------------------
V="$T/EchterVault"
node "$INSTALL" "$V" --agent keiner --sprache de --backup keins >/dev/null || { echo "FAIL: Erstinstallation"; exit 1; }
node "$INSTALL" "$V" --agent keiner --sprache de --backup keins >/dev/null || { echo "FAIL: Reinstall auf bestehendem Vault"; exit 1; }

# --- 2. Argument-Parsing: Flags vor dem Vault-Pfad, Werte geprüft, ordner:-Pfad absolut -----------
V2="$T/FlagsVorVault"
node "$INSTALL" --agent keiner "$V2" --backup keins >/dev/null || { echo "FAIL: Flags vor Vault-Pfad"; exit 1; }
[ -f "$V2/AGENTS.md" ] || { echo "FAIL: Flags vor Vault-Pfad — nicht installiert"; exit 1; }

OUT=$(node "$INSTALL" "$T/ungueltig" --profil ultra 2>&1); RC=$?
[ "$RC" = 64 ] || { echo "FAIL: ungültiger --profil-Wert sollte exit 64 liefern, bekam $RC: $OUT"; exit 1; }
echo "$OUT" | grep -qi "Nutzung:" || { echo "FAIL: Nutzungszeile fehlt bei ungültigem Wert: $OUT"; exit 1; }
[ -e "$T/ungueltig" ] && { echo "FAIL: ungültiger Aufruf hat trotzdem etwas angelegt"; exit 1; }

OUT=$(node "$INSTALL" "$T/a" "$T/b" 2>&1); RC=$?
[ "$RC" = 64 ] || { echo "FAIL: zwei positionale Argumente sollten exit 64 liefern, bekam $RC: $OUT"; exit 1; }

cd "$T"
V3="$T/OrdnerAbsolut"; mkdir -p usb
node "$INSTALL" "$V3" --agent keiner --sprache de --backup "ordner:usb" >/dev/null || { echo "FAIL: ordner:-Backup (relativ)"; exit 1; }
PFAD=$(node -p "require('$V3/brain.config.json').backup.pfad")
case "$PFAD" in
  /*) : ;;
  *) echo "FAIL: ordner:-Pfad wurde nicht absolut gemacht: $PFAD"; exit 1 ;;
esac
cd - >/dev/null

# --- 3. CLAUDE.md/GEMINI.md: nie überschreiben, im ersten Commit, git status sauber ---------------
V4="$T/NieKlobbern"
node "$INSTALL" "$V4" --agent keiner --sprache de --backup keins >/dev/null || { echo "FAIL: Install für Klobber-Test"; exit 1; }
[ -z "$(git -C "$V4" status --porcelain)" ] || { echo "FAIL: git status nicht sauber direkt nach Install: $(git -C "$V4" status --porcelain)"; exit 1; }
git -C "$V4" show HEAD --name-only | grep -q "^CLAUDE.md$" || { echo "FAIL: CLAUDE.md nicht im ersten Commit"; exit 1; }
git -C "$V4" show HEAD --name-only | grep -q "^GEMINI.md$" || { echo "FAIL: GEMINI.md nicht im ersten Commit"; exit 1; }
echo "# Meine eigene Anleitung, nicht anfassen!" > "$V4/CLAUDE.md"
node "$INSTALL" "$V4" --agent keiner --sprache de --backup keins >/dev/null || { echo "FAIL: Reinstall nach CLAUDE.md-Anpassung"; exit 1; }
[ "$(cat "$V4/CLAUDE.md")" = "# Meine eigene Anleitung, nicht anfassen!" ] || { echo "FAIL: CLAUDE.md wurde überschrieben"; exit 1; }

# --- 2. Fix round 2: "git add --all" für den allerersten Commit — robust gegen gitignorte
# Top-Level-Einträge (z. B. .DS_Store). ".git" entfernen simuliert "wieder frisch", dann committet
# der nächste Lauf trotz eines störenden .DS_Store erneut sauber durch.
rm -rf "$V4/.git"
touch "$V4/.DS_Store"
node "$INSTALL" "$V4" --agent keiner --sprache de --backup keins >/dev/null || { echo "FAIL: Reinstall nach rm -rf .git + .DS_Store"; exit 1; }
git -C "$V4" log -1 >/dev/null 2>&1 || { echo "FAIL: nach rm -rf .git + .DS_Store existiert kein Commit"; exit 1; }

# --- 4. Kaputte brain.config.json: abbrechen, NICHTS umschreiben ----------------------------------
V5="$T/KaputteConfig"; mkdir -p "$V5"; printf '{kaputt' > "$V5/brain.config.json"
OUT=$(node "$INSTALL" "$V5" --agent keiner --sprache de --backup keins 2>&1); RC=$?
[ "$RC" = 1 ] || { echo "FAIL: kaputte Config sollte exit 1 liefern, bekam $RC: $OUT"; exit 1; }
[ "$(cat "$V5/brain.config.json")" = "{kaputt" ] || { echo "FAIL: kaputte Config wurde trotzdem umgeschrieben"; exit 1; }
[ -d "$V5/.git" ] && { echo "FAIL: kaputte Config — .git wurde trotzdem angelegt"; exit 1; }

# --- 3. Fix round 2: gültiges JSON, aber kein Objekt (null/Array/Zahl) bricht genauso ab -----------
for WERT in 'null' '[]' '5' '"ein-string"'; do
  VX="$T/NichtObjekt-$(echo "$WERT" | tr -dc 'a-zA-Z0-9')"; mkdir -p "$VX"; printf '%s' "$WERT" > "$VX/brain.config.json"
  OUT=$(node "$INSTALL" "$VX" --agent keiner --sprache de --backup keins 2>&1); RC=$?
  [ "$RC" = 1 ] || { echo "FAIL: Config '$WERT' (kein Objekt) sollte exit 1 liefern, bekam $RC: $OUT"; exit 1; }
  [ "$(cat "$VX/brain.config.json")" = "$WERT" ] || { echo "FAIL: Config '$WERT' wurde trotzdem umgeschrieben"; exit 1; }
done

# --- 4. Fix round 2: "--backup ordner:" ohne Pfad → exit 64 + Nutzungszeile -----------------------
OUT=$(node "$INSTALL" "$T/leerer-ordner-pfad" --backup "ordner:" 2>&1); RC=$?
[ "$RC" = 64 ] || { echo "FAIL: --backup ordner: ohne Pfad sollte exit 64 liefern, bekam $RC: $OUT"; exit 1; }
echo "$OUT" | grep -qi "Nutzung:" || { echo "FAIL: Nutzungszeile fehlt bei leerem ordner:-Pfad: $OUT"; exit 1; }
[ -e "$T/leerer-ordner-pfad" ] && { echo "FAIL: leerer ordner:-Pfad hat trotzdem etwas angelegt"; exit 1; }

# --- 7. --profil minimal installiert qmd nie (Fake-npm zeichnet Aufrufe auf) ----------------------
FAKENPM="$T/fakenpm"; mkdir -p "$FAKENPM"
NPM_LOG="$T/npm-aufrufe.log"
cat > "$FAKENPM/npm" <<EOF
#!/bin/bash
echo "\$@" >> "$NPM_LOG"
exit 1
EOF
chmod +x "$FAKENPM/npm"
V6="$T/ProfilMinimal"
NODEDIR="$(dirname "$(command -v node)")"
OUT=$(PATH="$FAKENPM:$NODEDIR:/usr/bin:/bin" node "$INSTALL" "$V6" --agent keiner --sprache de --backup keins --profil minimal 2>&1); RC=$?
[ "$RC" = 0 ] || { echo "FAIL: Install mit --profil minimal (eingeschränktes PATH) schlug fehl, rc=$RC: $OUT"; exit 1; }
[ -f "$NPM_LOG" ] && { echo "FAIL: npm wurde trotz --profil minimal aufgerufen: $(cat "$NPM_LOG")"; exit 1; }
[ "$(node -p "require('$V6/brain.config.json').suche.profil")" = "minimal" ] || { echo "FAIL: Profil wurde nicht auf minimal gesetzt"; exit 1; }

# --- 6. Fix round 2: doctor bei Profil minimal — OK statt WARN, kein qmd-Gerede --------------------
DOCTOR_OUT=$(BRAIN_VAULT="$V6" node "$V6/.tools/brain.mjs" doctor)
echo "$DOCTOR_OUT" | grep -q "^OK Suche — Einfache Suche aktiv (bewusst gewählt)\." || { echo "FAIL: doctor zeigt die erwartete OK-Zeile für Profil minimal nicht: $DOCTOR_OUT"; exit 1; }
echo "$DOCTOR_OUT" | grep -qi "^WARN.*qmd" && { echo "FAIL: doctor zeigt trotz Profil minimal ein qmd-WARN: $DOCTOR_OUT"; exit 1; }

echo "OK test-install-safety"
