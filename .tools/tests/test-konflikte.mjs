// .tools/tests/test-konflikte.mjs — Konflikt-Kästen (Format wiki/_schema.md) lesen; kaputte Kästen überspringen
import { test } from "node:test";
import assert from "node:assert/strict";
import { konflikte, konfliktKaesten, fingerabdruck } from "../konflikte.mjs";

const SEITE = [
  "---", "name: thema_preise", "description: Preise", "---", "# Preise", "",
  "> [!KONFLIKT] offen — Du entscheidest",
  '> A: "Der Tarif kostet 12 Euro" — Quelle: [[quelle_tarif-alt]]',
  '> B: "Der Tarif kostet 15 Euro" — Quelle: [[ordner/quelle_tarif-neu|neue Liste]]',
  "", "Text dazwischen.", "",
  "   > [!KONFLIKT] offen — Du entscheidest",
  "   > A: „Termin ist im März“ — Quelle: [[notiz_termin]]",
  "   > B: Termin ist im April",
  "",
].join("\n");

test("zwei Kästen: Nummern, Zeilen, Aussagen ohne Anführungszeichen, Quelle = Link-Ziel ohne Alias", () => {
  const k = konflikte(SEITE);
  assert.equal(k.length, 2);
  assert.deepEqual(k[0], {
    nr: 1, zeile: 7,
    a: { text: "Der Tarif kostet 12 Euro", quelle: "quelle_tarif-alt" },
    b: { text: "Der Tarif kostet 15 Euro", quelle: "ordner/quelle_tarif-neu" },
    fp: fingerabdruck("Der Tarif kostet 12 Euro", "Der Tarif kostet 15 Euro"),
  });
  assert.match(k[0].fp, /^[0-9a-f]{12}$/);
  assert.equal(k[1].nr, 2);
  assert.equal(k[1].zeile, 13);
  assert.deepEqual(k[1].a, { text: "Termin ist im März", quelle: "notiz_termin" });
  assert.deepEqual(k[1].b, { text: "Termin ist im April", quelle: null });
});

test("kaputter Kasten (B fehlt) wird übersprungen, behält aber seine Nummer", () => {
  const md = [
    "> [!KONFLIKT] offen — Du entscheidest",
    '> A: "nur eine Seite" — Quelle: [[x]]',
    "",
    "> [!KONFLIKT] offen — Du entscheidest",
    '> A: "eins" — Quelle: [[a]]',
    '> B: "zwei" — Quelle: [[b]]',
    "> [!KONFLIKT] offen",
    "> A:",
    '> B: "leer A"',
  ].join("\n");
  const k = konflikte(md);
  assert.equal(k.length, 1);
  assert.equal(k[0].nr, 2);
  assert.equal(k[0].zeile, 4);
  assert.equal(k[0].a.text, "eins");
});

test("CRLF und BOM; erledigte Kästen und Codeblöcke zählen nicht; ohne Kasten → []", () => {
  const crlf = "﻿> [!KONFLIKT] offen — Du entscheidest\r\n> A: \"x\" — Quelle: [[q1]]\r\n> B: \"y\" — Quelle: [[q2]]\r\n";
  const k = konflikte(crlf);
  assert.equal(k.length, 1);
  assert.equal(k[0].zeile, 1);
  assert.deepEqual(k[0].b, { text: "y", quelle: "q2" });
  const code = "```\n> [!KONFLIKT] offen — Du entscheidest\n> A: \"x\"\n> B: \"y\"\n```\n> [!KONFLIKT] erledigt\n> A: \"x\"\n> B: \"y\"\n";
  assert.deepEqual(konflikte(code), []);
  assert.deepEqual(konflikte("# leer\n"), []);
  assert.deepEqual(konflikte(undefined), []);
});

