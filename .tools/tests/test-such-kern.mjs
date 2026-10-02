import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sucheMitRerank, entscheide } from "../such-kern.mjs";

const dir = mkdtempSync(join(tmpdir(), "karten-"));
writeFileSync(join(dir, "thema_a.md"), "# A\nasin sku"); writeFileSync(join(dir, "thema_x-y.md"), "# XY\npush release");
const map = { paths: { "thema-a.md": "09_wiki/f/thema_a.md", "thema-x-y.md": "09_wiki/f/thema_x-y.md" },
  pages: { "09_wiki/f/thema_a.md": { description: "A" }, "09_wiki/f/thema_x-y.md": { description: "XY" } }, bySource: {} };
const store = { searchVector: async () => [
  { filepath: "qmd://brainkarten/thema-x-y.md", score: 0.42 }, { filepath: "qmd://brainkarten/thema-a.md", score: 0.31 }, { filepath: "qmd://brainkarten/unbekannt.md", score: 0.2 } ] };
const reranker = async (q, docs) => docs.map(d => ({ file: d.file, score: d.text.includes("asin") ? 0.73 : 0.5 }));

test("sucheMitRerank: Top-3 über wiki-map aufgelöst (auch Bindestrich-Namen), unbekannte Karte → rr null", async () => {
  const r = await sucheMitRerank({ query: "join asin", store, reranker, kartenDir: dir, map });
  assert.deepEqual(r.map(x => [x.file.split("/").pop(), x.rr]), [["thema-x-y.md", 0.5], ["thema-a.md", 0.73], ["unbekannt.md", null]]);
});
test("sucheMitRerank: Reranker wirft → alle rr null, Vektor-Scores bleiben", async () => {
  const r = await sucheMitRerank({ query: "x", store, reranker: async () => { throw new Error("kaputt"); }, kartenDir: dir, map });
  assert.ok(r.every(x => x.rr === null) && r[0].score === 0.42);
});
test("entscheide: nur rr ≥ Schwelle, sortiert nach rr, Vektor-Score egal", () => {
  const res = [{ file: "qmd://brainkarten/thema-x-y.md", score: 0.42, rr: 0.5 }, { file: "qmd://brainkarten/thema-a.md", score: 0.31, rr: 0.73 }];
  assert.deepEqual(entscheide(res, map, new Set(), { rerankSchwelle: 0.55, max: 2 }).map(h => h.page), ["09_wiki/f/thema_a.md"]);
  assert.deepEqual(entscheide(res, map, new Set(["09_wiki/f/thema_a.md"]), { rerankSchwelle: 0.55, max: 2 }), []);
});
