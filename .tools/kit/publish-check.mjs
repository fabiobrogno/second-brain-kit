#!/usr/bin/env node
// .tools/kit/publish-check.mjs — harte Prüfung vor jedem Release. Druckt nur Fundstellen, nie Inhalte.
// Nur generische Regeln (PFAD, EMAIL, ARTIFACT, SECRET, INHALT) sind im Code verdrahtet. Firmen-/Personen-
// namen kommen ausschließlich von außen: --namen <datei> (eine Zeile je Name) oder ENV PUBLISH_SPERRNAMEN
// (kommagetrennt). Ein Eintrag mit führendem "=" ist ein Ganzwort-Treffer (Wortgrenze beidseitig), alle
// anderen sind case-insensitive Teilstrings. Keine Liste → nur generische Regeln.
//
// --erlaubt <datei>/ENV PUBLISH_ERLAUBT (kommagetrennt): exakte Strings, die vor der FIRMA-Prüfung aus der
// Zeile entfernt werden (z. B. die eigene Kit-Repo-Adresse im Klon-Befehl) — NIE vor den Regeln oben.
// Nur als exaktes Token (keine Buchstaben/Ziffern/_/- direkt davor oder danach), sonst bleibt der
// Fund stehen (z. B. "firmax/kit-privat" wird durch den Eintrag "firmax/kit" NICHT entschärft).
//
// Nutzung:
//   publish-check.mjs <dir> [--namen <datei>] [--erlaubt <datei>]              — scannt ein Export-Verzeichnis
//   publish-check.mjs --historie [<repo>] [--namen <datei>] [--erlaubt <datei>] — scannt JEDE Revision von `git rev-list --all`
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { execFileSync } from "node:child_process";
import { SECRET_MUSTER } from "../secrets-muster.mjs";
import { ladeConfig } from "../pfade.mjs";
import { gitBefehl } from "../werkzeug.mjs";

