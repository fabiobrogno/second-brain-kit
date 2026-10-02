#!/usr/bin/env node
// .tools/brain.mjs — ein Einstieg für alle Agenten und Menschen. Kein Agent-spezifischer Code hier.
// Befehle: index | search "<frage>" [n] | lint | ingest-check <datei> | refresh | hooks-install | version
// Skill-Helfer (statt POSIX-Shell, laufen gleich auf macOS/Windows/Linux): lock | unlock | sha <datei> | jetzt | review-erledigt
// Exit-Codes: 0 ok, 2 Befunde (lint) / unbekannte Option (zeig), 3 Secrets (ingest-check), 64 falscher Aufruf.
import { execFileSync, spawnSync, spawn } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, statSync, rmSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { vaultPfad, ladeConfig } from "./pfade.mjs";
import { findeSecrets } from "./secrets-muster.mjs";
import { minisuche } from "./minisuche.mjs";
import { qmdBefehl } from "./qmd-befehl.mjs";
import { parseQmdDateien } from "./qmd-ausgabe.mjs";
import { oeffnerAufruf } from "./oeffner.mjs";

const T = dirname(fileURLToPath(import.meta.url));
const [befehl, ...rest] = process.argv.slice(2);
// Kein Argv-Vault: brain.mjs bekommt Unterbefehl + dessen Argumente, keinen Vault-Pfad — nur
// BRAIN_VAULT bzw. der Vault, in dem diese Datei liegt, zählen hier (Positionsargumente gehen an die Werkzeuge in index/lint/refresh).
const vault = vaultPfad(["", ""]);
const b = qmdBefehl();

const node = (skript, ...a) => spawnSync(process.execPath, [join(T, skript), ...a], { stdio: "inherit", windowsHide: true }).status ?? 1;
const hatQmd = () => spawnSync(b.cmd, [...b.vorArgs, "--help"], { stdio: "ignore", windowsHide: true }).error === undefined;

function suche(frage, n = "5") {
  if (!frage) { console.error("Nutzung: brain search \"<frage>\" [anzahl]"); return 64; }
  let profil = ladeConfig(vault).suche?.profil || "leicht";
  if (profil !== "minimal" && !hatQmd()) {
    console.error("Hinweis: Die bessere Suche ist noch nicht installiert — ich nutze die einfache Suche.");
    profil = "minimal";
  }
  if (profil === "minimal") {
    minisuche(vault, frage, Number(n)).forEach(t => console.log(`${t.score.toFixed(4)},${t.pfad}`));
    return 0;
  }
  const lauf = (art) => {
    try {
      return execFileSync(b.cmd, [...b.vorArgs, art, frage, "-c", "brain", "-n", n, "--files"], {
        encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], windowsHide: true,
      });
    } catch { return ""; }
  };
  if (profil === "voll") {
    parseQmdDateien(lauf("query")).slice(0, Number(n)).forEach(t => console.log(`${t.score.toFixed(4)},${t.pfad}`));
    return 0;
  }
  // leicht: BM25 + Vektor, per Reciprocal Rank Fusion gemischt, ohne LLM-Reranker.
  const rang = new Map();
  for (const art of ["search", "vsearch"]) {
    parseQmdDateien(lauf(art)).forEach((t, i) => {
      rang.set(t.pfad, (rang.get(t.pfad) || 0) + 1 / (60 + i));
    });
  }
  [...rang].sort((a, b) => b[1] - a[1]).slice(0, Number(n)).forEach(([p, s]) => console.log(`${s.toFixed(4)},${p}`));
  return 0;
}

// Öffnet eine Datei im Standardprogramm des Systems (Browser bei .html) — detached + unref, damit
// brain.mjs sich nicht am geöffneten Programm festhält. Der Rückgabewert des Aufrufs selbst beweist noch
// keinen Erfolg: ein fehlendes Öffner-Programm (z. B. xdg-open ohne Desktop-Umgebung) wirft NICHT synchron,
// das ENOENT kommt ausschließlich asynchron über das "error"-Event — darum hier auf "spawn" (Erfolg) bzw.
// "error" (Scheitern) warten, mit kurzem Timeout-Fallback als Kompromiss zwischen Robustheit und der
// Forderung, den Prozess nicht unnötig am Leben zu halten (keins der beiden Events kommt rechtzeitig →
// optimistisch true). BRAIN_OEFFNER: reiner Testhaken, ersetzt das Öffner-Programm (z. B. durch einen
// garantiert nicht existierenden Pfad), damit Tests den Scheitern-Pfad auslösen können, ohne einen echten
// Browser zu öffnen.
// Welches Programm mit welchen Argumenten: .tools/oeffner.mjs (Windows über rundll32 statt explorer.exe).
function oeffneDatei(datei, timeoutMs = 250) {
  const { cmd, args } = oeffnerAufruf({ datei, url: pathToFileURL(datei).href }, process.platform, process.env.BRAIN_OEFFNER || "");
  return new Promise((resolve) => {
    let entschieden = false;
    const entscheide = (ok) => { if (entschieden) return; entschieden = true; clearTimeout(timer); resolve(ok); };
    let kind;
    try { kind = spawn(cmd, args, { detached: true, stdio: "ignore", windowsHide: true }); }
    catch { entscheide(false); return; }
    kind.on("spawn", () => entscheide(true));
    kind.on("error", () => entscheide(false));
    const timer = setTimeout(() => entscheide(true), timeoutMs);
    kind.unref();
  });
}

