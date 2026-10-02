#!/usr/bin/env node
// Karten-Tor: Würde eine (neue) Karte bei fachfremden Fragen anschlagen? Lässt alle Negativ- und Kontrollfragen
// aus tests/hint-eval.json laufen — über den Suchdienst (Reranker), sonst über die Vektor-Suche — und meldet
// je Treffer eine Zeile. Nur Bericht, Exit immer 0. Nutzung: node karten-tor.mjs <basename.md> [...]
import { readFileSync } from "node:fs";
import { join, basename } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { suche } from "./hint-kind.mjs";
import { frageDienst } from "./dienst-client.mjs";
import { vaultPfad } from "./pfade.mjs";

// argv-Positionale sind hier Kartennamen, kein Vaultpfad — vaultPfad() daher ohne sie aufrufen
const vault = vaultPfad(process.argv.slice(0, 2));
const karten = new Set(process.argv.slice(2).map(k => basename(k)));
try {
  const cfg = JSON.parse(readFileSync(join(vault, "brain.config.json"), "utf8")).hinweis || {};
  const map = JSON.parse(readFileSync(join(vault, ".logs", "wiki-map.json"), "utf8"));
  const ev = JSON.parse(readFileSync(process.env.BRAIN_EVAL_DATEI || new URL("./tests/hint-eval.json", import.meta.url), "utf8"));
  const fragen = [...(ev.negativ || []), ...(ev.kontrolle_negativ || [])];
  const karteVon = (file) => { const seite = map.paths[String(file).replace(/^qmd:\/\/[^/]+\//, "")]; return seite ? basename(seite) : null; };
  const modul = process.env.BRAIN_HINT_SEARCH_MODULE || fileURLToPath(new URL("./qmd-vector.mjs", import.meta.url));
  let fehlschlaege = 0, dienstAus = false;
  for (const frage of fragen) {
    let results = null, mitRr = false;
    if (cfg.rerankSchwelle != null && !dienstAus) {
      try { results = await frageDienst(vault, { query: frage, limit: 20, top: cfg.rerankTop ?? 3 }, { antwortMs: 5000 }); mitRr = results.some(x => typeof x.rr === "number"); }
      catch (e) { results = null; if (e.code === "ETIMEDOUT") dienstAus = true; }
    }
    if (!results) results = await suche(pathToFileURL(modul).href, frage, { collection: cfg.collection || "brainkarten", limit: 20 }, 8000).catch(() => { fehlschlaege++; return []; });
    for (const r of results) {
      const k = karteVon(r.file);
      if (!k || !karten.has(k)) continue;
      const anschlag = mitRr ? (typeof r.rr === "number" && r.rr >= cfg.rerankSchwelle) : r.score >= (cfg.schwelle ?? 0.45);
      if (anschlag) console.log(`KARTEN-TOR: ${k} schlägt an bei „${frage}" (${mitRr ? "rr " + r.rr.toFixed(2) : "score " + r.score.toFixed(2)})`);
    }
  }
  if (fragen.length && fehlschlaege === fragen.length) console.log("KARTEN-TOR: nicht prüfbar (Suche fehlgeschlagen) — Karte manuell prüfen");
} catch (e) { console.log(`KARTEN-TOR: nicht prüfbar (${e.code || e.message})`); }
process.exit(0);
