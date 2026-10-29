// .tools/tests/test-ernte.mjs — Hintergrund-Ernte nur mit fake-claude.mjs (nie das echte claude).
// PATH zeigt auf einen leeren Temp-Ordner, HOME/USERPROFILE auf ein Temp-Home: kein echtes claude auffindbar,
// keine echten Transkripte/Configs. Das Transkript-Fixture ist erfunden.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, utimesSync, chmodSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const HIER = dirname(fileURLToPath(import.meta.url));
const FAKE = join(HIER, "fake-claude.mjs");
const ERNTE_CLI = join(HIER, "..", "ernte.mjs");

// Umgebung abschotten, BEVOR ernte.mjs geladen wird.
const LEER_PATH = mkdtempSync(join(tmpdir(), "ernte-leerer-path-"));
const TEMP_HOME = mkdtempSync(join(tmpdir(), "ernte-home-"));
// Setzen (nicht lesen) des Homes für os.homedir() — findeClaude() schaut sonst unter ~/.local/bin nach.
Object.assign(process.env, { PATH: LEER_PATH, HOME: TEMP_HOME, USERPROFILE: TEMP_HOME });
delete process.env.BRAIN_CLAUDE;
delete process.env.BRAIN_ERNTE;
for (const k of Object.keys(process.env)) if (k.startsWith("GIT_")) delete process.env[k];

const { ernte, findeClaude, auftrag, leseTranskript, parseAntwort, istAusgeschlossen, kindUmgebung, MAX_TRANSKRIPT,
  VERLAUF_KOPF, claudeArgs, leseClaudeAntwort, arbeitsOrdner } = await import("../ernte.mjs");

const FAKE_BEFEHL = { befehl: process.execPath, args: [FAKE] };
// Köder-Zugangsdaten zusammengesetzt, damit die Quelldatei selbst kein Credential-Muster trägt (publish-check).
const KOEDER_PW = ["pass", "word"].join("") + "=Koeder123";
const KOEDER_SCHLUESSEL = ["to", "ken"].join("") + "=xyz";

function neuerVault(cfg) {
  const v = mkdtempSync(join(tmpdir(), "ernte vault, Jo's Ü "));
  if (cfg) writeFileSync(join(v, "brain.config.json"), JSON.stringify(cfg));
  return v;
}
function fakeUmgebung({ ausgabe = "NICHTS\n", warte = 0, exit = 0, roh = false, ohneUsage = false } = {}) {
  const d = mkdtempSync(join(tmpdir(), "fake-claude-"));
  const aus = join(d, "ausgabe.txt");
  writeFileSync(aus, ausgabe);
  process.env.FAKE_CLAUDE_LOG = join(d, "eingabe.txt");
  process.env.FAKE_CLAUDE_AUSGABE = aus;
  process.env.FAKE_CLAUDE_WARTE = String(warte);
  process.env.FAKE_CLAUDE_EXIT = String(exit);
  process.env.FAKE_CLAUDE_ROH = roh ? "1" : "";
  process.env.FAKE_CLAUDE_OHNE_USAGE = ohneUsage ? "1" : "";
  return { log: process.env.FAKE_CLAUDE_LOG, argsLog: process.env.FAKE_CLAUDE_LOG + ".json" };
}
const zeile = (o) => JSON.stringify(o);
const nutzer = (text) => zeile({ type: "user", message: { role: "user", content: text } });
const assistent = (text) => zeile({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text }, { type: "tool_use", id: "t1", name: "Read", input: { file_path: "/x" } }] } });
const toolErgebnis = (text) => zeile({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: text }] } });

// Erfundene Sitzung: 6 echte Prompts, eine Zeile mit Zugangsdaten, ein Tool-Ergebnis, Meta-/Befehlszeilen.
function transkript({ prompts = 6, langerText = "" } = {}) {
  const d = mkdtempSync(join(tmpdir(), "ernte-transkript-"));
  const f = join(d, "sitzung.jsonl");
  const z = [
    zeile({ type: "summary", summary: "irrelevant" }),
    zeile({ type: "user", isMeta: true, message: { role: "user", content: "META-ZEILE-NIE-SENDEN" } }),
    nutzer("<command-name>/clear</command-name>"),
  ];
  for (let i = 1; i <= prompts; i++) {
    z.push(nutzer(i === 2 ? `Bitte notiere: das Testbrett läuft auf Port 4711\n${KOEDER_PW}\nund der Dienst heißt Tafelrunde.` : `Frage ${i} zum Testbrett ${langerText}`));
    z.push(i === 3 ? toolErgebnis("TOOL-ERGEBNIS-GEHEIMNIS") : assistent(`Antwort ${i}: erledigt.`));
  }
  writeFileSync(f, "\uFEFF" + z.join("\n") + "\n");
  return f;
}

