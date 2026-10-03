// .tools/tests/test-ernte-ausloeser.mjs — Ernte-Auslöser (SessionEnd/PreCompact), Stand-Intervall im
// brain-hint und der Selbstaufruf-Schutz BRAIN_ERNTE=1 für alle Hooks. Nie das echte claude: die Ernte
// läuft über den Testhaken BRAIN_ERNTE_SKRIPT (Fake-Ernte) bzw. BRAIN_CLAUDE mit fake-claude.mjs.
// HOME/USERPROFILE zeigen auf ein Temp-Home, PATH auf einen leeren Temp-Ordner, keine geerbten GIT_*.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, utimesSync, readdirSync, rmSync, symlinkSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const HIER = dirname(fileURLToPath(import.meta.url));
const ADAPTER = join(HIER, "..", "adapters", "claude-code");
const AUSLOESER = join(ADAPTER, "ernte-ausloeser.mjs");
const HINT = join(ADAPTER, "brain-hint.mjs");
const FAKE_CLAUDE = join(HIER, "fake-claude.mjs");
const TEMP_HOME = mkdtempSync(join(tmpdir(), "ausloeser-home-"));
const LEER_PATH = mkdtempSync(join(tmpdir(), "ausloeser-leerer-path-"));

// Fake-Ernte: schreibt Argumente und die relevanten Umgebungswerte nach $FAKE_ERNTE_LOG.
const FAKE_DIR = mkdtempSync(join(tmpdir(), "fake-ernte-"));
const FAKE_ERNTE = join(FAKE_DIR, "fake-ernte.mjs");
writeFileSync(FAKE_ERNTE, `import { writeFileSync } from "node:fs";
writeFileSync(process.env.FAKE_ERNTE_LOG, JSON.stringify({ args: process.argv.slice(2), ernte: process.env.BRAIN_ERNTE || "", vault: process.env.BRAIN_VAULT || "" }));
`);

// Fake-Session-Auswerter (v0.4): schreibt Argumente nach $FAKE_LEKTIONEN_LOG.
const FAKE_LEKTIONEN = join(FAKE_DIR, "fake-lektionen.mjs");
writeFileSync(FAKE_LEKTIONEN, `import { writeFileSync } from "node:fs";
writeFileSync(process.env.FAKE_LEKTIONEN_LOG, JSON.stringify({ args: process.argv.slice(2), vault: process.env.BRAIN_VAULT || "" }));
`);

function basisEnv(extra = {}) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_") && !k.startsWith("BRAIN_") && !k.startsWith("FAKE_")));
  return { ...env, HOME: TEMP_HOME, USERPROFILE: TEMP_HOME, PATH: LEER_PATH, ...extra };
}
function neuerVault(automatik = {}) {
  const v = mkdtempSync(join(tmpdir(), "ausloeser vault, Jo's Ü "));
  writeFileSync(join(v, "brain.config.json"), JSON.stringify({ automatik }));
  return v;
}
function transkript(prompts = 6) {
  const d = mkdtempSync(join(tmpdir(), "ausloeser-transkript-"));
  const f = join(d, "sitzung.jsonl");
  const z = [];
  for (let i = 0; i < prompts; i++) {
    z.push(JSON.stringify({ type: "user", message: { role: "user", content: `Wie plane ich das Gemüsebeet Nummer ${i} im Frühling?` } }));
    z.push(JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: `Beet ${i}: Erst Kompost, dann Salat.` }] } }));
  }
  writeFileSync(f, z.join("\n") + "\n");
  return f;
}
const warteAuf = async (f, ms = 8000) => {
  const ende = Date.now() + ms;
  while (Date.now() < ende) { if (existsSync(f)) { try { return JSON.parse(readFileSync(f, "utf8")); } catch {} } await new Promise(r => setTimeout(r, 50)); }
  return null;
};
const sicherNichts = async (f, ms = 600) => { await new Promise(r => setTimeout(r, ms)); return !existsSync(f); };
function starte(skript, args, eingabe, env) {
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [skript, ...args], { input: JSON.stringify(eingabe), encoding: "utf8", env, windowsHide: true });
  return { ...r, ms: Date.now() - t0 };
}
const hookEingabe = (tr, extra = {}) => ({ session_id: "sitzung-abc123", transcript_path: tr, cwd: "/projekte/garten", ...extra });

