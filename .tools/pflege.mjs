#!/usr/bin/env node
// .tools/pflege.mjs — Pflegebericht (Spec v0.4, Baustein C): deterministisch, 0 Tokens, rein lesend.
// Je Posten: Zahl, Liste (höchstens 20) und der nächste Schritt in Alltagssprache. Posten (feste Reihenfolge):
//   abgelaufen, bald        Gültigkeit aus dem Frontmatter (gueltigkeit.mjs aus Task 1, sonst Rückfall unten)
//   konflikte               offene [!KONFLIKT]-Kästen (konflikte.mjs aus Task 1, sonst Rückfall-Zählung)
//   konflikteKaputt         unvollständige Kästen (A oder B fehlt) — der Ring im Gehirn hat so immer einen Eintrag
//   entscheidungen          Aufträge in <inbox>/_entscheidungen (entscheidungen.mjs)
//   vorschlaege             offene Vorschläge (vorschlaege.mjs)
//   lektionen               übernommene Lektionen in <inbox>/_lektionen, die noch eingetragen werden müssen
//   pflegeAuftraege         übernommene Pflege-Vorschläge in <inbox>/_pflege — Prüfaufträge, keine Quellen
//   verwaist                Wiki-Seiten ohne eingehenden Link (ohne ueberblick.md und ich.md)
//   nieGelesen              Seiten ohne Lesezugriff in 30 Tagen (nur, wenn es ein Werkzeug-Protokoll gibt)
//   luecken                 gemerkte Fragen ohne Treffer (nur mit Schalter `luecken`)
//   dubletten               gleicher normalisierter Titel oder Ähnlichkeit ≥ 0,8 (import/aehnlich.mjs)
//   zuLang                  Seiten > 150 Zeilen
//   importe                 Importe in <inbox>/_import, die noch nicht eingearbeitet sind
//   messlatte               Trend der Such-Messlatte (hint-eval.log): 1, wenn der letzte Lauf verfehlt/schlechter
// zuTun = Summe der Posten, die eine Handlung brauchen (ohne die reinen Hinweise bald, nieGelesen, luecken).
// CLI: node pflege.mjs [vault] [--json]   (brain pflege [--json])
//      node pflege.mjs [vault] --cache     (session-hintergrund: Cache .logs/pflege-bericht.json auffrischen, still)
import { readFileSync, readdirSync, lstatSync, existsSync, realpathSync, statSync, writeFileSync, renameSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import { vaultPfad, ladeConfig, ordner, entferneBom } from "./pfade.mjs";
import { walk } from "./vault-dateien.mjs";
import { istWikiSeite, resolveLink, wikilinks, doppelteNamen } from "./wiki-pfade.mjs";
import { gitBefehl } from "./werkzeug.mjs";
import { analyse } from "./analyse.mjs";
import { listeVorschlaege } from "./vorschlaege.mjs";
import { listeEntscheidungen, konflikteIn, entscheidungFuer } from "./entscheidungen.mjs";
import { findeGruppen } from "./import/aehnlich.mjs";
import { fingerabdruck, konfliktKaesten } from "./konflikte.mjs";
import { pruefeZufuehrungen, schreibeStatus } from "./zufuehrungen.mjs";
import { gesundheitswert, gesundheitText } from "./gesundheit.mjs";

const HIER = dirname(fileURLToPath(import.meta.url));
// Gültigkeit aus Task 1 — bis zum Merge (oder wenn das Modul fehlt) gilt der Rückfall gueltigkeitRueckfall.
const GUELTIGKEIT_MODUL = await import(pathToFileURL(join(HIER, "gueltigkeit.mjs")).href).catch(() => null);

export const POSTEN = ["abgelaufen", "bald", "konflikte", "konflikteKaputt", "entscheidungen", "vorschlaege", "lektionen", "pflegeAuftraege", "verwaist",
  "nieGelesen", "luecken", "dubletten", "zuLang", "importe", "zufuehrungen", "messlatte"];
const NUR_HINWEIS = new Set(["bald", "nieGelesen", "luecken"]);
// Schon von der Person entschieden bzw. beauftragt — wartet nur noch aufs Einarbeiten, braucht kein Zutun mehr.
export const BEAUFTRAGT = new Set(["pflegeAuftraege", "entscheidungen"]);
const MAX_LISTE = 20, MAX_ZEILEN = 150, BALD_TAGE = 14, TAG_MS = 86400000;

const SCHRITT = {
  abgelaufen: "Inhalt prüfen und aktualisieren — sag „prüf die abgelaufenen Seiten“; danach die Frist erneuern (neues pruefen_bis, bei verfall reicht ein neuer Commit).",
  bald: "Bald fällig — nichts Eiliges, beim nächsten Einarbeiten mitprüfen.",
  konflikte: "Im Gehirn unter „Pflege“ entscheiden, welche Aussage gilt.",
  konflikteKaputt: "Konflikt-Kasten unvollständig — A und B ergänzen oder den Kasten entfernen (sag „reparier die Konflikt-Kästen“).",
  entscheidungen: "Sag „arbeite die Entscheidungen ein“ — sie werden dann in den Quellen und im Wiki umgesetzt.",
  vorschlaege: "Im Gehirn unter „Vorschläge“ übernehmen oder verwerfen.",
  lektionen: "Sag „übernimm die Lektionen“ — sie werden dann an den richtigen Ort geschrieben.",
  pflegeAuftraege: "Sag „arbeite die Pflege-Aufträge ab“ — sie werden gegen die echten Quellen geprüft (ein Auftrag ist keine Quelle).",
  verwaist: "Von einer passenden Seite aus verlinken oder ins Archiv legen.",
  nieGelesen: "Nichts Eiliges — beim nächsten Review schauen, ob diese Seiten noch gebraucht werden.",
  luecken: "Zu diesen Fragen fehlt Wissen — eine Notiz dazu in die Inbox legen.",
  dubletten: "Prüfen und zusammenlegen — sag „leg die doppelten Seiten zusammen“.",
  zuLang: "Details in die Rohquelle verschieben oder die Seite aufteilen.",
  importe: "Sag „arbeite den Import ein“.",
  zufuehrungen: "Pfad, Rechte und Connector der Zuführung prüfen. Die Meldung verschwindet, sobald wieder Inhalt ankommt.",
  messlatte: "Die Suchqualität ist gesunken — beim nächsten Review die verfehlten Fragen ansehen („brain messlatte“).",
};
const NICHTS = "Nichts zu tun.";
const LABEL = {
  abgelaufen: ["abgelaufen", "abgelaufen"], bald: ["bald fällig", "bald fällig"], konflikte: ["Konflikt", "Konflikte"],
  konflikteKaputt: ["Konflikt-Kasten unvollständig", "Konflikt-Kästen unvollständig"],
  pflegeAuftraege: ["Pflege-Auftrag wartet", "Pflege-Aufträge warten"],
  entscheidungen: ["Entscheidung wartet", "Entscheidungen warten"], vorschlaege: ["Vorschlag", "Vorschläge"],
  lektionen: ["Lektion wartet", "Lektionen warten"], verwaist: ["verwaist", "verwaist"],
  nieGelesen: ["nie gelesen", "nie gelesen"], luecken: ["Lücke", "Lücken"], dubletten: ["Dublette", "Dubletten"],
  zuLang: ["zu lang", "zu lang"], importe: ["Import offen", "Importe offen"],
  zufuehrungen: ["Zuführung steht still", "Zuführungen stehen still"], messlatte: ["Messlatte gesunken", "Messlatte gesunken"],
};

// --- Gültigkeit: Rückfall, solange gueltigkeit.mjs (Task 1) fehlt — gleiche Regeln (pruefen_bis < heute oder
// Commit-Tag + `verfall` < heute = abgelaufen, in Kalendertagen; Frist in ≤ 14 Tagen = bald).
const tagNr = (j, m, t) => Math.round(Date.UTC(j, m - 1, t) / TAG_MS);
const lokalerTag = (ms) => { const d = new Date(ms); return tagNr(d.getFullYear(), d.getMonth() + 1, d.getDate()); };
const alsDatum = (nr) => new Date(nr * TAG_MS).toISOString().slice(0, 10);
function feld(fm, k) {
  const m = fm.match(new RegExp("^" + k + ":[ \\t]*(.*)$", "m"));
  return m ? m[1].replace(/\s+#.*$/, "").trim().replace(/^["']|["']$/g, "") : null;
}
function datumNr(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s ?? "").trim());
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3] ? tagNr(+m[1], +m[2], +m[3]) : null;
}
export function gueltigkeitRueckfall(fm, { letzterCommitMs = null, jetzt = Date.now() } = {}) {
  const heute = lokalerTag(jetzt);
  const k = [];
  const pb = datumNr(feld(fm, "pruefen_bis"));
  if (pb != null) k.push({ frist: pb, ueber: heute - pb, grund: "pruefen_bis" });
  const v = Number(feld(fm, "verfall"));
  if (Number.isInteger(v) && v > 0 && Number(letzterCommitMs) > 0) {
    const frist = lokalerTag(letzterCommitMs) + v; // Kalendertage wie gueltigkeit.mjs (W1-Review #10)
    k.push({ frist, ueber: heute - frist, grund: "verfall" });
  }
  if (!k.length) return { status: "ohne", pruefenBis: null, tageUeber: 0, grund: null };
  k.sort((a, b) => b.ueber - a.ueber || a.frist - b.frist);
  const s = k[0];
  return { status: s.ueber > 0 ? "abgelaufen" : -s.ueber <= BALD_TAGE ? "bald" : "ok", pruefenBis: alsDatum(s.frist), tageUeber: Math.max(0, s.ueber), grund: s.grund };
}
function gueltigkeit(fm, opts) {
  if (GUELTIGKEIT_MODUL && typeof GUELTIGKEIT_MODUL.gueltigkeit === "function") {
    try { return GUELTIGKEIT_MODUL.gueltigkeit(fm, opts); } catch { return { status: "ohne" }; }
  }
  return gueltigkeitRueckfall(fm, opts);
}

