import { nodeBefehl } from "../pfade.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const inst = fileURLToPath(new URL("../adapters/claude-code/install.mjs", import.meta.url));
const lauf = (v, h) => execFileSync(process.execPath, [inst, v, "--claude-home", h], { encoding: "utf8" });
const setup = () => { const h = mkdtempSync(join(tmpdir(), "ch-")), v = mkdtempSync(join(tmpdir(), "v ")); writeFileSync(join(v, "brain.config.json"), "{}");
  writeFileSync(join(h, "settings.json"), JSON.stringify({ model: "x", hooks: { Stop: [{ hooks: [{ type: "command", command: "afplay glass" }] }],
    SessionStart: [{ hooks: [{ type: "command", command: "fremd.sh" }] }] } })); return { h, v }; };

test("ergänzt, ersetzt nicht, legt Backup an", () => {
  const { h, v } = setup(); lauf(v, h);
  const s = JSON.parse(readFileSync(join(h, "settings.json"), "utf8"));
  assert.equal(s.model, "x");
  assert.ok(s.hooks.Stop[0].hooks[0].command === "afplay glass");
  const ss = s.hooks.SessionStart.flatMap(x => x.hooks.map(y => y.command));
  assert.ok(ss.includes("fremd.sh") && ss.some(c => c.includes("/.tools/adapters/claude-code/session-start.mjs")));
  for (const e of ["UserPromptSubmit", "PreToolUse"]) assert.ok(s.hooks[e].some(x => x.hooks.some(y => y.command.includes("/.tools/adapters/claude-code/"))), e);
  assert.equal(readdirSync(h).filter(f => f.startsWith("settings.json.bak-")).length, 1);
  assert.ok(readdirSync(join(h, "commands")).includes("ingest.md"));
});
test("zweiter Lauf ist ohne Änderung", () => {
  const { h, v } = setup(); lauf(v, h); const vorher = readFileSync(join(h, "settings.json"), "utf8");
  assert.match(lauf(v, h), /unverändert/);
  assert.equal(readFileSync(join(h, "settings.json"), "utf8"), vorher);
  assert.equal(readdirSync(h).filter(f => f.startsWith("settings.json.bak-")).length, 1);
});
test("Vault-Pfad mit Leerzeichen wird gequotet", () => {
  const { h, v } = setup(); lauf(v, h);
  const cmd = JSON.parse(readFileSync(join(h, "settings.json"), "utf8")).hooks.UserPromptSubmit[0].hooks[0].command;
  assert.ok(cmd.includes(`"${v.split("\\").join("/")}/.tools/adapters/claude-code/brain-hint.mjs"`), cmd);
});

test("kaputtes settings.json: Exit 1, nichts geändert, kein Stacktrace", () => {
  const { h, v } = setup();
  const pfad = join(h, "settings.json");
  writeFileSync(pfad, "{ kaputt");
  const vorher = readFileSync(pfad, "utf8");
  let err = "", status = 0;
  try { lauf(v, h); assert.fail("hätte mit Exit 1 abbrechen müssen"); }
  catch (e) { status = e.status; err = String(e.stderr || ""); }
  assert.equal(status, 1);
  assert.match(err, /kein gültiges JSON/);
  assert.doesNotMatch(err, /^\s*at /m, `Stacktrace im stderr: ${err}`);
  assert.doesNotMatch(err, /SyntaxError/);
  assert.equal(readFileSync(pfad, "utf8"), vorher);
  assert.equal(readdirSync(h).filter(f => f.startsWith("settings.json.bak-")).length, 0);
});

