#!/usr/bin/env node
// SessionStart: Hintergrund-Refresh (eigener, losgelöster Prozess) + Statusmeldung. Nie blockierend,
// Fehler still ins Log. BRAIN_SESSION_NUR_STATUS=1 (Tests): nur die Statuszeilen, kein Hintergrund.
// v0.3 (nur wenn zutreffend): Ich-Karte (ichKarte), „Projektseite: …" (projektAutomatik), Zahl neuer Vorschläge.
// BRAIN_ERNTE=1 (Selbstaufruf der Ernte) → sofort Ende, keine Ausgabe, kein Hintergrund. Die Kit-Module werden
// erst NACH dieser Prüfung geladen (dynamisches import) — statische Importe würden vorher ausgewertet.
// Liegengebliebene Ernte-Aufträge (.logs/ernte/offen/) startet session-start losgelöst neu (ernte-ausloeser.mjs).
if (process.env.BRAIN_ERNTE === "1") process.exit(0);
import { appendFileSync, existsSync, statSync, readFileSync, readdirSync, mkdirSync, writeFileSync, renameSync, openSync, readSync, closeSync } from "node:fs";
import { join, dirname, basename, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";
const { vaultPfad, ladeConfig, ordner, configFehler, entferneBom } = await import("../../pfade.mjs");
const { leseCache, hinweisZeile, leseBereitMarke } = await import("../../update-check.mjs");
const { leseAutomatik } = await import("../../einstellungen.mjs");
const { anzahlVorschlaege } = await import("../../vorschlaege.mjs");
const { gitBefehl } = await import("../../werkzeug.mjs");
const { anzeigePfad } = await import("../../hint-core.mjs");

const T = dirname(fileURLToPath(import.meta.url));
const V = vaultPfad([]);
const log = join(V, ".logs", "hooks.log");

function formatLokal(d, sep = " ") {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}${sep}${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

try {
  mkdirSync(join(V, ".logs"), { recursive: true });
  if (existsSync(log)) {
    const zeilen = readFileSync(log, "utf8").split("\n");
    if (zeilen.length > 2000) {
      const tmp = `${log}.${process.pid}.tmp`;
      writeFileSync(tmp, zeilen.slice(-1000).join("\n"));
      renameSync(tmp, log);
    }
  }
  appendFileSync(log, `--- ${formatLokal(new Date())} session-start\n`);
} catch {}

if (!existsSync(V)) process.exit(0);

if (!process.env.BRAIN_SESSION_NUR_STATUS) {
  const kind = spawn(process.execPath, [join(T, "session-hintergrund.mjs"), V], {
    detached: true, stdio: "ignore", windowsHide: true, env: { ...process.env, BRAIN_VAULT: V },
  });
  kind.unref();
  // Ernte-Aufträge, deren Lauf mit Claude Code beendet wurde (Windows), jetzt nachholen — Claude läuft ja.
  if (existsSync(join(V, ".logs", "ernte"))) {
    try { (await import("./ernte-ausloeser.mjs")).arbeiteOffeneAb(V); } catch {}
  }
}

if (configFehler(V)) console.log("Brain: Die Einstellungsdatei brain.config.json ist beschädigt — es gelten Standardwerte. Sag „repariere meine Brain-Einstellungen“.");

const automatik = leseAutomatik(V).werte;

// Update-Hinweis (Spec §3.9) — schneller Pfad: nur Cache/Marke lesen, nie selbst das Netz fragen
// (das erledigt session-hintergrund.mjs einmal pro Tag im Hintergrund). Schalter updateHinweis.
if (automatik.updateHinweis !== false) try {
  const bereit = leseBereitMarke(V);
  if (bereit) console.log(`Brain-Update: Update v${bereit} wird beim nächsten Start eingespielt.`);
  else { const z = hinweisZeile(leseCache(V), V); if (z) console.log(`Brain-Update: ${z}`); }
} catch { /* nie blockierend */ }

const cfg = ladeConfig(V);
const { inbox: inboxName, wiki: wikiName } = ordner(V, cfg);

// Inbox-Dateien, die auf /ingest warten — ohne _vorschlaege (eigene Zeile „N neue Vorschläge") und ohne
// _import (wird je Paket nach Ja eingearbeitet, nicht pauschal; Final-Review #6).
const NICHT_INGEST = new Set(["_vorschlaege", "_import"]);
function zaehleDateien(dir, oben = true) {
  if (!existsSync(dir)) return 0;
  let n = 0;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith(".")) continue;
    if (oben && e.isDirectory() && NICHT_INGEST.has(e.name)) continue;
    const full = join(dir, e.name);
    n += e.isDirectory() ? zaehleDateien(full, false) : 1;
  }
  return n;
}
function zaehleKonflikte(dir) {
  if (!existsSync(dir)) return 0;
  let n = 0;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith("_")) continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) { n += zaehleKonflikte(full); continue; }
    if (!e.name.endsWith(".md")) continue;
    try { if (/\[!KONFLIKT\] offen/.test(readFileSync(full, "utf8"))) n += 1; } catch {}
  }
  return n;
}

