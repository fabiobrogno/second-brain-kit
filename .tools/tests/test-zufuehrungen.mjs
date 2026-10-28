// .tools/tests/test-zufuehrungen.mjs — Wächter für Zuführungen: toter Pfad, entzogene Leserechte, stillstehende Quelle.
// Nur mkdtemp-Ordner; HOME auf ein Temp-Verzeichnis. Fehler müssen im selben Lauf in der Statusdatei UND im Pflegebericht stehen.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, utimesSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const TEST_HOME = mkdtempSync(join(tmpdir(), "brain zufuehr home "));
Object.assign(process.env, { HOME: TEST_HOME, USERPROFILE: TEST_HOME });
const { pruefeZufuehrungen, schreibeStatus, statusText, STATUS_DATEI } = await import("../zufuehrungen.mjs");
const { aktuellerBericht, textBericht, eintragText } = await import("../pflege.mjs");

const HIER = dirname(fileURLToPath(import.meta.url));
const JETZT = new Date(2026, 9, 28, 12, 0, 0).getTime();
const TAG = 86400000;
const alsRoot = typeof process.getuid === "function" && process.getuid() === 0;

function vaultMit(zufuehrungen) {
  const v = mkdtempSync(join(tmpdir(), "brain zufuehr "));
  mkdirSync(join(v, "09_wiki"), { recursive: true });
  writeFileSync(join(v, "09_wiki", "ueberblick.md"), "---\nname: Überblick\ndescription: Test\n---\n# Überblick\n");
  writeFileSync(join(v, "brain.config.json"), JSON.stringify({ zufuehrungen }) + "\n");
  return v;
}
function quelle(alterTage) {
  const d = mkdtempSync(join(tmpdir(), "brain quelle "));
  const f = join(d, "notiz.md");
  writeFileSync(f, "x");
  const t = new Date(JETZT - alterTage * TAG);
  utimesSync(f, t, t); utimesSync(d, t, t);
  return d;
}
const status = (s, name) => s.zufuehrungen.find(z => z.name === name).status;

test("ok, still, fehlt, config: je Zuführung genau ein Status", () => {
  const frisch = quelle(1), alt = quelle(9);
  const v = vaultMit([
    { name: "frisch", pfad: frisch }, { name: "alt", pfad: alt, maxAlterTage: 7 },
    { name: "weg", pfad: join(tmpdir(), "gibt es nicht", "x") }, { name: "leer" },
  ]);
  const s = pruefeZufuehrungen(v, { jetzt: JETZT });
  assert.deepEqual(s.zufuehrungen.map(z => z.status), ["ok", "still", "fehlt", "config"]);
  assert.equal(s.probleme, 3);
  assert.equal(s.zufuehrungen[0].alterTage, 1);
  assert.equal(s.zufuehrungen[1].alterTage, 9);
  assert.equal(s.zufuehrungen[0].letzterLauf, new Date(JETZT - TAG).toISOString().slice(0, 19) + "Z");
  assert.equal(s.zufuehrungen[2].letzterLauf, null);
});

test("ohne Eintrag: keine Probleme, kein Posten-Eintrag", () => {
  const s = pruefeZufuehrungen(vaultMit([]), { jetzt: JETZT });
  assert.deepEqual(s, { version: 1, erstellt: new Date(JETZT).toISOString().slice(0, 19) + "Z", probleme: 0, zufuehrungen: [] });
  assert.match(statusText(s), /keine eingetragen/);
});

test("relativer Pfad gilt ab dem Vault", () => {
  const v = vaultMit([{ name: "intern", pfad: "09_wiki" }]);
  assert.equal(status(pruefeZufuehrungen(v, { jetzt: Date.now() }), "intern"), "ok");
});

test("Lauf: toter Pfad steht in Statusdatei und im Pflegebericht", async () => {
  const v = vaultMit([{ name: "Notizen-Sync", pfad: join(tmpdir(), "brain tot", "weg") }, { name: "gut", pfad: quelle(0) }]);
  const b = await aktuellerBericht(v, { jetzt: JETZT });
  const datei = JSON.parse(readFileSync(STATUS_DATEI(v), "utf8"));
  assert.equal(datei.version, 1);
  assert.equal(datei.probleme, 1);
  assert.equal(status(datei, "Notizen-Sync"), "fehlt");
  const p = b.posten.find(x => x.schluessel === "zufuehrungen");
  assert.equal(p.anzahl, 1);
  assert.deepEqual(p.liste, [{ name: "Notizen-Sync", status: "fehlt", tage: 0 }]);
  assert.equal(eintragText("zufuehrungen", p.liste[0]), "Notizen-Sync — Pfad fehlt");
  assert.ok(b.zuTun >= 1);
  assert.match(textBericht(b), /Zuführung steht still: Notizen-Sync — Pfad fehlt/);
});

