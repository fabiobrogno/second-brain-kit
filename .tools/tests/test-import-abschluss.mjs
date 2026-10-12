// .tools/tests/test-import-abschluss.mjs — Import-Abschluss (Issue #6): Paket einarbeiten = Dateien in den Ziel-Cluster
// verschieben (Unterstruktur bleibt), Fortschritt im Bericht, analyse zählt nur offene Pakete, nach dem letzten Paket
// wandern Bericht und Metadaten ins Archiv. Nur Temp-Vaults.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, renameSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync, execFileSync } from "node:child_process";

const TEST_HOME = mkdtempSync(join(tmpdir(), "brain abschluss home "));
Object.assign(process.env, { HOME: TEST_HOME, USERPROFILE: TEST_HOME });
const { importiere } = await import("../import/import.mjs");
const { schliesseAb, offenePakete, AbschlussFehler } = await import("../import/abschluss.mjs");
const { analyse } = await import("../analyse.mjs");

const HIER = dirname(fileURLToPath(import.meta.url));
const SKRIPT = join(HIER, "..", "import", "abschluss.mjs");
const JETZT = new Date("2026-10-12T09:00:00");
const temp = (p) => mkdtempSync(join(tmpdir(), p));
const schreibe = (basis, rel, text) => { const p = join(basis, ...rel.split("/")); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, text); };

function vaultMitImport({ git = false } = {}) {
  const v = join(temp("brain abschluss "), "Mein Brain");
  mkdirSync(join(v, "09_wiki"), { recursive: true });
  mkdirSync(join(v, "00_inbox"), { recursive: true });
  writeFileSync(join(v, "brain.config.json"), JSON.stringify({ wiki: { ordner: "09_wiki" }, clusters: [{ id: "30_wissen", name: "Wissen" }, { id: "20_firma", name: "Firma" }] }) + "\n");
  const q = join(temp("brain abschluss quelle "), "Altes Brain");
  schreibe(q, "Alpha/eins.md", "# Eins\n\nDer Hund heißt Bello und wohnt im Garten.\n");
  schreibe(q, "Alpha/sub/zwei.md", "# Zwei\n\nDie Wartung der Heizung ist im Oktober fällig.\n");
  schreibe(q, "Beta/drei.md", "# Drei\n\nDer Router steht im Keller neben dem Schalter.\n");
  schreibe(q, "lose.md", "# Lose\n\nEine einzelne Notiz ganz ohne Ordner über Briefmarken.\n");
  const r = importiere(v, q, { jetzt: JETZT });
  if (git) {
    const g = (...a) => execFileSync("git", ["-C", v, "-c", "user.email=t@t", "-c", "user.name=t", ...a], { stdio: "ignore" });
    g("init", "-q"); g("add", "--", "."); g("commit", "-qm", "import");
  }
  return { v, name: r.name, basis: join(v, "00_inbox", "_import", r.name) };
}
const bericht = (basis) => JSON.parse(readFileSync(join(basis, "_bericht.json"), "utf8"));

test("Paket abschließen: Dateien mit Unterstruktur in den Ziel-Cluster, Fortschritt im Bericht", () => {
  const { v, name, basis } = vaultMitImport();
  const r = schliesseAb(v, name, { paket: "Alpha", ziel: "30_wissen", jetzt: JETZT });
  assert.equal(r.abgeschlossen, false);
  assert.deepEqual(r.verschoben.sort(), [`30_wissen/${name}/Alpha/eins.md`, `30_wissen/${name}/Alpha/sub/zwei.md`]);
  assert.ok(existsSync(join(v, "30_wissen", name, "Alpha", "sub", "zwei.md")));
  assert.ok(!existsSync(join(basis, "Alpha", "eins.md")));
  assert.ok(existsSync(join(basis, "Beta", "drei.md")), "andere Pakete bleiben liegen");
  const b = bericht(basis);
  assert.equal(b.eingearbeitet.Alpha.datum, "2026-10-12");
  assert.equal(b.eingearbeitet.Alpha.ziel, `30_wissen/${name}`);
  assert.equal(b.eingearbeitet.Beta, undefined);
  assert.deepEqual(offenePakete(b).map(p => p.name).sort(), ["(oberste Ebene)", "Beta"]);
});

