#!/usr/bin/env node
// .tools/brain-stand.mjs — die EINE Zählweise des Brain-Stands (wartende Rohquellen, Konflikte, prüfbedürftige
// Seiten, offene Vorschläge, letzter Ingest samt Frische-Warnung) und der Brain-Seiten, die der Hinweis-Hook zur
// letzten Frage einer Sitzung gemeldet hat. Genutzt von der Statusleiste (adapters/claude-code/statusline.mjs)
// und vom Brain-Band des Plugins brain-mods (über `node .tools/brain-stand.mjs --json --sid=<id>`).
// Nie werfend: fehlende Ordner/Logs zählen 0, ein kaputter git-Aufruf lässt `ingest` leer.
import { readFileSync, readdirSync, existsSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { vaultPfad, ladeConfig, ordner } from "./pfade.mjs";
import { gitBefehl } from "./werkzeug.mjs";
import { hitsSeiten } from "./logs.mjs";

// Wie Lint und Pflegebericht: System-Ordner der Inbox (_vorschlaege, _import, _entscheidungen, _lektionen, _pflege …)
// sind keine „wartenden“ Rohquellen und werden nur auf oberster Ebene ausgelassen.
export function zaehleInbox(dir, oben = true) {
  if (!existsSync(dir)) return 0;
  let n = 0;
  let eintraege;
  try { eintraege = readdirSync(dir, { withFileTypes: true }); } catch { return 0; }
  for (const name of eintraege) {
    if (name.name.startsWith(".") || (oben && name.name.startsWith("_"))) continue;
    const full = join(dir, name.name);
    if (name.isDirectory()) n += zaehleInbox(full, false);
    else n += 1;
  }
  return n;
}

export function zaehleMd(dir) {
  if (!existsSync(dir)) return 0;
  try { return readdirSync(dir).filter(f => f.endsWith(".md") && !f.startsWith(".")).length; } catch { return 0; }
}

export function zaehleKonflikte(dir) {
  if (!existsSync(dir)) return 0;
  let n = 0;
  let eintraege;
  try { eintraege = readdirSync(dir, { withFileTypes: true }); } catch { return 0; }
  for (const name of eintraege) {
    if (name.name.startsWith("_")) continue;
    const full = join(dir, name.name);
    if (name.isDirectory()) { n += zaehleKonflikte(full); continue; }
    if (!name.name.endsWith(".md")) continue;
    try { if (/\[!KONFLIKT\] offen/.test(readFileSync(full, "utf8"))) n += 1; } catch {}
  }
  return n;
}

export function zaehleZeilen(datei, muster) {
  if (!existsSync(datei)) return 0;
  try { return readFileSync(datei, "utf8").split("\n").filter(z => muster.test(z)).length; } catch { return 0; }
}

// Datum (TT.MM.) des letzten `ingest:`-Commits, sonst "".
export function letzterIngest(vault, cfg = ladeConfig(vault)) {
  try {
    return execFileSync(gitBefehl({ cfg }), ["-C", vault, "log", "-1", "--format=%cd", "--date=format:%d.%m.", "--grep=^ingest:"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], windowsHide: true, timeout: 5000 }).trim();
  } catch { return ""; }
}

// Der Brain-Stand als Zahlen. `mitIngest: false` spart den git-Aufruf (Tests, schnelle Abfragen).
export function brainStand(vault, { cfg = ladeConfig(vault), mitIngest = true } = {}) {
  const { inbox, wiki } = ordner(vault, cfg);
  const lintCache = join(vault, ".logs", "lint-cache.txt");
  return {
    wartend: zaehleInbox(join(vault, inbox)),
    konflikte: zaehleKonflikte(join(vault, wiki)),
    pruefbeduerftig: zaehleZeilen(lintCache, /PRÜFBEDÜRFTIG/),
    vorschlaege: zaehleMd(join(vault, inbox, "_vorschlaege")),
    ingest: mitIngest ? letzterIngest(vault, cfg) : "",
    frisch: zaehleZeilen(lintCache, /^- (FRISCHE|SUCHINDEX|HINWEIS-QUALITÄT):/),
  };
}

// Statusleisten-Text (ANSI-Farben) aus einem Brain-Stand — unverändert gegenüber der früheren statusline.mjs.
export function statusZeile(stand, modell = "") {
  const GRUEN = "\x1b[32m", GELB = "\x1b[33m", ROT = "\x1b[31m", MAGENTA = "\x1b[35m", GRAU = "\x1b[90m", RESET = "\x1b[0m";
  const { wartend, konflikte, pruefbeduerftig, vorschlaege, ingest, frisch } = stand;
  let s;
  if (wartend === 0 && konflikte === 0 && pruefbeduerftig === 0) {
    s = `${GRUEN}🧠 Brain: aktuell${RESET}`;
  } else {
    s = wartend !== 0 ? `${GELB}🧠 Brain: ${wartend} wartend${RESET}` : `${GELB}🧠 Brain${RESET}`;
    if (konflikte !== 0) s += ` ${ROT}· ${konflikte} Konflikt(e)!${RESET}`;
    if (pruefbeduerftig !== 0) s += ` ${MAGENTA}· ${pruefbeduerftig} prüfbedürftig${RESET}`;
  }
  // Offene Vorschläge (Ernte, Lektionen, Pflege) — warten auf einen Klick im Gehirn, nicht auf /ingest
  if (vorschlaege !== 0) s += ` ${GELB}· ${vorschlaege} ${vorschlaege === 1 ? "Vorschlag" : "Vorschläge"}${RESET}`;
  if (ingest) s += frisch !== 0 ? ` ${GELB}· Ingest ${ingest} ⚠${RESET}` : ` ${GRAU}· Ingest ${ingest}${RESET}`;
  if (modell) s += ` ${GRAU}· ${modell}${RESET}`;
  return s;
}

// Die Brain-Seiten, die der Hinweis-Hook zur LETZTEN Frage der Sitzung gemeldet hat (hint.log, sid auf 8 Zeichen
// gekürzt). Ergebnis: { zeit, seiten } der letzten Zeile dieser Sitzung (seiten leer = kein Hinweis), sonst null.
export function letzteHinweise(vault, sid) {
  const kurz = String(sid || "").replace(/[^\w-]/g, "").slice(0, 8);
  if (!kurz) return null;
  let inhalt;
  try { inhalt = readFileSync(join(vault, ".logs", "hint.log"), "utf8"); } catch { return null; }
  const zeilen = inhalt.split(/\r?\n/);
  for (let i = zeilen.length - 1; i >= 0; i--) {
    const z = zeilen[i];
    if (!z || !z.includes(` sid=${kurz} `)) continue;
    const m = z.match(/(?:^| )hits=(\S*)/);
    return { zeit: z.slice(0, 19), seiten: hitsSeiten(m ? m[1] : "") };
  }
  return null;
}

// CLI: `node .tools/brain-stand.mjs --json [--sid=<sitzung>]` → eine JSON-Zeile { stand, hinweis }.
const istHaupt = (() => { try { return realpathSync(process.argv[1] || "") === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; } })();
if (istHaupt) {
  const sidArg = process.argv.find(a => a.startsWith("--sid="));
  const vault = vaultPfad();
  const ausgabe = { stand: brainStand(vault), hinweis: sidArg ? letzteHinweise(vault, sidArg.slice(6)) : null };
  if (process.argv.includes("--json")) console.log(JSON.stringify(ausgabe));
  else console.log(statusZeile(ausgabe.stand).replace(/\x1b\[\d+m/g, ""));
}
