#!/usr/bin/env node
// .tools/ansicht/dienst.mjs — Ansicht-Dienst (Spec §3.A, §3b.1): lokaler HTTP-Dienst nur auf 127.0.0.1, Port
// zufällig, für die 3D-Ansicht und die Steuerzentrale. Nur node:http, keine Abhängigkeit. Die Anfrage-Logik
// (Routing, alle Sicherheitsprüfungen) steckt in dienst-lib.mjs; hier nur Socket, Lebensdauer und Handler.
// Nutzung: node .tools/ansicht/dienst.mjs <vault>   (gestartet von dienst-start.mjs, losgelöst)
// stdout: genau eine Zeile „bereit <port>“, sobald dienst.json geschrieben ist — danach nichts mehr.
// Ende: SIGTERM/SIGINT, POST /api/stopp, oder Leerlauf (Standard 30 min, BRAIN_DIENST_LEERLAUF_MS) — räumt
// dienst.json auf (nur die eigene, falls inzwischen ein anderer Dienst sie ersetzt hat).
import http from "node:http";
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, renameSync, mkdirSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { behandle, vaultIdVon, MAX_KOERPER, laufErgebnis } from "./dienst-lib.mjs";

const HIER = dirname(fileURLToPath(import.meta.url));
const vault = process.argv[2] || process.env.BRAIN_VAULT || join(HIER, "..", "..");
const LEERLAUF_MS = Number(process.env.BRAIN_DIENST_LEERLAUF_MS) > 0 ? Number(process.env.BRAIN_DIENST_LEERLAUF_MS) : 30 * 60 * 1000;
const DATEN_TTL_MS = 10 * 1000;
// Zugangsschlüssel für /api (32 Byte, je Start neu); Feldname in dienst.json und kontext: "token"
const zugang = randomBytes(32).toString("hex");
const vaultId = vaultIdVon(vault);
const dienstDatei = join(vault, ".logs", "ansicht", "dienst.json");

// stdout gehört dem Starter nur bis „bereit“; danach ist die Pipe zu — Schreibfehler dort nie fatal.
process.stdout.on("error", () => {});

// ---- Handler: Module werden erst bei Bedarf geladen. Fehlt ein Modul oder sein Export (paralleler Task noch
// nicht da), meldet die Route 503 „nicht verfügbar“ statt abzustürzen.
const modulCache = new Map();
const nichtVerfuegbar = () => Object.assign(new Error("nicht verfügbar"), { code: 503 });
async function ladeModul(rel) {
  if (!modulCache.has(rel)) modulCache.set(rel, import(pathToFileURL(join(HIER, rel)).href).catch(() => null));
  const mod = await modulCache.get(rel);
  if (!mod) { modulCache.delete(rel); throw nichtVerfuegbar(); } // später nachgeliefertes Modul erneut versuchen
  return mod;
}
async function exportVon(rel, name) {
  const mod = await ladeModul(rel);
  if (typeof mod[name] !== "function") throw nichtVerfuegbar();
  return mod[name];
}

// Ansichtsdaten als Objekt: baueAnsichtsDaten (Task 3), sonst aus der von erzeugeAnsichtsDaten geschriebenen
// data.js (Präfix „window.BRAIN_DATA = “ abschneiden). Cache: bis datenSchluessel sich ändert, sonst 10 s.
let datenCache = null; // { schluessel, zeit, daten }
async function daten(v) {
  const mod = await ladeModul("./daten.mjs");
  const schluessel = typeof mod.datenSchluessel === "function" ? await mod.datenSchluessel(v) : null;
  if (datenCache) {
    const frisch = schluessel != null ? datenCache.schluessel === schluessel : Date.now() - datenCache.zeit < DATEN_TTL_MS;
    if (frisch) return datenCache.daten;
  }
  let ergebnis;
  if (typeof mod.baueAnsichtsDaten === "function") ergebnis = await mod.baueAnsichtsDaten(v);
  else if (typeof mod.erzeugeAnsichtsDaten === "function") ergebnis = ausDataJs(mod.erzeugeAnsichtsDaten(v).pfad);
  else throw nichtVerfuegbar();
  datenCache = { schluessel, zeit: Date.now(), daten: ergebnis };
  return ergebnis;
}
function ausDataJs(pfad) {
  const text = readFileSync(pfad, "utf8");
  const marke = "window.BRAIN_DATA = ";
  const i = text.indexOf(marke);
  if (i < 0) throw new Error("data.js ohne Daten");
  return JSON.parse(text.slice(i + marke.length).trim().replace(/;$/, ""));
}

