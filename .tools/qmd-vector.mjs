// Adapter: QMD-Bibliothek direkt — searchVector = reine Kosinus-Ähnlichkeit (keine LLM-Umformulierung,
// kein Reranker; ~0,4 s inkl. Modell-Laden). Die CLI `qmd vsearch` formuliert jede neue Frage per LLM um (2–10 s).
// Modul-Pfad: $QMD_MODULE oder aus dem `qmd`-Binary (~/.brain-kit/bin, sonst PATH) abgeleitet. Index: $QMD_DB oder ~/.cache/qmd/index.sqlite.
import { existsSync, realpathSync } from "node:fs";
import { join, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { homedir } from "node:os";
import { vaultPfad } from "./pfade.mjs";
import { qmdPaketVerzeichnisWin32, qmdPrivatBin } from "./qmd-befehl.mjs";

export function modulPfad() {
  if (process.env.QMD_MODULE) return process.env.QMD_MODULE;
  // win32: kein Symlink-Shim zum Realpathen — über dasselbe @tobilu/qmd-Paket wie qmd-befehl.mjs auflösen.
  if (process.platform === "win32") {
    const paket = qmdPaketVerzeichnisWin32();
    if (paket) return join(paket, "dist", "index.js");
    throw Object.assign(new Error("qmd nicht im PATH"), { code: "QMD_FEHLT" });
  }
  // Zuerst das private qmd der Installation (~/.brain-kit/bin) — es steht in keinem PATH.
  for (const bin of [qmdPrivatBin(), ...(process.env.PATH || "").split(":").map(dir => join(dir, "qmd"))].filter(Boolean)) {
    if (existsSync(bin)) return join(dirname(realpathSync(bin)), "..", "dist", "index.js");
  }
  throw Object.assign(new Error("qmd nicht im PATH"), { code: "QMD_FEHLT" });
}

// Achtung: QMD holt 3×limit nächste Abschnitte über ALLE Sammlungen und filtert erst dann nach Sammlung —
// daher limit großzügig wählen, sonst verdrängen Langseiten-Abschnitte die Karteikarten.
export async function sucheKarten(query, { collection, limit, rerank = false, top = 3, vault }) {
  if (rerank) return sucheKartenKaltRerank(query, { limit, top, vault });
  // CPU statt Metal: llama.cpp-Metal stürzt beim Prozessende ab (GGML_ASSERT in ggml_metal_device_free,
  // Exit 134 → Claude Code verwirft die Hook-Ausgabe). Eine kurze Frage einzubetten dauert auf CPU ~0,3 s.
  process.env.QMD_FORCE_CPU ??= "1";
  const { createStore } = await import(pathToFileURL(modulPfad()).href);
  const store = await createStore({ dbPath: process.env.QMD_DB || join(homedir(), ".cache", "qmd", "index.sqlite") });
  try {
    const r = await store.searchVector(query, { limit, collection });
    return r.map(x => ({ file: x.filepath, score: x.score }));
  } finally { await store.close().catch(() => {}); }
}

// Kaltstart-Rerank (Rückfall, wenn der Suchdienst fehlt/aufwärmt): Reranker einmalig in diesem Kindprozess laden.
// Gleiche Entscheidungsgrundlage wie der Dienst (such-kern), damit auch der erste Prompt einer Pause sauber ist.
async function sucheKartenKaltRerank(query, { limit, top, vault }) {
  const { oeffneStore, rerank } = await import("./qmd-dienst-lib.mjs");
  const { sucheMitRerank } = await import("./such-kern.mjs");
  const { readFileSync } = await import("node:fs");
  const v = vault || vaultPfad(["node", "s"]);
  const map = JSON.parse(readFileSync(join(v, ".logs", "wiki-map.json"), "utf8"));
  const store = await oeffneStore();
  return sucheMitRerank({ query, store, reranker: rerank, kartenDir: join(v, ".logs", "hint-karten"), map, limit, top });
}
