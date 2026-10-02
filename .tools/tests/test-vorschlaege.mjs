// .tools/tests/test-vorschlaege.mjs — schreiben/listen/übernehmen/verwerfen, IDs, Symlink-Ausbruch, Kollision,
// Vault-Pfade mit Leerzeichen, Komma, Apostroph, Umlaut. Nur mkdtemp-Ordner.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { schreibeVorschlag, listeVorschlaege, entscheide, vorschlagOrdner, anzahlVorschlaege } from "../vorschlaege.mjs";

const neuerVault = () => mkdtempSync(join(tmpdir(), "brain vor, schläge 'x' "));
const code = (fn) => { try { fn(); } catch (e) { return e.code; } return "kein Fehler"; };
// Köder-Zugangsdaten zusammengesetzt, damit die Quelldatei selbst kein Credential-Muster trägt (publish-check).
const KOEDER_PW = ["pass", "word"].join("") + "=Koeder123";
const KOEDER_SCHLUESSEL = ["to", "ken"].join("") + "=abc";
const vorschlag = (o = {}) => ({ art: "fakt", titel: "Testbrett nutzt Port 4711", text: "Das Testbrett hört auf Port 4711.", ordner: "/projekte/beispiel", sitzung: "sid-1", ...o });

test("schreiben: id-Format, Datei mit Frontmatter, Liste liefert die Felder", () => {
  const v = neuerVault();
  const id = schreibeVorschlag(v, vorschlag(), new Date(Date.UTC(2026, 9, 2, 8, 9, 10)));
  assert.match(id, /^20261002-080910-fakt-[0-9a-f]{6}$/);
  const inhalt = readFileSync(join(v, "00_inbox", "_vorschlaege", `${id}.md`), "utf8");
  assert.match(inhalt, /^---\ntyp: vorschlag\nart: fakt\n/);
  assert.match(inhalt, /quelle_ordner: "\/projekte\/beispiel"/);
  assert.match(inhalt, /quelle_sitzung: "sid-1"/);
  assert.match(inhalt, /erstellt: 2026-10-02T08:09:10Z/);
  const liste = listeVorschlaege(v);
  assert.deepEqual(liste, [{ id, art: "fakt", titel: "Testbrett nutzt Port 4711", text: "Das Testbrett hört auf Port 4711.", quelleOrdner: "/projekte/beispiel", erstellt: "2026-10-02T08:09:10Z" }]);
  assert.equal(anzahlVorschlaege(v), 1);
});

test("schreiben: Secret in Text/Titel → 400, nichts geschrieben", () => {
  const v = neuerVault();
  assert.equal(code(() => schreibeVorschlag(v, vorschlag({ text: `Zugang: ${KOEDER_PW}` }))), 400);
  assert.equal(code(() => schreibeVorschlag(v, vorschlag({ titel: KOEDER_SCHLUESSEL }))), 400);
  assert.equal(code(() => schreibeVorschlag(v, vorschlag({ art: "quatsch" }))), 400);
  assert.equal(code(() => schreibeVorschlag(v, vorschlag({ text: "  " }))), 400);
  assert.equal(listeVorschlaege(v).length, 0);
  const dir = vorschlagOrdner(v);
  assert.ok(!existsSync(dir) || readdirSync(dir).length === 0);
});

test("liste: neueste zuerst; kaputte Dateien, fremde Namen und Symlinks werden übersprungen", () => {
  const v = neuerVault();
  const alt = schreibeVorschlag(v, vorschlag({ titel: "alt" }), new Date(Date.UTC(2026, 0, 1)));
  const neu = schreibeVorschlag(v, vorschlag({ titel: "neu", art: "stand" }), new Date(Date.UTC(2026, 5, 1)));
  const dir = vorschlagOrdner(v);
  writeFileSync(join(dir, "kaputt.md"), "---\ntyp: vorschlag\nart: fakt\ntitel: \"offen\n");
  writeFileSync(join(dir, "ohne-fm.md"), "nur text\n");
  writeFileSync(join(dir, "Gross.md"), "---\ntyp: vorschlag\nart: fakt\n---\n# x\n\ny\n");
  const draussen = join(mkdtempSync(join(tmpdir(), "draussen-")), "geheim.md");
  writeFileSync(draussen, "---\ntyp: vorschlag\nart: fakt\n---\n# Fremd\n\nfremder Inhalt\n");
  try { symlinkSync(draussen, join(dir, "link.md")); } catch {}
  const liste = listeVorschlaege(v);
  assert.deepEqual(liste.map(x => x.id), [neu, alt]);
  assert.equal(liste[0].art, "stand");
});

