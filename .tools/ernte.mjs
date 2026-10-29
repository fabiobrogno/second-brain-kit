#!/usr/bin/env node
// .tools/ernte.mjs — Hintergrund-Ernte: Claude-Code-Transkript → Haiku (claude -p) → Vorschläge in
// <inbox>/_vorschlaege/. Läuft losgelöst vom Hook (Task 11), nie in der Sitzung. Zugangsdaten werden vor
// dem Senden zeilenweise und nach der Antwort je Vorschlag herausgefiltert. Höchstens ein Lauf zugleich.
// CLI: node .tools/ernte.mjs --art stand|fakt --transkript <pfad> --sid <id> --cwd <pfad> [--auftrag <name>.json] [vault]
// Gibt nie etwas aus; Ergebnis steht in .logs/ernte.log. Nur Node-Standardbibliothek.
// Aufruf von claude (Final-Review #3): schlank — keine Werkzeuge, keine MCP-Server, eigener kurzer Systemprompt,
// keine gespeicherte Sitzung, JSON-Ausgabe; die Token-Zahlen aus `usage` landen im ernte.log (tokEin/tokAus).
// „fakt" je Sitzung (Final-Review #2): .logs/ernte/<sid>.fakt merkt sich erst NACH einem erfolgreichen Lauf, bis
// zu welchem Byte das Transkript geerntet ist; der nächste Lauf derselben Sitzung erntet nur den neuen Teil.
// Auftrags-Marke (Final-Review #5): .logs/ernte/offen/<name>.json wird nach Abschluss entfernt (außer „läuft schon").
// B1 (Beleg je Fakt, §4.1): Haiku liefert je Vorschlag eine Zeile „Zitat: …“. Node sucht das Zitat im ganzen Verlauf
// (beleg.mjs) und speichert nur belegte Vorschläge mit zitat/herkunft/fundstelle; ohne Treffer → ohneBeleg, nur KI
// (Assistent, eingespielter Kontext, eigenes Brain) → nurKi. Damit Haiku auch Werkzeug-Ergebnisse zitieren kann,
// gehen gefilterte Werkzeug-Ausgaben (tool/web, ohne Fehler, ohne eigenes Brain, ohne Zugangs-/Kundendaten) mit.
import {
  openSync, readSync, fstatSync, closeSync, writeFileSync, unlinkSync, statSync, mkdirSync,
  mkdtempSync, rmSync, realpathSync, readFileSync, accessSync, constants as fsc,
} from "node:fs";
import { join, delimiter, dirname, extname, isAbsolute, win32 } from "node:path";
import { createHash } from "node:crypto";
import { tmpdir, homedir } from "node:os";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { findeSecrets, ohneSecrets, hatSecretsImKontext } from "./secrets-muster.mjs";
import { hatPii } from "./pii-muster.mjs";
import { parseZeile } from "./verlauf.mjs";
import { istSystemNachricht } from "./hint-core.mjs";
import { findeZitat, fundstellen, ladeTranskript } from "./beleg.mjs";
import { sperrPfade, markiereEigenes, webAdresse, baueFundstelle, ohneEingespieltes, ergebnisText, MAX_ZITAT } from "./beleg-ernte.mjs";
import { haengeAn, zeitstempel } from "./logs.mjs";
import { leseAutomatik } from "./einstellungen.mjs";
import { schreibeVorschlag } from "./vorschlaege.mjs";
import { EIGENER_VAULT, entferneBom } from "./pfade.mjs";

export const MAX_TRANSKRIPT = 24000;
export const MIN_PROMPTS = 5;
export const MAX_JE_WERKZEUG = 800;           // je Werkzeug-Ausgabe im Haiku-Input (Anfang)
export const MAX_WERKZEUGE = 8000;            // alle Werkzeug-Ausgaben zusammen (neueste zuerst), Teil der 24 000
export const WERKZEUG_KOPF = "\n--- WERKZEUG-AUSGABEN ---\n\n";
const MAX_LESEN = 8 * 1024 * 1024;            // nur das Ende großer Transkripte lesen
const LOCK_ALT_MS = 5 * 60 * 1000;
const ZEITLIMIT_MS = 120000;

