#!/usr/bin/env node
// .tools/messlatte.mjs — Messlatte (Spec v0.4, Baustein E): lokaler Such-Eval wie tests/hint-eval.mjs, 0 Tokens.
// Fragen: .tools/tests/hint-eval.json (im Kit: Platzhalter-Fragen) + eigene <wiki>/_messlatte.json (falls da),
// Holdout: .tools/tests/holdout.json (falls da). Jede Frage läuft durch den echten Brain-Hinweis-Hook
// (adapters/claude-code/brain-hint.mjs, Sitzungs-ID „eval-…“ → dessen Log landet in hint-eval-runs.log, nicht im
// Alltags-hint.log). Ergebnis als eine Zeile im gewohnten Format an .logs/hint-eval.log anhängen (Analyse zeigt
// den Verlauf, der Pflegebericht den Trend). Keine LLM-Bewertung (bewusst, Tokens).
// Format _messlatte.json: { "positiv": [{ "prompt": "…", "erwartet": ["seite.md"] }], "negativ": ["…"],
//   "kontrolle_negativ": ["…"], "ziel": { … optional, wie hint-eval.json } }
// CLI: node messlatte.mjs [vault] [--json]   (brain messlatte [--json])
import { readFileSync, appendFileSync, mkdirSync, realpathSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { vaultPfad, ordner, entferneBom } from "./pfade.mjs";
import { positivOk } from "./eval-regel.mjs";

const HIER = dirname(fileURLToPath(import.meta.url));
const MAX_FRAGEN = 500, MAX_PROMPT = 2000, HOOK_TIMEOUT_MS = 30000;
const fehlerMit = (code, meldung) => Object.assign(new Error(meldung), { code });

function leseJson(datei) {
  try { return JSON.parse(entferneBom(readFileSync(datei, "utf8"))); } catch { return null; }
}
const istPrompt = (p) => typeof p === "string" && p.trim() && p.length <= MAX_PROMPT;
const positivListe = (x) => (Array.isArray(x) ? x : []).filter(c => c && istPrompt(c.prompt) && Array.isArray(c.erwartet)
  && c.erwartet.length && c.erwartet.every(e => typeof e === "string" && e)).map(c => ({ prompt: c.prompt, erwartet: c.erwartet }));
const negativListe = (x) => (Array.isArray(x) ? x : []).filter(istPrompt);

// Fragen zusammenführen → { positiv, negativ, kontrolle, holdout: {positiv, negativ}|null, ziel }
export function ladeFragen(vault, { fragenDatei = join(HIER, "tests", "hint-eval.json"), holdoutDatei = join(HIER, "tests", "holdout.json") } = {}) {
  const kit = leseJson(fragenDatei) || {};
  const eigene = leseJson(join(vault, ordner(vault).wiki, "_messlatte.json")) || {};
  const hold = leseJson(holdoutDatei);
  const f = {
    positiv: [...positivListe(kit.positiv), ...positivListe(eigene.positiv)].slice(0, MAX_FRAGEN),
    negativ: [...negativListe(kit.negativ), ...negativListe(eigene.negativ)].slice(0, MAX_FRAGEN),
    kontrolle: [...negativListe(kit.kontrolle_negativ), ...negativListe(eigene.kontrolle_negativ)].slice(0, MAX_FRAGEN),
    holdout: hold ? { positiv: positivListe(hold.positiv).slice(0, MAX_FRAGEN), negativ: negativListe(hold.negativ).slice(0, MAX_FRAGEN) } : null,
    ziel: { ...(kit.ziel && typeof kit.ziel === "object" ? kit.ziel : {}), ...(eigene.ziel && typeof eigene.ziel === "object" ? eigene.ziel : {}) },
  };
  return f;
}

// Führt den Eval aus und hängt die Ergebniszeile an .logs/hint-eval.log an.
// → { positiv, still, kontrolle, holdout, datum, p95ms, ok, zeile }  (Zähler als "treffer/gesamt")
export function messlatte(vault, { hook = join(HIER, "adapters", "claude-code", "brain-hint.mjs"), fragenDatei, holdoutDatei, jetzt = new Date() } = {}) {
  const fx = ladeFragen(vault, { fragenDatei, holdoutDatei });
  if (!fx.positiv.length && !fx.negativ.length) {
    throw fehlerMit(400, `Keine Messfragen gefunden — lege ${ordner(vault).wiki}/_messlatte.json an (Fragen mit erwarteter Seite).`);
  }
  const ms = [];
  let lauf = 0;
  const frage = (prompt) => {
    const t = Date.now();
    let out = "";
    try {
      out = execFileSync(process.execPath, [hook], {
        input: JSON.stringify({ prompt, session_id: `eval-${process.pid}-${lauf++}` }), encoding: "utf8",
        env: { ...process.env, BRAIN_VAULT: vault }, stdio: ["pipe", "pipe", "ignore"], timeout: HOOK_TIMEOUT_MS, windowsHide: true,
      });
    } catch { out = ""; }
    ms.push(Date.now() - t);
    return out;
  };
  const trifft = (c) => { const out = frage(c.prompt); return c.erwartet.some(p => out.includes("/" + p)); };
  const schweigt = (p) => !frage(p).trim();

  const pos = fx.positiv.filter(trifft).length;
  const still = fx.negativ.filter(schweigt).length;
  const kontrolle = fx.kontrolle.filter(schweigt).length;
  let holdTreffer = 0, holdN = 0;
  if (fx.holdout) {
    holdN = fx.holdout.positiv.length + fx.holdout.negativ.length;
    holdTreffer = fx.holdout.positiv.filter(trifft).length + fx.holdout.negativ.filter(schweigt).length;
  }
  const sortiert = [...ms].sort((a, b) => a - b);
  const p95 = sortiert[Math.floor(sortiert.length * 0.95)] || sortiert[sortiert.length - 1] || 0;

  const logDatei = join(vault, ".logs", "hint-eval.log");
  let logText = "";
  try { logText = readFileSync(logDatei, "utf8"); } catch {}
  const z = fx.ziel;
  const zahl = (x, s) => (Number.isFinite(Number(x)) ? Number(x) : s);
  const posOk = positivOk({ pos, n: fx.positiv.length, zielPositiv: zahl(z.positiv, 0), logText, basisFehler: z.basis?.positivFehler });
  const ok = posOk && still >= zahl(z.still, 0) && kontrolle >= zahl(z.kontrolle_still, 0) && p95 <= zahl(z.p95ms, Infinity);

  const datum = jetzt.toISOString().slice(0, 10);
  const erg = {
    positiv: `${pos}/${fx.positiv.length}`, still: `${still}/${fx.negativ.length}`, kontrolle: `${kontrolle}/${fx.kontrolle.length}`,
    holdout: `${holdTreffer}/${holdN}`, datum, p95ms: p95, ok,
  };
  erg.zeile = `hint-eval ${datum} positiv=${erg.positiv} still=${erg.still} kontrolle=${erg.kontrolle} holdout=${erg.holdout} p95ms=${p95} ok=${ok ? 1 : 0}`;
  try {
    mkdirSync(dirname(logDatei), { recursive: true });
    appendFileSync(logDatei, (logText && !logText.endsWith("\n") ? "\n" : "") + erg.zeile + "\n");
  } catch { /* Messung trotzdem zurückgeben */ }
  return erg;
}

const selbst = fileURLToPath(import.meta.url);
let aufruf = "";
try { aufruf = realpathSync(process.argv[1] || ""); } catch {}
if (aufruf && aufruf === realpathSync(selbst)) {
  const vault = vaultPfad();
  try {
    const e = messlatte(vault);
    if (process.argv.includes("--json")) console.log(JSON.stringify(e));
    else {
      console.log(`Messlatte ${e.datum}: Treffer ${e.positiv}, still ${e.still}, Kontrolle ${e.kontrolle}, Holdout ${e.holdout}, p95 ${e.p95ms} ms — ${e.ok ? "im Ziel" : "unter Ziel"}.`);
      console.log("Gespeichert in .logs/hint-eval.log (Verlauf im Gehirn unter Analyse).");
    }
  } catch (e) {
    console.error(String(e?.message || e).split("\n")[0]);
    process.exit(e?.code === 400 ? 0 : 1);
  }
}
