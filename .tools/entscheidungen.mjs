// .tools/entscheidungen.mjs — Konflikt-Entscheidungen (Spec v0.4, Baustein B). Ein Klick im Gehirn („A gilt“,
// „B gilt“, „Beide gelten“) schreibt NUR einen Auftrag <inbox>/_entscheidungen/<id>.md — nie das Wiki selbst
// (Riegel 2: aufgelöst wird über die Quelle, beim nächsten Ingest). „Später“ schreibt nichts.
// Sicherheitsprüfungen wie bei den Vorschlägen (vorschlaege.mjs): Seiten-ID nur als saubere Wiki-Seite, echte
// Datei (kein Symlink) im echten Wiki-Ordner, Auftragsordner kein Symlink und genau <inbox>/_entscheidungen,
// exklusives Schreiben (wx), Notiz ≤ 300 Zeichen ohne Zugangsdaten. Fehler tragen `code` (400/404/409/500).
// Nur Node-Standardbibliothek.
import { unlinkSync, readdirSync, readFileSync, writeFileSync, mkdirSync, lstatSync, realpathSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { randomBytes } from "node:crypto";
import { pathToFileURL, fileURLToPath } from "node:url";
import { ordner, entferneBom } from "./pfade.mjs";
import { findeSecrets } from "./secrets-muster.mjs";
import { istWikiSeite } from "./wiki-pfade.mjs";
import { fingerabdruck as fpVon } from "./konflikte.mjs";

// Konflikt-Parser aus Task 1 (konflikte.mjs) — fehlt er (noch), zählt der Rückfall nur die offenen Kästen.
const HIER = dirname(fileURLToPath(import.meta.url));
const KONFLIKT_MODUL = await import(pathToFileURL(join(HIER, "konflikte.mjs")).href).catch(() => null);

export const ENTSCHEIDUNG_ID_MUSTER = /^[a-z0-9-]{1,120}$/;
export const WAHLEN = ["a", "b", "beide", "spaeter"];
export const MAX_NOTIZ = 300;
const MAX_SEITE = 300;

const fehlerMit = (code, meldung) => Object.assign(new Error(meldung), { code });
const fwd = (p) => String(p).split("\\").join("/");
const norm = (p) => {
  const f = fwd(p).replace(/\/+$/, "");
  return process.platform === "darwin" || process.platform === "win32" ? f.toLowerCase() : f;
};
const liegtIn = (kind, eltern) => norm(kind).startsWith(norm(eltern) + "/");
const gleicherPfad = (a, b) => norm(a) === norm(b);

// Offene Konflikt-Kästen einer Seite: [{ nr, a?, b? }]. Mit Task-1-Parser vollständig, sonst nur die Nummern
// (1, 2, … in Dokumentreihenfolge, Kästen in ```-Codeblöcken zählen nicht — wie der Parser).
export function konflikteIn(text) {
  if (KONFLIKT_MODUL && typeof KONFLIKT_MODUL.konflikte === "function") {
    try { return KONFLIKT_MODUL.konflikte(text).map(k => (k.fp ? k : { ...k, fp: fpVon(k.a, k.b) })); } catch { return []; }
  }
  const out = [];
  let nr = 0, imCode = false;
  for (const z of entferneBom(String(text ?? "")).split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(z)) { imCode = !imCode; continue; }
    if (!imCode && /^\s*>\s*\[!KONFLIKT\]\s*offen\b/i.test(z)) out.push({ nr: ++nr });
  }
  return out;
}

export function entscheidungsOrdner(vault) {
  return join(vault, ordner(vault).inbox, "_entscheidungen");
}