test("analyse und pflege zählen nur nicht eingearbeitete Pakete; am Ende ist der Import weg", () => {
  const { v, name, basis } = vaultMitImport();
  assert.deepEqual(analyse(v, { jetzt: JETZT }).importe.map(i => [i.quelle, i.notizen]), [["Altes Brain", 4]]);
  schliesseAb(v, name, { paket: "Alpha", ziel: "30_wissen", jetzt: JETZT });
  assert.deepEqual(analyse(v, { jetzt: JETZT }).importe.map(i => [i.quelle, i.notizen]), [["Altes Brain", 2]]);
  schliesseAb(v, name, { paket: "Beta", ziel: "20_firma", jetzt: JETZT });
  schliesseAb(v, name, { paket: "(oberste Ebene)", ziel: "20_firma", jetzt: JETZT });
  assert.deepEqual(analyse(v, { jetzt: JETZT }).importe, []);
  assert.ok(!existsSync(basis), "Import-Ordner samt Bericht ist aus der Inbox verschwunden");
  assert.ok(existsSync(join(v, "20_firma", name, "lose.md")));
  const ar = join(v, "90_archiv", "import-berichte", name);
  assert.deepEqual(readdirSync(ar).sort(), ["_bericht.json", "_bericht.md", "_import.json"]);
  assert.equal(bericht(ar).eingearbeitet.Beta.ziel, `20_firma/${name}`);
});

test("letztes Paket meldet abgeschlossen; Reste (Dateien ohne Paket-Eintrag) wandern mit", () => {
  const { v, name, basis } = vaultMitImport();
  const begleit = JSON.parse(readFileSync(join(basis, "_import.json"), "utf8"));
  begleit.dateien.push({ rel: "Gamma/solo.pdf", sha: "x", titel: "solo", links: [], aliase: [] });
  schreibe(basis, "Gamma/solo.pdf", "%PDF-1.4\n%%EOF\n");
  writeFileSync(join(basis, "_import.json"), JSON.stringify(begleit));
  for (const p of ["Alpha", "Beta"]) schliesseAb(v, name, { paket: p, ziel: "30_wissen", jetzt: JETZT });
  const r = schliesseAb(v, name, { paket: "(oberste Ebene)", ziel: "30_wissen", jetzt: JETZT });
  assert.equal(r.abgeschlossen, true);
  assert.ok(existsSync(join(v, "30_wissen", name, "Gamma", "solo.pdf")), "Rest-Datei ohne Paket wandert beim Abschluss mit");
  assert.ok(!existsSync(basis));
});

test("--alle schließt alles auf einmal ab", () => {
  const { v, name, basis } = vaultMitImport();
  const r = schliesseAb(v, name, { alle: true, ziel: "30_wissen", jetzt: JETZT });
  assert.equal(r.abgeschlossen, true);
  assert.ok(existsSync(join(v, "30_wissen", name, "Beta", "drei.md")));
  assert.ok(!existsSync(basis));
});

test("zweiter Aufruf für dasselbe Paket ist harmlos (nichts mehr zu verschieben)", () => {
  const { v, name } = vaultMitImport();
  schliesseAb(v, name, { paket: "Alpha", ziel: "30_wissen", jetzt: JETZT });
  const r = schliesseAb(v, name, { paket: "Alpha", ziel: "30_wissen", jetzt: JETZT });
  assert.deepEqual(r.verschoben, []);
  assert.equal(r.abgeschlossen, false);
});