test("Vorbedingung: im Test-PATH/HOME gibt es kein echtes claude; findeClaude() → null", () => {
  assert.equal(process.env.PATH, LEER_PATH);
  assert.deepEqual(readdirSync(LEER_PATH), []);
  assert.equal(findeClaude(), null);
  assert.equal(findeClaude({ plattform: "win32", pfad: LEER_PATH, home: TEMP_HOME }), null);
  assert.equal(findeClaude({ pfad: "", home: TEMP_HOME }), null);
});

test("findeClaude: Testhaken BRAIN_CLAUDE → node <skript>", () => {
  assert.deepEqual(findeClaude({ env: { BRAIN_CLAUDE: FAKE } }), { befehl: process.execPath, args: [FAKE] });
});

test("findeClaude: ausführbares claude im PATH (POSIX) wird gefunden", (t) => {
  if (process.platform === "win32") { t.skip("POSIX-Fall"); return; }
  const d = mkdtempSync(join(tmpdir(), "ernte-bin-"));
  writeFileSync(join(d, "claude"), "#!/bin/sh\nexit 0\n"); chmodSync(join(d, "claude"), 0o755);
  assert.deepEqual(findeClaude({ plattform: "darwin", pfad: `${LEER_PATH}:${d}`, env: {}, home: TEMP_HOME }), { befehl: join(d, "claude"), args: [] });
});

test("findeClaude win32: claude.cmd → Node-Einstieg des npm-Pakets, nie über eine Shell", () => {
  const d = mkdtempSync(join(tmpdir(), "ernte-win-"));
  writeFileSync(join(d, "claude.cmd"), "@echo off\r\n");
  const paket = join(d, "node_modules", "@anthropic-ai", "claude-code");
  mkdirSync(paket, { recursive: true });
  writeFileSync(join(paket, "package.json"), JSON.stringify({ name: "@anthropic-ai/claude-code", bin: { claude: "cli.js" } }));
  writeFileSync(join(paket, "cli.js"), "// erfunden\n");
  assert.deepEqual(findeClaude({ plattform: "win32", pfad: `C:\\nirgends;${d}`, env: {}, home: TEMP_HOME }), { befehl: process.execPath, args: [join(paket, "cli.js")] });
  // claude.cmd ohne Paket daneben → nicht startbar → null
  const leer = mkdtempSync(join(tmpdir(), "ernte-win-leer-"));
  writeFileSync(join(leer, "claude.cmd"), "@echo off\r\n");
  assert.equal(findeClaude({ plattform: "win32", pfad: leer, env: {}, home: TEMP_HOME }), null);
});

test("leseTranskript: nur Nutzer-/Assistenten-Text, keine Tool-Ergebnisse, keine Secret-Zeilen, Meta/Befehle zählen nicht", () => {
  const { prompts, text } = leseTranskript(transkript());
  assert.equal(prompts, 6);
  assert.ok(!text.includes("Koeder123"));
  assert.ok(!text.includes("TOOL-ERGEBNIS-GEHEIMNIS"));
  assert.ok(!text.includes("META-ZEILE"));
  assert.ok(!text.includes("command-name"));
  assert.ok(text.includes("Port 4711") && text.includes("Tafelrunde"));
  assert.ok(text.includes("Assistent: Antwort 1: erledigt."));
});

