#!/usr/bin/env node
// PreToolUse-Riegel (Harness-Grenze): <wiki> nur während /ingest (frisches Lock < 30 min),
// generierte Dateien nie. Exit 2 = blockiert (Begründung auf stderr), sonst Exit 0.
// Deckt Edit/Write/MultiEdit/NotebookEdit ab; Bash-Schreibzugriffe bleiben Regelwerk-Sache.
// Liest das Hook-JSON von stdin. BRAIN_ERNTE=1 (Selbstaufruf der Ernte) → nichts tun (Exit 0).
if (process.env.BRAIN_ERNTE === "1") process.exit(0);
import { readFileSync, existsSync, statSync, utimesSync, realpathSync } from "node:fs";
import { resolve, join, sep, basename, dirname } from "node:path";
import { vaultPfad, ladeConfig, ordner } from "../../pfade.mjs";

function leseStdin() {
  try { return readFileSync(0, "utf8"); } catch { return ""; }
}

const WIN = process.platform === "win32";
const gleich = (a, b) => WIN ? a.toLowerCase() === b.toLowerCase() : a === b;
const unter = (pfad, ordnerPfad) => {
  const p = WIN ? pfad.toLowerCase() : pfad;
  const o = (WIN ? ordnerPfad.toLowerCase() : ordnerPfad) + sep;
  return p.startsWith(o);
};

// resolve: BRAIN_VAULT darf unter Windows mit "/" kommen (C:/…) — Vergleiche unten laufen auf der nativen Form.
const V = resolve(vaultPfad());
let eingabe;
try { eingabe = JSON.parse(leseStdin()); } catch { process.exit(0); }
const F0 = eingabe?.tool_input?.file_path ?? eingabe?.tool_input?.notebook_path ?? "";
if (!F0) process.exit(0);
const cwd = eingabe?.cwd || process.cwd();

// Pfad normalisieren (.. und //), ohne dass die Datei existieren muss
let F = resolve(cwd, F0);

// Vault kanonisch (Symlinks aufgelöst) — Vergleichsbasis statt des rohen $V
let VN;
try { VN = realpathSync.native(V); } catch { VN = V; }
if (unter(F, V)) F = VN + F.slice(V.length);
else {
  // Zielpfad ebenfalls kanonisch machen (nächster existierender Vorfahr per realpath, Rest unverändert) — der
  // Vault kommt ohne BRAIN_VAULT aus dem Modulpfad (dort sind Symlinks wie /var → /private/var schon aufgelöst).
  let cur = F; const rest = [];
  for (;;) {
    try { F = join(realpathSync.native(cur), ...rest); break; } catch {}
    const eltern = dirname(cur); if (eltern === cur) break;
    rest.unshift(basename(cur)); cur = eltern;
  }
}

const { wiki } = ordner(V, ladeConfig(V));
const wikiDir = join(VN, wiki);

function blockiere(msg) { process.stderr.write(msg + "\n"); process.exit(2); }

if (gleich(F, join(VN, "INDEX.md")) || gleich(F, join(VN, "graph.json")) || gleich(F, join(wikiDir, "_index.md"))) {
  blockiere(`Brain-Riegel: ${F} ist generiert (Indexer) — nie von Hand editieren.`);
}

if (!unter(F, wikiDir)) process.exit(0);

// Generierte Ordner-Übersicht <wiki>/.../_<ordner>.md — immer verboten, auch mit Lock
const elternName = basename(dirname(F));
const dateiName = basename(F);
if (gleich(dateiName, `_${elternName}.md`)) {
  blockiere(`Brain-Riegel: ${F} ist eine generierte Ordner-Übersicht (Indexer) — nie von Hand editieren.`);
}

// Sonst: <wiki>/… nur mit frischem .logs/ingest.lock (< 30 min), dann auffrischen
const lockPfad = join(VN, ".logs", "ingest.lock");
if (existsSync(lockPfad)) {
  const alterMin = (Date.now() - statSync(lockPfad).mtimeMs) / 60000;
  if (alterMin <= 30) {
    const jetzt = new Date();
    try { utimesSync(lockPfad, jetzt, jetzt); } catch {}
    process.exit(0);
  }
}
blockiere(`Brain-Riegel: ${wiki} wird nur über /ingest verändert (kein frisches ingest.lock). Erst /ingest starten bzw. Lock nach User-Freigabe setzen.`);
