#!/usr/bin/env node
// install.mjs — richtet ein Second-Brain-Vault ein. Läuft gleich auf macOS, Windows und Linux (nur fs/path/
// execFileSync/spawnSync, nie eine Shell). Deterministisch und idempotent: nie Notizen überschreiben, nie
// abbrechen, wenn es vermeidbar ist — fehlende Voraussetzungen führen zu einer freundlichen Zeile +
// Degradierung (z. B. Suchprofil "minimal"), nicht zum Abbruch. Ausnahme: ein paar wenige, bewusst harte
// Abbrüche (gefährliches Ziel, kaputte Config, falscher Aufruf) — siehe pruefeZielSicherheit() unten.
// Technische Details gehen NUR nach ~/.brain-kit/install.log.
//
// Nutzung: node install.mjs <vault> [--agent claude-code|codex|keiner|auto] [--sprache de|en|auto]
//                                   [--profil minimal|leicht|voll|auto] [--backup github|ordner:<pfad>|keins]
// Flags dürfen vor oder nach dem Vault-Pfad stehen; genau EIN positionales Argument (der Vault) ist erlaubt.
import {
  existsSync, mkdirSync, cpSync, rmSync, readFileSync, writeFileSync, readdirSync, appendFileSync, realpathSync,
} from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { join, dirname, basename, resolve, relative, isAbsolute } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { homedir } from "node:os";

const K = dirname(fileURLToPath(import.meta.url)); // Kit-Wurzel: install.mjs, vorlage/, .tools/, lib/ liegen hier nebeneinander
const HEIM = process.env.BRAIN_KIT_HOME || join(homedir(), ".brain-kit");
const LOG = join(HEIM, "install.log");

function logDetail(text) {
  try { mkdirSync(HEIM, { recursive: true }); } catch {}
  try { appendFileSync(LOG, `${new Date().toISOString()} ${text}\n`); } catch {}
}
function melde(text) { console.log(text); logDetail(text); }

// --- Argumente: echtes Parsing (Flags vor ODER nach dem Vault-Pfad), Werte geprüft -----------
const BEKANNTE_FLAGS = {
  agent: ["auto", "claude-code", "codex", "keiner"],
  sprache: ["auto", "de", "en"],
  profil: ["auto", "minimal", "leicht", "voll"],
  backup: null, // Sonderprüfung unten (keins|github|ordner:<pfad>)
};
const NUTZUNG = "Nutzung: node install.mjs <vault-pfad> [--agent claude-code|codex|keiner|auto] [--sprache de|en|auto] [--profil minimal|leicht|voll|auto] [--backup github|ordner:<pfad>|keins]";
function usageFehler(warum) {
  console.error(warum);
  console.error(NUTZUNG);
  process.exit(64);
}
function parseArgumente(argv) {
  const werte = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const name = a.slice(2);
      if (!(name in BEKANNTE_FLAGS)) usageFehler(`Unbekanntes Flag: --${name}`);
      const wert = argv[++i];
      if (wert === undefined) usageFehler(`--${name} braucht einen Wert`);
      werte[name] = wert;
    } else positional.push(a);
  }
  if (positional.length !== 1) usageFehler(positional.length === 0 ? "Vault-Pfad fehlt" : "Nur ein Vault-Pfad ist erlaubt");
  for (const [name, erlaubt] of Object.entries(BEKANNTE_FLAGS)) {
    if (erlaubt && werte[name] !== undefined && !erlaubt.includes(werte[name])) usageFehler(`Ungültiger Wert für --${name}: ${werte[name]} (erlaubt: ${erlaubt.join("|")})`);
  }
  if (werte.backup !== undefined && werte.backup !== "keins" && werte.backup !== "github" && !werte.backup.startsWith("ordner:")) {
    usageFehler(`Ungültiger Wert für --backup: ${werte.backup} (erlaubt: keins|github|ordner:<pfad>)`);
  }
  if (werte.backup?.startsWith("ordner:")) {
    const pfadTeil = werte.backup.slice("ordner:".length);
    if (!pfadTeil) usageFehler("Ungültiger Wert für --backup: ordner: braucht einen Pfad (ordner:<pfad>)");
    werte.backup = `ordner:${resolve(pfadTeil)}`;
  }
  return {
    vault: positional[0],
    agent: werte.agent ?? "auto",
    sprache: werte.sprache ?? "auto",
    profil: werte.profil ?? "auto",
    backup: werte.backup ?? "keins",
  };
}
const { vault: vaultArg, agent: agentWahl, sprache: spracheWahl, profil: profilWahl, backup: backupWahl } = parseArgumente(process.argv.slice(2));
const vault = resolve(vaultArg);