test("SessionEnd mit ernteSitzungsende an: startet die Ernte losgelöst (--art fakt), kehrt < 300 ms zurück, gibt nichts aus", async () => {
  const v = neuerVault({ ernteSitzungsende: true }), tr = transkript(), log = join(FAKE_DIR, "a.json");
  const r = starte(AUSLOESER, ["--art", "fakt"], hookEingabe(tr), basisEnv({ BRAIN_VAULT: v, BRAIN_ERNTE_SKRIPT: FAKE_ERNTE, FAKE_ERNTE_LOG: log }));
  assert.equal(r.status, 0);
  assert.equal(r.stdout, ""); assert.equal(r.stderr, "");
  assert.ok(r.ms < 300, `Auslöser brauchte ${r.ms} ms`);
  const lauf = await warteAuf(log);
  assert.ok(lauf, "Fake-Ernte wurde nicht gestartet");
  assert.deepEqual(lauf.args, ["--art", "fakt", "--transkript", tr, "--sid", "sitzung-abc123", "--cwd", "/projekte/garten", "--auftrag", "sitzung-abc123.json", v]);
  assert.equal(lauf.ernte, "", "der Ernte-Prozess selbst bekommt kein BRAIN_ERNTE (das setzt ernte.mjs nur für claude)");
  const auftrag = JSON.parse(readFileSync(join(v, ".logs", "ernte", "offen", "sitzung-abc123.json"), "utf8"));
  assert.deepEqual(auftrag, { art: "fakt", transkript: tr, sid: "sitzung-abc123", cwd: "/projekte/garten" }, "Auftrags-Marke vor dem Start");
  assert.ok(!existsSync(join(v, ".logs", "ernte", "sitzung-abc123.fakt")), "keine Sperre vor dem Ergebnis (Final-Review #2)");
});

// Final-Review #2: früher PreCompact mit „zu kurz" darf die Ernte am Sitzungsende nicht verhindern; ein zweiter
// Lauf erntet nur den neuen Teil — Ende-zu-Ende mit echter ernte.mjs und fake-claude.
test("fakt: PreCompact „zu kurz“ → SessionEnd erntet trotzdem; danach ohne Neues kein zweiter Aufruf", async () => {
  const v = neuerVault({ ernteSitzungsende: true }), tr = transkript(3);
  const d = mkdtempSync(join(tmpdir(), "ausloeser-kurz-"));
  writeFileSync(join(d, "ausgabe.txt"), "### Beet\nErst Kompost.\n");
  const env = basisEnv({ BRAIN_VAULT: v, BRAIN_CLAUDE: FAKE_CLAUDE, FAKE_CLAUDE_LOG: join(d, "eingabe.txt"), FAKE_CLAUDE_AUSGABE: join(d, "ausgabe.txt") });
  const offen = join(v, ".logs", "ernte", "offen", "sitzung-abc123.json");
  const weg = async (f, ms = 15000) => { const ende = Date.now() + ms; while (Date.now() < ende && existsSync(f)) await new Promise(r => setTimeout(r, 50)); return !existsSync(f); };
  starte(AUSLOESER, ["--art", "fakt"], hookEingabe(tr), env);                   // PreCompact, 3 Prompts
  assert.ok(await weg(offen), "Auftrag nach „zu kurz“ abgeschlossen");
  assert.ok(!existsSync(join(d, "eingabe.txt")), "zu kurz → kein claude");
  writeFileSync(tr, readFileSync(tr, "utf8") + readFileSync(transkript(3), "utf8"));   // jetzt 6 Prompts
  starte(AUSLOESER, ["--art", "fakt"], hookEingabe(tr), env);                   // SessionEnd
  assert.ok(await warteAuf(join(d, "eingabe.txt.json"), 15000), "SessionEnd muss ernten");
  assert.ok(await weg(offen));
  assert.match(readFileSync(join(v, ".logs", "ernte.log"), "utf8"), /art=fakt status=ok .*vorschlaege=1/);
  assert.ok(existsSync(join(v, ".logs", "ernte", "sitzung-abc123.fakt")), "Stand erst nach Erfolg");
  rmSync(join(d, "eingabe.txt.json"));
  starte(AUSLOESER, ["--art", "fakt"], hookEingabe(tr), env);                   // noch ein Aufruf, nichts Neues
  assert.ok(await weg(offen));
  assert.ok(!existsSync(join(d, "eingabe.txt.json")), "ohne neuen Teil kein zweiter claude-Lauf");
});

