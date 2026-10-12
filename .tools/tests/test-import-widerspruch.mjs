// .tools/tests/test-import-widerspruch.mjs — Widerspruchs-Erkennung beim Import: keine Fehlalarme bei Navigationszeilen,
// gleicher URL in anderer Formulierung und „Stand …“-Angaben zu verschiedenen Dingen; echte Widersprüche bleiben.
import { test } from "node:test";
import assert from "node:assert/strict";
import { vergleicheNotizen } from "../import/widerspruch.mjs";

const vgl = (x, y) => vergleicheNotizen(
  { datei: "2026-07-30.md", text: x, datum: "2026-07-30" },
  { datei: "2026-07-31.md", text: y, datum: "2026-07-31" },
).map(w => w.art);

test("Navigationszeilen zwischen Tagesprotokollen sind kein Widerspruch", () => {
  assert.deepEqual(vgl(
    "Vorheriger Tag: 2026-07-29 · Nächster Tag: 2026-07-31",
    "Vorheriger Tag: 2026-07-30 · Nächster Tag: 2026-08-01"), []);
  assert.deepEqual(vgl(
    "[[2026-07-29]] ← Vorheriger Tag | Nächster Tag → [[2026-07-31]]",
    "[[2026-07-30]] ← Vorheriger Tag | Nächster Tag → [[2026-08-01]]"), []);
  assert.deepEqual(vgl("Zurück: 2026-07-29 | Weiter: 2026-07-31", "Zurück: 2026-07-30 | Weiter: 2026-08-01"), []);
});

test("Dieselbe URL in zwei Formulierungen ist kein Widerspruch", () => {
  assert.deepEqual(vgl(
    "| Heft-Canvas | https://example.org/canvas/2026-07-30/v2 |",
    "Heft-Canvas (Stand 2026-07-31): https://example.org/canvas/2026-07-30/v2"), []);
  assert.deepEqual(vgl(
    "Heft-Canvas liegt unter https://example.org/canvas/12345 bereit.",
    "Heft-Canvas: https://example.org/canvas/12345 (3 Seiten)"), []);
});

test("„Stand“-Angaben zu verschiedenen Dingen sind kein Widerspruch", () => {
  assert.deepEqual(vgl("Stand 2026-07-30: Heft-Canvas fertig.", "Stand 2026-07-31: Server migriert."), []);
  assert.deepEqual(vgl("Stand 2026-07-30", "Stand 2026-07-31"), []);
  assert.deepEqual(vgl("Stand 2026-07-30 Heft-Canvas überarbeitet", "Stand 2026-07-31 Newsletter versendet"), []);
});

test("Echte Widersprüche werden weiterhin gemeldet", () => {
  // Gleiches Subjekt, anderes Datum.
  assert.deepEqual(vgl("Der Umzug der Redaktion ist am 2026-08-01.", "Der Umzug der Redaktion ist am 2026-08-15."), ["datum"]);
  assert.deepEqual(vgl("Heft-Canvas: Stand 2026-07-30.", "Heft-Canvas: Stand 2026-07-20."), ["datum"]);
  // Gleiches Subjekt, anderer Wert / andere Version / Richtung.
  assert.deepEqual(vgl("Das Heft-Abo kostet 49 € im Monat.", "Das Heft-Abo kostet 59 € im Monat."), ["zahl"]);
  assert.deepEqual(vgl("Die Wetterstation läuft mit Firmware v1.2.0.", "Die Wetterstation läuft mit Firmware v1.3.0."), ["version"]);
  assert.deepEqual(vgl("Backup ist nicht aktiv.", "Backup ist aktiv."), ["jaNein"]);
  // Gleiche Zeile mit unterschiedlicher URL bleibt auffällig.
  assert.deepEqual(vgl("Das Heft-Canvas liegt unter https://a.example.org/x, Preis 5 €.", "Das Heft-Canvas liegt unter https://b.example.org/x, Preis 7 €."), ["zahl"]);
});

test("Gleiche URL verdeckt keinen echten Widerspruch im übrigen Satz", () => {
  assert.deepEqual(vgl(
    "Der Lizenzpreis beträgt 120 € pro Jahr laut https://example.com/preise",
    "Der Lizenzpreis beträgt 150 € pro Jahr laut https://example.com/preise"), ["zahl"]);
});
