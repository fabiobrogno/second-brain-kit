// Test-Doppel für qmd-vector.mjs (per BRAIN_HINT_SEARCH_MODULE eingehängt).
// FAKE_JSON: Ergebnisliste · FAKE_ARGS: Aufruf protokollieren · FAKE_DELAY: ms warten · FAKE_THROW: Fehlercode werfen
import { readFileSync, writeFileSync } from "node:fs";
export async function sucheKarten(query, opts) {
  if (process.env.FAKE_ARGS) writeFileSync(process.env.FAKE_ARGS, JSON.stringify({ query, ...opts }));
  if (process.env.FAKE_DELAY) await new Promise(r => setTimeout(r, Number(process.env.FAKE_DELAY)));
  if (process.env.FAKE_THROW) throw Object.assign(new Error("fake"), { code: process.env.FAKE_THROW });
  // FAKE_HANG_AFTER: Kind liefert Antwort, hängt danach beim Beenden (wie llama.cpp-Teardown)
  if (process.env.FAKE_HANG_AFTER) process.on("exit", () => { const e = Date.now() + 8000; while (Date.now() < e); });
  const r = JSON.parse(readFileSync(process.env.FAKE_JSON, "utf8"));
  // opts.rerank: Kaltstart-Rerank im Kindprozess simulieren (FAKE_RR = Reranker-Wert der Top-Karten)
  return opts.rerank ? r.map((x, i) => ({ ...x, rr: i < (opts.top ?? 3) && process.env.FAKE_RR ? Number(process.env.FAKE_RR) : null })) : r;
}
