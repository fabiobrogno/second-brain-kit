// .tools/tests/test-bm25-karten.mjs — BM25-Adapter (FBL-91): Rangfolge, Pfadform wie QMD, Score 0..1, leere Eingaben.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sucheKarten } from "../bm25-karten.mjs";
import { qmdToRel } from "../hint-core.mjs";

const v = join(mkdtempSync(join(tmpdir(), "bm25 karten ")), "Brain ü");
const dir = join(v, ".logs", "hint-karten");
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, "thema_reise.md"), "# Reise\n\nFähre nach Dagebüll, Abfahrt um neun Uhr.\n\nBegriffe: Fähre · Dagebüll\n");
writeFileSync(join(dir, "thema_steuer.md"), "# Steuer\n\nUmsatzsteuer Voranmeldung monatlich.\n\nBegriffe: Voranmeldung\n");
writeFileSync(join(dir, "notiz.txt"), "Fähre Fähre Fähre");

test("sucheKarten: bester Treffer zuerst, Pfad im QMD-Format, Score in (0,1)", async () => {
  const r = await sucheKarten("Wann fährt die Fähre nach Dagebüll", { collection: "brainkarten", limit: 5, vault: v });
  assert.equal(r.length, 1);
  assert.equal(r[0].file, "qmd://brainkarten/thema-reise.md");
  assert.ok(r[0].score > 0 && r[0].score < 1);
  const map = { paths: { "thema-reise.md": "09_wiki/thema_reise.md" } };
  assert.equal(qmdToRel(r[0].file, map), "09_wiki/thema_reise.md");
});

test("sucheKarten: kein Treffer, leere Frage, leerer Kartenordner → []", async () => {
  assert.deepEqual(await sucheKarten("Pizza Hawaii Rezept", { vault: v }), []);
  assert.deepEqual(await sucheKarten("   ", { vault: v }), []);
  const leer = join(mkdtempSync(join(tmpdir(), "bm25 leer ")), "x");
  mkdirSync(join(leer, ".logs", "hint-karten"), { recursive: true });
  assert.deepEqual(await sucheKarten("Fähre", { vault: leer }), []);
});

test("sucheKarten: limit begrenzt, seltenes Wort schlägt häufiges", async () => {
  writeFileSync(join(dir, "thema_zwei.md"), "# Zwei\n\nFähre Fähre Fähre Hafen.\n");
  const r = await sucheKarten("Fähre Dagebüll", { limit: 1, vault: v });
  assert.equal(r.length, 1);
  assert.equal(r[0].file, "qmd://brainkarten/thema-reise.md");
});

test("sucheKarten: fehlender Kartenordner (frischer Vault) → [] statt Fehler", async () => {
  const frisch = join(mkdtempSync(join(tmpdir(), "bm25 frisch ")), "x");
  assert.deepEqual(await sucheKarten("Fähre", { vault: frisch }), []);
});
