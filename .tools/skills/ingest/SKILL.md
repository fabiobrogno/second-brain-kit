---
name: ingest
description: Quelle ins Brain einarbeiten — Wiki pflegen, Widersprüche markieren, protokollieren
argument-hint: <datei|text|youtube-url>
---

Arbeite die Quelle ($ARGUMENTS) nach {{WIKI}}/_schema.md ins Brain ({{VAULT}}) ein. Ablauf STRIKT:

1. **Quelle beschaffen:** Datei → lesen. Freitext → als Notiz-Datei in {{INBOX}} anlegen.
   YouTube-URL (optional — nur falls `yt-dlp` installiert ist; sonst die Person bitten, das Transkript als Text
   einzufügen): `yt-dlp --skip-download --write-auto-subs --sub-langs "de" --sub-format vtt -o "{{VAULT}}/.logs/ing_%(id)s" "<url>"`,
   VTT zu Text bereinigen (Zeitstempel/Tags/Duplikate raus), als Markdown mit Titel-H1 + Quell-URL
   nach {{VAULT}}/{{INBOX}}/.
2. **Secrets-Riegel (VOR allem anderen):** `{{NODE}} "{{VAULT}}/.tools/brain.mjs" ingest-check <datei>`.
   Exit 3 → ABBRUCH: Fundstellen nennen, NICHTS schreiben, User fragen. Exit 0 → weiter.
2b. **Lock setzen (Parallel-Sicherheit):** `{{NODE}} "{{VAULT}}/.tools/brain.mjs" lock`. Exit 1 (eine andere Sitzung arbeitet
   gerade, Lock jünger als 30 min) → NICHT einarbeiten, User informieren. Lock am Ende (Schritt 8) und bei
   JEDEM Abbruch entfernen: `{{NODE}} "{{VAULT}}/.tools/brain.mjs" unlock`.
3. **Betroffene Seiten finden:** {{WIKI}}/_index.md lesen (nach Ordnern gruppiert); bei Bedarf die
   `_<ordner>.md` des Themenordners. Nur die berührten Seiten öffnen (typisch 5–15). NIE das ganze Wiki laden.
4. **Einarbeiten nach den 3 Riegeln** (_schema.md): gegen Originalquellen schreiben; Widersprüche
   als [!KONFLIKT]-Kasten mit beiden Quellen markieren, nie still auflösen; fehlende Seiten anlegen
   (Frontmatter-Pflicht!) im passenden Ordner nach _schema.md „Ordner“ (neuer Themenordner erst ab 2 Seiten;
   Basename muss im ganzen Brain eindeutig sein — Lint prüft), Querverweise setzen. Beweisbindung: quellen + quellen_sha
   (`{{NODE}} "{{VAULT}}/.tools/brain.mjs" sha <quelle>`) auf den eingearbeiteten Stand setzen, rev um 1 erhöhen.
5. **Quelle einsortieren:** Von {{INBOX}} in den passenden Cluster verschieben (Cluster-Definitionen
   in brain.config.json); Wahl im Report nennen. WICHTIG: quellen-Pfade im Frontmatter zeigen auf
   den NEUEN Ort, Hash NACH dem Verschieben berechnen.
6. **Protokoll:** Eintrag in {{WIKI}}/_log.md direkt unter die Formatvorlage (neuester oben). Zeitstempel IMMER
   per `{{NODE}} "{{VAULT}}/.tools/brain.mjs" jetzt` holen, nie schätzen.
7. **Nachlauf:** `{{NODE}} "{{VAULT}}/.tools/brain.mjs" index` ausführen, danach `{{NODE}} "{{VAULT}}/.tools/brain.mjs" refresh`
   (Suchindex + Karteikarten, lokal, 0 API-Tokens; kann dein Werkzeug Befehle im Hintergrund starten, gern dort).
   Nur falls `{{VAULT}}/.tools/tests/hint-eval.mjs` vorhanden ist (Entwicklungs-Vault), danach zusätzlich
   `{{NODE}} "{{VAULT}}/.tools/tests/hint-eval.mjs" --quiet` (Hinweis-Qualität). Seite > 150 Zeilen → Details in die Rohquelle
   (Lint meldet LANG). Neue Wiki-Seite und `{{VAULT}}/.tools/tests/hint-eval.json` vorhanden → 1–2 passende Testfragen
   dort ergänzen (positiv, `erwartet` als **Basename**, z. B. `thema_x.md`) und mit committen.
   **Neue Wiki-Seite → Karten-Tor** (vor dem Report, NICHT im Hintergrund — die neue Karte ist erst nach dem
   Refresh im Index): erst `{{NODE}} "{{VAULT}}/.tools/brain.mjs" refresh`, dann `{{NODE}} "{{VAULT}}/.tools/karten-tor.mjs" <basename>.md`
   (~30–60 s, lokal). Meldet es `KARTEN-TOR: …`, im Report nennen und die Karte schärfen (Beschreibung und
   Fettbegriffe spezifischer, generische Wörter raus) — blockiert nie.
8. **Git:** NUR bei vollständigem Erfolg: im Repo {{VAULT}} die geänderten Dateien EXPLIZIT stagen
   (`{{GIT}} -C "{{VAULT}}" add -- <dateien>`: Wiki-Seiten, _log.md, verschobene Quelle — kein add -A) und committen:
   `{{GIT}} -C "{{VAULT}}" commit -m "ingest: <quelle> — <n> Seiten"`, danach
   `{{NODE}} "{{VAULT}}/.tools/brain.mjs" backup` (Sicherungsfehler nur melden,
   Commit bleibt lokal gesichert). **Lehnt der pre-commit-Hook ab** (Befundliste): Befund beheben (z. B. rev erhöhen,
   toten Link korrigieren, _log-Eintrag nach oben), erneut committen, ERST DANN Lock entfernen (`{{NODE}} "{{VAULT}}/.tools/brain.mjs" unlock`) — nie `--no-verify`
   (Umgehen nur durch den User). Bei Abbruch in Schritt 2–6: nichts committen,
   angelegte Fragmente zurücknehmen.
9. **Report an User:** Quelle, geänderte/neue Seiten, Konflikte (mit Kurzfassung), Ziel-Cluster.

Konflikt-Auflösung (wenn User "entschieden: …" sagt): Lock setzen wie in 2b, zuerst die QUELLE präzisieren, dann Kasten
entfernen (Inhaltsänderung → rev um 1 erhöhen, quellen_sha neu), Entscheidung in _log.md protokollieren, committen.