// Fester Auftrag — bewusst knapp (Eingabe-Budget ≤ 8k Tokens inkl. Transkript). Geht als --system-prompt an
// claude (ersetzt den großen Claude-Code-Systemprompt); der Verlauf kommt über stdin (VERLAUF_KOPF + Text).
export const VERLAUF_KOPF = "--- VERLAUF ---\n\n";
export function auftrag(art) {
  const gemeinsam = [
    "Du liest unten den Verlauf einer Arbeitssitzung (Nutzer und Assistent) und darunter Werkzeug-Ausgaben.",
    "Schreibe NIE Zugangsdaten, Passwörter, Tokens, Schlüssel, Adressen, Telefonnummern oder Kundendaten.",
    "Belege jeden Vorschlag: letzte Zeile genau \"Zitat: <Auszug>\" — ein wörtlicher Auszug (12 bis 300 Zeichen, eine Zeile)",
    "aus einer Zeile, die mit \"Nutzer:\" oder \"Werkzeug (…):\" beginnt. Aussagen des Assistenten belegen nichts.",
    "Findest du keinen solchen Auszug, lass den Vorschlag weg.",
    "Ausgabeformat je Vorschlag genau: eine Zeile \"### <Titel>\", darunter der Text, zuletzt die Zitat-Zeile. Sonst nichts.",
    "Gibt es nichts Neues, antworte nur: NICHTS",
  ];
  const kern = art === "stand"
    ? ["Aufgabe: Fasse den aktuellen Arbeitsstand als EINEN Vorschlag zusammen: was erledigt ist, was offen ist,",
       "nächster Schritt. Höchstens 12 Zeilen, Titel höchstens 60 Zeichen."]
    : ["Aufgabe: Nenne höchstens 5 dauerhaft nützliche Fakten oder Entscheidungen aus der Sitzung (keine Plaudereien,",
       "nichts Vorübergehendes). Je Fakt 1–2 Sätze, Titel höchstens 60 Zeichen."];
  return [...kern, ...gemeinsam].join("\n");
}

const fwd = (p) => String(p).split("\\").join("/");
const ohneGit = (env) => Object.fromEntries(Object.entries(env).filter(([k]) => !k.startsWith("GIT_")));
// Variablen, die an die LAUFENDE Claude-Sitzung binden (verschachtelte Sitzung, Messaging der Eltern-Sitzung).
// Konfiguration (ANTHROPIC_*, CLAUDE_CODE_USE_BEDROCK, CLAUDE_CODE_GIT_BASH_PATH …) bleibt erhalten.
const SITZUNGS_VARIABLE = /^(CLAUDECODE|CLAUDE_PID|CLAUDE_PROJECT_DIR|CLAUDE_ENV_FILE|CLAUDE_CODE_(SESSION_ID|ENTRYPOINT|SSE_PORT|MESSAGING_\w*|PARENT_\w*|TRANSCRIPT\w*))$/;
export function kindUmgebung(env = process.env) {
  const out = {};
  for (const [k, w] of Object.entries(ohneGit(env))) if (!SITZUNGS_VARIABLE.test(k)) out[k] = w;
  out.BRAIN_ERNTE = "1";
  return out;
}

// ---------- claude finden ----------

function istAusfuehrbar(p) {
  try { if (!statSync(p).isFile()) return false; accessSync(p, fsc.X_OK); return true; } catch { return false; }
}
function istDatei(p) { try { return statSync(p).isFile(); } catch { return false; } }

// npm-Paket neben claude.cmd (Windows-npm-Layout) → Einstiegsskript bzw. native exe.
function ausCmdShim(dir) {
  const paket = join(dir, "node_modules", "@anthropic-ai", "claude-code");
  try {
    const pkg = JSON.parse(readFileSync(join(paket, "package.json"), "utf8"));
    const bin = typeof pkg.bin === "string" ? pkg.bin : pkg.bin?.claude;
    if (!bin) return null;
    const ziel = join(paket, bin);
    if (!istDatei(ziel)) return null;
    if (extname(ziel).toLowerCase() === ".exe") return { befehl: ziel, args: [] };
    return { befehl: process.execPath, args: [ziel] };
  } catch { return null; }
}

