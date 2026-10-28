// .tools/tests/test-frische.mjs — neuere Fakten gewinnen, Widerspruch wird angezeigt (FBL-92).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { seiteLesen, frischePruefen, widerspruchZeilen, vaultLeser } from "../frische.mjs";
import { mitFrische, format } from "../hint-core.mjs";

const seite = (datumszeile, satz, titel = "Preise") => `---\ndescription: ${titel}\n${datumszeile}\n---\n# ${titel}\n${satz}\n`;
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

test("Ersatzdatum des Aufrufers zählt, wenn das Frontmatter keins hat", () => {
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
  const v = vault({ "brain.config.json": JSON.stringify({ suche: { profil: "minimal" } }), "wiki/tarif-alt.md": ALT, "wiki/tarif-neu.md": NEU });
  const r = spawnSync(process.execPath, [fileURLToPath(new URL("../brain.mjs", import.meta.url)), "search", "Tarif Basis kostet"], { env: { ...process.env, BRAIN_VAULT: v }, encoding: "utf8" });
  const pfade = r.stdout.trim().split("\n").map(z => z.split(",")[1]);
  assert.ok(pfade.indexOf("wiki/tarif-neu.md") >= 0 && pfade.indexOf("wiki/tarif-neu.md") < pfade.indexOf("wiki/tarif-alt.md"), r.stdout);
  assert.match(r.stderr, /Widerspruch.*tarif-neu\.md.*tarif-alt\.md/);
});

const lies = (m) => (p) => ({ text: m[p] });

test("Geschwister-Seiten sind kein Widerspruch: Tarif Basis vs. Premium, Lager Nord vs. Süd — nichts gemeldet, nichts umsortiert", () => {
  const faelle = [
    [seite("geprueft: 2026-03-01", "Der Tarif Basis kostet 49 € pro Monat.", "Tarif Basis"), seite("geprueft: 2026-09-15", "Der Tarif Premium kostet 99 € pro Monat.", "Tarif Premium")],
    [seite("geprueft: 2026-03-01", "Das Lager Nord hat 120 Stellplätze.", "Lager Nord"), seite("geprueft: 2026-09-15", "Das Lager Süd hat 80 Stellplätze.", "Lager Süd")],
    // identischer Satzrahmen, aber verschiedene Seiten: das Subjekt entscheidet
    [seite("geprueft: 2026-03-01", "Es gibt 120 Stellplätze.", "Lager Nord"), seite("geprueft: 2026-09-15", "Es gibt 80 Stellplätze.", "Lager Süd")],
  ];
  for (const [a, b] of faelle) {
    const r = frischePruefen([{ page: "a.md" }, { page: "b.md" }], lies({ "a.md": a, "b.md": b }));
    assert.deepEqual(r.treffer.map(h => h.page), ["a.md", "b.md"], a);
    assert.equal(r.widersprueche.length, 0, a);
    // auch umgekehrte Rangfolge (der „neuere“ Geschwister steht vorn): nichts verändert
    const u = frischePruefen([{ page: "b.md" }, { page: "a.md" }], lies({ "a.md": a, "b.md": b }));
    assert.deepEqual(u.treffer.map(h => h.page), ["b.md", "a.md"], a);
    assert.equal(u.widersprueche.length, 0, a);
  }
});

test("echter Widerspruch derselben Sache (gleicher Name, nur der Wert anders) wird weiter erkannt; Alias zählt als gleicher Name", () => {
  const alt = seite("geprueft: 2026-03-01", "Das Lager Nord hat 120 Stellplätze.", "Lager Nord");
  const neu = seite("geprueft: 2026-09-15", "Das Lager Nord hat 80 Stellplätze.", "Lager Nord");
  let r = frischePruefen([{ page: "alt.md" }, { page: "neu.md" }], lies({ "alt.md": alt, "neu.md": neu }));
  assert.deepEqual(r.treffer.map(h => h.page), ["neu.md", "alt.md"]);
  assert.equal(r.widersprueche.length, 1);
  // anderer Titel, aber Alias gleich
  const mitAlias = neu.replace("# Lager Nord", "# Standort Nord").replace("description:", "aliase: [\"Lager Nord\", Nordlager]\ndescription:");
  r = frischePruefen([{ page: "alt.md" }, { page: "neu.md" }], lies({ "alt.md": alt, "neu.md": mitAlias }));
  assert.equal(r.widersprueche.length, 1);
  // ohne gemeinsamen Namen: im Zweifel nichts
  r = frischePruefen([{ page: "alt.md" }, { page: "neu.md" }], lies({ "alt.md": alt, "neu.md": neu.replace("# Lager Nord", "# Standort Nord") }));
  assert.equal(r.widersprueche.length, 0);
  assert.deepEqual(r.treffer.map(h => h.page), ["alt.md", "neu.md"]);
});

