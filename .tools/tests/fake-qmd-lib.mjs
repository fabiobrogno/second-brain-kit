// Test-Doppel für die QMD-Anbindung des Suchdienstes (per BRAIN_DIENST_LIB): kein Modell, keine DB.
// FAKE_DIENST_JSON: Vektor-Ergebnisse · FAKE_DIENST_HAENGT=1: Rerank kehrt nie zurück · FAKE_DIENST_RR_FEHLER=1: Rerank wirft
import { readFileSync } from "node:fs";
export async function oeffneStore() {
  return { searchVector: async () => process.env.FAKE_DIENST_JSON ? JSON.parse(readFileSync(process.env.FAKE_DIENST_JSON, "utf8"))
    : [{ filepath: "qmd://brainkarten/thema-alpha.md", score: 0.33 }] };
}
export async function rerank(q, docs) {
  if (q === "aufwärmen" && process.env.FAKE_DIENST_WARM_MS) await new Promise(r => setTimeout(r, Number(process.env.FAKE_DIENST_WARM_MS)));
  if (process.env.FAKE_DIENST_HAENGT && q !== "aufwärmen") return new Promise(() => {});
  if (process.env.FAKE_DIENST_RR_FEHLER) throw new Error("rerank kaputt");
  return docs.map(d => ({ file: d.file, score: 0.73 }));
}
