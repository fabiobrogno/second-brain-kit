# Claude-Code-Adapter

Bindet den Brain-Vault in Claude Code ein: Hooks, Statusline und Slash-Commands.

## Dateien
- `install.mjs` — Merge-Installer. Ergänzt `~/.claude/settings.json` um die Brain-Hooks (nie ersetzen,
  nie eine fremde `statusLine` überschreiben) und schreibt die Slash-Commands nach `~/.claude/commands/`
  (`ingest`, `handoff`, `brain-lint`, `brain-review`, `brain-feedback`, `brain-update`, `brain-backup`). Jede
  generierte Datei trägt die Marke `<!-- brain-kit -->`; eine gleichnamige eigene Datei ohne Marke wird vorher
  als `<name>.md.bak-<YYYYMMDD-HHMMSS>` gesichert (mit Meldung). Hook-Befehle nutzen den absoluten Node-Pfad.
- `session-start.mjs` (SessionStart) — stößt `session-hintergrund.mjs` als eigenen, losgelösten Prozess an
  und gibt eine kurze Statuszeile aus (Inbox, Konflikte, fälliger Review). Nur wenn zutreffend außerdem:
  die Zahl neuer Vorschläge, die Ich-Karte `09_wiki/ich.md` (Schalter `ichKarte`, ohne Frontmatter,
  ≤ 1500 Zeichen) und `Projektseite: <pfad>` (Schalter `projektAutomatik`: genau eine Wiki-Seite, deren
  Frontmatter `repo:`/`pfade:` auf den Ordner- bzw. Git-Repo-Namen zeigt, sonst gleicher Seitenname).
- `session-hintergrund.mjs` — Hintergrund-Refresh: AGENTS.md neu rendern, Index, Suchrefresh, Lint-Cache,
  Sicherung (Schalter `sicherungTaeglich`), Memory-Sync, Update-Check (Schalter `updateHinweis`).
- `brain-hint.mjs` (UserPromptSubmit) — lokaler Brain-Hinweis über QMD-Vektorsuche (0 API-Tokens). Stufe
  `hinweise` (aus/niedrig/mittel/hoch), Import-Treffer mit „(Import, ungeprüft)“, Lücken (Schalter `luecken`),
  startet beim Stand-Intervall (`staendeIntervallStunden`) die Ernte `--art stand` losgelöst. Treffer auf eine Seite
  mit `ersetzt_durch` erscheinen nur als „ersetzt → [[neu]], nicht mehr aktuell“, Seiten mit `zweifel` tragen
  „(PRÜFBEDÜRFTIG: Zweifel)“; bei zwei Treffern zum selben Thema mit verschiedenen Werten rückt der neuere vor.
- `ernte-ausloeser.mjs` (SessionEnd, PreCompact) — startet `.tools/ernte.mjs --art fakt` losgelöst, wenn
  `ernteSitzungsende` an ist; gibt nie etwas aus. Vorher legt er eine Auftrags-Marke `.logs/ernte/offen/<sid>.json`
  an, die `ernte.mjs` nach Abschluss entfernt. Bleibt sie liegen (Lauf mit Claude Code beendet, z. B. Windows),
  startet `session-start.mjs` sie beim nächsten Start neu; Marken älter als 7 Tage werden dort aufgeräumt.
  Mit `fakt` startet er zusätzlich das Fehler-Signal W7 (`.tools/w7.mjs`, 0 Tokens): Folgt auf eine Antwort nach
  einem Brain-Hinweis eine Korrektur, landet {Seite, Sitzung, Zitat der Korrektur} in `.logs/w7.jsonl` (jeder Fund
  genau einmal). Die Ernte speichert nur Vorschläge mit wörtlichem Zitat aus Nutzer- oder Werkzeug-Text (`zitat`,
  `herkunft`, `fundstelle`); `ernte.log` zählt `ohneBeleg` und `nurKi`.
- `werkzeug-protokoll.mjs` (PreToolUse: `Read|mcp__.*`, eigener Eintrag) — Werkzeug-Protokoll für das
  Aufleuchten und die MCP-Nutzung; gibt nie etwas aus.
- `wiki-guard.mjs` (PreToolUse: Edit/Write/MultiEdit/NotebookEdit) — Riegel: `09_wiki/` nur über `/ingest`
  (frisches Lock), generierte Dateien nie von Hand.

Alle Hooks bleiben registriert, auch wenn ihr Schalter in `brain.config.json#automatik` aus ist — sie beenden
sich dann sofort. So schreibt eine Änderung in der Einstellungsmaske `settings.json` nie um. Mit
`BRAIN_ERNTE=1` (der Hintergrund-Ernte-Lauf) tun alle Hooks nichts.
- `statusline.mjs` — Claude-Code-Statusline mit Brain-Status (aktuell/wartend/Konflikte).

## Installation

```
node .tools/adapters/claude-code/install.mjs <vault> [--claude-home <dir>] [--ohne-statusline]
```

- `<vault>` ist der Pfad zum Brain-Vault (z. B. `~/Documents/Brain`). Die Hooks selbst brauchen kein
  `BRAIN_VAULT`: sie finden den Vault über ihren eigenen Ort (`<vault>/.tools/adapters/claude-code/`).
- `--claude-home <dir>` überschreibt `~/.claude` (für Tests/Probeläufe).
- `--ohne-statusline` lässt die Statusline unangetastet.

Der Installer ergänzt `settings.json` nur — fremde Hooks und eine fremde Statusline bleiben unverändert.
Vor jeder Änderung wird ein Backup `settings.json.bak-<YYYYMMDD-HHMMSS>` angelegt. Ein zweiter Lauf ohne
Vault-/Config-Änderung meldet `unverändert` und legt kein neues Backup an.

Ist `settings.json` kein gültiges JSON, bricht der Installer mit einer Klartextzeile und Exit 1 ab, ohne
etwas zu schreiben oder ein Backup anzulegen — erst die Datei reparieren, dann erneut installieren.

**Ältere Brain-Hooks derselben Vault** (vor dem Umzug nach `.tools/adapters/claude-code/`, z. B.
`<vault>/.tools/session-start.mjs`, `wiki-guard.sh`, `brain-hint.mjs`, `statusline.sh`, auch in der
`$HOME/brain`-Schreibweise) werden automatisch durch den neuen Adapter-Pfad **ersetzt** statt verdoppelt —
an derselben Stelle in der Hook-Liste, mit Backup wie jede andere Änderung. Hooks, die auf eine andere
Vault oder ein anderes Werkzeug zeigen, bleiben unangetastet.

## Tests

```
node --test .tools/tests/test-adapter-claude.mjs
bash .tools/tests/test-hint-hook.sh
bash .tools/tests/test-wiki-guard.sh
bash .tools/tests/test-session-hintergrund.sh
bash .tools/tests/test-config-kaputt.sh
bash .tools/tests/test-pflege.sh
node --test .tools/tests/test-ernte-ausloeser.mjs
node --test .tools/tests/test-w7.mjs .tools/tests/test-ernte-beleg.mjs .tools/tests/test-hint-core.mjs
```