test("Lauf: entzogene Leserechte (Testhaken) stehen in Statusdatei und Pflegebericht", () => {
  const d = quelle(0);
  const v = vaultMit([{ name: "Mail-Import", pfad: d }]);
  const s = pruefeZufuehrungen(v, { jetzt: JETZT, lesbar: () => false });
  assert.equal(status(s, "Mail-Import"), "nicht-lesbar");
  schreibeStatus(v, s);
  assert.equal(JSON.parse(readFileSync(STATUS_DATEI(v), "utf8")).probleme, 1);
  assert.equal(eintragText("zufuehrungen", { name: "Mail-Import", status: "nicht-lesbar" }), "Mail-Import — keine Leserechte");
});

test("Lauf: echt entzogene Leserechte (chmod 000)", { skip: alsRoot || process.platform === "win32" ? "root/Windows ignoriert chmod" : false }, async () => {
  const d = quelle(0);
  const v = vaultMit([{ name: "Gesperrt", pfad: d }]);
  chmodSync(d, 0o000);
  try {
    const b = await aktuellerBericht(v, { jetzt: JETZT });
    assert.equal(status(JSON.parse(readFileSync(STATUS_DATEI(v), "utf8")), "Gesperrt"), "nicht-lesbar");
    assert.match(textBericht(b), /Gesperrt — keine Leserechte/);
  } finally { chmodSync(d, 0o755); }
});

test("Cache: ein später auftretender Fehler wird trotz Cache-Treffer gemeldet", async () => {
  const d = quelle(0);
  const v = vaultMit([{ name: "Sync", pfad: d }]);
  assert.equal((await aktuellerBericht(v, { jetzt: JETZT })).posten.find(x => x.schluessel === "zufuehrungen").anzahl, 0);
  const b = await aktuellerBericht(v, { jetzt: JETZT + 10 * TAG });
  assert.equal(b.posten.find(x => x.schluessel === "zufuehrungen").liste[0].status, "still");
});

test("Statusdatei nicht schreibbar → Eintrag im Bericht, nicht still", async () => {
  const v = vaultMit([{ name: "gut", pfad: quelle(0) }]);
  writeFileSync(join(v, ".logs"), "ich bin eine Datei"); // .logs als Datei → mkdir/write scheitert
  const b = await aktuellerBericht(v, { jetzt: JETZT });
  const p = b.posten.find(x => x.schluessel === "zufuehrungen");
  assert.equal(p.anzahl, 1);
  assert.match(eintragText("zufuehrungen", p.liste[0]), /nicht schreibbar/);
});

test("schreibeStatus: scheitert das Umbenennen, bleibt keine .tmp-Datei liegen und der Fehler wird geworfen", () => {
  const v = vaultMit([{ name: "gut", pfad: quelle(0) }]);
  const s = pruefeZufuehrungen(v, { jetzt: JETZT });
  mkdirSync(STATUS_DATEI(v), { recursive: true }); // Ziel ist ein Ordner → renameSync scheitert
  assert.throws(() => schreibeStatus(v, s));
  assert.deepEqual(readdirSync(dirname(STATUS_DATEI(v))).filter(f => f.endsWith(".tmp")), []);
});

test("statusText: Singular bei 1 Tag", () => {
  const z = (alterTage) => statusText({ probleme: 1, zufuehrungen: [{ name: "x", status: "still", alterTage }] });
  assert.match(z(1), /letzter Lauf vor 1 Tag\)/);
  assert.match(z(8), /letzter Lauf vor 8 Tagen\)/);
});

test("CLI: schreibt die Statusdatei und gibt eine Zeile je Zuführung aus", () => {
  const v = vaultMit([{ name: "weg", pfad: join(tmpdir(), "brain nirgends") }]);
  const out = execFileSync(process.execPath, [join(HIER, "..", "zufuehrungen.mjs"), v], { encoding: "utf8", env: { ...process.env, BRAIN_VAULT: v } });
  assert.match(out, /1 von 1 mit Problem/);
  assert.match(out, /- weg: fehlt/);
  assert.equal(JSON.parse(readFileSync(STATUS_DATEI(v), "utf8")).probleme, 1);
});
