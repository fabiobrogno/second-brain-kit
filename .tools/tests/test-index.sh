#!/bin/bash
set -e; cd "$(dirname "$0")/fixture"
# Portable Ersatz für `sed -i '' '$d'` (BSD-spezifisch, bricht unter GNU/Windows): letzte Zeile löschen.
# Unterschied zu sed: der abschließende Zeilenumbruch der Ausgabe richtet sich strikt danach, ob die Originaldatei mit \n endete — GNU/BSD sed können das bei '$d' leicht unterschiedlich handhaben.
letzte_zeile_weg() { node -e 'const fs=require("fs");const f=process.argv[1];const s=fs.readFileSync(f,"utf8");const hadNL=s.endsWith("\n");const lines=s.replace(/\n$/,"").split("\n");lines.pop();fs.writeFileSync(f,lines.length?lines.join("\n")+(hadNL?"\n":""):"")' "$@"; }
node ../../brain-index.mjs .
grep -q '10_projekte' INDEX.md                        || { echo "FAIL: Cluster fehlt in INDEX.md"; exit 1; }
grep -q '00_inbox' INDEX.md                           || { echo "FAIL: Inbox fehlt"; exit 1; }
! grep -q '90_archiv' INDEX.md                        || { echo "FAIL: Archiv darf nicht in INDEX.md"; exit 1; }
grep -q 'thema_alpha' 09_wiki/_index.md               || { echo "FAIL: Wiki-Index fehlt/leer"; exit 1; }
grep -q 'Testthema Alpha' 09_wiki/_index.md           || { echo "FAIL: description nicht übernommen"; exit 1; }
node -e "const g=require('./graph.json'); if(!g.nodes.some(n=>n.id.includes('notiz-a'))) process.exit(1); if(!g.edges.length) process.exit(2)" || { echo "FAIL: graph.json Knoten/Kanten"; exit 1; }
cp INDEX.md /tmp/brain-idx-1 && cp graph.json /tmp/brain-graph-1 && node ../../brain-index.mjs . && diff /tmp/brain-idx-1 INDEX.md && diff /tmp/brain-graph-1 graph.json || { echo "FAIL: nicht deterministisch"; exit 1; }
node -e "const g=require('./graph.json'); if(g.nodes.some(n=>n.id==='INDEX.md'||n.id.endsWith('_index.md'))) process.exit(1)" || { echo "FAIL: generierte Dateien im Graph"; exit 1; }
node -e "
const m=require('./.logs/wiki-map.json');
if(m.paths['09-wiki/thema-alpha.md']!=='09_wiki/thema_alpha.md') process.exit(1);
if(m.pages['09_wiki/thema_alpha.md'].description!=='Testthema Alpha') process.exit(2);
if(m.bySource['10_projekte/alpha/notiz-a.md'][0]!=='09_wiki/thema_alpha.md') process.exit(3);
if(m.pages['09_wiki/_index.md']) process.exit(4);" || { echo "FAIL: wiki-map.json"; exit 1; }
grep -q 'Testthema Alpha' .logs/hint-karten/thema_alpha.md || { echo "FAIL: Karteikarte fehlt"; exit 1; }
node -e "const m=require('./.logs/wiki-map.json'); if(m.paths['thema-alpha.md']!=='09_wiki/thema_alpha.md') process.exit(1)" || { echo "FAIL: Kartenpfad nicht in wiki-map"; exit 1; }
echo "# alt" > .logs/hint-karten/thema_geloescht.md && node ../../brain-index.mjs . >/dev/null
[ ! -e .logs/hint-karten/thema_geloescht.md ] || { echo "FAIL: verwaiste Karteikarte bleibt liegen"; exit 1; }
for n in $(seq 1 3000); do echo x > .logs/hint-karten/thema_waise$n.md; done   # Waisen: paralleles Löschen derselben Karte
for i in 1 2 3 4 5 6; do node ../../brain-index.mjs . >/dev/null 2>/tmp/brain-par-$i.err & done; wait
cat /tmp/brain-par-*.err | grep -q . && { echo "FAIL: paralleler Indexer-Lauf crasht"; cat /tmp/brain-par-*.err; exit 1; }
ls *.tmp .logs/*.tmp 09_wiki/*.tmp 2>/dev/null | grep -q . && { echo "FAIL: Tempdateien übrig"; exit 1; }
touch -t 202001010000 INDEX.md 09_wiki/_index.md graph.json .logs/wiki-map.json && node ../../brain-index.mjs . >/dev/null
node -e 'const fs=require("fs");const cutoff=Date.parse("2021-01-01");const neu=process.argv.slice(1).filter(f=>{try{return fs.statSync(f).mtimeMs>cutoff}catch{return false}});if(neu.length){console.error(neu.join("\n"));process.exit(1)}' INDEX.md 09_wiki/_index.md graph.json .logs/wiki-map.json || { echo "FAIL: Indexer schreibt unveränderte Dateien neu (mtime ändert sich)"; exit 1; }
mkdir -p .logs && touch -t 202001010000 .logs/search-refreshed
node ../../brain-lint.mjs . | grep -q 'SUCHINDEX:' || { echo "FAIL: veralteter Suchindex nicht gemeldet"; exit 1; }
echo '{"ziel":{"positiv":20,"still":19,"kontrolle_still":27,"p95ms":2000},"positiv":[],"negativ":[]}' > .logs/eval-ziel.json
echo "hint-eval 2026-01-01 positiv=25/29 still=20/20 kontrolle=24/30 holdout=10/30 p95ms=900" > .logs/hint-eval.log
BRAIN_EVAL_ZIEL=.logs/eval-ziel.json node ../../brain-lint.mjs . | grep -q 'HINWEIS-QUALITÄT:.*kontrolle' || { echo "FAIL: Kontrolle unter Ziel nicht gemeldet"; exit 1; }
echo "hint-eval 2026-01-01 positiv=25/29 still=20/20 kontrolle=28/30 holdout=10/30 p95ms=900" > .logs/hint-eval.log
BRAIN_EVAL_ZIEL=.logs/eval-ziel.json node ../../brain-lint.mjs . | grep -q 'HINWEIS-QUALITÄT' && { echo "FAIL: Holdout darf Lint nie auslösen"; exit 1; }
rm -f .logs/eval-ziel.json
rm -f .logs/search-refreshed .logs/hint-eval.log
# Etappe 3.2: Unterordner
grep -q '^## firma/amazon' 09_wiki/_index.md || { echo "FAIL: _index nicht nach Ordner gruppiert"; exit 1; }
grep -q '(firma/amazon/thema_beta.md)' 09_wiki/_index.md || { echo "FAIL: _index-Link nicht relativ zu 09_wiki"; exit 1; }
[ -f 09_wiki/firma/amazon/_amazon.md ] || { echo "FAIL: Ordner-Übersicht _amazon.md fehlt"; exit 1; }
grep -q '(thema_beta.md)' 09_wiki/firma/amazon/_amazon.md && grep -q 'Testentität Gamma' 09_wiki/firma/amazon/_amazon.md || { echo "FAIL: _amazon.md Inhalt"; exit 1; }
mkdir -p 09_wiki/wissen; node ../../brain-index.mjs . >/dev/null
grep -q '(../firma/amazon/thema_beta.md)' 09_wiki/wissen/_wissen.md || { echo "FAIL: auch-Bezug fehlt in _wissen.md"; exit 1; }
node -e "const g=require('./graph.json'); if(g.nodes.some(n=>/\/_amazon\.md$/.test(n.id))) process.exit(1); if(!g.edges.some(e=>e.source.endsWith('thema_beta.md')&&e.target.endsWith('entitaet_gamma.md'))) process.exit(2)" || { echo "FAIL: Graph (Übersicht als Knoten oder Kante fehlt)"; exit 1; }
[ -f .logs/hint-karten/thema_beta.md ] && [ ! -f .logs/hint-karten/_amazon.md ] || { echo "FAIL: Karten für Unterordner"; exit 1; }
printf -- '---\nname: ueberblick\ndescription: Überblick\ntyp: ueberblick\nquellen: []\nquellen_sha: []\nrev: 1\n---\n# Überblick\n' > 09_wiki/ueberblick.md
node ../../brain-index.mjs . >/dev/null; [ ! -f .logs/hint-karten/ueberblick.md ] || { echo "FAIL: ueberblick darf keine Karte haben"; rm -f 09_wiki/ueberblick.md; exit 1; }
rm -f 09_wiki/ueberblick.md
mkdir -p 09_wiki/leer && echo "# alt" > 09_wiki/leer/_leer.md && node ../../brain-index.mjs . >/dev/null
[ ! -f 09_wiki/leer/_leer.md ] || { echo "FAIL: verwaiste Ordner-Übersicht bleibt"; exit 1; }
rm -f 09_wiki/wissen/_wissen.md; rmdir 09_wiki/leer 09_wiki/wissen
node ../../brain-index.mjs . >/dev/null
# Etappe 3.2: Lint findet Seiten in Unterordnern, tote Links, Doppelnamen, falsches auch
echo 'Kaputt: [[gibt_es_nicht]]' >> 09_wiki/firma/amazon/entitaet_gamma.md
node ../../brain-lint.mjs . > /tmp/brain-lint-3-2.txt || true
letzte_zeile_weg 09_wiki/firma/amazon/entitaet_gamma.md
grep -q 'TOTER LINK: firma/amazon/entitaet_gamma.md → \[\[gibt_es_nicht\]\]' /tmp/brain-lint-3-2.txt || { echo "FAIL: toter Link in Unterordner nicht gemeldet"; exit 1; }
grep -q 'AUCH: firma/amazon/thema_beta.md → wissen' /tmp/brain-lint-3-2.txt || { echo "FAIL: auch auf fehlenden Ordner nicht gemeldet"; exit 1; }
mkdir -p 20_firma && echo "# Doppel" > 20_firma/thema_beta.md
{ node ../../brain-lint.mjs . || true; } | grep -q 'DOPPELTER NAME:.*thema_beta.md' || { echo "FAIL: Doppelname nicht gemeldet"; rm -f 20_firma/thema_beta.md; exit 1; }
rm -f 20_firma/thema_beta.md; rmdir 20_firma 2>/dev/null || true
{ node ../../brain-lint.mjs . || true; } | grep -qE 'TOTER LINK|DOPPELTER NAME' && { echo "FAIL: Fehlalarm nach Bereinigung"; exit 1; }
printf -- '---\nname: ueberblick\ndescription: Überblick\ntyp: ueberblick\nquellen: []\nquellen_sha: []\nrev: 1\n---\n# Überblick\n' > 09_wiki/ueberblick.md
{ node ../../brain-lint.mjs . || true; } | grep -q 'VERWAIST: ueberblick.md' && { echo "FAIL: ueberblick als Waise gemeldet"; rm -f 09_wiki/ueberblick.md; exit 1; }
rm -f 09_wiki/ueberblick.md; node ../../brain-index.mjs . >/dev/null
# Etappe 3.2: Ordner-Regel (aktiv mit wiki.ordnerPflicht)
cp brain.config.json /tmp/brain-fixture-cfg.bak
node -e "const f='brain.config.json',c=JSON.parse(require('fs').readFileSync(f,'utf8'));c.wiki={...c.wiki,ordnerPflicht:true};require('fs').writeFileSync(f,JSON.stringify(c,null,2))"
{ node ../../brain-lint.mjs . || true; } > /tmp/brain-lint-ordner.txt; cp /tmp/brain-fixture-cfg.bak brain.config.json
grep -q 'ORDNER: thema_alpha.md liegt direkt in 09_wiki' /tmp/brain-lint-ordner.txt || { echo "FAIL: Ordner-Regel greift nicht"; exit 1; }
grep -q 'ORDNER: firma/amazon' /tmp/brain-lint-ordner.txt && { echo "FAIL: Seite im Ordner fälschlich gemeldet"; exit 1; }
{ node ../../brain-lint.mjs . || true; } | grep -q 'ORDNER:' && { echo "FAIL: Ordner-Regel ohne ordnerPflicht aktiv"; exit 1; }
# Review-Fix 4: auch mit Pfad aus dem Wiki heraus schreibt nichts außerhalb, Lint meldet es
printf -- '---\nname: boese\ndescription: Böse\ntyp: thema\nquellen: []\nquellen_sha: []\nauch: ["../ausserhalb"]\nrev: 1\n---\n# Böse\n\n[[thema_alpha]]\n' > 09_wiki/firma/amazon/thema_boese.md
mkdir -p ausserhalb; node ../../brain-index.mjs . >/dev/null
[ ! -e ausserhalb/_ausserhalb.md ] || { echo "FAIL: auch schreibt außerhalb des Wikis"; rm -rf ausserhalb 09_wiki/firma/amazon/thema_boese.md; exit 1; }
{ node ../../brain-lint.mjs . || true; } | grep -q 'AUCH: firma/amazon/thema_boese.md → ../ausserhalb' || { echo "FAIL: ungültiges auch nicht gemeldet"; rm -rf ausserhalb 09_wiki/firma/amazon/thema_boese.md; exit 1; }
rm -rf ausserhalb 09_wiki/firma/amazon/thema_boese.md; node ../../brain-index.mjs . >/dev/null
# Etappe 3.4: --struktur ohne Indexer-Lauf, nur blockierende Klassen, Exit 2 bei Befund
rm -f graph.json; echo 'Kaputt: [[gibt_es_nicht]]' >> 09_wiki/firma/amazon/entitaet_gamma.md
S0=$(node -e 'console.log(Date.now())'); RC=0; node ../../brain-lint.mjs . --struktur > /tmp/brain-struktur.txt || RC=$?; D0=$(node -e "console.log(Math.round((Date.now()-$S0)/100)/10)")
letzte_zeile_weg 09_wiki/firma/amazon/entitaet_gamma.md
[ $RC -eq 2 ] && grep -q 'TOTER LINK: firma/amazon/entitaet_gamma.md' /tmp/brain-struktur.txt || { echo "FAIL: --struktur meldet toten Link nicht (rc=$RC)"; exit 1; }
grep -qE 'VERWAIST|INBOX|HINWEIS|ALT-BACKLOG' /tmp/brain-struktur.txt && { echo "FAIL: --struktur enthält informative Befunde"; exit 1; }
[ ! -e graph.json ] || { echo "FAIL: --struktur hat den Indexer laufen lassen"; exit 1; }
node -e "process.exit($D0 < 2 ? 0 : 1)" || { echo "FAIL: --struktur zu langsam (${D0}s)"; exit 1; }
mkdir -p 09_wiki/wissen; RC=0; node ../../brain-lint.mjs . --struktur >/dev/null || RC=$?; rmdir 09_wiki/wissen; [ $RC -eq 0 ] || { echo "FAIL: --struktur ohne Befund nicht Exit 0"; exit 1; }
node ../../brain-index.mjs . >/dev/null
printf -- '---\nname: tabelle\ndescription: Tabellenseite\ntyp: thema\nquellen: []\nquellen_sha: []\nrev: 1\n---\n# Tabelle\n\n| Typ | Repo |\n|---|---|\n| MCP | beispiel-listing-mcp |\n' > 09_wiki/thema_tabelle.md
node ../../brain-index.mjs . >/dev/null; grep -q 'beispiel-listing-mcp' .logs/hint-karten/thema_tabelle.md || { echo "FAIL: dünne Karte ohne Tabelleninhalt"; rm -f 09_wiki/thema_tabelle.md; exit 1; }
rm -f 09_wiki/thema_tabelle.md; node ../../brain-index.mjs . >/dev/null
# Zweite Runde: fixture-neutral (inbox/wiki/archiv statt 00_inbox/09_wiki/90_archiv), Vault in einem Pfad mit
# Leerzeichen — gleiche Erwartungen wie Runde 1, aber mit den konfigurierten neutralen Ordnernamen.
TOOLS_ABS="$(cd ../.. && pwd)"
T="$(mktemp -d)/Mein Brain"
mkdir -p "$T"
cp -R "$TOOLS_ABS/tests/fixture-neutral/." "$T/"
node "$TOOLS_ABS/brain-index.mjs" "$T"
grep -q '10_projekte' "$T/INDEX.md"                   || { echo "FAIL: (neutral) Cluster fehlt in INDEX.md"; rm -rf "$(dirname "$T")"; exit 1; }
grep -q 'inbox' "$T/INDEX.md"                         || { echo "FAIL: (neutral) Inbox fehlt"; rm -rf "$(dirname "$T")"; exit 1; }
! grep -q 'archiv' "$T/INDEX.md"                      || { echo "FAIL: (neutral) Archiv darf nicht in INDEX.md"; rm -rf "$(dirname "$T")"; exit 1; }
grep -q 'thema_alpha' "$T/wiki/_index.md"             || { echo "FAIL: (neutral) Wiki-Index fehlt/leer"; rm -rf "$(dirname "$T")"; exit 1; }
grep -q 'Testthema Alpha' "$T/wiki/_index.md"         || { echo "FAIL: (neutral) description nicht übernommen"; rm -rf "$(dirname "$T")"; exit 1; }
node -e "const g=require(process.argv[1]); if(!g.nodes.some(n=>n.id.includes('notiz-a'))) process.exit(1); if(!g.edges.length) process.exit(2)" "$T/graph.json" || { echo "FAIL: (neutral) graph.json Knoten/Kanten"; rm -rf "$(dirname "$T")"; exit 1; }
cp "$T/INDEX.md" /tmp/brain-idx-neutral-1 && cp "$T/graph.json" /tmp/brain-graph-neutral-1 && node "$TOOLS_ABS/brain-index.mjs" "$T" && diff /tmp/brain-idx-neutral-1 "$T/INDEX.md" && diff /tmp/brain-graph-neutral-1 "$T/graph.json" || { echo "FAIL: (neutral) nicht deterministisch"; rm -rf "$(dirname "$T")"; exit 1; }
node -e "
const m=require(process.argv[1]);
if(m.paths['wiki/thema-alpha.md']!=='wiki/thema_alpha.md') process.exit(1);
if(m.pages['wiki/thema_alpha.md'].description!=='Testthema Alpha') process.exit(2);
if(m.bySource['10_projekte/alpha/notiz-a.md'][0]!=='wiki/thema_alpha.md') process.exit(3);
if(m.pages['wiki/_index.md']) process.exit(4);" "$T/.logs/wiki-map.json" || { echo "FAIL: (neutral) wiki-map.json"; rm -rf "$(dirname "$T")"; exit 1; }
rm -f /tmp/brain-idx-neutral-1 /tmp/brain-graph-neutral-1
rm -rf "$(dirname "$T")"
echo "PASS"
