// .tools/tests/test-einstellungen.mjs — Schema, leseAutomatik (STANDARD/Altschlüssel/cfg.automatik),
// schreibeAutomatik (409-Sperre, 400-Validierung, 500 bei kaputter Config, übrige Abschnitte unberührt).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  SCHEMA, STANDARD, HINWEIS_SCHWELLEN, leseAutomatik, schreibeAutomatik, wert,
} from "../einstellungen.mjs";

const neu = () => { const v = join(mkdtempSync(join(tmpdir(), "brain einst ")), "Mein Brain"); mkdirSync(v); return v; };
const configPfad = (v) => join(v, "brain.config.json");
// Bewusst unsortierte Top-Level- UND Unterschlüssel, um „Reihenfolge erhalten" wirklich zu prüfen.
const BEISPIEL = {
  zebra: 1,
  alpha: { zweiter: "b", erster: "a" },
  ordner: { archiv: "90_archiv", inbox: "00_inbox" },
};
const schreibeConfig = (v, obj = BEISPIEL) => writeFileSync(configPfad(v), JSON.stringify(obj, null, 2) + "\n");

test("SCHEMA/STANDARD/HINWEIS_SCHWELLEN: Schema exakt wie vorgegeben", () => {
  assert.deepEqual(STANDARD, {
    staendeIntervallStunden: 0, ernteSitzungsende: false, ernteNichtIn: [], ichKarte: false,
    projektAutomatik: true, hinweise: "mittel", liveAufleuchten: true, updateHinweis: true,
    sicherungTaeglich: true, luecken: false,
    wochenbericht: true, pflegeLauf: "aus", lektionen: "lokal", antwortMesslatte: "aus",
  });
  assert.deepEqual(SCHEMA.pflegeLauf.werte, ["aus", "woechentlich"]);
  assert.deepEqual(SCHEMA.antwortMesslatte.werte, ["aus", "monatlich"], "Antwort-Messlatte: opt-in, Standard aus");
  assert.deepEqual(SCHEMA.lektionen.werte, ["aus", "lokal", "mit-ki"]);
  assert.equal(SCHEMA.wochenbericht.typ, "boolean");
  assert.deepEqual(SCHEMA.staendeIntervallStunden.werte, [0, 1, 2, 4]);
  assert.deepEqual(SCHEMA.hinweise.werte, ["aus", "niedrig", "mittel", "hoch"]);
  assert.equal(SCHEMA.ernteNichtIn.typ, "pfadliste");
  assert.deepEqual(HINWEIS_SCHWELLEN, {
    niedrig: { schwelle: 0.08, rerankSchwelle: 0.08 }, mittel: null, hoch: { schwelle: -0.06, rerankSchwelle: -0.07 },
  });
});

test("leseAutomatik: ohne Config → STANDARD, stand '0', kein Fehler", () => {
  const v = neu();
  const { werte, stand, fehler } = leseAutomatik(v);
  assert.deepEqual(werte, STANDARD);
  assert.equal(stand, "0");
  assert.equal(fehler, null);
});

test("leseAutomatik: cfg.automatik überlagert STANDARD, unbekannte/ungültige Schlüssel werden ignoriert", () => {
  const v = neu();
  schreibeConfig(v, { ...BEISPIEL, automatik: { staendeIntervallStunden: 4, luecken: true, unbekannt: "x", hinweise: 3 } });
  const { werte } = leseAutomatik(v);
  assert.equal(werte.staendeIntervallStunden, 4);
  assert.equal(werte.luecken, true);
  assert.equal(werte.hinweise, "mittel"); // 3 ist kein gültiger Wert → ignoriert, STANDARD bleibt
  assert.equal("unbekannt" in werte, false);
});

