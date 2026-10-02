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

// Import-Karten (Ruling Fix-Runde 2): brain-index erzeugt Karten auch für <inbox>/_import/**.md — ohne den Bericht,
// ohne schon eingearbeitete Notizen — und trägt sie in wiki-map.paths ein, damit der Hinweis-Hook sie findet.
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { qmdPath } from "../qmd-pfad.mjs";

test("brain-index: Karten für Import-Notizen (ohne _bericht.md, ohne eingearbeitete), Waisen werden entfernt", () => {
  const v = join(mkdtempSync(join(tmpdir(), "brain karten ")), "Brain mit Ü, Komma's");
  const imp = join(v, "00_inbox", "_import", "altes-brain");
  mkdirSync(join(imp, "Reisen"), { recursive: true });
  mkdirSync(join(v, "09_wiki"), { recursive: true });
  writeFileSync(join(v, "brain.config.json"), JSON.stringify({ wiki: { ordner: "09_wiki" } }) + "\n");
  writeFileSync(join(v, "09_wiki", "thema_garten.md"),
    '---\nname: garten\ndescription: Garten\ntyp: thema\nquellen: ["00_inbox/_import/altes-brain/Garten.md"]\n---\n# Garten\n\nText.\n');
  writeFileSync(join(imp, "Reisen", "Fähre nach Föhr.md"), "﻿# Fähre nach Föhr\r\n\r\nDie Fähre fährt ab **Dagebüll** um 9 Uhr.\r\n\r\n## Rückfahrt\r\n\r\nAm Abend.\r\n");
  writeFileSync(join(imp, "Garten.md"), "# Garten\n\nSchon eingearbeitet.\n");
  writeFileSync(join(imp, "_bericht.md"), "# Import — Vorprüfung\n");
  writeFileSync(join(imp, "_import.json"), "{}\n");
  const umg = { PATH: process.env.PATH, HOME: v, USERPROFILE: v };
  const lauf = () => spawnSync(process.execPath, [fileURLToPath(new URL("../brain-index.mjs", import.meta.url)), v], { encoding: "utf8", windowsHide: true, env: umg });
  const r = lauf();
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const map = JSON.parse(readFileSync(join(v, ".logs", "wiki-map.json"), "utf8"));
  const dir = join(v, ".logs", "hint-karten");
  const importKarten = readdirSync(dir).filter(f => f.startsWith("import-"));
  assert.equal(importKarten.length, 1, importKarten.join());
  const karte = importKarten[0];
  assert.equal(map.paths[qmdPath(karte)], "00_inbox/_import/altes-brain/Reisen/Fähre nach Föhr.md");
  const text = readFileSync(join(dir, karte), "utf8");
  assert.match(text, /^# Fähre nach Föhr\n/);
  assert.match(text, /Dagebüll/);
  assert.match(text, /Abschnitte: Rückfahrt/);
  assert.ok(!text.includes("﻿") && !text.includes("\r"));
  assert.ok(!Object.values(map.paths).some(p => p.endsWith("/_bericht.md") && readdirSync(dir).some(k => map.paths[qmdPath(k)] === p)), "Karte für _bericht.md");
  assert.ok(!map.pages["00_inbox/_import/altes-brain/Reisen/Fähre nach Föhr.md"], "Import-Notiz darf keine Wiki-Seite sein");
  // Notiz weg → Karte weg.
  rmSync(join(imp, "Reisen"), { recursive: true });
  assert.equal(lauf().status, 0);
  assert.ok(!existsSync(join(dir, karte)), "verwaiste Import-Karte bleibt liegen");
});
