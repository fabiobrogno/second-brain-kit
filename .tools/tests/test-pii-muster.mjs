// .tools/tests/test-pii-muster.mjs — Kundendaten-Heuristik (pii-muster.mjs): jede Art positiv, Alltagstexte aus
// Fehlermeldungen/Logs negativ. Köder (erfundene Daten) werden erst zur Laufzeit zusammengesetzt.
import { test } from "node:test";
import assert from "node:assert/strict";
import { findePii, hatPii } from "../pii-muster.mjs";

const j = (...t) => t.join("");

test("findePii: jede Art wird erkannt (nur die Art, nie der Text)", () => {
  const faelle = [
    ["email", j("Kontakt: erika.beispiel", "@", "kunde-muster", ".test")],
    ["telefon", j("Tel. +49 ", "171 ", "2345678")],
    ["telefon", j("Rückruf 0171 ", "2345678")],
    ["telefon", j("030/", "1234567")],
    ["telefon", j("Handy: ", "0151 23 45 67 89")],
    ["iban", j("DE89 ", "3704 0044 ", "0532 0130 00")],
    ["iban", j("DE89", "370400440532013000")],
    ["adresse", j("Muster", "straße 12")],
    ["adresse", j("Hauptstr. ", "3a")],
    ["adresse", j("Am Birken", "weg 4")],
    ["adresse", j("Überweg ", "5")],
    ["adresse", j("Erika, ", "12345 Musterstadt")],
  ];
  for (const [art, text] of faelle) {
    const arten = findePii(text);
    assert.ok(arten.includes(art), `${art}: ${JSON.stringify(arten)}`);
    assert.ok(arten.every(a => ["email", "telefon", "iban", "adresse"].includes(a)), "nur Arten, nie Fundtext");
  }
});

test("hatPii: auch über Zeilengrenzen", () => {
  assert.equal(hatPii(j("Telefon:\n", "030 12 34 56")), true);
});

test("Alltagstexte aus Fehlermeldungen und Logs schlagen nicht an", () => {
  for (const s of [
    "Datum 2026-10-03 um 12:30", "Version 1.2.3", "Exit code 127", "line 1234 of file", "10000 Zeilen gelesen",
    "commit abcdef1234567", "port 4711/4712", "Fehler: ENOENT", "https://example.org/a@b", "git push origin main",
    "Wert 0.12345678", "Zeitstempel 1696334400000", "node v26.1.0", "Tokens: 12000 · 3400", "id 0123456789abcdef",
    "Gießplan: Tomaten abends gießen", "Cannot find module 'a.js' (code 127)", "Build failed: missing dependency",
  ]) assert.deepEqual(findePii(s), [], s);
});