test("ernte: gesendeter Text ohne Secret/Tool-Ergebnis, ≤ 24 000 + Auftrag; 2 Vorschläge, einer mit Token-Köder → genau 1 geschrieben", async () => {
  const v = neuerVault();
  const fake = fakeUmgebung({ ausgabe: `### Testbrett-Port\nDas Testbrett läuft auf Port 4711.\nZitat: das Testbrett läuft auf Port 4711\n\n### Zugang\nDer Zugang ist ${KOEDER_SCHLUESSEL}.\n` });
  const r = await ernte(v, { art: "fakt", transkript: transkript({ langerText: "x".repeat(9000) }), sid: "sid-42", cwd: "/projekte/beispiel", claudeBefehl: FAKE_BEFEHL, jetzt: Date.UTC(2026, 9, 2, 9, 0, 0) });
  assert.equal(r.status, "ok");
  assert.equal(r.vorschlaege.length, 1);
  const gesendet = readFileSync(fake.log, "utf8");
  assert.ok(gesendet.startsWith(VERLAUF_KOPF), "stdin trägt nur den Verlauf, der Auftrag geht als Systemprompt");
  assert.ok(gesendet.length <= MAX_TRANSKRIPT + VERLAUF_KOPF.length + 1, `zu lang: ${gesendet.length}`);
  assert.ok(!gesendet.includes("Koeder123"));
  assert.ok(!gesendet.includes("TOOL-ERGEBNIS-GEHEIMNIS"));
  const { args, cwd } = JSON.parse(readFileSync(fake.argsLog, "utf8"));
  assert.deepEqual(args, ["-p", "--model", "haiku", "--tools", "", "--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}',
    "--system-prompt", auftrag("fakt"), "--no-session-persistence", "--setting-sources", "project", "--output-format", "json"]);
  assert.deepEqual(args, claudeArgs("fakt"));
  assert.ok(!cwd.startsWith(v), "Lauf im leeren Temp-Ordner, nicht im Vault");
  assert.equal(basename(cwd), basename(arbeitsOrdner(v)), "fester Arbeitsordner je Vault");
  const datei = readFileSync(join(v, "00_inbox", "_vorschlaege", `${r.vorschlaege[0]}.md`), "utf8");
  assert.match(datei, /art: fakt/);
  assert.match(datei, /quelle_ordner: "\/projekte\/beispiel"/);
  assert.match(datei, /quelle_sitzung: "sid-42"/);
  assert.match(datei, /\nzitat: "das Testbrett läuft auf Port 4711"\nherkunft: du\nfundstelle: "sid-42#\? \?"\n/);
  assert.ok(!datei.includes("xyz"));
  const log = readFileSync(join(v, ".logs", "ernte.log"), "utf8").trim().split("\n");
  assert.equal(log.length, 1);
  assert.match(log[0], /^2026-10-02T09:00:00 art=fakt status=ok ein=\d+ aus=\d+ tokEin=\d+ tokAus=\d+ vorschlaege=1 verworfen=1 ohneBeleg=0 nurKi=0$/);
  assert.ok(!existsSync(join(v, ".logs", "ernte", "lauf.lock")), "Lock wieder frei");
});

test("ernte stand: höchstens ein Vorschlag, höchstens 12 Zeilen; NICHTS → keiner", async () => {
  const v = neuerVault();
  const zeilen = Array.from({ length: 20 }, (_, i) => `- Punkt ${i + 1}`).join("\n");
  fakeUmgebung({ ausgabe: `### Stand Testbrett\n${zeilen}\nZitat: Frage 1 zum Testbrett\n\n### Zweiter\nwird ignoriert\n` });
  const r = await ernte(v, { art: "stand", transkript: transkript(), sid: "s", cwd: "/p", claudeBefehl: FAKE_BEFEHL });
  assert.equal(r.status, "ok");
  assert.equal(r.vorschlaege.length, 1);
  const datei = readFileSync(join(v, "00_inbox", "_vorschlaege", `${r.vorschlaege[0]}.md`), "utf8");
  assert.ok(datei.includes("- Punkt 12") && !datei.includes("- Punkt 13"));
  fakeUmgebung({ ausgabe: "NICHTS\n" });
  const r2 = await ernte(v, { art: "stand", transkript: transkript(), sid: "s", cwd: "/p", claudeBefehl: FAKE_BEFEHL });
  assert.deepEqual(r2, { status: "ok", vorschlaege: [] });
});

