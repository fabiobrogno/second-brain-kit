// .tools/tests/test-entscheidungen.mjs — Konflikt-Entscheidungen: Auftrag schreiben/listen, „später“ schreibt
// nichts, nie das Wiki; Seiten-/ID-Prüfung, Symlink-Ausbruch, Secret in der Notiz, Länge, Meinung ändern ersetzt.
// Vault-Pfade mit Leerzeichen, Komma, Apostroph, Umlaut. Nur mkdtemp-Ordner.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, symlinkSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { schreibeEntscheidung, listeEntscheidungen, entscheidungsOrdner, konflikteIn, ENTSCHEIDUNG_ID_MUSTER, offeneKonfliktSeiten, kanonischeSeite } from "../entscheidungen.mjs";
import { fingerabdruck } from "../konflikte.mjs";
import { markiereEntschieden, offeneKonflikte, pflegebericht } from "../pflege.mjs";

const KASTEN = (a, b) => `> [!KONFLIKT] offen — Du entscheidest\n> A: "${a}" — Quelle: [[quelle_a]]\n> B: "${b}" — Quelle: [[quelle_b]]\n`;
const SEITE = "---\nname: x\ndescription: x\n---\n# Testgerät\n\n" + KASTEN("Port 4711", "Port 4712") + "\nText\n\n" + KASTEN("rot", "blau");
// Köder-Zugangsdaten zusammengesetzt, damit die Quelldatei selbst kein Credential-Muster trägt (publish-check).
const KOEDER = ["pass", "word"].join("") + "=Koeder123";

function neuerVault() {
  const v = join(mkdtempSync(join(tmpdir(), "brain ent, schei 'd' ")), "Mein Brain ü");
  mkdirSync(join(v, "09_wiki", "geräte"), { recursive: true });
  mkdirSync(join(v, "00_inbox"), { recursive: true });
  writeFileSync(join(v, "09_wiki", "geräte", "thema_testgeraet.md"), SEITE);
  return v;
}
const code = (fn) => { try { fn(); } catch (e) { return e.code; } return "kein Fehler"; };
const wikiStand = (v) => {
  const out = {};
  const lauf = (d) => { for (const n of readdirSync(d, { withFileTypes: true })) { const p = join(d, n.name); if (n.isDirectory()) lauf(p); else out[p] = readFileSync(p, "utf8") + "|" + statSync(p).mtimeMs; } };
  lauf(join(v, "09_wiki"));
  return out;
};
const ID = "09_wiki/geräte/thema_testgeraet.md";

test("konflikteIn: zwei Kästen → Nummern 1 und 2; Kasten im Codeblock zählt nicht", () => {
  assert.deepEqual(konflikteIn(SEITE).map(k => k.nr), [1, 2]);
  assert.deepEqual(konflikteIn("```\n" + KASTEN("x", "y") + "```\n").length, 0);
  assert.deepEqual(konflikteIn("﻿" + KASTEN("x", "y").replace(/\n/g, "\r\n")).map(k => k.nr), [1]);
});

test("schreiben: Auftrag mit Frontmatter in <inbox>/_entscheidungen, Liste liefert die Felder, Wiki unverändert", () => {
  const v = neuerVault();
  const vorher = wikiStand(v);
  const { id } = schreibeEntscheidung(v, { seite: ID, nr: 2, wahl: "beide", notiz: "Rot innen, blau außen." }, new Date(Date.UTC(2026, 9, 3, 8, 9, 10)));
  assert.match(id, /^20261003-080910-k2-thema-testgeraet-[0-9a-f]{6}$/);
  assert.match(id, ENTSCHEIDUNG_ID_MUSTER);
  const inhalt = readFileSync(join(v, "00_inbox", "_entscheidungen", `${id}.md`), "utf8");
  const fp = fingerabdruck("rot", "blau");
  assert.match(inhalt, new RegExp(`^---\ntyp: entscheidung\nseite: "09_wiki/geräte/thema_testgeraet.md"\nkonflikt: 2\nwahl: beide\nfingerabdruck: ${fp}\nnotiz: "Rot innen, blau außen."\nerstellt: 2026-10-03T08:09:10Z\n---\n`));
  assert.deepEqual(listeEntscheidungen(v), [{ id, seite: ID, konflikt: 2, wahl: "beide", fingerabdruck: fp, notiz: "Rot innen, blau außen.", erstellt: "2026-10-03T08:09:10Z" }]);
  assert.deepEqual(wikiStand(v), vorher);
});