// { befehl, args } | null. Nie über eine Shell. Testhaken BRAIN_CLAUDE=<skript> → node <skript>.
export function findeClaude({ plattform = process.platform, pfad = process.env.PATH ?? "", env = process.env, home = homedir() } = {}) {
  if (env.BRAIN_CLAUDE) return { befehl: process.execPath, args: [env.BRAIN_CLAUDE] };
  if (plattform === "win32") {
    const dirs = String(pfad).split(";").filter(Boolean);
    for (const dir of dirs) { const exe = join(dir, "claude.exe"); if (istDatei(exe)) return { befehl: exe, args: [] }; }
    for (const dir of dirs) { if (istDatei(join(dir, "claude.cmd"))) { const r = ausCmdShim(dir); if (r) return r; } }
    const nativ = join(home, ".local", "bin", "claude.exe");
    return istDatei(nativ) ? { befehl: nativ, args: [] } : null;
  }
  for (const dir of String(pfad).split(delimiter).filter(Boolean)) {
    const p = join(dir, "claude");
    if (istAusfuehrbar(p)) return { befehl: p, args: [] };
  }
  for (const p of [join(home, ".local", "bin", "claude"), join(home, ".claude", "local", "claude")]) {
    if (istAusfuehrbar(p)) return { befehl: p, args: [] };
  }
  return null;
}

// ---------- ausgeschlossene Ordner ----------

function normPfad(p, plattform) {
  let s = fwd(p).replace(/\/+$/, "");
  return plattform === "darwin" || plattform === "win32" ? s.toLowerCase() : s;
}
function varianten(p, home) {
  let s = String(p || "").trim();
  if (!s) return [];
  if (s === "~" || s.startsWith("~/") || s.startsWith("~\\")) s = join(home, s.slice(1));
  const out = [s];
  try { out.push(realpathSync(s)); } catch {}
  return out;
}
export function istAusgeschlossen(cwd, liste, { plattform = process.platform, home = homedir() } = {}) {
  if (!Array.isArray(liste) || !liste.length) return false;
  const cs = varianten(cwd, home).map(p => normPfad(p, plattform));
  for (const eintrag of liste) {
    for (const e of varianten(eintrag, home).map(p => normPfad(p, plattform))) {
      if (!e) continue;
      if (cs.some(c => c === e || c.startsWith(e + "/"))) return true;
    }
  }
  return false;
}

// ---------- Transkript ----------

// Gemeinsame Helfer (v0.4): Session-Auswerter (lektionen.mjs) und Pflege-Lauf (pflegelauf.mjs) nutzen denselben
// JSONL-Leser, denselben schlanken Haiku-Aufruf (rufeHaiku) und dieselbe Usage-Auswertung (leseClaudeAntwort).

// Ab Byte `ab` (Zeilengrenze eines früheren Laufs; 0 = Anfang), höchstens die letzten MAX_LESEN Bytes.
// → { zeilen, bis }: bis = Byte hinter der letzten vollständigen Zeile (eine unvollständige letzte Zeile, die
// gerade geschrieben wird, zählt erst beim nächsten Lauf). Ist die Datei kürzer als `ab` (ersetzt), gilt 0.
export function leseEnde(pfad, ab = 0) {
  const fd = openSync(pfad, "r");
  try {
    const groesse = fstatSync(fd).size;
    if (!(ab >= 0) || ab > groesse) ab = 0;
    const start = Math.max(ab, groesse - MAX_LESEN);
    const buf = Buffer.alloc(groesse - start);
    readSync(fd, buf, 0, buf.length, start);
    let ende = buf.lastIndexOf(0x0a) + 1;
    // Rest ohne Zeilenende: nur mitnehmen, wenn er schon vollständiges JSON ist (Datei ohne letztes \n).
    if (ende < buf.length) { try { JSON.parse(buf.subarray(ende).toString("utf8")); ende = buf.length; } catch {} }
    const zeilen = entferneBom(buf.subarray(0, ende).toString("utf8")).split(/\r?\n/);
    if (start > ab) zeilen.shift();              // mitten in einer Zeile begonnen
    return { zeilen, bis: start + ende };
  } finally { closeSync(fd); }
}