test("ernte: cwd in ernteNichtIn → übersprungen, fake-claude nie aufgerufen", async () => {
  const firma = mkdtempSync(join(tmpdir(), "ernte-firma-"));
  const v = neuerVault({ automatik: { ernteNichtIn: [firma.split("\\").join("/") + "/"] } });
  const fake = fakeUmgebung({ ausgabe: "### X\nY\n" });
  const r = await ernte(v, { art: "fakt", transkript: transkript(), sid: "s", cwd: join(firma, "unterordner"), claudeBefehl: FAKE_BEFEHL });
  assert.deepEqual(r, { status: "uebersprungen", grund: "ausgeschlossener Ordner", vorschlaege: [] });
  assert.ok(!existsSync(fake.log));
  assert.ok(!existsSync(join(v, "00_inbox")));
});

test("istAusgeschlossen: Präfix nur an Ordnergrenze, / und \\ gleich, Groß/klein auf darwin/win32 egal", () => {
  assert.equal(istAusgeschlossen("C:\\Kunden\\Akte", ["c:/kunden"], { plattform: "win32" }), true);
  assert.equal(istAusgeschlossen("C:\\KundenAlt\\x", ["C:/Kunden"], { plattform: "win32" }), false);
  assert.equal(istAusgeschlossen("/Users/USER/Firma/a", ["/users/user/firma"], { plattform: "darwin" }), true);
  assert.equal(istAusgeschlossen("/home/USER/Firma/a", ["/home/USER/firma"], { plattform: "linux" }), false);
  assert.equal(istAusgeschlossen("/x", [], {}), false);
  assert.equal(istAusgeschlossen("/x", [""], {}), false);
});

test("ernte: weniger als 5 Prompts → übersprungen, kein Aufruf", async () => {
  const v = neuerVault();
  const fake = fakeUmgebung();
  const r = await ernte(v, { art: "fakt", transkript: transkript({ prompts: 4 }), sid: "s", cwd: "/p", claudeBefehl: FAKE_BEFEHL });
  assert.equal(r.status, "uebersprungen");
  assert.ok(!existsSync(fake.log));
});

test("ernte: BRAIN_ERNTE=1 in der eigenen Umgebung → sofort übersprungen", async () => {
  const v = neuerVault();
  const fake = fakeUmgebung();
  process.env.BRAIN_ERNTE = "1";
  try {
    const r = await ernte(v, { art: "fakt", transkript: transkript(), sid: "s", cwd: "/p", claudeBefehl: FAKE_BEFEHL });
    assert.equal(r.status, "uebersprungen");
  } finally { delete process.env.BRAIN_ERNTE; }
  assert.ok(!existsSync(fake.log));
});

test("ernte: zweimal parallel → einer läuft, der andere „läuft schon“", async () => {
  const v = neuerVault();
  fakeUmgebung({ ausgabe: "### A\nB\n", warte: 400 });
  const opt = { art: "fakt", transkript: transkript(), sid: "s", cwd: "/p", claudeBefehl: FAKE_BEFEHL };
  const [a, b] = await Promise.all([ernte(v, opt), ernte(v, opt)]);
  const status = [a, b].map(x => x.grund ? `${x.status}:${x.grund}` : x.status).sort();
  assert.deepEqual(status, ["ok", "uebersprungen:läuft schon"]);
});

test("ernte: altes Lock (> 5 min) wird übernommen", async () => {
  const v = neuerVault();
  fakeUmgebung({ ausgabe: "### A\nB\n" });
  const lock = join(v, ".logs", "ernte", "lauf.lock");
  mkdirSync(dirname(lock), { recursive: true });
  writeFileSync(lock, "999999\n");
  const alt = (Date.now() - 10 * 60 * 1000) / 1000;
  utimesSync(lock, alt, alt);
  const r = await ernte(v, { art: "fakt", transkript: transkript(), sid: "s", cwd: "/p", claudeBefehl: FAKE_BEFEHL });
  assert.equal(r.status, "ok");
});

test("ernte: fake-claude Exit 1 → status fehler, kein Vorschlag, ernte.log-Zeile", async () => {
  const v = neuerVault();
  fakeUmgebung({ ausgabe: "### A\nB\n", exit: 1 });
  const r = await ernte(v, { art: "stand", transkript: transkript(), sid: "s", cwd: "/p", claudeBefehl: FAKE_BEFEHL });
  assert.equal(r.status, "fehler");
  assert.deepEqual(r.vorschlaege, []);
  assert.ok(!existsSync(join(v, "00_inbox", "_vorschlaege")));
  const log = readFileSync(join(v, ".logs", "ernte.log"), "utf8");
  assert.match(log, /art=stand status=fehler ein=\d+ aus=0/);
});

