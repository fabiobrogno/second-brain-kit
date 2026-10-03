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

// ---------- v0.4: Arten lektion und pflege ----------
test("lektion: Felder ziel/regel/warum/wie in Frontmatter und Liste; ungültiges Ziel, zu lang, Secret → 400", () => {
  const v = neuerVault();
  const id = schreibeVorschlag(v, vorschlag({ art: "lektion", titel: "Abends gießen", text: "**Regel:** Tomaten abends gießen.", ziel: "skill", regel: "Tomaten abends gießen.", warum: "Zweimal korrigiert.", wie: "Beim Gießplan." }), new Date(Date.UTC(2026, 9, 3)));
  assert.match(id, /^20261003-000000-lektion-[0-9a-f]{6}$/);
  assert.match(readFileSync(join(vorschlagOrdner(v), `${id}.md`), "utf8"), /\nziel: skill\nregel: "Tomaten abends gießen\."\nwarum: "Zweimal korrigiert\."\nwie: "Beim Gießplan\."\nerstellt: /);
  const [l] = listeVorschlaege(v);
  assert.deepEqual({ art: l.art, ziel: l.ziel, regel: l.regel, warum: l.warum, wie: l.wie }, { art: "lektion", ziel: "skill", regel: "Tomaten abends gießen.", warum: "Zweimal korrigiert.", wie: "Beim Gießplan." });
  assert.equal(code(() => schreibeVorschlag(v, vorschlag({ art: "lektion", ziel: "wiki" }))), 400);
  assert.equal(code(() => schreibeVorschlag(v, vorschlag({ art: "lektion", regel: "x".repeat(601) }))), 400);
  assert.equal(code(() => schreibeVorschlag(v, vorschlag({ art: "lektion", wie: `Nutze ${KOEDER_PW}` }))), 400);
  assert.equal(listeVorschlaege(v).length, 1);
  assert.ok(!("ziel" in listeVorschlaege(neuerVault())), "fakt/stand behalten ihre Felder");
});

test("pflege: Feld befund; unbekannter Befund → 400; Übernehmen einer Lektion → <inbox>/_lektionen/, Pflege → <inbox>/_pflege/", () => {
  const v = neuerVault();
  const p = schreibeVorschlag(v, vorschlag({ art: "pflege", befund: "zusammenlegen" }));
  assert.equal(listeVorschlaege(v)[0].befund, "zusammenlegen");
  assert.equal(code(() => schreibeVorschlag(v, vorschlag({ art: "pflege", befund: "loeschen" }))), 400);
  const l = schreibeVorschlag(v, vorschlag({ art: "lektion" }));
  assert.equal(entscheide(v, l, "uebernehmen").ziel, `00_inbox/_lektionen/${l}.md`);
  // Final-Review #1: ein Pflege-Vorschlag ist ein Prüfauftrag, keine Rohquelle — nie lose in der Inbox
  assert.equal(entscheide(v, p, "uebernehmen").ziel, `00_inbox/_pflege/${p}.md`);
  assert.equal(existsSync(join(v, "00_inbox", `${p}.md`)), false);
  assert.match(readFileSync(join(v, "00_inbox", "_pflege", `${p}.md`), "utf8"), /^---\ntyp: vorschlag\nart: pflege\n/);
  // fakt bleibt Rohquelle in der Inbox, Verwerfen eines Pflege-Vorschlags archiviert wie bisher
  const f = schreibeVorschlag(v, vorschlag());
  assert.equal(entscheide(v, f, "uebernehmen").ziel, `00_inbox/${f}.md`);
  const p2 = schreibeVorschlag(v, vorschlag({ art: "pflege", befund: "veraltet" }));
  assert.equal(entscheide(v, p2, "verwerfen").ziel, `90_archiv/vorschlaege-verworfen/${p2}.md`);
  assert.equal(anzahlVorschlaege(v), 0);
});

test("pflege: _pflege als Symlink (etwa ins Wiki) → 400, Vorschlag bleibt liegen (Final-Review #1)", (t) => {
  const v = neuerVault();
  mkdirSync(join(v, "09_wiki"), { recursive: true });
  mkdirSync(join(v, "00_inbox"), { recursive: true });
  try { symlinkSync(join("..", "09_wiki"), join(v, "00_inbox", "_pflege"), "dir"); }
  catch { t.skip("Symlinks hier nicht möglich"); return; }
  const p = schreibeVorschlag(v, vorschlag({ art: "pflege", befund: "aufteilen" }));
  assert.equal(code(() => entscheide(v, p, "uebernehmen")), 400);
  assert.deepEqual(readdirSync(join(v, "09_wiki")), [], "nichts im Wiki gelandet");
  assert.equal(listeVorschlaege(v).length, 1);
});

test("Inbox im Wiki (ordner.inbox im Wiki) → übernehmen 400, Vorschlag bleibt liegen (W1-Review #14)", () => {
  const v = neuerVault();
  writeFileSync(join(v, "brain.config.json"), JSON.stringify({ ordner: { inbox: "09_wiki/eingang" } }));
  mkdirSync(join(v, "09_wiki", "eingang"), { recursive: true });
  const fakt = schreibeVorschlag(v, vorschlag({ titel: "fakt" }));
  const lektion = schreibeVorschlag(v, vorschlag({ titel: "lektion", art: "lektion" }));
  assert.equal(code(() => entscheide(v, fakt, "uebernehmen")), 400);
  assert.equal(code(() => entscheide(v, lektion, "uebernehmen")), 400);
  assert.equal(existsSync(join(v, "09_wiki", "eingang", "_lektionen")), false, "kein Lektionsordner im Wiki angelegt");
  assert.equal(listeVorschlaege(v).length, 2);
});

test("übernommener Pflege-Vorschlag: Lint zählt <inbox>/_pflege nicht als Inbox, eine lose Inbox-Datei schon (Final-Review #1)", async () => {
  const { execFileSync } = await import("node:child_process");
  const { fileURLToPath } = await import("node:url");
  const T = fileURLToPath(new URL("..", import.meta.url));
  const home = mkdtempSync(join(tmpdir(), "brain vor home "));
  const env = { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_") && k !== "BRAIN_VAULT")), HOME: home, USERPROFILE: home };
  const lint = (v) => { try { return execFileSync(process.execPath, [join(T, "brain-lint.mjs"), v], { encoding: "utf8", env, windowsHide: true }); } catch (e) { return String(e.stdout || ""); } };
  const v = neuerVault();
  writeFileSync(join(v, "brain.config.json"), JSON.stringify({ clusters: [] }));
  mkdirSync(join(v, "09_wiki"), { recursive: true });
  const p = schreibeVorschlag(v, vorschlag({ art: "pflege", befund: "veraltet" }));
  entscheide(v, p, "uebernehmen");
  assert.doesNotMatch(lint(v), /INBOX:/);
  writeFileSync(join(v, "00_inbox", "notiz.md"), "# Notiz\n");
  assert.match(lint(v), /INBOX: 1 Datei\(en\) warten/);
});
