// Kern der Hinweis-Suche mit Reranker — Store, Reranker und wiki-map injiziert (testbar, im Dienst wiederverwendet).
// Kartentexte werden je Anfrage frisch gelesen (klein; ein Ingest baut sie neu).
import { readFileSync } from "node:fs";
import { join, basename } from "node:path";
import { decide } from "./hint-core.mjs";

const ohneSchema = (f) => String(f).replace(/^qmd:\/\/[^/]+\//, "");

// Karte zu einem QMD-Treffer: wiki-map kennt den handelisierten Namen → Wiki-Seite; die Karte heißt wie deren Basename
function kartenText(file, map, kartenDir) {
  const seite = map.paths?.[ohneSchema(file)];
  if (!seite) return null;
  try { return readFileSync(join(kartenDir, basename(seite)), "utf8"); } catch { return null; }
}

export async function sucheMitRerank({ query, store, reranker, kartenDir, map, limit = 20, top = 3 }) {
  const r = (await store.searchVector(query, { limit, collection: "brainkarten" })).map(x => ({ file: x.filepath, score: x.score, rr: null }));
  const docs = [];
  for (const x of r.slice(0, top)) { const text = kartenText(x.file, map, kartenDir); if (text) docs.push({ file: x.file, text }); }
  if (docs.length) {
    try { for (const s of await reranker(query, docs)) { const t = r.find(x => x.file === s.file); if (t) t.rr = s.score; } }
    catch { /* Reranker gescheitert → rr bleibt null, Aufrufer entscheidet über Vektor-Scores */ }
  }
  return r;
}

export function entscheide(results, map, seen, { rerankSchwelle, max = 2 }) {
  const ok = results.filter(x => typeof x.rr === "number" && x.rr >= rerankSchwelle).sort((a, b) => b.rr - a.rr);
  return decide(ok.map(x => ({ file: x.file, score: x.rr })), map, seen, { schwelle: 0, max });
}
