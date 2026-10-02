#!/usr/bin/env node
// Test-Fake für search-refresh.mjs: QMD_BIN zeigt hierher statt auf echtes qmd (kein shell:true nötig,
// search-refresh.mjs startet .mjs-QMD_BIN-Werte über process.execPath — plattformneutral, auch Windows).
// FAKE_QMD_CALLS: Datei, an die die Aufruf-Argumente ("$*"-Äquivalent) angehängt werden.
// FAKE_QMD_MARKE_FILE gesetzt: statt der Argumente nur „MARKE" anhängen, und nur wenn diese Datei existiert
// (sonst Exit 1, nichts angehängt) — Äquivalent zu `[ -e "$MARKE" ] && echo MARKE >> "$CALLS"`.
import { appendFileSync, existsSync } from "node:fs";

const calls = process.env.FAKE_QMD_CALLS;
const marke = process.env.FAKE_QMD_MARKE_FILE;

if (marke) {
  if (!existsSync(marke)) process.exit(1);
  if (calls) appendFileSync(calls, "MARKE\n");
  process.exit(0);
}

if (calls) appendFileSync(calls, process.argv.slice(2).join(" ") + "\n");
process.exit(0);
