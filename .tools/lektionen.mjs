#!/usr/bin/env node
// .tools/lektionen.mjs — Session-Auswerter (v0.4, Spec H): wiederholte Korrekturen und doppelte Fehlschläge in
// einem Claude-Code-Verlauf → Lektions-Vorschläge (art: lektion) in <inbox>/_vorschlaege/.
// Erkennen lokal (0 Tokens, findeLektionen); Formulieren nur mit Schalter lektionen = "mit-ki" (Haiku, schlank wie
// die Ernte — dieselben Helfer aus ernte.mjs). Fail-closed: unbekannter oder ausgeschlossener Ordner (ernteNichtIn),
// kaputte Config, unlesbares Transkript → nichts. Auszüge mit Zugangs- oder Kundendaten (pii-muster.mjs) oder einem
// Pfad aus ernteNichtIn werden verworfen, nie gekürzt gesendet; Pfade stehen im Auszug nur als Dateiname.
// Gibt beim Lauf nie etwas aus; Ergebnis steht in .logs/lektionen.log. Nur Node-Standardbibliothek.
// CLI:
//   node .tools/lektionen.mjs --transkript <pfad> --sid <id> --cwd <pfad> [vault]   (vom Ernte-Auslöser, losgelöst)
//   node .tools/lektionen.mjs liste [vault]                → übernommene Lektionen (JSON) für den Skill „lektion"
//   node .tools/lektionen.mjs ins-wiki <id> [--titel …] [--regel …] [--warum …] [--wie …] [vault]
//                                                          → Eintrag in <wiki>/_lektionen.md, danach archiviert
//   node .tools/lektionen.mjs skill-entwurf <id> [vault]   → <inbox>/_lektionen/skill-<slug>.md (SKILL.md-Gerüst)
//   node .tools/lektionen.mjs erledigt <id> [vault]        → nach <archiv>/lektionen-erledigt/
import {
  readFileSync, writeFileSync, mkdirSync, readdirSync, lstatSync, renameSync, realpathSync, unlinkSync,
} from "node:fs";
import { join, isAbsolute, win32, resolve as resolvePfad } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { hatSecretsImKontext } from "./secrets-muster.mjs";
import { hatPii } from "./pii-muster.mjs";
import { haengeAn, zeitstempel } from "./logs.mjs";
import { leseAutomatik } from "./einstellungen.mjs";
import { schreibeVorschlag, lektionOrdner, leseVorschlagDatei, ID_MUSTER, liegtImWiki } from "./vorschlaege.mjs";
import { EIGENER_VAULT, ordner, entferneBom } from "./pfade.mjs";
import {
  leseEnde, istAusgeschlossen, findeClaude, rufeHaiku, leseClaudeAntwort, nimmLock,
} from "./ernte.mjs";

export const MAX_AUSZUG = 1500;
export const MAX_JE_LAUF = 3;

// ---------- Erkennen ----------

// Korrektur-Muster, gewichtet: ab Summe 2 gilt ein Prompt als Korrektur. „wieder"/„again" allein (1) reicht nicht.
const KORREKTUR_MUSTER = [
  [/^(nein|nee|no)(?:[\s,.!:;-]|$)/u, 2],
  [/\bfalsch\b/u, 2],
  [/\bwrong\b/u, 2],
  [/\bnicht so\b/u, 2],
  [/\bhab(?:e)? ich (?:dir )?(?:doch|schon|bereits) (?:\S+ )?gesagt\b/u, 2],
  [/\bschon wieder\b/u, 2],
  [/^stopp?\b/u, 2],
  [/\brückgängig\b/u, 2],
  [/\bwieder\b/u, 1],
  [/\bagain\b/u, 1],
  [/\bimmer noch\b/u, 1],
];
const MERK_DIR = /\bmerke? dir\b|\bremember (?:this|that)\b/u;
const STOPPWOERTER = new Set((
  "aber alle alles also auch bitte dann dass dein deine denn dich dies diese dieser dieses doch eine einen einem einer "
  + "habe hast hier immer jetzt kann keine mach mache machen mehr mein meine mich muss nach nicht noch oder schon sein "
  + "sind soll sollst über unter viel warum weil wenn werden wieder wird gesagt falsch nein stop stopp rückgängig "
  + "this that with have again wrong dont please what from your just still should does nochmal nochmals richtig "
  + "gemacht machst bist wurde wäre hätte sollte selbe gleiche gleichen merk merke eigentlich einfach gerade ganz "
  + "schreib schreibst nimm nimmst benutze benutzt bitte sagte sage danke okay genau anders statt"
).split(/\s+/));

const fwd = (p) => String(p).split("\\").join("/");

