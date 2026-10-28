// .tools/tests/test-frische.mjs — neuere Fakten gewinnen, Widerspruch wird angezeigt (FBL-92).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { seiteLesen, frischePruefen, widerspruchZeilen } from "../frische.mjs";
import { mitFrische, format } from "../hint-core.mjs";

const seite = (datumszeile, satz) => `---\ndescription: Preise\n${datumszeile}\n---\n# Preise\n${satz}\n`;
const ALT = seite("geprueft: 2026-03-01", "Der Tarif Basis kostet 49 € pro Monat.");
const NEU = seite("geprueft: 2026-09-15", "Der Tarif Basis kostet 59 € pro Monat.");
function vault(dateien) {
  const v = mkdtempSync(join(tmpdir(), "frische-"));
  for (const [rel, text] of Object.entries(dateien)) { mkdirSync(dirname(join(v, rel)), { recursive: true }); writeFileSync(join(v, rel), text); }
  return v;
}

test("seiteLesen: geprueft vor aktualisiert vor stand, ungültig/fehlend → Ersatzdatum", () => {
  assert.equal(seiteLesen("---\nstand: 2026-01-01\naktualisiert: 2026-02-02\ngeprueft: 2026-03-03\n---\nx").datum, "2026-03-03");
  assert.equal(seiteLesen("---\nstand: 2026-01-01\naktualisiert: 2026-02-02\n---\nx").datum, "2026-02-02");
  assert.equal(seiteLesen("---\ngeprueft: bald\n---\nx", "2025-05-05").datum, "2025-05-05");
  assert.equal(seiteLesen("kein frontmatter").datum, null);
});

test("alt und neu zum selben Fakt: neuer Wert vorn, Widerspruch nennt beide Quellen", () => {
  const v = vault({ "wiki/preise-alt.md": ALT, "wiki/preise-neu.md": NEU });
  const r = mitFrische([{ page: "wiki/preise-alt.md", description: "Preise" }, { page: "wiki/preise-neu.md", description: "Preise" }], v);
  assert.deepEqual(r.hits.map(h => h.page), ["wiki/preise-neu.md", "wiki/preise-alt.md"]);
  assert.equal(r.widersprueche.length, 1);
  const text = format(r.hits, { vault: v, widersprueche: r.widersprueche });
  assert.match(text, /Widerspruch/);
  assert.match(text, /preise-neu\.md \(2026-09-15\) sagt „[^“]*59 €/);
  assert.match(text, /preise-alt\.md \(2026-03-01\) sagt „[^“]*49 €/);
});

test("schon richtig geordnet: Reihenfolge bleibt, Hinweis trotzdem da", () => {
  const v = vault({ "a.md": NEU, "b.md": ALT });
  const r = mitFrische([{ page: "a.md", description: "" }, { page: "b.md", description: "" }], v);
  assert.deepEqual(r.hits.map(h => h.page), ["a.md", "b.md"]);
  assert.equal(r.widersprueche.length, 1);
});

test("gleiches Datum: nichts wird entschieden, Reihenfolge bleibt, Hinweis sagt das", () => {
  const gleich = seite("geprueft: 2026-03-01", "Der Tarif Basis kostet 59 € pro Monat.");
  const r = frischePruefen([{ page: "a.md" }, { page: "b.md" }], (p) => ({ text: p === "a.md" ? ALT : gleich }));
  assert.deepEqual(r.treffer.map(h => h.page), ["a.md", "b.md"]);
  assert.equal(r.widersprueche[0].entschieden, false);
  assert.match(widerspruchZeilen(r.widersprueche)[0], /nicht entschieden/);
});

test("Ersatzdatum (git/mtime) zählt, wenn das Frontmatter keins hat", () => {
  const ohne = (satz) => `# Preise\n${satz}\n`;
  const r = frischePruefen([{ page: "a.md" }, { page: "b.md" }], (p) =>
    p === "a.md" ? { text: ohne("Der Tarif Basis kostet 49 € pro Monat."), datum: "2026-01-01" } : { text: ohne("Der Tarif Basis kostet 59 € pro Monat."), datum: "2026-06-01" });
  assert.deepEqual(r.treffer.map(h => h.page), ["b.md", "a.md"]);
});

test("kein Widerspruch (anderes Thema / gleicher Wert): unverändert, keine Zeile", () => {
  const andere = seite("geprueft: 2026-09-15", "Der Standort Hamburg hat 12 Plätze.");
  const gleich = seite("geprueft: 2026-09-15", "Der Tarif Basis kostet 49 € pro Monat.");
  for (const b of [andere, gleich]) {
    const r = frischePruefen([{ page: "a.md" }, { page: "b.md" }], (p) => ({ text: p === "a.md" ? ALT : b }));
    assert.deepEqual(r.treffer.map(h => h.page), ["a.md", "b.md"]);
    assert.equal(r.widersprueche.length, 0);
  }
});

test("Fehler (Seite nicht lesbar, ein Treffer, Import-Treffer): Treffer bleiben unverändert", () => {
  const v = vault({ "a.md": ALT });
  const hits = [{ page: "a.md" }, { page: "fehlt.md" }, { page: "imp.md", import: true }];
  assert.deepEqual(mitFrische(hits, v).hits.map(h => h.page), ["a.md", "fehlt.md", "imp.md"]);
  assert.deepEqual(mitFrische([hits[0]], v).hits, [hits[0]]);
});

test("brain search (Profil minimal): neuer Wert zuerst auf stdout, Widerspruch auf stderr", async () => {
  const { spawnSync } = await import("node:child_process");
  const { fileURLToPath } = await import("node:url");
  const v = vault({ "brain.config.json": JSON.stringify({ suche: { profil: "minimal" } }), "wiki/tarif-alt.md": ALT, "wiki/tarif-neu.md": NEU.replace("pro Monat", "pro Monat netto") });
  const r = spawnSync(process.execPath, [fileURLToPath(new URL("../brain.mjs", import.meta.url)), "search", "Tarif Basis kostet"], { env: { ...process.env, BRAIN_VAULT: v }, encoding: "utf8" });
  const pfade = r.stdout.trim().split("\n").map(z => z.split(",")[1]);
  assert.ok(pfade.indexOf("wiki/tarif-neu.md") >= 0 && pfade.indexOf("wiki/tarif-neu.md") < pfade.indexOf("wiki/tarif-alt.md"), r.stdout);
  assert.match(r.stderr, /Widerspruch.*tarif-neu\.md.*tarif-alt\.md/);
});
