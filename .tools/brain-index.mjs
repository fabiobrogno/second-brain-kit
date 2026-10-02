#!/usr/bin/env node
// Brain-Indexer: deterministisch, kein LLM. Nutzung: node brain-index.mjs [vaultPfad]
// Schreibt INDEX.md, graph.json, <wiki>/_index.md — atomar (tmp + rename), alphabetisch sortiert,
// KEINE Zeitstempel im Output (Determinismus). Exit 0 ok / 1 Fehler.
import { readFileSync, writeFileSync, renameSync, readdirSync, statSync, existsSync, mkdirSync, unlinkSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { qmdPath } from "./qmd-pfad.mjs";
import { saubereBegriffe, saubereAbschnitte, inhaltsBegriffe } from "./karten.mjs";
import { istGeneriert, istWikiSeite, resolveLink as loese } from "./wiki-pfade.mjs";
import { walk } from "./vault-dateien.mjs";
import { vaultPfad, ladeConfig, ordner } from "./pfade.mjs";

const vault = vaultPfad();
const cfg = ladeConfig(vault);
const { inbox: inboxDir, wiki: wikiDir } = ordner(vault, cfg);
const toSlash = (p) => p.split(sep).join("/");

function parseFile(f) {
  const raw = readFileSync(f.full, "utf8").replace(/\r\n/g, "\n"); // CRLF (Windows-Checkout) wie LF behandeln
  let fm = {}, body = raw;
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?/);
  if (m) {
    body = raw.slice(m[0].length);
    for (const line of m[1].split("\n")) {
      const kv = line.match(/^(\w[\w-]*):\s*(.*)$/);
      if (kv) fm[kv[1]] = kv[2].replace(/^["']|["']$/g, "");
    }
  }
  const title = (body.match(/^#\s+(.+)$/m) || [, f.rel.split(sep).pop().replace(/\.md$/, "")])[1].trim();
  const links = [...body.matchAll(/\[\[([^\]|#]+)/g)].map(x => x[1].trim())
    .concat([...body.matchAll(/\]\(([^)]+\.md)\)/g)].map(x => x[1].trim()));
  const tags = [...new Set([...body.matchAll(/(?:^|\s)#([\p{L}\d_-]{2,})/gu)].map(x => x[1]))].sort();
  const cluster = f.rel.split(sep)[0];
  return { id: f.rel, title, cluster, size: f.size, tags, links, fm };
}

const files = walk(vault, { wikiDir }).map(parseFile);
const byId = new Map(files.map(f => [f.id, f]));
const ids = files.map(f => toSlash(f.id)), idSet = new Set(ids);
const resolveLink = (l) => { const t = loese(ids, l, wikiDir, idSet); return t ? t.split("/").join(sep) : null; };
const edges = [];
for (const f of files) for (const l of f.links) { const t = resolveLink(l); if (t && t !== f.id) edges.push({ source: f.id, target: t }); }
edges.sort((a, b) => (a.source + a.target).localeCompare(b.source + b.target));

// Nur schreiben, wenn sich der Inhalt ändert — sonst verfälscht jede Session die mtime (Such-Refresh, Frische).
const atomic = (p, content) => {
  if (existsSync(p) && readFileSync(p, "utf8") === content) return;
  const t = `${p}.${process.pid}.tmp`; writeFileSync(t, content); renameSync(t, p);
};

// graph.json
const nodes = files.map(({ id, title, cluster, size, tags }) => ({ id, title, cluster, size, tags }));
atomic(join(vault, "graph.json"), JSON.stringify({ nodes, edges }, null, 2) + "\n");

// 09_wiki/_index.md — gruppiert nach Ordner, Links relativ zu 09_wiki
const arrOf = (v) => { try { const a = JSON.parse(v || "[]"); return Array.isArray(a) ? a : []; } catch { return []; } };
const wikiPages = files.filter(f => istWikiSeite(toSlash(f.id), wikiDir));
const ordnerVon = (p) => { const t = toSlash(p.id).split("/"); return t.length > 2 ? t.slice(1, -1).join("/") : "(oben)"; };
const push = (m, k, v) => { if (!m.has(k)) m.set(k, []); m.get(k).push(v); };
const gruppen = new Map();
for (const p of wikiPages) push(gruppen, ordnerVon(p), p);
const zeile = (p, ziel) => `- [${p.fm.name || p.title}](${ziel}) — ${p.fm.description || p.title} (${p.fm.typ || "?"})`;
const wikiIdx = ["# Wiki-Verzeichnis (generiert — nicht editieren)"];
for (const g of [...gruppen.keys()].sort()) {
  wikiIdx.push("", `## ${g}`);
  for (const p of gruppen.get(g)) wikiIdx.push(zeile(p, toSlash(p.id).slice(wikiDir.length + 1)));
}
atomic(join(vault, wikiDir, "_index.md"), wikiIdx.join("\n") + "\n");

// Je Ordner eine generierte Übersicht _<ordner>.md: eigene Seiten + Seiten, die per `auch` hierher zeigen
const ordnerSeiten = new Map(), ordnerAuch = new Map();
for (const p of wikiPages) {
  if (ordnerVon(p) !== "(oben)") push(ordnerSeiten, ordnerVon(p), p);
  // nur Ordnerpfade innerhalb des Wikis (kein "..", keine absoluten Pfade) — sonst schriebe die Übersicht nach außen
  for (const a of arrOf(p.fm.auch)) if (/^[\p{L}\d_-]+(\/[\p{L}\d_-]+)*$/u.test(a)) push(ordnerAuch, a, p);
}
const erzeugt = new Set();
for (const o of [...new Set([...ordnerSeiten.keys(), ...ordnerAuch.keys()])].sort()) {
  const dir = join(vault, wikiDir, ...o.split("/"));
  if (!existsSync(dir)) continue;
  const ziel = join(dir, `_${o.split("/").pop()}.md`);
  const rel = (p) => toSlash(relative(dir, join(vault, p.id)));
  const z = [`# ${o} (generiert — nicht editieren)`, ""];
  for (const p of (ordnerSeiten.get(o) || [])) z.push(zeile(p, rel(p)));
  const auch = (ordnerAuch.get(o) || []).filter(p => ordnerVon(p) !== o);
  if (auch.length) { z.push("", "## Auch relevant"); for (const p of auch) z.push(zeile(p, rel(p))); }
  atomic(ziel, z.join("\n") + "\n"); erzeugt.add(ziel);
}
// Verwaiste Übersichten (Ordner leer geworden) entfernen — robust gegen parallele Läufe (tmp-Dateien, ENOENT)
const aufraeumen = (dir) => {
  let eintraege = []; try { eintraege = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of eintraege) {
    if (e.name.includes(".tmp")) continue;
    const f = join(dir, e.name);
    if (e.isDirectory()) aufraeumen(f);
    else if (e.name !== "_index.md" && istGeneriert(toSlash(relative(vault, f)), wikiDir) && !erzeugt.has(f)) {
      try { unlinkSync(f); } catch (err) { if (err.code !== "ENOENT") throw err; }
    }
  }
};
aufraeumen(join(vault, wikiDir));

// .logs/wiki-map.json — Nachschlagetabelle für den Brain-Hinweis (QMD-Pfad → Datei, Quelle → Wiki-Seiten)
const wikiMap = { paths: {}, pages: {}, bySource: {} };
for (const f of files) wikiMap.paths[qmdPath(f.id)] = f.id.split(sep).join("/");
for (const p of wikiPages) {
  wikiMap.pages[p.id.split(sep).join("/")] = { name: p.fm.name || p.title, description: p.fm.description || p.title };
  for (const q of arrOf(p.fm.quellen)) (wikiMap.bySource[q] ||= []).push(p.id.split(sep).join("/"));
}
for (const k of Object.keys(wikiMap.bySource)) wikiMap.bySource[k].sort();
mkdirSync(join(vault, ".logs"), { recursive: true });

// .logs/hint-karten/ — eine kompakte Karteikarte je Wiki-Seite (Titel, Beschreibung, Abschnitte, Fettbegriffe).
// Eigene QMD-Sammlung „brainkarten": kurze, dichte Vektoren statt verwässerter Langseiten-Abschnitte.
const kartenDir = join(vault, ".logs", "hint-karten");
mkdirSync(kartenDir, { recursive: true });
const karten = new Set();
for (const p of wikiPages) {
  if (p.fm.typ === "ueberblick") continue;
  const name = p.id.split(sep).pop();
  const body = readFileSync(join(vault, p.id), "utf8").replace(/\r\n/g, "\n").replace(/^---\n[\s\S]*?\n---\n?/, "");
  const heads = saubereAbschnitte([...body.matchAll(/^#{2,3}\s+(.+)$/gm)].map(m => m[1].trim()));
  let bold = saubereBegriffe([...body.matchAll(/\*\*([^*]{2,60})\*\*/g)].map(m => m[1].trim())).slice(0, 40);
  // Dünne Karte (< 8 Begriffe, typ. Tabellen-/Listenseite) → Inhalte aus Tabellen und Listen ergänzen
  if (bold.length < 8) bold = [...new Set([...bold, ...inhaltsBegriffe(body)])].slice(0, 40);
  const karte = `# ${p.title}\n\n${p.fm.description || ""}\n\nAbschnitte: ${heads.join(" · ")}\n\nBegriffe: ${bold.join(" · ")}\n`;
  const ziel = join(kartenDir, name);
  atomic(ziel, karte);
  karten.add(name);
  wikiMap.paths[qmdPath(name)] = p.id.split(sep).join("/");
}
// Parallele Läufe (zweite Session, Lint) löschen dieselbe Waise → ENOENT ist hier kein Fehler.
for (const f of readdirSync(kartenDir)) if (f.endsWith(".md") && !karten.has(f)) {
  try { unlinkSync(join(kartenDir, f)); } catch (e) { if (e.code !== "ENOENT") throw e; }
}
atomic(join(vault, ".logs", "wiki-map.json"), JSON.stringify(wikiMap, null, 2) + "\n");

// INDEX.md — Katalog: 1 Zeile pro Ordner/wichtiger Datei, Archiv ausgeblendet
const lines = ["# INDEX (generiert — nicht editieren)", "", `Brain-First: Dieser Katalog wird ZUERST gelesen. Danach ${wikiDir}, dann Suche.`, ""];
const inbox = files.filter(f => f.cluster === inboxDir);
lines.push(`## ${inboxDir} — ${inbox.length} wartend`);
for (const f of inbox) lines.push(`- ${f.id} — ${f.title}`);
lines.push("", `## ${wikiDir} — ${wikiPages.length} Seiten (Details: ${wikiDir}/_index.md)`);
for (const c of (cfg.clusters || [])) {
  const cf = files.filter(f => f.cluster === c.id);
  lines.push("", `## ${c.id} — ${c.name} (${cf.length} Dateien)`);
  const dirs = new Map();
  for (const f of cf) {
    const parts = f.id.split(sep);
    const key = parts.length > 2 ? parts.slice(0, 2).join(sep) : f.id;
    dirs.set(key, (dirs.get(key) || 0) + 1);
  }
  for (const [key, n] of [...dirs.entries()].sort()) {
    const direct = byId.get(key);
    lines.push(direct ? `- ${key} — ${direct.title}` : `- ${key}/ (${n} Dateien)`);
  }
}
atomic(join(vault, "INDEX.md"), lines.join("\n") + "\n");
console.log(`brain-index: ${files.length} Dateien, ${edges.length} Kanten, ${wikiPages.length} Wiki-Seiten`);