test("gilt_seit zählt als Datum; eine Seite mit ersetzt_durch rückt nie als neuer vor", () => {
  assert.equal(seiteLesen("---\ngilt_seit: 2026-05-05\n---\nx").datum, "2026-05-05");
  assert.equal(seiteLesen("---\ngilt_seit: 2026-05-05\nstand: 2026-04-04\n---\nx").datum, "2026-04-04");
  const alt = seite("geprueft: 2026-03-01", "Der Tarif Basis kostet 49 € pro Monat.");
  const neuerAberErsetzt = seite("geprueft: 2026-09-15\nersetzt_durch: \"[[tarif_basis_2027]]\"", "Der Tarif Basis kostet 59 € pro Monat.");
  const r = frischePruefen([{ page: "alt.md" }, { page: "ersetzt.md" }], lies({ "alt.md": alt, "ersetzt.md": neuerAberErsetzt }));
  assert.deepEqual(r.treffer.map(h => h.page), ["alt.md", "ersetzt.md"]);
  assert.equal(r.widersprueche.length, 1);
  assert.equal(r.widersprueche[0].entschieden, false);
  // ohne ersetzt_durch dieselbe Konstellation: der neuere rückt vor
  const ohne = frischePruefen([{ page: "alt.md" }, { page: "x.md" }], lies({ "alt.md": alt, "x.md": neuerAberErsetzt.replace(/ersetzt_durch:.*\n/, "") }));
  assert.deepEqual(ohne.treffer.map(h => h.page), ["x.md", "alt.md"]);
});

test("Hinweis nennt höchstens 3 Widerspruchszeilen (die letzte fasst den Rest zusammen)", () => {
  const w = (i) => ({ neu: `n${i}.md`, alt: `a${i}.md`, neuDatum: "2026-09-01", altDatum: "2026-01-01", neuSatz: "x 2", altSatz: "x 1", art: "zahl", entschieden: true });
  assert.equal(widerspruchZeilen([w(1), w(2), w(3)]).length, 3);
  const z = widerspruchZeilen([1, 2, 3, 4, 5].map(w));
  assert.equal(z.length, 3);
  assert.match(z[2], /und 3 weitere/);
});

test("vaultLeser liest höchstens 4 KB; Fehler (Seite fehlt) wirft, mitFrische schreibt sie ins Log und lässt die Treffer unverändert", () => {
  const lang = "Der Tarif Basis kostet 49 € pro Monat.\n" + "füllzeile ohne belang\n".repeat(400);
  const v = vault({ "a.md": lang, "b.md": ALT });
  const t = vaultLeser(v)("a.md").text;
  assert.ok(t.length <= 4096 && t.endsWith("\n"));
  const hits = [{ page: "a.md", description: "" }, { page: "fehlt.md", description: "" }];
  assert.deepEqual(mitFrische(hits, v).hits.map(h => h.page), ["a.md", "fehlt.md"]);
  const log = join(v, ".logs", "hooks.log");
  assert.ok(existsSync(log));
  assert.match(readFileSync(log, "utf8"), /frische fehler ort=lesen:fehlt\.md grund=/);
});

// Profil leicht/voll: qmd liefert `qmd://brain/09-wiki/…` (slugifiziert). Fake-qmd als privates Programm unter
// $HOME/.brain-kit/bin/qmd (qmdBefehl startet es mit dem laufenden Node); unter Windows sucht qmdBefehl anders → dort nicht prüfbar.
test("brain search (Profil leicht, fake-qmd): qmd://-Pfade laufen über die Wiki-Karte, neuer Wert zuerst, nicht abbildbare Treffer bleiben stehen", { skip: process.platform === "win32" }, async () => {
  const { spawnSync } = await import("node:child_process");
  const { fileURLToPath } = await import("node:url");
  const v = vault({
    "brain.config.json": JSON.stringify({ suche: { profil: "leicht" } }),
    "09_wiki/tarif_alt.md": ALT, "09_wiki/tarif_neu.md": NEU,
    ".logs/wiki-map.json": JSON.stringify({ paths: { "09-wiki/tarif-alt.md": "09_wiki/tarif_alt.md", "09-wiki/tarif-neu.md": "09_wiki/tarif_neu.md" }, pages: {}, bySource: {} }),
  });
  const home = mkdtempSync(join(tmpdir(), "frische-home-"));
  mkdirSync(join(home, ".brain-kit", "bin"), { recursive: true });
  writeFileSync(join(home, ".brain-kit", "bin", "qmd"),
    `const a = process.argv.slice(2);\nif (a[0] === "--help") process.exit(0);\n`
    + `console.log('#a1,0.9,qmd://brain/09-wiki/tarif-alt.md,"x"');\nconsole.log('#b2,0.8,qmd://brain/unbekannt/roh.md,"x"');\nconsole.log('#c3,0.7,qmd://brain/09-wiki/tarif-neu.md,"x"');\n`);
  const r = spawnSync(process.execPath, [fileURLToPath(new URL("../brain.mjs", import.meta.url)), "search", "Tarif Basis kostet"],
    { env: { ...process.env, BRAIN_VAULT: v, HOME: home, USERPROFILE: home }, encoding: "utf8" });
  const pfade = r.stdout.trim().split("\n").map(z => z.split(",")[1]);
  assert.deepEqual(pfade, ["qmd://brain/09-wiki/tarif-neu.md", "qmd://brain/unbekannt/roh.md", "qmd://brain/09-wiki/tarif-alt.md"], r.stdout + r.stderr);
  assert.match(r.stderr, /Widerspruch.*09_wiki\/tarif_neu\.md.*09_wiki\/tarif_alt\.md/);
});
