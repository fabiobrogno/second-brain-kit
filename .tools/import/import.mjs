#!/usr/bin/env node
// .tools/import/import.mjs — Import alter Brains (Obsidian, Notion-Export, Logseq, Ordner mit Notizen).
// Die Quelle wird nur gelesen. Kopiert wird nach <inbox>/_import/<name>/ (Struktur bleibt, Inhalt bytegleich),
// dazu _import.json (Titel, Links, Aliase je Datei — ohne absoluten Quellpfad) und die lokale Vorprüfung
// (_bericht.json + _bericht.md): exakte Duplikate (werden nicht kopiert), Fast-Duplikate, Widerspruchs-Kandidaten,
// Überschneidungen mit dem Wiki und Pakete mit Token-Schätzung. 0 Tokens — eingearbeitet wird später, je Paket.
//
// CLI: node .tools/import/import.mjs <quelle> [vault] [--name x] [--ja]
import { existsSync, mkdirSync, readFileSync, writeFileSync, utimesSync, realpathSync, statSync, readdirSync } from "node:fs";
import { join, resolve, relative, sep, dirname, extname, isAbsolute } from "node:path";
import { posix } from "node:path";
import { fileURLToPath } from "node:url";
import { ordner, EIGENER_VAULT } from "../pfade.mjs";
import { walk } from "../vault-dateien.mjs";
import { istWikiSeite } from "../wiki-pfade.mjs";
import { findeSecrets } from "../secrets-muster.mjs";
import { oeffneQuelle, ImportFehler } from "./erkennen.mjs";
import { ZipFehler } from "./zip.mjs";
import { normalisiereText, textHash, sha256, analysiereNotiz, normTitel, stamm, frontmatter } from "./notiz.mjs";
import { findeGruppen } from "./aehnlich.mjs";
import { findeWidersprueche } from "./widerspruch.mjs";
import { sichererRel } from "./abschluss.mjs";

export { ImportFehler, ZipFehler };

export const MAX_DATEI = 5 * 1024 * 1024;
export const SCHWELLE_NOTIZEN = 2000;
export const SCHWELLE_BYTES = 50 * 1024 * 1024;
export const TOKEN_FAKTOR = 1.6;
const NOTIZ_EXT = new Set([".md", ".markdown", ".txt"]);
const BILD_EXT = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp", ".heic", ".avif", ".tif", ".tiff"]);
const RESERVIERT = new Set(["_import.json", "_bericht.json", "_bericht.md"]);
const MAX_GLEICHER_NAME = 50;   // mehr Notizen mit gleichem Titel („Ohne Titel“) → kein Paarvergleich über den Titel
const MAX_GRUPPE_PAARE = 20;
const WIKI_PRAEFIX = /^(thema|entitaet|konzept|quelle|person|projekt|vergleich|ort|werkzeug)_/;
// Link-Ziele zählen nur bei Notizen mit wenigen Links — eine Übersichts-/Startseite verlinkt alles und ist nicht
// „dieselbe Sache“ wie jede verlinkte Seite.
const MAX_LINKS = 5;
export const GRUND_ZUGANGSDATEN = "nicht importiert — enthält vermutlich Zugangsdaten (in der Quelle bereinigen und neu importieren)";
// [[thema_preise]], [[Ordner/Preise.md]], [Preise](Preise%20abc….md) → „preise“ (wie die Namen der Seiten).
const linkName = (ziel) => normTitel(stamm(String(ziel).split("#")[0]).replace(WIKI_PRAEFIX, ""));

export const tokenSchaetzung = (zeichen) => Math.ceil((zeichen / 4) * TOKEN_FAKTOR);

// Name der Quelle → [a-z0-9-] (Umlaute ausgeschrieben).
export function normName(s) {
  const n = String(s ?? "").toLowerCase().replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
    .normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60)
    .replace(/-+$/, "");
  return n || "import";
}