test("Kasten endet an einer Zeile ohne '>' — nur EINE Leerzeile direkt vor der fehlenden A/B-Zeile wird überbrückt", () => {
  // W1-Review #13: Leerzeile mitten im Kasten ist üblich (Editoren fügen sie ein) → entscheidbar
  const luecke = konflikte("> [!KONFLIKT] offen\n> A: \"x\"\n\n> B: \"y\"\n");
  assert.equal(luecke.length, 1);
  assert.equal(luecke[0].b.text, "y");
  // Text dazwischen oder zwei Leerzeilen beenden den Kasten
  assert.deepEqual(konflikte("> [!KONFLIKT] offen\n> A: \"x\"\nText\n> B: \"y\"\n"), []);
  assert.deepEqual(konflikte("> [!KONFLIKT] offen\n> A: \"x\"\n\n\n> B: \"y\"\n"), []);
});

test("übliche Formatvarianten sind entscheidbar (W1-Review #13)", () => {
  const faelle = {
    fett: "> [!KONFLIKT] offen\n> **A:** eins — Quelle: [[qa]]\n> **B:** zwei — Quelle: [[qb]]\n",
    fettNachDoppelpunkt: "> [!KONFLIKT] offen\n> **A**: eins\n> **B**: zwei\n",
    liste: "> [!KONFLIKT] offen\n> - A: eins\n> - B: zwei\n",
    klein: "> [!KONFLIKT] offen\n> a: eins\n> b: zwei\n",
    faltungZu: "> [!KONFLIKT]- offen\n> A: eins\n> B: zwei\n",
    faltungAuf: "> [!KONFLIKT]+ offen\n> A: eins\n> B: zwei\n",
  };
  for (const [name, md] of Object.entries(faelle)) {
    const k = konflikte(md);
    assert.equal(k.length, 1, name);
    assert.equal(k[0].a.text, "eins", name);
    assert.equal(k[0].b.text, "zwei", name);
  }
});

test("„Quellen:“ mit mehreren Links: sauberer Text, erste Quelle", () => {
  const k = konflikte('> [!KONFLIKT] offen\n> A: "rot" — Quellen: [[qa]], [[qa2]]\n> B: „blau“ — Quellen: [[qb]], [[qc]]\n');
  assert.deepEqual(k[0].a, { text: "rot", quelle: "qa" });
  assert.deepEqual(k[0].b, { text: "blau", quelle: "qb" });
});

test("Codeblock endet nur mit gleichem Zaun ≥ Länge: Kasten nach verschachteltem Zaun zählt, im Block nicht", () => {
  const md = [
    "````md", "```", "> [!KONFLIKT] offen", "> A: im Beispiel", "> B: auch im Beispiel", "```", "````",
    "> [!KONFLIKT] offen", "> A: echt", "> B: auch echt",
    "~~~", "> [!KONFLIKT] offen", "> A: x", "> B: y", "```", "~~~",
  ].join("\n");
  const k = konflikte(md);
  assert.equal(k.length, 1);
  assert.equal(k[0].a.text, "echt");
  assert.equal(k[0].nr, 1);
});

test("konfliktKaesten zählt kaputte Kästen; Fingerabdruck hängt an den Aussagen, nicht an der Nummer", () => {
  const r = konfliktKaesten("> [!KONFLIKT] offen\n> A: nur A\n\n> [!KONFLIKT] offen\n> A: rot\n> B: blau\n");
  assert.equal(r.kaputt, 1);
  assert.equal(r.konflikte.length, 1);
  assert.equal(r.konflikte[0].nr, 2);
  const allein = konflikte("> [!KONFLIKT] offen\n> A: rot\n> B: blau\n");
  assert.equal(allein[0].nr, 1);
  assert.equal(allein[0].fp, r.konflikte[0].fp, "gleicher Fingerabdruck trotz anderer Nummer");
  assert.notEqual(fingerabdruck("rot", "blau"), fingerabdruck("blau", "rot"));
  assert.equal(fingerabdruck("rot  innen", "blau"), fingerabdruck("rot innen", "blau"), "Leerraum egal");
});
