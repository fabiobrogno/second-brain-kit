// .tools/tests/test-antwort-messlatte.mjs — Antwort-Messlatte (opt-in): Testfragen aus <wiki>/_antworten.json,
// Haiku nur über fake-claude (BRAIN_CLAUDE / claudeBefehl — NIE das echte claude), lokaler Kernfakten-Abgleich,
// Log + Analyse, monatlicher losgelöster Start. PATH leer, Temp-HOME, Temp-Vault.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const FAKE = fileURLToPath(new URL("./fake-claude.mjs", import.meta.url));
const LEER_PATH = mkdtempSync(join(tmpdir(), "antwort-leerer-path-"));
const TEMP_HOME = mkdtempSync(join(tmpdir(), "antwort-home-"));
Object.assign(process.env, { PATH: LEER_PATH, HOME: TEMP_HOME, USERPROFILE: TEMP_HOME });
for (const k of ["BRAIN_CLAUDE", "BRAIN_ERNTE", "BRAIN_VAULT", "BRAIN_ANTWORT_SKRIPT"]) delete process.env[k];
for (const k of Object.keys(process.env)) if (k.startsWith("GIT_")) delete process.env[k];

const A = await import("../antwort-messlatte.mjs");
const { analyse } = await import("../analyse.mjs");
const FAKE_BEFEHL = { befehl: process.execPath, args: [FAKE] };
const TAG = 86400000;
const KOEDER_PW = ["pass", "word"].join("") + "=Koeder123";

function neuerVault(automatik = {}, antworten = null) {
  const v = join(mkdtempSync(join(tmpdir(), "antwort vault ")), "Jo's Brain Ü");
  mkdirSync(join(v, "09_wiki", "reise"), { recursive: true });
  writeFileSync(join(v, "brain.config.json"), JSON.stringify({ automatik }));
  writeFileSync(join(v, "09_wiki", "reise", "thema_faehre.md"),
    `﻿---\nname: faehre\ndescription: geheim-frontmatter\n---\n# Fähre\r\n\r\nDie erste Fähre fährt um 9 Uhr ab Dagebüll.\n${KOEDER_PW}\n`);
  if (antworten) writeFileSync(join(v, "09_wiki", "_antworten.json"), JSON.stringify(antworten));
  return v;
}
function fake(antwort, { exit = 0 } = {}) {
  const d = mkdtempSync(join(tmpdir(), "antwort-fake-"));
  writeFileSync(join(d, "aus.txt"), antwort);
  Object.assign(process.env, { FAKE_CLAUDE_LOG: join(d, "ein.txt"), FAKE_CLAUDE_AUSGABE: join(d, "aus.txt"), FAKE_CLAUDE_EXIT: String(exit), FAKE_CLAUDE_ROH: "", FAKE_CLAUDE_OHNE_USAGE: "", FAKE_CLAUDE_WARTE: "0" });
  return { ein: join(d, "ein.txt"), args: join(d, "ein.txt.json") };
}
const FAELLE = [
  { frage: "Wann fährt die erste Fähre?", seite: "thema_faehre.md", kernfakten: ["9 Uhr", "Dagebüll"] },
  { frage: "Wer kontrolliert die Tickets?", seite: "thema_faehre", kernfakten: ["Schaffnerin Ute"] },
  { frage: "Gibt es die Seite?", seite: "thema_weg.md", kernfakten: ["nichts"] },
];

test("Abgleich: Wortfolge oder alle tragenden Wörter, Umlaute/Satzzeichen/Groß-Klein egal", () => {
  assert.equal(A.faktGefunden("Die Fähre legt um 9 Uhr in DAGEBUELL ab.", "Dagebüll"), true);
  assert.equal(A.faktGefunden("Abfahrt: 9 Uhr.", "9 Uhr"), true);
  assert.equal(A.faktGefunden("Ab 19 Uhr", "9 Uhr"), false, "keine Teilwort-Treffer");
  assert.equal(A.faktGefunden("Ute ist die Schaffnerin.", "Schaffnerin Ute"), true, "alle tragenden Wörter");
  assert.equal(A.faktGefunden("Ute fährt mit.", "Schaffnerin Ute"), false);
  assert.deepEqual(A.pruefeAntwort("Um 9 Uhr.", ["9 Uhr", "Dagebüll"]), { gefunden: 1, gesamt: 2, fehlend: ["Dagebüll"] });
});