test("kaputtes settings.json + fremder Command commands/ingest.md (Fix round 2 — Regression aus Round 1): Exit 1, Command UND settings.json byte-identisch, kein Backup irgendwo", () => {
  const { h, v } = setup();
  const pfad = join(h, "settings.json");
  writeFileSync(pfad, "{ kaputt");
  const vorherSettings = readFileSync(pfad, "utf8");
  const cmdDir = join(h, "commands");
  mkdirSync(cmdDir, { recursive: true });
  const ingestPfad = join(cmdDir, "ingest.md");
  const vorherIngest = "# Mein eigener Ingest-Command\nNicht von brain-kit, keine Marke.\n";
  writeFileSync(ingestPfad, vorherIngest);
  let err = "", status = 0;
  try { lauf(v, h); assert.fail("hätte mit Exit 1 abbrechen müssen"); }
  catch (e) { status = e.status; err = String(e.stderr || ""); }
  assert.equal(status, 1);
  assert.match(err, /kein gültiges JSON/);
  assert.doesNotMatch(err, /^\s*at /m, `Stacktrace im stderr: ${err}`);
  assert.equal(readFileSync(pfad, "utf8"), vorherSettings, "settings.json muss unverändert bleiben");
  assert.equal(readFileSync(ingestPfad, "utf8"), vorherIngest, "der fremde Command darf nicht angefasst werden — settings.json wird zuerst geprüft");
  assert.equal(readdirSync(h).filter(f => f.startsWith("settings.json.bak-")).length, 0);
  assert.equal(readdirSync(cmdDir).filter(f => f.startsWith("ingest.md.bak-")).length, 0, "kein Backup des fremden Commands");
});

test("ersetzt ältere Brain-Hooks derselben Vault statt zu duplizieren (.sh/.mjs, quotiert/unquotiert)", () => {
  const h = mkdtempSync(join(tmpdir(), "ch-"));
  const v = mkdtempSync(join(tmpdir(), "v2 "));
  writeFileSync(join(v, "brain.config.json"), "{}");
  const vf = v.split("\\").join("/");
  writeFileSync(join(h, "settings.json"), JSON.stringify({
    hooks: {
      SessionStart: [
        { hooks: [{ type: "command", command: `node "${vf}/.tools/session-start.mjs"` }] },
        { hooks: [{ type: "command", command: "fremd.sh" }] },
      ],
      UserPromptSubmit: [{ hooks: [{ type: "command", command: `node ${vf}/.tools/brain-hint.mjs` }] }],
      PreToolUse: [{ matcher: "Edit", hooks: [{ type: "command", command: `node "${vf}/.tools/wiki-guard.sh"` }] }],
    },
    statusLine: { type: "command", command: `node "${vf}/.tools/statusline.sh"` },
  }));
  const out = lauf(v, h);
  assert.match(out, /~ Hook PreToolUse ersetzt \(alte Fassung, matcher angepasst\)/, out);
  const s = JSON.parse(readFileSync(join(h, "settings.json"), "utf8"));
  for (const e of ["SessionStart", "UserPromptSubmit", "PreToolUse"]) {
    const cmds = s.hooks[e].flatMap(x => x.hooks.map(y => y.command));
    assert.equal(cmds.filter(c => c.includes("/.tools/adapters/claude-code/")).length, 1, `${e}: ${JSON.stringify(cmds)}`);
  }
  const sessionCmds = s.hooks.SessionStart.flatMap(x => x.hooks.map(y => y.command));
  assert.ok(sessionCmds.includes("fremd.sh"), "fremder Hook im selben Event muss überleben");
  assert.ok(s.statusLine.command.includes("/.tools/adapters/claude-code/statusline.mjs"));
  assert.equal(s.hooks.PreToolUse[0].matcher, "Edit|Write|MultiEdit|NotebookEdit", "matcher muss beim Ersetzen auf den Zielwert gesetzt werden");
  assert.match(lauf(v, h), /unverändert/);
});

test("alter PreToolUse-Eintrag mit schon korrektem matcher: kein 'matcher angepasst' im Log", () => {
  const h = mkdtempSync(join(tmpdir(), "ch-"));
  const v = mkdtempSync(join(tmpdir(), "v5 "));
  writeFileSync(join(v, "brain.config.json"), "{}");
  const vf = v.split("\\").join("/");
  writeFileSync(join(h, "settings.json"), JSON.stringify({
    hooks: { PreToolUse: [{ matcher: "Edit|Write|MultiEdit|NotebookEdit", hooks: [{ type: "command", command: `node "${vf}/.tools/wiki-guard.sh"` }] }] },
  }));
  const out = lauf(v, h);
  assert.match(out, /~ Hook PreToolUse ersetzt \(alte Fassung\)$/m, out);
  assert.doesNotMatch(out, /matcher angepasst/, out);
});