// Verlauf (Nutzer/Assistent) + gefilterte Werkzeug-Ausgaben ab Byte `ab`, höchstens die letzten 8 MB.
// → { prompts: echte Nutzer-Prompts, text: Verlauf, werkzeuge: Werkzeug-Abschnitt (≤ MAX_WERKZEUGE), bis: gelesen bis Byte }
// Werkzeug-Ausgaben: nur Zeilen, in denen beleg.mjs eine Fundstelle mit Herkunft tool/web sieht — nach markiereEigenes
// (Fehler, unbekannte Aufrufe, eigenes Brain `sperr` → ki), also dieselbe Regel wie bei der Zitat-Prüfung. Der Text kommt
// roh aus der Zeile: ohne eingespielte Blöcke; Zeilen mit Zugangs-/Kundendaten fallen weg, im Zweifel die ganze Ausgabe.
// Zeilen ohne uuid (keine Fundstelle möglich) gehen nicht mit.
function werkzeugAusgabe(inhalt) {
  const zeilen = ohneSecrets(ohneEingespieltes(ergebnisText(inhalt))).split("\n").filter((z) => z.trim() && !hatPii(z));
  const t = zeilen.join("\n").trim();
  if (!t || hatSecretsImKontext(t) || hatPii(t)) return "";
  return t.slice(0, MAX_JE_WERKZEUG);
}
export function leseTranskript(pfad, { ab = 0, sperr = [] } = {}) {
  const teile = [], werkzeugTeile = [];
  let prompts = 0;
  const { zeilen, bis } = leseEnde(pfad, ab);
  const objekte = zeilen.map(parseZeile).filter(Boolean);
  const markiert = markiereEigenes(objekte, { sperr });
  const quelle = new Map();   // uuid → Werkzeugname, wo beleg.mjs tool/web sieht
  for (const f of fundstellen(markiert)) {
    if ((f.herkunft === "tool" || f.herkunft === "web") && f.uuid && !quelle.has(f.uuid)) quelle.set(f.uuid, f.werkzeug || "?");
  }
  for (const o of markiert) {
    if (o?.type !== "user" || o.isSidechain || !quelle.has(String(o.uuid ?? "")) || !Array.isArray(o.message?.content)) continue;
    for (const b of o.message.content) {
      if (b?.type !== "tool_result") continue;
      const t = werkzeugAusgabe(b.content);
      if (t) werkzeugTeile.push(`Werkzeug (${quelle.get(String(o.uuid))}): ${t}`);
    }
  }
  for (const m of objekte) {
    const c = m.message?.content;
    const intern = m.isMeta || m.isCompactSummary || m.isSidechain;
    if ((m.type !== "user" && m.type !== "assistant") || intern) continue;
    let texte = [];
    if (typeof c === "string") texte = [c];
    else if (Array.isArray(c)) {
      if (m.type === "user" && c.some(x => x?.type === "tool_result")) continue;
      texte = c.filter(x => x?.type === "text" && typeof x.text === "string").map(x => x.text);
    }
    texte = texte.map(t => ohneEingespieltes(t)).filter(t => t && !t.startsWith("<") && !istSystemNachricht(t));
    if (!texte.length) continue;
    if (m.type === "user") {
      if (texte.every(t => t.startsWith("/"))) continue;   // Slash-Befehle zählen nicht
      prompts++;
    }
    const wer = m.type === "user" ? "Nutzer" : "Assistent";
    for (const t of texte) {
      const sauber = ohneSecrets(t).trim();   // Zeilen mit Zugangsdaten, private Schlüssel als ganzer Block
      if (sauber) teile.push(`${wer}: ${sauber}`);
    }
  }
  // Werkzeug-Ausgaben: neueste zuerst ins Budget, dann wieder in Zeitfolge.
  const gewaehlt = [];
  let laenge = 0;
  for (let i = werkzeugTeile.length - 1; i >= 0; i--) {
    const l = werkzeugTeile[i].length + 2;
    if (laenge + l > MAX_WERKZEUGE) break;
    gewaehlt.unshift(werkzeugTeile[i]);
    laenge += l;
  }
  const werkzeuge = gewaehlt.join("\n\n");
  const budget = MAX_TRANSKRIPT - (werkzeuge ? WERKZEUG_KOPF.length + werkzeuge.length + 1 : 0);
  let text = teile.join("\n\n");
  if (text.length > budget) {
    text = text.slice(-budget);
    const nl = text.indexOf("\n");
    if (nl >= 0) text = text.slice(nl + 1);              // halbe erste Zeile weg
  }
  return { prompts, text, werkzeuge, bis };
}