test("leseAutomatik: Altschlüssel `hinweis` (String) überlagert `hinweise`, aber nur solange automatik.hinweise fehlt", () => {
  const v1 = neu(); schreibeConfig(v1, { ...BEISPIEL, hinweis: "hoch" });
  assert.equal(leseAutomatik(v1).werte.hinweise, "hoch");

  const v2 = neu(); schreibeConfig(v2, { ...BEISPIEL, hinweis: "hoch", automatik: { hinweise: "niedrig" } });
  assert.equal(leseAutomatik(v2).werte.hinweise, "niedrig"); // automatik gewinnt

  // Die reale Config kennt `hinweis` auch als Objekt (Suchfeinheiten) — kein String, also keine Altschlüssel-Wirkung
  const v3 = neu(); schreibeConfig(v3, { ...BEISPIEL, hinweis: { schwelle: 0.345 } });
  assert.equal(leseAutomatik(v3).werte.hinweise, "mittel");

  // ungültiger Altwert wird verworfen statt übernommen
  const v4 = neu(); schreibeConfig(v4, { ...BEISPIEL, hinweis: "superwichtig" });
  assert.equal(leseAutomatik(v4).werte.hinweise, "mittel");
});

test("wert(): Kurzform entspricht leseAutomatik(vault).werte[schluessel]", () => {
  const v = neu(); schreibeConfig(v, { ...BEISPIEL, automatik: { projektAutomatik: false } });
  assert.equal(wert(v, "projektAutomatik"), false);
  assert.equal(wert(v, "luecken"), STANDARD.luecken);
});

test("schreibeAutomatik: ohne vorhandene Config (stand '0') legt die Datei neu an", () => {
  const v = neu();
  assert.equal(leseAutomatik(v).stand, "0");
  const erg = schreibeAutomatik(v, { staendeIntervallStunden: 2 }, "0");
  assert.equal(erg.ok, true);
  assert.equal(typeof erg.stand, "string");
  assert.notEqual(erg.stand, "0");
  const cfg = JSON.parse(readFileSync(configPfad(v), "utf8"));
  assert.equal(cfg.automatik.staendeIntervallStunden, 2);
});

test("schreibeAutomatik: schreibt automatik.<key>, übrige Abschnitte byte-/schlüsselgleich, Kopie nach .logs/config-vorher.json", () => {
  const v = neu();
  schreibeConfig(v);
  const vorInhalt = readFileSync(configPfad(v), "utf8");
  const vorJson = JSON.parse(vorInhalt);
  const stand = leseAutomatik(v).stand;

  const erg = schreibeAutomatik(v, { staendeIntervallStunden: 2 }, stand);
  assert.equal(erg.ok, true);

  const nachJson = JSON.parse(readFileSync(configPfad(v), "utf8"));
  assert.equal(nachJson.automatik.staendeIntervallStunden, 2);
  const { automatik, ...nachOhneAutomatik } = nachJson;
  assert.deepEqual(nachOhneAutomatik, vorJson); // Vergleich ohne automatik: alle übrigen Abschnitte identisch

  // Schlüsselreihenfolge der übrigen Abschnitte (top-level UND verschachtelt) erhalten
  assert.deepEqual(Object.keys(nachJson).filter(k => k !== "automatik"), Object.keys(vorJson));
  assert.deepEqual(Object.keys(nachJson.alpha), Object.keys(vorJson.alpha));
  assert.deepEqual(Object.keys(nachJson.ordner), Object.keys(vorJson.ordner));

  const kopie = JSON.parse(readFileSync(join(v, ".logs", "config-vorher.json"), "utf8"));
  assert.deepEqual(kopie, vorJson);
});

test("schreibeAutomatik: Teil-Patch führt zusammen — vorherige automatik-Schlüssel bleiben erhalten (brain einstellungen k=v, Task 12, schickt nur einzelne Schlüssel)", () => {
  const v = neu(); schreibeConfig(v);
  const stand1 = leseAutomatik(v).stand;
  schreibeAutomatik(v, { staendeIntervallStunden: 2 }, stand1);

  const stand2 = leseAutomatik(v).stand;
  const erg = schreibeAutomatik(v, { luecken: true }, stand2);
  assert.equal(erg.ok, true);

  const cfg = JSON.parse(readFileSync(configPfad(v), "utf8"));
  assert.deepEqual(cfg.automatik, { staendeIntervallStunden: 2, luecken: true });
  assert.deepEqual(leseAutomatik(v).werte.staendeIntervallStunden, 2);
  assert.deepEqual(leseAutomatik(v).werte.luecken, true);
});