// Seiten-ID (vault-relativ, "/" als Trenner, wie die Knoten-IDs der Ansicht) → geprüfter echter Pfad.
// Wirft 400 (ungültig/außerhalb) bzw. 404 (gibt es nicht).
export function pruefeSeite(vault, seite) {
  if (typeof seite !== "string" || !seite || seite.length > MAX_SEITE) throw fehlerMit(400, "Ungültige Seite.");
  if (/[\\\0-\x1f\x7f]/.test(seite)) throw fehlerMit(400, "Ungültige Seite.");
  const teile = seite.split("/");
  if (teile.some(t => !t || t === "." || t === ".." || t.startsWith("."))) throw fehlerMit(400, "Ungültige Seite.");
  const o = ordner(vault);
  if (!istWikiSeite(seite, o.wiki)) throw fehlerMit(400, "Das ist keine Wiki-Seite.");
  const datei = findeSeitenPfad(vault, teile);
  if (!datei) throw fehlerMit(404, "Diese Seite gibt es nicht (mehr).");
  let st;
  try { st = lstatSync(datei); } catch { throw fehlerMit(404, "Diese Seite gibt es nicht (mehr)."); }
  if (!st.isFile()) throw fehlerMit(400, "Seite ist keine normale Datei.");
  let vaultEcht, wikiEcht, dateiEcht;
  try { vaultEcht = realpathSync(vault); wikiEcht = realpathSync(join(vault, o.wiki)); dateiEcht = realpathSync(datei); }
  catch { throw fehlerMit(404, "Diese Seite gibt es nicht (mehr)."); }
  if (!liegtIn(wikiEcht, vaultEcht) || !liegtIn(dateiEcht, wikiEcht)) throw fehlerMit(400, "Seite liegt außerhalb des Wikis.");
  return dateiEcht;
}

// Gleiche Seite trotz anderer Schreibweise? Über den Seitennamen (NFC + Kleinschreibung) — auf JEDEM System,
// auch wenn das Dateisystem Groß/klein oder NFC/NFD unterscheidet (Linux, NTFS).
const nfc = (s) => String(s ?? "").normalize("NFC");
const nameSchluessel = (s) => nfc(fwd(s)).toLowerCase();
export const gleicheSeite = (a, b) => nameSchluessel(a) === nameSchluessel(b);

// Seiten-ID-Teile → vorhandener Pfad. Je Ebene zuerst die Schreibweise wie gegeben; fehlt sie (case-sensitives
// Dateisystem, Umlaut als NFD statt NFC), der Eintrag mit gleichem Namen nach NFC, sonst nach NFC + Kleinschreibung.
// Mehrdeutig (z. B. „a.md“ und „A.md“ unter Linux, keine davon exakt) oder nicht da → null.
function findeSeitenPfad(vault, teile) {
  let p = vault;
  for (const t of teile) {
    const direkt = join(p, t);
    try { lstatSync(direkt); p = direkt; continue; } catch {}
    let namen;
    try { namen = readdirSync(p); } catch { return null; }
    const gleichNfc = namen.filter(n => nfc(n) === nfc(t));
    const treffer = gleichNfc.length ? gleichNfc : namen.filter(n => nameSchluessel(n) === nameSchluessel(t));
    if (treffer.length !== 1) return null;
    p = join(p, treffer[0]);
  }
  return p;
}

// Seiten-ID in der Schreibweise auf der Platte (Groß/klein wie gespeichert, NFC) — so ergibt jede Schreibvariante
// derselben Seite dieselbe ID (W1-Review #11). Basis ist der Wiki-Ordnername aus der Config.
export function kanonischeSeite(vault, seite) {
  const o = ordner(vault);
  try {
    const wikiEcht = realpathSync.native(join(vault, o.wiki));
    const pfad = findeSeitenPfad(vault, String(seite).split("/"));
    if (!pfad) return nfc(seite);
    const dateiEcht = realpathSync.native(pfad);
    const rel = relative(wikiEcht, dateiEcht).split(/[\\/]+/).join("/");
    if (!rel || rel.startsWith("..")) return nfc(seite);
    return nfc(`${o.wiki}/${rel}`);
  } catch { return nfc(seite); }
}