// „brain zeig" — erzeugt die Daten für die 3D-Ansicht (Task 1: .tools/ansicht/daten.mjs) und öffnet
// .tools/ansicht/index.html im Browser. --nur-daten: nur erzeugen, nichts öffnen, Seitenzahl drucken.
// --nicht-oeffnen: erzeugen, Pfad drucken, aber nicht öffnen (für Tests/Skripte, ohne Browser-Fenster).
async function zeig(...args) {
  const bekannt = new Set(["--nur-daten", "--nicht-oeffnen"]);
  const unbekannt = args.filter(a => !bekannt.has(a));
  if (unbekannt.length) {
    console.error(`Unbekannte Option: ${unbekannt.join(", ")} — erlaubt: --nur-daten, --nicht-oeffnen`);
    return 2;
  }
  const nurDaten = args.includes("--nur-daten");
  const nichtOeffnen = nurDaten || args.includes("--nicht-oeffnen");
  if (!existsSync(vault)) { console.error(`Vault nicht gefunden: ${vault}`); return 1; }
  // Ansicht des Ziel-Vaults (wie doctor): index.html lädt ../../.logs/ansicht/data.js relativ zu sich selbst —
  // Daten und geöffnete Seite müssen also im selben Vault liegen, auch wenn BRAIN_VAULT auf einen anderen zeigt.
  const modulPfad = join(vault, ".tools", "ansicht", "daten.mjs");
  const indexPfad = join(vault, ".tools", "ansicht", "index.html");
  if (!existsSync(modulPfad) || !existsSync(indexPfad)) {
    console.error("Die 3D-Ansicht ist noch nicht installiert — aktualisiere das Kit (sag „update mein Brain“).");
    return 1;
  }
  let erg;
  try {
    const { erzeugeAnsichtsDaten } = await import(pathToFileURL(modulPfad).href);
    erg = erzeugeAnsichtsDaten(vault);
  } catch (e) {
    console.error(String(e?.message || e).split("\n")[0]);
    return 1;
  }
  for (const w of erg.warnungen || []) console.error(`Warnung: ${w}`);
  if (nurDaten) { console.log(`${erg.seiten} Seiten, ${erg.verbindungen} Verbindungen.`); return 0; }
  const url = pathToFileURL(indexPfad).href;
  if (nichtOeffnen) { console.log(`Öffne diese Datei im Browser: ${url}`); return 0; }
  const ok = await oeffneDatei(indexPfad);
  console.log(ok ? `Geöffnet im Browser: ${url}` : `Öffne diese Datei im Browser: ${url}`);
  return 0;
}

