// .tools/tests/test-gueltigkeit.mjs — Gültigkeit aus Frontmatter: Datumsgrenzen, verfall, CRLF/BOM, ungültige Daten
import { test } from "node:test";
import assert from "node:assert/strict";
import { gueltigkeit, datumNr } from "../gueltigkeit.mjs";

// Feste "jetzt"-Zeit mittags in lokaler Zeit — Tagesgrenzen hängen nicht an der Zeitzone des Testrechners
const JETZT = new Date(2026, 9, 3, 12, 0, 0).getTime(); // 03.10.2026, 12:00 lokal
const TAG = 86400000;
const fm = (...zeilen) => `---\nname: x\ndescription: x\n${zeilen.join("\n")}\n---\n# X\n`;

test("ohne Felder → ohne, nichts gesetzt", () => {
  assert.deepEqual(gueltigkeit(fm(), { jetzt: JETZT }), { status: "ohne", stand: null, pruefenBis: null, tageUeber: 0, grund: null });
  assert.equal(gueltigkeit("", { jetzt: JETZT }).status, "ohne");
  assert.equal(gueltigkeit(undefined, { jetzt: JETZT }).status, "ohne");
});

test("pruefen_bis: heute → noch nicht abgelaufen (bald), gestern → abgelaufen seit 1 Tag", () => {
  const h = gueltigkeit(fm("pruefen_bis: 2026-10-03"), { jetzt: JETZT });
  assert.equal(h.status, "bald");
  assert.equal(h.tageUeber, 0);
  assert.equal(h.pruefenBis, "2026-10-03");
  assert.equal(h.grund, "pruefen_bis");
  const g = gueltigkeit(fm("pruefen_bis: 2026-10-02"), { jetzt: JETZT });
  assert.equal(g.status, "abgelaufen");
  assert.equal(g.tageUeber, 1);
  assert.equal(gueltigkeit(fm("pruefen_bis: 2026-09-03"), { jetzt: JETZT }).tageUeber, 30);
});

test("pruefen_bis: ≤ 14 Tage → bald, 15 Tage → ok", () => {
  assert.equal(gueltigkeit(fm("pruefen_bis: 2026-10-17"), { jetzt: JETZT }).status, "bald");
  assert.equal(gueltigkeit(fm("pruefen_bis: 2026-10-18"), { jetzt: JETZT }).status, "ok");
});

test("Tagesgrenze: kurz vor bzw. nach Mitternacht lokal", () => {
  const spaet = new Date(2026, 9, 3, 23, 59, 59).getTime(), frueh = new Date(2026, 9, 4, 0, 0, 1).getTime();
  assert.equal(gueltigkeit(fm("pruefen_bis: 2026-10-03"), { jetzt: spaet }).status, "bald");
  assert.equal(gueltigkeit(fm("pruefen_bis: 2026-10-03"), { jetzt: frueh }).status, "abgelaufen");
});

test("stand wird übernommen (nur gültige Daten), ändert den Status nicht", () => {
  const r = gueltigkeit(fm("stand: 2026-09-01"), { jetzt: JETZT });
  assert.equal(r.stand, "2026-09-01");
  assert.equal(r.status, "ohne");
  assert.equal(gueltigkeit(fm('stand: "2026-09-01"', "pruefen_bis: '2027-01-01'"), { jetzt: JETZT }).status, "ok");
  assert.equal(gueltigkeit(fm("stand: gestern"), { jetzt: JETZT }).stand, null);
});

test("ungültige Daten → ohne", () => {
  for (const d of ["2026-02-30", "2026-13-01", "morgen", "03.10.2026", "", "2026-10-3"])
    assert.equal(gueltigkeit(fm(`pruefen_bis: ${d}`), { jetzt: JETZT }).status, "ohne", d);
  assert.equal(datumNr("2028-02-29") != null, true);
  assert.equal(datumNr("2027-02-29"), null);
});

