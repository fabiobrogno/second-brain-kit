// .tools/tests/test-fragen.mjs — Feld `fragen:` im Frontmatter: Prüfung (fragen.mjs), Suchkarte (brain-index.mjs),
// Lint-Befund FRAGEN (brain-lint.mjs, blockierend im --struktur-Modus). Temp-HOME und Temp-Vault.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { pruefeFragen, fragenRoh, fragenZeile, MAX_FRAGEN, MAX_FRAGE_LAENGE } from "../fragen.mjs";

const TOOLS = fileURLToPath(new URL("..", import.meta.url));
const HOME = mkdtempSync(join(tmpdir(), "brain fragen home "));
const umg = { PATH: process.env.PATH, HOME, USERPROFILE: HOME };

function vaultMit(seiten) {
  const v = join(mkdtempSync(join(tmpdir(), "brain fragen ")), "Mein Brain");
  mkdirSync(join(v, "09_wiki"), { recursive: true });
  writeFileSync(join(v, "brain.config.json"), "{}\n");
  for (const [name, inhalt] of Object.entries(seiten)) writeFileSync(join(v, "09_wiki", name), inhalt);
  return v;
}
const seite = (fmZusatz, text = "# Fähre\n\nDie **Fähre** fährt ab **Dagebüll**.\n") =>
  `---\nname: faehre\ndescription: Fährzeiten nach Föhr\ntyp: thema\n${fmZusatz}rev: 1\n---\n${text}`;

test("pruefeFragen: gültige Liste, Feld fehlt, Leerzeichen normalisiert, Doppelte fallen weg", () => {
  assert.deepEqual(pruefeFragen(null), { fragen: [], fehler: [] });
  assert.deepEqual(pruefeFragen('["Wann fährt die Fähre?", "Wo  ist\\tder Hafen?", "Wann fährt die Fähre?"]'),
    { fragen: ["Wann fährt die Fähre?", "Wo ist der Hafen?"], fehler: [] });
});

test("pruefeFragen: kein JSON, keine Liste, kein Text, leer, zu lang, zu viele → Befunde", () => {
  assert.match(pruefeFragen("Wann fährt die Fähre?").fehler[0], /kein gültiges JSON/);
  assert.match(pruefeFragen('"Wann?"').fehler[0], /keine Liste/);
  assert.match(pruefeFragen("").fehler[0], /leer/);
  assert.match(pruefeFragen('["a", 3]').fehler[0], /Eintrag 2 ist kein Text/);
  assert.match(pruefeFragen('["  "]').fehler[0], /Eintrag 1 ist leer/);
  const lang = "x".repeat(MAX_FRAGE_LAENGE + 1);
  const r = pruefeFragen(JSON.stringify(["ok?", lang]));
  assert.deepEqual(r.fragen, ["ok?"]);
  assert.match(r.fehler[0], new RegExp(`Eintrag 2 hat ${MAX_FRAGE_LAENGE + 1} Zeichen`));
  assert.equal(pruefeFragen(JSON.stringify(["x".repeat(MAX_FRAGE_LAENGE)])).fehler.length, 0, "genau 160 Zeichen sind erlaubt");
  const sieben = pruefeFragen(JSON.stringify(["1", "2", "3", "4", "5", "6", "7"]));
  assert.match(sieben.fehler[0], /7 Fragen — höchstens 6/);
  assert.equal(sieben.fragen.length, MAX_FRAGEN, "Karte nimmt trotzdem nur die ersten 6");
});

test("fragenRoh/fragenZeile: liest die Zeile aus dem Frontmatter, ohne Feld keine Zeile", () => {
  assert.equal(fragenRoh('name: x\nfragen: ["a?", "b?"]\nrev: 1'), '["a?", "b?"]');
  assert.equal(fragenRoh("name: x\r\nrev: 1"), null);
  assert.equal(fragenZeile('["a?", "b?"]'), "Fragen: a? · b?");
  assert.equal(fragenZeile(null), "");
  assert.equal(fragenZeile("kaputt"), "");
});

test("brain-index: Fragen landen in der Suchkarte, Seiten ohne Feld behalten ihre Karte unverändert", () => {
  const v = vaultMit({
    "thema_faehre.md": seite('fragen: ["Wann geht die erste Fähre nach Föhr?", "Von wo legt die Fähre ab?"]\n'),
    "thema_ohne.md": seite("", "# Ohne\n\nText mit **Begriff**.\n"),
  });
  const r = spawnSync(process.execPath, [join(TOOLS, "brain-index.mjs"), v], { encoding: "utf8", env: umg, windowsHide: true });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const karte = readFileSync(join(v, ".logs", "hint-karten", "thema_faehre.md"), "utf8");
  assert.match(karte, /\n\nFragen: Wann geht die erste Fähre nach Föhr\? · Von wo legt die Fähre ab\?\n\nAbschnitte:/);
  const ohne = readFileSync(join(v, ".logs", "hint-karten", "thema_ohne.md"), "utf8");
  assert.equal(ohne, "# Ohne\n\nFährzeiten nach Föhr\n\nAbschnitte: \n\nBegriffe: Begriff\n");
});

test("brain-lint: FRAGEN-Befund bei falschem Format, blockierend im Struktur-Modus; gültige Fragen sind still", () => {
  const v = vaultMit({
    "thema_faehre.md": seite('fragen: ["gut?"]\n'),
    "thema_kaputt.md": seite("fragen:\n  - Wann fährt die Fähre?\n", "# Kaputt\n\n[[thema_faehre]]\n"),
  });
  const lint = (...a) => spawnSync(process.execPath, [join(TOOLS, "brain-lint.mjs"), v, ...a], { encoding: "utf8", env: umg, windowsHide: true });
  const r = lint();
  assert.match(r.stdout, /- FRAGEN: thema_kaputt\.md — leer/);
  assert.ok(!/FRAGEN: thema_faehre/.test(r.stdout), r.stdout);
  const s = lint("--struktur");
  assert.equal(s.status, 2, s.stdout);
  assert.match(s.stdout, /FRAGEN: thema_kaputt\.md/);
});
