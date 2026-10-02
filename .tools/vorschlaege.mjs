// .tools/vorschlaege.mjs — Vorschläge (aus der Hintergrund-Ernte) schreiben, auflisten, übernehmen, verwerfen.
// Ablage: <inbox>/_vorschlaege/<id>.md. Übernehmen → <inbox>/<id>.md (normale Rohquelle), Verwerfen →
// <archiv>/vorschlaege-verworfen/<id>.md. Nie löschen. Fehler tragen `code` (400/404/500) für den Dienst.
// Nur Node-Standardbibliothek.
import {
  readdirSync, readFileSync, writeFileSync, mkdirSync, lstatSync, realpathSync, linkSync,
  copyFileSync, unlinkSync, constants as fsc,
} from "node:fs";
import { join, relative } from "node:path";
import { randomBytes } from "node:crypto";
import { ordner, entferneBom } from "./pfade.mjs";
import { findeSecrets } from "./secrets-muster.mjs";

// Einzige Quelle für gültige Vorschlags-IDs (auch der Dienst prüft damit, dienst-lib.mjs).
export const ID_MUSTER = /^[a-z0-9-]{1,80}$/;
const ARTEN = new Set(["fakt", "stand"]);
const MAX_TITEL = 80, MAX_TEXT = 6000, MAX_META = 1000;

const fehlerMit = (code, meldung) => Object.assign(new Error(meldung), { code });
const fwd = (p) => String(p).split("\\").join("/");
const einzeilig = (s) => String(s ?? "").replace(/[\r\n\t]+/g, " ").trim();
const hatZugangsdaten = (s) => findeSecrets(String(s ?? "")).length > 0;

export function vorschlagOrdner(vault) {
  return join(vault, ordner(vault).inbox, "_vorschlaege");
}

// `kind` liegt (nach realpath) echt innerhalb von `eltern` (nicht gleich). Vergleich nach /-Normalisierung,
// unter darwin/win32 ohne Groß-/Kleinschreibung (Dateisysteme dort standardmäßig case-insensitiv).
function liegtIn(kind, eltern) {
  const norm = (p) => {
    const f = fwd(p).replace(/\/+$/, "");
    return process.platform === "darwin" || process.platform === "win32" ? f.toLowerCase() : f;
  };
  const k = norm(kind), e = norm(eltern);
  return k.startsWith(e + "/");
}
const echt = (p) => realpathSync(p);
function gleicherPfad(a, b) {
  const norm = (p) => {
    const f = fwd(p).replace(/\/+$/, "");
    return process.platform === "darwin" || process.platform === "win32" ? f.toLowerCase() : f;
  };
  return norm(a) === norm(b);
}

function zeitId(d) {
  const z = d.toISOString(); // YYYY-MM-DDTHH:MM:SS.sssZ (UTC)
  return `${z.slice(0, 4)}${z.slice(5, 7)}${z.slice(8, 10)}-${z.slice(11, 13)}${z.slice(14, 16)}${z.slice(17, 19)}`;
}