test("„später“ schreibt nichts; unbekannte Wahl/Nummer → 400; fehlender Konflikt/Seite → 404", () => {
  const v = neuerVault();
  assert.deepEqual(schreibeEntscheidung(v, { seite: ID, nr: 1, wahl: "spaeter" }), { id: null, spaeter: true });
  assert.equal(existsSync(entscheidungsOrdner(v)), false);
  assert.equal(code(() => schreibeEntscheidung(v, { seite: ID, nr: 1, wahl: "c" })), 400);
  for (const nr of [0, -1, 1.5, "x", 10000]) assert.equal(code(() => schreibeEntscheidung(v, { seite: ID, nr, wahl: "a" })), 400, String(nr));
  assert.equal(code(() => schreibeEntscheidung(v, { seite: ID, nr: 3, wahl: "a" })), 404);
  assert.equal(code(() => schreibeEntscheidung(v, { seite: "09_wiki/gibtsnicht.md", nr: 1, wahl: "a" })), 404);
  assert.equal(listeEntscheidungen(v).length, 0);
});

test("Seiten-ID: Ausbruch, Backslash, Punkt-Segmente, Nicht-Wiki, Steuerzeichen → 400", () => {
  const v = neuerVault();
  writeFileSync(join(v, "00_inbox", "notiz.md"), KASTEN("a", "b"));
  writeFileSync(join(v, "09_wiki", "_schema.md"), KASTEN("a", "b"));
  for (const seite of ["../x.md", "09_wiki/../00_inbox/notiz.md", "09_wiki\\geräte\\thema_testgeraet.md", "09_wiki/.versteckt.md",
    "00_inbox/notiz.md", "09_wiki/_schema.md", "/etc/passwd", "09_wiki//x.md", "09_wiki/x\u0000.md", "", 42, null, "09_wiki/" + "a".repeat(400) + ".md"]) {
    assert.equal(code(() => schreibeEntscheidung(v, { seite, nr: 1, wahl: "a" })), 400, String(seite));
  }
  assert.equal(listeEntscheidungen(v).length, 0);
});

test("Symlink: Seite zeigt nach außen → 400; Entscheidungsordner als Symlink ins Wiki → 400, nichts geschrieben", (t) => {
  const v = neuerVault();
  const draussen = join(mkdtempSync(join(tmpdir(), "draussen-")), "fremd.md");
  writeFileSync(draussen, KASTEN("a", "b"));
  try { symlinkSync(draussen, join(v, "09_wiki", "link.md")); } catch { t.skip("keine Symlinks erlaubt"); return; }
  assert.equal(code(() => schreibeEntscheidung(v, { seite: "09_wiki/link.md", nr: 1, wahl: "a" })), 400);
  symlinkSync(join(v, "09_wiki"), join(v, "00_inbox", "_entscheidungen"), "dir");
  const vorher = wikiStand(v);
  assert.equal(code(() => schreibeEntscheidung(v, { seite: ID, nr: 1, wahl: "a" })), 400);
  assert.deepEqual(wikiStand(v), vorher);
  assert.deepEqual(listeEntscheidungen(v), []);
});

test("Notiz: > 300 Zeichen → 400, Zugangsdaten → 400, kein Text → 400; nichts geschrieben", () => {
  const v = neuerVault();
  assert.equal(code(() => schreibeEntscheidung(v, { seite: ID, nr: 1, wahl: "a", notiz: "x".repeat(301) })), 400);
  assert.equal(code(() => schreibeEntscheidung(v, { seite: ID, nr: 1, wahl: "a", notiz: `geht mit ${KOEDER}` })), 400);
  assert.equal(code(() => schreibeEntscheidung(v, { seite: ID, nr: 1, wahl: "a", notiz: { x: 1 } })), 400);
  assert.equal(listeEntscheidungen(v).length, 0);
  assert.ok(!existsSync(entscheidungsOrdner(v)) || readdirSync(entscheidungsOrdner(v)).length === 0);
  const { id } = schreibeEntscheidung(v, { seite: ID, nr: 1, wahl: "a", notiz: "x".repeat(300) });
  assert.ok(id);
});

test("Meinung geändert: zweite Entscheidung zum selben Konflikt ersetzt die erste; anderer Konflikt bleibt", () => {
  const v = neuerVault();
  schreibeEntscheidung(v, { seite: ID, nr: 1, wahl: "a" });
  const r = schreibeEntscheidung(v, { seite: ID, nr: 1, wahl: "b" });
  assert.equal(r.ersetzt, 1);
  schreibeEntscheidung(v, { seite: ID, nr: 2, wahl: "b" });
  const liste = listeEntscheidungen(v);
  assert.equal(liste.length, 2);
  assert.equal(liste.find(e => e.konflikt === 1).wahl, "b");
});

