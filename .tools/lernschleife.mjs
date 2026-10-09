#!/usr/bin/env node
// .tools/lernschleife.mjs — Lernschleife der Treffsicherheit (0 Tokens, rein lokal).
// Quelle: Wissensfragen, die der Hinweis-Hook nur mit Schalter `luecken` als STICHWÖRTER festhält (nie Prompttext):
//   .logs/luecken.log    — kein Hinweis gezeigt          (Felder: sid, quelle, text)
//   .logs/fragespur.log  — Hinweis gezeigt (Seiten hits) (Felder: sid, hits, text)
// Liest die KI danach in derselben Sitzung (werkzeug.log, art=lesen) innerhalb von 10 min und vor dem nächsten Prompt
// (hint.log) eine Wiki-Seite — bei Fragespur eine, die der Hinweis NICHT nannte, und keine der genannten —, entsteht
// der Kandidat „Frage → Seite“. Einmal pro Woche werden daraus Pflege-Vorschläge (art: pflege, befund: frage):
// „Frage X zur Seite Y hinzufügen?“. Übernommen landen sie in <inbox>/_pflege/; der Ingest trägt die Frage in
// `fragen:` der Seite UND als Testfrage in <wiki>/_messlatte.json ein (nie direkt von hier).
// CLI: node lernschleife.mjs [vault] [--woche] [--json]
//   ohne Schalter: Kandidaten anzeigen (nichts schreiben); --woche: fällig? → Vorschläge schreiben, Marke setzen.
import { readFileSync, writeFileSync, mkdirSync, statSync, utimesSync, realpathSync, renameSync, unlinkSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { leseZeilen } from "./logs.mjs";
import { lueckenDatei, fragespurDatei, stichwoerter } from "./analyse.mjs";
import { schreibeVorschlag } from "./vorschlaege.mjs";
import { vaultPfad, ordner, entferneBom } from "./pfade.mjs";
import { istWikiSeite } from "./wiki-pfade.mjs";
import { fragenRoh, pruefeFragen } from "./fragen.mjs";
import { wert } from "./einstellungen.mjs";

const TAG_MS = 86400000, WOCHE_MS = 7 * TAG_MS, FENSTER_MS = 10 * 60000;
export const MAX_JE_WOCHE = 5;
const MAX_GESEHEN = 2000;
const kurzSid = (sid) => String(sid || "").slice(0, 8);
const ms = (zeit) => { const t = Date.parse(`${zeit}Z`); return Number.isFinite(t) ? t : NaN; };
export const WOCHE_MARKE = (vault) => join(vault, ".logs", "lernschleife-woche");
const GESEHEN = (vault) => join(vault, ".logs", "lernschleife-gesehen.txt");

// Seiten, die als Ziel nichts taugen: Überblick und Ich-Karte liest die KI aus anderen Gründen.
const OHNE_ZIEL = new Set(["ueberblick.md", "ich.md"]);
function zielSeite(rel, wiki) {
  return istWikiSeite(rel, wiki) && !OHNE_ZIEL.has(basename(rel));
}

function nachSid(zeilen) {
  const m = new Map();
  for (const z of zeilen) {
    const s = kurzSid(z.sid), t = ms(z.zeit);
    if (!s || !Number.isFinite(t)) continue;
    if (!m.has(s)) m.set(s, []);
    m.get(s).push({ ...z, t });
  }
  for (const l of m.values()) l.sort((a, b) => a.t - b.t);
  return m;
}

// → [{ stichwoerter: [...], seite, anlass: "ohne"|"anders", hinweis: [...], zeit }], älteste zuerst.
export function kandidaten(vault, { tage = 30, jetzt = Date.now() } = {}) {
  const seitMs = jetzt - tage * TAG_MS;
  const wiki = ordner(vault).wiki;
  const fragen = [
    ...leseZeilen(lueckenDatei(vault), { seitMs }).filter(f => f.quelle === "hint").map(f => ({ ...f, anlass: "ohne", hinweis: [] })),
    ...leseZeilen(fragespurDatei(vault), { seitMs }).map(f => ({ ...f, anlass: "anders", hinweis: String(f.hits || "").split("\t").map(h => h.trim()).filter(Boolean) })),
  ].filter(f => f.sid && f.text);
  if (!fragen.length) return [];
  const prompts = nachSid(leseZeilen(join(vault, ".logs", "hint.log"), { seitMs }));
  const gelesen = nachSid(leseZeilen(join(vault, ".logs", "werkzeug.log"), { seitMs }).filter(w => w.art === "lesen" && w.ziel));
  const out = [];
  for (const f of fragen) {
    const t0 = ms(f.zeit), s = kurzSid(f.sid);
    if (!Number.isFinite(t0)) continue;
    // Fenster: 10 min, aber nur bis zum nächsten Prompt derselben Sitzung (danach gehört das Lesen zur nächsten Frage)
    const naechster = (prompts.get(s) || []).find(p => p.t > t0);
    const ende = Math.min(t0 + FENSTER_MS, naechster ? naechster.t - 1 : Infinity);
    const reads = (gelesen.get(s) || []).filter(w => w.t >= t0 && w.t <= ende && zielSeite(w.ziel, wiki));
    if (!reads.length) continue;
    const hinweis = new Set(f.hinweis);
    if (reads.some(w => hinweis.has(w.ziel))) continue; // Hinweis war richtig — nichts zu lernen
    const stw = String(f.text).split(" ").filter(Boolean);
    if (!stw.length) continue;
    out.push({ stichwoerter: stw, seite: reads[0].ziel, anlass: f.anlass, hinweis: f.hinweis, zeit: f.zeit });
  }
  return out.sort((a, b) => ms(a.zeit) - ms(b.zeit));
}

const schluessel = (k) => createHash("sha256").update(`${k.seite}\n${[...k.stichwoerter].sort().join(" ")}`).digest("hex").slice(0, 20);

// Steht die Frage (als Stichwörter) schon in `fragen:` der Seite? Dann kein Vorschlag.
function schonDa(vault, k) {
  try {
    const roh = entferneBom(readFileSync(join(vault, ...k.seite.split("/")), "utf8")).replace(/\r\n/g, "\n");
    const fm = (roh.match(/^---\n([\s\S]*?)\n---/) || [, ""])[1];
    const vorhanden = pruefeFragen(fragenRoh(fm)).fragen.map(q => new Set(stichwoerter(q)));
    return vorhanden.some(set => k.stichwoerter.every(w => set.has(w)));
  } catch { return true; } // Seite weg/unlesbar → nichts vorschlagen
}

// Gruppiert gleiche Paare (Seite + Stichwörter), zählt sie, filtert Bekanntes → höchstens `max`, häufigste zuerst.
export function vorschlagsListe(vault, kand, { gesehen = new Set(), max = MAX_JE_WOCHE } = {}) {
  const gruppen = new Map();
  for (const k of kand) {
    const id = schluessel(k);
    if (!gruppen.has(id)) gruppen.set(id, { ...k, id, anzahl: 0, anlaesse: new Set(), hinweise: new Set() });
    const g = gruppen.get(id);
    g.anzahl++; g.anlaesse.add(k.anlass); for (const h of k.hinweis) g.hinweise.add(h);
    if (ms(k.zeit) > ms(g.zeit)) g.zeit = k.zeit;
  }
  return [...gruppen.values()]
    .filter(g => !gesehen.has(g.id) && !schonDa(vault, g))
    .sort((a, b) => b.anzahl - a.anzahl || ms(b.zeit) - ms(a.zeit))
    .slice(0, max);
}

export function vorschlagText(vault, g) {
  const name = basename(g.seite);
  const frage = g.stichwoerter.join(" ");
  const beob = [];
  if (g.anlaesse.has("ohne")) beob.push("kein Hinweis gezeigt, danach diese Seite gelesen");
  if (g.anlaesse.has("anders")) beob.push(`Hinweis zeigte ${[...g.hinweise].map(h => `\`${basename(h)}\``).join(", ")}, gelesen wurde diese Seite`);
  return {
    titel: `Frage zu ${name.replace(/\.md$/, "")}: „${frage}“`,
    text: [
      `Frage (Stichwörter aus einer echten Frage): „${frage}“`,
      `Seite: \`${g.seite}\``,
      `Beobachtet: ${g.anzahl}× — ${beob.join("; ")}.`,
      "",
      "Vorschlag: Diese Frage in deinen Worten als `fragen:`-Eintrag der Seite ergänzen (höchstens 6).",
      `Übernommene Paare kommen auch in die Messlatte: beim Ingest als positiv-Eintrag in \`${ordner(vault).wiki}/_messlatte.json\``,
      `(\`{ "prompt": "<Frage>", "erwartet": ["${name}"] }\`).`,
    ].join("\n"),
  };
}