// Schreibt einen Vorschlag; gibt die id zurück. Secret in irgendeinem Feld → 400, es wird nichts geschrieben.
export function schreibeVorschlag(vault, { art, titel, text, ordner: quelleOrdner = "", sitzung = "" } = {}, jetzt = new Date()) {
  if (!ARTEN.has(art)) throw fehlerMit(400, "Unbekannte Vorschlags-Art.");
  const t = einzeilig(titel).slice(0, MAX_TITEL);
  const inhalt = String(text ?? "").replace(/\r\n?/g, "\n").trim();
  if (!t || !inhalt) throw fehlerMit(400, "Vorschlag ohne Titel oder Text.");
  if (inhalt.length > MAX_TEXT) throw fehlerMit(400, "Vorschlag ist zu lang.");
  const qo = einzeilig(quelleOrdner).slice(0, MAX_META), qs = einzeilig(sitzung).slice(0, MAX_META);
  if ([t, inhalt, qo, qs].some(hatZugangsdaten)) throw fehlerMit(400, "Vorschlag enthält vermutlich Zugangsdaten — nicht gespeichert.");

  const dir = vorschlagOrdner(vault);
  mkdirSync(dir, { recursive: true });
  const erstellt = jetzt.toISOString().slice(0, 19) + "Z";
  const datei = [
    "---",
    "typ: vorschlag",
    `art: ${art}`,
    `titel: ${JSON.stringify(t)}`,
    `quelle_ordner: ${JSON.stringify(qo)}`,
    `quelle_sitzung: ${JSON.stringify(qs)}`,
    `erstellt: ${erstellt}`,
    "---",
    "",
    `# ${t}`,
    "",
    inhalt,
    "",
  ].join("\n");
  for (let versuch = 0; versuch < 5; versuch++) {
    const id = `${zeitId(jetzt)}-${art}-${randomBytes(3).toString("hex")}`;
    try { writeFileSync(join(dir, `${id}.md`), datei, { flag: "wx" }); return id; }
    catch (e) { if (e.code !== "EEXIST") throw fehlerMit(500, "Vorschlag konnte nicht gespeichert werden."); }
  }
  throw fehlerMit(500, "Vorschlag konnte nicht gespeichert werden.");
}

// Einfacher Frontmatter-Leser (nur die eigenen, oben geschriebenen Felder). Wirft bei kaputter Datei.
function leseDatei(inhalt) {
  const zeilen = entferneBom(inhalt).split(/\r?\n/);
  if (zeilen[0] !== "---") throw new Error("kein Frontmatter");
  const ende = zeilen.indexOf("---", 1);
  if (ende < 0) throw new Error("Frontmatter offen");
  const fm = {};
  for (const z of zeilen.slice(1, ende)) {
    const m = z.match(/^([a-z_]+):\s?(.*)$/);
    if (!m) continue;
    let w = m[2].trim();
    if (w.startsWith('"')) w = JSON.parse(w);
    fm[m[1]] = w;
  }
  if (fm.typ !== "vorschlag" || !ARTEN.has(fm.art)) throw new Error("kein Vorschlag");
  let rumpf = zeilen.slice(ende + 1);
  while (rumpf.length && !rumpf[0].trim()) rumpf.shift();
  let titel = fm.titel || "";
  if (rumpf[0]?.startsWith("# ")) { titel = titel || rumpf[0].slice(2).trim(); rumpf = rumpf.slice(1); }
  const text = rumpf.join("\n").trim();
  return { art: fm.art, titel, text, quelleOrdner: fm.quelle_ordner || "", quelleSitzung: fm.quelle_sitzung || "", erstellt: fm.erstellt || "" };
}

// Neueste zuerst; Unterordner, Symlinks und kaputte Dateien werden übersprungen.
export function listeVorschlaege(vault) {
  const dir = vorschlagOrdner(vault);
  let namen;
  try { namen = readdirSync(dir); } catch { return []; }
  const out = [];
  for (const name of namen) {
    if (!name.endsWith(".md")) continue;
    const id = name.slice(0, -3);
    if (!ID_MUSTER.test(id)) continue;
    const f = join(dir, name);
    try {
      if (!lstatSync(f).isFile()) continue;
      out.push({ id, ...leseDatei(readFileSync(f, "utf8")) });
    } catch { /* kaputt → überspringen */ }
  }
  out.sort((a, b) => (b.erstellt.localeCompare(a.erstellt)) || b.id.localeCompare(a.id));
  return out.map(({ quelleSitzung, ...v }) => v);
}

export function anzahlVorschlaege(vault) {
  return listeVorschlaege(vault).length;
}

// Verschieben OHNE Überschreiben: harter Link (scheitert atomar mit EEXIST, wenn das Ziel inzwischen belegt
// ist — kein Prüf-/Schreib-Wettlauf wie bei rename), sonst (anderes Laufwerk, FS ohne Hardlinks) exklusive
// Kopie. Erst danach wird die Quelle entfernt. EEXIST geht an den Aufrufer (→ nächster freier Name).
function verschiebe(quelle, ziel) {
  try { linkSync(quelle, ziel); }
  catch (e) {
    if (e.code === "EEXIST") throw e;
    copyFileSync(quelle, ziel, fsc.COPYFILE_EXCL);
  }
  unlinkSync(quelle);
}