// Letzter Commit je Datei (ms) — EIN git-Aufruf, nur wenn eine Seite `verfall` trägt. Ohne git/Repo: leer.
function letzteCommits(vault, cfg) {
  const out = new Map();
  try {
    const roh = execFileSync(gitBefehl({ cfg }), ["-C", vault, "-c", "core.quotepath=false", "log", "--format=@%ct", "--name-only", "--relative"], {
      encoding: "utf8", maxBuffer: 256 << 20, stdio: ["ignore", "pipe", "ignore"], windowsHide: true,
      env: Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_"))),
    });
    let t = 0;
    for (const z of roh.split(/\r?\n/)) {
      if (z.startsWith("@")) { t = Number(z.slice(1)) * 1000; continue; }
      const f = z.trim();
      if (f && !out.has(f)) out.set(f, t);
    }
  } catch { /* kein git oder kein Repo */ }
  return out;
}

const normRel = (rel) => String(rel).split(sep).join("/");
// Nur Dateien, deren echter Pfad im echten Wiki liegt — Symlinks nach außen fließen nie ein (W1-Review #16).
function imEchtenWiki(vault, wikiOrdner) {
  const norm = (p) => { const f = String(p).split("\\").join("/").replace(/\/+$/, ""); return process.platform === "darwin" || process.platform === "win32" ? f.toLowerCase() : f; };
  let wikiEcht = null;
  try { wikiEcht = norm(realpathSync(join(vault, wikiOrdner))); } catch {}
  return (voll) => {
    if (!wikiEcht) return false;
    try { return norm(realpathSync(voll)).startsWith(wikiEcht + "/"); } catch { return false; }
  };
}
const frontmatterVon = (raw) => { const m = raw.match(/^---\n([\s\S]*?)\n---(?:\n|$)/); return m ? m[1] : ""; };
const rumpfVon = (raw) => raw.replace(/^---\n[\s\S]*?\n---(?:\n|$)/, "");
const titelNorm = (t) => String(t).normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

