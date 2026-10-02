// .tools/import/zip.mjs — Zip lesen (und für Tests schreiben) nur mit node:zlib, ohne Abhängigkeiten.
// Unterstützt: Store (0) und Deflate (8). Zip64, verschlüsselte Einträge und andere Verfahren → ZipFehler mit
// klarer Meldung („bitte entpacken und den Ordner importieren“). Liest nur das zentrale Verzeichnis und
// entpackt einen Eintrag erst, wenn er gebraucht wird (daten()).
import { inflateRawSync, deflateRawSync } from "node:zlib";

export class ZipFehler extends Error {
  constructor(grund) {
    super(`Diese Zip-Datei kann ich nicht lesen (${grund}) — bitte entpacken und den Ordner importieren.`);
    this.name = "ZipFehler";
  }
}

const SIG_EOCD = 0x06054b50, SIG_Z64_LOC = 0x07064b50, SIG_Z64_EOCD = 0x06064b50;
const SIG_ZENTRAL = 0x02014b50, SIG_LOKAL = 0x04034b50;

const CRC_TABELLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
export function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABELLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function dosDatum(d, t) {
  const j = ((d >> 9) & 0x7f) + 1980, m = (d >> 5) & 0x0f, tag = d & 0x1f;
  if (!m || !tag) return null;
  return new Date(j, m - 1, tag, t >> 11, (t >> 5) & 0x3f, (t & 0x1f) * 2);
}

// buf: Buffer mit der ganzen Zip-Datei. Rückgabe: [{ name, groesse, gepackt, datum, istOrdner, daten() }].
// groesse/gepackt sind die Angaben aus dem zentralen Verzeichnis — damit prüft der Aufrufer Grenzen, BEVOR er entpackt.
export function leseZip(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 22) throw new ZipFehler("keine gültige Zip-Datei");
  // Ende des zentralen Verzeichnisses: am Dateiende, höchstens 64 KB Kommentar dahinter.
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === SIG_EOCD) { eocd = i; break; }
  }
  if (eocd < 0) throw new ZipFehler("keine gültige Zip-Datei");
  const anzahl = buf.readUInt16LE(eocd + 10), groesseZD = buf.readUInt32LE(eocd + 12), startZD = buf.readUInt32LE(eocd + 16);
  const z64 = (eocd >= 20 && buf.readUInt32LE(eocd - 20) === SIG_Z64_LOC)
    || anzahl === 0xffff || groesseZD === 0xffffffff || startZD === 0xffffffff;
  if (z64) throw new ZipFehler("Zip64-Format");
  if (startZD + groesseZD > eocd) throw new ZipFehler("beschädigtes Inhaltsverzeichnis");

  const out = [];
  let p = startZD;
  for (let n = 0; n < anzahl; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== SIG_ZENTRAL) throw new ZipFehler("beschädigtes Inhaltsverzeichnis");
    const flags = buf.readUInt16LE(p + 8), verfahren = buf.readUInt16LE(p + 10);
    const zeit = buf.readUInt16LE(p + 12), datum = buf.readUInt16LE(p + 14), crc = buf.readUInt32LE(p + 16);
    const gepackt = buf.readUInt32LE(p + 20), groesse = buf.readUInt32LE(p + 24);
    const lName = buf.readUInt16LE(p + 28), lExtra = buf.readUInt16LE(p + 30), lKomm = buf.readUInt16LE(p + 32);
    const lokal = buf.readUInt32LE(p + 42);
    const roh = buf.subarray(p + 46, p + 46 + lName);
    // Bit 11 = UTF-8; ohne Bit liefern Notion & Co. in der Praxis trotzdem UTF-8 — ungültige Bytes → latin1.
    let name = roh.toString("utf8");
    if (!(flags & 0x800) && name.includes("�")) name = roh.toString("latin1");
    p += 46 + lName + lExtra + lKomm;
    if (gepackt === 0xffffffff || groesse === 0xffffffff || lokal === 0xffffffff) throw new ZipFehler("Zip64-Format");
    if (flags & 0x1) throw new ZipFehler("verschlüsselt");
    const istOrdner = name.endsWith("/");
    if (!istOrdner && verfahren !== 0 && verfahren !== 8) throw new ZipFehler(`Packverfahren ${verfahren}`);
    out.push({
      name, groesse, gepackt, istOrdner, datum: dosDatum(datum, zeit),
      daten() {
        if (lokal + 30 > buf.length || buf.readUInt32LE(lokal) !== SIG_LOKAL) throw new ZipFehler("beschädigter Eintrag");
        const start = lokal + 30 + buf.readUInt16LE(lokal + 26) + buf.readUInt16LE(lokal + 28);
        const roh = buf.subarray(start, start + gepackt);
        if (roh.length !== gepackt) throw new ZipFehler("beschädigter Eintrag");
        // maxOutputLength schützt vor Zip-Bomben: nie mehr als die angegebene Größe entpacken.
        let d;
        try { d = verfahren === 0 ? roh : inflateRawSync(roh, { maxOutputLength: Math.max(groesse, 1) }); }
        catch { throw new ZipFehler("beschädigter Eintrag"); }
        if (d.length !== groesse || crc32(d) !== crc) throw new ZipFehler("Prüfsumme stimmt nicht");
        return d;
      },
    });
  }
  return out;
}

