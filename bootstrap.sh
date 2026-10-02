#!/bin/sh
# bootstrap.sh — Einsteiger-Weg ohne Admin-Rechte (macOS/Linux): Node besorgen, Kit laden, install.mjs starten.
# Kein rohes Werkzeug-Fehlerbild darf das Terminal erreichen: jeder externe Aufruf schreibt nach $LOG
# und ist mit "|| fehler <schritt>" abgesichert; fehler() gibt genau einen Alltagssatz aus und beendet mit 1.
set -eu
# Echter Ordnername auf macOS/Windows ist "Documents" — Finder/Explorer zeigen ihn nur lokalisiert als
# "Dokumente" AN; "$HOME/Dokumente" wäre ein zweiter, falscher Ordner. Linux-Desktops mit eigenem
# lokalisierten Pfad (z. B. ~/Dokumente) lösen wir über xdg-user-dir auf, wenn vorhanden. Ist dort kein
# Dokumente-Ordner eingetragen, antwortet xdg-user-dir mit dem Home selbst — dann bleibt es bei Documents
# (sonst läge das Brain lose als ~/Brain direkt im Home).
DOKUMENTE="$HOME/Documents"
if command -v xdg-user-dir >/dev/null 2>&1; then
  X=$(xdg-user-dir DOCUMENTS 2>/dev/null || true)
  [ -n "$X" ] && [ "${X%/}" != "${HOME%/}" ] && DOKUMENTE="$X"
fi
ZIEL="$DOKUMENTE/Brain"; BACKUP="keins"; V="${BRAIN_KIT_VERSION:-v0.1.0}"
while [ $# -gt 0 ]; do case "$1" in --ziel) ZIEL="$2"; shift 2;; --backup) BACKUP="$2"; shift 2;; --version) V="$2"; shift 2;; *) shift;; esac; done
HEIM="${BRAIN_KIT_HOME:-$HOME/.brain-kit}"
LOG="$HEIM/install.log"

fehler() {
  echo "Die Einrichtung hat nicht geklappt — Details stehen in $LOG. Sag deiner KI: „Die Brain-Installation ist fehlgeschlagen, schau ins Log.“"
  exit 1
}
melde() { echo "$1"; echo "$1" >>"$LOG" 2>/dev/null || true; }

# Schreibbarkeits-Check zuerst über "test -w" (kein Dateizugriff) — eine fehlgeschlagene Umleitung
# selbst würde ihre rohe Fehlermeldung ("Permission denied") am 2>/dev/null vorbei aufs Terminal bringen.
mkdir -p "$HEIM" 2>/dev/null || fehler "Ordner anlegen"
[ -w "$HEIM" ] || fehler "Ordner beschreibbar machen"
echo "--- bootstrap $(date) ---" >>"$LOG" 2>/dev/null || true
melde "Ich richte dein Second Brain ein, das dauert ein paar Minuten."

NODE_OK=0
if command -v node >/dev/null 2>&1; then
  MAJ=$(node -e 'console.log(process.versions.node.split(".")[0])' 2>/dev/null || echo 0)
  [ "$MAJ" -ge 20 ] 2>/dev/null && NODE_OK=1
fi
if [ "$NODE_OK" = 0 ]; then
  melde "Ich lade Node (die Technik dahinter) für dich herunter ..."
  mkdir -p "$HEIM/node/bin" >>"$LOG" 2>&1 || fehler "Node-Ordner anlegen"
  if [ -n "${BRAIN_KIT_NODE_QUELLE:-}" ]; then
    Q=$(command -v realpath >/dev/null 2>&1 && realpath "$BRAIN_KIT_NODE_QUELLE" || echo "$BRAIN_KIT_NODE_QUELLE")
    cp "$Q" "$HEIM/node/bin/node" >>"$LOG" 2>&1 || fehler "Node kopieren"
    chmod +x "$HEIM/node/bin/node" >>"$LOG" 2>&1 || fehler "Node ausführbar machen"
    # Dynamisch gelinkte Node-Installationen (z. B. Paketmanager) brauchen ihre libnode-Datei daneben —
    # NUR die einzelne Datei, nie der ganze Ordner (der könnte z. B. /usr sein).
    P="$(dirname "$(dirname "$Q")")"
    for L in "$P"/lib/libnode*.dylib "$P"/lib/libnode*.so*; do
      if [ -f "$L" ]; then
        mkdir -p "$HEIM/node/lib" >>"$LOG" 2>&1 || fehler "Node-Bibliothek anlegen"
        cp "$L" "$HEIM/node/lib/" >>"$LOG" 2>&1 || fehler "Node-Bibliothek kopieren"
      fi
    done
  else
    OS=linux; [ "$(uname -s)" = "Darwin" ] && OS=darwin
    ARCH=$(uname -m); case "$ARCH" in x86_64) ARCH=x64;; arm64|aarch64) ARCH=arm64;; esac
    ENDUNG=tar.xz; [ "$OS" = "linux" ] && ! command -v xz >/dev/null 2>&1 && ENDUNG=tar.gz
    NV=22.11.0; NAME="node-v$NV-$OS-$ARCH"
    curl -fsSL "https://nodejs.org/dist/v$NV/$NAME.$ENDUNG" -o "$HEIM/$NAME.$ENDUNG" >>"$LOG" 2>&1 || fehler "Node herunterladen"
    curl -fsSL "https://nodejs.org/dist/v$NV/SHASUMS256.txt" -o "$HEIM/SHASUMS256.txt" >>"$LOG" 2>&1 || fehler "Prüfsumme herunterladen"
    SUM=$( (shasum -a 256 "$HEIM/$NAME.$ENDUNG" 2>/dev/null || sha256sum "$HEIM/$NAME.$ENDUNG") | cut -d' ' -f1)
    grep -q "^$SUM  $NAME.$ENDUNG\$" "$HEIM/SHASUMS256.txt" 2>>"$LOG" || fehler "Prüfsumme stimmt nicht"
    tar -xf "$HEIM/$NAME.$ENDUNG" -C "$HEIM/node" --strip-components=1 >>"$LOG" 2>&1 || fehler "Node entpacken"
  fi
fi
PATH="$HEIM/node/bin:$PATH"; export PATH

ARCHIV="${BRAIN_KIT_ARCHIV:-}"
if [ -z "$ARCHIV" ]; then
  melde "Ich lade das Second-Brain-Kit herunter ..."
  ARCHIV="$HEIM/kit-$V.tar.gz"
  curl -fsSL "https://github.com/fbrogno/second-brain-kit/archive/refs/tags/$V.tar.gz" -o "$ARCHIV" >>"$LOG" 2>&1 || fehler "Kit herunterladen"
fi
KITDIR="$HEIM/kit/$V"
mkdir -p "$KITDIR" >>"$LOG" 2>&1 || fehler "Kit-Ordner anlegen"
tar -xzf "$ARCHIV" -C "$KITDIR" --strip-components=1 >>"$LOG" 2>&1 || fehler "Kit entpacken"

melde "Ich richte dein Brain ein ..."
node "$KITDIR/install.mjs" "$ZIEL" --agent auto --profil auto --sprache auto --backup "$BACKUP" || fehler "Installation"
