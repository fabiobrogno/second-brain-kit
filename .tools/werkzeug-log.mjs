// .tools/werkzeug-log.mjs — Werkzeug-Protokoll: hält Read-Zugriffe innerhalb des Vaults (für das
// Aufleuchten im Graphen) und MCP-Werkzeugnutzung (für die Ansicht, Task 3/C) in `.logs/werkzeug.log`
// fest. 0-Token-Regel: schreibt nur, gibt nie etwas aus, wirft nie. Nur Node-Standardbibliothek.
import { realpathSync } from "node:fs";
import { join, resolve, relative, dirname, basename, sep } from "node:path";
import { haengeAn, zeitstempel, leseZeilen } from "./logs.mjs";

// Vergleichsbasis für "innerhalb des Vaults?": unter darwin/win32 kleingeschrieben (case-insensitive
// Dateisysteme), sonst exakt — wie wiki-guard.mjs.
const FALTBAR = process.platform === "darwin" || process.platform === "win32";

// Nächsten existierenden Vorfahren per realpath auflösen (Symlinks im Vault-Ast), Rest unverändert
// anhängen — so werden auch (noch) nicht existierende Pfade kanonisch (gleiches Muster wie in
// wiki-guard.mjs). Wirft nie: ohne jeden auflösbaren Vorfahren bleibt der Eingabepfad unverändert.
function kanonisch(pfad) {
  let cur = pfad;
  const rest = [];
  for (;;) {
    try { return join(realpathSync.native(cur), ...rest); } catch {}
    const eltern = dirname(cur);
    if (eltern === cur) return pfad;
    rest.unshift(basename(cur));
    cur = eltern;
  }
}

// null, falls `datei` nicht unter `vault` liegt — sonst der Vault-relative Pfad, "/" als Trenner.
function vaultRelativ(vault, datei) {
  const V = kanonisch(resolve(vault));
  const D = kanonisch(resolve(datei));
  const Vc = FALTBAR ? V.toLowerCase() : V;
  const Dc = FALTBAR ? D.toLowerCase() : D;
  if (Dc !== Vc && !Dc.startsWith(Vc + sep)) return null;
  return relative(V, D).split(sep).join("/");
}

// mcp__<server>__<werkzeug> — Server-/Werkzeugnamen selbst tragen nur einzelne Unterstriche, der
// doppelte Unterstrich ist der Trenner; nicht-gierig genügt darum links wie rechts.
const MCP_MUSTER = /^mcp__(.+?)__(.+)$/;

// Read mit toolInput.file_path innerhalb des Vaults → "lesen" (ziel = vault-relativer Pfad, "/",
// URI-kodiert); mcp__<server>__<werkzeug> → "mcp" (ziel = "<server>/<werkzeug>", URI-kodiert); alles
// andere → keine Zeile. Rückgabe: ob geschrieben wurde.
export function protokolliere(vault, { sid, toolName, toolInput } = {}) {
  let art, ziel;
  if (toolName === "Read" && toolInput && typeof toolInput.file_path === "string" && toolInput.file_path) {
    const rel = vaultRelativ(vault, toolInput.file_path);
    if (rel == null) return false;
    art = "lesen";
    ziel = encodeURIComponent(rel);
  } else {
    const m = MCP_MUSTER.exec(String(toolName || ""));
    if (!m) return false;
    art = "mcp";
    ziel = encodeURIComponent(`${m[1]}/${m[2]}`);
  }
  const sidSauber = String(sid || "ohne").replace(/[^\w-]/g, "").slice(0, 64) || "ohne";
  haengeAn(join(vault, ".logs", "werkzeug.log"), `${zeitstempel()} sid=${sidSauber} art=${art} ziel=${ziel}`, { max: 5000, behalte: 2500 });
  return true;
}

// Nur art=lesen, neueste zuerst, max 200 — Grundlage für das Aufleuchten in der Ansicht.
export function leseGelesen(vault, seitMs = 0) {
  return leseZeilen(join(vault, ".logs", "werkzeug.log"), { seitMs })
    .filter((z) => z.art === "lesen")
    .reverse()
    .slice(0, 200);
}
