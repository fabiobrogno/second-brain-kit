// .tools/pfade.mjs — einzige Stelle, die weiß, wo der Vault liegt und wie seine Ordner heißen.
import { readFileSync, existsSync, realpathSync } from "node:fs";
import { join, dirname, resolve, delimiter, isAbsolute } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

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
  try { return JSON.parse(readFileSync(f, "utf8")); } catch { return {}; }
}
// Fehlt die Datei oder ist sie gültiges JSON → null (alles in Ordnung). Sonst eine kurze
// Fehlermeldung (ohne Stacktrace) — für Fund-/Statusmeldungen, die den Nutzer informieren,
// statt den Defekt still über ladeConfig()s {}-Fallback zu verschweigen.
export function configFehler(vault) {
  const f = join(vault, "brain.config.json");
  if (!existsSync(f)) return null;
  try { JSON.parse(readFileSync(f, "utf8")); return null; }
  catch (e) { return String(e.message || e).split("\n")[0]; }
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
export function renderVorlage(text, vault) {
  const cfg = ladeConfig(vault);
  const o = ordner(vault, cfg);
  return text.replaceAll("{{VAULT}}", fwd(vault)).replaceAll("{{INBOX}}", o.inbox).replaceAll("{{WIKI}}", o.wiki)
    .replaceAll("{{ARCHIV}}", o.archiv).replaceAll("{{NODE}}", nodeBefehl()).replaceAll("{{GIT}}", gitAnzeige({ cfg }));
}