// Final-Review #5/#8: liegengebliebene Aufträge holt session-start nach; alte Marken werden aufgeräumt.
test("arbeiteOffeneAb: ältester gültiger Auftrag wird losgelöst gestartet; > 7 Tage, kaputt oder Schalter aus → gelöscht; alte .fakt/.stand weg", async () => {
  Object.assign(process.env, { HOME: TEMP_HOME, USERPROFILE: TEMP_HOME, BRAIN_ERNTE_SKRIPT: FAKE_ERNTE });
  delete process.env.BRAIN_ERNTE;
  const { arbeiteOffeneAb, raeumeMarkenAuf } = await import("../adapters/claude-code/ernte-ausloeser.mjs");
  const v = neuerVault({ ernteSitzungsende: true }), tr = transkript();
  const dir = join(v, ".logs", "ernte"), offen = join(dir, "offen");
  mkdirSync(offen, { recursive: true });
  const alt = new Date(Date.now() - 8 * 24 * STUNDE), aelter = new Date(Date.now() - 2 * STUNDE);
  const leg = (n, inhalt, zeit) => { const p = join(offen, n); writeFileSync(p, typeof inhalt === "string" ? inhalt : JSON.stringify(inhalt)); if (zeit) utimesSync(p, zeit, zeit); return p; };
  const uralt = leg("uralt.json", { art: "fakt", transkript: tr, sid: "uralt", cwd: "/p" }, alt);
  const kaputt = leg("kaputt.json", "{", aelter);
  const gut = leg("gut.json", { art: "fakt", transkript: tr, sid: "gut", cwd: "/projekte/garten" }, new Date(Date.now() - STUNDE));
  const neu = leg("neu.json", { art: "fakt", transkript: tr, sid: "neu", cwd: "/p" });
  for (const n of ["x.fakt", "y.stand"]) { writeFileSync(join(dir, n), ""); utimesSync(join(dir, n), alt, alt); }
  writeFileSync(join(dir, "frisch.fakt"), "");
  process.env.FAKE_ERNTE_LOG = join(FAKE_DIR, "offen-1.json");
  assert.equal(arbeiteOffeneAb(v), "gut.json");
  const lauf = await warteAuf(process.env.FAKE_ERNTE_LOG);
  assert.deepEqual(lauf.args, ["--art", "fakt", "--transkript", tr, "--sid", "gut", "--cwd", "/projekte/garten", "--auftrag", "gut.json", v]);
  assert.ok(!existsSync(uralt) && !existsSync(kaputt), "uralt/kaputt gelöscht");
  assert.ok(existsSync(gut) && existsSync(neu), "gestartete Marke entfernt erst ernte.mjs, die nächste wartet");
  assert.ok(!existsSync(join(dir, "x.fakt")) && !existsSync(join(dir, "y.stand")) && existsSync(join(dir, "frisch.fakt")));
  assert.deepEqual(raeumeMarkenAuf(v), ["gut.json", "neu.json"]);
  // Schalter inzwischen aus → Aufträge verfallen, nichts startet
  writeFileSync(join(v, "brain.config.json"), JSON.stringify({ automatik: {} }));
  process.env.FAKE_ERNTE_LOG = join(FAKE_DIR, "offen-2.json");
  assert.equal(arbeiteOffeneAb(v), "");
  assert.ok(await sicherNichts(process.env.FAKE_ERNTE_LOG));
  assert.deepEqual(readdirSync(offen), []);
});

test("Schalter aus (Standard): keine Ernte, keine Ausgabe", async () => {
  const v = neuerVault({}), tr = transkript(), log = join(FAKE_DIR, "b.json");
  const r = starte(AUSLOESER, ["--art", "fakt"], hookEingabe(tr), basisEnv({ BRAIN_VAULT: v, BRAIN_ERNTE_SKRIPT: FAKE_ERNTE, FAKE_ERNTE_LOG: log }));
  assert.equal(r.status, 0); assert.equal(r.stdout + r.stderr, "");
  assert.ok(await sicherNichts(log));
});