test("ernte: kein claude gefunden → fehler, Log-Zeile, nichts geschrieben", async () => {
  const v = neuerVault();
  assert.equal(findeClaude(), null, "Sicherung: nie ein echtes claude starten");
  const r = await ernte(v, { art: "fakt", transkript: transkript(), sid: "s", cwd: "/p" });
  assert.equal(r.status, "fehler");
  assert.match(readFileSync(join(v, ".logs", "ernte.log"), "utf8"), /status=fehler/);
});

test("parseAntwort: höchstens 5 Fakten, Titel ≤ 60 Zeichen, NICHTS → leer", () => {
  const viele = Array.from({ length: 7 }, (_, i) => `### Titel ${i} ${"z".repeat(80)}\nText ${i}`).join("\n\n");
  const r = parseAntwort(viele, "fakt");
  assert.equal(r.length, 5);
  assert.ok(r.every(x => x.titel.length <= 60));
  assert.deepEqual(parseAntwort("NICHTS", "fakt"), []);
  assert.deepEqual(parseAntwort("", "fakt"), []);
});

test("CLI: --art/--transkript/--sid/--cwd + Vault-Pfad mit Leerzeichen; BRAIN_CLAUDE-Haken, keine Ausgabe", () => {
  const v = neuerVault();
  const fake = fakeUmgebung({ ausgabe: "### CLI-Fakt\nKommt über die Kommandozeile.\nZitat: Frage 3 zum Testbrett\n" });
  const env = { ...process.env, BRAIN_CLAUDE: FAKE, PATH: LEER_PATH, HOME: TEMP_HOME, USERPROFILE: TEMP_HOME };
  delete env.BRAIN_ERNTE;
  const r = spawnSync(process.execPath, [ERNTE_CLI, "--art", "fakt", "--transkript", transkript(), "--sid", "sid-cli", "--cwd", "/projekte/cli", v], { env, encoding: "utf8", windowsHide: true });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, "");
  assert.ok(existsSync(fake.log));
  const dateien = readdirSync(join(v, "00_inbox", "_vorschlaege"));
  assert.equal(dateien.length, 1);
  assert.match(readFileSync(join(v, "00_inbox", "_vorschlaege", dateien[0]), "utf8"), /CLI-Fakt/);
});

// ---------- W1-Fix: gängige Zugangsdaten, fail-closed, Sitzungsvariablen ----------

// Köder wie im Review-Szenario — alle zur Laufzeit zusammengesetzt (publish-check sieht kein Muster).
const j = (...t) => t.join("");
const KOEDER = {
  pw: j("Mein Pass", "wort lautet: ", "Wiesel", "4711!"),
  kw: j("Das Ken", "nwort ist ", "Hundekuchen", "77"),
  skAnt: j("sk-", "ant-", "api03-", "Qw3rTy9UiOp1AsDf"),
  aws: j("AK", "IA", "QWERTYUIOP123456"),
  gh: j("gh", "p_", "Z9".repeat(18)),
  pemKopf: j("-----BEGIN ", "OPENSSH PRIVATE", " KEY-----"),
  pemRumpf: "b3BlbnNzaC1rZXktdjEAAAAAPEMRUMPF",
  pemFuss: j("-----END ", "OPENSSH PRIVATE", " KEY-----"),
};
function koederTranskript() {
  const d = mkdtempSync(join(tmpdir(), "ernte-koeder-"));
  const f = join(d, "sitzung.jsonl");
  const z = [];
  for (let i = 1; i <= 6; i++) {
    z.push(nutzer(i === 2
      ? [KOEDER.pw, KOEDER.kw, `nimm ${KOEDER.skAnt}`, KOEDER.aws, KOEDER.gh, KOEDER.pemKopf, KOEDER.pemRumpf, KOEDER.pemFuss, "Der Server heißt Mondstein."].join("\n")
      : `Frage ${i} zum Mondstein`));
    z.push(assistent(`Antwort ${i}.`));
  }
  writeFileSync(f, z.join("\n") + "\n");
  return f;
}

