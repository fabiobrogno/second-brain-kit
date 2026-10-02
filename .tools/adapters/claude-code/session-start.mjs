#!/usr/bin/env node
// SessionStart: Hintergrund-Refresh (eigener, losgelöster Prozess) + Statusmeldung. Nie blockierend,
// Fehler still ins Log. BRAIN_SESSION_NUR_STATUS=1 (Tests): nur die Statuszeilen, kein Hintergrund.
import { appendFileSync, existsSync, statSync, readFileSync, readdirSync, mkdirSync, writeFileSync, renameSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { vaultPfad, ladeConfig, ordner, configFehler } from "../../pfade.mjs";
import { leseCache, hinweisZeile, leseBereitMarke } from "../../update-check.mjs";

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
}

if (configFehler(V)) console.log("Brain: Die Einstellungsdatei brain.config.json ist beschädigt — es gelten Standardwerte. Sag „repariere meine Brain-Einstellungen“.");

// Update-Hinweis (Spec §3.9) — schneller Pfad: nur Cache/Marke lesen, nie selbst das Netz fragen
// (das erledigt session-hintergrund.mjs einmal pro Tag im Hintergrund).
try {
  const bereit = leseBereitMarke(V);
  if (bereit) console.log(`Brain-Update: Update v${bereit} wird beim nächsten Start eingespielt.`);
  else { const z = hinweisZeile(leseCache(V), V); if (z) console.log(`Brain-Update: ${z}`); }
} catch { /* nie blockierend */ }

const cfg = ladeConfig(V);
const { inbox: inboxName, wiki: wikiName } = ordner(V, cfg);

function zaehleDateien(dir) {
  if (!existsSync(dir)) return 0;
  let n = 0;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith(".")) continue;
    const full = join(dir, e.name);
    n += e.isDirectory() ? zaehleDateien(full) : 1;
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

process.exit(0);
