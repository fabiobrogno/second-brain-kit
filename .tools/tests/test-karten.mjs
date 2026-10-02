import { test } from "node:test";
import assert from "node:assert/strict";
import { saubereBegriffe, saubereAbschnitte } from "../karten.mjs";

test("Etiketten mit Doppelpunkt fliegen raus", () => {
  assert.deepEqual(saubereBegriffe(["Shops:", "MCPs:", "Connectoren/Dienste:", "Blue-Green mit Health-Gate"]), ["Blue-Green mit Health-Gate"]);
});
test("Füllwörter und Kurzbegriffe fliegen raus, Akronyme bleiben", () => {
  assert.deepEqual(saubereBegriffe(["kein", "soll", "alle", "neuen", "ab", "SKU", "ASIN", "MCP", "Smart Lock"]), ["SKU", "ASIN", "MCP", "Smart Lock"]);
});
test("Satzreste mit Zeilenumbruch oder Satzzeichen-Rand werden bereinigt, Dubletten entfernt", () => {
  assert.deepEqual(saubereBegriffe([", sonst reißt der HTTP-Client ab.\n5.", "hinterlässt\nkeine Spur", "Upsert", "Upsert"]), ["sonst reißt der HTTP-Client ab", "hinterlässt keine Spur", "Upsert"]);
});
test("Abschnitte: 'Verwandt'/'Einstieg' ohne Aussagewert raus", () => {
  assert.deepEqual(saubereAbschnitte(["Werkzeuge", "Verwandt", "Einstieg in die Details", "Die sechs Fallen"]), ["Werkzeuge", "Die sechs Fallen"]);
});

import { readFileSync } from "node:fs";
test("Holdout ist für Indexer und Karten tabu", () => {
  for (const f of ["../brain-index.mjs", "../karten.mjs"]) assert.ok(!readFileSync(new URL(f, import.meta.url), "utf8").includes("holdout"), f);
});

test("Aussagen mit Doppelpunkt bleiben (ohne Doppelpunkt), nur kurze Etiketten fliegen", () => {
  assert.deepEqual(saubereBegriffe(["Grüner Deploy beweist nichts:", "Abruffehler ≠ leer:", "Shops:", "Connectoren/Dienste:", "Aktive Repos:"]),
    ["Grüner Deploy beweist nichts", "Abruffehler ≠ leer"]);
});

import { inhaltsBegriffe } from "../karten.mjs";
test("Dünne Karte: Tabellenzellen und Listenpunkte liefern Begriffe, Daten/Zahlen/Kopfzeilen nicht", () => {
  const body = [
    "| Bereich | Repo | angelegt |", "|---|---|---|",
    "| MCP | beispiel-listing-mcp | 02.09. |", "| Connector | `llm-connector` | 22.09. |",
    "", "- **Shops:** beispiel-shop, zweiter-shop", "- **MCPs:** beispielMCP",
  ].join("\n");
  const b = inhaltsBegriffe(body);
  for (const x of ["beispiel-listing-mcp", "llm-connector", "Connector", "beispiel-shop", "zweiter-shop", "beispielMCP"]) assert.ok(b.includes(x), x);
  for (const x of ["02.09", "22.09", "Bereich", "angelegt", "---"]) assert.ok(!b.includes(x), x);
});