test("übernehmen → <inbox>/<id>.md, verwerfen → <archiv>/vorschlaege-verworfen/<id>.md; nie gelöscht", () => {
  const v = neuerVault();
  const a = schreibeVorschlag(v, vorschlag({ titel: "a" }));
  const b = schreibeVorschlag(v, vorschlag({ titel: "b" }));
  const ra = entscheide(v, a, "uebernehmen");
  assert.deepEqual(ra, { ok: true, ziel: `00_inbox/${a}.md` });
  assert.ok(existsSync(join(v, "00_inbox", `${a}.md`)));
  const rb = entscheide(v, b, "verwerfen");
  assert.deepEqual(rb, { ok: true, ziel: `90_archiv/vorschlaege-verworfen/${b}.md` });
  assert.match(readFileSync(join(v, "90_archiv", "vorschlaege-verworfen", `${b}.md`), "utf8"), /# b/);
  assert.equal(listeVorschlaege(v).length, 0);
  assert.equal(code(() => entscheide(v, a, "uebernehmen")), 404);
});

test("eigene Ordnernamen aus brain.config.json werden beachtet", () => {
  const v = neuerVault();
  writeFileSync(join(v, "brain.config.json"), JSON.stringify({ ordner: { inbox: "eingang", archiv: "ablage" } }));
  const id = schreibeVorschlag(v, vorschlag());
  assert.ok(existsSync(join(v, "eingang", "_vorschlaege", `${id}.md`)));
  assert.equal(entscheide(v, id, "verwerfen").ziel, `ablage/vorschlaege-verworfen/${id}.md`);
});

test("ungültige ids und Aktionen → 400; unbekannte id → 404", () => {
  const v = neuerVault();
  const id = schreibeVorschlag(v, vorschlag());
  for (const boese of ["../x", "a/b", "A", "a".repeat(81), "", "a\\b", "x.md", "..", null, 5]) {
    assert.equal(code(() => entscheide(v, boese, "uebernehmen")), 400, `id ${String(boese)}`);
  }
  assert.equal(code(() => entscheide(v, id, "loeschen")), 400);
  assert.equal(code(() => entscheide(v, "gibt-es-nicht", "verwerfen")), 404);
  assert.equal(code(() => entscheide(v, "a".repeat(80), "verwerfen")), 404);
  assert.ok(existsSync(join(vorschlagOrdner(v), `${id}.md`)));
});

test("Symlink in _vorschlaege auf Datei außerhalb → 400, Ziel und Quelle unverändert", (t) => {
  const v = neuerVault();
  const dir = vorschlagOrdner(v);
  mkdirSync(dir, { recursive: true });
  const draussen = join(mkdtempSync(join(tmpdir(), "draussen-")), "fremd.md");
  writeFileSync(draussen, "fremd\n");
  try { symlinkSync(draussen, join(dir, "boese-link.md")); }
  catch { t.skip("Symlinks hier nicht erlaubt"); return; }
  assert.equal(code(() => entscheide(v, "boese-link", "uebernehmen")), 400);
  assert.equal(readFileSync(draussen, "utf8"), "fremd\n");
  assert.ok(!existsSync(join(v, "00_inbox", "boese-link.md")));
});

test("_vorschlaege selbst als Symlink nach außerhalb → 400, nichts verschoben", (t) => {
  const v = neuerVault();
  const draussen = mkdtempSync(join(tmpdir(), "draussen-"));
  writeFileSync(join(draussen, "x-1.md"), "---\ntyp: vorschlag\nart: fakt\n---\n# x\n\ny\n");
  mkdirSync(join(v, "00_inbox"), { recursive: true });
  try { symlinkSync(draussen, join(v, "00_inbox", "_vorschlaege"), "dir"); }
  catch { t.skip("Symlinks hier nicht erlaubt"); return; }
  assert.equal(code(() => entscheide(v, "x-1", "uebernehmen")), 400);
  assert.ok(existsSync(join(draussen, "x-1.md")));
});

test("Kollision im Ziel → Suffix -2, -3; vorhandene Datei bleibt unverändert", () => {
  const v = neuerVault();
  const id = schreibeVorschlag(v, vorschlag({ titel: "erster" }));
  mkdirSync(join(v, "00_inbox"), { recursive: true });
  writeFileSync(join(v, "00_inbox", `${id}.md`), "schon da\n");
  assert.equal(entscheide(v, id, "uebernehmen").ziel, `00_inbox/${id}-2.md`);
  assert.equal(readFileSync(join(v, "00_inbox", `${id}.md`), "utf8"), "schon da\n");
  // gleiche id nochmal (z. B. erneut abgelegt) → -3
  writeFileSync(join(vorschlagOrdner(v), `${id}.md`), readFileSync(join(v, "00_inbox", `${id}-2.md`)));
  assert.equal(entscheide(v, id, "uebernehmen").ziel, `00_inbox/${id}-3.md`);
});

test("Vault-Pfad mit Leerzeichen, Komma, Apostroph, Umlaut: alles bleibt im Vault", () => {
  const v = mkdtempSync(join(tmpdir(), "Mein Brain, Jo's Ü "));
  const id = schreibeVorschlag(v, vorschlag({ ordner: "C:\\Users\\Jo's Ordner, privat" }));
  const [x] = listeVorschlaege(v);
  assert.equal(x.quelleOrdner, "C:\\Users\\Jo's Ordner, privat");
  const r = entscheide(v, id, "uebernehmen");
  assert.equal(r.ziel, `00_inbox/${id}.md`);
  assert.ok(existsSync(join(v, "00_inbox", `${id}.md`)));
});

test("_vorschlaege als Symlink INNERHALB des Vaults (auf 09_wiki) → 400, Wiki-Seite bleibt liegen", (t) => {
  const v = neuerVault();
  mkdirSync(join(v, "09_wiki"), { recursive: true });
  mkdirSync(join(v, "00_inbox"), { recursive: true });
  writeFileSync(join(v, "09_wiki", "wichtige-seite.md"), "---\ntyp: thema\n---\n# Wichtig\n");
  try { symlinkSync(join("..", "09_wiki"), join(v, "00_inbox", "_vorschlaege"), "dir"); }
  catch { t.skip("Symlinks hier nicht erlaubt"); return; }
  assert.equal(code(() => entscheide(v, "wichtige-seite", "verwerfen")), 400);
  assert.ok(existsSync(join(v, "09_wiki", "wichtige-seite.md")));
  assert.ok(!existsSync(join(v, "90_archiv")));
});

test("Datei ohne typ: vorschlag in _vorschlaege → 400, bleibt liegen", () => {
  const v = neuerVault();
  const dir = vorschlagOrdner(v);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "fremd-1.md"), "# Keine Vorschlagsdatei\n");
  assert.equal(code(() => entscheide(v, "fremd-1", "uebernehmen")), 400);
  assert.ok(existsSync(join(dir, "fremd-1.md")));
});

test("Vorschlag mit BOM wird gelistet", () => {
  const v = neuerVault();
  const dir = vorschlagOrdner(v);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "bom-1.md"), "﻿---\ntyp: vorschlag\nart: fakt\ntitel: \"Mit BOM\"\nerstellt: 2026-10-02T09:00:00Z\n---\n\n# Mit BOM\n\nText\n");
  assert.deepEqual(listeVorschlaege(v).map(x => x.titel), ["Mit BOM"]);
  assert.equal(entscheide(v, "bom-1", "uebernehmen").ok, true);
});
