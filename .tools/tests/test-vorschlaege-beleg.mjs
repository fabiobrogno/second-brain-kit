// .tools/tests/test-vorschlaege-beleg.mjs — Beleg-Felder (zitat, herkunft, fundstelle, quelleUrl) im Vorschlag:
// Round-Trip mit und ohne Beleg, Altbestand unverändert, ungültige Belege abgelehnt. Nur mkdtemp-Ordner.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { schreibeVorschlag, listeVorschlaege, vorschlagOrdner } from "../vorschlaege.mjs";

const neuerVault = () => mkdtempSync(join(tmpdir(), "brain beleg "));
const code = (fn) => { try { fn(); } catch (e) { return e.code; } return "kein Fehler"; };
const basis = (o = {}) => ({ art: "fakt", titel: "Testbrett nutzt Port 4711", text: "Das Testbrett hört auf Port 4711.", ordner: "/heim/jo/projekt", sitzung: "sid-1", ...o });
const beleg = (o = {}) => ({ zitat: "Port ist 4711", herkunft: "du", fundstelle: "sid-1#u1 2026-10-02T08:09:10Z", quelleUrl: "https://example.com/doku", ...o });

test("Round-Trip mit Beleg: Felder landen in der Datei und in der Liste", () => {
  const v = neuerVault();
  const id = schreibeVorschlag(v, basis(beleg()));
  const datei = readFileSync(join(vorschlagOrdner(v), `${id}.md`), "utf8");
  assert.match(datei, /zitat: "Port ist 4711"/);
  assert.match(datei, /herkunft: du/);
  assert.match(datei, /fundstelle: "sid-1#u1 2026-10-02T08:09:10Z"/);
  assert.match(datei, /quelle_url: "https:\/\/example\.com\/doku"/);
  const [e] = listeVorschlaege(v);
  assert.equal(e.zitat, "Port ist 4711");
  assert.equal(e.herkunft, "du");
  assert.equal(e.fundstelle, "sid-1#u1 2026-10-02T08:09:10Z");
  assert.equal(e.quelleUrl, "https://example.com/doku");
});

test("ohne quelleUrl: kein quelle_url, Feld fehlt in der Liste", () => {
  const v = neuerVault();
  const id = schreibeVorschlag(v, basis(beleg({ quelleUrl: "" })));
  assert.doesNotMatch(readFileSync(join(vorschlagOrdner(v), `${id}.md`), "utf8"), /quelle_url/);
  const [e] = listeVorschlaege(v);
  assert.equal(e.zitat, "Port ist 4711");
  assert.ok(!("quelleUrl" in e));
});

test("Altbestand: ohne Beleg keine Belegfelder, Form wie bisher", () => {
  const v = neuerVault();
  const id = schreibeVorschlag(v, basis());
  assert.doesNotMatch(readFileSync(join(vorschlagOrdner(v), `${id}.md`), "utf8"), /zitat|herkunft|fundstelle/);
  const [e] = listeVorschlaege(v);
  assert.deepEqual(Object.keys(e).sort(), ["art", "erstellt", "id", "quelleOrdner", "text", "titel"]);
});

test("ungültiger Beleg wird abgelehnt (halb, falsche Art, Herkunft, Fundstelle, Zitat, Adresse)", () => {
  const v = neuerVault();
  assert.equal(code(() => schreibeVorschlag(v, basis({ zitat: "nur Zitat" }))), 400);
  assert.equal(code(() => schreibeVorschlag(v, basis(beleg({ art: "lektion" })))), 400);
  assert.equal(code(() => schreibeVorschlag(v, basis(beleg({ herkunft: "erfunden" })))), 400);
  assert.equal(code(() => schreibeVorschlag(v, basis(beleg({ fundstelle: "irgendwo" })))), 400);
  assert.equal(code(() => schreibeVorschlag(v, basis(beleg({ zitat: "a\nb" })))), 400);
  assert.equal(code(() => schreibeVorschlag(v, basis(beleg({ zitat: "x".repeat(301) })))), 400);
  assert.equal(code(() => schreibeVorschlag(v, basis(beleg({ quelleUrl: "javascript:alert(1)" })))), 400);
  assert.equal(listeVorschlaege(v).length, 0);
});

test("Befunde aus dem Review: Query/Fragment, Secrets, Stand, Anführungszeichen, nur quelleUrl", () => {
  const v = neuerVault();
  assert.equal(code(() => schreibeVorschlag(v, basis(beleg({ quelleUrl: "https://example.com/doku?x=1" })))), 400);
  assert.equal(code(() => schreibeVorschlag(v, basis(beleg({ quelleUrl: "https://example.com/doku#teil" })))), 400);
  assert.equal(code(() => schreibeVorschlag(v, basis(beleg({ zitat: "api" + "_key = " + "sk-" + "abcdef0123456789abcdef0123456789" })))), 400);
  assert.equal(code(() => schreibeVorschlag(v, { ...basis(beleg()), quelleUrl: "", zitat: "", herkunft: "", fundstelle: "", ...{ quelleUrl: "https://example.com/doku" } })), 400);
  schreibeVorschlag(v, basis(beleg({ art: "stand", zitat: 'Er sagte "4711" und "4712"' })));
  const [e] = listeVorschlaege(v);
  assert.equal(e.zitat, 'Er sagte "4711" und "4712"');
});

test("Lesen: unbekannte Herkunft aus handgeänderter Datei wird nicht übernommen", () => {
  const v = neuerVault();
  const id = schreibeVorschlag(v, basis(beleg()));
  const f = join(vorschlagOrdner(v), `${id}.md`);
  writeFileSync(f, readFileSync(f, "utf8").replace("herkunft: du", "herkunft: böse"));
  assert.ok(!("herkunft" in listeVorschlaege(v)[0]));
});
