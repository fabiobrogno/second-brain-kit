#!/usr/bin/env node
// Hintergrund-Teil von SessionStart (läuft als eigener, losgelöster Prozess — session-start.mjs wartet nicht
// darauf). Reihenfolge wie bisher: AGENTS.md, Index, Refresh, Suchdienst (falls eingeschaltet), Lint-Cache,
// Push, Memory-Sync (nur wenn module.claudeMemory). Fehler landen im Log, blockieren aber nie.
// Schalter (automatik): sicherungTaeglich=false → keine Sicherung; updateHinweis=false → kein Update-Check.
// BRAIN_ERNTE=1 (Selbstaufruf der Ernte) → nichts tun.
if (process.env.BRAIN_ERNTE === "1") process.exit(0);
// Kit-Module erst nach dieser Prüfung laden (dynamisches import) — statische Importe würden vorher ausgewertet.
import { appendFileSync, existsSync, statSync, readdirSync, renameSync, mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { spawn, spawnSync } from "node:child_process";
const { vaultPfad, ladeConfig } = await import("../../pfade.mjs");
const { gitBefehl } = await import("../../werkzeug.mjs");
const { pruefeUpdate, schreibeBereitMarke } = await import("../../update-check.mjs");
const { leseAutomatik } = await import("../../einstellungen.mjs");

const T = dirname(fileURLToPath(import.meta.url));
const TOOLS = join(T, "..", "..");
const V = vaultPfad();
const LOG = join(V, ".logs", "hooks.log");
// EIN git-Pfad für die ganze Datei — gilt auch für die Aufrufe gegen ~/.claude unten (dort geht es nur um
// den WERKZEUG-Ort, nicht um das Zielrepo).
const GIT = gitBefehl({ cfg: ladeConfig(V) });
const AUTOMATIK = leseAutomatik(V).werte;

function log(text) {
  if (!text) return;
  try { appendFileSync(LOG, text.endsWith("\n") ? text : text + "\n"); } catch {}
}
function node(script, args = []) {
  const r = spawnSync(process.execPath, [join(TOOLS, script), ...args], { encoding: "utf8", windowsHide: true });
  log((r.stdout || "") + (r.stderr || ""));
  return r;
}

// AGENTS.md ist nicht getrackt (maschinenlokaler, absoluter Vault-Pfad) — jede Sitzung erzeugt sie neu
// aus der Vorlage (.tools/kit/AGENTS.md), damit sie nie veraltet oder fehlt.
node("skills-build.mjs", [V, "--ziel", "agents", join(V, "AGENTS.md")]);
node("brain-index.mjs", [V]);
node("search-refresh.mjs", [V]);

// Suchdienst (Reranker) nur, wenn eingeschaltet (hinweis.rerankSchwelle) — er verhindert Doppelstarts selbst
try {
  const cfg = ladeConfig(V);
  if (cfg.hinweis?.rerankSchwelle != null) {
    const haengtMarke = join(V, ".logs", "dienst-haengt");
    const frischHaengt = existsSync(haengtMarke) && (Date.now() - statSync(haengtMarke).mtimeMs) / 60000 < 10;
    if (!frischHaengt) {
      const kind = spawn(process.execPath, [join(TOOLS, "suchdienst.mjs"), V], { detached: true, stdio: "ignore", windowsHide: true });
      kind.unref();
    }
  }
} catch (e) { log(`Hinweis: Suchdienst-Start übersprungen (${e.message})`); }

// Lint-Cache atomar schreiben (Temp + rename statt "$$"-Suffix + mv)
try {
  mkdirSync(join(V, ".logs"), { recursive: true });
  const r = spawnSync(process.execPath, [join(TOOLS, "brain-lint.mjs"), V], { encoding: "utf8", windowsHide: true });
  log(r.stderr || "");
  const ziel = join(V, ".logs", "lint-cache.txt");
  const tmp = `${ziel}.${process.pid}`;
  writeFileSync(tmp, r.stdout || "");
  renameSync(tmp, ziel);
} catch (e) { log(`Hinweis: Lint-Cache übersprungen (${e.message})`); }

// Pflegebericht (v0.4) losgelöst vom Sitzungsstart rechnen → .logs/pflege-bericht.json; der NÄCHSTE Sitzungsstart
// liest daraus die Wochen-Zeile ohne Wartezeit (W1-Review #6). Neu gerechnet wird nur bei geändertem Vault.
if (AUTOMATIK.wochenbericht !== false) node("pflege.mjs", [V, "--cache"]);

// Lernschleife (Treffsicherheit, 0 Tokens): einmal pro Woche „Frage → Seite“-Vorschläge aus Lücken/Fragespur und
// werkzeug.log. Nur mit Schalter luecken — ohne ihn gibt es keine Fragen-Stichwörter.
if (AUTOMATIK.luecken) node("lernschleife.mjs", [V, "--woche"]);

// Sicherung (ersetzt reines git push): brain backup regelt github/ordner/keins. Rückwärtskompatibel:
// fehlt backup in der Config, aber es ist bereits ein Git-Remote eingerichtet, pushen wir wie bisher
// (altes Verhalten vor dieser Sicherung-Funktion bleibt für bestehende Vaults unverändert).
// Ordner-Sicherung höchstens 1x/Tag: sonst würde bei jedem SessionStart ein neues Bundle geschrieben.
if (AUTOMATIK.sicherungTaeglich !== false) try {
  const cfg = ladeConfig(V);
  if (!cfg.backup) {
    const remote = spawnSync(GIT, ["-C", V, "remote"], { encoding: "utf8", windowsHide: true });
    if ((remote.stdout || "").trim()) {
      const r = spawnSync(GIT, ["-C", V, "push", "-q"], { encoding: "utf8", windowsHide: true });
      log((r.stdout || "") + (r.stderr || ""));
    }
  } else if (
    cfg.backup.art === "ordner" && cfg.backup.pfad &&
    existsSync(join(cfg.backup.pfad, `brain-${new Date().toISOString().slice(0, 10)}.bundle`))
  ) {
    // heute schon gesichert — überspringen
  } else {
    node("brain.mjs", ["backup"]);
  }
} catch (e) { log(`Hinweis: Sicherung übersprungen (${e.message})`); }

// Memory-Sync: ungesicherte Memory-Writes (auch fremder Sessions) committen + pushen — nur wenn module.claudeMemory
try {
  const cfg = ladeConfig(V);
  if (cfg.module?.claudeMemory) {
    const claudeDir = join(homedir(), ".claude");
    if (existsSync(join(claudeDir, ".git"))) {
      const projDir = join(claudeDir, "projects");
      if (existsSync(projDir)) {
        for (const proj of readdirSync(projDir)) {
          const memDir = join(projDir, proj, "memory");
          if (existsSync(memDir)) {
            const r = spawnSync(GIT, ["-C", claudeDir, "add", memDir], { encoding: "utf8", windowsHide: true });
            log((r.stdout || "") + (r.stderr || ""));
          }
        }
      }
      const diff = spawnSync(GIT, ["-C", claudeDir, "diff", "--cached", "--quiet"], { windowsHide: true });
      if (diff.status !== 0) {
        const commit = spawnSync(GIT, ["-C", claudeDir, "commit", "-qm", "auto: memory-sync (SessionStart)"], { encoding: "utf8", windowsHide: true });
        log((commit.stdout || "") + (commit.stderr || ""));
      }
      const push = spawnSync(GIT, ["-C", claudeDir, "push", "-q"], { encoding: "utf8", windowsHide: true });
      log((push.stdout || "") + (push.stderr || ""));
    }
  }
} catch (e) { log(`Hinweis: Memory-Sync übersprungen (${e.message})`); }

// Update-Hinweis (Spec §3.9): höchstens 1x/24h geprüft (pruefeUpdate cached selbst), nie blockierend.
// update.auto:true → nur die Marke schreiben, NICHTS automatisch ausführen — das macht der Agent über
// den Skill "update" (kein Code führt fremden Release-Inhalt selbst aus).
if (AUTOMATIK.updateHinweis !== false) try {
  const erg = await pruefeUpdate(V);
  log(`Update-Check: ${JSON.stringify(erg)}`);
  const cfg = ladeConfig(V);
  if (erg.neuer && cfg.update?.auto) schreibeBereitMarke(V, erg.neueste);
} catch (e) { log(`Hinweis: Update-Check übersprungen (${e.message})`); }