// Listeneinträge sind strukturiert (Felder statt fertiger deutscher Sätze), damit die Ansicht sie übersetzen kann
// (T6-Bedenken 2). Felder je Posten:
//   abgelaufen { seite, tage, frist, grund: "pruefen_bis"|"verfall" } · bald { seite, frist }
//   konflikte/konflikteKaputt { seite, anzahl } · entscheidungen { seite, konflikt, wahl } · vorschlaege { titel }
//   lektionen/pflegeAuftraege { name } · verwaist/nieGelesen { seite }
//   luecken { frage } · dubletten { seiten: [..], aehnlichkeit | null, grund: "aehnlich"|"titel" }
//   zuLang { seite, zeilen } · importe { quelle, notizen } · zufuehrungen { name, status, tage } · messlatte { datum, positiv, still, ok }
// Deutscher Text (CLI, KI-Eingabe des Pflege-Laufs): eintragText(schluessel, eintrag).
function posten(schluessel, eintraege, { anzahl = eintraege.length, schritt } = {}) {
  return {
    schluessel,
    anzahl,
    liste: eintraege.slice(0, MAX_LISTE),
    naechsterSchritt: schritt ?? (anzahl > 0 ? SCHRITT[schluessel] : NICHTS),
  };
}

const tageText = (n) => `${n} ${n === 1 ? "Tag" : "Tagen"}`;
const WAHL_DE = { a: "A gilt", b: "B gilt", beide: "beide gelten" };
export function eintragText(schluessel, e) {
  if (e == null || typeof e !== "object") return String(e ?? "");
  switch (schluessel) {
    case "abgelaufen": return e.grund === "verfall"
      ? `${e.seite} — seit ${tageText(e.tage)} (verfall, Frist ${e.frist})`
      : `${e.seite} — seit ${tageText(e.tage)} (prüfen bis ${e.frist})`;
    case "bald": return `${e.seite} — prüfen bis ${e.frist}`;
    case "konflikte": case "konflikteKaputt": return e.anzahl > 1 ? `${e.seite} (${e.anzahl})` : String(e.seite);
    case "entscheidungen": return `${e.seite} — Konflikt ${e.konflikt}: ${WAHL_DE[e.wahl] || e.wahl}`;
    case "vorschlaege": return String(e.titel ?? "");
    case "lektionen": case "pflegeAuftraege": return String(e.name ?? "");
    case "luecken": return String(e.frage ?? "");
    case "dubletten": return `${(e.seiten || []).join(" ↔ ")} (${e.grund === "titel" ? "gleicher Titel" : `Ähnlichkeit ${String(e.aehnlichkeit).replace(".", ",")}`})`;
    case "zuLang": return `${e.seite} (${e.zeilen} Zeilen)`;
    case "importe": return `${e.quelle} (${e.notizen} ${e.notizen === 1 ? "Notiz" : "Notizen"})`;
    case "zufuehrungen": return e.status === "fehlt" ? `${e.name} — Pfad fehlt`
      : e.status === "nicht-lesbar" ? `${e.name} — keine Leserechte`
      : e.status === "statusdatei" ? `${e.name} — .logs/zufuehrungen.json nicht schreibbar`
      : e.status === "config" ? `${e.name} — Eintrag unvollständig (pfad fehlt)`
      : `${e.name} — seit ${tageText(e.tage)} kein neuer Inhalt`;
    case "messlatte": return `${e.datum}: positiv ${e.positiv}, still ${e.still}${e.ok ? "" : " (unter Ziel)"}`;
    default: return e.seite ? String(e.seite) : JSON.stringify(e);
  }
}