test("ernte: Passwort/Kennwort/sk-ant/AKIA/ghp_/ganzer Private-Key-Block → nie gesendet, nie im Vorschlag", async () => {
  const v = neuerVault();
  const fake = fakeUmgebung({ ausgabe: `### Zugang\n${KOEDER.pw}\n\n### Schlüssel\nNimm ${KOEDER.skAnt}.\n\n### Mondstein\nDer Server heißt Mondstein.\nZitat: Der Server heißt Mondstein.\n` });
  const r = await ernte(v, { art: "fakt", transkript: koederTranskript(), sid: "s", cwd: "/p", claudeBefehl: FAKE_BEFEHL });
  assert.equal(r.status, "ok");
  const gesendet = readFileSync(fake.log, "utf8");
  for (const wert of ["Wiesel", "Hundekuchen", "Qw3rTy9UiOp1AsDf", "QWERTYUIOP123456", "Z9Z9Z9", "PEMRUMPF", "PRIVATE"]) {
    assert.ok(!gesendet.includes(wert), `gesendet: ${wert}`);
  }
  assert.ok(gesendet.includes("Mondstein"));
  assert.equal(r.vorschlaege.length, 1);
  const dir = join(v, "00_inbox", "_vorschlaege");
  const alles = readdirSync(dir).map(n => readFileSync(join(dir, n), "utf8")).join("\n");
  assert.ok(!alles.includes("Wiesel") && !alles.includes("Qw3rTy9UiOp1AsDf"));
  assert.match(readFileSync(join(v, ".logs", "ernte.log"), "utf8"), /vorschlaege=1 verworfen=2/);
});

test("ernte fail-closed: leeres oder relatives cwd → übersprungen „Ordner unbekannt“, kein Aufruf", async () => {
  const v = neuerVault({ automatik: { ernteNichtIn: ["/irgendwo/kunde"] } });
  const fake = fakeUmgebung({ ausgabe: "### X\nY\n" });
  for (const cwd of ["", "relativ/ordner"]) {
    const r = await ernte(v, { art: "fakt", transkript: transkript(), sid: "s", cwd, claudeBefehl: FAKE_BEFEHL });
    assert.deepEqual(r, { status: "uebersprungen", grund: "Ordner unbekannt", vorschlaege: [] });
  }
  assert.ok(!existsSync(fake.log));
});

test("ernte fail-closed: kaputte brain.config.json → übersprungen „Config nicht lesbar“, kein Aufruf", async () => {
  const v = neuerVault();
  writeFileSync(join(v, "brain.config.json"), '{"automatik": {"ernteNichtIn": ["/kunde"]');
  const fake = fakeUmgebung({ ausgabe: "### X\nY\n" });
  const r = await ernte(v, { art: "fakt", transkript: transkript(), sid: "s", cwd: "/kunde/akte", claudeBefehl: FAKE_BEFEHL });
  assert.deepEqual(r, { status: "uebersprungen", grund: "Config nicht lesbar", vorschlaege: [] });
  assert.ok(!existsSync(fake.log));
  assert.ok(!existsSync(join(v, "00_inbox")));
});

test("kindUmgebung: Sitzungsvariablen der Eltern-Sitzung fallen weg, Konfiguration und PATH bleiben, BRAIN_ERNTE=1", () => {
  const ein = {
    PATH: "/bin", CLAUDECODE: "1", CLAUDE_PID: "1", CLAUDE_CODE_SESSION_ID: "a", CLAUDE_CODE_ENTRYPOINT: "cli",
    CLAUDE_CODE_MESSAGING_SOCKET: "x", CLAUDE_CODE_SSE_PORT: "1", GIT_DIR: "/x",
    CLAUDE_CODE_USE_BEDROCK: "1", ANTHROPIC_MODEL: "m", CLAUDE_CODE_GIT_BASH_PATH: "b",
  };
  const aus = kindUmgebung(ein);
  assert.deepEqual(Object.keys(aus).sort(), ["ANTHROPIC_MODEL", "BRAIN_ERNTE", "CLAUDE_CODE_GIT_BASH_PATH", "CLAUDE_CODE_USE_BEDROCK", "PATH"]);
  assert.equal(aus.BRAIN_ERNTE, "1");
});

// ---------- Final-Review #2/#3/#5/#9 ----------

