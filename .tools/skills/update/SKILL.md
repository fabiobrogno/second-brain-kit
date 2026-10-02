---
name: update
description: Second Brain auf die neueste Kit-Version bringen — Migrationen der Reihe nach, nie Notizen oder Wiki anfassen
---

„Update mein Brain" → Skill `update` holt das Release-Archiv (kein GitHub-Konto nötig) und arbeitet die
Migrationen der Reihe nach ab. Ausgelöst entweder direkt durch die Person, oder automatisch beim
Sitzungsstart, wenn die Statuszeile „Update vX wird beim nächsten Start eingespielt" zeigt (Datei
`{{VAULT}}/.logs/update-bereit`, nur vorhanden wenn `update.auto: true` in `brain.config.json` steht) —
in dem Fall diesen Skill sofort abarbeiten, BEVOR auf andere Anfragen eingegangen wird, und danach melden.

Kein Code führt das Update selbst automatisch aus — nur der Agent, über diesen Skill, Schritt für Schritt.

0. **Quell-Vault?** Gibt es `{{VAULT}}/.tools/kit/export.mjs`, ist das der Entwicklungs-Vault, aus dem das Kit
   gebaut wird — dann NICHT updaten, sondern melden: „Das ist der Entwicklungs-Vault des Kits — der wird nicht
   über das Update aktualisiert." und abbrechen.
1. **Stand lesen:** `systemVersion` aus `{{VAULT}}/brain.config.json` lesen. Fehlt der Schlüssel: Installation
   ist älter als die erste Kit-Version — dem User melden und abbrechen, nichts raten.
2. **Neuestes Release holen:** `https://api.github.com/repos/fbrogno/second-brain-kit/releases/latest`
   abrufen (kein Konto, kein Login) → `tag_name` (z. B. `v0.2.0`) ist die neueste Version. Ist sie nicht
   neuer als `systemVersion`: „Du hast schon die neueste Version." melden, fertig.
3. **Kit-Klon besorgen:** Release-Archiv `https://github.com/fbrogno/second-brain-kit/archive/refs/tags/<tag>.tar.gz`
   laden und nach `<kit-klon>` entpacken — `<kit-klon>` ist `~/.brain-kit/kit/<version>` (z. B.
   `~/.brain-kit/kit/v0.2.0`); existiert der Ordner schon (frühere Installation/Update), nicht erneut laden.
4. **Migrationen abarbeiten:** Für jede Zwischenversion zwischen `systemVersion` und der neuesten Version,
   der Reihe nach, die zugehörige `<kit-klon>/migrations/<version>.md` lesen und befolgen. Vor JEDER
   einzelnen Migration: Git-Commit des aktuellen Stands im Vault (Sicherung, falls ein Schritt schiefgeht).
   Nach jeder Migration: `systemVersion` in `{{VAULT}}/brain.config.json` auf die erreichte Version setzen,
   committen, Prüfbefehl der Migration ausführen.
5. **Eiserne Regel:** Updates fassen nur System-Dateien an (`.tools/`, `brain.config.json`-Systemfelder),
   nie Notizen oder Wiki-Inhalte. Betrifft ein Format-Update Wiki-Seiten, macht die Migration das
   mechanisch, mit Git-Commit davor.
6. **.tools ersetzen:** Wie bei der Installation: `{{VAULT}}/.tools` per `rmSync`+`cpSync` aus
   `<kit-klon>/.tools` ersetzen (nie den restlichen Vault anfassen), danach `{{NODE}} "{{VAULT}}/.tools/install-git-hooks.mjs" "{{VAULT}}"`
   erneut ausführen (idempotent). Danach IMMER die Agenten-Anleitung neu erzeugen (sie ist nicht committet und
   wird sonst nur von der Installation bzw. beim Claude-Code-Sitzungsstart geschrieben — Codex, Gemini, Cursor
   blieben auf dem alten Stand): `{{NODE}} "{{VAULT}}/.tools/skills-build.mjs" "{{VAULT}}" --ziel agents "{{VAULT}}/AGENTS.md"`.
   Gibt es den Ordner `{{VAULT}}/.agents/skills` (so hält die Installation fest, dass Codex verbunden ist), zusätzlich
   `{{NODE}} "{{VAULT}}/.tools/skills-build.mjs" "{{VAULT}}" --ziel agents-skills "{{VAULT}}/.agents/skills"`.
   Ist der Claude-Code-Adapter installiert (Datei `brain-update.md` mit der Marke `brain-kit -->` im Ordner
   `commands` unter `.claude` im Home-Verzeichnis), danach auch ihn erneut ausführen — die Commands dort sind
   Kopien der Skills und veralten sonst (idempotent, ergänzt nur die eigenen Hooks, mit Backup):
   `{{NODE}} "{{VAULT}}/.tools/adapters/claude-code/install.mjs" "{{VAULT}}"`.
7. **Aufräumen (immer, auch wenn Schritt 2 schon "neueste Version" meldete):** `{{VAULT}}/.logs/update-bereit`
   und `{{VAULT}}/.logs/update-check` löschen, falls vorhanden. Sonst zeigt die Statuszeile weiter die
   alte Marke bzw. den alten Cache-Treffer, bis die 24h-Drosselung irgendwann von selbst neu prüft.
8. **Report an User:** alte Version, neue Version, durchlaufene Migrationen, was sich geändert hat.