// --- Sprache früh auflösen (alle folgenden Meldungen hängen daran) ---------------------------
function resolveSprache(wahl) {
  if (wahl !== "auto") return wahl;
  const locale = Intl.DateTimeFormat().resolvedOptions().locale || "en";
  return locale.toLowerCase().startsWith("de") ? "de" : "en";
}
const sprache = resolveSprache(spracheWahl);
// S("deutscher Satz", "english sentence") — kleiner Inline-Übersetzer statt einer separaten Tabelle,
// damit jede Meldung direkt neben ihrer Verwendung lesbar bleibt.
const S = (de, en) => (sprache === "en" ? en : de);

// --- Gefährliche Ziele ablehnen (hart, vor JEDER Dateisystem-Änderung) -----------------------
// Löst den nächsten EXISTIERENDEN Vorfahren über das NATIVE realpath (realpathSync.native, echter
// libc-Syscall) auf und hängt den noch nicht existierenden Rest unverändert wieder an (der kann kein
// Symlink/Case-Alias sein, er existiert ja nicht). realpathSync.native statt der reinen JS-Fassung,
// weil Letztere auf case-insensitiven Dateisystemen (Standard-APFS, NTFS) die EINGEGEBENE Groß-/
// Kleinschreibung nicht-symlink-artiger Komponenten durchreicht statt sie auf die echte Schreibweise
// zu normalisieren — "$T/KIT" und "$T/kit" lösten sonst auf unterschiedliche Strings auf, obwohl es
// auf der Platte derselbe Ordner ist, und die Vergleiche unten liefen ins Leere.
function nativesRealpath(p) {
  try { return realpathSync.native(p); } catch { return realpathSync(p); } // Fallback, falls .native fehlschlägt
}
function aufgeloesterPfad(pfad) {
  let cur = resolve(pfad);
  const rest = [];
  for (;;) {
    try { return rest.length ? join(nativesRealpath(cur), ...rest) : nativesRealpath(cur); } catch { /* existiert nicht/kein Zugriff */ }
    const eltern = dirname(cur);
    if (eltern === cur) return rest.length ? join(cur, ...rest) : cur; // Wurzel erreicht, nichts aufgelöst
    rest.unshift(basename(cur));
    cur = eltern;
  }
}
// Zusätzlich zur nativen Auflösung GROSS-/Kleinschreibung beim VERGLEICH ignorieren auf macOS/Windows
// (case-insensitive von Haus aus) — doppelt genäht: deckt auch Netzlaufwerke, andere Volumes/Mounts
// mit abweichendem Verhalten und den noch nicht existierenden Pfad-Rest ab, der realpath nie sieht.
const GROSS_KLEIN_EGAL = process.platform === "darwin" || process.platform === "win32";
function vglSchluessel(p) { return GROSS_KLEIN_EGAL ? p.toLowerCase() : p; }
function innerhalbOderGleich(basis, ziel) {
  const rel = relative(vglSchluessel(basis), vglSchluessel(ziel));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}