test("leseClaudeAntwort: JSON mit result/usage → Text + Token (inkl. Cache); ohne usage → keine Token; kein JSON → Rohtext; is_error → Fehler", () => {
  assert.deepEqual(leseClaudeAntwort(JSON.stringify({ result: "### A\nB", usage: { input_tokens: 10, cache_read_input_tokens: 5, cache_creation_input_tokens: 2, output_tokens: 3 } })),
    { text: "### A\nB", tokens: { ein: 17, aus: 3 }, fehler: null });
  assert.deepEqual(leseClaudeAntwort(JSON.stringify({ result: "NICHTS" })), { text: "NICHTS", tokens: null, fehler: null });
  assert.deepEqual(leseClaudeAntwort(JSON.stringify({ usage: { output_tokens: 2 } })), { text: "", tokens: { ein: 0, aus: 2 }, fehler: null });
  assert.deepEqual(leseClaudeAntwort("### Roh\nText"), { text: "### Roh\nText", tokens: null, fehler: null });
  assert.deepEqual(leseClaudeAntwort("[1,2]"), { text: "[1,2]", tokens: null, fehler: null });
  assert.equal(leseClaudeAntwort(JSON.stringify({ is_error: true, result: "kaputt" })).fehler, "claude meldet Fehler");
});

test("ernte: Ausgabe ohne JSON oder ohne usage → trotzdem Vorschläge, Log nur mit Zeichen (kein tokEin)", async () => {
  for (const art of [{ roh: true }, { ohneUsage: true }]) {
    const v = neuerVault();
    fakeUmgebung({ ausgabe: "### Fakt\nText.\nZitat: Frage 1 zum Testbrett\n", ...art });
    const r = await ernte(v, { art: "fakt", transkript: transkript(), sid: "s", cwd: "/p", claudeBefehl: FAKE_BEFEHL });
    assert.equal(r.status, "ok"); assert.equal(r.vorschlaege.length, 1);
    const log = readFileSync(join(v, ".logs", "ernte.log"), "utf8");
    assert.match(log, /status=ok ein=\d+ aus=\d+ vorschlaege=1/); assert.ok(!log.includes("tokEin"));
  }
});

function anhaengen(f, prompts, wort) {
  const z = [];
  for (let i = 1; i <= prompts; i++) { z.push(nutzer(`${wort} Frage ${i}`)); z.push(assistent(`${wort} Antwort ${i}.`)); }
  writeFileSync(f, readFileSync(f, "utf8") + z.join("\n") + "\n");
}

test("fakt je Sitzung: Marke erst nach Erfolg, mit Transkript-Stand; Folgelauf erntet nur den neuen Teil; nichts Neues → übersprungen", async () => {
  const v = neuerVault(), tr = transkript();
  const marke = join(v, ".logs", "ernte", "sid-x.fakt");
  // Fehlschlag (Exit 1) setzt keine Marke
  fakeUmgebung({ ausgabe: "### A\nB\n", exit: 1 });
  assert.equal((await ernte(v, { art: "fakt", transkript: tr, sid: "sid-x", cwd: "/p", claudeBefehl: FAKE_BEFEHL })).status, "fehler");
  assert.ok(!existsSync(marke), "keine Marke nach Fehler");
  let fake = fakeUmgebung({ ausgabe: "### Erster\nTeil.\nZitat: Frage 1 zum Testbrett\n" });
  assert.equal((await ernte(v, { art: "fakt", transkript: tr, sid: "sid-x", cwd: "/p", claudeBefehl: FAKE_BEFEHL })).status, "ok");
  assert.ok(existsSync(marke));
  assert.equal(JSON.parse(readFileSync(marke, "utf8")).bis, readFileSync(tr).length);
  fake = fakeUmgebung({ ausgabe: "### Zweiter\nTeil.\nZitat: Spaeter Frage 2\n" });
  assert.deepEqual(await ernte(v, { art: "fakt", transkript: tr, sid: "sid-x", cwd: "/p", claudeBefehl: FAKE_BEFEHL }), { status: "uebersprungen", grund: "nichts Neues", vorschlaege: [] });
  assert.ok(!existsSync(fake.log), "ohne neuen Teil kein Aufruf");
  anhaengen(tr, 2, "Spaeter");
  const r = await ernte(v, { art: "fakt", transkript: tr, sid: "sid-x", cwd: "/p", claudeBefehl: FAKE_BEFEHL });
  assert.equal(r.status, "ok"); assert.equal(r.vorschlaege.length, 1);
  const gesendet = readFileSync(fake.log, "utf8");
  assert.ok(gesendet.includes("Spaeter Frage 2") && !gesendet.includes("Frage 1 zum Testbrett"), "nur der neue Teil");
  assert.equal(JSON.parse(readFileSync(marke, "utf8")).bis, readFileSync(tr).length);
});