// Gehört eine Entscheidung zu diesem Kasten? Über den Fingerabdruck der Aussagen; nur alte Aufträge ohne
// Fingerabdruck fallen auf die Kasten-Nummer zurück.
export function passtZu(e, seite, kasten) {
  if (!e || !kasten || !gleicheSeite(e.seite, seite)) return false;
  return e.fingerabdruck ? e.fingerabdruck === kasten.fp : e.konflikt === kasten.nr;
}
// Die (neueste) Entscheidung zu einem Kasten oder null. liste = listeEntscheidungen(vault) (neueste zuerst).
export function entscheidungFuer(liste, seite, kasten) {
  return (Array.isArray(liste) ? liste : []).find(e => passtZu(e, seite, kasten)) || null;
}

function zeitId(d) {
  const z = d.toISOString();
  return `${z.slice(0, 4)}${z.slice(5, 7)}${z.slice(8, 10)}-${z.slice(11, 13)}${z.slice(14, 16)}${z.slice(17, 19)}`;
}
const slug = (seite) => String(seite).split("/").pop().replace(/\.md$/i, "").normalize("NFKD")
  .replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/ß/g, "ss").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "seite";

const WAHL_TEXT = { a: "A gilt", b: "B gilt", beide: "Beide gelten (verschiedene Fälle)" };