function leseGesehen(vault) {
  try { return new Set(readFileSync(GESEHEN(vault), "utf8").split(/\r?\n/).filter(Boolean)); } catch { return new Set(); }
}
function schreibeGesehen(vault, set) {
  try {
    mkdirSync(dirname(GESEHEN(vault)), { recursive: true });
    const tmp = `${GESEHEN(vault)}.${process.pid}.tmp`;
    writeFileSync(tmp, [...set].slice(-MAX_GESEHEN).join("\n") + "\n");
    try { renameSync(tmp, GESEHEN(vault)); } catch { try { unlinkSync(tmp); } catch {} }
  } catch {}
}

export function faellig(vault, { jetzt = Date.now() } = {}) {
  try { return jetzt - statSync(WOCHE_MARKE(vault)).mtimeMs > WOCHE_MS; } catch { return true; }
}

// Einmal pro Woche (Marke .logs/lernschleife-woche): Vorschläge schreiben. Jedes Paar wird nur einmal vorgeschlagen
// (Merkliste aus Hashes, kein Klartext). → { status: "ok"|"nicht-faellig", vorschlaege: [ids] }
export function wochenLauf(vault, { jetzt = Date.now(), erzwingen = false } = {}) {
  if (!erzwingen && !faellig(vault, { jetzt })) return { status: "nicht-faellig", vorschlaege: [] };
  const gesehen = leseGesehen(vault);
  const liste = vorschlagsListe(vault, kandidaten(vault, { jetzt }), { gesehen });
  const ids = [];
  for (const g of liste) {
    try {
      const { titel, text } = vorschlagText(vault, g);
      ids.push(schreibeVorschlag(vault, { art: "pflege", befund: "frage", titel, text, ordner: "", sitzung: "lernschleife" }, new Date(jetzt)));
      gesehen.add(g.id);
    } catch { /* z. B. Secret-Fund → still verwerfen */ }
  }
  if (ids.length) schreibeGesehen(vault, gesehen);
  try {
    mkdirSync(dirname(WOCHE_MARKE(vault)), { recursive: true });
    writeFileSync(WOCHE_MARKE(vault), "");
    const d = new Date(jetzt); utimesSync(WOCHE_MARKE(vault), d, d);
  } catch {}
  return { status: "ok", vorschlaege: ids };
}

