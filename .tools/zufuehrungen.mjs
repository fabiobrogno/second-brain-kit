#!/usr/bin/env node
// .tools/zufuehrungen.mjs — Wächter für Zuführungen (Connectors, Importordner, Sammelstellen): erkennt Quellen, die
// still stehen (Pfad weg, keine Leserechte, lange kein neuer Inhalt) und sagt es — nie still.
// Zuführungen stehen in brain.config.json:  "zufuehrungen": [{ "name": "Notizen-Sync", "pfad": "~/Sync/notizen", "maxAlterTage": 7 }]
//   pfad          absolut, mit „~/“ oder relativ zum Vault (Datei oder Ordner)
//   maxAlterTage  ab so vielen Tagen ohne neuen Inhalt gilt die Quelle als still (Standard 7)
// „Letzter erfolgreicher Lauf“ = jüngste Änderungszeit der Datei bzw. im Ordner (bis 2 Ebenen tief, höchstens 500 Einträge)
// — ein Connector, der lief, hat dort etwas abgelegt. Das Prüfen kostet keine Tokens und ändert nichts an den Quellen.
//
// Statusdatei `.logs/zufuehrungen.json` (die App liest sie für das ⚠ in der Menüleiste):
//   { "version": 1, "erstellt": "2026-10-28T09:00:00Z", "probleme": 1,
//     "zufuehrungen": [{ "name": "…", "pfad": "…", "status": "ok|fehlt|nicht-lesbar|still|config",
//                        "letzterLauf": "2026-10-20T08:00:00Z" | null, "alterTage": 8 | null, "maxAlterTage": 7 }] }
//   `probleme` = Zahl der Einträge mit status ≠ ok; ⚠ anzeigen, sobald probleme > 0.
// CLI: node .tools/zufuehrungen.mjs [--json] [vault]   (schreibt die Statusdatei; Exit 1 nur, wenn das Schreiben scheitert)
import { readdirSync, statSync, lstatSync, openSync, closeSync, writeFileSync, renameSync, unlinkSync, mkdirSync, realpathSync } from "node:fs";
import { join, dirname, isAbsolute, resolve } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { vaultPfad, ladeConfig } from "./pfade.mjs";

export const STATUS_DATEI = (vault) => join(vault, ".logs", "zufuehrungen.json");
export const STANDARD_MAX_ALTER_TAGE = 7;
const TAG_MS = 86400000, MAX_EINTRAEGE = 500, MAX_TIEFE = 2;
const iso = (ms) => new Date(ms).toISOString().slice(0, 19) + "Z";

function aufloesen(vault, pfad) {
  if (pfad === "~" || /^~[\\/]/.test(pfad)) return join(homedir(), pfad.slice(1));
  return isAbsolute(pfad) ? pfad : resolve(vault, pfad);
}
const kein = (e) => e && (e.code === "EACCES" || e.code === "EPERM");

// Jüngste Änderungszeit unter `ziel` (Datei: ihre eigene). Wirft, wenn `ziel` selbst nicht lesbar ist.
function juengsteAenderung(ziel, st) {
  let neu = st.mtimeMs;
  if (!st.isDirectory()) { closeSync(openSync(ziel, "r")); return neu; }
  let zaehler = 0;
  const lauf = (dir, tiefe, erster) => {
    let namen;
    try { namen = readdirSync(dir, { withFileTypes: true }); } catch (e) { if (erster) throw e; return; }
    for (const d of namen) {
      if (++zaehler > MAX_EINTRAEGE) return;
      const p = join(dir, d.name);
      try {
        const s = lstatSync(p);
        if (s.mtimeMs > neu) neu = s.mtimeMs;
        if (d.isDirectory() && tiefe < MAX_TIEFE) lauf(p, tiefe + 1, false);
      } catch { /* einzelner Eintrag weg/unlesbar → übergehen */ }
    }
  };
  lauf(ziel, 1, true);
  return neu;
}

// → { version, erstellt, probleme, zufuehrungen[] }. `lesbar(pfad)` ist ein Testhaken für entzogene Rechte (root liest alles).
export function pruefeZufuehrungen(vault, { jetzt = Date.now(), lesbar = null, cfg = ladeConfig(vault) } = {}) {
  const roh = cfg && Array.isArray(cfg.zufuehrungen) ? cfg.zufuehrungen : [];
  const zufuehrungen = roh.map((z, i) => {
    const name = z && typeof z.name === "string" && z.name.trim() ? z.name.trim() : `Eintrag ${i + 1}`;
    const pfad = z && typeof z.pfad === "string" ? z.pfad.trim() : "";
    const max = Number(z && z.maxAlterTage);
    const maxAlterTage = Number.isFinite(max) && max > 0 ? max : STANDARD_MAX_ALTER_TAGE;
    const ergebnis = (status, extra = {}) => ({ name, pfad, status, letzterLauf: null, alterTage: null, maxAlterTage, ...extra });
    if (!pfad) return ergebnis("config");
    const voll = aufloesen(vault, pfad);
    let st;
    try { st = statSync(voll); } catch (e) { return ergebnis(kein(e) ? "nicht-lesbar" : "fehlt"); }
    if (lesbar && !lesbar(voll)) return ergebnis("nicht-lesbar");
    let neu;
    try { neu = juengsteAenderung(voll, st); } catch (e) { return ergebnis(kein(e) ? "nicht-lesbar" : "fehlt"); }
    const alterTage = Math.max(0, Math.floor((jetzt - neu) / TAG_MS));
    return ergebnis(alterTage >= maxAlterTage ? "still" : "ok", { letzterLauf: iso(neu), alterTage });
  });
  return { version: 1, erstellt: iso(jetzt), probleme: zufuehrungen.filter((z) => z.status !== "ok").length, zufuehrungen };
}

// Atomar schreiben; wirft bei Fehlern (der Aufrufer meldet sie, nichts wird verschluckt).
export function schreibeStatus(vault, status) {
  const ziel = STATUS_DATEI(vault);
  mkdirSync(dirname(ziel), { recursive: true });
  const tmp = `${ziel}.${process.pid}.tmp`;
  try {
    writeFileSync(tmp, JSON.stringify(status, null, 2) + "\n");
    renameSync(tmp, ziel);
  } catch (e) {
    try { unlinkSync(tmp); } catch {} // keine .tmp-Reste liegen lassen
    throw e;
  }
}

export function statusText(status) {
  if (!status.zufuehrungen.length) return "Zuführungen: keine eingetragen.";
  const z = [`Zuführungen: ${status.probleme ? `${status.probleme} von ${status.zufuehrungen.length} mit Problem` : "alle in Ordnung"}.`];
  for (const e of status.zufuehrungen) z.push(`- ${e.name}: ${e.status}${e.alterTage != null ? ` (letzter Lauf vor ${e.alterTage} ${e.alterTage === 1 ? "Tag" : "Tagen"})` : ""}`);
  return z.join("\n");
}

const selbst = fileURLToPath(import.meta.url);
let aufruf = "";
try { aufruf = realpathSync(process.argv[1] || ""); } catch {}
if (aufruf && aufruf === realpathSync(selbst)) {
  const vault = vaultPfad();
  const status = pruefeZufuehrungen(vault);
  try { schreibeStatus(vault, status); }
  catch (e) { console.error(`Statusdatei nicht schreibbar: ${String(e.message || e).split("\n")[0]}`); process.exit(1); }
  console.log(process.argv.includes("--json") ? JSON.stringify(status) : statusText(status));
}