// ---------- v0.4: Session-Auswerter (Lektionen) am Sitzungsende ----------
test("Lektionen: SessionEnd startet den Session-Auswerter losgelöst (Standard lokal) — auch ohne Ernte-Schalter, still", async () => {
  const v = neuerVault({}), tr = transkript(), log = join(FAKE_DIR, "l1.json"), ernteLog = join(FAKE_DIR, "l1-ernte.json");
  const r = starte(AUSLOESER, ["--art", "fakt"], hookEingabe(tr), basisEnv({ BRAIN_VAULT: v, BRAIN_LEKTIONEN_SKRIPT: FAKE_LEKTIONEN, FAKE_LEKTIONEN_LOG: log, BRAIN_ERNTE_SKRIPT: FAKE_ERNTE, FAKE_ERNTE_LOG: ernteLog }));
  assert.equal(r.status, 0); assert.equal(r.stdout + r.stderr, "");
  assert.ok(r.ms < 300, `Auslöser brauchte ${r.ms} ms`);
  const lauf = await warteAuf(log);
  assert.ok(lauf, "Session-Auswerter wurde nicht gestartet");
  assert.deepEqual(lauf.args, ["--transkript", tr, "--sid", "sitzung-abc123", "--cwd", "/projekte/garten", v]);
  assert.equal(lauf.vault, v);
  assert.ok(await sicherNichts(ernteLog), "Ernte-Schalter aus → keine Ernte");
});

test("Lektionen: Schalter aus, --art stand, kaputte Config oder fehlendes Transkript → kein Session-Auswerter", async () => {
  const tr = transkript();
  const faelle = [
    [neuerVault({ lektionen: "aus", ernteSitzungsende: true }), ["--art", "fakt"], hookEingabe(tr)],
    [neuerVault({ staendeIntervallStunden: 2 }), ["--art", "stand"], hookEingabe(tr)],
    [neuerVault({}), ["--art", "fakt"], hookEingabe(join(FAKE_DIR, "gibt-es-nicht.jsonl"))],
  ];
  const kaputt = mkdtempSync(join(tmpdir(), "ausloeser-kaputt-"));
  writeFileSync(join(kaputt, "brain.config.json"), "{ kaputt");
  faelle.push([kaputt, ["--art", "fakt"], hookEingabe(tr)]);
  for (const [i, [v, args, eingabe]] of faelle.entries()) {
    const log = join(FAKE_DIR, `l2-${i}.json`);
    starte(AUSLOESER, args, eingabe, basisEnv({ BRAIN_VAULT: v, BRAIN_LEKTIONEN_SKRIPT: FAKE_LEKTIONEN, FAKE_LEKTIONEN_LOG: log, BRAIN_ERNTE_SKRIPT: FAKE_ERNTE, FAKE_ERNTE_LOG: join(FAKE_DIR, `l2-e-${i}.json`) }));
    assert.ok(await sicherNichts(log), `Fall ${i}: Session-Auswerter gestartet`);
  }
});

test("Lektionen Ende-zu-Ende: echte lektionen.mjs, zwei gleiche Korrekturen → ein Vorschlag art lektion (0 Tokens)", async () => {
  const v = neuerVault({}), d = mkdtempSync(join(tmpdir(), "ausloeser-lektion-"));
  const tr = join(d, "sitzung.jsonl");
  const z = (type, content) => JSON.stringify({ type, cwd: "/projekte/garten", message: { role: type, content } });
  writeFileSync(tr, [
    z("user", "Erstelle den Saatplan für das Beet."), z("assistant", [{ type: "text", text: "Saatplan: Möhren im März." }]),
    z("user", "Nein, Möhren im Saatplan erst im April säen."), z("assistant", [{ type: "text", text: "Ok, März bleibt." }]),
    z("user", "Schon wieder falsch: Möhren im Saatplan erst April!"), z("assistant", [{ type: "text", text: "Korrigiert." }]),
  ].join("\n") + "\n");
  starte(AUSLOESER, ["--art", "fakt"], hookEingabe(tr), basisEnv({ BRAIN_VAULT: v }));
  const dir = join(v, "00_inbox", "_vorschlaege");
  const ende = Date.now() + 10000;
  while (Date.now() < ende && !(existsSync(dir) && readdirSync(dir).length)) await new Promise(r => setTimeout(r, 50));
  const dateien = existsSync(dir) ? readdirSync(dir) : [];
  assert.equal(dateien.length, 1, "genau ein Lektions-Vorschlag");
  assert.match(readFileSync(join(dir, dateien[0]), "utf8"), /^---\ntyp: vorschlag\nart: lektion\n/);
});

