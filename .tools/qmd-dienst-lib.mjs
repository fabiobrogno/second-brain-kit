// Echte QMD-Anbindung für den Suchdienst: Store (nur lesen) + Reranker, warmgehalten.
// NIE store.internal.rerank (schreibt llm_cache in die DB) — direkt llm.rerank. Kein dispose beim Ende (Teardown hängt).
import { statSync } from "node:fs";
import { join, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { homedir } from "node:os";
import { modulPfad } from "./qmd-vector.mjs";

process.env.QMD_FORCE_CPU ??= "1";            // Metal stürzt beim Prozessende ab (SEARCH.md)
process.env.QMD_EMBED_PARALLELISM ??= "1";    // ein Kontext je Modell statt einer je Kernbündel → weniger RAM
process.env.QMD_RERANK_CONTEXT_SIZE ??= "2048"; // Karten sind ≤ 1,5 KB

const dbPfad = () => process.env.QMD_DB || join(homedir(), ".cache", "qmd", "index.sqlite");
let llm = null;
async function llmWarm() {
  if (llm) return llm;
  const L = await import(pathToFileURL(join(dirname(modulPfad()), "llm.js")).href);
  llm = L.getDefaultLlamaCpp();
  llm.inactivityTimeoutMs = 0;                // sonst entlädt QMD nach 5 min (llm.js:306/417/470)
  return llm;
}

// Store öffnen mit Retry (SQLITE_BUSY während qmd embed) und neu öffnen, wenn index.sqlite ersetzt wurde
let store = null, storeIno = null;
export async function oeffneStore() {
  const ino = (() => { try { return statSync(dbPfad()).ino; } catch { return null; } })();
  if (store && ino === storeIno) return store;
  if (store) { try { await store.close(); } catch {} store = null; }
  await llmWarm();
  const { createStore } = await import(pathToFileURL(modulPfad()).href);
  let fehler;
  for (let i = 0; i < 3; i++) {
    try { store = await createStore({ dbPath: dbPfad() }); storeIno = ino; return store; }
    catch (e) { fehler = e; await new Promise(r => setTimeout(r, 1000)); }
  }
  throw fehler;
}

export async function rerank(query, docs) {
  const l = await llmWarm();
  return (await l.rerank(query, docs)).results;
}
