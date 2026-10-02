#!/usr/bin/env node
// Claude-Code-Statusline: Brain-Status immer sichtbar, farbig. Erhält Session-JSON auf stdin.
// Farben: grün = aktuell · gelb = Inbox wartet · rot = offene Konflikte · grau = Modell
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { vaultPfad, ladeConfig, ordner } from "../../pfade.mjs";
import { gitBefehl } from "../../werkzeug.mjs";

function leseStdin() {
  try { return readFileSync(0, "utf8"); } catch { return ""; }
}

const V = vaultPfad([]);
let eingabe = {};
try { eingabe = JSON.parse(leseStdin()); } catch {}
const MODEL = eingabe?.model?.display_name || "";
const cfg = ladeConfig(V);
const { inbox: inboxName, wiki: wikiName } = ordner(V, cfg);

function zaehleInbox(dir) {
  if (!existsSync(dir)) return 0;
  let n = 0;
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    if (name.name.startsWith(".")) continue;
    const full = join(dir, name.name);
    if (name.isDirectory()) n += zaehleInbox(full);
    else n += 1;
  }
  return n;
}

function zaehleKonflikte(dir) {
  if (!existsSync(dir)) return 0;
  let n = 0;
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    if (name.name.startsWith("_")) continue;
    const full = join(dir, name.name);
    if (name.isDirectory()) { n += zaehleKonflikte(full); continue; }
    if (!name.name.endsWith(".md")) continue;
    try { if (/\[!KONFLIKT\] offen/.test(readFileSync(full, "utf8"))) n += 1; } catch {}
  }
  return n;
}

function zaehleZeilen(datei, muster) {
  if (!existsSync(datei)) return 0;
  return readFileSync(datei, "utf8").split("\n").filter(z => muster.test(z)).length;
}

const INBOX = zaehleInbox(join(V, inboxName));
const KONF = zaehleKonflikte(join(V, wikiName));
const GRUEN = "\x1b[32m", GELB = "\x1b[33m", ROT = "\x1b[31m", MAGENTA = "\x1b[35m", GRAU = "\x1b[90m", RESET = "\x1b[0m";
const PRUEF = zaehleZeilen(join(V, ".logs", "lint-cache.txt"), /PRÜFBEDÜRFTIG/);
let ING = "";
try { ING = execFileSync(gitBefehl({ cfg }), ["-C", V, "log", "-1", "--format=%cd", "--date=format:%d.%m.", "--grep=^ingest:"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], windowsHide: true }).trim(); } catch {}
const FRISCH = zaehleZeilen(join(V, ".logs", "lint-cache.txt"), /^- (FRISCHE|SUCHINDEX|HINWEIS-QUALITÄT):/);

let S;
if (INBOX === 0 && KONF === 0 && PRUEF === 0) {
  S = `${GRUEN}🧠 Brain: aktuell${RESET}`;
} else {
  S = INBOX !== 0 ? `${GELB}🧠 Brain: ${INBOX} wartend${RESET}` : `${GELB}🧠 Brain${RESET}`;
  if (KONF !== 0) S += ` ${ROT}· ${KONF} Konflikt(e)!${RESET}`;
  if (PRUEF !== 0) S += ` ${MAGENTA}· ${PRUEF} prüfbedürftig${RESET}`;
}
if (ING) {
  S += FRISCH !== 0 ? ` ${GELB}· Ingest ${ING} ⚠${RESET}` : ` ${GRAU}· Ingest ${ING}${RESET}`;
}
if (MODEL) S += ` ${GRAU}· ${MODEL}${RESET}`;
console.log(S);
