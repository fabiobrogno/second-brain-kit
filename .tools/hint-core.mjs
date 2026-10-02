// Reine Entscheidungslogik des Brain-Hinweises — kein LLM (Spec §3.2); IO nur existsSync für die Überblick-Zeile. Testbar.
import { existsSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { homedir } from "node:os";
export function qmdToRel(file, map) {
  if (typeof file !== "string") return null;
  return map.paths[file.replace(/^qmd:\/\/[^/]+\//, "")] || null;
}

// Nur echte Fragen/Aufträge abfragen: keine Slash-Commands, keine Kurzantworten.
export function shouldQuery(prompt) {
  const p = String(prompt || "").trim();
  if (!p || p.startsWith("/") || p.length < 15) return false;
  return p.split(/\s+/).filter(w => /\p{L}{3,}/u.test(w)).length >= 3;
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
export function format(hits, { vault } = {}) {
  if (!hits.length) return "";
  let out = "Brain-Treffer (lokal, ungelesen — nur öffnen, wenn für die Aufgabe relevant):\n" +
    hits.map(h => `- ${anzeigePfad(vault, h.page)} — ${h.description.slice(0, 90)}`).join("\n");
  // Beide Treffer im selben Themenordner → dessen generierte Übersicht anbieten (nur wenn sie existiert)
  const ordner = [...new Set(hits.map(h => dirname(h.page)))];
  if (vault && hits.length >= 2 && ordner.length === 1 && ordner[0].split("/").length >= 3) {
    const uebersicht = `${ordner[0]}/_${basename(ordner[0])}.md`;
    if (existsSync(join(vault, uebersicht))) out += `\n- Überblick: ${anzeigePfad(vault, uebersicht)}`;
  }
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
