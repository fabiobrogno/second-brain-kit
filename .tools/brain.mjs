#!/usr/bin/env node
// .tools/brain.mjs — ein Einstieg für alle Agenten und Menschen. Kein Agent-spezifischer Code hier.
// Befehle: index | search "<frage>" [n] | lint | ingest-check <datei> | refresh | hooks-install | version | pflege | messlatte
//   | lernschleife | antworten
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
import { merkeLuecke } from "./analyse.mjs";

const T = dirname(fileURLToPath(import.meta.url));
const [befehl, ...rest] = process.argv.slice(2);
// Kein Argv-Vault: brain.mjs bekommt Unterbefehl + dessen Argumente, keinen Vault-Pfad — nur
// BRAIN_VAULT bzw. der Vault, in dem diese Datei liegt, zählen hier (Positionsargumente gehen an die Werkzeuge in index/lint/refresh).
const vault = vaultPfad(["", ""]);
const b = qmdBefehl();

const node = (skript, ...a) => spawnSync(process.execPath, [join(T, skript), ...a], { stdio: "inherit", windowsHide: true }).status ?? 1;
const hatQmd = () => { const r = spawnSync(b.cmd, [...b.vorArgs, "--help"], { stdio: "ignore", windowsHide: true }); return !r.error && r.status === 0; };