test("entfernt veraltete Brain-Hooks, auch wenn schon ein aktueller Eintrag existiert", () => {
  const h = mkdtempSync(join(tmpdir(), "ch-"));
  const v = mkdtempSync(join(tmpdir(), "v6 "));
  writeFileSync(join(v, "brain.config.json"), "{}");
  const vf = v.split("\\").join("/");
  const aktuell = `node "${vf}/.tools/adapters/claude-code/session-start.mjs"`;
  writeFileSync(join(h, "settings.json"), JSON.stringify({
    hooks: {
      SessionStart: [
        { hooks: [{ type: "command", command: aktuell }] },
        { hooks: [{ type: "command", command: `node "${vf}/.tools/session-start.sh"` }] },
        { hooks: [{ type: "command", command: "fremd.sh" }] },
      ],
    },
  }));
  const out = lauf(v, h);
  assert.match(out, /- Hook SessionStart entfernt \(alte Fassung\)/, out);
  const s = JSON.parse(readFileSync(join(h, "settings.json"), "utf8"));
  const cmds = s.hooks.SessionStart.flatMap(x => x.hooks.map(y => y.command));
  assert.equal(cmds.filter(c => c.includes("/.tools/adapters/claude-code/")).length, 1, JSON.stringify(cmds));
  assert.ok(cmds.includes("fremd.sh"), "fremder Hook im selben Event muss überleben");
  assert.ok(!cmds.some(c => c.includes("/.tools/session-start.sh")), "veralteter Eintrag muss weg sein");
  assert.equal(s.hooks.SessionStart.length, 2, "leer gewordener Eintrag muss entfernt werden");
  assert.match(lauf(v, h), /unverändert/);
});

test("ersetzt die $HOME/brain-Schreibweise, wenn Vault == homedir()/brain", () => {
  const H = mkdtempSync(join(tmpdir(), "home-"));
  const v = join(H, "brain");
  mkdirSync(v, { recursive: true });
  writeFileSync(join(v, "brain.config.json"), "{}");
  const h = mkdtempSync(join(tmpdir(), "ch-"));
  writeFileSync(join(h, "settings.json"), JSON.stringify({
    hooks: { SessionStart: [{ hooks: [{ type: "command", command: 'node "$HOME/brain/.tools/session-start.mjs"' }] }] },
  }));
  execFileSync(process.execPath, [inst, v, "--claude-home", h], { encoding: "utf8", env: { ...process.env, HOME: H, USERPROFILE: H } }); // Windows: homedir() liest USERPROFILE
  const s = JSON.parse(readFileSync(join(h, "settings.json"), "utf8"));
  const cmds = s.hooks.SessionStart.flatMap(x => x.hooks.map(y => y.command));
  assert.equal(cmds.filter(c => c.includes("/.tools/adapters/claude-code/")).length, 1, JSON.stringify(cmds));
  assert.ok(!cmds.some(c => c.includes("$HOME/brain/.tools/session-start.mjs")), "alte $HOME-Form noch vorhanden");
});

test("~/.claude/commands existiert als reguläre Datei statt als Ordner: Exit 1, ein Alltagssatz, settings.json unverändert, kein Backup, kein Stacktrace", () => {
  const { h, v } = setup();
  const pfad = join(h, "settings.json");
  const vorher = readFileSync(pfad, "utf8");
  writeFileSync(join(h, "commands"), "ich bin eine Datei, kein Ordner");
  let err = "", status = 0;
  try { lauf(v, h); assert.fail("hätte mit Exit 1 abbrechen müssen"); }
  catch (e) { status = e.status; err = String(e.stderr || ""); }
  assert.equal(status, 1);
  assert.doesNotMatch(err, /^\s*at /m, `Stacktrace im stderr: ${err}`);
  assert.doesNotMatch(err, /Error:|ENOTDIR|EEXIST/);
  assert.equal(err.trim().split("\n").length, 1, `genau EIN Alltagssatz erwartet: ${JSON.stringify(err)}`);
  assert.equal(readFileSync(pfad, "utf8"), vorher, "settings.json darf unverändert bleiben");
  assert.equal(readdirSync(h).filter(f => f.startsWith("settings.json.bak-")).length, 0);
  assert.equal(readFileSync(join(h, "commands"), "utf8"), "ich bin eine Datei, kein Ordner", "die Datei commands darf nicht angefasst werden");
});