test("verfall relativ zum letzten Commit; ohne Commit → ohne", () => {
  assert.equal(gueltigkeit(fm("verfall: 30"), { jetzt: JETZT }).status, "ohne");
  assert.equal(gueltigkeit(fm("verfall: 30"), { letzterCommitMs: null, jetzt: JETZT }).status, "ohne");
  assert.equal(gueltigkeit(fm("verfall: 30"), { letzterCommitMs: 0, jetzt: JETZT }).status, "ohne");
  const ab = gueltigkeit(fm("verfall: 30"), { letzterCommitMs: JETZT - 40 * TAG, jetzt: JETZT });
  assert.equal(ab.status, "abgelaufen");
  assert.equal(ab.tageUeber, 10);
  assert.equal(ab.grund, "verfall");
  // genau 30 Kalendertage: Frist ist heute → noch nicht abgelaufen
  assert.equal(gueltigkeit(fm("verfall: 30"), { letzterCommitMs: JETZT - 30 * TAG, jetzt: JETZT }).status, "bald");
  assert.equal(gueltigkeit(fm("verfall: 30"), { letzterCommitMs: JETZT - 31 * TAG, jetzt: JETZT }).tageUeber, 1);
  assert.equal(gueltigkeit(fm("verfall: 30"), { letzterCommitMs: JETZT - 5 * TAG, jetzt: JETZT }).status, "ok");
  assert.equal(gueltigkeit(fm("verfall: 30"), { letzterCommitMs: JETZT - 5 * TAG, jetzt: JETZT }).pruefenBis, "2026-10-28");
  assert.equal(gueltigkeit(fm("verfall: abc"), { letzterCommitMs: JETZT - 99 * TAG, jetzt: JETZT }).status, "ohne");
});

test("verfall rechnet in Kalendertagen: Status und Frist kippen gemeinsam um Mitternacht (W1-Review #10)", () => {
  // Commit 01.10. 23:00, verfall 1 → Frist 02.10.; Lint-Semantik bewusst geändert: nicht mehr „volle 24-h-Tage“
  const commit = new Date(2026, 9, 1, 23, 0, 0).getTime();
  const am = (tag, stunde) => gueltigkeit(fm("verfall: 1"), { letzterCommitMs: commit, jetzt: new Date(2026, 9, tag, stunde, 0, 0).getTime() });
  assert.deepEqual([am(2, 8).status, am(2, 8).pruefenBis], ["bald", "2026-10-02"], "Frist ist heute");
  assert.deepEqual([am(2, 23).status, am(2, 23).pruefenBis], ["bald", "2026-10-02"], "noch derselbe Tag");
  assert.deepEqual([am(3, 0).status, am(3, 0).tageUeber], ["abgelaufen", 1], "ab Mitternacht abgelaufen");
  assert.deepEqual([am(3, 8).status, am(3, 8).pruefenBis, am(3, 8).tageUeber], ["abgelaufen", "2026-10-02", 1], "kein „bald“ mit Frist gestern");
});

test("pruefen_bis und verfall: die strengere Frist gilt", () => {
  const r = gueltigkeit(fm("pruefen_bis: 2026-10-01", "verfall: 10"), { letzterCommitMs: JETZT - 20 * TAG, jetzt: JETZT });
  assert.equal(r.status, "abgelaufen");
  assert.equal(r.tageUeber, 10);
  assert.equal(r.grund, "verfall");
  const s = gueltigkeit(fm("pruefen_bis: 2026-09-01", "verfall: 365"), { letzterCommitMs: JETZT - TAG, jetzt: JETZT });
  assert.equal(s.grund, "pruefen_bis");
  assert.equal(s.status, "abgelaufen");
});

test("CRLF und BOM; auch reiner Frontmatter-Inhalt ohne ---", () => {
  const crlf = "﻿---\r\nname: x\r\npruefen_bis: 2026-10-02\r\nstand: 2026-01-05\r\n---\r\n# X\r\n";
  const r = gueltigkeit(crlf, { jetzt: JETZT });
  assert.equal(r.status, "abgelaufen");
  assert.equal(r.stand, "2026-01-05");
  assert.equal(gueltigkeit("pruefen_bis: 2026-10-02\nverfall: 3", { jetzt: JETZT }).status, "abgelaufen");
  // Feld nur im Text (nicht im Frontmatter) zählt nicht
  assert.equal(gueltigkeit("---\nname: x\n---\npruefen_bis: 2020-01-01\n", { jetzt: JETZT }).status, "ohne");
});
