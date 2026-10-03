---
name: review
description: Brain-Review (alle ~30 Tage) — nur seit dem letzten Review geänderte Wiki-Seiten kritisch prüfen, nichts still ändern
---

1. Kandidaten holen (lokal, 0 Tokens): `{{NODE}} "{{VAULT}}/.tools/review-kandidaten.mjs"` → `seiten`, `nachbarn`, `feedback`, `hinweisOhneTreffer`.
   Zusätzlich den Pflegebericht lesen: `{{NODE}} "{{VAULT}}/.tools/brain.mjs" pflege --json` → zeigt abgelaufene
   Seiten (`pruefen_bis`/`verfall` überschritten), offene Konflikte, mögliche Dubletten und zu lange Seiten schon
   fertig gezählt — deckt sich teils mit den Kandidaten oben, aber ohne das Review selbst anzustoßen. Die Posten
   `abgelaufen` und `konflikte` zuerst in die Auswahl aufnehmen (sie sind am dringendsten), dann erst die übrigen
   Review-Kandidaten.
2. NUR diese Seiten lesen (Budget ≤ ~10k Tokens); Rohquellen nur an Stellen, an denen eine Aussage zweifelhaft ist.
   Mehr als 15 Seiten → nach Ordnern gruppieren und mit dem User eine Auswahl treffen, nicht alles lesen.
3. Prüfen und als Befundliste melden (je Befund: Seite, Beleg, Empfehlung):
   - **Widerspruch** zwischen zwei Seiten (auch zu Nachbarn) → Konflikt-Kasten vorschlagen.
   - **Veraltet**: schnell veränderliche Tatsache ohne „Stand <Datum>" oder mit altem Stand; `pruefen_bis`/`verfall`
     abgelaufen (Pflegebericht-Posten `abgelaufen`) oder bald fällig (`bald`, ≤ 14 Tage) — nach der Prüfung die Frist
     erneuern: `pruefen_bis` neu setzen; bei `grund: verfall` reicht der neue Commit (oder `verfall` anpassen).
   - **Zusammenlegen / Aufteilen**: zwei Seiten sagen dasselbe; eine Seite > 150 Zeilen.
   - **Feedback**: `art=fehlte` → welche Seite hätte kommen sollen (Karte schärfen, ggf. Testfrage in hint-eval.json
     bzw. Holdout-Kandidat); `art=falsch` → Karte der gemeldeten Seite zu breit? (`{{NODE}} "{{VAULT}}/.tools/karten-tor.mjs" <seite>`).
   - **Viele Anfragen ohne Treffer** (`hinweisOhneTreffer` hoch): Lücke im Wiki? Nur als Frage an den User, nie raten.
3b. **Pflege-Aufträge** (`{{INBOX}}/_pflege/`, Pflegebericht-Posten `pflegeAuftraege`; entstehen, wenn die Person
   einen Pflege-Vorschlag übernimmt): Ein Pflege-Vorschlag ist ein **Auftrag zur Prüfung, keine Quelle**. Er darf nie
   als `quellen:` ins Wiki, nie als Beleg zitiert und nie in einen Cluster einsortiert werden. Je Auftrag die genannten
   Seiten lesen und den Befund IMMER gegen die echten Rohquellen dieser Seiten prüfen (ihre `quellen:`), nie gegen den
   Auftragstext. Ergebnis als Befund wie in Schritt 3 melden (bestätigt / nicht bestätigt, mit Beleg aus der Rohquelle)
   — umgesetzt wird erst nach Freigabe (Schritt 4). Danach den Auftrag nach `{{ARCHIV}}/pflege-erledigt/` verschieben
   (anlegen falls nötig), auch wenn sich der Befund nicht bestätigt hat.
4. NICHTS ändern ohne ausdrückliche Freigabe. Nach Freigabe einzelner Punkte: Lock setzen (`{{NODE}} "{{VAULT}}/.tools/brain.mjs" lock`), nach den
   Regeln des Skills ingest umsetzen (Konflikt-Kasten, rev+1 bei Inhaltsänderung, _log-Eintrag oben, Zeit per
   `{{NODE}} "{{VAULT}}/.tools/brain.mjs" jetzt`), committen, Lock entfernen (`{{NODE}} "{{VAULT}}/.tools/brain.mjs" unlock`).
5. Review abschließen: `{{NODE}} "{{VAULT}}/.tools/brain.mjs" review-erledigt` (auch wenn es keine Befunde gab).
