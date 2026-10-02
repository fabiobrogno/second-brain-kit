// .tools/import/notiz.mjs — Text-Bausteine für den Import: Normalisieren, Hash, Frontmatter, Titel, Links.
// Reine Funktionen ohne Dateizugriff.
import { createHash } from "node:crypto";
import { entferneBom } from "../pfade.mjs";

// Für den Duplikat-Vergleich: BOM weg, CRLF/CR → LF, Leerraum am Zeilenende weg, Leerzeilen am Ende weg.
export function normalisiereText(s) {
  return entferneBom(String(s)).replace(/\r\n?/g, "\n").replace(/[ \t\f\v]+$/gm, "").replace(/\n+$/, "");
}
export const sha256 = (daten) => createHash("sha256").update(daten).digest("hex");
export const textHash = (text) => sha256(normalisiereText(text));

// Notion hängt an jeden Namen „ <32 hex>“ an.
export const NOTION_HASH = /\s[0-9a-f]{32}$/i;
export const stamm = (rel) => String(rel).split("/").pop().replace(/\.[^.]*$/, "").replace(NOTION_HASH, "");

export function normTitel(s) {
  return String(s ?? "").normalize("NFC").toLowerCase().replace(NOTION_HASH, "").replace(/[_-]+/g, " ")
    .replace(/[^\p{L}\p{N} ]+/gu, " ").replace(/\s+/g, " ").trim();
}

const ohneQuotes = (v) => v.trim().replace(/^["']|["']$/g, "").trim();
function wertListe(v) {
  if (Array.isArray(v)) return v.map(ohneQuotes).filter(Boolean);
  const s = String(v ?? "").trim();
  if (!s) return [];
  if (s.startsWith("[") && s.endsWith("]")) return s.slice(1, -1).split(",").map(ohneQuotes).filter(Boolean);
  return s.split(",").map(ohneQuotes).filter(Boolean);
}

// Einfaches YAML-Frontmatter (key: wert, Listen als [a, b] oder „- a“-Zeilen). Rückgabe { felder, rumpf }.
export function frontmatter(text) {
  const t = entferneBom(String(text)).replace(/\r\n?/g, "\n");
  const m = t.match(/^---\n([\s\S]*?)\n---(?:\n|$)/);
  if (!m) return { felder: {}, rumpf: t };
  const felder = {};
  let letzter = null;
  for (const zeile of m[1].split("\n")) {
    const kv = zeile.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (kv) { letzter = kv[1].toLowerCase(); felder[letzter] = kv[2]; continue; }
    const li = zeile.match(/^\s+-\s+(.*)$/);
    if (li && letzter) {
      if (!Array.isArray(felder[letzter])) felder[letzter] = felder[letzter] ? [felder[letzter]] : [];
      felder[letzter].push(li[1]);
    }
  }
  return { felder, rumpf: t.slice(m[0].length) };
}

// Logseq-Eigenschaften „schluessel:: wert“ am Anfang der Seite.
function logseqEigenschaften(rumpf) {
  const out = {};
  for (const z of rumpf.split("\n")) {
    const m = z.match(/^\s*-?\s*([A-Za-z_][\w-]*)::\s*(.*)$/);
    if (m) out[m[1].toLowerCase()] = m[2];
    else if (z.trim()) break;
  }
  return out;
}

function datumAus(v) {
  const s = String(Array.isArray(v) ? v[0] : v ?? "").trim().replace(/^["']|["']$/g, "");
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return null;
}

const ZAUN = /`{3}[\s\S]*?`{3}/g;
const dekodiere = (s) => { try { return decodeURIComponent(s); } catch { return s; } };

// Analyse einer Notiz: Titel, Namen (für „gleiche Sache“), Aliase, Links, eingebettete Bilder, Datum aus Frontmatter.
export function analysiereNotiz(rel, text) {
  const { felder, rumpf } = frontmatter(text);
  const ls = logseqEigenschaften(rumpf);
  const aliase = [...wertListe(felder.aliases), ...wertListe(felder.alias), ...wertListe(ls.alias)];
  const fmTitel = felder.title ? ohneQuotes(String(Array.isArray(felder.title) ? felder.title[0] : felder.title)) : "";
  const titel = fmTitel || (ls.title ? ohneQuotes(ls.title) : "") || stamm(rel);
  const namen = new Set([stamm(rel), fmTitel, ls.title || "", ...aliase].map(normTitel).filter(Boolean));
  const code = rumpf.replace(ZAUN, "").replace(/`[^`\n]*`/g, "");
  const links = new Set(), bilder = [];
  for (const m of code.matchAll(/(!?)\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g)) {
    const ziel = m[2].trim();
    if (!ziel) continue;
    if (m[1]) bilder.push({ art: "wiki", ziel }); else links.add(ziel);
  }
  for (const m of code.matchAll(/(!?)\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)) {
    const ziel = dekodiere(m[2]);
    if (/^[a-z][a-z0-9+.-]*:/i.test(ziel)) continue;           // http:, mailto:, data: …
    if (m[1]) bilder.push({ art: "pfad", ziel });
    else if (/\.md$/i.test(ziel)) links.add(ziel);
  }
  const datum = datumAus(felder.updated ?? felder.aktualisiert ?? felder.modified ?? felder.date ?? felder.datum);
  return { titel, namen: [...namen], aliase, links: [...links], bilder, datum, rumpf };
}
