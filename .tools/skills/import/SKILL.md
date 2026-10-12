---
name: import
description: Altes Brain (Obsidian, Notion-Export, Logseq, Ordner mit Notizen) importieren — Quelle bleibt unberührt, Bericht vor jedem Einarbeiten
argument-hint: <ordner|zip>
---

Ablauf für „importiere mein altes Brain aus <Ordner>" (oder: Obsidian/Notion/Logseq):

1. **Ordner oder Zip erfragen**, falls nicht genannt: welcher Ordner (oder welche Zip-Datei) soll importiert
   werden? Apple Notizen hat keinen direkten Ordner-Export — die Person bitten, zuerst in der Notizen-App zu
   exportieren (je Notiz als PDF oder Text), dann diesen Export-Ordner importieren.
2. **Import ausführen:** `{{NODE}} "{{VAULT}}/.tools/brain.mjs" import "<ordner|zip>" [--name <quelle>]`.
   Die Quelle wird dabei NUR gelesen, nie verändert oder gelöscht. ACHTUNG groß (≥ 2000 Notizen oder ≥ 50 MB):
   der Befehl fragt dann erst nach (mit Tokenschätzung fürs vollständige Einarbeiten) und kopiert noch nichts —
   erst nach ausdrücklichem Ja der Person denselben Befehl mit zusätzlich `--ja` erneut aufrufen.
3. **Bericht in Alltagssprache zusammenfassen** (aus der Ausgabe bzw. `{{INBOX}}/_import/<quelle>/_bericht.md`):
   Anzahl Notizen, exakte Duplikate (übersprungen), Gruppen „gleiche Sache, mehrere Fassungen", mögliche
   Widersprüche und Überschneidungen mit bestehenden Wiki-Seiten. KEINE Rohtexte aus den Notizen in die
   Chat-Antwort kopieren — nur die Zahlen und Themen nennen.
4. **Zugangsdaten-Hinweis (wichtig):** Enthält der Bericht `secretsIn` (Notizen mit vermutlichen Zugangsdaten),
   der Person das so sagen: „Ein paar Notizen enthalten wahrscheinlich Passwörter oder Zugangsschlüssel. Diese
   Notizen wurden NICHT übernommen — die Liste steht im Bericht (`{{INBOX}}/_import/<quelle>/_bericht.md`)."
   Vorschlag: die Zugangsdaten in der Original-Notiz (in der Quelle) entfernen oder durch einen Platzhalter
   ersetzen, dann denselben Import erneut starten — schon Übernommenes wird dabei als exaktes Duplikat
   übersprungen. Nie eine Datei unter `{{INBOX}}/_import/` bearbeiten (Rohquelle) und den Commit-Riegel NIE umgehen.
5. **Pakete anbieten:** die Pakete aus dem Bericht (Thema/Bereich + Tokenschätzung je Paket) zeigen und fragen,
   welches Paket als Nächstes eingearbeitet werden soll — nie den ganzen Import auf einmal einarbeiten.
6. **Einarbeiten (nur nach Ja, je Paket):** Skill **ingest** auf die Dateien des gewählten Pakets anwenden
   (sie liegen unter `{{INBOX}}/_import/<quelle>/`). Dessen Import-Regeln gelten: erst `_bericht.md` lesen,
   je Fast-Duplikat-Gruppe eine Wiki-Seite, Widersprüche nie still entscheiden. REIHENFOLGE (wichtig):
   a) passenden Ziel-Cluster wählen (Cluster-Ids aus brain.config.json) und dem Paket zuweisen,
   b) **zuerst** `{{NODE}} "{{VAULT}}/.tools/brain.mjs" import fertig <quelle> "<paket>" --ziel <cluster>` — das
      verschiebt die Paketdateien per `git mv` nach `<cluster>/<quelle>/<unveränderte Unterstruktur>` und vermerkt
      das Paket im Bericht als eingearbeitet (Inhalt bleibt bytegleich, `quellen_sha` ändert sich nicht),
   c) **danach** die Wiki-Seiten schreiben: `quellen:` zeigt auf den NEUEN Ort `<cluster>/<quelle>/…`, nicht mehr
      nach `{{INBOX}}/_import/`,
   d) bei der Git-Übergabe (ingest Schritt 8) auch stagen, was der Befehl am Ende nennt (`_bericht.json` bzw. den
      Archiv-Ordner). Bricht das Einarbeiten ab, bevor committet ist: Dateien per `git mv` zurück nach
      `{{INBOX}}/_import/<quelle>/` und den Eintrag `eingearbeitet.<paket>` aus `_bericht.json` löschen (oder
      `git restore --staged --worktree` auf die genannten Pfade — nur nach Rückfrage).
   Das letzte Paket schließt den Import ab: Bericht und Metadaten wandern nach `{{ARCHIV}}/import-berichte/<quelle>/`,
   `{{INBOX}}/_import/<quelle>/` verschwindet. Soll gar nichts eingearbeitet, sondern der ganze Rest ohne Wiki-Seiten
   abgelegt werden, geht `… import fertig <quelle> --alle --ziel <cluster>` (nur auf ausdrücklichen Wunsch).
7. **Danach:** `{{NODE}} "{{VAULT}}/.tools/brain.mjs" analyse` zeigt offene Importe (nur Pakete, die noch nicht
   eingearbeitet sind) — der Person kurz nennen, wenn noch Pakete offen sind.
