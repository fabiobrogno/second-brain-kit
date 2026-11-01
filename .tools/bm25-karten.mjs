// Suche-Adapter „nur BM25“ (Probe FBL-91): gleiche Schnittstelle wie qmd-vector.mjs (sucheKarten), aber ohne
// QMD, ohne Modell, ohne Index — BM25 (k1=1.2, b=0.75) direkt über die Karteikarten in .logs/hint-karten.
// Einschalten: BRAIN_HINT_SEARCH_MODULE=<dieses Modul> (die Messlatte macht das mit --suche=bm25).
// Der rohe BM25-Wert wird auf 0..1 abgebildet (s / (s + SAETTIGUNG)), damit die Schwelle des Hinweises
// (hinweis.schwelle, Standard 0.45) weiter greift: Wert 0.45 entspricht rohem BM25 von ca. 5.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { vaultPfad } from "./pfade.mjs";
import { qmdPath } from "./qmd-pfad.mjs";

const K1 = 1.2, B = 0.75, SAETTIGUNG = 6;
const WORT_MUSTER = /[\p{L}\p{N}]+/gu;
// Füllwörter zählen nicht (sonst treffen „wie ist …“-Fragen jede Karte); nur Anfrage, die Karten bleiben unverändert.
const FUELL = new Set([
  "aber", "alle", "als", "also", "am", "an", "auch", "auf", "aus", "bei",
  "bin", "bis", "bitte", "da", "damit", "dann", "das", "dass", "dem", "den",
  "der", "des", "die", "dir", "doch", "du", "ein", "eine", "einem", "einen",
  "einer", "eines", "er", "es", "euch", "für", "gibt", "habe", "haben", "hast",
  "hat", "hier", "ich", "ihr", "im", "in", "ist", "ja", "kann", "kein",
  "mal", "man", "mein", "mir", "mit", "muss", "nach", "nicht", "noch", "nur",
  "ob", "oder", "sich", "sie", "sind", "so", "um", "und", "uns", "von",
  "vor", "wann", "war", "warum", "was", "welche", "welcher", "welches", "wenn", "wer",
  "wie", "wir", "wird", "wo", "zu", "zum", "zur", "über",
]);
const tokens = (t) => String(t).normalize("NFC").toLowerCase().match(WORT_MUSTER) || [];

export async function sucheKarten(query, { collection = "brainkarten", limit = 20, vault } = {}) {
  const dir = join(vault || vaultPfad(["node", "s"]), ".logs", "hint-karten");
  const begriffe = [...new Set(tokens(query))].filter(b => !FUELL.has(b));
  if (!begriffe.length) return [];
  const docs = readdirSync(dir).filter(f => f.endsWith(".md")).map(f => ({ f, t: tokens(readFileSync(join(dir, f), "utf8")) }));
  const N = docs.length;
  if (!N) return [];
  const avg = docs.reduce((a, d) => a + d.t.length, 0) / N || 1;
  const gesucht = new Set(begriffe), df = new Map(begriffe.map(b => [b, 0]));
  const tfs = docs.map(d => {
    const tf = new Map();
    for (const t of d.t) if (gesucht.has(t)) tf.set(t, (tf.get(t) || 0) + 1);
    for (const b of tf.keys()) df.set(b, df.get(b) + 1);
    return tf;
  });
  const out = [];
  docs.forEach((d, i) => {
    let s = 0;
    for (const [b, f] of tfs[i]) {
      const nq = df.get(b);
      s += Math.log(1 + (N - nq + 0.5) / (nq + 0.5)) * f * (K1 + 1) / (f + K1 * (1 - B + B * d.t.length / avg));
    }
    if (s > 0) out.push({ file: `qmd://${collection}/${qmdPath(d.f)}`, score: s / (s + SAETTIGUNG) });
  });
  return out.sort((a, b) => b.score - a.score).slice(0, limit);
}
