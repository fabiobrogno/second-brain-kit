#!/usr/bin/env node
// .tools/messlatte.mjs — Messlatte (Spec v0.4, Baustein E): lokaler Such-Eval wie tests/hint-eval.mjs, 0 Tokens.
// Fragen: .tools/tests/hint-eval.json (im Kit: Platzhalter-Fragen) + eigene <wiki>/_messlatte.json (falls da),
// Holdout: .tools/tests/holdout.json (falls da). Jede Frage läuft durch den echten Brain-Hinweis-Hook
// (adapters/claude-code/brain-hint.mjs, Sitzungs-ID „eval-…“ → dessen Log landet in hint-eval-runs.log, nicht im
// Alltags-hint.log). Ergebnis als eine Zeile im gewohnten Format an .logs/hint-eval.log anhängen (Analyse zeigt
// den Verlauf, der Pflegebericht den Trend). Keine LLM-Bewertung (bewusst, Tokens).
// Format _messlatte.json: { "positiv": [{ "prompt": "…", "erwartet": ["seite.md"] }], "negativ": ["…"],
//   "kontrolle_negativ": ["…"], "ziel": { … optional, wie hint-eval.json } }
// CLI: node messlatte.mjs [vault] [--json] [--suche=bm25|vektor]   (brain messlatte [--json])
// --suche=bm25: Hinweis-Hook sucht nur per BM25 über die Karteikarten (bm25-karten.mjs, ohne QMD/Modell) — zum Vergleich
// mit der Vektorsuche (Standard, --suche=vektor). Neben Treffern/p95 werden Hook-Fehler (Absturz/Timeout) und mittlere Antwortzeit gemeldet; Fragen mit Feld "art" zusätzlich je Art.
import { readFileSync, appendFileSync, mkdirSync, realpathSync, statSync } from "node:fs";
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
  && c.erwartet.length && c.erwartet.every(e => typeof e === "string" && e)).map(c => ({ prompt: c.prompt, erwartet: c.erwartet, ...(typeof c.art === "string" && c.art ? { art: c.art.slice(0, 20) } : {}) }));
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
export function messlatte(vault, { hook = join(HIER, "adapters", "claude-code", "brain-hint.mjs"), fragenDatei, holdoutDatei, jetzt = new Date(), suche = "vektor" } = {}) {
  if (suche !== "vektor" && suche !== "bm25") throw fehlerMit(400, `Unbekannte Suche „${suche}“ — erlaubt: vektor, bm25.`);
  const fx = ladeFragen(vault, { fragenDatei, holdoutDatei });
  if (!fx.positiv.length && !fx.negativ.length) {
    throw fehlerMit(400, `Keine Messfragen gefunden — lege ${ordner(vault).wiki}/_messlatte.json an (Fragen mit erwarteter Seite).`);
  }
  const runLog = join(vault, ".logs", "hint-eval-runs.log");
  const runLogGroesse = () => { try { return statSync(runLog).size; } catch { return 0; } };
  const logVorher = runLogGroesse();
  const ms = [];
  let lauf = 0, fehler = 0;
  const suchEnv = suche === "bm25" ? { BRAIN_HINT_SEARCH_MODULE: join(HIER, "bm25-karten.mjs") } : {};
  const frage = (prompt) => {
    const t = Date.now();
    let out = "";
    try {
      out = execFileSync(process.execPath, [hook], {
        input: JSON.stringify({ prompt, session_id: `eval-${process.pid}-${lauf++}` }), encoding: "utf8",
        env: { ...process.env, ...suchEnv, BRAIN_VAULT: vault }, stdio: ["pipe", "pipe", "ignore"], timeout: HOOK_TIMEOUT_MS, windowsHide: true,
      });
    } catch { out = ""; fehler++; }
    ms.push(Date.now() - t);
    return out;
  };
  const trifft = (c) => { const out = frage(c.prompt); return c.erwartet.some(p => out.includes("/" + p)); };
  const schweigt = (p) => !frage(p).trim();

  // optionales Feld „art“ je Frage (z. B. wort/sinn) → Trefferquote je Art, nur zur Auswertung
  const arten = {};
  const pos = fx.positiv.filter(c => { const ok = trifft(c); if (c.art) { const a = arten[c.art] ??= [0, 0]; a[1]++; if (ok) a[0]++; } return ok; }).length;
  const still = fx.negativ.filter(schweigt).length;
  const kontrolle = fx.kontrolle.filter(schweigt).length;
  let holdTreffer = 0, holdN = 0;
  if (fx.holdout) {
    holdN = fx.holdout.positiv.length + fx.holdout.negativ.length;
    holdTreffer = fx.holdout.positiv.filter(trifft).length + fx.holdout.negativ.filter(schweigt).length;
  }
  // Der Hook meldet Timeouts/interne Fehler still (Exit 0, Zeile „fehler=…“ im Eval-Log) → zu den Abstürzen zählen.
  // (Byte-Offset, nicht Zeichen: Umlaute im Log verschieben sonst die Schnittstelle. Bei Rotation wird nur der Rest gelesen; die Zahl ist dann eine Untergrenze.)
  try { fehler += readFileSync(runLog).subarray(logVorher > runLogGroesse() ? 0 : logVorher).toString("utf8").split("\n").filter(z => / fehler=\S/.test(z)).length; } catch {}
  const sortiert = [...ms].sort((a, b) => a - b);
  const mittelMs = ms.length ? Math.round(ms.reduce((a, b) => a + b, 0) / ms.length) : 0;
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
    holdout: `${holdTreffer}/${holdN}`, datum, p95ms: p95, mittelMs, fehler, suche, ok,
    arten: Object.fromEntries(Object.entries(arten).map(([k, [t, n]]) => [k, `${t}/${n}`])),
  };
  erg.zeile = `hint-eval ${datum} positiv=${erg.positiv} still=${erg.still} kontrolle=${erg.kontrolle} holdout=${erg.holdout} p95ms=${p95} ok=${ok ? 1 : 0}${suche === "vektor" ? "" : ` suche=${suche}`}`;
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
    const sa = process.argv.find(a => a.startsWith("--suche="));
    const e = messlatte(vault, sa ? { suche: sa.slice(8) } : {});
    if (process.argv.includes("--json")) console.log(JSON.stringify(e));
    else {
      console.log(`Messlatte ${e.datum}: Treffer ${e.positiv}, still ${e.still}, Kontrolle ${e.kontrolle}, Holdout ${e.holdout}, p95 ${e.p95ms} ms, Ø ${e.mittelMs} ms, Fehler ${e.fehler}, Suche ${e.suche} — ${e.ok ? "im Ziel" : "unter Ziel"}.`);
      if (Object.keys(e.arten).length) console.log("Je Art: " + Object.entries(e.arten).map(([k, v]) => `${k} ${v}`).join(", "));
      console.log("Gespeichert in .logs/hint-eval.log (Verlauf im Gehirn unter Analyse).");
    }
  } catch (e) {
    console.error(String(e?.message || e).split("\n")[0]);
    process.exit(e?.code === 400 ? 0 : 1);
  }
}