function istDateisystemWurzel(rohArg, aufgeloest) {
  if (/^[A-Za-z]:\\?$/.test(rohArg)) return true; // Windows-Laufwerksbuchstabe, unabhängig vom aktuellen OS geprüft
  return dirname(aufgeloest) === aufgeloest;
}
function pruefeZielSicherheit(vaultRoh, vaultAbs) {
  const ziel = aufgeloesterPfad(vaultAbs);
  const heim = aufgeloesterPfad(homedir());
  const kit = aufgeloesterPfad(K);
  if (vglSchluessel(ziel) === vglSchluessel(heim)) {
    melde(S(`Der Ordner ${vaultAbs} ist dein Home-Verzeichnis — dort richte ich kein Brain ein. Nimm einen Unterordner, z. B. Documents/Brain.`,
            `The folder ${vaultAbs} is your home directory — I won't set up a brain there. Use a subfolder, e.g. Documents/Brain.`));
    return false;
  }
  if (istDateisystemWurzel(vaultRoh, ziel)) {
    melde(S(`Der Ordner ${vaultAbs} ist das Wurzelverzeichnis deines Dateisystems — dort richte ich kein Brain ein.`,
            `The folder ${vaultAbs} is your filesystem's root — I won't set up a brain there.`));
    return false;
  }
  if (innerhalbOderGleich(kit, ziel)) {
    melde(S(`Der Ordner ${vaultAbs} ist der Installationsordner des Kits selbst — dort richte ich kein Brain ein. Nimm einen anderen Ordner, z. B. Documents/Brain.`,
            `The folder ${vaultAbs} is the kit's own installation folder — I won't set up a brain there. Use a different folder, e.g. Documents/Brain.`));
    return false;
  }
  if (innerhalbOderGleich(ziel, kit)) { // ziel ist Vorfahr des Kit-Ordners — .tools-Ersatz/erster Commit würden das Kit erfassen
    melde(S(`Der Ordner ${vaultAbs} enthält den Installationsordner des Kits — dort richte ich kein Brain ein. Nimm einen anderen Ordner, z. B. Documents/Brain.`,
            `The folder ${vaultAbs} contains the kit's own installation folder — I won't set up a brain there. Use a different folder, e.g. Documents/Brain.`));
    return false;
  }
  if (existsSync(join(vaultAbs, ".tools", "kit", "export.mjs"))) { // Quell-Vault (Entwicklung) — nie per Installation überschreiben
    melde(S(`Der Ordner ${vaultAbs} ist der Entwicklungs-Vault, aus dem das Kit gebaut wird — den richte ich nicht neu ein. Nimm einen anderen Ordner, z. B. Documents/Brain.`,
            `The folder ${vaultAbs} is the development vault the kit is built from — I won't set it up again. Use a different folder, e.g. Documents/Brain.`));
    return false;
  }
  if (innerhalbOderGleich(ziel, heim)) { // ziel ist Vorfahr von (oder gleich) heim
    melde(S(`Der Ordner ${vaultAbs} enthält dein gesamtes Home-Verzeichnis — dort richte ich kein Brain ein. Nimm einen Unterordner, z. B. Documents/Brain.`,
            `The folder ${vaultAbs} contains your entire home directory — I won't set up a brain there. Use a subfolder, e.g. Documents/Brain.`));
    return false;
  }
  let inhalt = [];
  try { inhalt = readdirSync(vaultAbs); } catch { inhalt = []; } // existiert nicht (noch) → kein Problem
  if (inhalt.length && !existsSync(join(vaultAbs, "brain.config.json"))) {
    // Exakter Wortlaut ist eine Controller-Vorgabe — bewusst sprachunabhängig (immer Deutsch), damit
    // er sich zuverlässig grep-en lässt, unabhängig vom aufgelösten --sprache. "Documents/Brain" (nicht
    // "Dokumente/Brain") — das ist der ECHTE Ordnername, siehe bootstrap.sh/.ps1-Kommentare.
    melde(`Der Ordner ${vaultAbs} ist nicht leer und kein Brain. Nimm einen neuen, leeren Ordner, z. B. Documents/Brain.`);
    return false;
  }
  return true;
}
if (!pruefeZielSicherheit(vaultArg, vault)) process.exit(1);

// --- Kaputte, bereits vorhandene brain.config.json: abbrechen, NICHTS umschreiben ------------
{
  const vorhandeneConfig = join(vault, "brain.config.json");
  if (existsSync(vorhandeneConfig)) {
    let kaputt = false, geparst;
    try { geparst = JSON.parse(readFileSync(vorhandeneConfig, "utf8")); } catch { kaputt = true; }
    // Gültiges JSON, aber kein Objekt (null/Array/Zahl/String/Bool) ist genauso wenig eine brauchbare
    // Config wie kaputtes JSON — cfg.irgendwas würde sonst später gegen einen Nicht-Objekt-Wert laufen.
    if (!kaputt && (geparst === null || typeof geparst !== "object" || Array.isArray(geparst))) kaputt = true;
    if (kaputt) {
      melde(S(`Die Einstellungsdatei brain.config.json in ${vault} ist beschädigt — ich ändere nichts. Sag „repariere meine Brain-Einstellungen“, dann schauen wir sie uns zusammen an.`,
              `The settings file brain.config.json in ${vault} is corrupted — I'm not changing anything. Say "fix my brain settings" so we can look at it together.`));
      process.exit(1);
    }
  }
}

