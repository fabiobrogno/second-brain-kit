// .tools/import/erkennen.mjs — Quelle öffnen (Ordner oder Zip) und ihre Art erkennen. Liest nur, schreibt nie.
// Liefert alle Dateien als { rel ("/"-getrennt), groesse, datum, lies() } — der Import entscheidet, was kopiert wird.
import { existsSync, statSync, lstatSync, readdirSync, readFileSync, openSync, readSync, closeSync } from "node:fs";
import { join, basename, resolve } from "node:path";
import { leseZip, ZipFehler } from "./zip.mjs";

export class ImportFehler extends Error { constructor(m) { super(m); this.name = "ImportFehler"; } }

// Programm-/Systemordner, die nie mitkommen (dazu alles, was mit "." beginnt).
export const AUSLASSEN_ORDNER = new Set([".obsidian", ".trash", ".git", "node_modules", "__MACOSX"]);
const NOTION_DATEI = /\s[0-9a-f]{32}\.(md|csv)$/i;
const MAX_ZIP = 1024 * 1024 * 1024;

function istZipDatei(pfad) {
  if (/\.zip$/i.test(pfad)) return true;
  try {
    const fd = openSync(pfad, "r"); const b = Buffer.alloc(4);
    try { readSync(fd, b, 0, 4, 0); } finally { closeSync(fd); }
    return b.readUInt32LE(0) === 0x04034b50;
  } catch { return false; }
}

function artAus(relsRoh) {
  const segs = relsRoh.map(r => r.split("/"));
  if (segs.some(s => s.includes(".obsidian"))) return "obsidian";
  if (segs.some(s => (s.length > 1 && (s[0] === "pages" || s[0] === "journals"))
    || (s.length > 2 && (s[1] === "pages" || s[1] === "journals")))) return "logseq";
  if (relsRoh.some(r => NOTION_DATEI.test(r))) return "notion";
  return "ordner";
}

function ordnerEintraege(wurzel) {
  const eintraege = [], ausgelassen = [], roh = [];
  const lauf = (dir, relDir) => {
    for (const name of readdirSync(dir).sort()) {
      const full = join(dir, name), rel = relDir ? `${relDir}/${name}` : name;
      let st;
      try { st = lstatSync(full); } catch { ausgelassen.push({ rel, grund: "nicht lesbar" }); continue; }
      roh.push(rel + (st.isDirectory() ? "/" : ""));
      if (st.isSymbolicLink()) { ausgelassen.push({ rel, grund: "Verknüpfung" }); continue; }
      if (name.startsWith(".") || AUSLASSEN_ORDNER.has(name)) {
        ausgelassen.push({ rel: rel + (st.isDirectory() ? "/" : ""), grund: "Programm- oder Systemdatei" });
        continue;
      }
      if (st.isDirectory()) lauf(full, rel);
      else if (st.isFile()) eintraege.push({ rel, groesse: st.size, datum: st.mtime, lies: () => readFileSync(full) });
    }
  };
  lauf(wurzel, "");
  return { eintraege, ausgelassen, roh };
}

// Zip-Pfad → sicherer relativer Pfad oder null (absolut, Laufwerk wie „C:“ oder „C:x“, UNC, "..", leer).
export function sichererZipRel(name) {
  const teile = String(name).replace(/\\/g, "/").split("/");
  if (teile[0] === "" || /^[A-Za-z]:/.test(teile[0])) return null;
  const sauber = teile.filter(t => t !== "" && t !== ".");
  if (!sauber.length || sauber.some(t => t === "..")) return null;
  return sauber.join("/");
}

// Grenzen gegen Zip-Bomben — geprüft an den Angaben des zentralen Verzeichnisses, bevor irgendetwas entpackt wird.
// Die Angaben selbst sind abgesichert: zip.mjs entpackt nie mehr als die angegebene Größe (maxOutputLength) und
// prüft Größe + CRC. Einträge > 5 MB oder stärker als 100:1 gepackt werden nie entpackt.
export const ZIP_GRENZEN = { gesamt: 500 * 1024 * 1024, datei: 5 * 1024 * 1024, verhaeltnis: 100 };
const VERHAELTNIS_AB = 64 * 1024;   // kleine Dateien (leere Vorlagen, Wiederholungen) dürfen stark gepackt sein

function zipEintraege(pfad) {
  const st = statSync(pfad);
  if (st.size > MAX_ZIP) throw new ZipFehler("größer als 1 GB");
  const liste = leseZip(readFileSync(pfad));
  const gesamt = liste.reduce((s, e) => s + (e.istOrdner ? 0 : e.groesse), 0);
  if (gesamt > ZIP_GRENZEN.gesamt) throw new ZipFehler("entpackt größer als 500 MB");
  const eintraege = [], ausgelassen = [], roh = [];
  for (const e of liste) {
    if (e.istOrdner) { const r = sichererZipRel(e.name); if (r) roh.push(r + "/"); continue; }
    const rel = sichererZipRel(e.name);
    if (!rel) { ausgelassen.push({ rel: e.name, grund: "unsicherer Pfad" }); continue; }
    roh.push(rel);
    if (rel.split("/").some(t => t.startsWith(".") || AUSLASSEN_ORDNER.has(t))) {
      ausgelassen.push({ rel, grund: "Programm- oder Systemdatei" }); continue;
    }
    // Zip in der Zip wird nie ausgepackt (Bomben-Schutz) — der Nutzer entpackt sie selbst.
    if (/\.zip$/i.test(rel)) { ausgelassen.push({ rel, grund: "Zip in der Zip — bitte zuerst entpacken" }); continue; }
    if (e.groesse > ZIP_GRENZEN.datei) { ausgelassen.push({ rel, grund: "größer als 5 MB" }); continue; }
    if (e.groesse > VERHAELTNIS_AB && e.groesse > ZIP_GRENZEN.verhaeltnis * Math.max(e.gepackt, 1)) {
      ausgelassen.push({ rel, grund: "verdächtig stark gepackt" }); continue;
    }
    eintraege.push({ rel, groesse: e.groesse, datum: e.datum || st.mtime, lies: () => e.daten() });
  }
  return { eintraege, ausgelassen, roh };
}

// quelle: Ordner oder Zip-Datei. Rückgabe: { art, istZip, name, eintraege, ausgelassen }.
export function oeffneQuelle(quelle) {
  if (!quelle || !existsSync(quelle)) throw new ImportFehler(`Die Quelle gibt es nicht: ${quelle ? basename(String(quelle)) : "(leer)"}`);
  const abs = resolve(quelle);
  const st = statSync(abs);
  const istZip = st.isFile() && istZipDatei(abs);
  if (st.isFile() && !istZip) throw new ImportFehler("Die Quelle ist weder ein Ordner noch eine Zip-Datei.");
  const { eintraege, ausgelassen, roh } = istZip ? zipEintraege(abs) : ordnerEintraege(abs);
  const name = basename(abs).replace(/\.zip$/i, "");
  return { art: artAus(roh), istZip, name, eintraege, ausgelassen };
}

export function erkenneArt(quelle) {
  return oeffneQuelle(quelle).art;
}