// Für Tests: baut eine Zip-Datei. eintraege: [{ name, daten: Buffer|string, komprimiert?: boolean, datum?: Date }].
export function baueZip(eintraege) {
  const lokalTeile = [], zentralTeile = [];
  let versatz = 0;
  for (const e of eintraege) {
    const daten = Buffer.isBuffer(e.daten) ? e.daten : Buffer.from(String(e.daten ?? ""), "utf8");
    const gepackt = e.komprimiert ? deflateRawSync(daten) : daten;
    const name = Buffer.from(e.name, "utf8");
    const d = e.datum || new Date(2025, 0, 1, 12, 0, 0);
    const dz = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    const tz = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
    const crc = crc32(daten), verfahren = e.komprimiert ? 8 : 0;
    const lok = Buffer.alloc(30);
    lok.writeUInt32LE(SIG_LOKAL, 0); lok.writeUInt16LE(20, 4); lok.writeUInt16LE(0x800, 6); lok.writeUInt16LE(verfahren, 8);
    lok.writeUInt16LE(tz, 10); lok.writeUInt16LE(dz, 12); lok.writeUInt32LE(crc, 14);
    lok.writeUInt32LE(gepackt.length, 18); lok.writeUInt32LE(daten.length, 22); lok.writeUInt16LE(name.length, 26);
    const zen = Buffer.alloc(46);
    zen.writeUInt32LE(SIG_ZENTRAL, 0); zen.writeUInt16LE(20, 4); zen.writeUInt16LE(20, 6); zen.writeUInt16LE(0x800, 8);
    zen.writeUInt16LE(verfahren, 10); zen.writeUInt16LE(tz, 12); zen.writeUInt16LE(dz, 14); zen.writeUInt32LE(crc, 16);
    zen.writeUInt32LE(gepackt.length, 20); zen.writeUInt32LE(daten.length, 24); zen.writeUInt16LE(name.length, 28);
    zen.writeUInt32LE(versatz, 42);
    lokalTeile.push(lok, name, gepackt);
    zentralTeile.push(zen, name);
    versatz += 30 + name.length + gepackt.length;
  }
  const zentral = Buffer.concat(zentralTeile);
  const ende = Buffer.alloc(22);
  ende.writeUInt32LE(SIG_EOCD, 0); ende.writeUInt16LE(eintraege.length, 8); ende.writeUInt16LE(eintraege.length, 10);
  ende.writeUInt32LE(zentral.length, 12); ende.writeUInt32LE(versatz, 16);
  return Buffer.concat([...lokalTeile, zentral, ende]);
}

export { SIG_Z64_LOC, SIG_Z64_EOCD };
