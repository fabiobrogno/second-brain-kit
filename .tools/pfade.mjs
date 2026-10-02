// .tools/pfade.mjs — einzige Stelle, die weiß, wo der Vault liegt und wie seine Ordner heißen.
import { readFileSync, existsSync, realpathSync } from "node:fs";
import { join, dirname, resolve, delimiter, isAbsolute } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

// Diese Datei liegt immer unter <vault>/.tools/ — ihr Elternordner IST der Vault. Ohne Argument und ohne
// BRAIN_VAULT gilt deshalb der Vault, zu dem das gerade laufende Werkzeug gehört (nie ein fester ~/brain).
export const EIGENER_VAULT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function vaultPfad(argv = process.argv) {
  const arg = argv.slice(2).find(a => !a.startsWith("--"));
  return arg || process.env.BRAIN_VAULT || EIGENER_VAULT;
}
export function ladeConfig(vault) {
  const f = join(vault, "brain.config.json");
  if (!existsSync(f)) return {};
  // Kaputtes JSON darf nie einen Hook/Hintergrundprozess mit Stacktrace abschießen — lieber Defaults.
  // entferneBom: JSON.parse steckt ein UTF-8-BOM NICHT selbst weg (JSON.parse("﻿{}") wirft) — eine
  // mit PowerShell 5.1 (`Set-Content -Encoding UTF8`) gespeicherte Config hätte sonst immer {} zur Folge.
  try { return JSON.parse(entferneBom(readFileSync(f, "utf8"))); } catch { return {}; }
}
// Fehlt die Datei oder ist sie gültiges JSON → null (alles in Ordnung). Sonst eine kurze
// Fehlermeldung (ohne Stacktrace) — für Fund-/Statusmeldungen, die den Nutzer informieren,
// statt den Defekt still über ladeConfig()s {}-Fallback zu verschweigen.
export function configFehler(vault) {
  const f = join(vault, "brain.config.json");
  if (!existsSync(f)) return null;
  try { JSON.parse(entferneBom(readFileSync(f, "utf8"))); return null; }
  catch (e) { return String(e.message || e).split("\n")[0]; }
}
// Liest brain.config.json GENAU EINMAL (ein readFileSync) und liefert daraus alles, was ein Schreiber mit
// optimistischem Sperren braucht: `stand` (SHA-256-Hex der rohen Bytes — robuster als mtime, denn manche
// Dateisysteme wie HFS+/exFAT/FAT lösen nur auf 1-2 s auf und würden eine Änderung im selben Fenster
// verpassen), den BOM-bereinigten Text (für eine byte-/inhaltsgetreue Kopie VOR dem Schreiben) und die
// geparste Config bzw. einen Fehlertext. Ohne eine einzige gemeinsame Lese-Stelle müsste ein Schreiber die
// Datei mehrfach lesen (Fehlerprüfung, Stand, Inhalt) — zwischen zwei Lesevorgängen kann ein zweiter,
// nicht-atomarer Schreiber die Datei kurz kaputt/leer hinterlassen, und der zweite Lesevorgang sähe das
// nicht mehr. Fehlt die Datei: `stand` bleibt "0" (wie bisher), kein Fehler.
export function liesConfigRoh(vault) {
  const f = join(vault, "brain.config.json");
  if (!existsSync(f)) return { stand: "0", text: null, cfg: {}, fehler: null };
  let buf;
  try { buf = readFileSync(f); } catch { return { stand: "0", text: null, cfg: {}, fehler: null }; }
  const stand = createHash("sha256").update(buf).digest("hex");
  const text = entferneBom(buf.toString("utf8"));
  try { return { stand, text, cfg: JSON.parse(text), fehler: null }; }
  catch (e) { return { stand, text, cfg: null, fehler: String(e.message || e).split("\n")[0] }; }
}
// Zentrale Stelle für alle Leser von Markdown/Frontmatter: ein UTF-8-BOM (meist von PowerShell 5.1,
// `> datei.md` unter Windows) vor "---" lässt die Frontmatter-Regex sonst scheitern — das Frontmatter
// gilt dann als gewöhnlicher Text.
export function entferneBom(text) {
  return String(text).replace(/^﻿/, "");
}
export function ordner(vault, cfg = ladeConfig(vault)) {
  return {
    inbox: cfg.ordner?.inbox || "00_inbox",
    wiki: cfg.ordner?.wiki || cfg.wiki?.ordner || "09_wiki",
    archiv: cfg.ordner?.archiv || "90_archiv",
  };
}

