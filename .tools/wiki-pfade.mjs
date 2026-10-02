// Gemeinsame Pfadlogik für Indexer, Lint und Migration — eine Wahrheit für „was ist Wiki-Seite, was generiert,
// wohin zeigt ein Link". Pfade immer mit "/".
import { qmdPath } from "./qmd-pfad.mjs";

const teile = (rel) => String(rel).split(/[\\/]/);

export function istGeneriert(rel, wikiDir) {
  const p = teile(rel);
  if (p[0] !== wikiDir) return false;
  const name = p[p.length - 1];
  if (p.length === 2) return name === "_index.md";
  return name === `_${p[p.length - 2]}.md`;
}

export function istWikiSeite(rel, wikiDir) {
  const p = teile(rel);
  return p[0] === wikiDir && p.length >= 2 && !p[p.length - 1].startsWith("_") && p[p.length - 1].endsWith(".md");
}

// set: optional vorgebaut (Indexer/Lint rufen oft auf)
export function resolveLink(ids, link, wikiDir, set = new Set(ids)) {
  const l = String(link).trim().replace(/\.md$/, "");   // [[thema_x.md]] erlaubt (nur eine endständige Endung)
  for (const x of [l, l + ".md", `${wikiDir}/${l}.md`]) if (set.has(x)) return x;
  return ids.find(id => id.endsWith("/" + l + ".md") || id === l + ".md") || null;
}

const ZAUN = /`{3}[\s\S]*?`{3}/g;
export function wikilinks(text) {
  const ohneCode = String(text).replace(ZAUN, "").replace(/`[^`\n]*`/g, "");
  return [...ohneCode.matchAll(/\[\[([^\]|#]+)/g)].map(m => m[1].trim()).filter(Boolean);
}

export function doppelteNamen(ids, istSeite) {
  const gruppen = new Map();
  for (const id of ids) {
    const name = teile(id).pop();
    if (name.startsWith("_")) continue;
    const k = qmdPath(name);
    if (!gruppen.has(k)) gruppen.set(k, []);
    gruppen.get(k).push(id);
  }
  return [...gruppen.values()].filter(g => g.length > 1 && g.some(istSeite));
}
