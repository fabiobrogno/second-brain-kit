import { test } from "node:test";
import assert from "node:assert/strict";
import { positivOk } from "../eval-regel.mjs";

const log = (...z) => z.join("\n");
test("Untergrenze ziel.positiv gilt immer, auch mit Vorlauf", () => {
  assert.equal(positivOk({ pos: 22, n: 29, zielPositiv: 23, logText: log("hint-eval x positiv=22/29 still=20/20 ok=1") }), false);
});
test("Maßstab ist der letzte BESTANDENE Lauf — ein verschlechterter Lauf senkt die Latte nicht", () => {
  const t = log("hint-eval a positiv=25/29 ok=1", "hint-eval b positiv=24/29 ok=0");
  assert.equal(positivOk({ pos: 24, n: 29, zielPositiv: 23, logText: t }), false);
  assert.equal(positivOk({ pos: 25, n: 29, zielPositiv: 23, logText: t }), true);
});
test("Neue Testfragen: verglichen werden Fehlschläge, nicht Treffer", () => {
  assert.equal(positivOk({ pos: 27, n: 31, zielPositiv: 23, logText: "hint-eval a positiv=25/29 ok=1" }), true);
  assert.equal(positivOk({ pos: 26, n: 31, zielPositiv: 23, logText: "hint-eval a positiv=25/29 ok=1" }), false);
});
test("Alte Zeilen ohne ok-Feld zählen als Maßstab, VERFEHLT-Zeilen werden ignoriert", () => {
  assert.equal(positivOk({ pos: 25, n: 29, zielPositiv: 23, logText: log("hint-eval a positiv=25/29", "VERFEHLT: x") }), true);
  assert.equal(positivOk({ pos: 24, n: 29, zielPositiv: 23, logText: "" }), true);
});
test("Expliziter Maßstab (ziel.basis) geht dem Log vor — datiert, nachvollziehbar", () => {
  const log = "hint-eval a positiv=25/27 ok=1";
  assert.equal(positivOk({ pos: 30, n: 33, zielPositiv: 30, logText: log }), false);                 // Log-Maßstab: 2 Fehler
  assert.equal(positivOk({ pos: 30, n: 33, zielPositiv: 30, logText: log, basisFehler: 3 }), true);  // explizit: 3 Fehler
  assert.equal(positivOk({ pos: 29, n: 33, zielPositiv: 29, logText: log, basisFehler: 3 }), false); // 4 > 3
});
