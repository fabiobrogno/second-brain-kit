#!/usr/bin/env node
// .tools/adapters/claude-code/install.mjs — Brain-Hooks in Claude Code ergänzen (fremde Hooks nie
// anfassen); ältere Brain-Einträge derselben Vault werden ersetzt bzw. entfernt (sie zeigen auf Dateien,
// die es nach dem Umzug nach .tools/adapters/claude-code/ nicht mehr gibt), idempotent, mit Backup.
import { readFileSync, writeFileSync, existsSync, copyFileSync, mkdirSync, mkdtempSync, rmSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir, tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { nodeBefehl } from "../../pfade.mjs";
// Gleiche Marke wie skills-build.mjs::schreibeGeneriert — hier erneut, weil die Commands jetzt erst in
// einen Temp-Ordner gerendert und danach HIER (nicht in skills-build.mjs) ins echte Ziel platziert werden,
// damit ein fremder, nicht markierter Command vor dem Überschreiben weiter gesichert wird.
const COMMANDS_MARKER = "<!-- brain-kit -->";
function platziereCommand(ziel, inhalt) {
  if (existsSync(ziel)) {
    let alt = "";
    try { alt = readFileSync(ziel, "utf8"); } catch {}
    if (!alt.includes(COMMANDS_MARKER)) {
      const bak = `${ziel}.bak-${new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15)}`;
      copyFileSync(ziel, bak);
      console.log(`Eigene Datei gesichert: ${bak} (ersetzt durch die Brain-Fassung)`);
    }
  }
  writeFileSync(ziel, inhalt);
}
function aufraeumen(tmp) { try { rmSync(tmp, { recursive: true, force: true }); } catch {} }

// Alles in EINER Funktion, strikt in zwei Phasen: Phase A liest/berechnet nur (settings.json parsen,
// neues settings-Objekt im Speicher bauen, Commands-Ziel prüfen, Commands in einen Temp-Ordner rendern) —
// schlägt IRGENDETWAS darin fehl, wurde GARANTIERT noch nichts Echtes geschrieben (weder settings.json
// noch ein fremder Command). Erst wenn Phase A komplett durchgelaufen ist, schreibt Phase B wirklich:
// zuerst die Commands (mit Fremd-Datei-Backup), dann settings.json. Schlägt etwas in Phase B fehl, ist
// das eine andere Lage (etwas kann da schon geschrieben sein) — die Meldung dort sagt das auch so.
// Der äußere try/catch ganz unten fängt jeden unerwarteten Rest ab (z. B. ein fremder Hook in unbekannter
// Form während Phase A) und meldet einen Alltagssatz statt eines Stacktrace.
function hauptlauf() {
const A = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2), vault = args[0];
const home = args.includes("--claude-home") ? args[args.indexOf("--claude-home") + 1] : join(homedir(), ".claude");
const commandsZiel = join(home, "commands");
const datei = join(home, "settings.json");

// ============================== Phase A: nur lesen/berechnen, nichts Echtes schreiben ==============

// A1: settings.json lesen + parsen — ZUERST, vor jedem Zugriff auf die Commands: ein kaputtes
// settings.json muss abbrechen, BEVOR irgendetwas anderes (auch ein fremder Command) angefasst wird.
let s;
if (existsSync(datei)) {
  let roh;
  try { roh = readFileSync(datei, "utf8"); s = JSON.parse(roh); }
  catch { console.error(`Die Datei ${datei} ist kein gültiges JSON — ich ändere nichts. Bitte zuerst reparieren.`); process.exit(1); }
} else s = {};
const vorher = JSON.stringify(s);

// A2: neues settings-Objekt komplett im Speicher berechnen (Hooks + Statusline) — s ist bis hierher nur
// ein JS-Objekt, noch keine Datei angefasst.
// Vorwärts-Schrägstriche auch auf Windows: node versteht beide, Shell-Quoting bleibt einfach
const pfad = (f) => `"${vault.split("\\").join("/")}/.tools/adapters/claude-code/${f}"`;
// Absoluter Node-Pfad (der, mit dem gerade installiert wird): ein frisch eingerichteter Rechner hat das
// private Node (~/.brain-kit/node) oft nicht im PATH, den Claude Code an Hooks weitergibt.
const NODE = nodeBefehl();
const soll = {
  SessionStart: `${NODE} ${pfad("session-start.mjs")}`,
  UserPromptSubmit: `${NODE} ${pfad("brain-hint.mjs")}`,
  PreToolUse: `${NODE} ${pfad("wiki-guard.mjs")}`,
  PreCompact: `echo 'Kontext-Kompression steht bevor: offenen Arbeitsstand sichern (Skill handoff).'`,
};

// Ältere Brain-Einträge derselben Vault erkennen (vor dem Umzug nach .tools/adapters/claude-code/):
// <vault>/.tools/<basis>.<ext> — nicht unter .tools/adapters/ — mit oder ohne Anführungszeichen, auch die
// unexpandierte $HOME/brain-Schreibweise, wenn <vault> genau homedir()/brain entspricht.
const escapeReg = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const vaultFwd = vault.split("\\").join("/");
const homeBrainFwd = join(homedir(), "brain").split("\\").join("/");
const vaultAliases = [vaultFwd];
if (vaultFwd === homeBrainFwd) vaultAliases.push("$HOME/brain");
function altMuster(basis, exts) {
  const alts = vaultAliases.map(escapeReg).join("|");
  const extAlt = exts.join("|");
  return new RegExp(`(?:^|["'\\s])(?:${alts})/\\.tools/${basis}\\.(?:${extAlt})(?=["'\\s]|$)`);
}
const alteMuster = {
  SessionStart: altMuster("session-start", ["sh", "mjs"]),
  UserPromptSubmit: altMuster("brain-hint", ["mjs"]),
  PreToolUse: altMuster("wiki-guard", ["sh", "mjs"]),
};
const alteStatusMuster = altMuster("statusline", ["sh", "mjs"]);

s.hooks ||= {};
const MARKER = "/.tools/adapters/claude-code/";
for (const [ev, cmd] of Object.entries(soll)) {
  const liste = (s.hooks[ev] ||= []);
  const datei2 = cmd.split("/").pop();
  // h.command fehlt bei fremden Hook-Formen ohne Kommandozeile (z. B. { type:"prompt", prompt:"…" } —
  // Claude Code kennt auch nicht-command-basierte Hooks). Solche Einträge sind fremd und bleiben
  // unangetastet: jeder Zugriff auf h.command ist deshalb mit typeof h.command === "string" abgesichert.
  const istAktuell = (h) => typeof h.command === "string" && (h.command === cmd || (h.command.includes(MARKER) && h.command.includes(datei2)));
  // Eigener Adapter-Eintrag DIESES Vaults mit anderem Aufruf (z. B. nacktes "node" statt absolutem Pfad) → auf
  // den aktuellen Befehl heben, statt ihn als „schon aktuell" stehen zu lassen.
  for (const eintrag of liste) for (const h of eintrag.hooks || []) {
    if (typeof h.command === "string" && h.command !== cmd && h.command.includes(`${vaultFwd}${MARKER}`) && h.command.includes(datei2)) {
      h.command = cmd; console.log(`~ Hook ${ev} aktualisiert`);
    }
  }
  let aktuellVorhanden = liste.some(x => x.hooks?.some(istAktuell));
  const alt = alteMuster[ev];
  let ersetzt = false, matcherAngepasst = false, entfernt = false;
  if (alt) {
    // Erster Treffer ohne aktuellen Eintrag wird in Ort und Stelle ersetzt (einer je Event genügt);
    // jeder weitere Treffer — auch wenn schon ein aktueller Eintrag da war — wird entfernt (die alten
    // Dateien existieren nach dem Umzug nach .tools/adapters/claude-code/ nicht mehr).
    for (const eintrag of liste) {
      if (!eintrag.hooks) continue;
      for (let i = eintrag.hooks.length - 1; i >= 0; i--) {
        const h = eintrag.hooks[i];
        if (typeof h.command !== "string" || !alt.test(h.command)) continue;
        if (!aktuellVorhanden && !ersetzt) {
          h.command = cmd;
          ersetzt = true;
          aktuellVorhanden = true;
          if (ev === "PreToolUse") {
            const ziel = "Edit|Write|MultiEdit|NotebookEdit";
            if (eintrag.matcher !== ziel) { eintrag.matcher = ziel; matcherAngepasst = true; }
          }
        } else {
          eintrag.hooks.splice(i, 1);
          entfernt = true;
        }
      }
    }
    for (let i = liste.length - 1; i >= 0; i--) {
      if (liste[i].hooks && liste[i].hooks.length === 0) liste.splice(i, 1);
    }
  }
  if (ersetzt) console.log(`~ Hook ${ev} ersetzt (alte Fassung${matcherAngepasst ? ", matcher angepasst" : ""})`);
  if (entfernt) console.log(`- Hook ${ev} entfernt (alte Fassung)`);
  if (!aktuellVorhanden) {
    liste.push(ev === "PreToolUse" ? { matcher: "Edit|Write|MultiEdit|NotebookEdit", hooks: [{ type: "command", command: cmd }] } : { hooks: [{ type: "command", command: cmd }] });
    console.log(`+ Hook ${ev}`);
  }
}
if (!args.includes("--ohne-statusline")) {
  const statusCmd = `${NODE} ${pfad("statusline.mjs")}`;
  if (!s.statusLine) { s.statusLine = { type: "command", command: statusCmd }; console.log("+ Statusline"); }
  else if (s.statusLine.command === statusCmd) { /* schon aktuell, idempotent still */ }
  else if (s.statusLine.command?.includes(`${vaultFwd}${MARKER}statusline.mjs`)) { s.statusLine.command = statusCmd; console.log("~ Statusline aktualisiert"); }
  else if (typeof s.statusLine.command === "string" && alteStatusMuster.test(s.statusLine.command)) { s.statusLine.command = statusCmd; console.log("~ Statusline ersetzt (alte Fassung)"); }
  else { console.log("Statusline vorhanden, nicht geändert"); }
}
const geaendert = JSON.stringify(s) !== vorher;

// A3: Commands-Ziel prüfen — nicht vorhanden oder ein Ordner ist in Ordnung, eine reguläre Datei nicht.
if (existsSync(commandsZiel) && !statSync(commandsZiel).isDirectory()) {
  console.error(`Der Ordner ${commandsZiel} für die Claude-Commands existiert bereits als Datei statt als Ordner — ich habe nichts an deinen Einstellungen geändert. Lösche oder benenne diese Datei um, dann noch einmal versuchen.`);
  process.exit(1);
}

// A4: Claude-Commands in einen frischen Temp-Ordner rendern (stdio abgefangen, kein roher Stacktrace
// mehr im Terminal, egal was skills-build.mjs dabei schiefgeht).
const commandsTemp = mkdtempSync(join(tmpdir(), "brain-commands-"));
let commandsAusgabe;
try {
  commandsAusgabe = execFileSync(process.execPath, [join(A, "..", "..", "skills-build.mjs"), vault, "--ziel", "claude-commands", commandsTemp], { windowsHide: true, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
} catch (e) {
  aufraeumen(commandsTemp);
  console.error("Die Claude-Commands konnten nicht erzeugt werden — ich habe nichts an deinen Einstellungen geändert.");
  process.exit(1);
}

// ============================== Phase B: jetzt wirklich schreiben (Phase A ist komplett durch) ======

// B1: Commands platzieren (mit Fremd-Datei-Backup-Logik). Schlägt das fehl, ist settings.json noch
// unangetastet — das sagt die Meldung auch so (die Commands können an dieser Stelle teilweise
// geschrieben sein, darum keine pauschale "nichts geändert"-Aussage mehr).
try {
  mkdirSync(commandsZiel, { recursive: true });
  for (const name of readdirSync(commandsTemp)) platziereCommand(join(commandsZiel, name), readFileSync(join(commandsTemp, name), "utf8"));
} catch (e) {
  aufraeumen(commandsTemp);
  console.error(`Die Claude-Commands unter ${commandsZiel} ließen sich gerade nicht vollständig schreiben — settings.json wurde NICHT geändert. Bitte sag deiner KI, es noch einmal zu versuchen.`);
  process.exit(1);
}
aufraeumen(commandsTemp);
if (commandsAusgabe.trim()) console.log(commandsAusgabe.trimEnd());
console.log(`Commands: ${commandsZiel}`);

// B2: settings.json schreiben. Schlägt das fehl, sind die Commands oben bereits geschrieben — die
// Meldung sagt das ausdrücklich, statt pauschal "nichts geändert" zu behaupten.
if (geaendert) {
  try {
    mkdirSync(home, { recursive: true });
    if (existsSync(datei)) { const b = `${datei}.bak-${new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15)}`; copyFileSync(datei, b); console.log(`Backup: ${b}`); }
    writeFileSync(datei, JSON.stringify(s, null, 2) + "\n");
  } catch (e) {
    console.error("Die Claude-Commands wurden aktualisiert, aber die Datei settings.json ließ sich gerade nicht schreiben — bitte sag deiner KI, es noch einmal zu versuchen.");
    process.exit(1);
  }
} else console.log("settings.json unverändert");
}

try {
  hauptlauf();
} catch (e) {
  console.error("Die Verbindung mit Claude Code ist unerwartet fehlgeschlagen — ich habe nichts an deinen Einstellungen geändert. Bitte sag deiner KI, dass die Installation hier abgebrochen ist.");
  process.exit(1);
}