function suche(frage, n = "5") {
  if (!frage) { console.error("Nutzung: brain search \"<frage>\" [anzahl]"); return 64; }
  let profil = ladeConfig(vault).suche?.profil || "leicht";
  if (profil !== "minimal" && !hatQmd()) {
    console.error("Hinweis: Die bessere Suche ist noch nicht installiert — ich nutze die einfache Suche.");
    profil = "minimal";
  }
  if (profil === "minimal") {
    const treffer = minisuche(vault, frage, Number(n));
    treffer.forEach(t => console.log(`${t.score.toFixed(4)},${t.pfad}`));
    if (!treffer.length) merkeLuecke(vault, "search", frage);
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
    const treffer = parseQmdDateien(lauf("query")).slice(0, Number(n));
    treffer.forEach(t => console.log(`${t.score.toFixed(4)},${t.pfad}`));
    if (!treffer.length) merkeLuecke(vault, "search", frage);
    return 0;
  }
  // leicht: BM25 + Vektor, per Reciprocal Rank Fusion gemischt, ohne LLM-Reranker.
  const rang = new Map();
  for (const art of ["search", "vsearch"]) {
    parseQmdDateien(lauf(art)).forEach((t, i) => {
      rang.set(t.pfad, (rang.get(t.pfad) || 0) + 1 / (60 + i));
    });
  }
  const sortiert = [...rang].sort((a, b) => b[1] - a[1]).slice(0, Number(n));
  sortiert.forEach(([p, s]) => console.log(`${s.toFixed(4)},${p}`));
  if (!sortiert.length) merkeLuecke(vault, "search", frage);
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
// Für den Ansicht-Dienst wird statt einer Datei eine http-Adresse geöffnet: dann ist `datei` die Adresse selbst.
function oeffneDatei(datei, timeoutMs = 250, url = pathToFileURL(datei).href) {
  const { cmd, args } = oeffnerAufruf({ datei, url }, process.platform, process.env.BRAIN_OEFFNER || "");
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

// „brain zeig" — erzeugt die Daten für die 3D-Ansicht (.tools/ansicht/daten.mjs) und öffnet sie im Browser:
// über den lokalen Ansicht-Dienst (.tools/ansicht/dienst-start.mjs, http://127.0.0.1:<port>, Token nur im
// URL-Fragment), sonst — Start gescheitert — wie bisher .tools/ansicht/index.html als file://-Ansicht.
// --nur-daten: nur erzeugen, nichts öffnen, Seitenzahl drucken.
// --nicht-oeffnen: erzeugen, file://-Pfad drucken, aber nicht öffnen und keinen Dienst starten (Tests/Skripte).
// --stopp: laufenden Ansicht-Dienst dieses Vaults beenden.
async function zeig(...args) {
  const bekannt = new Set(["--nur-daten", "--nicht-oeffnen", "--stopp"]);
  const unbekannt = args.filter(a => !bekannt.has(a));
  if (unbekannt.length) {
    console.error(`Unbekannte Option: ${unbekannt.join(", ")} — erlaubt: --nur-daten, --nicht-oeffnen, --stopp`);
    return 2;
  }
  const nurDaten = args.includes("--nur-daten");
  const nichtOeffnen = nurDaten || args.includes("--nicht-oeffnen");
  if (!existsSync(vault)) { console.error(`Vault nicht gefunden: ${vault}`); return 1; }
  const startModul = join(vault, ".tools", "ansicht", "dienst-start.mjs");
  if (args.includes("--stopp")) {
    let gestoppt = false;
    try { if (existsSync(startModul)) gestoppt = await (await import(pathToFileURL(startModul).href)).stoppe(vault); }
    catch { /* nichts zu stoppen */ }
    console.log(gestoppt ? "Ansicht-Dienst beendet." : "Es lief kein Ansicht-Dienst.");
    return 0;
  }
  // Ansicht des Ziel-Vaults (wie doctor): über den Dienst holt die Seite ihre Daten per /api/daten, im file://-Rückfall
  // lädt index.html ../../.logs/ansicht/data.js — Daten und Seite müssen also im selben Vault liegen (auch bei BRAIN_VAULT).
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
  // Ansicht-Dienst: läuft einer für diesen Vault, wird er wiederverwendet, sonst gestartet. Der Token steht nur
  // in der geöffneten Adresse (Fragment) — in der Ausgabe (landet bei der KI/im Terminal) nur ohne ihn.
  let dienst = null;
  try { if (existsSync(startModul)) dienst = await (await import(pathToFileURL(startModul).href)).starteOderFinde(vault); }
  catch { dienst = null; }
  if (dienst) {
    const ohneSchluessel = dienst.url.replace(/#.*$/, "");
    const ok = await oeffneDatei(dienst.url, 250, dienst.url);
    // Auch wenn das Öffnen scheitert: den Schlüssel nie ausgeben (die Ausgabe landet im KI-Verlauf).
    console.log(ok ? `Geöffnet im Browser: ${ohneSchluessel}`
      : `Öffne diese Adresse im Browser: ${ohneSchluessel} — den Schlüssel dafür (#t=…) findest du in .logs/ansicht/dienst.json.`);
    return 0;
  }
  console.error("Hinweis: Der Ansicht-Dienst ließ sich nicht starten — ich öffne die einfache Ansicht (Ansehen geht, Einstellungen ändern nicht).");
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

// Roh-Text (aus "schluessel=wert") in den Typ wandeln, den einstellungen.mjs#SCHEMA für diesen Schlüssel
// erwartet — "null" löscht IMMER (Rückfall auf Standard), ein unbekannter Schlüssel kommt unverändert durch
// (schreibeAutomatik meldet das gleich selbst in Alltagssprache). Ungültige Werte (z. B. "vielleicht" bei
// einem boolean) kommen ebenfalls unverändert durch — auch das meldet schreibeAutomatik verständlich.
function parseEinstellungsWert(schema, roh) {
  if (roh === "null") return null;
  if (!schema) return roh;
  if (schema.typ === "boolean") return roh === "true" ? true : roh === "false" ? false : roh;
  // Pfadliste (Final-Review #7): Pfade dürfen Kommas enthalten („C:\\Users\\Müller, Anna\\Firma") — darum
  // getrennt durch ";" oder Zeilenumbruch, oder als JSON-Liste '["…", "…"]'. Anhängen: ernteNichtIn+=<pfad>.
  if (schema.typ === "pfadliste") {
    if (roh.trim().startsWith("[")) { try { const l = JSON.parse(roh); if (Array.isArray(l)) return l; } catch {} return roh; }
    return roh.split(/[;\r\n]+/).map(s => s.trim()).filter(Boolean);
  }
  if (schema.werte && schema.werte.every(w => typeof w === "number")) return Number(roh);
  return roh;
}

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
  // „brain analyse [--json]" — delegiert ans Analyse-Werkzeug (Task 5): gleiche Kennzahlen/Text wie
  // `node .tools/analyse.mjs`, nur über den gewohnten Einstiegspunkt aufrufbar (auch für KIs ohne Ansicht).
  analyse: (...a) => node("analyse.mjs", vault, ...a),
  // „brain pflege [--json]" — Pflegebericht (v0.4, pflege.mjs): was zu tun ist, je Posten mit nächstem Schritt.
  pflege: (...a) => node("pflege.mjs", vault, ...a),
  // „brain messlatte [--json]" — lokaler Such-Eval (v0.4, messlatte.mjs), Ergebnis in .logs/hint-eval.log.
  messlatte: (...a) => node("messlatte.mjs", vault, ...a),
  // „brain lernschleife [--woche] [--json]" — Kandidaten „Frage → Seite“ (0 Tokens); --woche schreibt die Vorschläge.
  lernschleife: (...a) => node("lernschleife.mjs", vault, ...a),
  // „brain antworten" — Antwort-Messlatte von Hand (Haiku, kostet Tokens; Testfragen in <wiki>/_antworten.json).
  antworten: (...a) => node("antwort-messlatte.mjs", vault, ...a),
  // „brain import <ordner|zip> [--name x] [--ja]" — delegiert ans Import-Werkzeug (Task 7); fehlt die Quelle,
  // meldet brain.mjs selbst die vertraute Nutzung statt des Skript-internen Aufrufs.
  // „brain import fertig <quelle> <paket|--alle> --ziel <cluster>" — Paket als eingearbeitet abschließen
  // (Dateien in den Cluster verschieben, Fortschritt im Bericht; import/abschluss.mjs).
  import: (quelle, ...a) => {
    if (!quelle) { console.error("Nutzung: brain import <ordner|zip> [--name x] [--ja] | brain import fertig <quelle> <paket|--alle> --ziel <cluster>"); return 64; }
    if (quelle === "fertig") return node(join("import", "abschluss.mjs"), vault, ...a);
    return node(join("import", "import.mjs"), quelle, vault, ...a);
  },
  // „brain einstellungen [schluessel=wert …]" — dasselbe Schema wie die Maske (Task 0: SCHEMA/leseAutomatik/
  // schreibeAutomatik), nur als Zeile für KIs ohne Ansicht. Ohne Argumente: aktuelle Werte auflisten.
  // "<schluessel>=null" löscht den Schlüssel (Rückfall auf Standard). Ungültige/unbekannte Schlüssel und
  // Schreibkonflikte (409) wirft schreibeAutomatik bereits mit einer Alltags-Fehlermeldung — die fängt der
  // äußere catch (ganz unten in dieser Datei) ab und druckt sie unverändert.
  einstellungen: async (...args) => {
    const { SCHEMA, leseAutomatik, schreibeAutomatik, rendereAgentsDatei } = await import("./einstellungen.mjs");
    const { werte, stand } = leseAutomatik(vault);
    if (!args.length) {
      for (const [k, v] of Object.entries(werte)) console.log(`${k}=${JSON.stringify(v)}`);
      return 0;
    }
    const neu = {};
    for (const stueck of args) {
      const i = stueck.indexOf("=");
      if (i < 0) { console.error(`Nutzung: brain einstellungen schluessel=wert … (ungültig: "${stueck}")`); return 64; }
      let k = stueck.slice(0, i);
      const anhaengen = k.endsWith("+") && SCHEMA[k.slice(0, -1)]?.typ === "pfadliste";
      if (anhaengen) k = k.slice(0, -1);
      const w = parseEinstellungsWert(SCHEMA[k], stueck.slice(i + 1));
      neu[k] = anhaengen && Array.isArray(w) ? [...(Array.isArray(neu[k]) ? neu[k] : werte[k] || []), ...w] : w;
    }
    schreibeAutomatik(vault, neu, stand);
    // Ich-Karte geändert → AGENTS.md im Vault neu rendern (Final-Review #1), damit Codex/Gemini/Cursor es sofort sehen.
    if (leseAutomatik(vault).werte.ichKarte !== werte.ichKarte) await rendereAgentsDatei(vault);
    console.log("Einstellungen gespeichert.");
    return 0;
  },
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
