#!/bin/bash
set -u; cd "$(dirname "$0")"; G="$(pwd)/../adapters/claude-code/wiki-guard.mjs"
V=$(mktemp -d); mkdir -p "$V/09_wiki" "$V/.logs" "$V/20_firma"; export BRAIN_VAULT="$V"
j(){ printf '{"tool_name":"Edit","cwd":"%s","tool_input":{"file_path":"%s"}}' "$2" "$1"; }
exp(){ local want=$1; shift; printf '%s' "$1" | node "$G" 2>/dev/null; local rc=$?; [ $rc -eq $want ] || { echo "FAIL: erwartet $want, bekam $rc für $1"; exit 1; }; }
exp 2 "$(j "$V/09_wiki/thema_x.md" /)"                         # ohne Lock → blockiert
exp 2 "$(j "$V/09_wiki/_log.md" /)"
exp 2 "$(j "09_wiki/thema_x.md" "$V")"                          # relativer Pfad
exp 2 "$(j "$V/20_firma/../09_wiki/thema_x.md" /)"              # .. im Pfad
exp 2 "$(j "$V/INDEX.md" /)"; exp 2 "$(j "$V/graph.json" /)"; exp 2 "$(j "$V/09_wiki/_index.md" /)"
exp 0 "$(j "$V/20_firma/notiz.md" /)"                           # Rohquelle-Ordner: nicht Sache des Riegels
exp 0 "$(j "/tmp/irgendwas.md" /)"; exp 0 '{"tool_name":"Bash","tool_input":{"command":"ls"}}'; exp 0 'kaputt'
date "+%F %T" > "$V/.logs/ingest.lock"
exp 0 "$(j "$V/09_wiki/thema_x.md" /)"                          # frisches Lock → erlaubt
exp 2 "$(j "$V/INDEX.md" /)"                                    # generiert bleibt verboten
exp 2 "$(j "$V/09_wiki/firma/amazon/_amazon.md" /)"            # generierte Ordner-Übersicht auch mit Lock verboten
exp 0 "$(j "$V/09_wiki/firma/amazon/thema_x.md" /)"            # Seite im Unterordner mit Lock erlaubt
exp 0 "$(j "$V/09_wiki/firma/amazon/_notiz.md" /)"             # _-Datei, die keine Übersicht ist: normale Lock-Regel
exp 0 "$(j "$V/09_wiki/_log.md" /)"                            # handgepflegtes _log mit Lock erlaubt
touch -t "$(date -v-20M +%Y%m%d%H%M)" "$V/.logs/ingest.lock"         # langer Ingest: Lock 20 min alt
exp 0 "$(j "$V/09_wiki/thema_y.md" /)"
[ -z "$(find "$V/.logs/ingest.lock" -mmin +1)" ] || { echo "FAIL: erlaubter Wiki-Schreibzugriff frischt das Lock nicht auf"; exit 1; }
touch -t "$(date -v-31M +%Y%m%d%H%M)" "$V/.logs/ingest.lock"
exp 2 "$(j "$V/09_wiki/thema_x.md" /)"                          # abgelaufenes Lock → blockiert
printf '%s' "$(j "$V/09_wiki/thema_x.md" /)" | node "$G" 2>&1 >/dev/null | grep -q '/ingest' || { echo "FAIL: Begründung fehlt"; exit 1; }
rm -rf "$V"; echo "PASS"
