---
name: review
description: Brain-Review (alle ~30 Tage) — nur seit dem letzten Review geänderte Wiki-Seiten kritisch prüfen, nichts still ändern
---

1. Kandidaten holen (lokal, 0 Tokens): `{{NODE}} "{{VAULT}}/.tools/review-kandidaten.mjs"` → `seiten`, `nachbarn`, `feedback`, `hinweisOhneTreffer`.
2. NUR diese Seiten lesen (Budget ≤ ~10k Tokens); Rohquellen nur an Stellen, an denen eine Aussage zweifelhaft ist.
   Mehr als 15 Seiten → nach Ordnern gruppieren und mit dem User eine Auswahl treffen, nicht alles lesen.
3. Prüfen und als Befundliste melden (je Befund: Seite, Beleg, Empfehlung):
   - **Widerspruch** zwischen zwei Seiten (auch zu Nachbarn) → Konflikt-Kasten vorschlagen.
   - **Veraltet**: schnell veränderliche Tatsache ohne „Stand <Datum>" oder mit altem Stand; `verfall` abgelaufen.
   - **Zusammenlegen / Aufteilen**: zwei Seiten sagen dasselbe; eine Seite > 150 Zeilen.
   - **Feedback**: `art=fehlte` → welche Seite hätte kommen sollen (Karte schärfen, ggf. Testfrage in hint-eval.json
     bzw. Holdout-Kandidat); `art=falsch` → Karte der gemeldeten Seite zu breit? (`{{NODE}} "{{VAULT}}/.tools/karten-tor.mjs" <seite>`).
   - **Viele Anfragen ohne Treffer** (`hinweisOhneTreffer` hoch): Lücke im Wiki? Nur als Frage an den User, nie raten.
4. NICHTS ändern ohne ausdrückliche Freigabe. Nach Freigabe einzelner Punkte: Lock setzen (`{{NODE}} "{{VAULT}}/.tools/brain.mjs" lock`), nach den
   Regeln des Skills ingest umsetzen (Konflikt-Kasten, rev+1 bei Inhaltsänderung, _log-Eintrag oben, Zeit per
   `{{NODE}} "{{VAULT}}/.tools/brain.mjs" jetzt`), committen, Lock entfernen (`{{NODE}} "{{VAULT}}/.tools/brain.mjs" unlock`).
5. Review abschließen: `{{NODE}} "{{VAULT}}/.tools/brain.mjs" review-erledigt` (auch wenn es keine Befunde gab).
