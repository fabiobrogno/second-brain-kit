// .tools/tests/test-logs.mjs — haengeAn (Rotation), zeitstempel, leseFelder, leseZeilen.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { haengeAn, zeitstempel, leseFelder, leseZeilen } from "../logs.mjs";

const neuerOrdner = () => mkdtempSync(join(tmpdir(), "brain logs "));

test("haengeAn legt den Ordner an, falls er fehlt", () => {
  const basis = neuerOrdner();
  const datei = join(basis, "tief", "verschachtelt", "x.log");
  assert.equal(existsSync(datei), false);
  haengeAn(datei, "erste zeile");
  assert.equal(readFileSync(datei, "utf8"), "erste zeile\n");
});

test("haengeAn rotiert atomar: 6000 Zeilen mit max:5000/behalte:2500 → Datei hat 2500 Zeilen, letzte ist die zuletzt angehängte", () => {
  const datei = join(neuerOrdner(), "rotation.log");
  // 5999 schon vorhandene Zeilen (noch unter max) + EIN Anhängen, das die Datei auf 6000 Zeilen bringt
  // und damit max:5000 überschreitet → Kürzung auf die letzten behalte:2500.
  const vorab = Array.from({ length: 5999 }, (_, i) => `${zeitstempel()} i=${i}`).join("\n") + "\n";
  writeFileSync(datei, vorab);
  haengeAn(datei, "i=5999 art=letzte", { max: 5000, behalte: 2500 });
  const zeilen = readFileSync(datei, "utf8").split("\n").filter(Boolean);
  assert.equal(zeilen.length, 2500);
  assert.equal(zeilen.at(-1), "i=5999 art=letzte");
  assert.match(zeilen[0], /i=3500$/); // letzte 2500 von 6000 → beginnt bei i=3500
});

test("haengeAn wirft nie — auch wenn das Ziel ein Ordner statt einer Datei ist", () => {
  const basis = neuerOrdner();
  const alsOrdner = join(basis, "ist-ein-ordner");
  haengeAn(join(alsOrdner, "x"), "ok"); // legt erst "ist-ein-ordner" als Verzeichnis an
  assert.doesNotThrow(() => haengeAn(alsOrdner, "das kann nicht klappen"));
});

test("zeitstempel: UTC, 19 Zeichen, wie hint.log (toISOString ohne Millisekunden/Z)", () => {
  const d = new Date(Date.UTC(2026, 9, 2, 10, 0, 0));
  assert.equal(zeitstempel(d), "2026-10-02T10:00:00");
  assert.equal(zeitstempel(d).length, 19);
});

test("leseFelder: Werte mit Leerzeichen sind encodeURIComponent-kodiert und werden dekodiert", () => {
  const f = leseFelder("2026-10-02T10:00:00 sid=ab art=lesen ziel=09_wiki%2Fa%20b.md");
  assert.deepEqual(f, { zeit: "2026-10-02T10:00:00", sid: "ab", art: "lesen", ziel: "09_wiki/a b.md" });
});

test("leseFelder: ungültiges Prozent-Encoding fällt auf den Rohwert zurück statt zu werfen", () => {
  const f = leseFelder("2026-10-02T10:00:00 x=ab%");
  assert.equal(f.x, "ab%");
});

test("leseFelder: text= ist immer das letzte Feld und bleibt roh bis Zeilenende (auch mit Leerzeichen und '=')", () => {
  const f = leseFelder("2026-10-02T10:00:00 sid=ab art=notiz text=hallo welt a=b nicht geparst");
  assert.equal(f.sid, "ab");
  assert.equal(f.art, "notiz");
  assert.equal(f.text, "hallo welt a=b nicht geparst");
});

test("leseFelder: Zeile ohne Felder (nur Zeitstempel)", () => {
  assert.deepEqual(leseFelder("2026-10-02T10:00:00"), { zeit: "2026-10-02T10:00:00" });
});

test("leseFelder (Review-Fund 2b): ein Token ohne '=' wird übersprungen statt die Zeile abzubrechen", () => {
  const f = leseFelder("2026-10-02T10:00:00 sid=ab kaputtesToken art=lesen");
  assert.equal(f.sid, "ab");
  assert.equal(f.art, "lesen"); // ohne den Fix würde die Zeile nach "sid=ab" abbrechen und art fehlte
});

test("leseFelder (Review-Fund 2): hits= aus brain-hint — EIN encodeURIComponent-Token mit Tab-getrennten Seiten, Seitenname mit Leerzeichen/Komma/Slash übersteht die Dekodierung vollständig", () => {
  const seiten = ["09_wiki/thema_a.md", "09_wiki/thema b, c.md", "00_inbox/_import/obs/x, y.md"];
  const zeile = `2026-10-02T10:00:00 sid=ab len=10 hits=${encodeURIComponent(seiten.join("\t"))} unterdrueckt=0`;
  const f = leseFelder(zeile);
  assert.deepEqual(f.hits.split("\t"), seiten);
  assert.equal(f.unterdrueckt, "0");
});

test("leseZeilen: fehlende Datei → []", () => {
  assert.deepEqual(leseZeilen(join(neuerOrdner(), "fehlt.log")), []);
});

test("leseZeilen: filtert nach seitMs", () => {
  const datei = join(neuerOrdner(), "zeit.log");
  const alt = Date.UTC(2026, 0, 1, 0, 0, 0);
  const neu = Date.UTC(2026, 0, 2, 0, 0, 0);
  writeFileSync(datei, `${zeitstempel(new Date(alt))} art=alt\n${zeitstempel(new Date(neu))} art=neu\n`);
  const alle = leseZeilen(datei);
  assert.equal(alle.length, 2);
  const nurNeu = leseZeilen(datei, { seitMs: Date.UTC(2026, 0, 1, 12, 0, 0) });
  assert.equal(nurNeu.length, 1);
  assert.equal(nurNeu[0].art, "neu");
});

test("leseZeilen: CRLF-Datei wird korrekt gelesen", () => {
  const datei = join(neuerOrdner(), "crlf.log");
  writeFileSync(datei, "2026-10-02T10:00:00 art=eins\r\n2026-10-02T10:00:01 art=zwei\r\n");
  const zeilen = leseZeilen(datei);
  assert.equal(zeilen.length, 2);
  assert.equal(zeilen[0].art, "eins");
  assert.equal(zeilen[1].art, "zwei");
});