// ---------- Antwort ----------

const ZITAT_ZEILE = /^[*_>\s-]*zitat[*_]*\s*:[*_]*\s*(.*)$/i;
const VORSATZ = /^(?:nutzer|werkzeug\s*\([^)]*\))\s*:\s*/i;
const HUELLEN = [["\"", "\""], ["„", "“"], ["“", "”"], ["«", "»"], ["‚", "‘"], ["'", "'"]];
// „Zitat: Werkzeug (Bash): „…““ → der reine Auszug (Vorsatz und eine äußere Anführungs-Hülle weg, zweimal).
export function saubereZitat(roh) {
  let z = String(roh ?? "").trim();
  for (let i = 0; i < 2; i++) {
    z = z.replace(VORSATZ, "").trim();
    for (const [a, b] of HUELLEN) if (z.length >= 2 && z.startsWith(a) && z.endsWith(b)) { z = z.slice(a.length, -b.length).trim(); break; }
  }
  return z;
}

export function parseAntwort(ausgabe, art) {
  const t = String(ausgabe || "").replace(/\r\n?/g, "\n").trim();
  if (!t || /^NICHTS\b/.test(t)) return [];
  const out = [];
  for (const block of t.split(/^###[ \t]+/m).slice(1)) {
    const [kopf, ...rest] = block.split("\n");
    const titel = kopf.trim().slice(0, 60);
    let zitat = "";
    const zeilen = [];
    for (const z of rest) {
      const m = ZITAT_ZEILE.exec(z.trim());
      if (m) { if (!zitat) zitat = saubereZitat(m[1]); continue; }   // die Zitat-Zeile gehört nicht zum Text
      zeilen.push(z);
    }
    let text = zeilen.join("\n").trim();
    if (art === "stand") text = text.split("\n").slice(0, 12).join("\n");
    if (titel && text) out.push({ titel, text, zitat });
  }
  return out.slice(0, art === "stand" ? 1 : 5);
}

// claude -p --output-format json → { text, tokens: {ein, aus} | null, fehler }. Defensiv: kein JSON oder kein
// `result` → Rohtext bzw. leer; ohne `usage` keine Token-Zahl (dann bleibt nur die Zeichenzählung im Log).
export function leseClaudeAntwort(stdout) {
  const roh = String(stdout || "");
  let j = null;
  try { j = JSON.parse(roh); } catch {}
  if (!j || typeof j !== "object" || Array.isArray(j)) return { text: roh, tokens: null, fehler: null };
  const n = (x) => (Number.isFinite(Number(x)) && Number(x) > 0 ? Math.round(Number(x)) : 0);
  const u = j.usage && typeof j.usage === "object" ? j.usage : null;
  const tokens = u && (u.input_tokens != null || u.output_tokens != null)
    ? { ein: n(u.input_tokens) + n(u.cache_creation_input_tokens) + n(u.cache_read_input_tokens), aus: n(u.output_tokens) }
    : null;
  return { text: typeof j.result === "string" ? j.result : "", tokens, fehler: j.is_error === true ? "claude meldet Fehler" : null };
}

// Die Argumente für claude: Prompt kommt über stdin. --tools "" = keine eingebauten Werkzeuge,
// --strict-mcp-config + leere --mcp-config = keine MCP-Server (auch nicht aus ~/.claude.json/Connectors),
// --system-prompt ersetzt den Claude-Code-Systemprompt, --no-session-persistence legt kein Sitzungsprotokoll an.
export function haikuArgs(systemPrompt) {
  return ["-p", "--model", "haiku", "--tools", "", "--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}',
    "--system-prompt", systemPrompt, "--no-session-persistence", "--setting-sources", "project", "--output-format", "json"];
}
export function claudeArgs(art) {
  return haikuArgs(auftrag(art));
}

// ---------- Marken ----------

const ERNTE_DIR = (vault) => join(vault, ".logs", "ernte");
export const AUFTRAG_NAME = /^[\w-]{1,80}\.json$/;
function leseFaktStand(vault, sid) {
  if (!sid) return 0;
  try { const b = Number(JSON.parse(readFileSync(join(ERNTE_DIR(vault), `${sid}.fakt`), "utf8")).bis); return b > 0 ? b : 0; }
  catch { return 0; }
}
function schreibeFaktStand(vault, sid, bis) {
  if (!sid) return;
  try { mkdirSync(ERNTE_DIR(vault), { recursive: true }); writeFileSync(join(ERNTE_DIR(vault), `${sid}.fakt`), JSON.stringify({ bis }) + "\n"); } catch {}
}

// ---------- Lock ----------

export function nimmLock(datei, jetzt) {
  mkdirSync(dirname(datei), { recursive: true });
  for (let versuch = 0; versuch < 2; versuch++) {
    try { writeFileSync(datei, `${process.pid}\n`, { flag: "wx" }); return true; }
    catch (e) {
      if (e.code !== "EEXIST") return false;
      let alt = false;
      try { alt = jetzt - statSync(datei).mtimeMs > LOCK_ALT_MS; } catch { continue; }
      if (!alt) return false;
      try { unlinkSync(datei); } catch {}
    }
  }
  return false;
}

// ---------- Lauf ----------

// Fester, leerer Arbeitsordner je Vault (Final-Review #9): claude legt je Arbeitsordner einen Projekteintrag an —
// mit einem festen Ordner bleibt es bei einem statt einem je Lauf. Vor dem Lauf frisch angelegt (nur wir, 0700);
// gelingt das nicht (z. B. fremder Ordner gleichen Namens im geteilten /tmp), Rückfall auf einen Zufallsordner.
// `zweck` (v0.4): eigener fester Ordner je Aufgabe (z. B. "lektion", "pflege"), damit parallele Läufe von Ernte,
// Session-Auswerter und Pflege-Lauf einander den Arbeitsordner nicht wegräumen. Ohne zweck: wie bisher.
export function arbeitsOrdner(vault, zweck = "") {
  const z = String(zweck || "").replace(/[^a-z0-9]/g, "").slice(0, 20);
  return join(tmpdir(), `brain-ernte-${createHash("sha256").update(fwd(vault)).digest("hex").slice(0, 12)}${z ? `-${z}` : ""}`);
}
function legeArbeitsOrdnerAn(vault, zweck = "") {
  const fest = arbeitsOrdner(vault, zweck);
  try { rmSync(fest, { recursive: true, force: true }); mkdirSync(fest, { mode: 0o700 }); return fest; } catch {}
  return mkdtempSync(join(tmpdir(), "brain-ernte-"));
}

function rufeClaude(claudeBefehl, art, eingabe, vault) {
  return rufeHaiku(claudeBefehl, auftrag(art), eingabe, vault);
}

// Schlanker Haiku-Aufruf mit eigenem Systemprompt; Eingabe über stdin. → { ausgabe } | { fehler }.
export function rufeHaiku(claudeBefehl, systemPrompt, eingabe, vault, { zweck = "" } = {}) {
  return new Promise((resolve) => {
    let arbeitsDir;
    try { arbeitsDir = legeArbeitsOrdnerAn(vault, zweck); }
    catch { resolve({ fehler: "kein Temp-Ordner" }); return; }
    const aufraeumen = () => { try { rmSync(arbeitsDir, { recursive: true, force: true }); } catch {} };
    let kind;
    try {
      kind = execFile(claudeBefehl.befehl,
        [...claudeBefehl.args, ...haikuArgs(systemPrompt)],
        { cwd: arbeitsDir, env: kindUmgebung(), timeout: ZEITLIMIT_MS,
          windowsHide: true, maxBuffer: 1024 * 1024, encoding: "utf8" },
        (err, stdout) => {
          aufraeumen();
          if (err) resolve({ fehler: err.killed ? "Zeitlimit" : (err.code === "ENOENT" ? "claude nicht startbar" : `Exit ${err.code ?? "?"}`) });
          else resolve({ ausgabe: String(stdout || "") });
        });
    } catch { aufraeumen(); resolve({ fehler: "claude nicht startbar" }); return; }
    kind.stdin?.on("error", () => {});
    kind.stdin?.end(eingabe);
  });
}

// auftragsMarke: Name einer Datei unter .logs/ernte/offen/ (vom Auslöser angelegt) — wird nach dem Lauf entfernt,
// egal ob ok, fehler oder übersprungen; nur bei „läuft schon" bleibt sie für einen späteren Lauf liegen.
export async function ernte(vault, opt = {}) {
  const r = await ernteLauf(vault, opt);
  const name = String(opt.auftragsMarke || "");
  if (AUFTRAG_NAME.test(name) && r.grund !== "läuft schon") {
    try { unlinkSync(join(ERNTE_DIR(vault), "offen", name)); } catch {}
  }
  return r;
}

async function ernteLauf(vault, { art, transkript, sid = "", cwd = "", claudeBefehl = findeClaude(), jetzt = Date.now() } = {}) {
  const ergebnis = (status, grund, vorschlaege = []) => ({ status, ...(grund ? { grund } : {}), vorschlaege });
  if (process.env.BRAIN_ERNTE === "1") return ergebnis("uebersprungen", "Selbstaufruf");
  const reinSid = String(sid || "").replace(/[^\w-]/g, "").slice(0, 64);
  const log = join(vault, ".logs", "ernte.log");
  const protokoll = (status, ein, aus, extra = "") =>
    haengeAn(log, `${zeitstempel(new Date(jetzt))} art=${art} status=${status} ein=${ein} aus=${aus}${extra}`);
  const tokFeld = (t) => (t ? ` tokEin=${t.ein} tokAus=${t.aus}` : "");
  try {
    if (art !== "stand" && art !== "fakt") return ergebnis("fehler", "unbekannte Art");
    // Fail-closed: ohne lesbare Config oder ohne bekannten Arbeitsordner lässt sich ernteNichtIn nicht prüfen.
    const { werte, fehler } = leseAutomatik(vault);
    if (fehler) return ergebnis("uebersprungen", "Config nicht lesbar");
    if (!cwd || !(isAbsolute(cwd) || win32.isAbsolute(cwd))) return ergebnis("uebersprungen", "Ordner unbekannt");
    if (istAusgeschlossen(cwd, werte.ernteNichtIn)) return ergebnis("uebersprungen", "ausgeschlossener Ordner");

    if (typeof transkript !== "string" || !transkript) return ergebnis("uebersprungen", "Transkript nicht lesbar");
    const lock = join(ERNTE_DIR(vault), "lauf.lock");
    if (!nimmLock(lock, jetzt)) return ergebnis("uebersprungen", "läuft schon");
    try {
      // Erst unter dem Lock lesen, bis wohin diese Sitzung schon geerntet ist — so ernten zwei Läufe derselben
      // Sitzung nie denselben Teil doppelt.
      const ab = art === "fakt" ? leseFaktStand(vault, reinSid) : 0;
      let gelesen;
      const sperr = sperrPfade(vault, werte.ernteNichtIn);
      try { gelesen = leseTranskript(transkript, { ab, sperr }); } catch { return ergebnis("uebersprungen", "Transkript nicht lesbar"); }
      if (ab > 0 && gelesen.bis <= ab) return ergebnis("uebersprungen", "nichts Neues");
      // Folgelauf derselben Sitzung: die Sitzung war schon lang genug, ein neuer Prompt reicht.
      if (gelesen.prompts < (ab > 0 ? 1 : MIN_PROMPTS)) return ergebnis("uebersprungen", "zu kurze Sitzung");
      if (!gelesen.text) return ergebnis("uebersprungen", "kein Text");
      if (!claudeBefehl) { protokoll("fehler", 0, 0, " grund=claude-fehlt"); return ergebnis("fehler", "claude nicht gefunden"); }

      const eingabe = VERLAUF_KOPF + gelesen.text + "\n" + (gelesen.werkzeuge ? WERKZEUG_KOPF + gelesen.werkzeuge + "\n" : "");
      const einZeichen = auftrag(art).length + eingabe.length;
      const r = await rufeClaude(claudeBefehl, art, eingabe, vault);
      const antwort = r.fehler ? null : leseClaudeAntwort(r.ausgabe);
      const fehler = r.fehler || antwort.fehler;
      if (fehler) {
        protokoll("fehler", einZeichen, 0, `${tokFeld(antwort?.tokens)} grund=${encodeURIComponent(fehler)}`);
        return ergebnis("fehler", fehler);
      }
      // Prüfreihenfolge je Vorschlag (B1): Zugangs-/Kundendaten → verworfen; Zitat fehlt, zu kurz/lang (beleg.mjs: 12–300)
      // oder nicht im Verlauf → ohneBeleg; nur KI → nurKi; sonst speichern. Gesucht wird im GANZEN Verlauf.
      const ids = [];
      const n = { verworfen: 0, ohneBeleg: 0, nurKi: 0 };
      let alle = null;
      for (const v of parseAntwort(antwort.text, art)) {
        if (findeSecrets(`${v.titel}\n${v.text}\n${v.zitat}`).length || hatSecretsImKontext(v.zitat) || hatPii(v.zitat)) { n.verworfen++; continue; }
        alle ??= markiereEigenes(ladeTranskript(transkript), { sperr });
        const fund = v.zitat ? findeZitat(alle, v.zitat) : null;
        if (!fund) { n.ohneBeleg++; continue; }
        if (fund.herkunft === "ki") { n.nurKi++; continue; }
        try {
          ids.push(schreibeVorschlag(vault, {
            art, titel: v.titel, text: v.text, ordner: cwd, sitzung: sid,
            zitat: v.zitat.replace(/\s+/g, " ").trim().slice(0, MAX_ZITAT), herkunft: fund.herkunft,
            fundstelle: baueFundstelle({ sitzung: reinSid, uuid: fund.uuid, zeit: fund.zeit }),
            quelleUrl: fund.herkunft === "web" ? webAdresse(alle, fund.uuid) : "",
          }, new Date(jetzt)));
        } catch { n.verworfen++; }
      }
      protokoll("ok", einZeichen, antwort.text.length, `${tokFeld(antwort.tokens)} vorschlaege=${ids.length} verworfen=${n.verworfen} ohneBeleg=${n.ohneBeleg} nurKi=${n.nurKi}`);
      if (art === "fakt") schreibeFaktStand(vault, reinSid, gelesen.bis);
      return ergebnis("ok", null, ids);
    } finally { try { unlinkSync(lock); } catch {} }
  } catch {
    protokoll("fehler", 0, 0, " grund=intern");
    return ergebnis("fehler", "interner Fehler");
  }
}

// ---------- CLI ----------

export function leseArgs(argv) {
  const flags = {}, rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) { flags[a.slice(2)] = argv[i + 1]; i++; } else rest.push(a);
  }
  return { flags, vault: rest[0] || process.env.BRAIN_VAULT || EIGENER_VAULT };
}

const selbst = fileURLToPath(import.meta.url);
let aufruf = "";
try { aufruf = realpathSync(process.argv[1] || ""); } catch {}
if (aufruf && aufruf === realpathSync(selbst)) {
  const { flags, vault } = leseArgs(process.argv.slice(2));
  const r = await ernte(vault, { art: flags.art, transkript: flags.transkript, sid: flags.sid || "", cwd: flags.cwd || "", auftragsMarke: flags.auftrag || "" });
  process.exitCode = r.status === "fehler" ? 1 : 0;
}
