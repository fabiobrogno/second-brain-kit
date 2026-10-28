// Reine Entscheidungslogik des Brain-Hinweises — kein LLM (Spec §3.2); IO nur existsSync für die Überblick-Zeile und
// der Kopf (≤ 4 KB) getroffener Seiten für die Gültigkeit. Testbar.
import { existsSync, openSync, readSync, closeSync } from "node:fs";
import { gueltigkeit } from "./gueltigkeit.mjs";
import { frischePruefen, widerspruchZeilen, vaultLeser } from "./frische.mjs";
import { join, dirname, basename } from "node:path";
import { homedir } from "node:os";
export function qmdToRel(file, map) {
  if (typeof file !== "string") return null;
  return map.paths[file.replace(/^qmd:\/\/[^/]+\//, "")] || null;
}

// Nur echte Fragen/Aufträge abfragen: keine Slash-Commands, keine Kurzantworten.
// Vom Werkzeug erzeugte Nachrichten (Agenten-Berichte, Aufgaben-Meldungen, System-Hinweise) sind keine Fragen der Person:
// nie durchsuchen, nie als Lücke merken.
export function istSystemNachricht(prompt) {
  const p = String(prompt || "").trimStart();
  return /^(<task-notification|<agent-message|<system-reminder|<bash-(input|stdout|stderr)|<local-command|<command-(name|message)|\[SYSTEM NOTIFICATION|\[Request interrupted|Another Claude session sent a message|Caveat: The messages below)/i.test(p);
}
export function shouldQuery(prompt) {
  const p = String(prompt || "").trim();
  if (!p || p.startsWith("/") || p.length < 15 || istSystemNachricht(p)) return false;
  return p.split(/\s+/).filter(w => /\p{L}{3,}/u.test(w)).length >= 3;
}
// Für die Lücken-Liste strenger als shouldQuery: nur echte Wissensfragen (Fragezeichen oder Fragewort am Anfang),
// keine Anweisungen wie „mach …“ oder Plaudersätze — sonst füllt sich die Liste mit Rauschen.
export function istWissensfrage(prompt) {
  const p = String(prompt || "").trim();
  if (!shouldQuery(p)) return false;
  if (/\?\s*$/.test(p) || /\?\s/.test(p)) return true;
  return /^(was|wie|wer|wo|wann|warum|wieso|weshalb|welche[rsmn]?|gibt es|kennst du|weißt du|what|how|who|where|when|why|which|is there|do you know)\b/i.test(p);
}

// Treffer über Schwelle → Wiki-Seiten (Rohquelle → zitierende Seite), dedupliziert, begrenzt.
export function decide(results, map, seen, { schwelle = 0.45, max = 2 } = {}) {
  const out = [];
  for (const r of Array.isArray(results) ? results : []) {
    if (!r || typeof r.score !== "number" || r.score < schwelle) continue;
    const rel = qmdToRel(r.file, map);
    if (!rel) continue;
    const pages = map.pages[rel] ? [rel] : (map.bySource[rel] || []);
    for (const page of pages) {
      if (seen.has(page) || out.some(o => o.page === page)) continue;
      out.push({ page, score: r.score, description: map.pages[page]?.description || "" });
      if (out.length >= max) return out;
    }
  }
  return out;
}

// Anzeigepfad: echter Vault (Home als ~ abgekürzt); ohne Vault nur der vault-relative Pfad.
export function anzeigePfad(vault, rel) {
  if (!vault) return rel;
  const v = String(vault).split("\\").join("/").replace(/\/+$/, ""), h = homedir().split("\\").join("/");
  return `${v === h || v.startsWith(h + "/") ? "~" + v.slice(h.length) : v}/${rel}`;
}
// Spec A: Treffer auf eine abgelaufene Seite tragen „(abgelaufen seit N Tagen)“ (~5 Tokens). Gelesen wird nur der
// Kopf der Seite und nur ausgewertet, wenn dort pruefen_bis steht. `verfall` braucht die Commit-Zeit (git) — die
// fragt der Hinweis-Hook bewusst nicht ab (Antwortzeit); solche Seiten bleiben hier ohne Zusatz (Lint/Gehirn zeigen es).
export function ablaufZusatz(vault, page, { jetzt = Date.now() } = {}) {
  if (!vault || typeof page !== "string" || !page.endsWith(".md")) return "";
  let kopf = "";
  try {
    const fd = openSync(join(vault, ...page.split("/")), "r");
    try { const b = Buffer.alloc(4096); kopf = b.subarray(0, readSync(fd, b, 0, 4096, 0)).toString("utf8"); }
    finally { closeSync(fd); }
  } catch { return ""; }
  // nur echtes Frontmatter — ein „pruefen_bis:“ im Seitentext zählt nicht (wie in der Ansicht)
  if (!/^\uFEFF?---\r?\n/.test(kopf) || !/^pruefen_bis:/m.test(kopf)) return "";
  const g = gueltigkeit(kopf, { jetzt });
  if (g.status !== "abgelaufen") return "";
  return ` (abgelaufen seit ${g.tageUeber} ${g.tageUeber === 1 ? "Tag" : "Tagen"})`;
}

// Neuere Fakten gewinnen: Treffer mit Widerspruch werden nach Datum geordnet, der Widerspruch bekommt eine Zeile.
// Nur mit Vault (liest die Treffer-Seiten); jeder Fehler → Treffer unverändert.
export function mitFrische(hits, vault) {
  if (!vault || hits.length < 2) return { hits, widersprueche: [] };
  try {
    const r = frischePruefen(hits.filter(h => !h.import), vaultLeser(vault));
    return { hits: r.treffer.concat(hits.filter(h => h.import)), widersprueche: r.widersprueche };
  } catch { return { hits, widersprueche: [] }; }
}

export function format(hits, { vault, jetzt = Date.now(), widersprueche = [] } = {}) {
  if (!hits.length) return "";
  let out = "Brain-Treffer (lokal, ungelesen — nur öffnen, wenn für die Aufgabe relevant):\n" +
    hits.map(h => `- ${anzeigePfad(vault, h.page)}${h.import ? "" : ablaufZusatz(vault, h.page, { jetzt })} — ${h.description.slice(0, 90)}`).join("\n");
  // Beide Treffer im selben Themenordner → dessen generierte Übersicht anbieten (nur wenn sie existiert)
  const ordner = [...new Set(hits.map(h => dirname(h.page)))];
  if (vault && hits.length >= 2 && ordner.length === 1 && ordner[0].split("/").length >= 3) {
    const uebersicht = `${ordner[0]}/_${basename(ordner[0])}.md`;
    if (existsSync(join(vault, uebersicht))) out += `\n- Überblick: ${anzeigePfad(vault, uebersicht)}`;
  }
  if (widersprueche.length) out += "\n" + widerspruchZeilen(widersprueche, (p) => anzeigePfad(vault, p)).join("\n");
  return out;
}

// Lange Prompts (eingefügte Logs/Texte): Anfang + Ende tragen die Frage, die Mitte meist nicht
export function suchtext(prompt, max = 500) {
  const p = String(prompt || "");
  return p.length <= max ? p : p.slice(0, 300) + " … " + p.slice(-(max - 303));
}

// Für das Log: Wie viele Seiten über Schwelle wurden nur verschwiegen, weil sie in dieser Session schon kamen?
export function countSuppressed(results, map, seen, { schwelle = 0.45 } = {}) {
  const hier = new Set();
  for (const r of Array.isArray(results) ? results : []) {
    if (!r || typeof r.score !== "number" || r.score < schwelle) continue;
    const rel = qmdToRel(r.file, map);
    if (!rel) continue;
    for (const page of map.pages[rel] ? [rel] : (map.bySource[rel] || [])) if (seen.has(page)) hier.add(page);
  }
  return hier.size;
}

// Kurze Anschlussfrage („und beim zweiten?") statt Bestätigung („ja bitte") — nur dann lohnt die vorige Frage als Kontext
const ANSCHLUSS = /^(und|aber|auch|oder|wie|was|welche[rsmn]?|wo|wann|warum|wieso|weshalb|wer|bei|beim|für|mit|ohne|gilt|geht|gibt)\b/i;
export function istFolgefrage(prompt) {
  const p = String(prompt || "").trim();
  if (!p || p.length >= 60 || p.startsWith("/") || p.split(/\s+/).length < 2) return false;
  return p.includes("?") || ANSCHLUSS.test(p);
}