// Ein Quell-Vault (Entwicklung) trägt die Kit-Baustelle samt Export-Werkzeug — er ist kein installierter
// Vault (keine systemVersion, nie per install.mjs/Skill update überschreiben).
export function istQuellVault(vault) {
  return existsSync(join(vault, ".tools", "kit", "export.mjs"));
}

const fwd = (p) => String(p).split("\\").join("/");
// Absolute, gequotete Programmpfade für gerenderte Befehle (AGENTS.md, Skills, Hook-Befehle): ein frisch
// eingerichteter Rechner hat das private Node/git oft NICHT im PATH — darum nie nackt "node"/"git".
// Bevorzugt ein stabiler PATH-Eintrag, der auf genau dieses Node zeigt (z. B. /opt/homebrew/bin/node statt des
// versionierten Cellar-Pfads, der nach einem Paket-Update verschwindet); sonst process.execPath selbst.
export function nodePfad() {
  const echt = (p) => { try { return realpathSync(p); } catch { return null; } };
  const ziel = echt(process.execPath);
  const namen = process.platform === "win32" ? ["node.exe"] : ["node"];
  for (const dir of String(process.env.PATH || "").split(delimiter)) {
    if (!dir || !isAbsolute(dir)) continue;
    for (const n of namen) { const p = join(dir, n); if (ziel && existsSync(p) && echt(p) === ziel) return p; }
  }
  return process.execPath;
}
export function nodeBefehl() { return `"${fwd(nodePfad())}"`; }
// Nur fürs RENDERN von Vorlagen (AGENTS.md, Skills) — ein gequoteter Anzeige-String, kein argv[0] für
// execFileSync/spawnSync (dafür gibt es gitBefehl() in .tools/werkzeug.mjs; zwei Funktionen mit demselben
// Namen für zwei verschiedene Zwecke wären verwirrend, darum hier umbenannt). Bevorzugt werkzeuge.git aus
// der Vault-Config (von install.mjs gesetzt), sonst den bekannten MinGit-Ort unter diesem Home (win32),
// sonst das nackte "git".
export function gitAnzeige({ cfg = {}, plattform = process.platform, home = homedir() } = {}) {
  if (typeof cfg?.werkzeuge?.git === "string" && cfg.werkzeuge.git) return `"${fwd(cfg.werkzeuge.git)}"`;
  if (plattform === "win32") {
    const mingit = join(home, ".brain-kit", "git", "cmd", "git.exe");
    if (existsSync(mingit)) return `"${fwd(mingit)}"`;
  }
  return "git";
}
// Platzhalter in Vorlagen (kit/AGENTS.md, skills/*/SKILL.md) — von skills-build.mjs UND doctor.mjs genutzt,
// damit „AGENTS.md aktuell?" exakt dasselbe Rendering vergleicht.
// Bedingte Blöcke: {{WENN:<automatik-schluessel>}}…{{/WENN}} — der Inhalt bleibt nur stehen, wenn
// cfg.automatik[<schluessel>] === true ist (z. B. die Ich-Karte-Zeile, nur wenn `ichKarte` eingeschaltet
// ist). Unbekannte/fehlende Schlüssel gelten als aus (Standard false) — nie werfen, nie als Platzhalter
// stehen bleiben (beide Zweige werden vollständig ersetzt, auch wenn der Schlüssel aus ist).
export function renderVorlage(text, vault) {
  const cfg = ladeConfig(vault);
  const o = ordner(vault, cfg);
  const an = cfg.automatik && typeof cfg.automatik === "object" && !Array.isArray(cfg.automatik) ? cfg.automatik : {};
  const bedingt = text.replace(/\{\{WENN:([A-Za-z0-9_]+)\}\}([\s\S]*?)\{\{\/WENN\}\}\n?/g,
    (_, schluessel, innen) => (an[schluessel] === true ? innen : ""));
  return bedingt.replaceAll("{{VAULT}}", fwd(vault)).replaceAll("{{INBOX}}", o.inbox).replaceAll("{{WIKI}}", o.wiki)
    .replaceAll("{{ARCHIV}}", o.archiv).replaceAll("{{NODE}}", nodeBefehl()).replaceAll("{{GIT}}", gitAnzeige({ cfg }));
}