test("liste: neueste zuerst; kaputte Dateien, fremde Namen, Symlinks übersprungen", () => {
  const v = neuerVault();
  const alt = schreibeEntscheidung(v, { seite: ID, nr: 1, wahl: "a" }, new Date(Date.UTC(2026, 0, 1))).id;
  const neu = schreibeEntscheidung(v, { seite: ID, nr: 2, wahl: "b" }, new Date(Date.UTC(2026, 5, 1))).id;
  const dir = entscheidungsOrdner(v);
  writeFileSync(join(dir, "kaputt.md"), "---\ntyp: entscheidung\nseite: \"offen\n");
  writeFileSync(join(dir, "anders.md"), "---\ntyp: vorschlag\nart: fakt\n---\n");
  writeFileSync(join(dir, "Gross.md"), "---\ntyp: entscheidung\nseite: \"x\"\nwahl: a\n---\n");
  const draussen = join(mkdtempSync(join(tmpdir(), "draussen-")), "x.md");
  writeFileSync(draussen, "---\ntyp: entscheidung\nseite: \"x\"\nwahl: a\n---\n");
  try { symlinkSync(draussen, join(dir, "link.md")); } catch {}
  assert.deepEqual(listeEntscheidungen(v).map(e => e.id), [neu, alt]);
  rmSync(dir, { recursive: true });
  assert.deepEqual(listeEntscheidungen(v), []);
});

// ---------- W1-Review #5, #11, #14, #16 und T6-Bedenken 4 ----------

test("Fingerabdruck: Kasten 1 entfällt → „rot/blau“ (jetzt nr 1) ist NICHT entschieden; Bericht zählt ihn offen", () => {
  const v = neuerVault();
  schreibeEntscheidung(v, { seite: ID, nr: 1, wahl: "a", notiz: "Port 4711 ist richtig." });
  // Kasten 1 (Port) wird von Hand entfernt — „rot/blau“ rutscht auf nr 1
  writeFileSync(join(v, "09_wiki", "geräte", "thema_testgeraet.md"), "---\nname: x\ndescription: x\n---\n# Testgerät\n\n" + KASTEN("rot", "blau"));
  const k = markiereEntschieden(v, offeneKonflikte(v));
  assert.equal(k.length, 1);
  assert.equal(k[0].nr, 1);
  assert.equal(k[0].entschieden, null, "die alte Wahl gehört zum Port-Kasten, nicht zu rot/blau");
  const b = pflegebericht(v);
  assert.equal(b.posten.find(p => p.schluessel === "konflikte").anzahl, 1);
  assert.equal(offeneKonfliktSeiten(v), 1);
});

test("Fingerabdruck beim Schreiben passt nicht zur nr → 409, nichts geschrieben; passend → ok; kaputt → 400", () => {
  const v = neuerVault();
  assert.equal(code(() => schreibeEntscheidung(v, { seite: ID, nr: 1, wahl: "a", fingerabdruck: fingerabdruck("rot", "blau") })), 409);
  assert.equal(listeEntscheidungen(v).length, 0);
  assert.equal(code(() => schreibeEntscheidung(v, { seite: ID, nr: 1, wahl: "a", fingerabdruck: "XYZ" })), 400);
  const r = schreibeEntscheidung(v, { seite: ID, nr: 2, wahl: "b", fingerabdruck: fingerabdruck("rot", "blau") });
  assert.ok(r.id);
});

test("markiereEntschieden liefert die gespeicherte Notiz mit (T6: „Ändern“ überschreibt sie nicht still)", () => {
  const v = neuerVault();
  schreibeEntscheidung(v, { seite: ID, nr: 2, wahl: "beide", notiz: "Rot innen, blau außen." });
  const k = markiereEntschieden(v, offeneKonflikte(v));
  assert.deepEqual(k.map(x => [x.nr, x.entschieden, x.notiz]), [[1, null, ""], [2, "beide", "Rot innen, blau außen."]]);
  // Ansichtsdaten ohne fp (ältere Daten) → fp wird aus a/b berechnet
  const ohneFp = markiereEntschieden(v, offeneKonflikte(v).map(({ fp, ...x }) => x));
  assert.equal(ohneFp[1].entschieden, "beide");
});