// → { id } (bei „spaeter“: { id: null, spaeter: true } — es wird nichts geschrieben).
// fingerabdruck (optional, vom Klick): passt er nicht zum Kasten mit dieser nr, hat sich die Seite inzwischen
// geändert → 409, statt die Entscheidung an einen fremden Kasten zu hängen.
export function schreibeEntscheidung(vault, { seite, nr, wahl, notiz = "", fingerabdruck = null } = {}, jetzt = new Date()) {
  if (!WAHLEN.includes(wahl)) throw fehlerMit(400, "Unbekannte Wahl.");
  const n = Number(nr);
  if (!Number.isInteger(n) || n < 1 || n > 9999) throw fehlerMit(400, "Ungültige Konflikt-Nummer.");
  if (notiz != null && typeof notiz !== "string") throw fehlerMit(400, "Notiz muss Text sein.");
  const text = String(notiz ?? "").replace(/\r\n?/g, "\n").trim();
  if (text.length > MAX_NOTIZ) throw fehlerMit(400, `Notiz ist zu lang (höchstens ${MAX_NOTIZ} Zeichen).`);
  if (findeSecrets(text).length || findeSecrets(text.replace(/\s+/g, " ")).length) {
    throw fehlerMit(400, "Notiz enthält vermutlich Zugangsdaten — nicht gespeichert.");
  }
  if (fingerabdruck != null && (typeof fingerabdruck !== "string" || !/^[0-9a-f]{12}$/.test(fingerabdruck))) {
    throw fehlerMit(400, "Ungültiger Fingerabdruck.");
  }
  const dateiEcht = pruefeSeite(vault, seite);
  seite = kanonischeSeite(vault, seite);
  let inhalt;
  try { inhalt = readFileSync(dateiEcht, "utf8"); } catch { throw fehlerMit(404, "Diese Seite gibt es nicht (mehr)."); }
  const kasten = konflikteIn(inhalt).find(k => k.nr === n);
  if (!kasten) throw fehlerMit(404, "Diesen Konflikt gibt es auf der Seite nicht (mehr).");
  if (fingerabdruck && kasten.fp !== fingerabdruck) throw fehlerMit(409, "Die Seite hat sich geändert — bitte neu laden.");
  if (wahl === "spaeter") return { id: null, spaeter: true };

  // Meinung geändert, bevor eingearbeitet wurde: die neue Entscheidung ersetzt die alte (alte Datei wird nach dem
  // erfolgreichen Schreiben entfernt — nur echte Auftragsdateien im Auftragsordner, nie etwas anderes).
  // Zugeordnet über Seite (jede Schreibweise) + Fingerabdruck — nicht über die nr (W1-Review #5, #11).
  const alte = listeEntscheidungen(vault).filter(e => passtZu(e, seite, kasten)).map(e => e.id);

  // Auftragsordner: echter Ordner (kein Symlink, etwa ins Wiki), genau <inbox>/_entscheidungen im Vault.
  const o = ordner(vault);
  const dir = entscheidungsOrdner(vault);
  // Nie ins Wiki (Inbox als Symlink ins Wiki oder ordner.inbox im Wiki — W1-Review #14): schon VOR dem Anlegen prüfen
  let wikiEcht = null;
  try { wikiEcht = realpathSync(join(vault, o.wiki)); } catch {}
  const imWiki = (p) => !!wikiEcht && (liegtIn(p, wikiEcht) || gleicherPfad(p, wikiEcht));
  let inboxVorher = null;
  try { inboxVorher = realpathSync(join(vault, o.inbox)); } catch {}
  if (inboxVorher && imWiki(inboxVorher)) throw fehlerMit(400, "Entscheidungsordner liegt im Wiki.");
  if (!inboxVorher && imWiki(join(realpathSync(vault), ...String(o.inbox).split("/")))) throw fehlerMit(400, "Entscheidungsordner liegt im Wiki.");
  try { mkdirSync(dir, { recursive: true }); } catch { throw fehlerMit(500, "Entscheidung konnte nicht gespeichert werden."); }
  let dirSt;
  try { dirSt = lstatSync(dir); } catch { throw fehlerMit(500, "Entscheidung konnte nicht gespeichert werden."); }
  if (dirSt.isSymbolicLink() || !dirSt.isDirectory()) throw fehlerMit(400, "Entscheidungsordner ist kein normaler Ordner.");
  let vaultEcht, dirEcht, inboxEcht;
  try { vaultEcht = realpathSync(vault); dirEcht = realpathSync(dir); inboxEcht = realpathSync(join(vault, o.inbox)); }
  catch { throw fehlerMit(500, "Entscheidung konnte nicht gespeichert werden."); }
  if (!liegtIn(dirEcht, vaultEcht) || !gleicherPfad(dirEcht, join(inboxEcht, "_entscheidungen"))) {
    throw fehlerMit(400, "Entscheidungsordner liegt außerhalb des erlaubten Ordners.");
  }
  if (imWiki(dirEcht)) throw fehlerMit(400, "Entscheidungsordner liegt im Wiki.");

  const erstellt = jetzt.toISOString().slice(0, 19) + "Z";
  const zeile = (x, k) => (x && x.text ? `- ${k}: „${String(x.text).replace(/\s+/g, " ")}“${x.quelle ? ` — Quelle: [[${x.quelle}]]` : ""}` : null);
  const datei = [
    "---",
    "typ: entscheidung",
    `seite: ${JSON.stringify(seite)}`,
    `konflikt: ${n}`,
    `wahl: ${wahl}`,
    `fingerabdruck: ${kasten.fp}`,
    `notiz: ${JSON.stringify(text)}`,
    `erstellt: ${erstellt}`,
    "---",
    "",
    `# Entscheidung: Konflikt ${n} auf ${seite}`,
    "",
    zeile(kasten.a, "A"),
    zeile(kasten.b, "B"),
    `- Wahl: ${WAHL_TEXT[wahl]}`,
    text ? `- Notiz: ${text.replace(/\s+/g, " ")}` : null,
    "",
    "Umsetzen beim nächsten Einarbeiten: zuerst die Quelle präzisieren, dann den Kasten entfernen, in _log.md",
    `protokollieren und diesen Auftrag nach ${o.archiv}/entscheidungen-erledigt/ verschieben.`,
    "",
  ].filter(z => z !== null).join("\n");
  for (let versuch = 0; versuch < 5; versuch++) {
    const id = `${zeitId(jetzt)}-k${n}-${slug(seite)}-${randomBytes(3).toString("hex")}`;
    try {
      writeFileSync(join(dirEcht, `${id}.md`), datei, { flag: "wx" });
      for (const altId of alte) {
        if (!ENTSCHEIDUNG_ID_MUSTER.test(altId) || altId === id) continue;
        const f = join(dirEcht, `${altId}.md`);
        try { if (lstatSync(f).isFile()) unlinkSync(f); } catch { /* schon weg */ }
      }
      return { id, ersetzt: alte.length };
    }
    catch (e) { if (e.code !== "EEXIST") throw fehlerMit(500, "Entscheidung konnte nicht gespeichert werden."); }
  }
  throw fehlerMit(500, "Entscheidung konnte nicht gespeichert werden.");
}

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
  if (fm.typ !== "entscheidung" || !WAHLEN.includes(fm.wahl) || typeof fm.seite !== "string") throw new Error("keine Entscheidung");
  const fp = /^[0-9a-f]{12}$/.test(String(fm.fingerabdruck || "")) ? fm.fingerabdruck : "";
  return { seite: fm.seite, konflikt: Number(fm.konflikt) || 0, wahl: fm.wahl, fingerabdruck: fp, notiz: fm.notiz || "", erstellt: fm.erstellt || "" };
}

