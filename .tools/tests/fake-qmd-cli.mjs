#!/usr/bin/env node
// Test-Fake für search-refresh.mjs: QMD_BIN zeigt hierher statt auf echtes qmd (kein shell:true nötig,
// search-refresh.mjs startet .mjs-QMD_BIN-Werte über process.execPath — plattformneutral, auch Windows).
// FAKE_QMD_CALLS: Datei, an die die Aufruf-Argumente ("$*"-Äquivalent) angehängt werden.
// FAKE_QMD_MARKE_FILE gesetzt: statt der Argumente nur „MARKE" anhängen, und nur wenn diese Datei existiert
// (sonst Exit 1, nichts angehängt) — Äquivalent zu `[ -e "$MARKE" ] && echo MARKE >> "$CALLS"`.
// FAKE_QMD_SAMMLUNGEN: Datei mit einem Sammlungsnamen je Zeile — `collection list` gibt genau diese aus,
// `collection add … --name X` hängt X an (FAKE_QMD_ADD_FEHLER gesetzt: add scheitert mit Exit 1). Ohne die Variable kennt der Fake „brain“ und „brainkarten“.
import { appendFileSync, existsSync, readFileSync } from "node:fs";

const calls = process.env.FAKE_QMD_CALLS;
const marke = process.env.FAKE_QMD_MARKE_FILE;

if (marke) {
  if (!existsSync(marke)) process.exit(1);
  if (calls) appendFileSync(calls, "MARKE\n");
  process.exit(0);
}

const args = process.argv.slice(2);
if (calls) appendFileSync(calls, args.join(" ") + "\n");
const sammlungen = process.env.FAKE_QMD_SAMMLUNGEN;
if (args[0] === "collection" && args[1] === "list") {
  const namen = sammlungen ? (existsSync(sammlungen) ? readFileSync(sammlungen, "utf8").split("\n").filter(Boolean) : []) : ["brain", "brainkarten"];
  for (const n of namen) console.log(`${n} (qmd://${n}/)\n  Pattern:  **/*.md\n`);
}
if (args[0] === "collection" && args[1] === "add" && process.env.FAKE_QMD_ADD_FEHLER) process.exit(1);
if (args[0] === "collection" && args[1] === "add" && sammlungen) appendFileSync(sammlungen, args[args.indexOf("--name") + 1] + "\n");
process.exit(0);