// Reguläre .md-Dateien direkt in einem Inbox-Unterordner (kein Symlink-Ordner, keine Symlinks).
function mdIn(dir) {
  try {
    if (!lstatSync(dir).isDirectory()) return [];
    return readdirSync(dir).filter(n => n.endsWith(".md") && !n.startsWith(".")).filter(n => {
      try { return lstatSync(join(dir, n)).isFile(); } catch { return false; }
    }).sort();
  } catch { return []; }
}

function messlattePosten(verlauf) {
  if (!verlauf.length) return posten("messlatte", [], { anzahl: 0, schritt: "Noch keine Messung — einmal „brain messlatte“ ausführen." });
  const quote = (s) => { const [a, b] = String(s).split("/").map(Number); return b ? a / b : 0; };
  const letzter = verlauf[verlauf.length - 1], vorher = verlauf[verlauf.length - 2];
  const gesunken = !letzter.ok || (vorher && quote(letzter.positiv) < quote(vorher.positiv));
  const liste = verlauf.slice(-3).reverse().map(l => ({ datum: String(l.datum), positiv: String(l.positiv), still: String(l.still), ok: !!l.ok }));
  return posten("messlatte", liste, { anzahl: gesunken ? 1 : 0, schritt: gesunken ? SCHRITT.messlatte : "Suchqualität stabil — nichts zu tun." });
}

function zufuehrungenPosten(status) {
  const probleme = status.zufuehrungen.filter(z => z.status !== "ok").map(z => ({ name: z.name, status: z.status, tage: z.alterTage ?? 0 }));
  return posten("zufuehrungen", probleme);
}