test("Fehler: unbekannter Cluster/Paket/Quelle, Namenskonflikt am Ziel — es wird nichts verschoben", () => {
  const { v, name, basis } = vaultMitImport();
  assert.throws(() => schliesseAb(v, name, { paket: "Alpha", ziel: "gibt-es-nicht", jetzt: JETZT }), AbschlussFehler);
  assert.throws(() => schliesseAb(v, name, { paket: "Alpha", ziel: "09_wiki", jetzt: JETZT }), AbschlussFehler);
  assert.throws(() => schliesseAb(v, name, { paket: "Nope", ziel: "30_wissen", jetzt: JETZT }), AbschlussFehler);
  assert.throws(() => schliesseAb(v, "../x", { paket: "Alpha", ziel: "30_wissen", jetzt: JETZT }), AbschlussFehler);
  assert.throws(() => schliesseAb(v, "nirgends", { paket: "Alpha", ziel: "30_wissen", jetzt: JETZT }), AbschlussFehler);
  assert.throws(() => schliesseAb(v, name, { jetzt: JETZT, ziel: "30_wissen" }), AbschlussFehler);
  schreibe(v, `30_wissen/${name}/Alpha/sub/zwei.md`, "belegt");
  assert.throws(() => schliesseAb(v, name, { paket: "Alpha", ziel: "30_wissen", jetzt: JETZT }), /schon vorhanden/);
  assert.ok(existsSync(join(basis, "Alpha", "eins.md")), "nichts halb verschoben");
  assert.equal(bericht(basis).eingearbeitet, undefined);
});

test("Altbericht ohne Fortschrittsfeld gilt als offen", () => {
  assert.deepEqual(offenePakete({ pakete: [{ name: "A", notizen: 2 }] }).map(p => p.name), ["A"]);
  assert.equal(offenePakete({ notizen: 12 }).length, 1, "ohne Paketliste: der ganze Import gilt als ein offenes Paket");
  assert.equal(offenePakete({ notizen: 12 })[0].notizen, 12);
});

test("im Git-Vault wird per git mv verschoben (Umbenennung gestagt)", () => {
  const { v, name } = vaultMitImport({ git: true });
  schliesseAb(v, name, { paket: "Alpha", ziel: "30_wissen", jetzt: JETZT });
  const st = execFileSync("git", ["-C", v, "status", "--porcelain"], { encoding: "utf8" });
  assert.match(st, new RegExp(`^R  00_inbox/_import/${name}/Alpha/eins\\.md -> 30_wissen/${name}/Alpha/eins\\.md$`, "m"));
});

test("CLI: brain import fertig-Aufruf über abschluss.mjs", () => {
  const { v, name, basis } = vaultMitImport();
  const r = spawnSync(process.execPath, [SKRIPT, v, name, "Alpha", "--ziel", "30_wissen"], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /Noch offen: \(oberste Ebene\), Beta/);
  assert.ok(existsSync(join(v, "30_wissen", name, "Alpha", "eins.md")));
  const k = spawnSync(process.execPath, [SKRIPT, v, name, "Beta"], { encoding: "utf8" });
  assert.equal(k.status, 1);
  assert.match(k.stdout, /--ziel/);
  assert.ok(existsSync(join(basis, "Beta", "drei.md")));
});