test("session-start (v0.4): Zeilen für wartende Lektionen und Entscheidungen; Vorschläge ohne Lektionen; keine Zeile für übernommene Lektionen; still ohne Anlass", async () => {
  const { schreibeVorschlag } = await import("../vorschlaege.mjs");
  // Wochen-Zeile aus (die prüft test-pflegelauf.mjs) — sonst hinge diese Probe vom Pflegebericht ab.
  const v = neuerVault({ projektAutomatik: false, wochenbericht: false });
  mkdirSync(join(v, ".logs"), { recursive: true });
  writeFileSync(join(v, ".logs", "letzter-review"), "");
  const ss = (env = {}) => starte(join(ADAPTER, "session-start.mjs"), [], {}, basisEnv({ BRAIN_VAULT: v, BRAIN_SESSION_NUR_STATUS: "1", ...env }));
  let r = ss();
  assert.equal(r.status, 0); assert.equal(r.stdout, "", "ohne Anlass still");
  schreibeVorschlag(v, { art: "fakt", titel: "Beet", text: "Das Beet liegt im Süden." });
  schreibeVorschlag(v, { art: "lektion", titel: "Gießen", text: "Rohkandidat" });
  schreibeVorschlag(v, { art: "lektion", titel: "Säen", text: "Rohkandidat" });
  mkdirSync(join(v, "00_inbox", "_entscheidungen"), { recursive: true });
  writeFileSync(join(v, "00_inbox", "_entscheidungen", "e1.md"), "---\ntyp: entscheidung\n---\n");
  mkdirSync(join(v, "00_inbox", "_lektionen"), { recursive: true });
  writeFileSync(join(v, "00_inbox", "_lektionen", "l1.md"), "x");
  writeFileSync(join(v, "00_inbox", "_lektionen", "skill-entwurf.md"), "x");
  // Final-Review #1: übernommene Pflege-Vorschläge sind Prüfaufträge, keine Inbox-Quellen
  mkdirSync(join(v, "00_inbox", "_pflege"), { recursive: true });
  writeFileSync(join(v, "00_inbox", "_pflege", "p1.md"), "---\ntyp: vorschlag\nart: pflege\n---\n");
  r = ss();
  const zeilen = r.stdout.trim().split(/\r?\n/);
  assert.deepEqual(zeilen, [
    "1 neuer Vorschlag — im Gehirn prüfen („zeig mir mein Brain“)",
    "1 Entscheidung wartet auf Umsetzung — /ingest",
    "2 Lektionen warten auf Übernahme — im Gehirn unter Vorschläge",
  ], r.stdout);
  assert.ok(!/übernommene Lektion/.test(r.stdout), "nicht in der Spec (0-Token-Regel, W1-Review #7)");
  assert.ok(!/Brain-Inbox/.test(r.stdout), "_entscheidungen/_lektionen/_pflege zählen nicht als Inbox");
});

test("--art stand nur mit staendeIntervallStunden > 0; fehlendes Transkript → nichts; kaputtes stdin → Exit 0 still", async () => {
  const tr = transkript();
  const aus = neuerVault({ ernteSitzungsende: true }), logAus = join(FAKE_DIR, "c1.json");
  starte(AUSLOESER, ["--art", "stand"], hookEingabe(tr), basisEnv({ BRAIN_VAULT: aus, BRAIN_ERNTE_SKRIPT: FAKE_ERNTE, FAKE_ERNTE_LOG: logAus }));
  assert.ok(await sicherNichts(logAus), "stand ohne Intervall darf nicht ernten");
  const an = neuerVault({ staendeIntervallStunden: 2 }), logAn = join(FAKE_DIR, "c2.json");
  starte(AUSLOESER, ["--art", "stand"], hookEingabe(tr), basisEnv({ BRAIN_VAULT: an, BRAIN_ERNTE_SKRIPT: FAKE_ERNTE, FAKE_ERNTE_LOG: logAn }));
  assert.equal((await warteAuf(logAn))?.args[1], "stand");
  const logFehlt = join(FAKE_DIR, "c3.json");
  starte(AUSLOESER, ["--art", "fakt"], hookEingabe(join(FAKE_DIR, "gibt-es-nicht.jsonl")), basisEnv({ BRAIN_VAULT: neuerVault({ ernteSitzungsende: true }), BRAIN_ERNTE_SKRIPT: FAKE_ERNTE, FAKE_ERNTE_LOG: logFehlt }));
  assert.ok(await sicherNichts(logFehlt));
  const r = spawnSync(process.execPath, [AUSLOESER, "--art", "fakt"], { input: "{kaputt", encoding: "utf8", env: basisEnv({ BRAIN_VAULT: an }), windowsHide: true });
  assert.equal(r.status, 0); assert.equal(r.stdout + r.stderr, "");
});

