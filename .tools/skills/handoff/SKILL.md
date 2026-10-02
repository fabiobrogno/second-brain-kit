---
name: handoff
description: Arbeitsstand für die nächste Sitzung sichern — session_*.md schreiben, damit nahtlos weitergearbeitet werden kann
argument-hint: [thema]
---

Schreibe den Arbeitsstand dieser Sitzung als Handoff, damit die nächste Sitzung (gleicher oder anderer Agent) nahtlos weitermachen kann:

1. **Datei:** Ablageort je nach Werkzeug. Claude Code: `~/.claude/projects/<projekt>/memory/session_<thema>_<YYYY-MM-DD>.md`
   (`<projekt>` = der Projekt-Ordnername, den Claude Code selbst vergibt). Andere Werkzeuge: den eigenen
   persönlichen Notizordner nutzen, oder — falls keiner existiert — als Notiz nach {{INBOX}}/ schreiben und
   über den Skill ingest einarbeiten.
   Frontmatter: name (kebab-case), description (Einzeiler), type: session.
   Body (max 40 Zeilen): **Was lief** · **Was ist live/committet** · **🔴 Offen** ·
   **⚠️ Fallen** · **▶▶▶ Wiedereinstieg** (konkreter erster Schritt).
   Existiert zum Thema schon eine session_*.md → aktualisieren statt neu (Edit vor Write).
2. **Index:** Im Index der genutzten Memory-Ablage (z. B. MEMORY.md) unter "## Aktive Sessions" eine
   Zeile ergänzen/aktualisieren:
   `- ▶▶▶ [<Thema>](session_<...>.md) — <Einzeiler>` (Budget beachten, <150 Zeichen).
   Abgeschlossene Arbeit: Zeile entfernen und Datei-Status auf erledigt setzen.
3. Keine Secrets. Umlaute ä/ö/ü/ß. Kurz melden, was geschrieben wurde.
