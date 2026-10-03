# Wiki-Schema — Arbeitsanweisung (vor JEDER Wiki-Arbeit lesen)

## Seitentypen
- `thema_<slug>.md` — Themenseite (fasst ein Thema über Quellen hinweg zusammen)
- `entitaet_<slug>.md` — Tool/Person/Projekt (Steckbrief + Bezüge)
- `synthese_<slug>.md` — Verdichtung quer über mehrere Themen
- `quelle_<slug>.md` — Zusammenfassung EINER Quelle (Video, Artikel, Doku)

## Ordner
- Jede Seite liegt in `wiki/<bereich>/<thema>/` oder direkt in `wiki/<bereich>/` (Themenordner ab ≥ 2 Seiten).
  Bereiche: frei wählbar (z. B. `projekte`, `wissen`, `persoenlich`). Wahlregel allein: **wo man zuerst suchen würde**
  (nicht der Ordner der Rohquelle).
- Oben liegen nur `ueberblick.md` (handgepflegt, ≤ 15 Zeilen), `_index.md` (generiert), `_log.md`, `_schema.md`.
- `_<ordner>.md` in jedem Ordner ist generiert (Indexer) — nie von Hand anfassen. `_*.md` unterhalb der
  obersten Ebene ist für generierte Dateien reserviert (gitignored) — keine eigenen `_`-Dateien dort anlegen.
- Zweitbezug: Frontmatter `auch: ["bereich/thema"]` (JSON, Anführungszeichen) → Seite erscheint zusätzlich in
  der Übersicht jenes Ordners.
- Dateinamen behalten das Typ-Präfix und sind im ganzen Brain eindeutig; Links immer als `[[basename]]`.
- Schnell veränderliche Tatsachen (Zählungen, Status, Listen, Ports) tragen „Stand <Datum>" oder verweisen
  auf das führende System. Gültigkeit per Frontmatter (siehe „Optionale Frontmatter").
- Gute Chat-Antworten: als Rohquelle nach inbox → /ingest. Eigene `synthese_`-Seite nur, wenn sie ≥ 2 Seiten
  verbindet und keine bestehende Seite erweitert werden kann.

## Frontmatter (Pflicht auf jeder Seite)
---
name: <slug>
description: <Einzeiler — wovon handelt die Seite>
typ: thema|entitaet|synthese|quelle
quellen: ["<relativer Pfad zur Rohquelle>", ...]
quellen_sha: ["<erste 16 Hex des SHA-256 der eingearbeiteten Quellversion>", ...]
rev: 1
---
(optional nach Save in eine Team-Wissensbasis: team_id, saved_at)

## Optionale Frontmatter (einzelne Seiten)
- `mcp: ["<servername>", ...]` — verknüpft die Seite in der 3D-Ansicht mit einem MCP-Server gleichen Namens
  (sonst reicht Namensgleichheit ab 4 Zeichen).
- `repo: ["<repo-name>", ...]` / `pfade: ["<ordnername>", ...]` — macht die Seite zur „Projektseite": trifft der
  Ordnername von `cwd` bzw. der Git-Repo-Name darauf zu, nennt der Sitzungsstart genau diese Seite.
- Gültigkeit: `stand: YYYY-MM-DD` (Wissensstand), `pruefen_bis: YYYY-MM-DD` (feste Frist) und/oder `verfall: <Tage>`
  (Momentaufnahme, gezählt ab dem letzten Commit der Seite). Abgelaufen = `pruefen_bis` liegt vor heute oder der
  Verfall ist überschritten → Lint meldet `ABGELAUFEN`, das Gehirn zeigt die Seite markiert. Beim Einarbeiten
  schnell veränderlicher Tatsachen (Preise, Versionen, Stände, Rollen) `pruefen_bis` setzen: Standard 90 Tage,
  Preise 30 Tage. Seiten ohne diese Felder gelten weder als abgelaufen noch als gültig geprüft.
- Alle optionalen Felder sind rein additiv — ohne sie funktioniert die Seite wie bisher.

## Beweisbindung
quellen_sha bindet die Seite an den eingearbeiteten Quellenstand. Ändert sich die Quelle
später, meldet /brain-lint die Seite als PRÜFBEDÜRFTIG — dann Re-Ingest nach User-Freigabe.
Hash berechnen: `shasum -a 256 <datei> | cut -c1-16` · rev bei jedem Re-Ingest erhöhen.

## Die 3 Riegel (hart, keine Ausnahmen)
1. Einarbeiten IMMER gegen die Originalquelle — nie gegen eine ältere Zusammenfassung.
2. Widersprüche werden markiert, NIE still aufgelöst. Format:
   > [!KONFLIKT] offen — Du entscheidest
   > A: "<Aussage>" — Quelle: [[pfad-a]]
   > B: "<Aussage>" — Quelle: [[pfad-b]]
   Auflösung nur nach User-Entscheidung: zuerst die QUELLE präzisieren, dann Kasten
   entfernen, Entscheidung in _log.md protokollieren.
   Das Format genau so halten (Kopfzeile, dann je eine Zeile `A:` und `B:` im selben Zitatblock) — das Gehirn
   liest die Kästen daraus und zeigt A und B zum Entscheiden nebeneinander.
3. Jeder Lauf wird in _log.md protokolliert (Format siehe dort).

## Regeln
- Rohquellen sind unantastbar (nur lesen). Seiten verlinken Quellen als [[relativer/pfad]].
- Seiten kurz halten: Ziel < 150 Zeilen; Details gehören in die Rohquelle.
- Kein festes Gesamtbudget (Suche lädt nur Treffer). Signale statt Grenze: Seite > 150 Zeilen, Doppel-Seiten,
  sinkende Hinweis-Qualität (Lint LANG / hint-eval) → Details in die Rohquelle oder Seiten zusammenlegen.
- Commits prüft ein pre-commit-Hook (gestagter Stand, nur neue Befunde): rev+1 bei Inhalts-/Quellenänderung,
  keine toten Links, _log.md append-only (neuer Eintrag oben).
- Querverweise zwischen verwandten Seiten setzen. Keine Secrets — niemals.
- _index.md und INDEX.md nie anfassen (generiert).