function schluesselwoerter(text) {
  const out = new Set();
  for (const w of String(text).toLowerCase().split(/[^\p{L}\p{N}_-]+/u)) {
    const s = w.replace(/^[-_]+|[-_]+$/g, "");
    if (s.length < 4 || /^\d+$/.test(s) || STOPPWOERTER.has(s)) continue;
    out.add(s);
  }
  return out;
}
export function korrekturGewicht(text) {
  const t = String(text || "").toLowerCase().trim().slice(0, 600);
  let summe = 0;
  for (const [re, w] of KORREKTUR_MUSTER) if (re.test(t)) summe += w;
  if (/\bschon wieder\b/u.test(t)) summe -= 1;      // „schon wieder" nicht doppelt mit „wieder" zählen
  return summe;
}

// Fehlertext normalisieren: Tags, Pfade, Hashes, Zahlen raus — gleiche Ursache → gleiche Signatur.
export function fehlerSignatur(text) {
  return String(text || "").replace(/<\/?[a-z_]+>/gi, " ").split(/\r?\n/).map(z => z.trim()).filter(Boolean)
    .slice(0, 2).join(" ").toLowerCase()
    .replace(/(?:[a-z]:)?[\\/][^\s'"`:,;)\]]+/gi, "<pfad>")
    .replace(/\b[0-9a-f]{7,}\b/g, "<hex>")
    .replace(/\d+/g, "#")
    .replace(/\s+/g, " ").trim().slice(0, 120);
}

const textAus = (c) => (typeof c === "string" ? c
  : Array.isArray(c) ? c.filter(x => x?.type === "text" && typeof x.text === "string").map(x => x.text).join("\n") : "");
const kurz = (s, n) => { const t = String(s || "").trim(); return t.length > n ? t.slice(0, n - 1).trimEnd() + "…" : t; };
// Zugangsdaten (auch über Zeilengrenzen, Schlüsselwort und Wert getrennt) oder Kundendaten (E-Mail, Telefon, IBAN, Anschrift)
// → der ganze Text gilt als unbrauchbar (fail-closed, nie gekürzt weitergegeben).
const hatZugangsdaten = (s) => hatSecretsImKontext(String(s || ""));
const unsauber = (s) => hatZugangsdaten(s) || hatPii(String(s || ""));

// Pfadartige Stellen im Text: absolut (/…, C:\…, \\server\…), Home (~/…) oder relativ mit Ordner (./…, ../…).
// Ein „/“ mitten im Wort (und/oder, https://…) zählt nicht.
const PFAD_IM_TEXT = /(?<![\p{L}\p{N}_:/\\.~-])(?:[A-Za-z]:[\\/]|~[\\/]|\.{1,2}[\\/]|[\\/])(?:[^\s'"`<>|,;()[\]{}]+[\\/])*[^\s'"`<>|,;()[\]{}\\/]*/gu;
// Pfade im Auszug immer nur als Dateiname (ohne Ordner) — Ordnernamen tragen oft Firmen- oder Kundennamen.
// Dazu relative Pfade ohne ./ (ordner/unter/datei.md) — nur mit Dateiendung, damit „und/oder“ stehen bleibt.
const REL_PFAD_IM_TEXT = /(?<![\p{L}\p{N}_:/\\.~-])[\p{L}\p{N}_.-]+(?:[\\/][\p{L}\p{N}_ .-]*[\p{L}\p{N}_-])+\.[A-Za-z0-9]{1,8}(?![\p{L}\p{N}_/\\])/gu;
const dateiname = (p) => { const teile = String(p).split(/[\\/]+/).filter(Boolean); return teile.length ? teile[teile.length - 1] : p; };
export function kuerzePfade(text) {
  return String(text ?? "").replace(PFAD_IM_TEXT, dateiname).replace(REL_PFAD_IM_TEXT, dateiname);
}
function pfadeIn(text) {
  const t = String(text ?? "");
  return [...t.matchAll(PFAD_IM_TEXT), ...t.matchAll(REL_PFAD_IM_TEXT)].map(m => m[0]).filter(p => p.length > 1);
}
// Pfad (absolut, ~ oder relativ zum Arbeitsordner) liegt in einem ausgeschlossenen Ordner (ernteNichtIn)?
function pfadAusgeschlossen(p, ernteNichtIn, cwd) {
  if (typeof p !== "string" || !p.trim() || !ernteNichtIn.length) return false;
  let roh = p.trim();
  if (/^~(?:[\\/]|$)/.test(roh)) roh = join(homedir(), roh.slice(1));
  const abs = isAbsolute(roh) || win32.isAbsolute(roh) ? roh : (cwd ? resolvePfad(cwd, roh) : roh);
  try { return istAusgeschlossen(abs, ernteNichtIn); } catch { return true; }
}
// Nennt der Text (oder ein Werkzeug-Eingabefeld) irgendwo einen Pfad aus ernteNichtIn?
export function nenntAusgeschlossenes(text, ernteNichtIn, cwd) {
  if (!Array.isArray(ernteNichtIn) || !ernteNichtIn.length) return false;
  return pfadeIn(text).some(p => pfadAusgeschlossen(p, ernteNichtIn, cwd));
}
const PFAD_FELDER = ["file_path", "path", "notebook_path", "cwd", "directory", "dir", "target", "source"];
function werkzeugAusgeschlossen(input, ernteNichtIn, cwd) {
  if (!input || typeof input !== "object" || !ernteNichtIn.length) return false;
  for (const k of PFAD_FELDER) if (typeof input[k] === "string" && pfadAusgeschlossen(input[k], ernteNichtIn, cwd)) return true;
  for (const k of ["command", "pattern", "glob", "url"]) if (typeof input[k] === "string" && nenntAusgeschlossenes(input[k], ernteNichtIn, cwd)) return true;
  return false;
}

// Aufruf im Auszug: Befehle nur mit den ersten zwei Wörtern, Dateien nur mit dem Dateinamen, Adressen nur mit
// dem Host — nie die ganze Befehlszeile (Zugangsdaten), nie der Ordner (Kundennamen).
function aufrufText(tool) {
  const i = tool?.input && typeof tool.input === "object" ? tool.input : {};
  const name = String(tool?.name || "?");
  if (typeof i.command === "string") return `${name}: ${kuerzePfade(befehlsAnfang(tool))}`;
  if (typeof i.url === "string") {
    let host = ""; try { host = new URL(i.url).host; } catch {}
    return host ? `${name}: ${host}` : name;
  }
  const ziel = i.file_path || i.path || i.notebook_path || i.pattern || "";
  return ziel ? `${name}: ${kurz(dateiname(String(ziel)), 120)}` : name;
}
function befehlsAnfang(tool) {
  const c = tool?.input?.command;
  if (typeof c !== "string") return "";
  return c.trim().split(/\s+/).slice(0, 2).join(" ");
}

// Auszug aus Stücken bauen. Verworfen (→ null, Kandidat entfällt), wenn irgendein Stück — einzeln oder im
// zusammengefügten Kontext — Zugangsdaten, Kundendaten oder einen Pfad aus ernteNichtIn enthält. Geprüft wird
// VOR dem Kürzen der Pfade (der Ordner verrät den Ausschluss) und danach noch einmal am fertigen Auszug.
function baueAuszug(stuecke, { ernteNichtIn = [], cwd = "" } = {}) {
  if (stuecke.some(unsauber) || unsauber(stuecke.join("\n"))) return null;
  if (stuecke.some(s => nenntAusgeschlossenes(s, ernteNichtIn, cwd))) return null;
  let out = "";
  for (const s of stuecke.map(kuerzePfade)) {
    const naechstes = out ? `${out}\n\n${s}` : s;
    if (naechstes.length > MAX_AUSZUG) { out = kurz(naechstes, MAX_AUSZUG); break; }
    out = naechstes;
  }
  return unsauber(out) ? null : out;
}

// findeLektionen(transkriptPfad, { ernteNichtIn, cwd, sid }) → [{ art, thema, auszug, anzahl, ordner, sitzung, schluessel }]
// Korrektur: zählt erst ab der zweiten Korrektur zum selben Thema (≥ 2 gemeinsame Schlüsselwörter) oder sofort bei
// einer Korrektur mit „merk dir". Fehlschlag: dasselbe Werkzeug mit gleicher Fehlersignatur ≥ 2× bzw. gleicher
// Befehlsanfang bei Fehler-Ergebnissen ≥ 2×. Fail-closed: im Zweifel [].
export function findeLektionen(transkriptPfad, { ernteNichtIn = [], cwd = "", sid = "" } = {}) {
  try {
    if (!cwd || !(isAbsolute(cwd) || win32.isAbsolute(cwd))) return [];
    if (!Array.isArray(ernteNichtIn)) return [];
    if (istAusgeschlossen(cwd, ernteNichtIn)) return [];
    if (typeof transkriptPfad !== "string" || !transkriptPfad) return [];
    const { zeilen } = leseEnde(transkriptPfad, 0);

    const korrekturen = [];          // { kw:Set, prompt, vorher, merk }
    const fehler = [];               // { tool, text }
    const werkzeuge = new Map();     // tool_use id → { name, input }
    const ordnerGeprueft = new Map(); // cwd einer Zeile → ausgeschlossen?
    let letzteAntwort = "", antwortSeitPrompt = false, sitzung = String(sid || "");
    for (const roh of zeilen) {
      if (!roh.trim()) continue;
      let m; try { m = JSON.parse(roh); } catch { continue; }
      if (!m || typeof m !== "object") continue;
      // Ein Teil der Sitzung lief in einem ausgeschlossenen Ordner → die ganze Sitzung bleibt unberührt.
      if (typeof m.cwd === "string" && m.cwd && m.cwd !== cwd) {
        if (!ordnerGeprueft.has(m.cwd)) ordnerGeprueft.set(m.cwd, istAusgeschlossen(m.cwd, ernteNichtIn));
        if (ordnerGeprueft.get(m.cwd)) return [];
      }
      if (!sitzung && typeof m.sessionId === "string") sitzung = m.sessionId;
      if (m.isMeta || m.isCompactSummary) continue;
      const c = m.message?.content;
      if (m.type === "assistant") {
        if (Array.isArray(c)) {
          for (const x of c) {
            if (x?.type !== "tool_use" || typeof x.id !== "string") continue;
            // Ein Werkzeug-Aufruf in einen ausgeschlossenen Ordner (Pfadfeld oder Pfad im Befehl) → die ganze
            // Sitzung bleibt unberührt, wie bei einem ausgeschlossenen cwd (fail-closed).
            if (werkzeugAusgeschlossen(x.input, ernteNichtIn, typeof m.cwd === "string" && m.cwd ? m.cwd : cwd)) return [];
            werkzeuge.set(x.id, { name: String(x.name || "?"), input: x.input });
          }
        }
        const t = textAus(c).trim();
        if (t) letzteAntwort = t;
        antwortSeitPrompt = true;
        continue;
      }
      if (m.type !== "user") continue;
      if (Array.isArray(c) && c.some(x => x?.type === "tool_result")) {
        for (const x of c) {
          if (x?.type !== "tool_result" || x.is_error !== true) continue;
          const tool = werkzeuge.get(x.tool_use_id) || { name: "?", input: {} };
          fehler.push({ tool, text: textAus(x.content) || (typeof x.content === "string" ? x.content : "") });
        }
        continue;
      }
      const prompt = textAus(c).trim();
      if (!prompt || prompt.startsWith("<") || prompt.startsWith("/")) continue;
      if (antwortSeitPrompt && korrekturGewicht(prompt) >= 2) {
        korrekturen.push({ kw: schluesselwoerter(prompt), prompt, vorher: letzteAntwort, merk: MERK_DIR.test(prompt.toLowerCase()) });
      }
      antwortSeitPrompt = false;
    }

    const sitzungRein = String(sitzung || "").replace(/[^\w-]/g, "").slice(0, 64);
    const out = [];

    // Korrekturen gruppieren: gleiche Gruppe, wenn ≥ 2 Schlüsselwörter mit einem Mitglied gemeinsam.
    const gruppen = [];
    for (const k of korrekturen) {
      const g = gruppen.find(gr => gr.some(x => [...k.kw].filter(w => x.kw.has(w)).length >= 2));
      if (g) g.push(k); else gruppen.push([k]);
    }
    for (const g of gruppen) {
      if (g.length < 2 && !g.some(x => x.merk)) continue;
      const zaehler = new Map();
      for (const x of g) for (const w of x.kw) zaehler.set(w, (zaehler.get(w) || 0) + 1);
      const gemeinsam = [...zaehler].filter(([, n]) => g.length < 2 || n >= 2).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
      const thema = gemeinsam.slice(0, 3).map(([w]) => w).join(" ") || "Korrektur";
      const stuecke = g.slice(0, 3).map(x => `Assistent: ${kurz(x.vorher, 300)}\nNutzer: ${kurz(x.prompt, 400)}`);
      const auszug = baueAuszug(stuecke, { ernteNichtIn, cwd });
      if (auszug == null || unsauber(thema)) continue;
      out.push({ art: "korrektur", thema, auszug, anzahl: g.length, ordner: cwd, sitzung: sitzungRein, schluessel: `korrektur:${gemeinsam.slice(0, 3).map(([w]) => w).sort().join("+")}` });
    }

    // Fehlschläge: erst nach Werkzeug + Fehlersignatur, dann (Rest) nach Befehlsanfang.
    const nachSig = new Map(), nachBefehl = new Map();
    fehler.forEach((f, i) => {
      const sig = `${f.tool.name}|${fehlerSignatur(f.text)}`;
      if (!nachSig.has(sig)) nachSig.set(sig, []);
      nachSig.get(sig).push(i);
      const anfang = befehlsAnfang(f.tool);
      if (anfang) {
        const b = `${f.tool.name}|${anfang}`;
        if (!nachBefehl.has(b)) nachBefehl.set(b, []);
        nachBefehl.get(b).push(i);
      }
    });
    const erfasst = new Set();
    const fehlschlag = (idx, thema, schluessel) => {
      const stuecke = idx.slice(0, 3).map(i => `Aufruf: ${aufrufText(fehler[i].tool)}\nFehler: ${kurz(fehler[i].text.split(/\r?\n/).slice(0, 3).join("\n"), 300)}`);
      idx.forEach(i => erfasst.add(i));
      // Die ganze Befehlszeile kommt nie in den Auszug — trägt sie aber Zugangs- oder Kundendaten, entfällt der
      // Kandidat trotzdem (fail-closed: die KI soll aus so einem Lauf keine Regel ableiten).
      if (idx.some(i => typeof fehler[i].tool?.input?.command === "string" && unsauber(fehler[i].tool.input.command))) return;
      const auszug = baueAuszug(stuecke, { ernteNichtIn, cwd });
      if (auszug == null || unsauber(thema) || nenntAusgeschlossenes(thema, ernteNichtIn, cwd)) return;
      out.push({ art: "fehlschlag", thema: kurz(thema, 80), auszug, anzahl: idx.length, ordner: cwd, sitzung: sitzungRein, schluessel });
    };
    for (const [sig, idx] of nachSig) {
      if (idx.length < 2) continue;
      const [name, norm] = sig.split("|");
      const anfang = befehlsAnfang(fehler[idx[0]].tool);
      fehlschlag(idx, anfang ? `${name}: ${kuerzePfade(anfang)}` : `${name}: ${kurz(norm, 60)}`, `fehlschlag:${sig.slice(0, 160)}`);
    }
    for (const [b, idx] of nachBefehl) {
      const rest = idx.filter(i => !erfasst.has(i));
      if (idx.length < 2 || rest.length === 0) continue;
      const [name, anfang] = b.split("|");
      fehlschlag(idx, `${name}: ${kuerzePfade(anfang)}`, `fehlschlag:${b.slice(0, 160)}`);
    }
    return out.sort((a, b) => b.anzahl - a.anzahl);
  } catch { return []; }
}

// ---------- Formulieren ----------

export const LEKTION_AUFTRAG = [
  "Du formulierst aus wiederholten Korrekturen oder Fehlschlägen einer Arbeitssitzung kurze Lektionen für eine KI-Assistenz.",
  "Schreibe NIE Zugangsdaten, Passwörter, Tokens, Schlüssel, Adressen, Telefonnummern oder Kundendaten.",
  "Je echter Lektion genau ein Block, sonst nichts:",
  "### <Titel, höchstens 60 Zeichen>",
  "ziel: memory (Regel für die Assistenz) oder skill (nur bei einem wiederkehrenden, mehrschrittigen Ablauf)",
  "regel: <ein Satz: was künftig zu tun ist>",
  "warum: <ein Satz>",
  "wie: <ein bis zwei Sätze: wann und wie anwenden>",
  "Ist ein Kandidat keine echte Lektion, lass ihn weg. Gibt es keine, antworte nur: NICHTS",
].join("\n");
export const KANDIDATEN_KOPF = "--- KANDIDATEN ---\n\n";

export function parseLektionen(ausgabe) {
  const t = String(ausgabe || "").replace(/\r\n?/g, "\n").trim();
  if (!t || /^NICHTS\b/.test(t)) return [];
  const out = [];
  for (const block of t.split(/^###[ \t]+/m).slice(1)) {
    const [kopf, ...rest] = block.split("\n");
    const titel = kopf.trim().slice(0, 60);
    const f = {};
    for (const z of rest) {
      const m = /^\s*(ziel|regel|warum|wie)\s*:\s*(.*)$/i.exec(z);
      if (m) f[m[1].toLowerCase()] = m[2].trim();
    }
    if (!titel || !f.regel) continue;
    out.push({ titel, ziel: /^skill\b/i.test(f.ziel || "") ? "skill" : "memory", regel: f.regel, warum: f.warum || "", wie: f.wie || "" });
  }
  return out.slice(0, MAX_JE_LAUF);
}

function rohVorschlag(k) {
  const titel = `${k.art === "fehlschlag" ? "Wiederholter Fehlschlag" : "Wiederholte Korrektur"}: ${k.thema}`.slice(0, 80);
  const text = `${k.anzahl}× in einer Sitzung — noch nicht formuliert (Rohkandidat). Beim Übernehmen formuliert der Skill „lektion“ die Regel.\n\nAuszug:\n\n${k.auszug}`;
  return { titel, text, ziel: "memory", regel: "", warum: "", wie: "" };
}

// formuliereLektionen(vault, kandidaten, { mitKi, claudeBefehl, jetzt }) → { status, vorschlaege: [id], verworfen, tokens, fehler? }
// Höchstens 3 Kandidaten. Ohne KI (oder wenn claude fehlt/scheitert) → Rohkandidat mit Auszug.
export async function formuliereLektionen(vault, kandidaten, { mitKi = false, claudeBefehl = null, jetzt = Date.now() } = {}) {
  const auswahl = (Array.isArray(kandidaten) ? kandidaten : []).filter(k => k && typeof k.auszug === "string" && !unsauber(k.auszug) && !unsauber(k.thema)).slice(0, MAX_JE_LAUF);
  const ergebnis = { status: "ok", vorschlaege: [], verworfen: 0, tokens: null, ein: 0, aus: 0, modus: mitKi ? "mit-ki" : "lokal" };
  if (!auswahl.length) return ergebnis;
  let formuliert = null;
  if (mitKi) {
    if (!claudeBefehl) ergebnis.fehler = "claude nicht gefunden";
    else {
      const eingabe = KANDIDATEN_KOPF + auswahl.map((k, i) => `## Kandidat ${i + 1} (${k.art}, ${k.anzahl}×): ${k.thema}\n${k.auszug}`).join("\n\n") + "\n";
      ergebnis.ein = LEKTION_AUFTRAG.length + eingabe.length;
      const r = await rufeHaiku(claudeBefehl, LEKTION_AUFTRAG, eingabe, vault, { zweck: "lektion" });
      const antwort = r.fehler ? null : leseClaudeAntwort(r.ausgabe);
      const fehler = r.fehler || antwort.fehler;
      if (fehler) ergebnis.fehler = fehler;
      else { ergebnis.tokens = antwort.tokens; ergebnis.aus = antwort.text.length; formuliert = parseLektionen(antwort.text); }
    }
  }
  // KI-Fehler → Rückfall Rohkandidaten (die Erkennung geht nicht verloren); KI sagt NICHTS → keine Vorschläge.
  const liste = formuliert ?? auswahl.map(rohVorschlag);
  const quelle = auswahl[0];
  for (const v of liste) {
    const text = formuliert
      ? [`**Regel:** ${v.regel}`, v.warum ? `**Warum:** ${v.warum}` : "", v.wie ? `**Wie anwenden:** ${v.wie}` : ""].filter(Boolean).join("\n\n")
      : v.text;
    if (unsauber(`${v.titel}\n${text}\n${v.regel}\n${v.warum}\n${v.wie}`)) { ergebnis.verworfen++; continue; }
    try {
      ergebnis.vorschlaege.push(schreibeVorschlag(vault, {
        art: "lektion", titel: v.titel, text, ordner: quelle.ordner || "", sitzung: quelle.sitzung || "",
        ziel: v.ziel, regel: v.regel, warum: v.warum, wie: v.wie,
      }, new Date(jetzt)));
    } catch { ergebnis.verworfen++; }
  }
  if (ergebnis.fehler) ergebnis.status = "rueckfall";
  return ergebnis;
}

// ---------- Lauf (Auslöser am Sitzungsende, Pflege-Lauf über die Verläufe der Woche) ----------

const LEKTION_DIR = (vault) => join(vault, ".logs", "lektionen");
const reinSid = (s) => String(s || "").replace(/[^\w-]/g, "").slice(0, 64);
function leseGesehen(vault, sid) {
  if (!sid) return new Set();
  try { return new Set(JSON.parse(readFileSync(join(LEKTION_DIR(vault), `${sid}.json`), "utf8")).schluessel || []); }
  catch { return new Set(); }
}
function schreibeGesehen(vault, sid, set) {
  if (!sid) return;
  try { mkdirSync(LEKTION_DIR(vault), { recursive: true }); writeFileSync(join(LEKTION_DIR(vault), `${sid}.json`), JSON.stringify({ schluessel: [...set].slice(-200) }) + "\n"); } catch {}
}

// verlaeufe: [{ transkript, sid, cwd }]. Schon gemeldete Themen je Sitzung (.logs/lektionen/<sid>.json) kommen
// nicht noch einmal (SessionEnd und PreCompact feuern beide). → { status, grund?, kandidaten, vorschlaege, … }
export async function lektionenAusVerlaeufen(vault, verlaeufe, { claudeBefehl, jetzt = Date.now(), anlass = "sitzungsende" } = {}) {
  const ergebnis = (status, grund, extra = {}) => ({ status, ...(grund ? { grund } : {}), kandidaten: 0, vorschlaege: [], ...extra });
  if (process.env.BRAIN_ERNTE === "1") return ergebnis("uebersprungen", "Selbstaufruf");
  const log = join(vault, ".logs", "lektionen.log");
  try {
    const { werte, fehler } = leseAutomatik(vault);
    if (fehler) return ergebnis("uebersprungen", "Config nicht lesbar");
    if (werte.lektionen === "aus") return ergebnis("uebersprungen", "Schalter aus");
    const mitKi = werte.lektionen === "mit-ki";
    const lock = join(LEKTION_DIR(vault), "lauf.lock");
    if (!nimmLock(lock, jetzt)) return ergebnis("uebersprungen", "läuft schon");
    try {
      const alle = [];
      const gesehen = new Map();
      for (const v of Array.isArray(verlaeufe) ? verlaeufe : []) {
        const sid = reinSid(v?.sid);
        if (!gesehen.has(sid)) gesehen.set(sid, leseGesehen(vault, sid));
        const schon = gesehen.get(sid);
        for (const k of findeLektionen(v?.transkript, { ernteNichtIn: werte.ernteNichtIn, cwd: v?.cwd, sid })) {
          if (!schon.has(k.schluessel)) alle.push({ ...k, _sid: sid });
        }
      }
      alle.sort((a, b) => b.anzahl - a.anzahl);
      const auswahl = alle.slice(0, MAX_JE_LAUF);
      const befehl = mitKi ? (claudeBefehl === undefined ? findeClaude() : claudeBefehl) : null;
      const r = await formuliereLektionen(vault, auswahl, { mitKi, claudeBefehl: befehl, jetzt });
      for (const k of auswahl) gesehen.get(k._sid)?.add(k.schluessel);
      for (const [sid, set] of gesehen) if (auswahl.some(k => k._sid === sid)) schreibeGesehen(vault, sid, set);
      const tok = r.tokens ? ` tokEin=${r.tokens.ein} tokAus=${r.tokens.aus}` : "";
      haengeAn(log, `${zeitstempel(new Date(jetzt))} anlass=${anlass} modus=${r.modus} status=${r.status} kandidaten=${alle.length} vorschlaege=${r.vorschlaege.length} verworfen=${r.verworfen} ein=${r.ein} aus=${r.aus}${tok}${r.fehler ? ` grund=${encodeURIComponent(r.fehler)}` : ""}`);
      return ergebnis(r.status === "rueckfall" ? "ok" : r.status, r.fehler || null, { kandidaten: alle.length, vorschlaege: r.vorschlaege, verworfen: r.verworfen, tokens: r.tokens });
    } finally { try { unlinkSync(lock); } catch {} }
  } catch {
    haengeAn(log, `${zeitstempel(new Date(jetzt))} anlass=${anlass} status=fehler grund=intern`);
    return ergebnis("fehler", "interner Fehler");
  }
}

export function lektionsLauf(vault, { transkript, sid = "", cwd = "", claudeBefehl, jetzt = Date.now() } = {}) {
  return lektionenAusVerlaeufen(vault, [{ transkript, sid, cwd }], { claudeBefehl, jetzt, anlass: "sitzungsende" });
}

// ---------- Übernommene Lektionen (<inbox>/_lektionen/) — Werkzeuge für den Skill „lektion" ----------

const fehlerMit = (code, meldung) => Object.assign(new Error(meldung), { code });
function lektionsDatei(vault, id) {
  if (typeof id !== "string" || !ID_MUSTER.test(id)) throw fehlerMit(400, "Ungültige Lektions-ID.");
  const dir = lektionOrdner(vault);
  let st;
  try { st = lstatSync(dir); } catch { throw fehlerMit(404, "Diese Lektion gibt es nicht (mehr)."); }
  if (st.isSymbolicLink() || !st.isDirectory()) throw fehlerMit(400, "Lektionsordner ist kein normaler Ordner.");
  let dirEcht = dir;
  try { dirEcht = realpathSync(dir); } catch {}
  if (liegtImWiki(vault, dirEcht)) throw fehlerMit(400, "Lektionsordner liegt im Wiki.");
  const f = join(dir, `${id}.md`);
  try { if (!lstatSync(f).isFile()) throw new Error(); } catch { throw fehlerMit(404, "Diese Lektion gibt es nicht (mehr)."); }
  let v;
  try { v = leseVorschlagDatei(readFileSync(f, "utf8")); } catch { throw fehlerMit(400, "Das ist keine Lektion."); }
  if (v.art !== "lektion") throw fehlerMit(400, "Das ist keine Lektion.");
  return { datei: f, ...v };
}

export function listeLektionen(vault) {
  let namen;
  try {
    const dir = lektionOrdner(vault);
    if (lstatSync(dir).isSymbolicLink()) return [];
    namen = readdirSync(dir);
  } catch { return []; }
  const out = [];
  for (const n of namen.sort()) {
    if (!n.endsWith(".md")) continue;
    try { const { datei, quelleSitzung, ...v } = lektionsDatei(vault, n.slice(0, -3)); out.push({ id: n.slice(0, -3), ...v }); } catch {}
  }
  return out;
}

function freierName(dir, basis) {
  for (let n = 1; n <= 999; n++) {
    const p = join(dir, n === 1 ? `${basis}.md` : `${basis}-${n}.md`);
    try { lstatSync(p); } catch { return p; }
  }
  throw fehlerMit(500, "Kein freier Dateiname.");
}

export function lektionErledigt(vault, id) {
  const { datei } = lektionsDatei(vault, id);
  const zielDir = join(vault, ordner(vault).archiv, "lektionen-erledigt");
  mkdirSync(zielDir, { recursive: true });
  const ziel = freierName(zielDir, id);
  renameSync(datei, ziel);
  return { ok: true, ziel: fwd(ziel.slice(vault.length + 1)) };
}

const einzeilig = (s) => String(s ?? "").replace(/[\r\n\t]+/g, " ").trim();
// Eintrag in <wiki>/_lektionen.md (andere KIs lesen sie über AGENTS.md): je Lektion höchstens 3 Zeilen.
export function lektionInsWiki(vault, id, ueber = {}) {
  const l = lektionsDatei(vault, id);
  const titel = einzeilig(ueber.titel || l.titel).slice(0, 80);
  const regel = einzeilig(ueber.regel || l.regel).slice(0, 300);
  const warum = einzeilig(ueber.warum || l.warum).slice(0, 300);
  const wie = einzeilig(ueber.wie || l.wie).slice(0, 300);
  if (!titel || !regel) throw fehlerMit(400, "Die Lektion hat noch keine Regel — erst formulieren (--regel).");
  if (hatZugangsdaten(`${titel}\n${regel}\n${warum}\n${wie}`)) throw fehlerMit(400, "Lektion enthält vermutlich Zugangsdaten — nicht geschrieben.");
  const wikiDir = join(vault, ordner(vault).wiki);
  mkdirSync(wikiDir, { recursive: true });
  const datei = join(wikiDir, "_lektionen.md");
  let alt = "";
  try {
    if (lstatSync(datei).isSymbolicLink()) throw fehlerMit(400, "_lektionen.md ist keine normale Datei.");
    alt = entferneBom(readFileSync(datei, "utf8")).replace(/\r\n/g, "\n");
  } catch (e) { if (e.code === 400) throw e; }
  if (!alt.trim()) alt = "# Lektionen\n\nKurze Regeln aus wiederholten Korrekturen und Fehlschlägen (Skill „lektion“). Je Lektion höchstens 3 Zeilen.\n";
  const eintrag = [`- **${titel}** — ${regel}`, ...(warum || wie ? [`  ${[warum && `Warum: ${warum}`, wie && `Wie: ${wie}`].filter(Boolean).join(" · ")}`] : [])].join("\n");
  writeFileSync(datei, `${alt.replace(/\n*$/, "\n")}\n${eintrag}\n`);
  const r = lektionErledigt(vault, id);
  return { ok: true, wiki: fwd(datei.slice(vault.length + 1)), archiv: r.ziel };
}

const slug = (s) => String(s).toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/ß/g, "ss")
  .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "lektion";
// ziel: skill → Entwurf mit SKILL.md-Gerüst neben den Lektionen; nie automatisch installiert.
export function skillEntwurf(vault, id) {
  const l = lektionsDatei(vault, id);
  const name = slug(l.titel);
  const datei = freierName(lektionOrdner(vault), `skill-${name}`);
  const inhalt = [
    "---",
    `name: ${name}`,
    `description: ${JSON.stringify(einzeilig(l.regel || l.titel).slice(0, 200))}`,
    "---",
    "",
    `# ${einzeilig(l.titel)}`,
    "",
    "<!-- Entwurf aus einer Lektion — prüfen, ergänzen und erst dann bewusst als Skill anlegen. -->",
    "",
    l.warum ? `**Warum:** ${einzeilig(l.warum)}` : "",
    "",
    "## Ablauf",
    "",
    `1. ${einzeilig(l.wie || l.regel || "…")}`,
    "",
    "## Herkunft",
    "",
    l.text,
    "",
  ].join("\n");
  if (hatZugangsdaten(inhalt)) throw fehlerMit(400, "Entwurf enthält vermutlich Zugangsdaten — nicht geschrieben.");
  writeFileSync(datei, inhalt, { flag: "wx" });
  const r = lektionErledigt(vault, id);
  return { ok: true, entwurf: fwd(datei.slice(vault.length + 1)), archiv: r.ziel };
}

// ---------- CLI ----------

export function leseArgs(argv) {
  const flags = {}, rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) { flags[a.slice(2)] = argv[i + 1]; i++; } else rest.push(a);
  }
  return { flags, rest };
}

const selbst = fileURLToPath(import.meta.url);
let aufruf = "";
try { aufruf = realpathSync(process.argv[1] || ""); } catch {}
if (aufruf && aufruf === realpathSync(selbst)) {
  const { flags, rest } = leseArgs(process.argv.slice(2));
  const befehle = new Set(["liste", "ins-wiki", "skill-entwurf", "erledigt"]);
  if (befehle.has(rest[0])) {
    const befehl = rest[0];
    const id = befehl === "liste" ? null : rest[1];
    const vault = (befehl === "liste" ? rest[1] : rest[2]) || process.env.BRAIN_VAULT || EIGENER_VAULT;
    try {
      let r;
      if (befehl === "liste") r = listeLektionen(vault);
      else if (befehl === "erledigt") r = lektionErledigt(vault, id);
      else if (befehl === "skill-entwurf") r = skillEntwurf(vault, id);
      else r = lektionInsWiki(vault, id, { titel: flags.titel, regel: flags.regel, warum: flags.warum, wie: flags.wie });
      console.log(JSON.stringify(r, null, 2));
    } catch (e) {
      console.error(`Lektion: ${e.code ? e.message : "unerwarteter Fehler"}`);
      process.exitCode = 1;
    }
  } else {
    // Hintergrund-Lauf: nie Ausgabe.
    const vault = rest[0] || process.env.BRAIN_VAULT || EIGENER_VAULT;
    const r = await lektionsLauf(vault, { transkript: flags.transkript, sid: flags.sid || "", cwd: flags.cwd || "" });
    process.exitCode = r.status === "fehler" ? 1 : 0;
  }
}
