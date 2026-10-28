// .tools/tests/test-heikel.mjs — Einheitentests für heikel.mjs (Spec §4.3). Abnahmefälle: test-heikel-abnahme.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { istHeikel, GRUENDE } from "../heikel.mjs";

const grund = (t) => istHeikel(t).gruende;
const KEY = ["api", "_key"].join("") + "=abc123xyz";

test("geld: Beträge, Währungen, Preis-Wörter", () => {
  for (const t of ["Das kostet 12 Euro.", "Budget 500 $", "Die Rechnung kam gestern.", "Monatliche Gebühr", "Gehalt steigt", "price list"]) {
    assert.ok(grund(t).includes("geld"), t);
  }
  assert.ok(!grund("Preiselbeeren wachsen am Zaun.").includes("geld"));
});

test("recht: Vertrag, Datenschutz, Haftung, Lizenz", () => {
  for (const t of ["Der Vertrag wurde gekündigt", "Datenschutzerklärung prüfen", "Haftung ausgeschlossen", "MIT-Lizenz", "GDPR request"]) {
    assert.ok(grund(t).includes("recht"), t);
  }
  assert.ok(!grund("Die Tür ist gerecht gestrichen und aufrecht.").includes("recht"));
});

test("person: PII-Filter und Anrede mit Name", () => {
  for (const t of ["Mail an jo@example.com", "Frau Muster ruft zurück", "Dr. Beispiel hat zugesagt", "IBAN DE89 3704 0044 0532 0130 00"]) {
    assert.ok(grund(t).includes("person"), t);
  }
  assert.ok(!grund("Herbst im Garten").includes("person"));
});

test("zugang: Secret-Muster und Wortliste", () => {
  for (const t of [KEY, ["Bear","er abcdefgh12345"].join(""), "Zugang zum Server", "ssh auf die Produktion", ["postgres:","//u:pw@db/x"].join("")]) {
    assert.ok(grund(t).includes("zugang"), t);
  }
});

test("mehrere Gründe, feste Reihenfolge, nur bekannte Gründe", () => {
  const r = istHeikel("Der Vertrag kostet 40 € – Frau Muster, jo@example.com, Server-Zugang");
  assert.deepEqual(r.gruende, GRUENDE);
  assert.equal(r.heikel, true);
});

test("Alltag, leer, null, Zahl, Objekt: nie heikel, nie ein Wurf", () => {
  for (const t of ["Der Salat wächst.", "", "   ", null, undefined, 42, {}]) {
    assert.deepEqual(istHeikel(t), { heikel: false, gruende: [] }, String(t));
  }
});