const isoTag = (d) => {
  if (!(d instanceof Date) || isNaN(d)) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const istBinaer = (buf) => { const n = Math.min(buf.length, 8000); for (let i = 0; i < n; i++) if (buf[i] === 0) return true; return false; };
// Bestand früherer Importe (Final-Review #10): Hash → Datei aus <inbox>/_import/*/_import.json — deckt alle
// kopierten Endungen ab (.txt/.markdown per textHash, .pdf/.csv/Bilder per sha256), nicht nur die .md aus walk().
// Nur Einträge, deren Datei noch da ist.
function importBestand(importWurzel, inboxRel) {
  const out = new Map();
  let namen = [];
  try { namen = readdirSync(importWurzel, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name).sort(); } catch { return out; }
  for (const name of namen) {
    let begleit;
    try { begleit = JSON.parse(readFileSync(join(importWurzel, name, "_import.json"), "utf8")); } catch { continue; }
    for (const d of Array.isArray(begleit?.dateien) ? begleit.dateien : []) {
      if (!d || typeof d.sha !== "string" || typeof d.rel !== "string" || out.has(d.sha)) continue;
      if (!existsSync(join(importWurzel, name, ...d.rel.split("/")))) continue;
      out.set(d.sha, [inboxRel, "_import", name, d.rel].join("/"));
    }
  }
  return out;
}

const innerhalb = (eltern, kind) => { const r = relative(eltern, kind); return r === "" || (!r.startsWith("..") && !isAbsolute(r)); };
const echt = (p) => { try { return realpathSync(p); } catch { return resolve(p); } };
const paketName = (rel) => (rel.includes("/") ? rel.split("/")[0] : "(oberste Ebene)");

function pakete(notizen) {
  const m = new Map();
  for (const n of notizen) {
    const k = paketName(n.rel);
    if (!m.has(k)) m.set(k, { name: k, notizen: 0, zeichen: 0, tokenSchaetzung: 0 });
    const p = m.get(k); p.notizen++; p.zeichen += n.zeichen;
  }
  const out = [...m.values()].sort((a, b) => (a.name < b.name ? -1 : 1));
  for (const p of out) p.tokenSchaetzung = tokenSchaetzung(p.zeichen);
  return out;
}

// Wiki-Seiten des Vaults mit allen Namen, unter denen sie „dieselbe Sache“ sind.
function wikiSeiten(vault, wikiDir, dateien) {
  const out = [];
  for (const f of dateien) {
    const rel = f.rel.split(sep).join("/");
    if (!istWikiSeite(rel, wikiDir)) continue;
    let text;
    try { text = readFileSync(f.full, "utf8"); } catch { continue; }
    const info = analysiereNotiz(rel, text);
    const { felder } = frontmatter(text);
    const h1 = (info.rumpf.match(/^#\s+(.+)$/m) || [])[1] || "";
    const namen = new Set(info.namen);
    for (const n of [stamm(rel).replace(WIKI_PRAEFIX, ""), felder.name, h1]) if (n && typeof n === "string") namen.add(normTitel(n));
    namen.delete("");
    let datum = info.datum;
    if (!datum) { try { datum = isoTag(statSync(f.full).mtime); } catch { datum = null; } }
    out.push({ rel, text: info.rumpf, namen: [...namen], datum, titel: h1 || info.titel });
  }
  return out;
}

const ERSATZ_ZUGANGSDATEN = "(Satz enthält vermutlich Zugangsdaten — nicht angezeigt)";
const ohneZugangsdaten = (satz) => (findeSecrets(satz).length ? ERSATZ_ZUGANGSDATEN : satz);

export function importiere(vault, quelle, { name, bestaetigt = false, jetzt = new Date() } = {}) {
  vault = resolve(vault);
  const o = ordner(vault);
  const q = oeffneQuelle(quelle);
  const importWurzel = join(vault, o.inbox, "_import");
  if (!q.istZip && innerhalb(echt(quelle), echt(vault))) {
    throw new ImportFehler("Die Quelle enthält dieses Brain selbst — bitte einen Ordner außerhalb des Brains wählen.");
  }

  // 1) Einordnen nur nach Name und Größe — noch wird nichts gelesen (Rückfrage kommt VOR dem Einlesen).
  const ausgelassen = [...q.ausgelassen];
  const kandidaten = [], beilagen = [], bilder = [];
  for (const e of [...q.eintraege].sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0))) {
    const ext = extname(e.rel).toLowerCase();
    if (!e.rel.includes("/") && RESERVIERT.has(e.rel)) { ausgelassen.push({ rel: e.rel, grund: "reservierter Name" }); continue; }
    if (e.groesse > MAX_DATEI) { ausgelassen.push({ rel: e.rel, grund: "größer als 5 MB" }); continue; }
    if (NOTIZ_EXT.has(ext)) kandidaten.push(e);
    else if (ext === ".pdf" || ext === ".csv") beilagen.push(e);
    else if (BILD_EXT.has(ext)) bilder.push(e);
    else ausgelassen.push({ rel: e.rel, grund: "Dateityp wird nicht übernommen" });
  }
  const basis = normName(name || q.name);

  // 2) Große Importe erst nach Rückfrage — geprüft an Anzahl und angegebenen Größen, bevor eine Datei gelesen wird.
  const groesseVorab = [...kandidaten, ...beilagen].reduce((s, e) => s + e.groesse, 0);
  if (!bestaetigt && (kandidaten.length >= SCHWELLE_NOTIZEN || groesseVorab >= SCHWELLE_BYTES)) {
    const pk = pakete(kandidaten.map(e => ({ rel: e.rel, zeichen: e.groesse })));
    return {
      status: "bestaetigen", art: q.art, name: basis, ziel: null, notizen: kandidaten.length, kopiert: 0,
      duplikateExakt: [], gruppen: [], widersprueche: [], ueberschneidungen: [], pakete: pk,
      tokenSchaetzung: pk.reduce((s, p) => s + p.tokenSchaetzung, 0), groesseBytes: groesseVorab, secretsIn: [],
    };
  }

  // 3) Notizen lesen. Behalten wird nur, was die Vorprüfung braucht (Analyse + Hash) — der Inhalt wird fürs
  // Kopieren neu gelesen, damit nie alle Notizen doppelt im Speicher liegen. Notizen mit vermutlichen
  // Zugangsdaten werden NICHT übernommen (sonst blockieren sie jeden Brain-Commit und landen in der Suche).
  const notizen = [], secretsIn = [];
  let gefunden = 0;
  for (const e of kandidaten) {
    const buf = e.lies();
    if (istBinaer(buf)) { ausgelassen.push({ rel: e.rel, grund: "Binärdatei" }); continue; }
    gefunden++;
    const text = buf.toString("utf8");
    const secrets = findeSecrets(text);
    if (secrets.length) {
      secretsIn.push(e.rel);
      ausgelassen.push({ rel: e.rel, grund: GRUND_ZUGANGSDATEN, zeilen: secrets.map(x => x.zeile) });
      continue;
    }
    const info = analysiereNotiz(e.rel, text);
    notizen.push({ ...e, info, sha: textHash(text), zeichen: normalisiereText(text).length, datum: info.datum || isoTag(e.datum) });
  }

  // Bilder nur, wenn eine Notiz sie einbettet (![[x.png]] per Name, ![](pfad) relativ zur Notiz).
  const verlinktPfad = new Set(), verlinktName = new Set();
  for (const n of notizen) for (const b of n.info.bilder) {
    if (b.art === "wiki") { verlinktName.add(b.ziel.split("/").pop().toLowerCase()); verlinktPfad.add(posix.normalize(b.ziel)); }
    else verlinktPfad.add(posix.normalize(posix.join(posix.dirname(n.rel), b.ziel)));
  }
  const bilderMit = [];
  for (const b of bilder) {
    const nameKlein = b.rel.split("/").pop().toLowerCase();
    if (verlinktPfad.has(b.rel) || verlinktName.has(nameKlein)) bilderMit.push(b);
    else ausgelassen.push({ rel: b.rel, grund: "Bild ohne Verweis aus einer Notiz" });
  }
  const groesseBytes = [...notizen, ...beilagen, ...bilderMit].reduce((s, e) => s + e.groesse, 0);

  // 4) Exakte Duplikate: gegen bestehende .md im Vault und innerhalb des Imports (erste Fassung bleibt).
  // Liegt die Quelle im Vault, zählen ihre eigenen Dateien nicht als „schon im Brain“.
  const quelleImVault = !q.istZip && innerhalb(echt(vault), echt(quelle))
    ? relative(echt(vault), echt(quelle)).split(sep).join("/") + "/" : null;
  const vaultDateien = walk(vault, { wikiDir: o.wiki })
    .filter(f => !quelleImVault || !(f.rel.split(sep).join("/") + "/").startsWith(quelleImVault));
  const imVault = new Map();
  for (const f of vaultDateien) {
    try { const h = textHash(readFileSync(f.full, "utf8")); if (!imVault.has(h)) imVault.set(h, f.rel.split(sep).join("/")); } catch {}
  }
  const frueher = importBestand(importWurzel, o.inbox);
  for (const [h, rel] of frueher) if (!imVault.has(h)) imVault.set(h, rel);
  const duplikateExakt = [], imImport = new Map(), behalten = [], beilagenBehalten = [];
  for (const n of notizen) {
    if (imVault.has(n.sha)) duplikateExakt.push({ datei: n.rel, gleichWie: imVault.get(n.sha), ort: "brain" });
    else if (imImport.has(n.sha)) duplikateExakt.push({ datei: n.rel, gleichWie: imImport.get(n.sha), ort: "import" });
    else { imImport.set(n.sha, n.rel); behalten.push(n); }
  }
  for (const b of beilagen) {
    const sha = sha256(b.lies());
    if (frueher.has(sha)) { duplikateExakt.push({ datei: b.rel, gleichWie: frueher.get(sha), ort: "brain" }); continue; }
    if (imImport.has(sha)) { duplikateExakt.push({ datei: b.rel, gleichWie: imImport.get(sha), ort: "import" }); continue; }
    imImport.set(sha, b.rel); beilagenBehalten.push({ ...b, sha });
  }

  // 5) Vorprüfung (vor dem Kopieren, im Speicher).
  const gruppen = findeGruppen(behalten.map(n => ({ id: n.rel, text: n.info.rumpf, titelNorm: normTitel(n.info.titel) })));
  const seiten = wikiSeiten(vault, o.wiki, vaultDateien);
  const seiteNachName = new Map();
  for (const s of seiten) for (const nm of s.namen) { if (!seiteNachName.has(nm)) seiteNachName.set(nm, []); seiteNachName.get(nm).push(s); }

  const vergleich = new Map(), paare = [];
  for (const n of behalten) vergleich.set("i:" + n.rel, { datei: n.rel, ort: "import", text: n.info.rumpf, datum: n.datum });
  for (const s of seiten) vergleich.set("w:" + s.rel, { datei: s.rel, ort: "brain", text: s.text, datum: s.datum });
  const nachName = new Map();
  for (const n of behalten) for (const nm of n.info.namen) { if (!nachName.has(nm)) nachName.set(nm, []); nachName.get(nm).push(n.rel); }
  for (const liste of nachName.values()) {
    if (liste.length < 2 || liste.length > MAX_GLEICHER_NAME) continue;
    for (let i = 0; i < liste.length; i++) for (let j = i + 1; j < liste.length; j++) paare.push(["i:" + liste[i], "i:" + liste[j]]);
  }
  for (const g of gruppen) {
    const d = g.dateien;
    // Kleine Gruppen: jedes Paar. Große (Vorlagen-Notizen): jede Fassung gegen die erste — linear statt quadratisch.
    if (d.length <= MAX_GRUPPE_PAARE) { for (let i = 0; i < d.length; i++) for (let j = i + 1; j < d.length; j++) paare.push(["i:" + d[i], "i:" + d[j]]); }
    else for (let j = 1; j < d.length; j++) paare.push(["i:" + d[0], "i:" + d[j]]);
  }
  // „Dieselbe Sache“ mit einer Wiki-Seite: gleicher Titel/Name/Alias, oder die Notiz verlinkt die Seite (Link-Ziel).
  const ueberschneidungen = [], ueGesehen = new Set();
  const ueberschneidung = (n, s, ueber) => {
    const k = n.rel + "\u0000" + s.rel;
    if (ueGesehen.has(k)) return;
    ueGesehen.add(k);
    ueberschneidungen.push({ datei: n.rel, seite: s.rel, titel: s.titel, ueber });
    paare.push(["i:" + n.rel, "w:" + s.rel]);
  };
  for (const n of behalten) for (const nm of n.info.namen) for (const s of seiteNachName.get(nm) || []) ueberschneidung(n, s, "name");
  for (const n of behalten) {
    const ziele = [...new Set(n.info.links.map(linkName))].filter(Boolean);
    if (!ziele.length || ziele.length > MAX_LINKS) continue;
    for (const z of ziele) {
      const seitenZ = seiteNachName.get(z) || [];
      if (seitenZ.length <= MAX_GLEICHER_NAME) for (const s of seitenZ) ueberschneidung(n, s, "link");
      // Innerhalb des Imports: Notiz A verlinkt Notiz B → gleiche Sache, auf Widersprüche prüfen.
      const notizenZ = nachName.get(z) || [];
      if (notizenZ.length <= MAX_GLEICHER_NAME) for (const r of notizenZ) if (r !== n.rel) paare.push(["i:" + n.rel, "i:" + r]);
    }
  }
  const widersprueche = findeWidersprueche(vergleich, paare).map(w => ({
    a: { ...w.a, satz: ohneZugangsdaten(w.a.satz) }, b: { ...w.b, satz: ohneZugangsdaten(w.b.satz) }, art: w.art, neuer: w.neuer,
  }));

  // 6) Ziel wählen (existiert → -2, -3 …) und kopieren. Nur unterhalb des Ziels wird geschrieben.
  let nameFinal = basis, i = 2;
  while (existsSync(join(importWurzel, nameFinal))) nameFinal = `${basis}-${i++}`;
  const ziel = join(importWurzel, nameFinal);
  mkdirSync(ziel, { recursive: true });
  const kopien = [];
  const schreibe = (e, buf, extra) => {
    const relZiel = sichererRel(e.rel);
    const voll = join(ziel, ...relZiel.split("/"));
    if (!innerhalb(ziel, voll) || voll === ziel) { ausgelassen.push({ rel: e.rel, grund: "unsicherer Pfad" }); return; }
    try {
      mkdirSync(dirname(voll), { recursive: true });
      writeFileSync(voll, buf, { flag: "wx" });
    } catch (err) {
      ausgelassen.push({ rel: e.rel, grund: err.code === "EEXIST" ? "Namenskonflikt (gleicher Name in anderer Schreibweise)" : "nicht schreibbar" });
      return;
    }
    if (e.datum instanceof Date && !isNaN(e.datum)) { try { utimesSync(voll, e.datum, e.datum); } catch {} }
    kopien.push({ rel: relZiel, ...extra });
  };
  // Neu lesen und gegen den Hash der Vorprüfung prüfen: hat sich die Quelle dazwischen geändert, wird nichts
  // Ungeprüftes kopiert.
  const nochmal = (e, hash, sha) => {
    let buf;
    try { buf = e.lies(); } catch { ausgelassen.push({ rel: e.rel, grund: "nicht lesbar" }); return null; }
    if (hash(buf) !== sha) { ausgelassen.push({ rel: e.rel, grund: "während des Imports verändert" }); return null; }
    return buf;
  };
  for (const n of behalten) {
    const buf = nochmal(n, (x) => textHash(x.toString("utf8")), n.sha);
    if (buf) schreibe(n, buf, { sha: n.sha, titel: n.info.titel, links: n.info.links, aliase: n.info.aliase });
  }
  for (const b of beilagenBehalten) {
    const buf = nochmal(b, sha256, b.sha);
    if (buf) schreibe(b, buf, { sha: b.sha, titel: stamm(b.rel), links: [], aliase: [] });
  }
  for (const b of bilderMit) {
    const buf = b.lies(), sha = sha256(buf);
    if (frueher.has(sha)) { duplikateExakt.push({ datei: b.rel, gleichWie: frueher.get(sha), ort: "brain" }); continue; }
    schreibe(b, buf, { sha, titel: stamm(b.rel), links: [], aliase: [] });
  }

  const pk = pakete(behalten);
  const zielRel = [o.inbox, "_import", nameFinal].join("/");
  const ergebnis = {
    status: "ok", art: q.art, name: nameFinal, ziel: zielRel, notizen: gefunden, kopiert: kopien.length,
    duplikateExakt, gruppen, widersprueche, ueberschneidungen, pakete: pk,
    tokenSchaetzung: pk.reduce((s, p) => s + p.tokenSchaetzung, 0), groesseBytes,
  };
  const importiert = (jetzt instanceof Date ? jetzt : new Date(jetzt)).toISOString();
  const begleit = { art: q.art, quelle: q.name, importiert, dateien: kopien };
  // _bericht.json: duplikateExakt als ANZAHL (so liest analyse.mjs die Importe), die Liste unter duplikateExaktListe.
  const bericht = { ...ergebnis, duplikateExakt: duplikateExakt.length, duplikateExaktListe: duplikateExakt, quelle: q.name, importiert,
    pdfs: kopien.filter(k => /\.pdf$/i.test(k.rel)).length, secretsIn, ausgelassen };
  writeFileSync(join(ziel, "_import.json"), JSON.stringify(begleit, null, 2) + "\n");
  writeFileSync(join(ziel, "_bericht.json"), JSON.stringify(bericht, null, 2) + "\n");
  writeFileSync(join(ziel, "_bericht.md"), berichtMarkdown(bericht));
  return { ...ergebnis, ausgelassen: ausgelassen.length, secretsIn };
}

const ART_TEXT = { obsidian: "Obsidian", notion: "Notion-Export", logseq: "Logseq", ordner: "Ordner mit Notizen" };
const WART_TEXT = { zahl: "Zahl/Betrag", datum: "Datum", version: "Version", jaNein: "Ja/Nein" };
const code = (s) => "`" + String(s).replace(/`/g, "'") + "`";
const zitat = (s) => "„" + String(s).replace(/\s+/g, " ").slice(0, 240) + "“";

export function berichtMarkdown(b) {
  const z = [];
  const dups = Array.isArray(b.duplikateExakt) ? b.duplikateExakt : (b.duplikateExaktListe || []);
  const secretsIn = b.secretsIn || [];
  z.push(`# Import „${b.quelle}“ — Vorprüfung`, "");
  z.push(`Art: ${ART_TEXT[b.art] || b.art} · importiert am ${b.importiert.slice(0, 10)} · Ablage: ${code(b.ziel + "/")}`, "");
  z.push(`- ${b.notizen} Notizen gefunden, ${b.kopiert} Dateien übernommen (davon ${b.pdfs} PDFs).`);
  z.push(`- ${dups.length} exakte Duplikate übersprungen.`);
  if (secretsIn.length) z.push(`- ${secretsIn.length} Notizen wegen Zugangsdaten nicht übernommen.`);
  z.push(`- ${b.gruppen.length} Gruppen „gleiche Sache, mehrere Fassungen“.`);
  z.push(`- ${b.widersprueche.length} mögliche Widersprüche — bitte selbst entscheiden.`);
  z.push(`- ${b.ueberschneidungen.length} Notizen ergänzen bestehende Wiki-Seiten.`);
  z.push(`- Vollständiges Einarbeiten kostet geschätzt etwa ${b.tokenSchaetzung.toLocaleString("de-DE")} Tokens.`, "");
  z.push("Die Markdown-Notizen (.md) sind ab sofort über die Suche auffindbar (ungeprüft); .txt- und PDF-Dateien liegen im Import-Ordner. Eingearbeitet wird erst, wenn du ein Paket freigibst.", "");
  if (secretsIn.length) {
    z.push("## Nicht importiert — enthält vermutlich Zugangsdaten", "",
      "Diese Notizen enthalten etwas, das wie ein Passwort oder Schlüssel aussieht, und wurden darum nicht übernommen."
      + " Bitte in der Quelle bereinigen und neu importieren (schon Übernommenes wird dann als Duplikat übersprungen):", "");
    const zeilenVon = new Map((b.ausgelassen || []).filter(a => Array.isArray(a.zeilen)).map(a => [a.rel, a.zeilen]));
    for (const r of secretsIn) { const zl = zeilenVon.get(r); z.push(`- ${code(r)}${zl?.length ? ` (Zeile ${zl.join(", ")})` : ""}`); }
    z.push("");
  }
  if (b.widersprueche.length) {
    z.push("## Mögliche Widersprüche", "", "Gleiche Sache, unterschiedliche Angaben. Nichts wird still entschieden — beim Einarbeiten kommen beide Stellen in einen Konflikt-Kasten.", "");
    for (const w of b.widersprueche) {
      const neuer = w.neuer ? ` — neuer: ${code(w[w.neuer].datei)}` : "";
      z.push(`- **${WART_TEXT[w.art] || w.art}:** ${zitat(w.a.satz)} (${code(w.a.datei)}${w.a.datum ? ", " + w.a.datum : ""})`
        + ` ↔ ${zitat(w.b.satz)} (${code(w.b.datei)}${w.b.ort === "brain" ? ", im Brain" : ""}${w.b.datum ? ", " + w.b.datum : ""})${neuer}`);
    }
    z.push("");
  }
  if (b.gruppen.length) {
    z.push("## Gleiche Sache, mehrere Fassungen", "", "Beim Einarbeiten wird daraus je Gruppe eine Wiki-Seite.", "");
    b.gruppen.forEach((g, i) => z.push(`- Gruppe ${i + 1} (${Math.round(g.aehnlichkeit * 100)} % ähnlich): ${g.dateien.map(code).join(", ")}`));
    z.push("");
  }
  if (b.ueberschneidungen.length) {
    z.push("## Ergänzt bestehende Seiten", "");
    for (const u of b.ueberschneidungen) z.push(`- ${code(u.datei)} ${u.ueber === "link" ? "verweist auf" : "ergänzt"} Seite ${code(u.seite)}`);
    z.push("");
  }
  if (dups.length) {
    z.push("## Exakte Duplikate (nicht übernommen)", "");
    for (const d of dups) z.push(`- ${code(d.datei)} ist gleich wie ${code(d.gleichWie)}${d.ort === "brain" ? " (schon im Brain)" : ""}`);
    z.push("");
  }
  if (b.pakete.length) {
    z.push("## Pakete fürs Einarbeiten", "", "| Paket | Notizen | Zeichen | Tokens (geschätzt) |", "|---|---:|---:|---:|");
    for (const p of b.pakete) z.push(`| ${p.name.replace(/\|/g, "/")} | ${p.notizen} | ${p.zeichen} | ${p.tokenSchaetzung} |`);
    z.push("");
  }
  if (b.ausgelassen.length) {
    const nachGrund = new Map();
    for (const a of b.ausgelassen) nachGrund.set(a.grund, (nachGrund.get(a.grund) || 0) + 1);
    z.push("## Ausgelassen", "");
    for (const [g, n] of nachGrund) z.push(`- ${g}: ${n}`);
    z.push("");
  }
  return z.join("\n");
}

// Kurzbericht fürs Terminal (und für die KI).
export function kurzBericht(r) {
  const mb = (r.groesseBytes / 1024 / 1024).toFixed(1).replace(".", ",");
  if (r.status === "bestaetigen") {
    return [
      `Das ist ein großer Import: ${r.notizen} Notizen, ${mb} MB.`,
      `Vollständiges Einarbeiten kostet geschätzt etwa ${r.tokenSchaetzung.toLocaleString("de-DE")} Tokens (nach und nach, je Paket).`,
      "Soll ich trotzdem importieren? Dann noch einmal mit --ja aufrufen. Es wurde noch nichts kopiert.",
    ].join("\n");
  }
  return [
    `Import fertig: ${r.notizen} Notizen gefunden, ${r.kopiert} Dateien nach ${r.ziel}/ übernommen.`,
    `${r.duplikateExakt.length} exakte Duplikate übersprungen, ${r.gruppen.length} Gruppen mit mehreren Fassungen, `
      + `${r.widersprueche.length} mögliche Widersprüche, ${r.ueberschneidungen.length} Überschneidungen mit dem Wiki.`,
    ...(r.secretsIn.length ? [`${r.secretsIn.length} Notizen wegen Zugangsdaten nicht übernommen (siehe Bericht).`] : []),
    `Bericht: ${r.ziel}/_bericht.md — geschätzt ${r.tokenSchaetzung.toLocaleString("de-DE")} Tokens fürs vollständige Einarbeiten.`,
  ].join("\n");
}

export function cli(argv = process.argv.slice(2)) {
  const pos = [], opt = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--ja") opt.bestaetigt = true;
    else if (a === "--name") opt.name = argv[++i];
    else if (a.startsWith("--name=")) opt.name = a.slice(7);
    else pos.push(a);
  }
  if (!pos[0]) {
    console.log("Aufruf: node .tools/import/import.mjs <ordner|zip> [vault] [--name x] [--ja]");
    return 1;
  }
  const vault = pos[1] || process.env.BRAIN_VAULT || EIGENER_VAULT;
  try {
    console.log(kurzBericht(importiere(vault, pos[0], opt)));
    return 0;
  } catch (e) {
    if (e instanceof ImportFehler || e instanceof ZipFehler) { console.log(e.message); return 1; }
    console.log("Import abgebrochen: " + String(e?.message || e).split("\n")[0]);
    return 1;
  }
}

const selbst = fileURLToPath(import.meta.url);
let aufruf = "";
try { aufruf = realpathSync(process.argv[1] || ""); } catch {}
if (aufruf && aufruf === realpathSync(selbst)) process.exitCode = cli();