export function pflegebericht(vault, { jetzt = Date.now() } = {}) {
  const jetztMs = jetzt instanceof Date ? jetzt.getTime() : Number(jetzt) || Date.now();
  const cfg = ladeConfig(vault);
  const o = ordner(vault, cfg);
  const dateien = walk(vault, { wikiDir: o.wiki });
  const ids = dateien.map(f => normRel(f.rel));
  const idSet = new Set(ids);
  const seiten = [];
  const echtImWiki = imEchtenWiki(vault, o.wiki);
  for (const f of dateien) {
    const id = normRel(f.rel);
    if (!istWikiSeite(id, o.wiki) || !echtImWiki(f.full)) continue;
    let raw = "";
    try { raw = entferneBom(readFileSync(f.full, "utf8")).replace(/\r\n?/g, "\n"); } catch { continue; }
    seiten.push({ id, raw, fm: frontmatterVon(raw), rumpf: rumpfVon(raw) });
  }
  seiten.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  // Gültigkeit
  const commits = seiten.some(s => /^verfall:/m.test(s.fm)) ? letzteCommits(vault, cfg) : new Map();
  const abgelaufen = [], bald = [];
  for (const s of seiten) {
    const g = gueltigkeit(`---\n${s.fm}\n---\n`, { letzterCommitMs: commits.get(s.id) ?? null, jetzt: jetztMs });
    // grund (pruefen_bis | verfall): bei verfall hilft ein neuer Commit, kein neues pruefen_bis (Final-Review #7)
    if (g.status === "abgelaufen") abgelaufen.push({ id: s.id, t: g.tageUeber, e: { seite: s.id, tage: g.tageUeber, frist: g.pruefenBis, grund: g.grund === "verfall" ? "verfall" : "pruefen_bis" } });
    else if (g.status === "bald") bald.push({ id: s.id, d: g.pruefenBis, e: { seite: s.id, frist: g.pruefenBis } });
  }
  abgelaufen.sort((a, b) => b.t - a.t || (a.id < b.id ? -1 : 1));
  bald.sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : a.id < b.id ? -1 : 1));

  // Konflikte — schon entschiedene (Auftrag wartet aufs Einarbeiten) zählen unter „entscheidungen“, nicht doppelt
  // Zuordnung über den Fingerabdruck der Aussagen, nicht über die Kasten-Nummer (W1-Review #5).
  const entscheidungen = listeEntscheidungen(vault);
  let konfliktZahl = 0;
  const konfliktListe = [];
  // Unvollständige Kästen (A oder B fehlt): eigener Posten, damit der Ring im Gehirn immer einen Eintrag hat
  // (Final-Review #3). Gleicher Parser wie die Ansicht (daten.mjs).
  let kaputtZahl = 0;
  const kaputtListe = [];
  for (const s of seiten) {
    const k = konflikteIn(s.raw).filter(x => !entscheidungFuer(entscheidungen, s.id, x)).length;
    if (k) { konfliktZahl += k; konfliktListe.push({ seite: s.id, anzahl: k }); }
    let kaputt = 0;
    if (/\[!KONFLIKT\]/i.test(s.raw)) { try { kaputt = konfliktKaesten(s.raw).kaputt || 0; } catch {} }
    if (kaputt) { kaputtZahl += kaputt; kaputtListe.push({ seite: s.id, anzahl: kaputt }); }
  }

  // Vorschläge, Lektionen
  const vorschlaege = listeVorschlaege(vault);
  const lektionen = mdIn(join(vault, o.inbox, "_lektionen"));
  const pflegeAuftraege = mdIn(join(vault, o.inbox, "_pflege"));

  // Verwaist: eingehende Wikilinks aus allen Notizen/Seiten (ohne „_“-Dateien wie _log/_schema)
  const verlinkt = new Set();
  const nachId = new Map(seiten.map(s => [s.id, s]));
  for (const f of dateien) {
    const id = normRel(f.rel);
    if (id.split("/").pop().startsWith("_")) continue;
    let text;
    const seite = nachId.get(id);
    if (seite) text = seite.rumpf;
    else { try { text = rumpfVon(entferneBom(readFileSync(f.full, "utf8")).replace(/\r\n?/g, "\n")); } catch { continue; } }
    for (const l of wikilinks(text)) {
      const z = resolveLink(ids, l, o.wiki, idSet);
      if (z && z !== id) verlinkt.add(z);
    }
  }
  const ausgenommen = new Set([`${o.wiki}/ueberblick.md`, `${o.wiki}/ich.md`]);
  const verwaist = seiten.map(s => s.id).filter(id => !verlinkt.has(id) && !ausgenommen.has(id));

  // Analyse (v0.3): nie gelesen, Lücken, Importe, Messlatten-Verlauf
  const a = analyse(vault, { tage: 30, jetzt: jetztMs });
  const habeProtokoll = existsSync(join(vault, ".logs", "werkzeug.log"));
  const nieGelesen = habeProtokoll ? a.seiten.nieGelesen : [];
  const luecken = Array.isArray(a.luecken) ? a.luecken.map(l => ({ frage: `${l.text}` })) : [];

  // Dubletten: gleicher normalisierter Titel ODER Inhalts-Ähnlichkeit ≥ 0,8
  const titelVon = (s) => ((s.rumpf.match(/^#\s+(.+)$/m) || [])[1] || feld(s.fm, "name") || s.id.split("/").pop().replace(/\.md$/, "")).trim();
  // Inhalt ohne die Titelzeile (der Titel wird getrennt verglichen)
  const notizen = seiten.map(s => ({ id: s.id, text: s.rumpf.replace(/^\s*#\s+.*$/m, ""), titelNorm: titelNorm(titelVon(s)) }));
  const gruppen = new Map(); // Schlüssel = sortierte IDs
  for (const g of findeGruppen(notizen, { schwelle: 0.8 })) {
    const d = [...g.dateien].sort();
    gruppen.set(d.join("\n"), { seiten: d, aehnlichkeit: Number(g.aehnlichkeit), grund: "aehnlich" });
  }
  const nachTitel = new Map();
  for (const n of notizen) { if (!n.titelNorm) continue; if (!nachTitel.has(n.titelNorm)) nachTitel.set(n.titelNorm, []); nachTitel.get(n.titelNorm).push(n.id); }
  for (const liste of nachTitel.values()) {
    if (liste.length < 2) continue;
    const d = [...liste].sort();
    if (!gruppen.has(d.join("\n"))) gruppen.set(d.join("\n"), { seiten: d, aehnlichkeit: null, grund: "titel" });
  }
  const dubletten = [...gruppen.entries()].sort((x, y) => (x[0] < y[0] ? -1 : 1)).map(([, t]) => t);

  // Zu lang
  const zuLang = seiten.map(s => ({ id: s.id, n: s.raw.split("\n").length })).filter(x => x.n > MAX_ZEILEN)
    .sort((x, y) => y.n - x.n || (x.id < y.id ? -1 : 1)).map(x => ({ seite: x.id, zeilen: x.n }));

  // Gesundheitswert (gesundheit.mjs): tote Links und doppelte Seitennamen zählen wie im Lint (brain-lint.mjs)
  let toteLinks = 0;
  for (const s of seiten) for (const l of wikilinks(s.rumpf)) if (!resolveLink(ids, l, o.wiki, idSet)) toteLinks++;
  const doppelteSeitennamen = doppelteNamen(ids, (id) => istWikiSeite(id, o.wiki)).length;
  const gesundheit = gesundheitswert({ toteLinks, widersprueche: konfliktZahl + kaputtZahl, doppelte: dubletten.length + doppelteSeitennamen,
    verwaist: verwaist.length, zuLang: zuLang.length });

  const importe = a.importe.map(i => ({ quelle: String(i.quelle), notizen: Number(i.notizen) || 0 }));

  const liste = [
    posten("abgelaufen", abgelaufen.map(x => x.e)),
    posten("bald", bald.map(x => x.e)),
    posten("konflikte", konfliktListe, { anzahl: konfliktZahl }),
    posten("konflikteKaputt", kaputtListe, { anzahl: kaputtZahl }),
    posten("entscheidungen", entscheidungen.map(e => ({ seite: e.seite, konflikt: e.konflikt, wahl: e.wahl }))),
    posten("vorschlaege", vorschlaege.map(v => ({ titel: String(v.titel ?? "") }))),
    posten("lektionen", lektionen.map(n => ({ name: n.replace(/\.md$/, "") }))),
    posten("pflegeAuftraege", pflegeAuftraege.map(n => ({ name: n.replace(/\.md$/, "") }))),
    posten("verwaist", verwaist.map(seite => ({ seite }))),
    posten("nieGelesen", nieGelesen.map(seite => ({ seite })), { schritt: habeProtokoll ? undefined : "Noch keine Lese-Daten (Werkzeug-Protokoll fehlt) — nichts zu tun." }),
    posten("luecken", luecken, { schritt: Array.isArray(a.luecken) ? undefined : "Lücken merken ist aus — nichts zu tun." }),
    posten("dubletten", dubletten),
    posten("zuLang", zuLang),
    posten("importe", importe),
    zufuehrungenPosten(pruefeZufuehrungen(vault, { jetzt: jetztMs, cfg })),
    messlattePosten(a.messlatte.verlauf || []),
  ];
  const zuTun = liste.filter(p => !NUR_HINWEIS.has(p.schluessel) && !BEAUFTRAGT.has(p.schluessel)).reduce((s, p) => s + p.anzahl, 0);
  const beauftragt = liste.filter(p => BEAUFTRAGT.has(p.schluessel)).reduce((s, p) => s + p.anzahl, 0);
  return { erstellt: new Date(jetztMs).toISOString().slice(0, 19) + "Z", posten: liste, zuTun, beauftragt, gesundheit };
}

// Kurzform eines Postens: „3 abgelaufen“, „1 Konflikt“
export function kurz(p) {
  const [ein, mehr] = LABEL[p.schluessel] || [p.schluessel, p.schluessel];
  return `${p.anzahl} ${p.anzahl === 1 ? ein : mehr}`;
}

// Wochen-Zeile für den Sitzungsstart (Task 3): nur Posten mit Handlungsbedarf, höchstens drei; "" wenn nichts zu tun.
// Ohne Vorschläge und Entscheidungen — die haben eigene Sitzungsstart-Zeilen (W1-Review #7). Übernommene
// Lektionen und Pflege-Aufträge haben keine eigene Zeile und stehen deshalb hier (Final-Review #4).
const EIGENE_ZEILE = new Set(["vorschlaege", "entscheidungen"]);
export function wochenZeile(bericht) {
  if (!bericht || !Array.isArray(bericht.posten)) return "";
  const teile = bericht.posten.filter(p => p.anzahl > 0 && !NUR_HINWEIS.has(p.schluessel) && !EIGENE_ZEILE.has(p.schluessel)).slice(0, 3).map(kurz);
  return teile.length ? `Brain-Woche: ${teile.join(" · ")} — im Gehirn unter Pflege` : "";
}

// ---------- Cache (W1-Review #6): der Bericht kostet bei großen Vaults Sekunden — der Sitzungsstart wartet nie darauf.
// session-hintergrund.mjs rechnet ihn losgelöst (CLI --cache) nach .logs/pflege-bericht.json; Sitzungsstart und
// Dienst lesen diese Datei. Neu gerechnet wird nur, wenn sich der Schlüssel ändert (Vault-Baum, Config, HEAD,
// Werkzeug-/Lint-Log, Kalendertag — datenSchluessel der Ansicht — plus Lücken- und Messlatten-Log).
export const BERICHT_CACHE = (vault) => join(vault, ".logs", "pflege-bericht.json");
export async function berichtSchluessel(vault) {
  const { datenSchluessel } = await import(pathToFileURL(join(HIER, "ansicht", "daten.mjs")).href);
  const mt = (p) => { try { const st = statSync(p); return `${st.mtimeMs}:${st.size}`; } catch { return "0"; } };
  return createHash("sha256").update([await datenSchluessel(vault), mt(join(vault, ".logs", "luecken.log")),
    mt(join(vault, ".logs", "hint-eval.log"))].join("|")).digest("hex");
}
export function leseBerichtCache(vault) {
  try {
    const j = JSON.parse(readFileSync(BERICHT_CACHE(vault), "utf8"));
    return j && j.bericht && Array.isArray(j.bericht.posten) ? j : null;
  } catch { return null; }
}
export function schreibeBerichtCache(vault, bericht, schluessel = null) {
  const ziel = BERICHT_CACHE(vault);
  mkdirSync(dirname(ziel), { recursive: true });
  const tmp = `${ziel}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify({ schluessel, bericht }) + "\n");
  renameSync(tmp, ziel);
}
// Bericht aus dem Cache, wenn der Schlüssel passt — sonst neu rechnen und den Cache schreiben.
export async function aktuellerBericht(vault, { jetzt = Date.now() } = {}) {
  let schluessel = null;
  try { schluessel = await berichtSchluessel(vault); } catch {}
  const c = leseBerichtCache(vault);
  if (c && schluessel && c.schluessel === schluessel) return mitFrischenZufuehrungen(vault, c.bericht, jetzt);
  const b = pflegebericht(vault, { jetzt });
  try { schreibeBerichtCache(vault, b, schluessel); } catch { /* nur Cache */ }
  return mitFrischenZufuehrungen(vault, b, jetzt);
}

// Zuführungen werden bei jedem Aufruf frisch geprüft (nur stat-Aufrufe, keine Tokens) — ein entzogenes Recht darf nicht
// bis zum nächsten Cache-Schlüsselwechsel unbemerkt bleiben. Schreibt die Statusdatei .logs/zufuehrungen.json; schlägt
// das fehl, steht das als Eintrag im Bericht (nie still).
function mitFrischenZufuehrungen(vault, bericht, jetzt) {
  const status = pruefeZufuehrungen(vault, { jetzt });
  let p = zufuehrungenPosten(status);
  try { schreibeStatus(vault, status); }
  catch (e) { p = { ...p, anzahl: p.anzahl + 1, liste: [...p.liste, { name: "Statusdatei", status: "statusdatei" }].slice(0, MAX_LISTE) }; }
  const alt = bericht.posten.find(x => x.schluessel === "zufuehrungen");
  const posten2 = bericht.posten.filter(x => x.schluessel !== "zufuehrungen");
  const i = posten2.findIndex(x => x.schluessel === "messlatte");
  posten2.splice(i < 0 ? posten2.length : i, 0, p);
  return { ...bericht, posten: posten2, zuTun: Math.max(0, (Number(bericht.zuTun) || 0) - (alt ? alt.anzahl : 0) + p.anzahl) };
}

// Offene Konflikte für die Ansicht, falls die Ansichtsdaten (daten.mjs, Task 1) keine `konflikte` liefern.
// → [{ seite, nr, a, b }] (ohne Task-1-Parser fehlen a/b).
export function offeneKonflikte(vault) {
  const o = ordner(vault);
  const echtImWiki = imEchtenWiki(vault, o.wiki);
  const out = [];
  for (const f of walk(vault, { wikiDir: o.wiki })) {
    const id = normRel(f.rel);
    if (!istWikiSeite(id, o.wiki) || !echtImWiki(f.full)) continue;
    let raw;
    try { raw = readFileSync(f.full, "utf8"); } catch { continue; }
    for (const k of konflikteIn(raw)) out.push({ seite: id, nr: k.nr, fp: k.fp, a: k.a ?? null, b: k.b ?? null });
  }
  return out;
}

// Konflikte für die Ansicht um die schon getroffene Wahl ergänzen: entschieden = "a"|"b"|"beide"|null, dazu die
// gespeicherte notiz (beim „Ändern“ vorbelegt, damit sie nicht still überschrieben wird). Zuordnung über den
// Fingerabdruck (fp) — fehlt er am Kasten, wird er aus a/b berechnet.
export function markiereEntschieden(vault, konflikte) {
  const liste = listeEntscheidungen(vault);
  return (Array.isArray(konflikte) ? konflikte : []).map(k => {
    const kasten = { nr: k.nr, fp: k.fp || (k.a && k.b ? fingerabdruck(k.a, k.b) : null) };
    const e = entscheidungFuer(liste, k.seite, kasten);
    return { ...k, fp: kasten.fp, entschieden: e ? e.wahl : null, notiz: e ? e.notiz || "" : "" };
  });
}

export function textBericht(b) {
  const z = [`Pflegebericht (${b.erstellt.slice(0, 10)}): ${b.zuTun === 0 ? "nichts zu tun." : `${b.zuTun} ${b.zuTun === 1 ? "Sache" : "Sachen"} zu tun.`}`
    + (b.beauftragt ? ` ${b.beauftragt} beauftragt — wird beim nächsten Einarbeiten erledigt.` : "")];
  for (const p of b.posten) {
    if (!p.anzahl) continue;
    z.push(`- ${kurz(p)}: ${p.liste.slice(0, 5).map(e => eintragText(p.schluessel, e)).join("; ")}${p.anzahl > 5 ? " …" : ""}`);
    z.push(`  → ${p.naechsterSchritt}`);
  }
  if (b.gesundheit) z.push(gesundheitText(b.gesundheit));
  return z.join("\n");
}

const selbst = fileURLToPath(import.meta.url);
let aufruf = "";
try { aufruf = realpathSync(process.argv[1] || ""); } catch {}
if (aufruf && aufruf === realpathSync(selbst)) {
  const vault = vaultPfad();
  try {
    // --cache (session-hintergrund): nur den Cache auffrischen, nichts ausgeben
    if (process.argv.includes("--cache")) { await aktuellerBericht(vault); process.exit(0); }
    const b = mitFrischenZufuehrungen(vault, pflegebericht(vault), Date.now());
    console.log(process.argv.includes("--json") ? JSON.stringify(b) : textBericht(b));
  } catch {
    console.error(`Pflegebericht nicht möglich — ist ${vault} wirklich ein Brain?`);
    process.exit(1);
  }
}
