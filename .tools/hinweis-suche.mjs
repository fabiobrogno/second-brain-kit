// Welche Suche steckt hinter dem Hinweis vor dem Prompt? Standard: BM25 über die Karteikarten (bm25-karten.mjs) —
// kein Modell, kein Index, keine Hänger. Vektoren (qmd-vector.mjs, Embeddings) nur per Einstellung
// `hinweis.suche: "vektor"` in brain.config.json (Messung FBL-91: gleich viele Treffer, 15–20× langsamer).
import { fileURLToPath } from "node:url";

export const hinweisSuche = (cfg) => (cfg && cfg.suche === "vektor" ? "vektor" : "bm25");
export const hinweisModul = (cfg) => process.env.BRAIN_HINT_SEARCH_MODULE
  || fileURLToPath(new URL(hinweisSuche(cfg) === "vektor" ? "./qmd-vector.mjs" : "./bm25-karten.mjs", import.meta.url));