// Lokalteil und Domain sind mit {1,64}/{1,253} bewusst GEDECKELT (RFC-Praxisgrenzen) statt mit + unbegrenzt:
// eine einzelne Zeile ohne Zeilenumbrüche (z. B. eine 200-KB-Minifikation) mit einem "@", aber ohne gültige
// Domain dahinter, lässt die ungedeckelten Quantoren sonst exponentiell zurückverfolgen (katastrophales
// Backtracking, mehrere Sekunden statt Millisekunden) — mit fester Obergrenze bleibt das linear.
const EMAIL_RE = /[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,253}\.[A-Za-z]{2,24}/;
// Erlaubte Adressen werden aus der Zeile HERAUSGESCHNITTEN, bevor EMAIL_RE prüft — eine zweite,
// echte Adresse auf derselben Zeile bleibt so trotzdem ein Fund. Gleiche Deckelung wie EMAIL_RE, aus
// demselben Grund (lief vorher auf JEDER Zeile mit "@", noch vor dem EMAIL_RE-Test).
const EMAIL_AUSNAHME = /([A-Za-z0-9._%+-]{0,64}noreply@[A-Za-z0-9.-]{1,253}\.[A-Za-z]{2,24}|[A-Za-z0-9._%+-]{1,64}@example\.com)/gi;
const regeln = [
  ["PFAD", /\/(Users|home)\/(?!<name>|runner\b|USER\b)[A-Za-z0-9._-]+/],
  ["EMAIL", EMAIL_RE],
  ["ARTIFACT", /claude\.ai\/(code\/)?artifact\//],
  ["SECRET", SECRET_MUSTER],
];
// Binär wird am INHALT erkannt (NUL-Byte in den ersten 8000 Byte), nie an der Dateiendung — ein
// Textsecret in einer Datei namens x.pdf darf sich nicht hinter der Endung verstecken können.
function istBinaer(buf) {
  const n = Math.min(buf.length, 8000);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
  return false;
}
// git show/ls-tree/rev-list können auf großen Repos/Dateien viel Ausgabe erzeugen — Node killt den
// Kindprozess sonst mit ENOBUFS (Default-maxBuffer 1 MB) und die Datei fällt lautlos durch die Prüfung.
const MAXBUF = 256 * 1024 * 1024;
const GIT_OPTS = { encoding: "utf8", windowsHide: true, maxBuffer: MAXBUF };
const GIT_OPTS_BUF = { encoding: "buffer", windowsHide: true, maxBuffer: MAXBUF };

function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
// "=name" → Ganzwort (Unicode-Buchstabe/Ziffer/_ auf keiner Seite direkt angrenzend), sonst Teilstring.
function kompiliereName(roh) {
  if (roh.startsWith("=")) {
    const kern = roh.slice(1);
    return { re: new RegExp("(?<![\\p{L}\\p{N}_])" + escapeRe(kern) + "(?![\\p{L}\\p{N}_])", "iu") };
  }
  return { sub: roh.toLowerCase() };
}
function ladeListe(datei, envVar) {
  const roh = new Set();
  const nimm = (zRoh) => { const z = zRoh.replace(/\r$/, "").trim(); if (z) roh.add(z); };
  if (datei) for (const z of readFileSync(datei, "utf8").split("\n")) nimm(z);
  if (process.env[envVar]) for (const z of process.env[envVar].split(",")) nimm(z);
  return [...roh];
}
function ladeNamen(namenDatei) {
  return ladeListe(namenDatei, "PUBLISH_SPERRNAMEN").map(kompiliereName);
}
// Exaktes Token (beidseitige Wortgrenze inkl. "-", damit "kit-privat" keine Fortsetzung von "kit" ist).
function kompiliereErlaubt(roh) {
  return new RegExp("(?<![\\p{L}\\p{N}_-])" + escapeRe(roh) + "(?![\\p{L}\\p{N}_-])", "giu");
}
function ladeErlaubt(erlaubtDatei) {
  return ladeListe(erlaubtDatei, "PUBLISH_ERLAUBT").map(kompiliereErlaubt);
}

// Prüft eine einzelne Zeile gegen alle generischen Regeln + optionale Namensliste.
// Gibt die Liste der getroffenen Regel-Labels zurück (nie den Treffertext selbst).
function pruefeZeile(z, namen, erlaubt) {
  const funde = [];
  for (const [art, re] of regeln) {
    // EMAIL_RE/EMAIL_AUSNAHME haben den Quantifizierer VOR dem Pflichtzeichen "@" — auf einer sehr
    // langen Zeile ohne "@" (z. B. eine 1-MB-Zeile ohne Zeilenumbrüche) backtrackt das quadratisch und
    // hängt. Billiger includes()-Vorcheck umgeht das für den Normalfall "kein @ da" komplett.
    if (art === "EMAIL") {
      if (z.includes("@") && EMAIL_RE.test(z.replace(EMAIL_AUSNAHME, ""))) funde.push(art);
    } else if (re.test(z)) funde.push(art);
  }
  if (namen.length) {
    // erlaubt wirkt NUR für die FIRMA-Prüfung — nie für SECRET/PFAD/EMAIL/ARTIFACT oben.
    let zFirma = z;
    for (const re of erlaubt) zFirma = zFirma.replace(re, "");
    const zl = zFirma.toLowerCase();
    if (namen.some(n => (n.sub ? zl.includes(n.sub) : n.re.test(zFirma)))) funde.push("FIRMA");
  }
  return funde;
}

// LICENSE darf den Namen des Rechteinhabers tragen — die Ausnahme gilt NUR für die Copyright-Zeile,
// nicht für die ganze Datei (bewusst eng).
function istLizenzAusnahme(art, relPfad, zeileText) {
  return art === "FIRMA" && relPfad === "LICENSE" && /copyright/i.test(zeileText);
}

function scanneVerzeichnis(dir, namen, erlaubt) {
  const befunde = [];
  const lauf = (d) => {
    for (const n of readdirSync(d)) {
      const f = join(d, n), r = relative(dir, f).split(sep).join("/"); // Windows: "\\" → "/", sonst griffe die vorlage/-Regel nie
      if (n === ".git") continue;
      if (statSync(f).isDirectory()) { lauf(f); continue; }
      // Vault-Skelett: unter vorlage/ nur .gitkeep, _schema.md, _log.md, ueberblick.md, vorlagen/*, brain.config.json
      if (/^vorlage\//.test(r) && !/(\.gitkeep|_schema\.md|_log\.md|ueberblick\.md|brain\.config\.json)$|^vorlage\/vorlagen\//.test(r)) befunde.push(`INHALT: ${r}`);
      const buf = readFileSync(f);
      if (istBinaer(buf)) continue;
      buf.toString("utf8").split("\n").forEach((z, i) => {
        for (const art of pruefeZeile(z, namen, erlaubt)) {
          if (istLizenzAusnahme(art, r, z)) continue;
          befunde.push(`${art}: ${r}:${i + 1}`);
        }
      });
    }
  };
  lauf(dir);
  return befunde;
}

function scanneHistorie(repo, namen, erlaubt) {
  const befunde = [];
  const GIT = gitBefehl({ cfg: ladeConfig(repo) });
  const revs = execFileSync(GIT, ["-C", repo, "rev-list", "--all"], GIT_OPTS).split("\n").filter(Boolean);
  const inhaltCache = new Map(); // blob-sha → Zeilen[] | null (binär/leer übersprungen)
  for (const rev of revs) {
    const kurz = rev.slice(0, 7);
    // "<mode> <typ> <sha>\t<pfad>" je Eintrag — Typ für den Nicht-Blob-Filter, sha fürs Dedupe.
    // -z (NUL-getrennt, Pfad unquotiert) statt Zeilenumbruch: git quotet sonst jeden Pfad mit
    // Nicht-ASCII-Zeichen in doppelten Anführungszeichen mit \NNN-Escapes — ohne -z würde die
    // Funde-Ausgabe für Nicht-ASCII-Pfade kaputte Pfade statt der echten Dateinamen zeigen.
    const baumRoh = execFileSync(GIT, ["-C", repo, "ls-tree", "-r", "-z", rev], GIT_OPTS).split("\0").filter(Boolean);
    for (const zeile of baumRoh) {
      const tab = zeile.indexOf("\t");
      const [, typ, sha] = zeile.slice(0, tab).split(" ");
      const f = zeile.slice(tab + 1);
      if (typ !== "blob") continue; // Submodule/Sonderobjekte — nichts zu lesen, kein Fehler
      let zeilen = inhaltCache.get(sha);
      if (zeilen === undefined) {
        let buf;
        try { buf = execFileSync(GIT, ["-C", repo, "show", sha], GIT_OPTS_BUF); }
        catch {
          befunde.push(`FEHLER: ${kurz}:${f} nicht lesbar`);
          inhaltCache.set(sha, null);
          continue;
        }
        zeilen = istBinaer(buf) ? null : buf.toString("utf8").split("\n");
        inhaltCache.set(sha, zeilen);
      }
      if (zeilen === null) continue; // binär oder unlesbar — schon gemeldet/bewusst übersprungen
      zeilen.forEach((z, i) => {
        for (const art of pruefeZeile(z, namen, erlaubt)) {
          if (istLizenzAusnahme(art, f, z)) continue;
          befunde.push(`${art}: ${kurz}:${f}:${i + 1}`);
        }
      });
    }
  }
  return befunde;
}

// --- Argumente ---
const argv = process.argv.slice(2);
let historie = false, namenDatei = null, erlaubtDatei = null, ziel = null;
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--historie") historie = true;
  else if (a === "--namen") namenDatei = argv[++i];
  else if (a === "--erlaubt") erlaubtDatei = argv[++i];
  else if (!a.startsWith("--") && ziel === null) ziel = a;
}
const namen = ladeNamen(namenDatei);
const erlaubt = ladeErlaubt(erlaubtDatei);

let echt;
if (historie) {
  echt = scanneHistorie(ziel || process.cwd(), namen, erlaubt);
} else {
  if (!ziel) { console.error("Nutzung: publish-check.mjs <dir> [--namen <datei>] [--erlaubt <datei>] | --historie [<repo>] [--namen <datei>] [--erlaubt <datei>]"); process.exit(64); }
  echt = scanneVerzeichnis(ziel, namen, erlaubt);
}
echt.forEach(b => console.log(b));
process.exit(echt.length ? 2 : 0);
