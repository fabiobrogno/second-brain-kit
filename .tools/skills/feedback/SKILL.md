---
name: feedback
description: Brain-Hinweis war falsch oder hat gefehlt — eine Zeile ins Feedback-Log (0 API-Tokens)
---

1. Aus den Argumenten ($ARGUMENTS) ableiten: Art `falsch` (Hinweis passte nicht) oder `fehlte` (Wissen war im Brain, kam aber nicht). Unklar → einmal kurz fragen.
2. Seite: bei `falsch` die gemeldete Seite (Basename, z. B. thema_x.md), bei `fehlte` die Seite, die hätte kommen sollen, sonst `-`.
3. Ausführen: `{{NODE}} "{{VAULT}}/.tools/feedback.mjs" <art> <seite> '<Stichwort, max. 1 Satz, KEINE Secrets, ohne einfache Anführungszeichen>'`.
4. Einzeilig bestätigen. Nichts am Wiki ändern.