// aktion: "uebernehmen" | "verwerfen". → { ok: true, ziel: "<vault-relativer Pfad mit />" }
export function entscheide(vault, id, aktion) {
  if (typeof id !== "string" || !ID_MUSTER.test(id)) throw fehlerMit(400, "Ungültige Vorschlags-ID.");
  if (aktion !== "uebernehmen" && aktion !== "verwerfen") throw fehlerMit(400, "Unbekannte Aktion.");
  const o = ordner(vault);
  const dir = vorschlagOrdner(vault);
  const quelle = join(dir, `${id}.md`);
  let st;
  try { st = lstatSync(quelle); } catch { throw fehlerMit(404, "Diesen Vorschlag gibt es nicht (mehr)."); }
  if (!st.isFile()) throw fehlerMit(400, "Vorschlag ist keine normale Datei.");

  // Der Vorschlagsordner muss ein echter Ordner sein (kein Symlink, etwa auf 09_wiki) und genau
  // <inbox>/_vorschlaege — sonst ließen sich beliebige Vault-Dateien am Wiki-Schutz vorbei verschieben.
  let dirSt;
  try { dirSt = lstatSync(dir); } catch { throw fehlerMit(404, "Diesen Vorschlag gibt es nicht (mehr)."); }
  if (dirSt.isSymbolicLink() || !dirSt.isDirectory()) throw fehlerMit(400, "Vorschlagsordner ist kein normaler Ordner.");
  let vaultEcht, dirEcht, quelleEcht, inboxEcht;
  try { vaultEcht = echt(vault); dirEcht = echt(dir); quelleEcht = echt(quelle); inboxEcht = echt(join(vault, o.inbox)); }
  catch { throw fehlerMit(404, "Diesen Vorschlag gibt es nicht (mehr)."); }
  if (!liegtIn(dirEcht, vaultEcht) || !liegtIn(quelleEcht, dirEcht) || !gleicherPfad(dirEcht, join(inboxEcht, "_vorschlaege"))) {
    throw fehlerMit(400, "Vorschlag liegt außerhalb des erlaubten Ordners.");
  }
  // Nur echte Vorschläge (Frontmatter typ: vorschlag) werden verschoben.
  try { leseDatei(readFileSync(quelleEcht, "utf8")); }
  catch { throw fehlerMit(400, "Das ist kein Vorschlag."); }

  const zielDir = aktion === "uebernehmen" ? join(vault, o.inbox) : join(vault, o.archiv, "vorschlaege-verworfen");
  mkdirSync(zielDir, { recursive: true });
  const zielDirEcht = echt(zielDir);
  if (!liegtIn(zielDirEcht, vaultEcht)) throw fehlerMit(400, "Zielordner liegt außerhalb des Brains.");

  for (let n = 1; n <= 999; n++) {
    const ziel = join(zielDirEcht, n === 1 ? `${id}.md` : `${id}-${n}.md`);
    if (belegt(ziel)) continue;
    try { verschiebe(quelleEcht, ziel); }
    catch (e) {
      if (e.code === "EEXIST") continue; // zwischen Prüfung und Verschieben belegt → nächster Name
      throw fehlerMit(500, "Vorschlag konnte nicht verschoben werden.");
    }
    return { ok: true, ziel: fwd(relative(vaultEcht, ziel)) };
  }
  throw fehlerMit(500, "Kein freier Dateiname im Zielordner.");
}
// Auch ein (kaputter) Symlink zählt als belegt — nie darüber schreiben.
function belegt(p) { try { lstatSync(p); return true; } catch { return false; } }

// Namen, unter denen der Dienst (Task 1) die Funktionen ebenfalls anspricht.
export { listeVorschlaege as vorschlaegeListe, entscheide as vorschlagEntscheiden };
