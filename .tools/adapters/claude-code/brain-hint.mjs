#!/usr/bin/env node
// UserPromptSubmit-Hook: lokaler Brain-Hinweis über QMD-Vektorsuche auf den Karteikarten (0 API-Tokens).
// Schweigt ohne klaren Treffer. Nie blockierend: jeder Fehler → Exit 0 ohne Ausgabe, Befund ins Log.
// Loggt NIE Prompt-Text (Secrets-Regel) — nur Länge, Score, Seiten, Dauer.
import { readFileSync, appendFileSync, writeFileSync, renameSync, mkdirSync, existsSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { suche } from "../../hint-kind.mjs";
import { frageDienst, istGesperrt, meldeHaenger, starteDienst } from "../../dienst-client.mjs";
import { entscheide } from "../../such-kern.mjs";
import { shouldQuery, decide, format, countSuppressed, suchtext, istFolgefrage } from "../../hint-core.mjs";
import { vorigeFrage } from "../../transkript.mjs";
import { vaultPfad } from "../../pfade.mjs";

const vault = vaultPfad();
const logs = join(vault, ".logs");
const t0 = Date.now();
let sid = "ohne";
let kalt = "-"; // unbekannt, bis die Session-Datei geprüft ist (frühe Fehler sind kein Kaltstart-Beleg)
// Marke zählt nur, wenn frisch (< 15 min): trap EXIT greift nicht bei SIGKILL/Absturz → Leiche verfälschte sonst jede Zeile
const refreshLaeuft = () => { try { return Date.now() - statSync(join(logs, "search-refresh.running")).mtimeMs < 15 * 60000 ? 1 : 0; } catch { return 0; } };
const log = (s) => {
  try {
    mkdirSync(logs, { recursive: true });
    const datei = join(logs, sid.startsWith("eval-") ? "hint-eval-runs.log" : "hint.log");
    appendFileSync(datei, `${new Date().toISOString().slice(0, 19)} sid=${sid.slice(0, 8)} ${s} kalt=${kalt} refresh=${refreshLaeuft()} ms=${Date.now() - t0}\n`);
    // Rotation (billig: nur ab ~150 KB lesen): > 2000 Zeilen → letzte 1000
    if (statSync(datei).size > 150000) {
      const z = readFileSync(datei, "utf8").split("\n").filter(Boolean);
      if (z.length > 2000) { const t = `${datei}.${process.pid}.tmp`; writeFileSync(t, z.slice(-1000).join("\n") + "\n"); renameSync(t, datei); }
    }
  } catch {}
};
try {
  const input = JSON.parse(readFileSync(0, "utf8") || "{}");
  const prompt = String(input.prompt || "");
  sid = String(input.session_id || "ohne").replace(/[^\w-]/g, "").slice(0, 64) || "ohne";
  // Folgefrage („und beim zweiten?"): vorige echte User-Nachricht aus dem Transkript mitnehmen (nie geloggt/gespeichert)
  const vorige = istFolgefrage(prompt) && input.transcript_path ? vorigeFrage(String(input.transcript_path), prompt) : null;
  if (shouldQuery(prompt) || vorige) {
    const cfg = JSON.parse(readFileSync(join(vault, "brain.config.json"), "utf8")).hinweis || {};
    const map = JSON.parse(readFileSync(join(logs, "wiki-map.json"), "utf8"));
    const seenDir = join(logs, "hint-seen");
    mkdirSync(seenDir, { recursive: true });
    const seenFile = join(seenDir, sid + ".txt");
    const seen = new Set(existsSync(seenFile) ? readFileSync(seenFile, "utf8").split("\n").filter(Boolean) : []);
    kalt = existsSync(seenFile) ? 0 : 1;
    if (!existsSync(seenFile)) writeFileSync(seenFile, "");
    const frage = suchtext(vorige ? `${vorige} ${prompt}` : prompt), max = cfg.max ?? 2, schwelle = cfg.schwelle ?? 0.45, gesamt = cfg.timeoutMs || 4000;
    let results = null, hits = null, weg = "vektor", basis = null, dienstFehler = "";
    // 1) Suchdienst (Reranker, warm) — nur mit Schalter rerankSchwelle und ohne frische Hänger-Sperre
    if (cfg.rerankSchwelle != null && !istGesperrt(vault)) {
      try {
        results = await frageDienst(vault, { query: frage, limit: 20, top: cfg.rerankTop ?? 3 }, { antwortMs: Math.max(300, Math.min(cfg.dienstMs ?? 2500, gesamt - 1500)) });
        if (results.some(x => typeof x.rr === "number")) {
          weg = "dienst"; basis = results.filter(x => typeof x.rr === "number").map(x => ({ file: x.file, score: x.rr }));
          hits = entscheide(results, map, seen, { rerankSchwelle: cfg.rerankSchwelle, max });
        } else { weg = "dienst-vektor"; basis = results; hits = decide(results, map, seen, { schwelle, max }); }
      } catch (e) {
        results = null; dienstFehler = ` dienst=${e.code || "fehler"}`;
        if (e.code === "ETIMEDOUT") meldeHaenger(vault); else if (e.code !== "ESOCKPFAD" && e.code !== "EWARM") starteDienst(vault);
      }
    }
    // 2) Rückfall: bisheriger Kindprozess-Weg (nur Vektor) mit der verbleibenden Zeit
    if (!hits) {
      const modul = process.env.BRAIN_HINT_SEARCH_MODULE || fileURLToPath(new URL("../../qmd-vector.mjs", import.meta.url));
      const rest = gesamt - (Date.now() - t0);
      // Schalter an und genug Zeit → einmalig selbst reranken (erster Prompt nach Pause ist so genauso sauber)
      const kaltRerank = cfg.rerankSchwelle != null && rest >= 3000;
      results = await suche(pathToFileURL(modul).href, frage, { collection: cfg.collection || "brainkarten", limit: 20, ...(kaltRerank ? { rerank: true, top: cfg.rerankTop ?? 3, vault } : {}) }, Math.max(500, rest));
      if (kaltRerank && results.some(x => typeof x.rr === "number")) {
        weg = "kalt-rerank"; basis = results.filter(x => typeof x.rr === "number").map(x => ({ file: x.file, score: x.rr }));
        hits = entscheide(results, map, seen, { rerankSchwelle: cfg.rerankSchwelle, max });
      } else { basis = results; hits = decide(results, map, seen, { schwelle, max }); }
    }
    const top = (weg === "dienst" || weg === "kalt-rerank") ? Math.max(0, ...basis.map(x => x.score)) : (results[0]?.score ?? 0);
    const unterdrueckt = countSuppressed(basis, map, seen, { schwelle: (weg === "dienst" || weg === "kalt-rerank") ? cfg.rerankSchwelle : schwelle });
    log(`len=${prompt.length} weg=${weg}${dienstFehler} top=${top.toFixed?.(3) ?? 0} hits=${hits.map(h => h.page).join(",") || "-"} unterdrueckt=${unterdrueckt}`);
    if (hits.length) {
      appendFileSync(seenFile, hits.map(h => h.page).join("\n") + "\n");
      process.stdout.write(format(hits, { vault }) + "\n");
    }
    for (const f of readdirSync(seenDir)) { const p = join(seenDir, f); if (Date.now() - statSync(p).mtimeMs > 2 * 86400000) unlinkSync(p); }
  }
} catch (e) { log(`fehler=${e.code || e.name || "unbekannt"}`); }
process.exit(0);