// --- Hilfsfunktionen -------------------------------------------------------------------------
let pfadZusatz = [];
// Absoluter git-Pfad für diesen Lauf: bleibt "git" (PATH), bis sorgeFuerGit() unten ein frisch
// installiertes MinGit meldet — dann zeigt GIT auf dessen absoluten Ort. Kein Import aus
// .tools/werkzeug.mjs hier: diese Datei liegt im Kit-Baustelle-Unterbaum .tools/kit/repo/ und landet
// nach dem Export an einem ANDEREN relativen Ort (<ziel>/install.mjs) als ihre Quelle — ein einzelner
// relativer Importpfad könnte nicht an beiden Orten stimmen (siehe Kommentar bei lib/voraussetzungen.mjs).
let GIT = "git";
function laufendesEnv() {
  if (!pfadZusatz.length) return process.env;
  const sep = process.platform === "win32" ? ";" : ":";
  return { ...process.env, PATH: [...pfadZusatz, process.env.PATH || ""].join(sep) };
}
function git(cwd, ...args) {
  return execFileSync(GIT, ["-C", cwd, ...args], { encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "pipe"], env: laufendesEnv() });
}
function nodeSkript(skript, args = []) {
  return spawnSync(process.execPath, [skript, ...args], { encoding: "utf8", windowsHide: true, env: laufendesEnv() });
}
// brain.mjs liest den Vault NICHT aus argv (nur Unterbefehl + dessen Argumente) — nur BRAIN_VAULT/Default.
function brainBefehl(vault, args = []) {
  return spawnSync(process.execPath, [join(vault, ".tools", "brain.mjs"), ...args], {
    encoding: "utf8", windowsHide: true, env: { ...laufendesEnv(), BRAIN_VAULT: vault },
  });
}
// CLAUDE.md/GEMINI.md nie überschreiben, außer sie fehlen oder tragen noch genau unseren eigenen,
// unveränderten Verweis — eigene Inhalte der Person bleiben so garantiert erhalten.
function schreibeVerweisDatei(pfad) {
  const inhalt = "@AGENTS.md\n";
  let vorhanden = null;
  try { vorhanden = readFileSync(pfad, "utf8"); } catch {}
  if (vorhanden === null || vorhanden === inhalt) writeFileSync(pfad, inhalt);
}