test("schreibeAutomatik: Wert null entfernt den Schlüssel, Rückfall auf Standard — andere zusammengeführte Schlüssel bleiben", () => {
  const v = neu(); schreibeConfig(v);
  const stand1 = leseAutomatik(v).stand;
  schreibeAutomatik(v, { staendeIntervallStunden: 2, luecken: true }, stand1);

  const stand2 = leseAutomatik(v).stand;
  const erg = schreibeAutomatik(v, { staendeIntervallStunden: null }, stand2);
  assert.equal(erg.ok, true);

  const cfg = JSON.parse(readFileSync(configPfad(v), "utf8"));
  assert.equal("staendeIntervallStunden" in cfg.automatik, false);
  assert.equal(cfg.automatik.luecken, true); // unberührter, zuvor zusammengeführter Schlüssel bleibt

  const { werte } = leseAutomatik(v);
  assert.equal(werte.staendeIntervallStunden, STANDARD.staendeIntervallStunden); // Rückfall auf Standard
  assert.equal(werte.luecken, true);
});

test("schreibeAutomatik: falscher Typ, unbekannter Schlüssel, Wert außerhalb der Liste → 400 (deutsche Meldung), Datei unverändert", () => {
  const v = neu(); schreibeConfig(v);
  const stand = leseAutomatik(v).stand;
  const vorInhalt = readFileSync(configPfad(v), "utf8");

  for (const neuWerte of [
    { staendeIntervallStunden: "zwei" }, // falscher Typ
    { unbekannterSchluessel: true },     // unbekannter Schlüssel
    { staendeIntervallStunden: 3 },      // Wert außerhalb der erlaubten Liste
  ]) {
    assert.throws(() => schreibeAutomatik(v, neuWerte, stand), (e) => {
      assert.equal(e.code, 400);
      assert.match(e.message, /[a-zäöüß]/i);
      return true;
    });
  }
  assert.equal(readFileSync(configPfad(v), "utf8"), vorInhalt);
});

test("schreibeAutomatik: veralteter stand → 409, Datei unverändert", () => {
  const v = neu(); schreibeConfig(v);
  const vorInhalt = readFileSync(configPfad(v), "utf8");
  assert.throws(() => schreibeAutomatik(v, { staendeIntervallStunden: 2 }, "0" /* längst veraltet */), (e) => {
    assert.equal(e.code, 409);
    return true;
  });
  assert.equal(readFileSync(configPfad(v), "utf8"), vorInhalt);
});

test("leseAutomatik + schreibeAutomatik: kaputte Config → fehler gesetzt bzw. code 500, Datei unverändert", () => {
  const v = neu();
  writeFileSync(configPfad(v), "{ das ist kein json");
  const { fehler, werte } = leseAutomatik(v);
  assert.ok(fehler);
  assert.deepEqual(werte, STANDARD); // lesend nie crashen, Rückfall auf STANDARD
  const vorInhalt = readFileSync(configPfad(v), "utf8");
  assert.throws(() => schreibeAutomatik(v, { staendeIntervallStunden: 2 }, "0"), (e) => {
    assert.equal(e.code, 500);
    return true;
  });
  assert.equal(readFileSync(configPfad(v), "utf8"), vorInhalt);
});

