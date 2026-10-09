// .tools/vorschlaege.mjs — Vorschläge (aus der Hintergrund-Ernte) schreiben, auflisten, übernehmen, verwerfen.
// Ablage: <inbox>/_vorschlaege/<id>.md. Übernehmen → <inbox>/<id>.md (normale Rohquelle), Verwerfen →
// <archiv>/vorschlaege-verworfen/<id>.md. Nie löschen. Fehler tragen `code` (400/404/500) für den Dienst.
// v0.4: Art „lektion" (Session-Auswerter; Felder ziel/regel/warum/wie — Übernehmen → <inbox>/_lektionen/, dort
// schreibt der Skill „lektion" sie an den richtigen Ort) und Art „pflege" (Pflege-Lauf; Feld befund — Übernehmen
// → <inbox>/_pflege/: ein Prüfauftrag, keine Rohquelle; er darf nie als `quellen:` ins Wiki).
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
const ARTEN = new Set(["fakt", "stand", "lektion", "pflege"]);
export const LEKTION_ZIELE = ["memory", "skill"];
// „frage“ (Treffsicherheit): Lernschleife (lernschleife.mjs, 0 Tokens) — „Frage X zur Seite Y hinzufügen?“. Nie von der KI.
export const PFLEGE_BEFUNDE = ["zusammenlegen", "aufteilen", "veraltet", "widerspruch", "luecke", "frage", "sonstiges"];
// Befunde, die der Pflege-Lauf (Haiku) setzen darf — „frage“ kommt nur aus echten Beobachtungen der Lernschleife.
export const KI_BEFUNDE = PFLEGE_BEFUNDE.filter(b => b !== "frage");
const MAX_FELD = 600;
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
export function schreibeVorschlag(vault, { art, titel, text, ordner: quelleOrdner = "", sitzung = "", ziel = "memory", regel = "", warum = "", wie = "", befund = "sonstiges" } = {}, jetzt = new Date()) {
  if (!ARTEN.has(art)) throw fehlerMit(400, "Unbekannte Vorschlags-Art.");
  const t = einzeilig(titel).slice(0, MAX_TITEL);
  const inhalt = String(text ?? "").replace(/\r\n?/g, "\n").trim();
  if (!t || !inhalt) throw fehlerMit(400, "Vorschlag ohne Titel oder Text.");
  if (inhalt.length > MAX_TEXT) throw fehlerMit(400, "Vorschlag ist zu lang.");
  const qo = einzeilig(quelleOrdner).slice(0, MAX_META), qs = einzeilig(sitzung).slice(0, MAX_META);
  const extra = [];
  if (art === "lektion") {
    if (!LEKTION_ZIELE.includes(ziel)) throw fehlerMit(400, "Unbekanntes Ziel der Lektion.");
    const felder = { regel, warum, wie };
    for (const [k, w] of Object.entries(felder)) {
      felder[k] = einzeilig(w);
      if (felder[k].length > MAX_FELD) throw fehlerMit(400, "Lektion ist zu lang.");
    }
    extra.push(`ziel: ${ziel}`, `regel: ${JSON.stringify(felder.regel)}`, `warum: ${JSON.stringify(felder.warum)}`, `wie: ${JSON.stringify(felder.wie)}`);
  } else if (art === "pflege") {
    if (!PFLEGE_BEFUNDE.includes(befund)) throw fehlerMit(400, "Unbekannter Pflege-Befund.");
    extra.push(`befund: ${befund}`);
  }
  if ([t, inhalt, qo, qs, ...extra].some(hatZugangsdaten)) throw fehlerMit(400, "Vorschlag enthält vermutlich Zugangsdaten — nicht gespeichert.");

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
    ...extra,
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
// Auch für übernommene Lektionen unter <inbox>/_lektionen/ (lektionen.mjs).
export function leseVorschlagDatei(inhalt) { return leseDatei(inhalt); }
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
  const v = { art: fm.art, titel, text, quelleOrdner: fm.quelle_ordner || "", quelleSitzung: fm.quelle_sitzung || "", erstellt: fm.erstellt || "" };
  if (fm.art === "lektion") Object.assign(v, { ziel: LEKTION_ZIELE.includes(fm.ziel) ? fm.ziel : "memory", regel: fm.regel || "", warum: fm.warum || "", wie: fm.wie || "" });
  if (fm.art === "pflege") v.befund = PFLEGE_BEFUNDE.includes(fm.befund) ? fm.befund : "sonstiges";
  return v;
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

// Ordner der übernommenen Lektionen (Auftrag für den Skill „lektion").
export function lektionOrdner(vault) {
  return join(vault, ordner(vault).inbox, "_lektionen");
}

// Ordner der übernommenen Pflege-Aufträge (Final-Review #1): Aufträge zur Prüfung, keine Quellen — zählen nicht
// als Inbox, der Skill review/ingest prüft sie gegen die echten Rohquellen.
export function pflegeOrdner(vault) {
  return join(vault, ordner(vault).inbox, "_pflege");
}

// Liegt ein (echter) Pfad im Wiki oder ist er das Wiki selbst? Übernommene Vorschläge, Lektionen und Aufträge
// dürfen nie dort landen — auch nicht, wenn die Inbox ein Symlink ins Wiki ist oder ordner.inbox im Wiki steht.
export function liegtImWiki(vault, pfadEcht) {
  let wikiEcht;
  try { wikiEcht = echt(join(vault, ordner(vault).wiki)); } catch { return false; }
  return gleicherPfad(pfadEcht, wikiEcht) || liegtIn(pfadEcht, wikiEcht);
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
  let gelesen;
  try { gelesen = leseDatei(readFileSync(quelleEcht, "utf8")); }
  catch { throw fehlerMit(400, "Das ist kein Vorschlag."); }

  // Lektionen und Pflege-Aufträge landen nicht als Rohquelle in der Inbox, sondern in einem eigenen Auftragsordner
  // (Lektion → Skill „lektion“, Pflege → Prüfauftrag für review/ingest, Final-Review #1).
  const auftragsOrdner = gelesen.art === "lektion" ? "_lektionen" : gelesen.art === "pflege" ? "_pflege" : null;
  const zielDir = aktion === "uebernehmen"
    ? (auftragsOrdner ? join(vault, o.inbox, auftragsOrdner) : join(vault, o.inbox))
    : join(vault, o.archiv, "vorschlaege-verworfen");
  // Ziel im Wiki (Inbox als Symlink ins Wiki, ordner.inbox im Wiki)? Vor dem Anlegen abweisen (W1-Review #14).
  try { if (liegtImWiki(vault, echt(join(vault, o.inbox)))) throw fehlerMit(400, "Zielordner liegt im Wiki."); }
  catch (e) { if (e.code === 400) throw e; }
  mkdirSync(zielDir, { recursive: true });
  const zielDirEcht = echt(zielDir);
  if (!liegtIn(zielDirEcht, vaultEcht)) throw fehlerMit(400, "Zielordner liegt außerhalb des Brains.");
  if (liegtImWiki(vault, zielDirEcht)) throw fehlerMit(400, "Zielordner liegt im Wiki.");
  // _lektionen/_pflege muss ein echter Ordner genau unter der Inbox sein (kein Symlink, etwa ins Wiki).
  if (aktion === "uebernehmen" && auftragsOrdner
    && (lstatSync(zielDir).isSymbolicLink() || !gleicherPfad(zielDirEcht, join(inboxEcht, auftragsOrdner)))) {
    throw fehlerMit(400, gelesen.art === "lektion" ? "Lektionsordner ist kein normaler Ordner." : "Pflegeordner ist kein normaler Ordner.");
  }

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
