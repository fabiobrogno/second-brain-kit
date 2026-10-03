#!/usr/bin/env node
// .tools/ansicht/daten.mjs — baut die Daten für die 3D-Ansicht (index.html) aus dem Vault. Liest nur;
// schreibt ausschließlich <vault>/.logs/ansicht/data.js (gitignored — nie ins getrackte .tools/ansicht/).
// Bereiche kommen aus brain.config.json (clusters), nicht aus festen Namen: jeder Cluster wird ein Bereich
// mit einer Hirnregion; dazu die festen Bereiche zentrum (Wiki ohne passenden Cluster), archiv, inbox.
// Nutzung: node .tools/ansicht/daten.mjs [vault]
import { readFileSync, writeFileSync, existsSync, mkdirSync, realpathSync, statSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { vaultPfad, ladeConfig, ordner, configFehler, entferneBom } from "../pfade.mjs";
import { walk } from "../vault-dateien.mjs";
import { wikilinks, resolveLink } from "../wiki-pfade.mjs";
import { gitBefehl } from "../werkzeug.mjs";
import { inventar, quellDateien } from "./mcp-inventar.mjs";
import { gueltigkeit } from "../gueltigkeit.mjs";
import { konfliktKaesten } from "../konflikte.mjs";
import { leseZeilen } from "../logs.mjs";

// MCP-Logos (Task 4, optional): Zuordnung `vendor/icons/zuordnung.json` + `iconFuer(name, zuordnung)` aus
// `icons-zuordnung.mjs`. Fehlt eins davon oder ist es kaputt, bekommt jeder MCP-Knoten `icon: null` (Monogramm).
const HIER = dirname(fileURLToPath(import.meta.url));
let iconFuer = null, iconZuordnung = null;
try {
  const modul = join(HIER, "icons-zuordnung.mjs"), tabelle = join(HIER, "vendor", "icons", "zuordnung.json");
  if (existsSync(modul) && existsSync(tabelle)) {
    const m = await import(pathToFileURL(modul).href);
    if (typeof m.iconFuer === "function") { iconZuordnung = JSON.parse(entferneBom(readFileSync(tabelle, "utf8"))); iconFuer = m.iconFuer; }
  }
} catch { iconFuer = null; iconZuordnung = null; }
export function mcpIcon(name, fn = iconFuer, zuordnung = iconZuordnung) {
  if (typeof fn !== "function" || !zuordnung) return null;
  try { const slug = fn(name, zuordnung); return typeof slug === "string" && slug ? slug : null; } catch { return null; }
}

// Bedeutung je Knoten: log(1+Verbindungen) + log(1+Lesezahl), auf das Maximum des Vaults normiert (0..1).
// Stufe 1/2/3 für die Knotengröße der Ansicht: ab 2/3 → 3, ab 1/3 → 2, sonst 1.
export function bedeutungen(knoten) {
  const roh = knoten.map((k) => Math.log1p(Math.max(0, k.verbindungen || 0)) + Math.log1p(Math.max(0, k.lesezahl || 0)));
  const max = Math.max(0, ...roh);
  return roh.map((r) => {
    const b = max > 0 ? Math.round((r / max) * 1000) / 1000 : 0;
    return { bedeutung: b, bedeutungStufe: b >= 2 / 3 ? 3 : b >= 1 / 3 ? 2 : 1 };
  });
}
export const MCP_GRUPPE = (name, quellen = []) => /^claude_ai_/i.test(name) ? "Claude.ai" : (quellen[0] || null);

export const REGIONEN = ["frontal", "temporal", "parietal", "tief", "okzipital"];
export const FARBEN = ["blau", "orange", "gruen", "gelb", "rot", "lila", "grau", "tuerkis"];
const TYPE_LABEL = { thema: "Thema", entitaet: "Steckbrief", quelle: "Quelle", synthese: "Synthese", ueberblick: "Überblick", notiz: "Notiz" };

// Vergleichsform für Ordner-/Clusternamen: klein, ohne Umlaute, ohne Ziffernpräfix („40_persoenlich“ → „persoenlich“)
export const normName = (s) => String(s || "").normalize("NFC").toLowerCase().replace(/^\d+_/, "")
  .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss").trim();

// Bereiche aus der Config: Cluster in Reihenfolge → Regionen (zyklisch ab dem 6. Cluster), überschreibbar per
// cfg.ansicht.regionen = { <clusterId>: "<region>" }. Farben aus cluster.farbe, sonst aus der festen Palette —
// je Regionen-Runde um eins versetzt, damit das Paar (Farbe, Region) bis 25 Cluster eindeutig bleibt.
// warnungen (optional): sammelt doppelte und reservierte Cluster-IDs (werden übersprungen).
export function bereiche(cfg = {}, warnungen = []) {
  const fest = new Set(["zentrum", "archiv", "inbox"]);
  const ueber = cfg.ansicht?.regionen || {};
  const gesehen = new Set(), clusters = [];
  for (const c of Array.isArray(cfg.clusters) ? cfg.clusters : []) {
    if (!c || typeof c.id !== "string" || !c.id) continue;
    if (fest.has(c.id)) { warnungen.push(`Cluster „${c.id}“ hat einen reservierten Namen (zentrum/archiv/inbox) — er wird in der Ansicht übersprungen.`); continue; }
    if (gesehen.has(c.id)) { warnungen.push(`Cluster „${c.id}“ steht doppelt in brain.config.json — der zweite Eintrag wird übersprungen.`); continue; }
    gesehen.add(c.id); clusters.push(c);
  }
  const areas = clusters.map((c, i) => ({
    id: c.id,
    name: typeof c.name === "string" && c.name ? c.name : c.id.replace(/^\d+_/, ""),
    farbe: FARBEN.includes(c.farbe) ? c.farbe : FARBEN[(i + Math.floor(i / REGIONEN.length)) % 5],
    region: REGIONEN.includes(ueber[c.id]) ? ueber[c.id] : REGIONEN[i % REGIONEN.length],
  }));
  areas.push({ id: "zentrum", name: "Überblick", farbe: "neutral", region: "tief" });
  areas.push({ id: "archiv", name: "Archiv", farbe: "grau", region: "kleinhirn" });
  areas.push({ id: "inbox", name: "Inbox", farbe: "lila", region: "wolke" });
  return areas;
}

function frontmatter(raw) {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?/);
  const fm = m ? m[1] : "";
  const str = (k) => (fm.match(new RegExp("^" + k + ":\\s*(.+)$", "m")) || [])[1]?.trim().replace(/^["']|["']$/g, "");
  const arr = (k) => { const a = fm.match(new RegExp("^" + k + ":\\s*\\[([^\\]]*)\\]", "m")); return a ? a[1].split(",").map((s) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean) : []; };
  // Rohe description wie .tools/minisuche.mjs (Suchgewicht ×3 in suche.js): bei mehreren Zeilen gilt die LETZTE,
  // getrimmt, umschließende Anführungszeichen weg; fehlt sie: "".
  let beschreibung = "";
  for (const zeile of fm.split("\n")) {
    const kv = zeile.match(/^description:\s*(.*)$/);
    if (kv) beschreibung = kv[1].trim().replace(/^["']|["']$/g, "");
  }
  return { body: m ? raw.slice(m[0].length) : raw, str, arr, beschreibung };
}
function ersterAbsatz(body) {
  const paras = body.split(/\n\s*\n/).map((p) => p.split("\n").map((l) => l.trim()).filter((l) => l && !/^#|^```|^\||^---/.test(l)).map((l) => l.replace(/^[-*>]\s+/, "")).join(" ")).filter(Boolean);
  const pick = paras.find((p) => !/^(Quelle|Quellen|Stand|Geprüft|Status)\b/i.test(p) && p.length > 40) || paras[0] || "";
  let s = pick.replace(/\[\[([^\]|]+)\|?([^\]]*)\]\]/g, (_, a, b) => b || a).replace(/\*\*|__|`/g, "").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
  if (s.length > 240) s = s.slice(0, 237).replace(/\s+\S*$/, "") + " …";
  return s;
}

// Reine Datenaufbereitung — liest nur, schreibt nie. `erzeugeAnsichtsDaten` (unten) nutzt dies und schreibt
// zusätzlich <vault>/.logs/ansicht/data.js. Der Dienst (Task 1, `./dienst.mjs`) ruft NUR diese Funktion auf.
export function baueAnsichtsDaten(vault, { jetzt = Date.now() } = {}) {
  // Tippfehler im Pfad darf nie still einen Ordnerbaum anlegen — klare Meldung statt leerem Gehirn
  let istOrdner = false; try { istOrdner = statSync(vault).isDirectory(); } catch {}
  if (!istOrdner) throw new Error(`Brain-Ordner nicht gefunden: ${vault} — bitte den Pfad prüfen.`);
  const warnungen = [];
  const cf = configFehler(vault);
  if (cf) warnungen.push(`brain.config.json ist kaputt (${cf}) — ich nutze die Standard-Einstellungen, Bereiche können fehlen.`);
  const cfg = ladeConfig(vault);
  const o = ordner(vault, cfg);
  const areas = bereiche(cfg, warnungen);
  const clusterAreas = areas.filter(a => !["zentrum", "archiv", "inbox"].includes(a.id));
  const clusterIds = new Set(clusterAreas.map(a => a.id));
  const vorlagenDir = cfg.ordner?.vorlagen;
  const istVorlage = (top) => top === vorlagenDir || /^(\d+_)?vorlagen$/i.test(top);

  // Dateien wie Indexer/Lint (vault-dateien.mjs: ohne Punkt-Pfade, generierte Dateien, .brainignore), zusätzlich
  // ohne Vorlagen-Ordner und ohne Wiki-Systemseiten (_log.md, _schema.md, …)
  const dateien = walk(vault, { wikiDir: o.wiki });
  // Nur Dateien, deren echter Pfad im echten Vault liegt (Wiki-Seiten: im echten Wiki) — Symlinks nach außen
  // fließen weder in Knoten noch in Konflikte ein (W1-Review #16).
  const normP = (x) => { const f = String(x).split("\\").join("/").replace(/\/+$/, ""); return process.platform === "darwin" || process.platform === "win32" ? f.toLowerCase() : f; };
  let vaultEcht = null, wikiEcht = null;
  try { vaultEcht = normP(realpathSync(vault)); } catch {}
  try { wikiEcht = normP(realpathSync(join(vault, o.wiki))); } catch {}
  const echtDrin = (voll, imWiki) => {
    const basis = imWiki ? wikiEcht : vaultEcht;
    if (!basis) return false;
    try { return normP(realpathSync(voll)).startsWith(basis + "/"); } catch { return false; }
  };
  const files = [];
  for (const f of dateien) {
    const id = f.rel.split(/[\\/]/).join("/"), p = id.split("/");
    if (p.length > 1 && istVorlage(p[0])) continue;
    if (p[0] === o.wiki && p[p.length - 1].startsWith("_")) continue;
    if (!echtDrin(f.full || join(vault, ...p), p[0] === o.wiki)) continue;
    files.push({ ...f, id, p });
  }
  const ids = files.map(f => f.id), idSet = new Set(ids);
  // BOM weg (Windows PowerShell 5.1 schreibt UTF-8 mit BOM), sonst gilt das Frontmatter als Text
  const rd = (rel) => entferneBom(readFileSync(join(vault, ...rel.split("/")), "utf8")).replace(/\r\n/g, "\n");

  const wikiBereich = (seg) => {
    const n = normName(seg);
    const c = clusterAreas.find(a => normName(a.id) === n || normName(a.name) === n);
    return c ? c.id : "zentrum";
  };
  const areaOf = (p) => {
    if (p[0] === o.wiki) return p.length > 2 ? wikiBereich(p[1]) : "zentrum";
    if (p.length > 1 && p[0] === o.inbox) return "inbox";
    if (p.length > 1 && p[0] === o.archiv) return "archiv";
    if (p.length > 1 && clusterIds.has(p[0])) return p[0];
    return "zentrum";
  };
  const groupOf = (p) => {
    if (p[0] === o.wiki) return p.length > 3 ? p[1] + "/" + p[2] : p.length > 2 ? p[1] : "zentrum";
    const f = p[p.length - 1].replace(/^\d{4}-\d{2}-\d{2}_/, "").replace(/\.md$/, "");
    return (p.length > 1 ? p[0] : "") + "/" + f.split("-")[0];
  };

  // git (nur lesend): erstes Hinzufügen + letzte Änderung je Datei. Ohne git/Repo: keine Zeitleiste.
  const added = {}, changed = {}, changedMs = {};
  if (files.length) {
    try {
      const out = execFileSync(gitBefehl({ cfg }), ["-C", vault, "-c", "core.quotepath=false", "log", "--format=@%as %ct", "--name-only", "--relative"],
        // ohne GIT_*-Umgebung (im pre-commit gesetzt): -C vault soll das Repo des Vaults lesen, kein fremdes
        { encoding: "utf8", maxBuffer: 256 << 20, stdio: ["ignore", "pipe", "ignore"], windowsHide: true,
          env: Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_"))) });
      let d = null, ms = 0;
      for (const line of out.split(/\r?\n/)) {
        if (line.startsWith("@")) { const [tag, ct] = line.slice(1).split(" "); d = tag; ms = Number(ct) * 1000 || 0; continue; }
        const f = line.trim(); if (!f || !idSet.has(f)) continue;
        if (!changed[f]) { changed[f] = d; changedMs[f] = ms; } // neuester zuerst
        added[f] = d;                     // ältester zuletzt
      }
    } catch { /* kein git oder kein Repo */ }
  }

  // Lint-Befunde aus dem Cache (optional)
  const lintConflict = new Set(), lintReview = new Set();
  const lintCache = join(vault, ".logs", "lint-cache.txt");
  if (existsSync(lintCache)) {
    // "- <ART>: <pfad> — <grund>": Pfad darf Leerzeichen tragen, unter Windows mit "\\" geschrieben
    const mitWiki = (s) => { const p = s.trim().split("\\").join("/"); return p.startsWith(o.wiki + "/") ? p : o.wiki + "/" + p; };
    let roh = ""; try { roh = readFileSync(lintCache, "utf8"); } catch {}
    for (const l of roh.split(/\r?\n/)) {
      const k = l.match(/^- KONFLIKT[^:]*:\s*(.+?)(?: — |$)/); if (k) lintConflict.add(mitWiki(k[1]));
      const r = l.match(/^- PRÜFBEDÜRFTIG[^:]*:\s*(.+?)(?: — |$)/); if (r) lintReview.add(mitWiki(r[1]));
    }
  }

  // Lesezahl der letzten 30 Tage aus dem Werkzeug-Protokoll (art=lesen: Vault-Pfad, art=mcp: "<server>/<werkzeug>")
  const lesen = new Map(), mcpAufrufe = new Map();
  for (const z of leseZeilen(join(vault, ".logs", "werkzeug.log"), { seitMs: jetzt - 30 * 86400000 })) {
    if (typeof z.ziel !== "string") continue;
    if (z.art === "lesen") lesen.set(z.ziel, (lesen.get(z.ziel) || 0) + 1);
    else if (z.art === "mcp") { const s = z.ziel.split("/")[0]; mcpAufrufe.set(s, (mcpAufrufe.get(s) || 0) + 1); }
  }
  const alleKonflikte = [];

  const sha16 = (rel) => createHash("sha256").update(readFileSync(join(vault, ...rel.split("/")))).digest("hex").slice(0, 16);
  const nodes = [], links = new Map();
  const mcpFrontmatter = new Map(); // Seiten-ID → [Servername, …] (Frontmatter `mcp: [..]`)
  const aufgeloest = new Map(); // Link-Text → Seiten-ID|null (hängt nicht von der Quellseite ab)
  const loese = (l) => { if (!aufgeloest.has(l)) aufgeloest.set(l, resolveLink(ids, l, o.wiki, idSet)); return aufgeloest.get(l); };
  for (const f of files) {
    let raw = ""; try { raw = rd(f.id); } catch {}
    const { body, str, arr, beschreibung } = frontmatter(raw);
    const isWiki = f.p[0] === o.wiki;
    const typ = isWiki ? (str("typ") || "thema").split("|")[0] : "notiz";
    const quellen = arr("quellen"), shas = arr("quellen_sha");
    const pruef = [];
    quellen.forEach((q, i) => { try { if (shas[i] && idSet.has(q) && sha16(q) !== shas[i]) pruef.push(q); } catch {} });
    // Knotenzahl aus demselben Parser wie die Entscheidungsliste (W1-Review #13): ein Ring im Gehirn hat immer
    // einen Eintrag zum Entscheiden; unvollständige Kästen (A oder B fehlt) zählen getrennt als „kaputt“.
    const kaesten = /\[!KONFLIKT\]/i.test(raw) ? konfliktKaesten(raw) : { konflikte: [], kaputt: 0 };
    const konflikte = kaesten.konflikte.length, konflikteKaputt = kaesten.kaputt;
    if (isWiki) for (const k of kaesten.konflikte) alleKonflikte.push({ seite: f.id, nr: k.nr, fp: k.fp, zeile: k.zeile, a: k.a, b: k.b });
    // Gültigkeit nur aus dem Frontmatter — ohne Frontmatter zählt ein „pruefen_bis:“ im Text nicht (W1-Review #12)
    const g = gueltigkeit(raw.startsWith("---\n") ? raw : "", { letzterCommitMs: changedMs[f.id] || null, jetzt });
    const statusLine = /als PRÜFBEDÜRFTIG behandeln|Status:\s*\*\*nicht bestätigt/.test(raw);
    const status = konflikte || konflikteKaputt || lintConflict.has(f.id) ? "konflikt" : (pruef.length || lintReview.has(f.id) || statusLine) ? "pruef" : "ok";
    const name = f.p[f.p.length - 1].replace(/\.md$/, "");
    const titel = ((body.match(/^#\s+(.+)$/m) || [])[1] || str("name") || name).trim().replace(/\s+[–—-]\s+geprüft \d{2}\.\d{2}\.\d{4}$/, "");
    const wl = wikilinks(body);
    links.set(f.id, wl.concat([...body.matchAll(/\]\(([^)]+\.md)\)/g)].map(x => x[1].trim())));
    // Wiki-Link-Ziele für das Panel mit derselben Auflösung wie die Kanten (resolveLink) — app.js schlägt hier nach.
    // Ohne Prototyp: ein Link „__proto__“ wird ein normaler Schlüssel.
    const linkZiele = Object.create(null);
    for (const l of wl) { const z = loese(l); if (z) linkZiele[l] = z; }
    const mcpRefs = arr("mcp");
    if (mcpRefs.length) mcpFrontmatter.set(f.id, mcpRefs);
    nodes.push({
      id: f.id, name, title: titel, area: areaOf(f.p), group: groupOf(f.p), wiki: isWiki, type: typ, typeLabel: TYPE_LABEL[typ] || typ,
      desc: beschreibung || ersterAbsatz(body), beschreibung, linkZiele, size: f.size,
      rev: Number(str("rev")) || null, quellen: quellen.filter((q) => idSet.has(q)), usedIn: [],
      body: body.replace(/^\s+/, ""),
      added: added[f.id] || null, changed: changed[f.id] || null, status,
      statusNote: konflikte ? `${konflikte} offene${konflikte > 1 ? "" : "r"} Konflikt` : konflikteKaputt ? `${konflikteKaputt} unvollständige${konflikteKaputt > 1 ? "" : "r"} Konflikt-Kasten (A oder B fehlt)` : pruef.length ? `Quelle geändert seit Einarbeitung: ${pruef.join(", ")}` : statusLine ? "Seite ist als nicht bestätigt markiert" : null,
      gueltigkeit: g.status, pruefenBis: g.pruefenBis, stand: g.stand, konflikte, konflikteKaputt, lesezahl: lesen.get(f.id) || 0,
    });
  }
  const byId = new Map(nodes.map(n => [n.id, n]));
  for (const n of nodes) if (n.wiki) for (const q of n.quellen) byId.get(q)?.usedIn.push(n.id);
  for (const n of nodes) n.usedIn.sort();

  // MCP-Server: aus Client-Configs + Werkzeug-Log (nur Namen — nie command/args/env/url/headers), Bereich
  // "werkzeuge" nur wenn ≥ 1 Server und nicht per cfg.ansicht.mcp === false abgeschaltet.
  const mcpServer = cfg.ansicht?.mcp === false ? [] : inventar(vault).server;
  if (mcpServer.length) {
    areas.push({ id: "werkzeuge", name: "Werkzeuge", farbe: "tuerkis", region: "hirnstamm" });
    for (const s of mcpServer) {
      nodes.push({
        id: `mcp:${s.name}`, name: s.name, title: s.name, area: "werkzeuge", group: s.quellen[0] || "mcp",
        wiki: false, type: "mcp", typeLabel: "MCP",
        desc: s.quellen.join(", ") + (s.benutzt ? ` · ${s.benutzt}×` : ""), beschreibung: "", linkZiele: Object.create(null),
        size: 0, rev: null, quellen: [], usedIn: [], body: "",
        added: null, changed: s.zuletzt || null, status: "ok", statusNote: null,
        gueltigkeit: "ohne", pruefenBis: null, stand: null, konflikte: 0, konflikteKaputt: 0, lesezahl: mcpAufrufe.get(s.name) || 0,
        gruppe: MCP_GRUPPE(s.name, s.quellen), icon: mcpIcon(s.name),
      });
    }
  }

  const key = new Set(), edges = [];
  const edgeIds = new Set(nodes.map(n => n.id));
  const addEdge = (s, t, kind) => { if (!edgeIds.has(s) || !edgeIds.has(t) || s === t) return; const k = [s, t].sort().join("|") + kind; if (key.has(k)) return; key.add(k); edges.push({ s, t, kind }); };
  for (const n of nodes) if (links.has(n.id)) for (const l of links.get(n.id)) addEdge(n.id, loese(l), "link");
  for (const n of nodes) for (const q of n.quellen) addEdge(n.id, q, "quelle");
  // MCP-Kanten: explizit per Frontmatter `mcp: [..]`, sonst Namensgleichheit (normalisierter Servername ist
  // Teil des normalisierten Seitennamens, ab 4 Zeichen — kürzere Namen wären zu unspezifisch).
  if (mcpServer.length) {
    for (const [seite, refs] of mcpFrontmatter) for (const ref of refs) addEdge(seite, `mcp:${ref}`, "mcp");
    for (const s of mcpServer) {
      const n = normName(s.name);
      if (n.length < 4) continue;
      for (const f of files) if (normName(f.p[f.p.length - 1].replace(/\.md$/, "")).includes(n)) addEdge(f.id, `mcp:${s.name}`, "mcp");
    }
  }

  // Bedeutung aus Verbindungen (alle Kantenarten, je Knoten gezählt) + Lesezahl
  const grad = new Map();
  for (const e of edges) { grad.set(e.s, (grad.get(e.s) || 0) + 1); grad.set(e.t, (grad.get(e.t) || 0) + 1); }
  const bd = bedeutungen(nodes.map((n) => ({ verbindungen: grad.get(n.id) || 0, lesezahl: n.lesezahl })));
  nodes.forEach((n, i) => { n.bedeutung = bd[i].bedeutung; n.bedeutungStufe = bd[i].bedeutungStufe; });

  const dates = nodes.map((n) => n.added).filter(Boolean).sort();
  const daten = {
    built: new Date().toISOString().slice(0, 10), first: dates[0] || null, last: dates[dates.length - 1] || null,
    areas, nodes, edges, inbox: nodes.filter(n => n.area === "inbox").length,
    mcp: mcpServer, konflikte: alleKonflikte, warnungen,
  };
  // Oberflächensprache aus der Config (nur "de"/"en"; sonst entscheidet die Ansicht selbst)
  const sprache = cfg.ansicht?.sprache;
  if (sprache === "de" || sprache === "en") daten.sprache = sprache;
  return daten;
}

export function erzeugeAnsichtsDaten(vault) {
  const data = baueAnsichtsDaten(vault);
  const dir = join(vault, ".logs", "ansicht");
  mkdirSync(dir, { recursive: true });
  const pfad = join(dir, "data.js");
  // "</" maskieren: die Datei wird per <script> geladen, Seiteninhalt darf das Script-Tag nie schließen
  writeFileSync(pfad, "// generiert von .tools/ansicht/daten.mjs — nicht von Hand ändern\nwindow.BRAIN_DATA = " + JSON.stringify(data).replace(/<\//g, "<\\/") + ";\n");
  return { pfad, seiten: data.nodes.length, verbindungen: data.edges.length, warnungen: data.warnungen };
}

// Fingerabdruck des Vault-Baums: rekursives Verzeichnis-Listing (relativer Pfad + mtime + Größe je Datei,
// mtime je Ordner) — erkennt Anlegen, Ändern, Löschen, Umbenennen und Verschieben (rename behält die mtime
// der Datei, ändert aber Pfad und Ordner-mtime) in ALLEN Ordnern (Wiki, Inbox, Archiv, Cluster, sonstige).
// Ausgelassen: Punkt-Ordner (.git, .logs, .obsidian …) — dort ändert sich laufend etwas, das nicht in die
// Ansicht einfließt; was aus .logs zählt, nimmt datenSchluessel() einzeln dazu. Symlink-Ordner: nicht folgen.
function baumAbdruck(vault, hash) {
  const stapel = [""];
  while (stapel.length) {
    const rel = stapel.pop();
    let eintraege;
    try { eintraege = readdirSync(rel ? join(vault, rel) : vault, { withFileTypes: true }); } catch { hash.update(`${rel}/\0?\n`); continue; }
    eintraege.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const e of eintraege) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (e.name.startsWith(".")) continue;
        let m = 0; try { m = statSync(join(vault, r)).mtimeMs; } catch {}
        hash.update(`${r}/\0${m}\n`);
        stapel.push(r);
      } else {
        let m = 0, g = -1; try { const st = statSync(join(vault, r)); m = st.mtimeMs; g = st.size; } catch {}
        hash.update(`${r}\0${m}\0${g}\n`);
      }
    }
  }
}

// Cache-Schlüssel für den Dienst (Task 1): ändert sich, sobald sich irgendetwas ändert, das in die Ansichtsdaten
// einfließt — Vault-Baum (Ruling 6), brain.config.json, git-HEAD, MCP-Quelldateien (nur mtimes, nie Inhalt),
// Werkzeug-Log und Lint-Cache.
export function datenSchluessel(vault) {
  const cfg = ladeConfig(vault);
  const hash = createHash("sha256");
  baumAbdruck(vault, hash);
  const mtime = (p) => { try { const st = statSync(p); return `${st.mtimeMs}:${st.size}`; } catch { return "0"; } };
  // Gültigkeit („bald“/„abgelaufen“) und das 30-Tage-Lesefenster hängen am Kalendertag → lokales Datum in den Schlüssel
  const d = new Date();
  const teile = [`${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`, mtime(join(vault, "brain.config.json"))];
  try {
    const head = execFileSync(gitBefehl({ cfg }), ["-C", vault, "rev-parse", "HEAD"], {
      encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], windowsHide: true,
      env: Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_"))),
    }).trim();
    teile.push(head);
  } catch { teile.push(""); }
  for (const p of quellDateien(vault)) teile.push(mtime(p));
  teile.push(mtime(join(vault, ".logs", "werkzeug.log")), mtime(join(vault, ".logs", "lint-cache.txt")));
  hash.update(teile.join("|"));
  return hash.digest("hex");
}

let aufruf = "";
try { aufruf = realpathSync(process.argv[1] || ""); } catch {}
if (aufruf && aufruf === realpathSync(fileURLToPath(import.meta.url))) {
  try {
    const r = erzeugeAnsichtsDaten(vaultPfad());
    for (const w of r.warnungen) console.error(`Warnung: ${w}`);
    console.log(`Ansicht: ${r.seiten} Seiten, ${r.verbindungen} Verbindungen → ${r.pfad}`);
  } catch (e) {
    console.error(String(e?.message || e).split("\n")[0]);
    process.exit(1);
  }
}