test("Auftrags-Marke: nach ok/übersprungen/fehler entfernt, bei „läuft schon“ bleibt sie liegen; fremde Namen werden nie gelöscht", async () => {
  const v = neuerVault();
  const offen = join(v, ".logs", "ernte", "offen");
  mkdirSync(offen, { recursive: true });
  const marke = (n) => { writeFileSync(join(offen, n), "{}"); return n; };
  fakeUmgebung({ ausgabe: "NICHTS\n" });
  await ernte(v, { art: "fakt", transkript: transkript(), sid: "a", cwd: "/p", claudeBefehl: FAKE_BEFEHL, auftragsMarke: marke("a.json") });
  assert.ok(!existsSync(join(offen, "a.json")), "ok → entfernt");
  await ernte(v, { art: "fakt", transkript: transkript({ prompts: 2 }), sid: "b", cwd: "/p", claudeBefehl: FAKE_BEFEHL, auftragsMarke: marke("b.json") });
  assert.ok(!existsSync(join(offen, "b.json")), "zu kurz → entfernt");
  writeFileSync(join(v, ".logs", "ernte", "lauf.lock"), "1\n");
  const r = await ernte(v, { art: "fakt", transkript: transkript(), sid: "c", cwd: "/p", claudeBefehl: FAKE_BEFEHL, auftragsMarke: marke("c.json") });
  assert.equal(r.grund, "läuft schon");
  assert.ok(existsSync(join(offen, "c.json")), "läuft schon → bleibt für später");
  writeFileSync(join(v, "fremd.json"), "{}");
  await ernte(v, { art: "fakt", transkript: transkript(), sid: "d", cwd: "/p", claudeBefehl: FAKE_BEFEHL, auftragsMarke: "../../../fremd.json" });
  assert.ok(existsSync(join(v, "fremd.json")));
});

test("fester Arbeitsordner: je Vault derselbe Pfad, nach dem Lauf wieder weg; anderer Vault → anderer Ordner", async () => {
  const v = neuerVault(), w = neuerVault();
  assert.equal(arbeitsOrdner(v), arbeitsOrdner(v));
  assert.notEqual(arbeitsOrdner(v), arbeitsOrdner(w));
  const fake = fakeUmgebung({ ausgabe: "NICHTS\n" });
  await ernte(v, { art: "stand", transkript: transkript(), sid: "s", cwd: "/p", claudeBefehl: FAKE_BEFEHL });
  const erst = JSON.parse(readFileSync(fake.argsLog, "utf8")).cwd;
  await ernte(v, { art: "stand", transkript: transkript(), sid: "s", cwd: "/p", claudeBefehl: FAKE_BEFEHL });
  assert.equal(JSON.parse(readFileSync(fake.argsLog, "utf8")).cwd, erst);
  assert.ok(!existsSync(arbeitsOrdner(v)), "aufgeräumt");
});

// v0.4: gemeinsame Helfer ohne Verhaltensänderung der Ernte.
test("Helfer (v0.4): claudeArgs = haikuArgs(auftrag), arbeitsOrdner ohne Zweck unverändert, mit Zweck eigener Ordner", async () => {
  const E = await import("../ernte.mjs");
  for (const art of ["stand", "fakt"]) assert.deepEqual(E.claudeArgs(art), E.haikuArgs(E.auftrag(art)));
  const v = neuerVault({});
  assert.match(basename(E.arbeitsOrdner(v)), /^brain-ernte-[0-9a-f]{12}$/);
  assert.equal(E.arbeitsOrdner(v, ""), E.arbeitsOrdner(v));
  assert.equal(basename(E.arbeitsOrdner(v, "lektion")), `${basename(E.arbeitsOrdner(v))}-lektion`);
  assert.notEqual(E.arbeitsOrdner(v, "pflege"), E.arbeitsOrdner(v, "lektion"));
  assert.equal(typeof E.rufeHaiku, "function"); assert.equal(typeof E.leseEnde, "function"); assert.equal(typeof E.nimmLock, "function");
});
