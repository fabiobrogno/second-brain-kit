// .tools/tests/test-seitenfelder.mjs — Seitenfelder Zeit/Ersetzen/Kritisch/Zweifel (B1, §4.2/§4.3).
import { test } from "node:test";
import assert from "node:assert/strict";
import { frontmatterText, linkZiel, leseSeitenFelder, pruefeSeitenFelder } from "../seitenfelder.mjs";

const seite = (fm, body = "# Beet\n\nText.\n") => `---\nname: beet\ndescription: Beet\n${fm}---\n\n${body}`;
const ohneRoh = (f) => ({ ...f, roh: undefined });

test("linkZiel: Wikilink mit/ohne Anzeige-Text und Anker → Ziel; alles andere → leer", () => {
  assert.equal(linkZiel("[[thema_beet_neu]]"), "thema_beet_neu");
  assert.equal(linkZiel(" [[garten/thema_beet_neu|neu]] "), "garten/thema_beet_neu");
  assert.equal(linkZiel("[[thema_beet_neu#Stand]]"), "thema_beet_neu");
  for (const w of ["thema_beet_neu", "[thema]", "[[]]", "[[a]] [[b]]", "", null]) assert.equal(linkZiel(w), "", String(w));
});

test("leseSeitenFelder: alle Felder; ersetzt_durch mit und ohne Anführungszeichen; fehlende Felder → null/false", () => {
  const f = leseSeitenFelder(seite("gilt_seit: 2026-10-21\nersetzt_durch: \"[[thema_beet_neu]]\"\nkritisch: true\nzweifel: \"2026-10-22: Nutzer sagt, abends gießen\"\n"));
  assert.deepEqual(ohneRoh(f), { giltSeit: "2026-10-21", ersetztDurch: "thema_beet_neu", kritisch: true, zweifel: "2026-10-22: Nutzer sagt, abends gießen", roh: undefined });
  assert.equal(leseSeitenFelder(seite("ersetzt_durch: [[thema_beet_neu]]\n")).ersetztDurch, "thema_beet_neu");
  assert.deepEqual(ohneRoh(leseSeitenFelder(seite(""))), { giltSeit: null, ersetztDurch: null, kritisch: false, zweifel: null, roh: undefined });
});

test("kritisch ist fail-safe: nur genau false ist nicht kritisch — \"true\", ja, True, leer → kritisch + Lint KRITISCH", () => {
  assert.equal(leseSeitenFelder(seite("kritisch: false\n")).kritisch, false);
  assert.deepEqual(pruefeSeitenFelder(seite("kritisch: false\n")), []);
  assert.deepEqual(pruefeSeitenFelder(seite("kritisch: true\n")), []);
  for (const w of ["\"true\"", "ja", "True", "", "yes", "false # alt"]) {
    const t = seite(`kritisch: ${w}\n`);
    assert.equal(leseSeitenFelder(t).kritisch, true, w);
    assert.deepEqual(pruefeSeitenFelder(t).map((b) => b.klasse), ["KRITISCH"], w);
  }
});

test("gilt_seit: nur gültiges Datum JJJJ-MM-TT; 2026-02-30, 21.10.2026, morgen → GILT_SEIT", () => {
  assert.equal(leseSeitenFelder(seite("gilt_seit: \"2026-10-21\"\n")).giltSeit, "2026-10-21");
  for (const w of ["2026-02-30", "21.10.2026", "morgen"]) {
    const t = seite(`gilt_seit: ${w}\n`);
    assert.equal(leseSeitenFelder(t).giltSeit, null, w);
    assert.deepEqual(pruefeSeitenFelder(t).map((b) => b.klasse), ["GILT_SEIT"], w);
  }
});

test("ersetzt_durch ohne Wikilink → \"\" + ERSETZT; Felder nur im Seitentext zählen nicht", () => {
  const t = seite("ersetzt_durch: thema_beet_neu\n");
  assert.equal(leseSeitenFelder(t).ersetztDurch, "");
  assert.deepEqual(pruefeSeitenFelder(t).map((b) => b.klasse), ["ERSETZT"]);
  const nurText = seite("", "# Beet\n\nersetzt_durch: [[x]]\nkritisch: kaputt\n");
  assert.deepEqual(ohneRoh(leseSeitenFelder(nurText)), { giltSeit: null, ersetztDurch: null, kritisch: false, zweifel: null, roh: undefined });
  assert.deepEqual(pruefeSeitenFelder(nurText), []);
});

test("leseSeitenFelder: BOM + CRLF (Windows-Checkout) wie LF; offenes Frontmatter → keine Felder", () => {
  const t = "﻿---\r\nname: beet\r\nkritisch: true\r\nersetzt_durch: \"[[thema_neu]]\"\r\n---\r\n\r\n# Beet\r\n";
  assert.equal(frontmatterText(t), "name: beet\nkritisch: true\nersetzt_durch: \"[[thema_neu]]\"");
  assert.equal(leseSeitenFelder(t).kritisch, true);
  assert.equal(leseSeitenFelder(t).ersetztDurch, "thema_neu");
  assert.equal(leseSeitenFelder("---\nkritisch: true\nohne Ende").kritisch, false);
});