const selbst = fileURLToPath(import.meta.url);
let aufruf = "";
try { aufruf = realpathSync(process.argv[1] || ""); } catch {}
if (aufruf && aufruf === realpathSync(selbst)) {
  const vault = vaultPfad();
  if (process.argv.includes("--woche")) {
    const r = wochenLauf(vault);
    if (process.argv.includes("--json")) console.log(JSON.stringify(r));
    else if (r.status === "ok") console.log(`Lernschleife: ${r.vorschlaege.length} Vorschlag/Vorschläge „Frage → Seite“ geschrieben.`);
  } else {
    const liste = vorschlagsListe(vault, kandidaten(vault), { gesehen: leseGesehen(vault), max: 50 });
    if (process.argv.includes("--json")) console.log(JSON.stringify(liste.map(g => ({ stichwoerter: g.stichwoerter, seite: g.seite, anzahl: g.anzahl, anlaesse: [...g.anlaesse] }))));
    else if (!liste.length) console.log(wert(vault, "luecken")
      ? "Lernschleife: noch keine Kandidaten — es braucht Wissensfragen, nach denen die KI eine nicht genannte Wiki-Seite liest."
      : "Lernschleife: keine Kandidaten — der Schalter „Lücken merken“ ist aus, darum sammelt sie nichts.");
    else for (const g of liste) console.log(`${g.anzahl}× „${g.stichwoerter.join(" ")}“ → ${g.seite}`);
  }
}