const INBOX = zaehleDateien(join(V, inboxName));
const KONFLIKTE = zaehleKonflikte(join(V, wikiName));
if (INBOX !== 0) console.log(`Brain-Inbox: ${INBOX} Datei(en) warten auf /ingest.`);
if (KONFLIKTE !== 0) console.log(`Brain-Wiki: offene Konflikte auf ${KONFLIKTE} Seite(n) — Entscheidung nötig (/brain-lint).`);

// Eine Sammelzeile für Pflege (direkt berechnet, nicht aus dem Lint-Cache): Review fällig, offene Rückmeldungen
const M = join(V, ".logs", "letzter-review");
let P = "";
if (!existsSync(M) || (Date.now() - statSync(M).mtimeMs) > 30 * 86400000) P = "Review fällig";
const MISO = existsSync(M) ? formatLokal(statSync(M).mtime, "T") : "0000";
const fbDatei = join(V, ".logs", "feedback.log");
let FB = 0;
if (existsSync(fbDatei)) {
  FB = readFileSync(fbDatei, "utf8").split("\n").filter(z => z.slice(0, 19) > MISO).length;
}
if (FB !== 0) P = P ? `${P}, ${FB} offene Rückmeldung(en)` : `${FB} offene Rückmeldung(en)`;
if (P) console.log(`Brain-Pflege: ${P} — /brain-review`);

// ---------- v0.3: Vorschläge, Ich-Karte, Projektseite ----------
try {
  const n = anzahlVorschlaege(V);
  if (n > 0) console.log(`${n === 1 ? "1 neuer Vorschlag" : `${n} neue Vorschläge`} — im Gehirn prüfen („zeig mir mein Brain“)`);
} catch {}

const ICH_MAX = 1500;
function ichKarte(vault, wikiOrdner) {
  let t;
  try { t = entferneBom(readFileSync(join(vault, wikiOrdner, "ich.md"), "utf8")); } catch { return ""; }
  const fm = /^---\r?\n[\s\S]*?\r?\n---[ \t]*(\r?\n|$)/.exec(t);
  if (fm) t = t.slice(fm[0].length);
  t = t.replace(/\r\n/g, "\n").trim();
  return t.length > ICH_MAX ? t.slice(0, ICH_MAX).trimEnd() + " …" : t;
}
if (automatik.ichKarte) {
  try { const k = ichKarte(V, wikiName); if (k) console.log(`Brain-Ich-Karte (${wikiName}/ich.md):\n${k}`); } catch {}
}

// Hook-JSON (cwd) von stdin — mit kurzer Frist, denn ohne Claude Code (Tests, Hand-Aufruf) kann stdin offen bleiben.
function leseEingabe(ms = 300) {
  if (process.stdin.isTTY) return Promise.resolve({});
  return new Promise((fertig) => {
    const teile = []; let zu = false;
    const ende = () => {
      if (zu) return; zu = true; clearTimeout(uhr);
      try { process.stdin.pause(); } catch {}
      try { fertig(JSON.parse(Buffer.concat(teile).toString("utf8") || "{}")); } catch { fertig({}); }
    };
    const uhr = setTimeout(ende, ms);
    try {
      process.stdin.on("data", (c) => teile.push(c));
      process.stdin.on("end", ende);
      process.stdin.on("error", ende);
    } catch { ende(); }
  });
}