// Ist die Claude-Code-CLI auf diesem Rechner? Dieselbe Suche wie die Ernte (eine Quelle der Wahrheit:
// ernte.mjs#findeClaude) — nur nachsehen, nie starten.
async function claudeGefunden() {
  try { return !!(await exportVon("../ernte.mjs", "findeClaude"))(); } catch { return false; }
}

const handler = {
  daten,
  einstellungenLesen: async (v) => ({ ...(await exportVon("../einstellungen.mjs", "leseAutomatik"))(v), claudeGefunden: await claudeGefunden() }),
  // Nach erfolgreichem Schreiben/Entscheiden ist der Daten-Cache sofort veraltet (Config/Vorschlagsordner).
  // Ändert sich ichKarte, AGENTS.md im Vault neu rendern (Final-Review #1) — Fehler dabei nie fatal.
  einstellungenSchreiben: async (v, werte, stand) => {
    const lies = await exportVon("../einstellungen.mjs", "leseAutomatik");
    const vorher = lies(v).werte.ichKarte;
    const r = await (await exportVon("../einstellungen.mjs", "schreibeAutomatik"))(v, werte, stand);
    datenCache = null;
    if (lies(v).werte.ichKarte !== vorher) { try { await (await exportVon("../einstellungen.mjs", "rendereAgentsDatei"))(v); } catch {} }
    return r;
  },
  analyse: async (v) => (await exportVon("../analyse.mjs", "analyse"))(v),
  vorschlaegeListe: async (v) => (await exportVon("../vorschlaege.mjs", "listeVorschlaege"))(v),
  vorschlagEntscheiden: async (v, id, aktion) => {
    const r = await (await exportVon("../vorschlaege.mjs", "entscheide"))(v, id, aktion);
    datenCache = null;
    return r;
  },
  gelesen: async (v, seitMs) => (await exportVon("../werkzeug-log.mjs", "leseGelesen"))(v, seitMs),
  // Pflegebericht (aus dem Cache .logs/pflege-bericht.json, neu nur bei geändertem Schlüssel — W1-Review #6) +
  // offene Konflikte (aus den Ansichtsdaten D.konflikte; fehlen sie dort, liest pflege.mjs selbst) + Status des
  // Pflege-Laufs (claude da? läuft gerade? Kosten des letzten Laufs — T6-Bedenken 1).
  pflege: async (v) => {
    const mod = await ladeModul("../pflege.mjs");
    if (typeof mod.pflegebericht !== "function") throw nichtVerfuegbar();
    const bericht = typeof mod.aktuellerBericht === "function" ? await mod.aktuellerBericht(v) : await mod.pflegebericht(v);
    let konflikte = null;
    try { const d = await daten(v); if (Array.isArray(d?.konflikte)) konflikte = d.konflikte; } catch {}
    if (!konflikte) konflikte = typeof mod.offeneKonflikte === "function" ? mod.offeneKonflikte(v) : [];
    if (typeof mod.markiereEntschieden === "function") konflikte = mod.markiereEntschieden(v, konflikte);
    let lauf = null;
    try { lauf = (await exportVon("../pflegelauf.mjs", "pflegeLaufStatus"))(v); } catch { lauf = null; }
    return { ...bericht, konflikte, lauf };
  },
  konfliktEntscheiden: async (v, seite, nr, wahl, notiz, fingerabdruck = null) => {
    const r = await (await exportVon("../entscheidungen.mjs", "schreibeEntscheidung"))(v, { seite, nr, wahl, notiz, fingerabdruck });
    datenCache = null;
    return r;
  },
  // Pflege-Lauf mit KI (Task 3) losgelöst starten — fehlt pflegelauf.mjs, meldet die Route 503 „nicht verfügbar“.
  // Nicht gestartet (W1-Review #15): „läuft schon“ → 409, „claude fehlt“ → 503, sonst → 500 — jeweils mit grund.
  pflegeLauf: async (v) => {
    return laufErgebnis(await (await exportVon("../pflegelauf.mjs", "starteLosgeloest"))(v));
  },
};

// ---- Lebensdauer
let port = 0;
let leerlauf = null;
const weckeLeerlauf = () => { clearTimeout(leerlauf); leerlauf = setTimeout(() => beende(), LEERLAUF_MS); };