test("Ende-zu-Ende mit echter ernte.mjs und fake-claude (BRAIN_CLAUDE): claude-Ersatz läuft mit BRAIN_ERNTE=1", async () => {
  const v = neuerVault({ ernteSitzungsende: true }), tr = transkript(6);
  const d = mkdtempSync(join(tmpdir(), "ausloeser-fake-claude-"));
  writeFileSync(join(d, "ausgabe.txt"), "NICHTS\n");
  const env = basisEnv({ BRAIN_VAULT: v, BRAIN_CLAUDE: FAKE_CLAUDE, FAKE_CLAUDE_LOG: join(d, "eingabe.txt"), FAKE_CLAUDE_AUSGABE: join(d, "ausgabe.txt") });
  const r = starte(AUSLOESER, ["--art", "fakt"], hookEingabe(tr), env);
  assert.equal(r.status, 0); assert.equal(r.stdout + r.stderr, "");
  const args = await warteAuf(join(d, "eingabe.txt.json"), 15000);
  assert.ok(args, "fake-claude wurde nicht aufgerufen (Exit 3 hieße: ohne BRAIN_ERNTE=1)");
  // ernte.log-Zeile kommt nach dem claude-Lauf
  const ende = Date.now() + 8000;
  while (Date.now() < ende && !existsSync(join(v, ".logs", "ernte.log"))) await new Promise(r => setTimeout(r, 50));
  assert.match(readFileSync(join(v, ".logs", "ernte.log"), "utf8"), /art=fakt status=ok/);
});

// ---------- Stand-Intervall im brain-hint (UserPromptSubmit) ----------
function hint(v, eingabe, extra = {}) {
  return starte(HINT, [], eingabe, basisEnv({ BRAIN_VAULT: v, BRAIN_ERNTE_SKRIPT: FAKE_ERNTE, ...extra }));
}
const STUNDE = 3600000;

test("brain-hint: Stand-Datei älter als das Intervall → Ernte --art stand, Zeitstempel erneuert; frisch → nichts", async () => {
  const v = neuerVault({ staendeIntervallStunden: 1, hinweise: "aus" }), tr = transkript();
  const marke = join(v, ".logs", "ernte", "sitzung-abc123.stand");
  mkdirSync(dirname(marke), { recursive: true }); writeFileSync(marke, "");
  const alt = new Date(Date.now() - 2 * STUNDE); utimesSync(marke, alt, alt);
  const log = join(FAKE_DIR, "d1.json");
  const r = hint(v, { ...hookEingabe(tr), prompt: "ok" }, { FAKE_ERNTE_LOG: log });
  assert.equal(r.status, 0); assert.equal(r.stdout, "");
  const lauf = await warteAuf(log);
  assert.equal(lauf?.args[1], "stand");
  assert.ok(Date.now() - (await import("node:fs")).statSync(marke).mtimeMs < 60000, "Zeitstempel erneuert");
  const log2 = join(FAKE_DIR, "d2.json");
  hint(v, { ...hookEingabe(tr), prompt: "ok" }, { FAKE_ERNTE_LOG: log2 });
  assert.ok(await sicherNichts(log2), "frischer Stand darf nicht erneut ernten");
});