// Werte eines Frontmatter-Schlüssels: „k: wert", „k: [a, b]" oder „k:" mit „- a"-Zeilen darunter.
const ohneQuotes = (s) => String(s).trim().replace(/^["']|["']$/g, "").trim();
function fmWerte(text, schluessel) {
  const t = entferneBom(text);
  if (!/^---\r?\n/.test(t)) return [];
  const zeilen = t.split(/\r?\n/), out = [];
  let aktiv = false;
  for (let i = 1; i < zeilen.length; i++) {
    const z = zeilen[i];
    if (z.trim() === "---") break;
    const m = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(z);
    if (m) {
      aktiv = schluessel.includes(m[1]);
      const w = m[2].trim();
      if (aktiv && w) out.push(...(w.startsWith("[") ? w.replace(/^\[|\]$/g, "").split(",") : [w]).map(ohneQuotes).filter(Boolean));
      continue;
    }
    const l = /^\s*-\s+(.*)$/.exec(z);
    if (aktiv && l) out.push(ohneQuotes(l[1]));
    else if (z.trim()) aktiv = false;
  }
  return out;
}
const basisName = (p) => String(p).split("\\").join("/").replace(/\/+$/, "").split("/").pop().replace(/\.git$/i, "").toLowerCase();
const normSeite = (s) => String(s).toLowerCase().replace(/\.md$/, "").replace(/^(thema|entitaet|quelle)_/, "").replace(/[\s_]+/g, "-");
function kopf(datei, max = 4096) {
  const fd = openSync(datei, "r");
  try { const b = Buffer.alloc(max); const n = readSync(fd, b, 0, max, 0); return b.subarray(0, n).toString("utf8"); }
  finally { closeSync(fd); }
}
// Wiki-Seiten (ohne generierte/Schema-Dateien „_…" und ohne ich.md), vault-relativ mit „/".
function wikiSeiten(vault, wikiOrdner) {
  const out = [];
  const lauf = (dir) => {
    let eintraege; try { eintraege = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of eintraege) {
      if (e.name.startsWith(".") || e.name.startsWith("_")) continue;
      const full = join(dir, e.name);
      if (e.isDirectory()) lauf(full);
      else if (e.isFile() && e.name.endsWith(".md") && e.name !== "ich.md") out.push(full);
    }
  };
  lauf(join(vault, wikiOrdner));
  return out;
}
// Genau eine passende Wiki-Seite für die Namen (Ordnername/Repo-Name) — sonst null.
function findeProjektseite(vault, wikiOrdner, namen) {
  const ziele = new Set([...namen].filter(Boolean).map(basisName));
  if (!ziele.size) return null;
  const seiten = wikiSeiten(vault, wikiOrdner);
  const perFm = [], perName = [];
  const zieleNorm = new Set([...ziele].map(normSeite));
  for (const f of seiten) {
    let werte = [];
    try { werte = fmWerte(kopf(f), ["repo", "pfade"]); } catch {}
    if (werte.some(w => ziele.has(basisName(w)))) perFm.push(f);
    else if (zieleNorm.has(normSeite(basename(f)))) perName.push(f);
  }
  const treffer = perFm.length ? perFm : perName;
  return treffer.length === 1 ? relative(vault, treffer[0]).split("\\").join("/") : null;
}
if (automatik.projektAutomatik) {
  try {
    const eingabe = await leseEingabe();
    const cwd = resolve(typeof eingabe?.cwd === "string" && eingabe.cwd ? eingabe.cwd : process.cwd());
    const namen = [basename(cwd)];
    // -C zielt auf cwd — geerbte GIT_DIR/GIT_WORK_TREE dürfen das nicht umlenken.
    const ohneGit = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_")));
    const r = spawnSync(gitBefehl({ cfg }), ["-C", cwd, "rev-parse", "--show-toplevel"], { encoding: "utf8", windowsHide: true, timeout: 1500, env: ohneGit });
    const top = r.status === 0 ? String(r.stdout || "").trim() : "";
    if (top) namen.push(basename(top));
    const seite = findeProjektseite(V, wikiName, namen);
    if (seite) console.log(`Projektseite: ${anzeigePfad(V, seite)}`);
  } catch {}
}

process.exit(0);
