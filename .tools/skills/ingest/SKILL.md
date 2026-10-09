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
1b. **Quelle liegt unter `{{INBOX}}/_import/<name>/` (Skill import hat sie dorthin kopiert):** ZUERST
   `_import/<name>/_bericht.md` lesen (Duplikate, Fast-Duplikat-Gruppen, Widersprüche, Pakete), dann NUR das
   gewählte Paket einarbeiten (nie den ganzen Import auf einmal). Je Fast-Duplikat-Gruppe entsteht GENAU EINE
   Wiki-Seite (nicht eine je Datei). Widerspruchs-Kandidaten aus dem Bericht nie still entscheiden: als
   [!KONFLIKT]-Kasten mit BEIDEN Belegen setzen, die laut Bericht NEUERE Quelle zuerst nennen — erst die Person
   entscheidet. Beweisbindung wie immer: `quellen`/`quellen_sha` zeigen auf die Dateien unter `_import/<name>/`.
2. **Secrets-Riegel (VOR allem anderen):** `{{NODE}} "{{VAULT}}/.tools/brain.mjs" ingest-check <datei>`.
   Exit 3 → ABBRUCH: Fundstellen nennen, NICHTS schreiben, User fragen. Exit 0 → weiter.
2b. **Lock setzen (Parallel-Sicherheit):** `{{NODE}} "{{VAULT}}/.tools/brain.mjs" lock`. Exit 1 (eine andere Sitzung arbeitet
   gerade, Lock jünger als 30 min) → NICHT einarbeiten, User informieren. Lock am Ende (Schritt 8) und bei
   JEDEM Abbruch entfernen: `{{NODE}} "{{VAULT}}/.tools/brain.mjs" unlock`. Lock NICHT doppelt setzen — Schritt 2c
   arbeitet unter demselben Lock weiter.
2c. **Offene Entscheidungen zuerst** (nur falls `{{INBOX}}/_entscheidungen/` Dateien enthält): jede einzeln
   abarbeiten, bevor die eigentliche Quelle drankommt. Je Auftrag: betroffene Seite öffnen, zuerst die QUELLE
   präzisieren (nie den Kasten blind nach `wahl` umschreiben), dann den `[!KONFLIKT]`-Kasten entfernen
   (`wahl: beide` behält beide Aussagen, aber als zwei normale Sätze statt Kasten — je mit Quelle), rev um 1
   erhöhen, Entscheidung mit `notiz` (falls vorhanden) in {{WIKI}}/_log.md protokollieren, den Auftrag nach
   `{{ARCHIV}}/entscheidungen-erledigt/` verschieben (anlegen falls nötig). Liegt zum selben Konflikt inzwischen
   eine neuere Entscheidung vor (Meinung geändert, bevor eingearbeitet wurde), gilt nur die neueste — die
   ältere wurde beim Entscheiden bereits ersetzt. Erst wenn keine Aufträge mehr offen sind, weiter mit Schritt 3.
2d. **Pflege-Aufträge sind keine Quellen** (`{{INBOX}}/_pflege/`, Frontmatter `typ: vorschlag`, `art: pflege`): ein
   übernommener Pflege-Vorschlag ist ein **Auftrag zur Prüfung**, ein KI-Ratschlag (zusammenlegen, aufteilen, veraltet,
   Widerspruch, Lücke) — nie ein Beleg. Er wird NIE als Quelle eingearbeitet, NIE in einen Cluster einsortiert und
   steht NIE in `quellen:`/`quellen_sha` einer Wiki-Seite. Abarbeiten nur auf ausdrücklichen Wunsch („arbeite die
   Pflege-Aufträge ab“) und wie im Skill review: die genannten Seiten öffnen und jede Aussage gegen die ECHTEN
   Rohquellen der Seite (ihre `quellen:`) prüfen; was die Rohquellen nicht tragen, wird nicht geändert, sondern der
   Person als offene Frage vorgelegt. Danach den Auftrag nach `{{ARCHIV}}/pflege-erledigt/` verschieben (anlegen
   falls nötig). Landet eine Datei mit `art: pflege` direkt in {{INBOX}}, gilt dasselbe — nicht als Quelle einarbeiten.
   **Sonderfall `befund: frage`** (Lernschleife: „Frage X zur Seite Y hinzufügen?“, aus Stichwörtern einer echten
   Frage): die Frage der Person in ihren Worten vorlegen (die Stichwörter sind nur ein Gerüst), nach Okay in
   `fragen:` der Seite ergänzen (höchstens 6) und dasselbe Paar in `{{WIKI}}/_messlatte.json` unter `positiv`
   eintragen (`{ "prompt": "<Frage>", "erwartet": ["<basename>.md"] }`, Datei anlegen falls nötig) — übernommene
   Paare kommen so auch in die Messlatte. Danach Karten-Tor wie in Schritt 7, Auftrag nach `{{ARCHIV}}/pflege-erledigt/`.
3. **Betroffene Seiten finden:** {{WIKI}}/_index.md lesen (nach Ordnern gruppiert); bei Bedarf die
   `_<ordner>.md` des Themenordners. Nur die berührten Seiten öffnen (typisch 5–15). NIE das ganze Wiki laden.
4. **Einarbeiten nach den 3 Riegeln** (_schema.md): gegen Originalquellen schreiben; Widersprüche
   als [!KONFLIKT]-Kasten mit beiden Quellen markieren, nie still auflösen; fehlende Seiten anlegen
   (Frontmatter-Pflicht!) im passenden Ordner nach _schema.md „Ordner“ (neuer Themenordner erst ab 2 Seiten;
   Basename muss im ganzen Brain eindeutig sein — Lint prüft), Querverweise setzen. Beweisbindung: quellen + quellen_sha
   (`{{NODE}} "{{VAULT}}/.tools/brain.mjs" sha <quelle>`) auf den eingearbeiteten Stand setzen, rev um 1 erhöhen.
   **Gültigkeit:** bei schnell veränderlichen Tatsachen (Preise, Versionen, Stände, Personen-Rollen) `stand: <heutiges Datum>`
   und `pruefen_bis` setzen — Standard 90 Tage ab heute, bei Preisen 30 Tage (Datum selbst ausrechnen, nicht schätzen).
   Andere Seiten brauchen diese Felder nicht.
   **Fragen (Treffsicherheit):** Beim Anlegen oder Überarbeiten einer Seite 2–4 typische Fragen in der Sprache der
   Person eintragen — so, wie sie selbst fragen würde (kurz, Alltagswörter, keine Fachüberschriften), z. B.
   `fragen: ["Wie komme ich an den Amazon-Token?", "Wo stehen die Ports der Dienste?"]` (eine Zeile, JSON, je
   ≤ 160 Zeichen, höchstens 6 — Lint prüft). Die Fragen landen in der Suchkarte; Änderungen an `fragen:` brauchen
   kein rev+1. Nie Kundendaten oder Zugangsdaten in eine Frage.
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
   **Neue Wiki-Seite oder neue/geänderte `fragen:` → Karten-Tor** (vor dem Report, NICHT im Hintergrund — die neue Karte ist erst nach dem
   Refresh im Index): erst `{{NODE}} "{{VAULT}}/.tools/brain.mjs" refresh`, dann `{{NODE}} "{{VAULT}}/.tools/karten-tor.mjs" <basename>.md`
   (~30–60 s, lokal). Meldet es `KARTEN-TOR: …`, im Report nennen und die Karte schärfen (Beschreibung und
   Fettbegriffe spezifischer, generische Wörter raus; schlägt eine Frage an, sie konkreter fassen) — blockiert nie.
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