async function main() {
  // --- Node-Version (nie abbrechen wäre hier sinnlos — ohne ≥20 läuft nichts zuverlässig) -----
  const nodeMajor = Number(process.versions.node.split(".")[0]);
  if (nodeMajor < 20) {
    melde(S(`Diese Node-Version (${process.versions.node}) ist zu alt — ich brauche mindestens 20. Bitte Node neu installieren (siehe INSTALL.md) und die Einrichtung erneut starten.`,
            `This Node version (${process.versions.node}) is too old — I need at least 20. Please reinstall Node (see INSTALL.md) and start the setup again.`));
    process.exit(1);
  }

  // --- git/qmd (nie abbrechen — degradieren statt scheitern) ------------------------------
  const { sorgeFuerGit, sorgeFuerQmd, werkzeugeGitAus, istPrivaterNode } = await import(pathToFileURL(join(K, "lib", "voraussetzungen.mjs")).href); // Windows: import() braucht file://-URL, kein C:-Pfad
  // Absoluter git-Ort fürs Config-Feld werkzeuge.git — nur gesetzt, wenn wir gerade selbst MinGit
  // installiert haben (private Werkzeuge): Laufzeit-Skripte (.tools/werkzeug.mjs) sollen dann genau
  // diesen Ort nutzen, statt sich auf ein PATH zu verlassen, das nach dieser Installation wieder anders aussieht.
  let werkzeugeGitPfad = null;
  try {
    const gitErgebnis = await sorgeFuerGit({
      // BRAIN_KIT_GIT_PLATTFORM/BRAIN_KIT_GIT_QUELLE/BRAIN_KIT_GIT_SIMULIERE_FEHLEND: wie
      // BRAIN_KIT_NODE_QUELLE/BRAIN_KIT_ARCHIV bewusste Testhaken — erzwingen den win32-MinGit-Zweig mit
      // einer lokalen Fixture-"Quelle" (keine echte Netz-Installation) UND überspringen den "git schon
      // vorhanden"-Kurzschluss (sonst nie erreichbar auf einer Maschine, die — wie jede, die dieses Kit
      // entwickelt — bereits ein echtes git hat), damit test-install.sh werkzeuge.git plattformunabhängig
      // prüfen kann. Wirken NUR hier (nicht auf process.platform selbst) — laufendesEnv()/resolveProfil()
      // etc. bleiben unberührt.
      plattform: process.env.BRAIN_KIT_GIT_PLATTFORM || process.platform,
      home: homedir(),
      quelle: process.env.BRAIN_KIT_GIT_QUELLE,
      ...(process.env.BRAIN_KIT_GIT_SIMULIERE_FEHLEND ? { habeGit: () => false } : {}),
    });
    if (gitErgebnis.satz) melde(gitErgebnis.satz);
    if (gitErgebnis.pathZusatz) pfadZusatz.push(...gitErgebnis.pathZusatz);
    werkzeugeGitPfad = werkzeugeGitAus(gitErgebnis);
    if (werkzeugeGitPfad) GIT = werkzeugeGitPfad;
    logDetail(`git: ${JSON.stringify(gitErgebnis)}`);
  } catch (e) { logDetail(`git-Einrichtung übersprungen: ${e?.message || e}`); }

  const { qmdBefehl } = await import(pathToFileURL(join(K, ".tools", "qmd-befehl.mjs")).href);
  const qb = qmdBefehl();
  let qmdProfil; // "leicht" (nutzbar) oder "minimal" (nicht nutzbar/nicht gewollt) — nie "voll", das ist Opt-in.
  if (process.env.BRAIN_KIT_OHNE_QMD) {
    qmdProfil = "minimal";
    logDetail("qmd: übersprungen (BRAIN_KIT_OHNE_QMD)");
  } else if (profilWahl === "minimal") {
    // Explizit angefordertes "minimal" lädt/installiert qmd erst gar nicht (nicht nur: nutzt es nicht).
    qmdProfil = "minimal";
    logDetail("qmd: übersprungen (--profil minimal angefordert)");
  } else {
    const schonDa = spawnSync(qb.cmd, [...qb.vorArgs, "--help"], { windowsHide: true, stdio: "ignore", env: laufendesEnv() }).status === 0;
    if (schonDa) { qmdProfil = "leicht"; logDetail("qmd: bereits vorhanden"); }
    else {
      melde(S("Ich lade die bessere Suche herunter (einmalig, ca. 300 MB) ...", "Downloading the better search now (one-time, about 300 MB) ..."));
      const r = sorgeFuerQmd({ home: homedir() });
      qmdProfil = r.profil;
      logDetail(`qmd-Einrichtung: ${JSON.stringify(r)}`);
      if (qmdProfil === "minimal") melde(S("Die bessere Suche ließ sich gerade nicht einrichten — die einfache Suche ist aktiv, das Brain funktioniert trotzdem.",
                                            "Couldn't set up the better search right now — the simple search is active, your brain still works fine."));
    }
  }

  // --- Profil/Agent auflösen (Sprache ist schon oben aufgelöst) ---------------------------
  function resolveProfil(wahl) {
    if (qmdProfil === "minimal") return "minimal"; // qmd nicht nutzbar/nicht gewollt → immer minimal
    if (wahl === "auto") return "leicht"; // v0.1: "voll" ist Opt-in, nie automatisch (auch bei viel RAM)
    if (wahl === "voll" && process.platform === "win32") {
      melde(S("Profil „voll“ ist unter Windows in dieser Version nicht verfügbar — ich nutze „leicht“.",
              "Profile \"voll\" isn't available on Windows in this release — using \"leicht\" instead."));
      return "leicht";
    }
    return wahl;
  }
  function resolveAgent(wahl) {
    if (wahl !== "auto") return wahl;
    if (existsSync(join(homedir(), ".claude"))) return "claude-code";
    if (existsSync(join(homedir(), ".codex"))) return "codex";
    return "keiner";
  }
  const profil = resolveProfil(profilWahl);
  const agent = resolveAgent(agentWahl);
  logDetail(`aufgelöst: agent=${agent} sprache=${sprache} profil=${profil} backup=${backupWahl}`);

  // --- Vault anlegen, Vorlage ohne Überschreiben kopieren ---------------------------------
  mkdirSync(vault, { recursive: true });
  cpSync(join(K, "vorlage"), vault, { recursive: true, force: false });

  // .tools: System-Dateien, immer ersetzt (nur innerhalb .tools/ geleert, nie der ganze Vault)
  const toolsZiel = join(vault, ".tools");
  if (existsSync(toolsZiel)) rmSync(toolsZiel, { recursive: true, force: true });
  cpSync(join(K, ".tools"), toolsZiel, { recursive: true });

  // --- brain.config.json ergänzen (nur sprache/suche.profil/backup bei ERSTINSTALLATION;
  // systemVersion wird bei JEDEM Lauf aktualisiert — Wiedereinrichten darf nie eine später manuell
  // geänderte Einstellung zurückdrehen) ----------------------------------------------------
  const configDatei = join(vault, "brain.config.json");
  const version = readFileSync(join(toolsZiel, "VERSION"), "utf8").trim();
  let erstinstallation;
  {
    let cfg = {};
    try { cfg = JSON.parse(readFileSync(configDatei, "utf8")); } catch { cfg = {}; }
    erstinstallation = !cfg.systemVersion;
    if (erstinstallation) {
      cfg.sprache = sprache;
      cfg.suche = { ...(cfg.suche || {}), profil };
      cfg.backup = backupWahl === "github" ? { art: "github" }
        : backupWahl.startsWith("ordner:") ? { art: "ordner", pfad: backupWahl.slice("ordner:".length) }
        : { art: "keins" };
    }
    cfg.systemVersion = version;
    // Private Werkzeuge: wenn dieser Lauf gerade MinGit installiert hat bzw. selbst unter einem privaten
    // Node läuft (bootstrap.sh → <HEIM>/node, ohne Admin-Rechte), den absoluten Ort in die Config schreiben —
    // Laufzeit-Skripte (.tools/werkzeug.mjs) finden ihn dann auch noch, wenn PATH später anders aussieht.
    // Nur ERGÄNZEND: ein bereits gesetzter Eintrag wird nie gelöscht, nur bei erneutem Treffer überschrieben.
    if (werkzeugeGitPfad) cfg.werkzeuge = { ...(cfg.werkzeuge || {}), git: werkzeugeGitPfad };
    if (istPrivaterNode(process.execPath, HEIM)) {
      cfg.werkzeuge = { ...(cfg.werkzeuge || {}), node: process.execPath.split("\\").join("/") };
    }
    writeFileSync(configDatei, JSON.stringify(cfg, null, 2) + "\n");
  }
  if (erstinstallation && backupWahl === "github") {
    melde(S("Jetzt richte ich die Online-Sicherung ein — gleich öffnet sich GitHub im Browser.",
            "Now setting up online backup — GitHub will open in your browser in a moment."));
  }

  // --- AGENTS.md (lokal, nie committet) + CLAUDE.md/GEMINI.md als Verweis — VOR dem ersten
  // Commit, damit CLAUDE.md/GEMINI.md darin landen; nie fremden Inhalt überschreiben. ------
  try {
    const agentsMd = join(vault, "AGENTS.md");
    const build = nodeSkript(join(toolsZiel, "skills-build.mjs"), [vault, "--ziel", "agents", agentsMd]);
    logDetail((build.stdout || "") + (build.stderr || ""));
    schreibeVerweisDatei(join(vault, "CLAUDE.md"));
    schreibeVerweisDatei(join(vault, "GEMINI.md"));
  } catch (e) { logDetail(`AGENTS.md/Verweise übersprungen: ${e?.message || e}`); }

  // --- git init, .gitignore, Hooks, erster Commit --------------------------------------
  try {
    if (!existsSync(join(vault, ".git"))) {
      git(vault, "init", "-q");
      melde(S("Ich lege die Versionsgeschichte deines Brains an.", "Setting up your brain's version history."));
    }
    const gitignoreQuelle = join(K, ".gitignore");
    const gitignoreZiel = join(vault, ".gitignore");
    if (existsSync(gitignoreQuelle) && !existsSync(gitignoreZiel)) cpSync(gitignoreQuelle, gitignoreZiel);

    const hooksLauf = nodeSkript(join(toolsZiel, "install-git-hooks.mjs"), [vault]);
    logDetail((hooksLauf.stdout || "") + (hooksLauf.stderr || ""));

    try { git(vault, "config", "user.email"); } catch { git(vault, "config", "user.email", "brain@localhost"); git(vault, "config", "user.name", "Second Brain"); }

    let hatCommit = true;
    try { git(vault, "log", "-1"); } catch { hatCommit = false; }
    if (!hatCommit) {
      // Nur für den ALLERERSTEN Commit eines frischen Vaults — install.mjs ruft git hier direkt auf
      // (nicht über einen Agenten/dessen git-guard), darum ist "--all" hier bewusst erlaubt und sogar
      // nötig: robust gegen gitignorte Top-Level-Einträge (AGENTS.md, ein zufälliges .DS_Store, …),
      // die ein explizit benannter "git add -- <pfad>" anders als "git add ."/"--all" hart ablehnen
      // würde, statt sie wie gewohnt still zu überspringen. Bestehende Vaults bekommen hier KEINEN
      // automatischen Commit (das bleibt Sache des Updates/der Person) — nur dieser Zweig committet.
      git(vault, "add", "--all");
      git(vault, "commit", "-q", "-m", "init: Second Brain eingerichtet");
      melde(S("Erster Stand deines Brains ist gesichert.", "Your brain's first snapshot is saved."));
    }
  } catch (e) { logDetail(`git-Einrichtung übersprungen: ${e?.message || e}`); }

  // --- qmd-Sammlung + Index auffrischen — nur wenn das GEWÄHLTE Profil qmd auch nutzt
  // (qmdProfil ist nur die Verfügbarkeit; jemand kann "minimal" bewusst wählen, obwohl qmd da wäre —
  // dann baut brain.mjs search() nie eine qmd-Anfrage, also lohnt sich die Sammlung hier nicht). --
  if (profil !== "minimal") {
    try {
      const liste = spawnSync(qb.cmd, [...qb.vorArgs, "collection", "list"], { encoding: "utf8", windowsHide: true, env: laufendesEnv() });
      if (!(liste.stdout || "").includes("brain")) {
        spawnSync(qb.cmd, [...qb.vorArgs, "collection", "add", vault, "--name", "brain"], { windowsHide: true, stdio: "ignore", env: laufendesEnv() });
      }
      const refresh = brainBefehl(vault, ["refresh"]);
      logDetail((refresh.stdout || "") + (refresh.stderr || ""));
    } catch (e) { logDetail(`Such-Sammlung übersprungen: ${e?.message || e}`); }
  }

  // --- Agent-Adapter -----------------------------------------------------------------------
  if (agent === "claude-code") {
    try {
      const r = nodeSkript(join(toolsZiel, "adapters", "claude-code", "install.mjs"), [vault]);
      logDetail((r.stdout || "") + (r.stderr || ""));
      melde(S("Claude Code ist mit deinem Brain verbunden.", "Claude Code is now connected to your brain."));
    } catch (e) { logDetail(`Claude-Code-Adapter übersprungen: ${e?.message || e}`); }
  } else if (agent === "codex") {
    try {
      const r = nodeSkript(join(toolsZiel, "skills-build.mjs"), [vault, "--ziel", "agents-skills", join(vault, ".agents", "skills")]);
      logDetail((r.stdout || "") + (r.stderr || ""));
      melde(S(`Öffne Codex direkt in diesem Ordner, dann liest es AGENTS.md automatisch: ${vault}`,
              `Open Codex directly in this folder, then it reads AGENTS.md automatically: ${vault}`));
    } catch (e) { logDetail(`Codex-Skills übersprungen: ${e?.message || e}`); }
  }

  // --- Abschluss: brain doctor, DANN die drei Sätze ganz am Ende --------------------------
  // Reihenfolge bewusst: die drei Sätze sind das Letzte, was die Person sieht (Spec §3.7 "danach drei
  // Sätze Anleitung, sonst nichts") — niemals doctor-Zeilen danach.
  try {
    const doctor = brainBefehl(vault, ["doctor"]);
    if (doctor.stdout) console.log(doctor.stdout.trimEnd());
    logDetail(doctor.stderr || "");
  } catch (e) { logDetail(`brain doctor übersprungen: ${e?.message || e}`); }
  melde(S("Sag mir einfach „merk dir …“. Frag mich, was du wissen willst. Sag „update mein Brain“, wenn es eine neue Version gibt.",
          "Just tell me 'remember this'. Ask me what you know about something, anytime. Say 'update my brain' when there's a new version."));
}

main().catch(e => {
  logDetail(`unerwarteter Fehler: ${e?.stack || e?.message || e}`);
  console.log(S("Die Einrichtung hat an einer Stelle nicht geklappt — Details stehen im Log. Sag deiner KI: „Die Brain-Installation ist fehlgeschlagen, schau ins Log.“",
                "Setup didn't fully work at some point — details are in the log. Tell your AI: 'The brain installation failed, check the log.'"));
  process.exit(1);
});