test("unerwartet kaputte Hook-Struktur (hooks:42 statt Array): Exit 1, Alltagssatz ohne Stacktrace, nichts geschrieben", () => {
  const { h, v } = setup();
  const pfad = join(h, "settings.json");
  const vorAlles = JSON.stringify({ hooks: { UserPromptSubmit: [{ hooks: 42 }] } });
  writeFileSync(pfad, vorAlles);
  let err = "", status = 0;
  try { lauf(v, h); assert.fail("hätte mit Exit 1 abbrechen müssen"); }
  catch (e) { status = e.status; err = String(e.stderr || ""); }
  assert.equal(status, 1);
  assert.doesNotMatch(err, /^\s*at /m, `Stacktrace im stderr: ${err}`);
  assert.doesNotMatch(err, /TypeError/);
  assert.ok(err.trim().length > 0, "muss einen Alltagssatz melden");
  assert.equal(readFileSync(pfad, "utf8"), vorAlles, "darf bei unerwartetem Fehler nichts geschrieben haben");
  assert.equal(readdirSync(h).filter(f => f.startsWith("settings.json.bak-")).length, 0);
});

test("fremder Hook ohne command (type:'prompt') neben altem Brain-Eintrag: Installer stürzt nicht ab, prompt-Hook bleibt unverändert", () => {
  const h = mkdtempSync(join(tmpdir(), "ch-"));
  const v = mkdtempSync(join(tmpdir(), "v7 "));
  writeFileSync(join(v, "brain.config.json"), "{}");
  const vf = v.split("\\").join("/");
  const promptHook = { type: "prompt", prompt: "Denk dran, höflich zu bleiben." };
  writeFileSync(join(h, "settings.json"), JSON.stringify({
    hooks: {
      UserPromptSubmit: [
        { hooks: [{ type: "command", command: `node "${vf}/.tools/brain-hint.mjs"` }] }, // alter Brain-Eintrag
        { hooks: [promptHook] }, // fremder Hook ohne command-Feld
      ],
    },
  }));
  const out = lauf(v, h); // darf nicht werfen/abstürzen (kein TypeError auf h.command.includes)
  assert.doesNotMatch(out, /^\s*at /m, out);
  const s = JSON.parse(readFileSync(join(h, "settings.json"), "utf8"));
  const eintraege = s.hooks.UserPromptSubmit;
  const promptEintrag = eintraege.flatMap(x => x.hooks).find(x => x.type === "prompt");
  assert.deepEqual(promptEintrag, promptHook, "fremder prompt-Hook muss unverändert bleiben");
  const cmds = eintraege.flatMap(x => x.hooks).filter(x => typeof x.command === "string").map(x => x.command);
  assert.equal(cmds.filter(c => c.includes("/.tools/adapters/claude-code/brain-hint.mjs")).length, 1, JSON.stringify(cmds));
  assert.ok(!cmds.some(c => c.includes(`${vf}/.tools/brain-hint.mjs`)), "veralteter Eintrag muss ersetzt sein");
});

test("Hook-Befehle nutzen den absoluten Node-Pfad; alter Eintrag mit nacktem node wird darauf gehoben", () => {
  const h = mkdtempSync(join(tmpdir(), "ch-")), v = mkdtempSync(join(tmpdir(), "v3 ")); writeFileSync(join(v, "brain.config.json"), "{}");
  const vf = v.split("\\").join("/"), nodeQ = nodeBefehl();
  writeFileSync(join(h, "settings.json"), JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: "command", command: `node "${vf}/.tools/adapters/claude-code/session-start.mjs"` }] }] },
    statusLine: { type: "command", command: `node "${vf}/.tools/adapters/claude-code/statusline.mjs"` } }));
  lauf(v, h);
  const s = JSON.parse(readFileSync(join(h, "settings.json"), "utf8"));
  for (const e of ["SessionStart", "UserPromptSubmit", "PreToolUse"]) {
    const cmds = s.hooks[e].flatMap(x => x.hooks.map(y => y.command)).filter(c => c.includes("/.tools/adapters/claude-code/"));
    assert.equal(cmds.length, 1, `${e}: ${JSON.stringify(cmds)}`);
    assert.ok(cmds[0].startsWith(`${nodeQ} "${vf}/`), cmds[0]);
  }
  assert.ok(s.statusLine.command.startsWith(`${nodeQ} `), s.statusLine.command);
  const cmdDir = join(h, "commands");
  assert.ok(readdirSync(cmdDir).includes("brain-update.md") && readdirSync(cmdDir).includes("brain-backup.md"));
  assert.ok(!readdirSync(cmdDir).includes("update.md") && !readdirSync(cmdDir).includes("backup.md"));
});