test("ernteNichtIn: akzeptiert nur ein Array aus bis zu 20 Strings ≤ 300 Zeichen", () => {
  const v = neu(); schreibeConfig(v);
  const stand = leseAutomatik(v).stand;

  const gueltig = ["20_firma/kunde-x", "40_persoenlich"];
  const erg = schreibeAutomatik(v, { ernteNichtIn: gueltig }, stand);
  assert.equal(erg.ok, true);
  assert.deepEqual(JSON.parse(readFileSync(configPfad(v), "utf8")).automatik.ernteNichtIn, gueltig);

  const stand2 = leseAutomatik(v).stand;
  assert.throws(() => schreibeAutomatik(v, { ernteNichtIn: "keine liste" }, stand2), (e) => e.code === 400);
  assert.throws(() => schreibeAutomatik(v, { ernteNichtIn: Array.from({ length: 21 }, (_, i) => `pfad${i}`) }, stand2), (e) => e.code === 400);
  assert.throws(() => schreibeAutomatik(v, { ernteNichtIn: ["x".repeat(301)] }, stand2), (e) => e.code === 400);
  assert.throws(() => schreibeAutomatik(v, { ernteNichtIn: [1, 2] }, stand2), (e) => e.code === 400);
  // Randfall: genau 20 Einträge, genau 300 Zeichen — noch gültig
  const grenzwertig = Array.from({ length: 20 }, (_, i) => "x".repeat(300));
  const erg2 = schreibeAutomatik(v, { ernteNichtIn: grenzwertig }, stand2);
  assert.equal(erg2.ok, true);
});

test("BOM (Review B #7): leseAutomatik toleriert ein UTF-8-BOM vor der Config, schreibeAutomatik liest/schreibt danach BOM-frei", () => {
  const v = neu();
  writeFileSync(configPfad(v), "﻿" + JSON.stringify({ ...BEISPIEL, automatik: { luecken: true } }, null, 2) + "\n");
  const { werte, fehler, stand } = leseAutomatik(v);
  assert.equal(fehler, null, "BOM darf nicht als kaputtes JSON gelten");
  assert.equal(werte.luecken, true);
  assert.notEqual(stand, "0");

  const erg = schreibeAutomatik(v, { staendeIntervallStunden: 2 }, stand);
  assert.equal(erg.ok, true);
  const rohNachher = readFileSync(configPfad(v), "utf8");
  assert.equal(rohNachher.startsWith("﻿"), false, "neu geschriebene Config trägt kein BOM mehr");
  const cfg = JSON.parse(rohNachher);
  assert.equal(cfg.automatik.luecken, true); // zusammengeführt, nicht verloren
  assert.equal(cfg.automatik.staendeIntervallStunden, 2);

  const kopie = readFileSync(join(v, ".logs", "config-vorher.json"), "utf8");
  assert.equal(kopie.startsWith("﻿"), false, "die Vorher-Kopie ist ebenfalls BOM-frei (liesConfigRoh)");
});

test("Nit 14: SCHEMA-Lookup nicht über die Prototypkette — constructor/toString gelten als unbekannter Schlüssel", () => {
  const v = neu(); schreibeConfig(v);
  const stand = leseAutomatik(v).stand;
  for (const schluessel of ["constructor", "toString", "hasOwnProperty"]) {
    assert.throws(() => schreibeAutomatik(v, { [schluessel]: true }, stand), (e) => {
      assert.equal(e.code, 400);
      assert.match(e.message, /Unbekannter Einstellungs-Schlüssel/);
      return true;
    });
  }
});

test("Review-Fund 1 (dreifaches Lesen): schreibeAutomatik liest die Config nur einmal — stand aus liesConfigRoh, nicht aus einer erneuten Datei-Prüfung", () => {
  const v = neu(); schreibeConfig(v);
  const stand = leseAutomatik(v).stand;
  // stand ist ein SHA-256-Hex (64 Zeichen), nicht mehr eine mtime-Zahl — robust gegen 1-2-s-mtime-Auflösung.
  assert.match(stand, /^[0-9a-f]{64}$/);
  const erg = schreibeAutomatik(v, { luecken: true }, stand);
  assert.match(erg.stand, /^[0-9a-f]{64}$/);
  assert.notEqual(erg.stand, stand); // Inhalt hat sich geändert → neuer Hash
});
