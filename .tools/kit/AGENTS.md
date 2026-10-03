# Second Brain — Arbeitsregeln für KI-Agenten

Dieses Verzeichnis ist ein Second Brain. Gilt für jeden Agenten (Claude Code, Codex, Gemini CLI, Cursor …).

## Wissensfragen (Brain-First)
{{WENN:ichKarte}}Lies zuerst `{{WIKI}}/ich.md` — wer die Person ist, woran sie arbeitet, was ihr wichtig ist (entfällt, wenn sie schon als „Brain-Ich-Karte" im Kontext steht).

{{/WENN}}Gibt es `{{WIKI}}/_lektionen.md`, einmal kurz hineinschauen — gelernte Lektionen aus wiederholten Korrekturen
oder Fehlschlägen (kurze Liste, je Eintrag ≤ 3 Zeilen). Bei Claude Code liegen diese stattdessen im eigenen
Memory (Skill **lektion** schreibt sie dorthin); diese Datei ist für andere Werkzeuge.

1. `{{NODE}} "{{VAULT}}/.tools/brain.mjs" search "<frage>"` → beste Datei lesen. Nie das ganze Brain breit einlesen.
2. Liefert dein Werkzeug schon einen „Brain-Treffer" (Hook), diese Seite nur lesen, wenn sie zur Aufgabe passt.
3. Rohquelle nur öffnen, wenn eine Seite PRÜFBEDÜRFTIG ist oder eine Entscheidung an einer Aussage hängt.

## Schreiben
- `{{WIKI}}/` nur über den Skill **ingest** (`{{VAULT}}/.tools/skills/ingest/SKILL.md`), Schema: `{{WIKI}}/_schema.md`.
- Neues Wissen als Notiz nach `{{INBOX}}/`, dann Skill ingest. Rohquellen und generierte Dateien (INDEX.md, graph.json, `_index.md`) nie editieren.
- Keine Secrets, niemals. Der git pre-commit-Hook blockiert Credential-Muster, rev-Fehler und tote Links — nie umgehen.

## Alltag
- „merk dir …" → Notiz nach `{{INBOX}}/`, dann Skill **ingest**.
- „was weiß ich über …" → `{{NODE}} "{{VAULT}}/.tools/brain.mjs" search "<frage>"`.
- „sichere mein Brain" → `{{NODE}} "{{VAULT}}/.tools/brain.mjs" backup`.
- „richte mir eine Sicherung ein" → Skill **backup** (`{{VAULT}}/.tools/skills/backup/SKILL.md`).
- „update mein Brain" → Skill **update** (`{{VAULT}}/.tools/skills/update/SKILL.md`).
- „zeig mir mein Brain" / "show me my brain" → `{{NODE}} "{{VAULT}}/.tools/brain.mjs" zeig`.
- „importiere mein altes Brain aus <Ordner>" (Obsidian, Notion-Export, Logseq, Ordner mit Notizen) → Skill **import**
  (`{{VAULT}}/.tools/skills/import/SKILL.md`), kurz: `{{NODE}} "{{VAULT}}/.tools/brain.mjs" import <ordner|zip> [--name x]`.
- „wie gut ist mein Brain" → `{{NODE}} "{{VAULT}}/.tools/brain.mjs" analyse`.
- „was ist im Brain zu tun" / „was muss gepflegt werden" → `{{NODE}} "{{VAULT}}/.tools/brain.mjs" pflege` (abgelaufene
  Seiten, offene Konflikte und Entscheidungen, Dubletten, je mit nächstem Schritt in Alltagssprache).
- „mach die Suche besser" (Vorschlag aus `brain doctor`) → qmd nachrüsten: `npm i -g --prefix ~/.brain-kit @tobilu/qmd`
  (dieselbe Logik wie `sorgeFuerQmd` in der Installation; lädt aus dem Internet), danach `suche.profil` in
  `brain.config.json` auf `leicht` setzen und `{{NODE}} "{{VAULT}}/.tools/brain.mjs" refresh` ausführen.
- „repariere meine Brain-Einstellungen" (Vorschlag aus `brain doctor`) → `{{VAULT}}/brain.config.json` öffnen,
  den JSON-Fehler finden, der Person zeigen was kaputt ist, und GEMEINSAM mit ihr reparieren — nie eigenmächtig
  überschreiben oder raten.

## Befehle
- Node und git immer so aufrufen, wie hier angegeben: Node = `{{NODE}}`, git = `{{GIT}}` (auf frisch eingerichteten
  Rechnern liegen sie oft nicht im PATH).
- Zeit, Lock und Prüfsumme nie per Shell-Werkzeug, sondern: `{{NODE}} "{{VAULT}}/.tools/brain.mjs" jetzt` · `… lock` · `… unlock` · `… sha <datei>`.

## Skills
ingest · import · lint · review · feedback · handoff · update · backup · lektion — je `{{VAULT}}/.tools/skills/<name>/SKILL.md`. Kann dein Werkzeug keine Skills laden, lies die Datei und arbeite sie ab.