// Offene Entscheidungs-Aufträge, neueste zuerst; Unterordner, Symlinks, fremde Namen und kaputte Dateien
// werden übersprungen. → [{ id, seite, konflikt, wahl, fingerabdruck, notiz, erstellt }]
export function listeEntscheidungen(vault) {
  const dir = entscheidungsOrdner(vault);
  let namen;
  try {
    if (!lstatSync(dir).isDirectory()) return [];
    namen = readdirSync(dir);
  } catch { return []; }
  const out = [];
  for (const name of namen) {
    if (!name.endsWith(".md")) continue;
    const id = name.slice(0, -3);
    if (!ENTSCHEIDUNG_ID_MUSTER.test(id)) continue;
    const f = join(dir, name);
    try {
      if (!lstatSync(f).isFile()) continue;
      out.push({ id, ...leseDatei(readFileSync(f, "utf8")) });
    } catch { /* kaputt → überspringen */ }
  }
  out.sort((a, b) => b.erstellt.localeCompare(a.erstellt) || b.id.localeCompare(a.id));
  return out;
}

// Wiki-Seiten mit mindestens einem offenen, noch nicht entschiedenen Konflikt-Kasten — für den Sitzungsstart.
// Nur echte Dateien im echten Wiki (Symlinks werden ausgelassen, W1-Review #16), ohne „_“- und Punkt-Namen.
export function offeneKonfliktSeiten(vault) {
  const o = ordner(vault);
  const wiki = join(vault, o.wiki);
  const liste = listeEntscheidungen(vault);
  let n = 0;
  const lauf = (dir, rel) => {
    let namen;
    try { namen = readdirSync(dir); } catch { return; }
    for (const name of namen) {
      if (name.startsWith("_") || name.startsWith(".")) continue;
      const voll = join(dir, name);
      let st;
      try { st = lstatSync(voll); } catch { continue; }
      if (st.isSymbolicLink()) continue;
      if (st.isDirectory()) { lauf(voll, `${rel}/${name}`); continue; }
      if (!st.isFile() || !name.endsWith(".md")) continue;
      let text;
      try { text = readFileSync(voll, "utf8"); } catch { continue; }
      if (!/\[!KONFLIKT\]/i.test(text)) continue;
      const id = `${rel}/${name}`;
      if (konflikteIn(text).some(k => !entscheidungFuer(liste, id, k))) n++;
    }
  };
  try { if (lstatSync(wiki).isDirectory()) lauf(wiki, o.wiki); } catch {}
  return n;
}
