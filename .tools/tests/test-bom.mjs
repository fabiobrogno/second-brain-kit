// .tools/tests/test-bom.mjs — Härtung: BOM überall tolerieren, Lint prüft die Ich-Karte (Task 8)
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { entferneBom } from "../pfade.mjs";

const T = fileURLToPath(new URL("..", import.meta.url));
const tempVault = () => mkdtempSync(join(tmpdir(), "brain bom "));
const minimalVault = () => {
  const v = tempVault();
  writeFileSync(join(v, "brain.config.json"), JSON.stringify({ clusters: [] }));
  mkdirSync(join(v, "09_wiki"), { recursive: true });
  return v;
};
const index = (v) => execFileSync(process.execPath, [join(T, "brain-index.mjs"), v], { windowsHide: true });
const lint = (v) => {
  try { return execFileSync(process.execPath, [join(T, "brain-lint.mjs"), v], { encoding: "utf8", windowsHide: true }); }
  catch (e) { return String(e.stdout || ""); }
};

test("entferneBom: entfernt nur ein führendes BOM, lässt den Rest unangetastet", () => {
  assert.equal(entferneBom("﻿# Titel"), "# Titel");
  assert.equal(entferneBom("# Titel"), "# Titel");
  assert.equal(entferneBom("Text ﻿ mitten drin"), "Text ﻿ mitten drin");
});

test("Wiki-Seite mit BOM + CRLF: Index erzeugt korrekten Eintrag (Titel/Beschreibung), Lint meldet keinen Frontmatter-Fehler, Karte korrekt", () => {
  const v = minimalVault();
  const inhalt = "﻿---\r\ndescription: Testseite mit BOM\r\n---\r\n# Bomtitel\r\n\r\nEin Satz mit **Wichtigbegriff**.\r\n";
  writeFileSync(join(v, "09_wiki", "bom_seite.md"), inhalt);

  index(v);
  const wikiIdx = readFileSync(join(v, "09_wiki", "_index.md"), "utf8");
  // Ohne BOM-Behandlung matcht die Frontmatter-Regex nicht → description bleibt leer, Fallback wäre der Titel.
  assert.match(wikiIdx, /Testseite mit BOM/, "description aus dem Frontmatter nicht übernommen (BOM nicht entfernt?)");

  const karte = readFileSync(join(v, ".logs", "hint-karten", "bom_seite.md"), "utf8");
  assert.match(karte, /Bomtitel/);
  assert.match(karte, /Wichtigbegriff/);

  const lintOut = lint(v);
  assert.doesNotMatch(lintOut, /FRONTMATTER/, "Lint hält das BOM-Frontmatter fälschlich für fehlend");
});

test("ich.md über 1500 Zeichen → Lint-Warnung mit Zeichenzahl; bis 1500 Zeichen → keine Warnung", () => {
  const v = minimalVault();
  writeFileSync(join(v, "09_wiki", "ich.md"), "x".repeat(1600));
  assert.match(lint(v), /ICH-KARTE zu lang \(1600 Zeichen, höchstens 1500\)/);

  writeFileSync(join(v, "09_wiki", "ich.md"), "x".repeat(1400));
  assert.doesNotMatch(lint(v), /ICH-KARTE/);

  writeFileSync(join(v, "09_wiki", "ich.md"), "x".repeat(1500));
  assert.doesNotMatch(lint(v), /ICH-KARTE/, "genau 1500 Zeichen ist noch kein Befund (> 1500, nicht >=)");
});

test("ich.md mit BOM: die BOM-Zeichen zählen nicht gegen das Zeichenlimit", () => {
  const v = minimalVault();
  writeFileSync(join(v, "09_wiki", "ich.md"), "﻿" + "x".repeat(1500));
  assert.doesNotMatch(lint(v), /ICH-KARTE/, "BOM darf nicht als Inhaltszeichen mitgezählt werden");
});