test("ladeAntworten/findeSeite: ungültige Einträge und Einträge mit Zugangsdaten fallen weg; Seite nur im Wiki, eindeutig", () => {
  const v = neuerVault({}, [
    ...FAELLE,
    { frage: "ohne Fakten", seite: "x.md", kernfakten: [] },
    { frage: 3, seite: "x.md", kernfakten: ["a"] },
    { frage: `Wie lautet ${KOEDER_PW}?`, seite: "thema_faehre.md", kernfakten: ["a"] },
  ]);
  assert.deepEqual(A.ladeAntworten(v).map(f => f.frage), FAELLE.map(f => f.frage));
  assert.equal(A.findeSeite(v, "thema_faehre"), "09_wiki/reise/thema_faehre.md");
  assert.equal(A.findeSeite(v, "reise/thema_faehre.md"), "09_wiki/reise/thema_faehre.md");
  assert.equal(A.findeSeite(v, "09_wiki/reise/thema_faehre.md"), "09_wiki/reise/thema_faehre.md");
  assert.equal(A.findeSeite(v, "../brain.config.json"), null);
  mkdirSync(join(v, "09_wiki", "andere"));
  writeFileSync(join(v, "09_wiki", "andere", "thema_faehre.md"), "# Doppelt\n");
  assert.equal(A.findeSeite(v, "thema_faehre.md"), null, "mehrdeutig → keine Seite");
  writeFileSync(join(v, "09_wiki", "_antworten.json"), "kaputt");
  assert.deepEqual(A.ladeAntworten(v), []);
});