// --- Review-Befunde ---------------------------------------------------------------------------------
// Windows erlaubt „?“ in Ordnernamen gar nicht — dort kann dieser Fall nicht entstehen.
test("Paketname mit bereinigtem Pfad (Ordner „Was ist?“ → „Was ist_“) verschiebt die Dateien", { skip: process.platform === "win32" }, () => {
  const v = join(temp("brain abschluss "), "Mein Brain");
  mkdirSync(join(v, "09_wiki"), { recursive: true });
  writeFileSync(join(v, "brain.config.json"), JSON.stringify({ wiki: { ordner: "09_wiki" }, clusters: [{ id: "30_wissen", name: "Wissen" }] }) + "\n");
  const q = join(temp("brain abschluss quelle "), "Fragen");
  schreibe(q, "Was ist?/eins.md", "# Eins\n\nDie Frage nach dem Sinn der Dinge im Garten.\n");
  schreibe(q, "Andere/zwei.md", "# Zwei\n\nEin völlig anderer Text über Segelboote und Wind.\n");
  const r = importiere(v, q, { jetzt: JETZT });
  assert.ok(bericht(join(v, "00_inbox", "_import", r.name)).pakete.some(p => p.name === "Was ist?"));
  const a = schliesseAb(v, r.name, { paket: "Was ist?", ziel: "30_wissen", jetzt: JETZT });
  assert.deepEqual(a.verschoben, [`30_wissen/${r.name}/Was ist_/eins.md`]);
});

test("Einzelpaket ohne eine einzige Datei in den Metadaten: harter Abbruch, kein Vermerk", () => {
  const { v, name, basis } = vaultMitImport();
  const begleit = JSON.parse(readFileSync(join(basis, "_import.json"), "utf8"));
  begleit.dateien = begleit.dateien.filter(d => !d.rel.startsWith("Beta/"));
  writeFileSync(join(basis, "_import.json"), JSON.stringify(begleit));
  assert.throws(() => schliesseAb(v, name, { paket: "Beta", ziel: "30_wissen", jetzt: JETZT }), /keine Dateien/);
  assert.equal(bericht(basis).eingearbeitet, undefined);
});

test("zuStagen nennt immer den Ziel-Ordner", () => {
  const { v, name } = vaultMitImport();
  const r = schliesseAb(v, name, { paket: "Alpha", ziel: "30_wissen", jetzt: JETZT });
  assert.ok(r.zuStagen.includes(`30_wissen/${name}`));
});

test("schon eingearbeitetes Paket: Vermerk bleibt unverändert, Meldung nennt das Datum", () => {
  const { v, name, basis } = vaultMitImport();
  schliesseAb(v, name, { paket: "Alpha", ziel: "30_wissen", jetzt: JETZT });
  const r = schliesseAb(v, name, { paket: "Alpha", ziel: "30_wissen", jetzt: new Date("2026-11-01T09:00:00") });
  assert.equal(r.schon, "2026-10-12");
  assert.deepEqual(bericht(basis).eingearbeitet.Alpha, { datum: "2026-10-12", ziel: `30_wissen/${name}`, dateien: 2 });
});

test("Abschluss nach Abbruch beim Verschieben der Metadaten: Rest wird nachgeholt", () => {
  const { v, name, basis } = vaultMitImport();
  schliesseAb(v, name, { paket: "Alpha", ziel: "30_wissen", jetzt: JETZT });
  schliesseAb(v, name, { paket: "Beta", ziel: "30_wissen", jetzt: JETZT });
  // Zustand nach einem Abbruch: zwei Metadateien schon im Archiv, _bericht.json (zuletzt) noch in der Inbox
  const ar = join(v, "90_archiv", "import-berichte", name);
  mkdirSync(ar, { recursive: true });
  const b = bericht(basis); b.eingearbeitet["(oberste Ebene)"] = { datum: "2026-10-12", ziel: `30_wissen/${name}`, dateien: 1 };
  writeFileSync(join(basis, "_bericht.json"), JSON.stringify(b));
  renameSync(join(basis, "_import.json"), join(ar, "_import.json"));
  renameSync(join(basis, "_bericht.md"), join(ar, "_bericht.md"));
  const r = schliesseAb(v, name, { paket: "(oberste Ebene)", ziel: "30_wissen", jetzt: JETZT });
  assert.equal(r.abgeschlossen, true);
  assert.deepEqual(readdirSync(ar).sort(), ["_bericht.json", "_bericht.md", "_import.json"]);
  assert.ok(!existsSync(basis));
  assert.ok(existsSync(join(v, "30_wissen", name, "lose.md")));
});