// Lokale Zeit als „YYYY-MM-DD HH:MM" (für _log.md, Lock, Review-Marke) — nie schätzen.
function jetzt(d = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
const lockPfad = () => join(vault, ".logs", "ingest.lock");
const LOCK_MIN = 30;

const befehle = {
  jetzt: () => (console.log(jetzt()), 0),
  // Lock für Wiki-Änderungen (Riegel-Hook verlangt ihn). Ein frischer fremder Lock (< 30 min) heißt: eine
  // andere Sitzung arbeitet gerade → nicht überschreiben, Exit 1. Ein alter Lock gilt als liegengeblieben.
  lock: () => {
    mkdirSync(join(vault, ".logs"), { recursive: true });
    try { writeFileSync(lockPfad(), jetzt() + "\n", { flag: "wx" }); console.log("Lock gesetzt."); return 0; }
    catch (e) { if (e.code !== "EEXIST") throw e; }
    const alterMin = (Date.now() - statSync(lockPfad()).mtimeMs) / 60000;
    if (alterMin < LOCK_MIN) {
      console.log(`Eine andere Sitzung arbeitet gerade am Wiki (seit ${Math.floor(alterMin)} min) — bitte später erneut versuchen.`);
      return 1;
    }
    writeFileSync(lockPfad(), jetzt() + "\n");
    console.log("Lock gesetzt (alter Lock war liegengeblieben).");
    return 0;
  },
  // Review-Marke (mtime zählt: Sitzungsstart/Lint melden „Review fällig" nach 30 Tagen).
  "review-erledigt": () => { mkdirSync(join(vault, ".logs"), { recursive: true }); writeFileSync(join(vault, ".logs", "letzter-review"), jetzt() + "\n"); console.log("Review vermerkt."); return 0; },
  unlock: () => { rmSync(lockPfad(), { force: true }); console.log("Lock entfernt."); return 0; },
  // Erste 16 Hex-Zeichen des SHA-256 einer Datei (Beweisbindung quellen_sha).
  sha: (datei) => {
    if (!datei) { console.error("Nutzung: brain sha <datei>"); return 64; }
    let inhalt;
    try { inhalt = readFileSync(datei); } catch { console.error(`Datei nicht gefunden: ${datei}`); return 64; }
    console.log(createHash("sha256").update(inhalt).digest("hex").slice(0, 16));
    return 0;
  },
  version: () => (console.log(readFileSync(join(T, "VERSION"), "utf8").trim()), 0),
  index: () => node("brain-index.mjs", vault),
  lint: () => node("brain-lint.mjs", vault),
  refresh: () => {
    // Refresh baut den qmd-Index/Embeddings neu — ohne qmd kein Fehlschlag: Hinweis auf stderr,
    // dann an search-refresh.mjs delegieren (das bricht intern still ab und beendet sich immer mit 0).
    if (!hatQmd()) console.error("Hinweis: Die bessere Suche ist nicht installiert — der Suchindex wird nicht aufgefrischt. Die einfache Suche funktioniert trotzdem.");
    return node("search-refresh.mjs", vault);
  },
  "hooks-install": () => node("install-git-hooks.mjs", vault),
  doctor: () => node("doctor.mjs", vault),
  "update-check": async () => {
    const { pruefeUpdate, hinweisZeile } = await import("./update-check.mjs");
    const erg = await pruefeUpdate(vault);
    const zeile = hinweisZeile(erg, vault);
    if (zeile) console.log(zeile);
    else if (erg.aus) console.log("Die Update-Prüfung ist ausgeschaltet (update.pruefen: false in brain.config.json).");
    else if (erg.neueste) console.log("Du hast die neueste Version.");
    else console.log("Konnte nicht geprüft werden (offline?) — ich versuche es beim nächsten Mal wieder.");
    return 0;
  },
  "ingest-check": (datei) => {
    if (!datei) { console.error("Nutzung: brain ingest-check <datei>"); return 64; }
    let text;
    try { text = readFileSync(datei, "utf8"); }
    catch { console.error(`Datei nicht gefunden: ${datei}`); return 64; }
    const f = findeSecrets(text);
    if (!f.length) return 0;
    console.log("SECRETS GEFUNDEN (nur Fundstellen):");
    f.forEach(t => console.log(`Zeile ${t.zeile}`));
    return 3;
  },
  search: suche,
  zeig,
  backup: async (unter, a, b) => {
    const m = await import("./backup.mjs");
    if (!unter) { console.log(m.sichern(vault)); return 0; }
    if (unter === "einrichten") {
      if (!a) { console.error("Nutzung: brain backup einrichten github|ordner:<pfad>|keins"); return 64; }
      const cfg = m.einrichten(vault, a);
      const text = cfg.art === "github" ? "Sicherung eingerichtet: GitHub."
        : cfg.art === "ordner" ? `Sicherung eingerichtet: Ordner ${cfg.pfad}.`
        : "Sicherung eingerichtet: keine Sicherung.";
      console.log(text);
      return 0;
    }
    if (unter === "wiederherstellen") {
      if (!a || !b) { console.error("Nutzung: brain backup wiederherstellen <bundle-datei|github-url> <ziel>"); return 64; }
      const r = m.wiederherstellen(a, b);
      console.log(r.text);
      return r.ok ? 0 : 1;
    }
    console.error("Nutzung: brain backup [einrichten github|ordner:<pfad>|keins] [wiederherstellen <quelle> <ziel>]");
    return 64;
  },
};

const f = befehle[befehl];
if (!f) { console.error(`Befehle: ${Object.keys(befehle).join(" | ")}`); process.exit(64); }
// befehle sind sonst synchron; backup ist async (dynamischer Import) — await auf einen einfachen
// Rückgabewert löst sofort auf, ändert also nichts am Verhalten der anderen Befehle.
try {
  const code = await f(...rest);
  process.exit(code);
} catch (e) {
  console.error(`Fehler: ${String(e?.message || e).split("\n")[0]}`);
  process.exit(1);
}