test("antwortLauf (fake-claude): je Frage ein schlanker Haiku-Aufruf nur mit der Seite, Kernfakten lokal geprüft, Log + Analyse", async () => {
  const v = neuerVault({ antwortMesslatte: "monatlich" }, FAELLE);
  const f = fake("Die erste Fähre fährt um 9 Uhr ab Dagebüll.");
  const r = await A.antwortLauf(v, { claudeBefehl: FAKE_BEFEHL, jetzt: Date.UTC(2026, 9, 3, 8), anlass: "monatlich" });
  assert.equal(r.status, "ok");
  assert.deepEqual([r.fragen, r.voll, r.fakten, r.fehler], [3, 1, "2/4", 1]);
  assert.ok(r.tokens && r.tokens.ein > 0 && r.tokens.aus > 0);
  // Eingabe der letzten Frage: Seite ohne Frontmatter, ohne Zugangsdaten, dazu die Frage
  const ein = readFileSync(f.ein, "utf8");
  assert.match(ein, /^--- SEITE ---\n\n# Fähre\n\nDie erste Fähre fährt um 9 Uhr ab Dagebüll\.[\s\S]*--- FRAGE ---\n\nWer kontrolliert die Tickets\?\n$/);
  assert.ok(!ein.includes("geheim-frontmatter") && !ein.includes("Koeder123"));
  const args = JSON.parse(readFileSync(f.args, "utf8")).args;
  assert.equal(args[args.indexOf("--system-prompt") + 1], A.ANTWORT_AUFTRAG);
  // Log + Ergebnis
  const log = readFileSync(join(v, ".logs", "antwort-messlatte.log"), "utf8");
  assert.equal(log.trim().split("\n").length, 4);
  const e = A.leseErgebnis(v);
  assert.deepEqual([e.letzter.status, e.letzter.anlass, e.letzter.fragen, e.letzter.voll, e.letzter.fakten], ["ok", "monatlich", 3, 1, "2/4"]);
  assert.equal(e.letzter.zeit, "2026-10-03T08:00:00Z");
  assert.deepEqual(e.faelle.map(x => [x.nr, x.seite, x.status, x.fakten, x.fehlend]), [
    [1, "09_wiki/reise/thema_faehre.md", "ok", "2/2", []],
    [2, "09_wiki/reise/thema_faehre.md", "ok", "0/1", ["Schaffnerin Ute"]],
    [3, "thema_weg.md", "fehler", "0/1", ["nichts"]],
  ]);
  assert.equal(e.faelle[1].frage, "Wer kontrolliert die Tickets?");
  const a = analyse(v);
  assert.equal(a.antwortMesslatte.schalter, "monatlich");
  assert.equal(a.antwortMesslatte.letzter.voll, 1);
  assert.equal(a.antwortMesslatte.faelle.length, 3);
  assert.ok(!existsSync(join(v, ".logs", "antwort-messlatte", "lauf.lock")), "Lock aufgeräumt");
});

test("antwortLauf: ohne claude → fehler im Log; ohne Testfragen → übersprungen, nichts geloggt; Analyse ohne Lauf → letzter null", async () => {
  const v = neuerVault({}, FAELLE);
  const r = await A.antwortLauf(v, { claudeBefehl: null });
  assert.deepEqual([r.status, r.grund], ["fehler", "claude nicht gefunden"]);
  assert.match(readFileSync(join(v, ".logs", "antwort-messlatte.log"), "utf8"), /art=lauf status=fehler anlass=knopf fragen=3 grund=claude-fehlt/);
  assert.equal(A.leseErgebnis(v).letzter.grund, "claude-fehlt");
  const leer = neuerVault();
  assert.deepEqual(await A.antwortLauf(leer, { claudeBefehl: FAKE_BEFEHL }), { status: "uebersprungen", grund: "keine Testfragen" });
  assert.ok(!existsSync(join(leer, ".logs", "antwort-messlatte.log")));
  assert.deepEqual(analyse(leer).antwortMesslatte, { schalter: "aus", letzter: null, faelle: [] });
});

test("antwortLauf: Haiku-Fehler je Frage → Fall als fehler, alle Fälle fehlerhaft → Lauf fehler", async () => {
  const v = neuerVault({}, FAELLE.slice(0, 1));
  fake("egal", { exit: 2 });
  const r = await A.antwortLauf(v, { claudeBefehl: FAKE_BEFEHL });
  assert.equal(r.status, "fehler");
  assert.match(readFileSync(join(v, ".logs", "antwort-messlatte.log"), "utf8"), /art=fall nr=1 .* status=fehler grund=Exit%202/);
});

test("monatlicher Start: Schalter aus/ohne Testfragen → nichts; fällig → losgelöst gestartet, Marke gesetzt; danach 30 Tage Ruhe", async () => {
  const fd = mkdtempSync(join(tmpdir(), "antwort-start-"));
  const skript = join(fd, "fake-lauf.mjs");
  writeFileSync(skript, `import { writeFileSync } from "node:fs";\nwriteFileSync(process.env.FAKE_ANTWORT_LOG, JSON.stringify({ args: process.argv.slice(2), vault: process.env.BRAIN_VAULT || "" }));\n`);
  assert.equal(A.faellig(neuerVault({}, FAELLE)), false, "Standard aus");
  assert.equal(A.faellig(neuerVault({ antwortMesslatte: "monatlich" })), false, "ohne Testfragen");
  const v = neuerVault({ antwortMesslatte: "monatlich" }, FAELLE);
  assert.equal(A.faellig(v), true);
  assert.deepEqual(A.starteLosgeloest(v), { gestartet: false, grund: "claude fehlt" });
  process.env.BRAIN_ANTWORT_SKRIPT = skript;
  process.env.FAKE_ANTWORT_LOG = join(fd, "lauf.json");
  try {
    assert.equal(A.starteWennFaellig(v), true);
    const ende = Date.now() + 8000;
    while (Date.now() < ende && !existsSync(process.env.FAKE_ANTWORT_LOG)) await new Promise(r => setTimeout(r, 50));
    const lauf = JSON.parse(readFileSync(process.env.FAKE_ANTWORT_LOG, "utf8"));
    assert.deepEqual(lauf.args, ["--anlass", "monatlich", v]);
    assert.equal(lauf.vault, v);
    assert.ok(existsSync(A.START_MARKE(v)));
    assert.deepEqual(A.starteLosgeloest(v), { gestartet: false, grund: "läuft schon" });
    assert.equal(A.starteWennFaellig(v), false, "innerhalb von 30 Tagen nicht noch einmal");
    const alt = new Date(Date.now() - 31 * TAG); utimesSync(A.START_MARKE(v), alt, alt);
    assert.equal(A.faellig(v), true);
  } finally { delete process.env.BRAIN_ANTWORT_SKRIPT; delete process.env.FAKE_ANTWORT_LOG; }
  // ohne claude: Marke trotzdem gesetzt, damit nicht jeder Sitzungsstart es erneut versucht
  const ohne = neuerVault({ antwortMesslatte: "monatlich" }, FAELLE);
  assert.equal(A.starteWennFaellig(ohne), false);
  assert.ok(existsSync(A.START_MARKE(ohne)));
});
