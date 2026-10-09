#!/usr/bin/env node
// .tools/antwort-messlatte.mjs — Antwort-Messlatte (Treffsicherheit, opt-in): Taugen die Seiten als Antwortquelle?
// Testfragen: <wiki>/_antworten.json — [{ "frage": "…", "seite": "<basename>.md", "kernfakten": ["…", "…"] }].
// Je Frage: Seite lesen → Haiku antwortet NUR aus der Seite (schlanker Aufruf wie die Ernte: rufeHaiku/leseClaudeAntwort
// aus ernte.mjs) → lokaler Abgleich, ob die Kernfakten in der Antwort stehen (0 Tokens). Ergebnis nach
// .logs/antwort-messlatte.log (je Frage eine Zeile art=fall, am Ende art=lauf), Anzeige im Analyse-Reiter.
// Schalter automatik.antwortMesslatte: "aus" (Standard) | "monatlich" — session-start ruft starteWennFaellig()
// (losgelöst, einmal je 30 Tage, Marke .logs/antwort-messlatte-start). Ändert nie das Wiki.
// CLI: node antwort-messlatte.mjs [--anlass knopf|monatlich] [vault]
// Testhaken: BRAIN_ANTWORT_SKRIPT ersetzt den Pfad zu diesem Skript beim losgelösten Start; BRAIN_CLAUDE (fake-claude).
import { readFileSync, statSync, mkdirSync, writeFileSync, unlinkSync, utimesSync, realpathSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { findeSecrets, ohneSecrets } from "./secrets-muster.mjs";
import { haengeAn, zeitstempel, leseZeilen } from "./logs.mjs";
import { leseAutomatik } from "./einstellungen.mjs";
import { EIGENER_VAULT, ordner, entferneBom } from "./pfade.mjs";
import { findeClaude, rufeHaiku, leseClaudeAntwort, nimmLock } from "./ernte.mjs";
import { walk } from "./vault-dateien.mjs";
import { istWikiSeite } from "./wiki-pfade.mjs";

export const MAX_FAELLE = 20;
export const MAX_SEITE = 12000;
const MAX_FRAGE = 500, MAX_FAKT = 200, MAX_FAKTEN = 10;
export const MONAT_MS = 30 * 86400000;
const GESTARTET_MS = 60 * 1000;
const fwd = (p) => String(p).split("\\").join("/");
const ohneGit = (env) => Object.fromEntries(Object.entries(env).filter(([k]) => !k.startsWith("GIT_")));

export const ANTWORT_AUFTRAG = [
  "Du beantwortest eine Frage ausschließlich anhand der Wiki-Seite unten — kein Vorwissen, keine Vermutungen.",
  "Antworte kurz (höchstens 5 Sätze) und nenne Namen, Zahlen und Begriffe wörtlich so, wie sie auf der Seite stehen.",
  "Steht die Antwort nicht auf der Seite, antworte nur: NICHT AUF DER SEITE",
  "Schreibe NIE Zugangsdaten, Passwörter, Tokens oder Schlüssel.",
].join("\n");
export const SEITE_KOPF = "--- SEITE ---\n\n";
export const FRAGE_KOPF = "\n\n--- FRAGE ---\n\n";

const LOG = (vault) => join(vault, ".logs", "antwort-messlatte.log");
const DIR = (vault) => join(vault, ".logs", "antwort-messlatte");
const LOCK = (vault) => join(DIR(vault), "lauf.lock");
const GESTARTET = (vault) => join(DIR(vault), "gestartet");
export const START_MARKE = (vault) => join(vault, ".logs", "antwort-messlatte-start");
export const testDatei = (vault) => join(vault, ordner(vault).wiki, "_antworten.json");

// ---------- Testfragen ----------

// → [{ frage, seite, kernfakten }] (gültige Einträge, höchstens MAX_FAELLE). Fehlt/kaputt → [].
// Einträge mit Zugangsdaten werden übersprungen (sie gingen sonst an die KI und ins Log).
export function ladeAntworten(vault) {
  let roh;
  try { roh = JSON.parse(entferneBom(readFileSync(testDatei(vault), "utf8"))); } catch { return []; }
  const out = [];
  for (const e of Array.isArray(roh) ? roh : []) {
    if (!e || typeof e.frage !== "string" || typeof e.seite !== "string" || !Array.isArray(e.kernfakten)) continue;
    const frage = e.frage.replace(/\s+/g, " ").trim(), seite = e.seite.trim();
    const kernfakten = e.kernfakten.filter(k => typeof k === "string" && k.trim() && k.length <= MAX_FAKT).map(k => k.trim()).slice(0, MAX_FAKTEN);
    if (!frage || frage.length > MAX_FRAGE || !seite || !kernfakten.length) continue;
    if (findeSecrets([frage, ...kernfakten].join("\n")).length) continue;
    out.push({ frage, seite, kernfakten });
    if (out.length >= MAX_FAELLE) break;
  }
  return out;
}

// „thema_x.md", „thema_x", „wissen/thema_x.md" oder „09_wiki/wissen/thema_x.md" → vault-relativer Pfad einer echten
// Wiki-Seite, sonst null (nie etwas außerhalb des Wikis).
export function findeSeite(vault, seite, seiten = null) {
  const wiki = ordner(vault).wiki;
  const alle = seiten || walk(vault, { wikiDir: wiki }).map(f => fwd(f.rel)).filter(p => istWikiSeite(p, wiki));
  const s = fwd(seite).replace(/^\/+/, "");
  const mitMd = s.endsWith(".md") ? s : `${s}.md`;
  for (const k of [mitMd, `${wiki}/${mitMd}`]) if (alle.includes(k)) return k;
  const treffer = alle.filter(p => p.endsWith(`/${mitMd}`));
  return treffer.length === 1 ? treffer[0] : null;
}

// ---------- lokaler Abgleich (0 Tokens) ----------

const FUELL = new Set(["der", "die", "das", "und", "oder", "ein", "eine", "the", "a", "an", "and", "or", "of", "in", "im", "am", "zu"]);
export function normiere(text) {
  return ` ${String(text ?? "").normalize("NFKC").toLowerCase()
    .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim()} `;
}
// Kernfakt gefunden: als zusammenhängende Wortfolge in der Antwort — sonst, wenn alle tragenden Wörter vorkommen.
export function faktGefunden(antwort, fakt) {
  const a = normiere(antwort), f = normiere(fakt);
  if (f.trim() && a.includes(f)) return true;
  const woerter = f.trim().split(" ").filter(w => w && !FUELL.has(w));
  return woerter.length > 0 && woerter.every(w => a.includes(` ${w} `));
}
export function pruefeAntwort(antwort, kernfakten) {
  const fehlend = kernfakten.filter(k => !faktGefunden(antwort, k));
  return { gefunden: kernfakten.length - fehlend.length, gesamt: kernfakten.length, fehlend };
}

// ---------- Lauf ----------

function seitenText(vault, rel) {
  const roh = entferneBom(readFileSync(join(vault, ...rel.split("/")), "utf8")).replace(/\r\n/g, "\n")
    .replace(/^---\n[\s\S]*?\n---\n?/, "");
  return ohneSecrets(roh).trim().slice(0, MAX_SEITE);
}
const frisch = (p, ms, jetzt = Date.now()) => { try { return jetzt - statSync(p).mtimeMs <= ms; } catch { return false; } };
const beruehre = (p) => { try { const d = new Date(); utimesSync(p, d, d); } catch {} };

export async function antwortLauf(vault, { claudeBefehl, jetzt = Date.now(), anlass = "knopf" } = {}) {
  const ergebnis = (status, grund, extra = {}) => ({ status, ...(grund ? { grund } : {}), ...extra });
  if (process.env.BRAIN_ERNTE === "1") return ergebnis("uebersprungen", "Selbstaufruf");
  const lauf = createHash("sha256").update(`${jetzt}-${process.pid}`).digest("hex").slice(0, 10);
  const zeit = zeitstempel(new Date(jetzt));
  const schreibe = (felder) => haengeAn(LOG(vault), `${zeit} lauf=${lauf} ${felder}`, { max: 2000, behalte: 1000 });
  const a = anlass === "monatlich" ? "monatlich" : "knopf";
  try {
    const { fehler } = leseAutomatik(vault);
    if (fehler) return ergebnis("uebersprungen", "Config nicht lesbar");
    const faelle = ladeAntworten(vault);
    if (!faelle.length) return ergebnis("uebersprungen", "keine Testfragen");
    if (!nimmLock(LOCK(vault), jetzt)) return ergebnis("uebersprungen", "läuft schon");
    try { unlinkSync(GESTARTET(vault)); } catch {}
    try {
      const befehl = claudeBefehl === undefined ? findeClaude() : claudeBefehl;
      if (!befehl) {
        schreibe(`art=lauf status=fehler anlass=${a} fragen=${faelle.length} grund=claude-fehlt`);
        return ergebnis("fehler", "claude nicht gefunden");
      }
      const seiten = walk(vault, { wikiDir: ordner(vault).wiki }).map(f => fwd(f.rel)).filter(p => istWikiSeite(p, ordner(vault).wiki));
      let tokEin = 0, tokAus = 0, mitTokens = false, voll = 0, gefunden = 0, gesamt = 0, fehlerZahl = 0;
      for (let i = 0; i < faelle.length; i++) {
        beruehre(LOCK(vault)); // lange Läufe: Lock frisch halten (nimmLock gilt nach 5 min als verwaist)
        const fall = faelle[i];
        const felder = `art=fall nr=${i + 1} frage=${encodeURIComponent(fall.frage.slice(0, 160))}`;
        const rel = findeSeite(vault, fall.seite, seiten);
        if (!rel) {
          gesamt += fall.kernfakten.length; fehlerZahl++;
          schreibe(`${felder} seite=${encodeURIComponent(fall.seite)} status=fehler grund=seite-fehlt fakten=0/${fall.kernfakten.length} fehlend=${encodeURIComponent(fall.kernfakten.join("\t"))}`);
          continue;
        }
        let text = "";
        try { text = seitenText(vault, rel); } catch {}
        const r = await rufeHaiku(befehl, ANTWORT_AUFTRAG, SEITE_KOPF + (text || "(leer)") + FRAGE_KOPF + fall.frage + "\n", vault, { zweck: "antwort" });
        const antwort = r.fehler ? null : leseClaudeAntwort(r.ausgabe);
        if (antwort?.tokens) { tokEin += antwort.tokens.ein; tokAus += antwort.tokens.aus; mitTokens = true; }
        const f = r.fehler || antwort.fehler;
        if (f) {
          gesamt += fall.kernfakten.length; fehlerZahl++;
          schreibe(`${felder} seite=${encodeURIComponent(rel)} status=fehler grund=${encodeURIComponent(f)} fakten=0/${fall.kernfakten.length} fehlend=${encodeURIComponent(fall.kernfakten.join("\t"))}`);
          continue;
        }
        const p = pruefeAntwort(antwort.text, fall.kernfakten);
        gefunden += p.gefunden; gesamt += p.gesamt;
        if (!p.fehlend.length) voll++;
        schreibe(`${felder} seite=${encodeURIComponent(rel)} status=ok fakten=${p.gefunden}/${p.gesamt} fehlend=${p.fehlend.length ? encodeURIComponent(p.fehlend.join("\t")) : "-"}`);
      }
      const tok = mitTokens ? ` tokEin=${tokEin} tokAus=${tokAus}` : "";
      const status = fehlerZahl === faelle.length ? "fehler" : "ok";
      schreibe(`art=lauf status=${status} anlass=${a} fragen=${faelle.length} voll=${voll} fakten=${gefunden}/${gesamt} fehler=${fehlerZahl}${tok}`);
      return ergebnis(status, null, { fragen: faelle.length, voll, fakten: `${gefunden}/${gesamt}`, fehler: fehlerZahl, tokens: mitTokens ? { ein: tokEin, aus: tokAus } : null });
    } finally { try { unlinkSync(LOCK(vault)); } catch {} }
  } catch {
    schreibe(`art=lauf status=fehler anlass=${a} grund=intern`);
    return ergebnis("fehler", "interner Fehler");
  }
}

// ---------- Ergebnis lesen (Analyse) ----------

// → { letzter: { zeit, status, anlass, fragen, voll, fakten, tokEin, tokAus } | null, faelle: [{ nr, frage, seite,
//   status, fakten, fehlend: [...] }] } — nur der letzte vollständige Lauf.
export function leseErgebnis(vault) {
  const zeilen = leseZeilen(LOG(vault));
  let i = zeilen.length - 1;
  while (i >= 0 && zeilen[i].art !== "lauf") i--;
  if (i < 0) return { letzter: null, faelle: [] };
  const l = zeilen[i];
  const zahlOderNull = (x) => (x != null && Number.isFinite(Number(x)) ? Number(x) : null);
  const faelle = zeilen.filter(z => z.art === "fall" && z.lauf === l.lauf).map(z => ({
    nr: Number(z.nr) || 0, frage: z.frage || "", seite: z.seite || "", status: z.status || "", fakten: z.fakten || "",
    fehlend: z.fehlend && z.fehlend !== "-" ? String(z.fehlend).split("\t").filter(Boolean) : [],
  }));
  return {
    letzter: {
      zeit: l.zeit ? `${l.zeit}Z` : null, status: l.status || null, anlass: l.anlass || null, grund: l.grund || null,
      fragen: zahlOderNull(l.fragen) ?? 0, voll: zahlOderNull(l.voll) ?? 0, fakten: l.fakten || "0/0",
      tokEin: zahlOderNull(l.tokEin), tokAus: zahlOderNull(l.tokAus),
    },
    faelle,
  };
}

// ---------- Auslöser (Sitzungsstart, einmal im Monat, losgelöst) ----------

export function laeuft(vault, jetzt = Date.now()) {
  return frisch(LOCK(vault), 5 * 60 * 1000, jetzt) || frisch(GESTARTET(vault), GESTARTET_MS, jetzt);
}

export function starteLosgeloest(vault, { anlass = "knopf" } = {}) {
  if (process.env.BRAIN_ERNTE === "1") return { gestartet: false, grund: "Selbstaufruf" };
  if (laeuft(vault)) return { gestartet: false, grund: "läuft schon" };
  if (!process.env.BRAIN_ANTWORT_SKRIPT && !findeClaude()) return { gestartet: false, grund: "claude fehlt" };
  const skript = process.env.BRAIN_ANTWORT_SKRIPT || fileURLToPath(import.meta.url);
  try {
    const kind = spawn(process.execPath, [skript, "--anlass", anlass === "monatlich" ? "monatlich" : "knopf", vault], {
      cwd: vault, detached: true, stdio: "ignore", windowsHide: true, env: { ...ohneGit(process.env), BRAIN_VAULT: vault },
    });
    kind.on("error", () => {});
    kind.unref();
    try { mkdirSync(DIR(vault), { recursive: true }); writeFileSync(GESTARTET(vault), ""); } catch {}
    return { gestartet: true };
  } catch { return { gestartet: false, grund: "Start fehlgeschlagen" }; }
}

// Monatlich fällig: Schalter „monatlich", Testfragen vorhanden, letzter Start (Marke) > 30 Tage her.
export function faellig(vault, { jetzt = Date.now(), werte = leseAutomatik(vault).werte } = {}) {
  if (werte.antwortMesslatte !== "monatlich") return false;
  if (!ladeAntworten(vault).length) return false;
  try { return jetzt - statSync(START_MARKE(vault)).mtimeMs > MONAT_MS; } catch { return true; }
}

// session-start (Hintergrund-Zweig): fällig → losgelöst starten, Marke setzen (auch ohne claude — sonst versucht
// es jeder Sitzungsstart erneut). → true, wenn gestartet.
export function starteWennFaellig(vault, { jetzt = Date.now() } = {}) {
  if (process.env.BRAIN_ERNTE === "1") return false;
  const { werte, fehler } = leseAutomatik(vault);
  if (fehler || !faellig(vault, { jetzt, werte })) return false;
  const r = starteLosgeloest(vault, { anlass: "monatlich" });
  if (r.gestartet || r.grund === "claude fehlt") {
    try {
      mkdirSync(dirname(START_MARKE(vault)), { recursive: true });
      writeFileSync(START_MARKE(vault), "");
      const d = new Date(jetzt); utimesSync(START_MARKE(vault), d, d);
    } catch {}
  }
  return r.gestartet === true;
}

// ---------- CLI ----------

const selbst = fileURLToPath(import.meta.url);
let aufruf = "";
try { aufruf = realpathSync(process.argv[1] || ""); } catch {}
if (aufruf && aufruf === realpathSync(selbst)) {
  const argv = process.argv.slice(2);
  let anlass = "knopf", vault = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--anlass") { anlass = argv[i + 1]; i++; }
    else if (!argv[i].startsWith("--")) vault = vault || argv[i];
  }
  const r = await antwortLauf(vault || process.env.BRAIN_VAULT || EIGENER_VAULT, { anlass });
  process.exitCode = r.status === "fehler" ? 1 : 0;
}