test("brain-hint: Stand-Datei fehlt → Sitzungsbeginn aus erster hint.log-Zeile; ≥ Intervall → Ernte, sonst nur Startmarke", async () => {
  const tr = transkript();
  const z = (ms, sid) => `${new Date(ms).toISOString().slice(0, 19)} sid=${sid} len=40 weg=vektor top=0.100 zeichen=0 hits=- unterdrueckt=0 kalt=1 refresh=0 ms=5\n`;
  const alt = neuerVault({ staendeIntervallStunden: 2, hinweise: "aus" });
  mkdirSync(join(alt, ".logs"), { recursive: true });
  writeFileSync(join(alt, ".logs", "hint.log"), z(Date.now() - 5 * STUNDE, "andere1") + z(Date.now() - 3 * STUNDE, "sitzung-") + z(Date.now() - 60000, "sitzung-"));
  const log = join(FAKE_DIR, "e1.json");
  hint(alt, { ...hookEingabe(tr), prompt: "ok" }, { FAKE_ERNTE_LOG: log });
  assert.equal((await warteAuf(log))?.args[1], "stand");
  assert.ok(existsSync(join(alt, ".logs", "ernte", "sitzung-abc123.stand")));

  const jung = neuerVault({ staendeIntervallStunden: 2, hinweise: "aus" });
  mkdirSync(join(jung, ".logs"), { recursive: true });
  writeFileSync(join(jung, ".logs", "hint.log"), z(Date.now() - 30 * 60000, "sitzung-"));
  const log2 = join(FAKE_DIR, "e2.json");
  hint(jung, { ...hookEingabe(tr), prompt: "ok" }, { FAKE_ERNTE_LOG: log2 });
  assert.ok(await sicherNichts(log2), "junge Sitzung darf noch nicht ernten");
  assert.ok(!existsSync(join(jung, ".logs", "ernte", "sitzung-abc123.stand")), "ohne Lauf keine Stand-Datei, solange der Beginn bekannt ist");

  const ohneLog = neuerVault({ staendeIntervallStunden: 1, hinweise: "aus" }), log3 = join(FAKE_DIR, "e3.json");
  hint(ohneLog, { ...hookEingabe(tr), prompt: "ok" }, { FAKE_ERNTE_LOG: log3 });
  assert.ok(await sicherNichts(log3));
  assert.ok(existsSync(join(ohneLog, ".logs", "ernte", "sitzung-abc123.stand")), "unbekannter Beginn → Startmarke");

  const aus = neuerVault({ hinweise: "aus" }), log4 = join(FAKE_DIR, "e4.json");
  hint(aus, { ...hookEingabe(tr), prompt: "ok" }, { FAKE_ERNTE_LOG: log4 });
  assert.ok(await sicherNichts(log4)); assert.ok(!existsSync(join(aus, ".logs", "ernte")), "Intervall 0 → gar nichts");
});

// ---------- Selbstaufruf-Schutz: alle Hooks stumm bei BRAIN_ERNTE=1 ----------
test("BRAIN_ERNTE=1: alle Hooks geben nichts aus, Exit 0, starten nichts und schreiben keine Logs", async () => {
  const v = neuerVault({ ernteSitzungsende: true, staendeIntervallStunden: 1, ichKarte: true });
  mkdirSync(join(v, "09_wiki"), { recursive: true });
  writeFileSync(join(v, "09_wiki", "ich.md"), "---\nname: ich\n---\nIch gärtnere gern.\n");
  const tr = transkript(), log = join(FAKE_DIR, "f.json");
  const env = basisEnv({ BRAIN_VAULT: v, BRAIN_ERNTE: "1", BRAIN_ERNTE_SKRIPT: FAKE_ERNTE, FAKE_ERNTE_LOG: log, BRAIN_SESSION_NUR_STATUS: "1" });
  const eingabe = { ...hookEingabe(tr), prompt: "wie plane ich das gemüsebeet im frühling genau", tool_name: "Edit", tool_input: { file_path: join(v, "09_wiki", "ich.md") } };
  for (const [datei, args] of [["ernte-ausloeser.mjs", ["--art", "fakt"]], ["brain-hint.mjs", []], ["session-start.mjs", []], ["session-hintergrund.mjs", []], ["wiki-guard.mjs", []], ["werkzeug-protokoll.mjs", []]]) {
    const r = starte(join(ADAPTER, datei), args, eingabe, env);
    assert.equal(r.status, 0, `${datei}: Exit ${r.status} ${r.stderr}`);
    assert.equal(r.stdout + r.stderr, "", `${datei} gab etwas aus`);
  }
  assert.ok(await sicherNichts(log));
  assert.ok(!existsSync(join(v, ".logs")), `Logs geschrieben: ${existsSync(join(v, ".logs")) ? readdirSync(join(v, ".logs")) : ""}`);
  assert.ok(!existsSync(join(v, "AGENTS.md")), "session-hintergrund lief trotzdem");
});

