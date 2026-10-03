#!/usr/bin/env node
// Ernte-Auslöser (SessionEnd/PreCompact mit --art fakt; brain-hint.mjs nutzt starteErnte für --art stand).
// Liest das Hook-JSON von stdin (session_id, transcript_path, cwd), prüft den Schalter und startet
// .tools/ernte.mjs LOSGELÖST (detached, stdio ignore, windowsHide, unref) — kehrt sofort zurück.
// Gibt NIE etwas aus (0-Token-Regel), Exit immer 0. Tut nichts bei BRAIN_ERNTE=1 (Selbstaufruf-Schutz).
// Den Ordner-Ausschluss (ernteNichtIn) prüft ernte.mjs selbst.
// Auftrags-Marke (Final-Review #5): „fakt" legt vor dem Start .logs/ernte/offen/<sid>.json an (Transkript, cwd,
// Art). ernte.mjs entfernt sie nach Abschluss. Wird der Lauf mit Claude Code beendet (Windows: Job-Objekt), bleibt
// die Marke liegen und session-start arbeitet sie beim nächsten Start ab (arbeiteOffeneAb) — dann läuft Claude.
// Testhaken: BRAIN_ERNTE_SKRIPT ersetzt den Pfad zu ernte.mjs (Fake-Ernte in Tests).
// v0.4: Mit „fakt" (SessionEnd/PreCompact) startet zusätzlich der Session-Auswerter (lektionen.mjs) losgelöst —
// eigener Schalter `lektionen` (aus|lokal|mit-ki, Standard lokal), unabhängig von ernteSitzungsende.
// Testhaken: BRAIN_LEKTIONEN_SKRIPT ersetzt den Pfad zu lektionen.mjs.
import { readFileSync, existsSync, realpathSync, mkdirSync, writeFileSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { EIGENER_VAULT } from "../../pfade.mjs";
import { leseAutomatik } from "../../einstellungen.mjs";

const HIER = dirname(fileURLToPath(import.meta.url));
const ERNTE = join(HIER, "..", "..", "ernte.mjs");
const LEKTIONEN = join(HIER, "..", "..", "lektionen.mjs");

// Wie brain-hint.mjs: nur Wortzeichen und "-", höchstens 64 Zeichen.
export function saubereSid(roh) {
  return String(roh || "").replace(/[^\w-]/g, "").slice(0, 64);
}

// Ist der Schalter für diese Art an? fakt → ernteSitzungsende, stand → staendeIntervallStunden > 0.
export function schalterAn(werte, art) {
  if (art === "fakt") return werte.ernteSitzungsende === true;
  if (art === "stand") return Number(werte.staendeIntervallStunden) > 0;
  return false;
}

// „fakt" höchstens einmal je Transkript-Teil: SessionEnd UND PreCompact dürfen beide starten — ernte.mjs merkt
// sich erst NACH einem erfolgreichen Lauf in .logs/ernte/<sid>.fakt, bis wohin geerntet ist, und erntet beim
// nächsten Mal nur den neuen Teil (Final-Review #2: eine vorab gesetzte Sperre verlor Läufe).
const ERNTE_DIR = (vault) => join(vault, ".logs", "ernte");
const OFFEN_DIR = (vault) => join(ERNTE_DIR(vault), "offen");
export const MARKEN_MAX_ALTER_MS = 7 * 24 * 3600 * 1000;

function legeAuftragAn(vault, { art, transkript, sid, cwd }) {
  const name = `${sid || `ohne-${Date.now()}-${process.pid}`}.json`;
  try {
    mkdirSync(OFFEN_DIR(vault), { recursive: true });
    writeFileSync(join(OFFEN_DIR(vault), name), JSON.stringify({ art, transkript, sid, cwd }) + "\n");
    return name;
  } catch { return ""; }
}

function spawnErnte(vault, { art, transkript, sid, cwd, auftrag = "" }) {
  const skript = process.env.BRAIN_ERNTE_SKRIPT || ERNTE;
  const args = [skript, "--art", art, "--transkript", transkript, "--sid", sid, "--cwd", String(cwd || ""), ...(auftrag ? ["--auftrag", auftrag] : []), vault];
  try {
    const kind = spawn(process.execPath, args, { cwd: vault, detached: true, stdio: "ignore", windowsHide: true, env: { ...process.env, BRAIN_VAULT: vault } });
    kind.on("error", () => {});
    kind.unref();
    return true;
  } catch { return false; }
}

// Startet ernte.mjs losgelöst. Prüft NICHT den Schalter (das tun die Aufrufer) — nur, ob es überhaupt
// etwas zu ernten gibt. Rückgabe: true, wenn ein Prozess gestartet wurde.
export function starteErnte(vault, { art, transkript, sid = "", cwd = "" } = {}) {
  if (process.env.BRAIN_ERNTE === "1") return false;
  if (art !== "fakt" && art !== "stand") return false;
  if (typeof transkript !== "string" || !transkript || !existsSync(transkript)) return false;
  const job = { art, transkript, sid: saubereSid(sid), cwd: String(cwd || "") };
  const auftrag = art === "fakt" ? legeAuftragAn(vault, job) : "";
  return spawnErnte(vault, { ...job, auftrag });
}

// Final-Review #8: Marken älter als 7 Tage löschen (<sid>.fakt, <sid>.stand, offen/*.json) — lauf.lock bleibt
// (das regelt ernte.mjs selbst). Gibt die übrigen offenen Aufträge zurück, ältester zuerst.
export function raeumeMarkenAuf(vault, jetzt = Date.now()) {
  const alt = (p) => { try { return jetzt - statSync(p).mtimeMs > MARKEN_MAX_ALTER_MS; } catch { return false; } };
  try {
    for (const n of readdirSync(ERNTE_DIR(vault))) {
      if (/\.(fakt|stand)$/.test(n) && alt(join(ERNTE_DIR(vault), n))) { try { unlinkSync(join(ERNTE_DIR(vault), n)); } catch {} }
    }
  } catch {}
  const offen = [];
  try {
    for (const n of readdirSync(OFFEN_DIR(vault))) {
      if (!n.endsWith(".json")) continue;
      const p = join(OFFEN_DIR(vault), n);
      if (alt(p)) { try { unlinkSync(p); } catch {} continue; }
      try { offen.push({ name: n, zeit: statSync(p).mtimeMs }); } catch {}
    }
  } catch {}
  return offen.sort((a, b) => a.zeit - b.zeit).map(o => o.name);
}

// Session-start: liegengebliebene Aufträge (Lauf mit Claude Code beendet) abarbeiten — höchstens einen je Start
// (es läuft ohnehin nur eine Ernte zugleich). Schalter inzwischen aus, kaputte Marke oder Transkript weg → Marke
// löschen. Rückgabe: Name des gestarteten Auftrags oder "".
export function arbeiteOffeneAb(vault, { jetzt = Date.now() } = {}) {
  if (process.env.BRAIN_ERNTE === "1") return "";
  const namen = raeumeMarkenAuf(vault, jetzt);
  if (!namen.length) return "";
  const werte = leseAutomatik(vault).werte;
  for (const name of namen) {
    const p = join(OFFEN_DIR(vault), name);
    let job = null;
    try { job = JSON.parse(readFileSync(p, "utf8")); } catch {}
    const gueltig = job && (job.art === "fakt" || job.art === "stand") && typeof job.transkript === "string"
      && job.transkript && existsSync(job.transkript) && /^[\w-]{1,80}\.json$/.test(name);
    if (!gueltig || !schalterAn(werte, job.art)) { try { unlinkSync(p); } catch {} continue; }
    const ok = spawnErnte(vault, { art: job.art, transkript: job.transkript, sid: saubereSid(job.sid), cwd: typeof job.cwd === "string" ? job.cwd : "", auftrag: name });
    return ok ? name : "";
  }
  return "";
}

// Session-Auswerter losgelöst starten (Schalter prüft der Aufrufer, ernteNichtIn prüft lektionen.mjs selbst).
export function starteLektionen(vault, { transkript, sid = "", cwd = "" } = {}) {
  if (process.env.BRAIN_ERNTE === "1") return false;
  if (typeof transkript !== "string" || !transkript || !existsSync(transkript)) return false;
  const skript = process.env.BRAIN_LEKTIONEN_SKRIPT || LEKTIONEN;
  const args = [skript, "--transkript", transkript, "--sid", saubereSid(sid), "--cwd", String(cwd || ""), vault];
  try {
    const kind = spawn(process.execPath, args, { cwd: vault, detached: true, stdio: "ignore", windowsHide: true, env: { ...process.env, BRAIN_VAULT: vault } });
    kind.on("error", () => {});
    kind.unref();
    return true;
  } catch { return false; }
}

// Hook-Einstieg: Eingabe (geparstes Hook-JSON) + Art → Schalter prüfen → starten.
// Rückgabe wie bisher: true, wenn die Ernte gestartet wurde (der Session-Auswerter zählt nicht).
export function loese(vault, art, eingabe) {
  if (process.env.BRAIN_ERNTE === "1") return false;
  const { werte, fehler } = leseAutomatik(vault);
  const job = {
    transkript: eingabe?.transcript_path ? String(eingabe.transcript_path) : "",
    sid: eingabe?.session_id,
    cwd: eingabe?.cwd ? String(eingabe.cwd) : "",
  };
  if (art === "fakt" && !fehler && werte.lektionen !== "aus") starteLektionen(vault, job);
  if (!schalterAn(werte, art)) return false;
  return starteErnte(vault, { art, ...job });
}

// Eigener Argument-Parser: vaultPfad() würde den Wert von --art („fakt") als Vault deuten.
export function leseArgs(argv) {
  let art = "fakt", vault = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--art") { art = argv[i + 1]; i++; }
    else if (!argv[i].startsWith("--")) vault = vault || argv[i];
  }
  return { art, vault: vault || process.env.BRAIN_VAULT || EIGENER_VAULT };
}

let aufruf = "";
try { aufruf = realpathSync(process.argv[1] || ""); } catch {}
if (aufruf && aufruf === realpathSync(fileURLToPath(import.meta.url))) {
  try {
    if (process.env.BRAIN_ERNTE !== "1") {
      const { art, vault } = leseArgs(process.argv.slice(2));
      let eingabe = {};
      try { eingabe = JSON.parse(readFileSync(0, "utf8") || "{}"); } catch {}
      loese(vault, art, eingabe);
    }
  } catch { /* nie blockierend, nie Ausgabe */ }
  process.exit(0);
}
