#!/bin/bash
. "$(dirname "$0")/plattform.sh"
# .tools/tests/test-zeig.sh — "brain zeig": erzeugt die Daten für die 3D-Ansicht (Task 1:
# .tools/ansicht/daten.mjs) und meldet den Pfad der Ansicht. --nicht-oeffnen/--nur-daten verhindern
# in Tests, dass ein Browser aufgeht.
set -u; D="$(cd "$(dirname "$0")" && pwd)"; B="$D/../brain.mjs"
T="$(mktemp -d)"; V="$T/Mein Brain"; cp -R "$D/fixture" "$V"
# zeig nutzt die Ansicht des ZIEL-Vaults (<vault>/.tools/ansicht, wie doctor) — darum bekommt jeder Test-Vault
# eine eigene Kopie von .tools (ohne tests/), und brain.mjs läuft absichtlich aus dem Werkzeug-Vault ($B) mit
# BRAIN_VAULT auf den Test-Vault (Fund 3 der Gesamtprüfung: früher Daten hier, Seite dort).
mit_tools() { mkdir -p "$1/.tools"; for e in "$D/.."/* "$D/.."/.[!.]*; do [ -e "$e" ] || continue; [ "$(basename "$e")" = tests ] && continue; cp -R "$e" "$1/.tools/"; done; }
mit_tools "$V"

RC=0; OUT=$(BRAIN_VAULT="$V" node "$B" zeig --nicht-oeffnen) || RC=$?
[ "$RC" = 0 ] || { echo "FAIL: zeig --nicht-oeffnen rc=$RC: $OUT"; exit 1; }
echo "$OUT" | grep -q 'file://' || { echo "FAIL: Ausgabe enthält keine file://-URL: $OUT"; exit 1; }
echo "$OUT" | grep -Eq '\.tools/ansicht/index\.html"?$' || { echo "FAIL: Ausgabe endet nicht auf .tools/ansicht/index.html: $OUT"; exit 1; }
# Die geöffnete Seite liegt im Ziel-Vault (dort, wo auch data.js geschrieben wird), nicht im Werkzeug-Vault
echo "$OUT" | grep -qF "/Mein%20Brain/.tools/ansicht/index.html" || { echo "FAIL: URL zeigt nicht auf <BRAIN_VAULT>/.tools/ansicht: $OUT"; exit 1; }
[ -f "$V/.logs/ansicht/data.js" ] || { echo "FAIL: <vault>/.logs/ansicht/data.js fehlt"; exit 1; }

# --nur-daten: öffnet nichts (keine file://-URL in der Ausgabe), druckt die Seitenzahl
RC=0; OUT=$(BRAIN_VAULT="$V" node "$B" zeig --nur-daten) || RC=$?
[ "$RC" = 0 ] || { echo "FAIL: zeig --nur-daten rc=$RC: $OUT"; exit 1; }
echo "$OUT" | grep -q 'file://' && { echo "FAIL: --nur-daten hat trotzdem eine URL gedruckt: $OUT"; exit 1; }
echo "$OUT" | grep -Eq '^[0-9]+ Seiten, [0-9]+ Verbindungen\.$' || { echo "FAIL: --nur-daten druckt keine Seitenzahl: $OUT"; exit 1; }

# Leerer Vault → Exit 0 (kein Wiki-Ordner, keine Notizen)
LEER="$T/leer"; mkdir -p "$LEER"; mit_tools "$LEER"
RC=0; OUT=$(BRAIN_VAULT="$LEER" node "$B" zeig --nicht-oeffnen) || RC=$?
[ "$RC" = 0 ] || { echo "FAIL: zeig bei leerem Vault rc=$RC: $OUT"; exit 1; }

# Scheitern-Pfad beim tatsächlichen Öffnen (ohne --nicht-oeffnen/--nur-daten): BRAIN_OEFFNER ist ein reiner
# Testhaken (siehe oeffneDatei() in brain.mjs) und ersetzt das Öffner-Programm durch einen garantiert nicht
# existierenden Pfad — kein echter Browser geht auf, spawn() liefert asynchron "error", kein Absturz,
# Scheitern-Satz, Exit 0 (Fund 1 aus dem Review).
# BRAIN_DIENST_AUS=1: Ansicht-Dienst-Start gilt als gescheitert → genau der file://-Rückfall wird geprüft
# (der Dienst selbst: test-dienst.sh) — und es bleibt kein Dienst-Prozess übrig.
RC=0; OUT=$(BRAIN_DIENST_AUS=1 BRAIN_OEFFNER="$T/gibt-es-nicht/kein-programm" BRAIN_VAULT="$V" node "$B" zeig) || RC=$?
[ "$RC" = 0 ] || { echo "FAIL: zeig mit scheiterndem Öffner rc=$RC: $OUT"; exit 1; }
echo "$OUT" | grep -qF "Öffne diese Datei im Browser:" || { echo "FAIL: Scheitern-Satz fehlt: $OUT"; exit 1; }
echo "$OUT" | grep -q 'file://' || { echo "FAIL: Scheitern-Satz ohne file://-URL: $OUT"; exit 1; }

# Erfolgspfad beim tatsächlichen Öffnen: BRAIN_OEFFNER zeigt auf ein echtes, garantiert vorhandenes Programm
# (node selbst) — der Kindprozess startet wirklich (spawn()-Event), auch wenn er danach an der .html-Datei
# scheitert; das genügt für den Erfolgs-Satz.
# Nativer Pfad direkt von Node (C:\… unter Windows) — hängt nicht an der MSYS-Umgebungskonvertierung (Fund 6).
RC=0; OUT=$(BRAIN_DIENST_AUS=1 BRAIN_OEFFNER="$(node -p process.execPath)" BRAIN_VAULT="$V" node "$B" zeig) || RC=$?
[ "$RC" = 0 ] || { echo "FAIL: zeig mit echtem Öffner rc=$RC: $OUT"; exit 1; }
echo "$OUT" | grep -qF "Geöffnet im Browser:" || { echo "FAIL: Erfolgs-Satz fehlt: $OUT"; exit 1; }

# Nicht existierender Vault: verständliche Meldung statt Stacktrace, Exit 1 (Fund 2 aus dem Review)
RC=0; OUT=$(BRAIN_VAULT="$T/gibt-es-nicht-als-vault" node "$B" zeig --nicht-oeffnen 2>&1) || RC=$?
[ "$RC" = 1 ] || { echo "FAIL: zeig bei fehlendem Vault rc=$RC: $OUT"; exit 1; }
echo "$OUT" | grep -qF "Vault nicht gefunden:" || { echo "FAIL: Satz für fehlenden Vault fehlt: $OUT"; exit 1; }
echo "$OUT" | grep -qiE 'ENOENT|at .*\(|stack' && { echo "FAIL: Rohtext/Stacktrace bei fehlendem Vault: $OUT"; exit 1; }

# Unbekannte Option: Exit 2 mit Hinweis statt den Browser zu öffnen (BRAIN_OEFFNER zur Sicherheit gesetzt,
# falls die Prüfung je regrediert — dann soll trotzdem kein echter Browser aufgehen, siehe Hinweis im Review)
RC=0; OUT=$(BRAIN_DIENST_AUS=1 BRAIN_OEFFNER="$T/gibt-es-nicht/kein-programm" BRAIN_VAULT="$V" node "$B" zeig --quatsch 2>&1) || RC=$?
[ "$RC" = 2 ] || { echo "FAIL: zeig mit unbekannter Option rc=$RC: $OUT"; exit 1; }
echo "$OUT" | grep -qF -- "--quatsch" || { echo "FAIL: Hinweis nennt die unbekannte Option nicht: $OUT"; exit 1; }

# Vault ohne eigene Ansicht (.tools/ansicht fehlt): klare Meldung, Exit 1 — auch wenn der Werkzeug-Vault sie hat
OHNE="$T/ohne-ansicht"; cp -R "$D/fixture" "$OHNE"
RC=0; OUT=$(BRAIN_VAULT="$OHNE" node "$B" zeig --nicht-oeffnen 2>&1) || RC=$?
[ "$RC" = 1 ] || { echo "FAIL: zeig ohne <vault>/.tools/ansicht rc=$RC: $OUT"; exit 1; }
echo "$OUT" | grep -qF "noch nicht installiert" || { echo "FAIL: Satz für fehlende Ansicht fehlt: $OUT"; exit 1; }

# Warnungen von daten.mjs (kaputte brain.config.json) landen auf stderr, zeig läuft trotzdem durch (Fund 4)
KAPUTT="$T/kaputt"; cp -R "$D/fixture" "$KAPUTT"; mit_tools "$KAPUTT"
printf '{ "clusters": [ kaputt' > "$KAPUTT/brain.config.json"
RC=0; ERR=$(BRAIN_VAULT="$KAPUTT" node "$B" zeig --nur-daten 2>&1 >/dev/null) || RC=$?
[ "$RC" = 0 ] || { echo "FAIL: zeig mit kaputter Config rc=$RC: $ERR"; exit 1; }
echo "$ERR" | grep -q '^Warnung: brain.config.json ist kaputt' || { echo "FAIL: Warnung zur kaputten Config fehlt auf stderr: $ERR"; exit 1; }
# Doppelte Cluster-ID → Warnung, Exit 0
printf '{ "clusters": [ { "id": "kochen", "name": "Kochen" }, { "id": "kochen", "name": "Nochmal" } ] }\n' > "$KAPUTT/brain.config.json"
RC=0; ERR=$(BRAIN_VAULT="$KAPUTT" node "$B" zeig --nur-daten 2>&1 >/dev/null) || RC=$?
[ "$RC" = 0 ] || { echo "FAIL: zeig mit doppeltem Cluster rc=$RC: $ERR"; exit 1; }
echo "$ERR" | grep -q '^Warnung: Cluster „kochen“ steht doppelt' || { echo "FAIL: Warnung zum doppelten Cluster fehlt: $ERR"; exit 1; }

echo "OK test-zeig"