let beendet = false;
function beende() {
  if (beendet) return;
  beendet = true;
  clearTimeout(leerlauf);
  try {
    const j = JSON.parse(readFileSync(dienstDatei, "utf8"));
    if (j.pid === process.pid && zugang === j.token) rmSync(dienstDatei, { force: true });
  } catch {}
  server.close();
  server.closeAllConnections?.();
  setTimeout(() => process.exit(0), 50).unref();
}
process.on("SIGTERM", beende);
process.on("SIGINT", beende);
process.on("SIGHUP", beende);

function schreibeDienstDatei() {
  mkdirSync(dirname(dienstDatei), { recursive: true });
  const tmp = `${dienstDatei}.${process.pid}.tmp`;
  const inhalt = { port, pid: process.pid, "token": zugang, vaultId, start: new Date().toISOString() };
  writeFileSync(tmp, JSON.stringify(inhalt) + "\n", { mode: 0o600 });
  renameSync(tmp, dienstDatei);
}

// ---- HTTP
const server = http.createServer((req, res) => {
  const roh = String(req.url || "/");
  const q = roh.indexOf("?");
  const pfad = q < 0 ? roh : roh.slice(0, q);
  const query = new URLSearchParams(q < 0 ? "" : roh.slice(q + 1));
  const teile = [];
  let laenge = 0, fertig = false;
  const weiter = async (zuGross) => {
    if (fertig) return;
    fertig = true;
    let r;
    try {
      r = await behandle({ methode: req.method, pfad, query, headers: req.headers, body: laenge ? Buffer.concat(teile) : undefined },
        { vault, "token": zugang, port, handler, ansichtDir: HIER, vaultId });
    } catch {
      r = { status: 500, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }, body: Buffer.from('{"fehler":"Interner Fehler"}') };
    }
    if (r.status !== 403) weckeLeerlauf(); // fremde/abgelehnte Anfragen halten den Dienst nicht am Leben
    const h = { ...r.headers, "Content-Length": r.body ? r.body.length : 0 };
    if (zuGross) h.Connection = "close";
    if (zuGross) res.on("finish", () => req.destroy());
    if (r.stopp) res.on("finish", beende);
    res.writeHead(r.status, h);
    res.end(r.body);
  };
  req.on("data", (d) => {
    if (fertig) return;
    laenge += d.length;
    teile.push(d);
    if (laenge > MAX_KOERPER) weiter(true); // nicht weiterlesen — lib antwortet 413 (nach den Sicherheitsprüfungen)
  });
  req.on("end", () => weiter(false));
  req.on("error", () => { fertig = true; });
});
server.requestTimeout = 30 * 1000;
server.headersTimeout = 10 * 1000;
// Verbindungen ohne ein einziges Byte (greifen weder headers- noch requestTimeout) nach 15 s Ruhe schließen
// (Testhaken BRAIN_DIENST_RUHE_MS),
// und nie mehr als 64 gleichzeitig offen halten.
server.maxConnections = 64;
const RUHE_MS = Number(process.env.BRAIN_DIENST_RUHE_MS) > 0 ? Number(process.env.BRAIN_DIENST_RUHE_MS) : 15 * 1000; // Testhaken
server.on("connection", (s) => s.setTimeout(RUHE_MS, () => s.destroy()));
server.on("error", () => process.exit(1));

// Läuft schon ein ANDERER erreichbarer Dienst für diesen Vault (dienst.json zeigt auf ihn), ist dieser
// überzählig (paralleler Start, oder ein beschäftigter Dienst wurde für tot gehalten) → sich selbst beenden.
async function andererLaeuft() {
  let j;
  try { j = JSON.parse(readFileSync(dienstDatei, "utf8")); } catch { return false; }
  if (!j || j.pid === process.pid) return false;
  try {
    const { laufender } = await import(pathToFileURL(join(HIER, "dienst-start.mjs")).href);
    const r = await laufender(vault, { timeoutMs: 1500 });
    return !!(r && r.pid !== process.pid);
  } catch { return false; }
}

server.listen(0, "127.0.0.1", async () => {
  port = server.address().port;
  if (await andererLaeuft()) { server.close(); process.exit(0); }
  try { schreibeDienstDatei(); } catch { process.exit(1); }
  weckeLeerlauf();
  setInterval(async () => { if (!beendet && await andererLaeuft()) beende(); }, 60 * 1000).unref();
  process.stdout.write(`bereit ${port}\n`);
});