test("session-start (v0.4): Wochen-Zeile nur aus dem Cache (0 Wartezeit); ohne Vorschläge/Entscheidungen, mit übernommenen Lektionen; Konfliktzeile ohne entschiedene Kästen und ohne Symlinks; nie doppelt", async (t) => {
  const { schreibeBerichtCache } = await import("../pflege.mjs");
  const { schreibeEntscheidung } = await import("../entscheidungen.mjs");
  const v = neuerVault({ projektAutomatik: false });
  mkdirSync(join(v, ".logs"), { recursive: true });
  writeFileSync(join(v, ".logs", "letzter-review"), "");
  mkdirSync(join(v, "09_wiki", "geräte"), { recursive: true });
  const kasten = (a, b) => `> [!KONFLIKT] offen — Du entscheidest\n> A: "${a}"\n> B: "${b}"\n`;
  writeFileSync(join(v, "09_wiki", "geräte", "drucker.md"), "# Drucker\n\n" + kasten("Port 1", "Port 2") + "\n" + kasten("rot", "blau"));
  const ss = () => starte(join(ADAPTER, "session-start.mjs"), [], {}, basisEnv({ BRAIN_VAULT: v, BRAIN_SESSION_NUR_STATUS: "1" }));
  // ohne Cache: keine Wochen-Zeile, keine Marke — aber die Konfliktzeile
  let r = ss();
  assert.equal(r.status, 0);
  assert.deepEqual(r.stdout.trim().split(/\r?\n/), ["Brain-Wiki: offene Konflikte auf 1 Seite(n) — Entscheidung nötig (/brain-lint)."]);
  assert.ok(!existsSync(join(v, ".logs", "pflege-woche")), "ohne Cache keine Marke");
  // beide Kästen entschieden → keine Konfliktzeile mehr (Auftrag wartet, eigene Zeile)
  schreibeEntscheidung(v, { seite: "09_wiki/geräte/drucker.md", nr: 1, wahl: "a" });
  schreibeEntscheidung(v, { seite: "09_wiki/geräte/drucker.md", nr: 2, wahl: "b" });
  r = ss();
  assert.deepEqual(r.stdout.trim().split(/\r?\n/), ["2 Entscheidungen warten auf Umsetzung — /ingest"]);
  // Symlink-Seite nach außen zählt nicht
  const aussen = mkdtempSync(join(tmpdir(), "ausloeser-aussen-"));
  writeFileSync(join(aussen, "fremd.md"), kasten("x", "y"));
  let symlinks = true;
  try { symlinkSync(join(aussen, "fremd.md"), join(v, "09_wiki", "link.md")); } catch { symlinks = false; }
  if (symlinks) assert.ok(!/offene Konflikte/.test(ss().stdout), "Symlink nach außen zählt nicht");
  // Cache mit Arbeit → genau eine Wochen-Zeile ohne Vorschläge/Entscheidungen (eigene Zeilen), aber mit übernommenen
  // Lektionen (keine eigene Zeile, Final-Review #4); Konfliktzeile entfällt
  writeFileSync(join(v, "09_wiki", "neu.md"), "# Neu\n\n" + kasten("eins", "zwei"));
  schreibeBerichtCache(v, { erstellt: "2026-10-03T00:00:00Z", zuTun: 9, posten: [
    { schluessel: "abgelaufen", anzahl: 2 }, { schluessel: "konflikte", anzahl: 1 }, { schluessel: "entscheidungen", anzahl: 2 },
    { schluessel: "vorschlaege", anzahl: 3 }, { schluessel: "lektionen", anzahl: 1 }, { schluessel: "dubletten", anzahl: 1 },
  ] });
  const t0 = Date.now();
  r = ss();
  assert.ok(Date.now() - t0 < 5000);
  const zeilen = r.stdout.trim().split(/\r?\n/);
  assert.deepEqual(zeilen, ["Brain-Woche: 2 abgelaufen · 1 Konflikt · 1 Lektion wartet — im Gehirn unter Pflege", "2 Entscheidungen warten auf Umsetzung — /ingest"], r.stdout);
  assert.ok(existsSync(join(v, ".logs", "pflege-woche")), "Marke nach Ausgabe");
  // innerhalb der Woche: wieder die Konfliktzeile statt der Wochen-Zeile
  r = ss();
  assert.match(r.stdout, /^Brain-Wiki: offene Konflikte auf 1 Seite\(n\)/m);
  assert.ok(!/Brain-Woche/.test(r.stdout));
  void t;
});