// Gleiche Seite = gleicher Seitenname nach NFC + Kleinschreibung — auf jedem System, auch wenn das Dateisystem
// Groß/klein bzw. NFC/NFD unterscheidet (Linux, NTFS): dort wird die Variante über den Namen aufgelöst.
test("Schreibvarianten der Seiten-ID (Groß/klein, NFD) → ein Auftrag je Kasten, alte Variante ersetzt", () => {
  const v = neuerVault();
  schreibeEntscheidung(v, { seite: ID, nr: 1, wahl: "b" });
  const nfd = ID.normalize("NFD");
  const gross = ID.replace("thema_testgeraet", "THEMA_TESTGERAET");
  const r1 = schreibeEntscheidung(v, { seite: nfd, nr: 1, wahl: "a" });
  assert.equal(r1.ersetzt, 1, "NFD-Variante ersetzt");
  const r2 = schreibeEntscheidung(v, { seite: gross, nr: 1, wahl: "beide" });
  assert.equal(r2.ersetzt, 1, "Groß-/Kleinvariante ersetzt");
  const r3 = schreibeEntscheidung(v, { seite: gross.normalize("NFD"), nr: 1, wahl: "a" });
  assert.equal(r3.ersetzt, 1, "Groß-/Kleinvariante in NFD ersetzt");
  const liste = listeEntscheidungen(v);
  assert.equal(liste.length, 1);
  assert.equal(liste[0].seite, ID.normalize("NFC"), "gespeichert in der Schreibweise auf der Platte (NFC)");
  assert.equal(kanonischeSeite(v, nfd), ID.normalize("NFC"));
  assert.equal(kanonischeSeite(v, gross), ID.normalize("NFC"));
});

test("Auftragsordner im Wiki (Inbox als Symlink ins Wiki oder ordner.inbox im Wiki) → 400, Wiki unverändert", (t) => {
  const v = neuerVault();
  writeFileSync(join(v, "brain.config.json"), JSON.stringify({ ordner: { inbox: "09_wiki/x" } }));
  mkdirSync(join(v, "09_wiki", "x"), { recursive: true });
  const vorher = wikiStand(v);
  assert.equal(code(() => schreibeEntscheidung(v, { seite: ID, nr: 1, wahl: "a" })), 400);
  assert.equal(existsSync(join(v, "09_wiki", "x", "_entscheidungen")), false, "kein Auftragsordner im Wiki");
  const v2 = neuerVault();
  rmSync(join(v2, "00_inbox"), { recursive: true });
  mkdirSync(join(v2, "09_wiki", "eingang"));
  try { symlinkSync(join(v2, "09_wiki", "eingang"), join(v2, "00_inbox"), "dir"); } catch { t.skip("keine Symlinks"); return; }
  assert.equal(code(() => schreibeEntscheidung(v2, { seite: ID, nr: 1, wahl: "a" })), 400);
  assert.equal(existsSync(join(v2, "09_wiki", "eingang", "_entscheidungen")), false, "nichts im Wiki angelegt");
  assert.deepEqual(wikiStand(v), vorher, "auch kein leerer Ordner im Wiki");
});

test("offeneKonfliktSeiten: entschiedene Kästen und Symlink-Seiten nach außen zählen nicht", (t) => {
  const v = neuerVault();
  assert.equal(offeneKonfliktSeiten(v), 1);
  schreibeEntscheidung(v, { seite: ID, nr: 1, wahl: "a" });
  assert.equal(offeneKonfliktSeiten(v), 1, "Kasten 2 noch offen");
  schreibeEntscheidung(v, { seite: ID, nr: 2, wahl: "b" });
  assert.equal(offeneKonfliktSeiten(v), 0, "beide entschieden");
  const draussen = mkdtempSync(join(tmpdir(), "draussen-"));
  writeFileSync(join(draussen, "fremd.md"), KASTEN("x", "y"));
  mkdirSync(join(draussen, "ordner"));
  writeFileSync(join(draussen, "ordner", "fremd2.md"), KASTEN("x", "y"));
  try {
    symlinkSync(join(draussen, "fremd.md"), join(v, "09_wiki", "link.md"));
    symlinkSync(join(draussen, "ordner"), join(v, "09_wiki", "linkdir"), "dir");
  } catch { t.skip("keine Symlinks"); return; }
  assert.equal(offeneKonfliktSeiten(v), 0);
  assert.equal(offeneKonflikte(v).length, 2, "nur die beiden echten Kästen");
  assert.equal(pflegebericht(v).posten.find(p => p.schluessel === "konflikte").anzahl, 0);
});
