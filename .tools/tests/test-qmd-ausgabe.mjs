// .tools/tests/test-qmd-ausgabe.mjs — Parser für `qmd ... --files` (CSV: #<docid>,<score>,<pfad>[,"<kontext>"])
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseQmdDateien } from "../qmd-ausgabe.mjs";

test("einfacher Record ohne Kontext", () => {
  const r = parseQmdDateien("#f989b7,0.91,qmd://brain/x.md");
  assert.deepEqual(r, [{ pfad: "qmd://brain/x.md", score: 0.91 }]);
});

test("Record mit gequotetem Kontext, der Kommas enthält", () => {
  const r = parseQmdDateien('#582ae4,0.90,qmd://brain/y.md,"a, b, c"');
  assert.deepEqual(r, [{ pfad: "qmd://brain/y.md", score: 0.90 }]);
});

test("Record mit mehrzeiligem gequotetem Kontext — Fortsetzungszeilen erzeugen keine Einträge", () => {
  const text = [
    '#e7df39,0.90,qmd://brain/z.md,"zeile1',
    "zeile2",
    'zeile3"',
  ].join("\n");
  const r = parseQmdDateien(text);
  assert.deepEqual(r, [{ pfad: "qmd://brain/z.md", score: 0.90 }]);
});

test("leere Eingabe → []", () => {
  assert.deepEqual(parseQmdDateien(""), []);
});

test("Pfad mit Leerzeichen und Umlaut bleibt erhalten, endet am ersten Komma", () => {
  const r = parseQmdDateien('#abc123,0.75,qmd://brain/10_projekte/Jörg Müller notiz.md,"kontext"');
  assert.deepEqual(r, [{ pfad: "qmd://brain/10_projekte/Jörg Müller notiz.md", score: 0.75 }]);
});

test("mehrere Records in Ausgabe-Reihenfolge", () => {
  const text = [
    "#aaa111,0.95,qmd://brain/a.md",
    "#bbb222,0.80,qmd://brain/b.md",
  ].join("\n");
  assert.deepEqual(parseQmdDateien(text), [
    { pfad: "qmd://brain/a.md", score: 0.95 },
    { pfad: "qmd://brain/b.md", score: 0.80 },
  ]);
});
