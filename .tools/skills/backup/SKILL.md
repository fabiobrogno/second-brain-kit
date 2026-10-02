---
name: backup
description: Sicherung für das Second Brain einrichten — mit GitHub (privates Repo) oder ohne (Ordner/Stick)
argument-hint: [github|ordner|keins]
---

„Richte mir eine Sicherung ein" → Skill `backup`. Zwei Wege: **mit GitHub** (empfohlen, läuft von selbst bei
jeder Sitzung) oder **ohne GitHub** (Sicherung in einen Ordner, z. B. einen USB-Stick oder eine externe Platte).
Frag die Person, welchen Weg sie möchte, falls nicht klar.

## Weg A: mit GitHub

1. **`gh` prüfen:** `gh --version` (oder `~/.brain-kit/gh/bin/gh --version`, falls schon dort abgelegt). Fehlt es:
   offizielles Release-Archiv von github.com/cli/cli laden, Prüfsumme gegen `checksums.txt` prüfen und so entpacken,
   dass das Programm unter `~/.brain-kit/gh/bin/` liegt (gleiches Muster wie Node im Bootstrap — kein `sudo`, kein
   Paketmanager-Zugriff nötig); danach gh immer mit diesem vollen Pfad aufrufen.
2. **Anmelden:** `gh auth login --web --git-protocol https`. Der Person vorher sagen: „Gleich öffnet sich
   GitHub im Browser. Gib dort den Code ein, den ich dir zeige, und klicke auf 'Authorize'." Prüfbefehl:
   `gh auth status`.
   Hat die Person kein GitHub-Konto: Link zur Registrierung (github.com/signup) zeigen und warten, bis sie
   eins hat — nicht raten, nicht überspringen.
3. **Privates Repo anlegen und verbinden:** `gh repo create mein-brain --private --source "{{VAULT}}" --push`
   . Prüfbefehl: `{{GIT}} -C "{{VAULT}}" remote -v` (muss auf das neue Repo zeigen).
4. **Einrichten bestätigen:** `{{NODE}} "{{VAULT}}/.tools/brain.mjs" backup einrichten github`. Ab jetzt sichert jede
   Sitzung automatisch online (`brain backup` pusht).
5. **Wiederherstellen** (auf einem neuen Rechner): `gh repo clone mein-brain <ziel>`.

## Weg B: ohne GitHub (Ordner/Stick)

1. Ordner mit der Person klären (z. B. ein angeschlossener USB-Stick, eine externe Platte, ein Cloud-Ordner
   wie iCloud Drive/OneDrive). Pfad prüfen: Ordner muss existieren und beschreibbar sein.
2. **Einrichten:** `{{NODE}} "{{VAULT}}/.tools/brain.mjs" backup einrichten "ordner:<pfad>"`. Prüfbefehl:
   in `{{VAULT}}/brain.config.json` muss unter `backup` der Ordner stehen.
3. Ab jetzt sichert jede Sitzung automatisch in diesen Ordner (`brain backup` legt dort ein tagesaktuelles
   Bundle an, es bleiben die 7 neuesten). Ist der Ordner gerade nicht angeschlossen, meldet `brain backup`
   das freundlich und versucht es beim nächsten Mal wieder — kein Abbruch.
4. **Wiederherstellen:** `{{NODE}} "{{VAULT}}/.tools/brain.mjs" backup wiederherstellen <bundle-datei> <ziel>`.

## Beide Wege

- Ohne Sicherung weiterarbeiten ist jederzeit möglich (`backup einrichten keins`) — dann erinnert `doctor`
  einmal im Monat daran.
- Kein Schritt darf Stacktraces oder Fachbegriffe zeigen — jede Meldung in einfachen Worten an die Person
  weitergeben.
