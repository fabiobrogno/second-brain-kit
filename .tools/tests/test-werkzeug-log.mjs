// .tools/tests/test-werkzeug-log.mjs — protokolliere/leseGelesen (Modul) + werkzeug-protokoll.mjs (Hook).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { protokolliere, leseGelesen } from "../werkzeug-log.mjs";

const neuerVault = () => mkdtempSync(join(tmpdir(), "brain vault "));
const logDatei = (v) => join(v, ".logs", "werkzeug.log");

test("Read mit Datei im Vault schreibt art=lesen mit vault-relativem, URI-kodiertem Ziel", () => {
  const v = neuerVault();
  mkdirSync(join(v, "09_wiki"), { recursive: true });
  const datei = join(v, "09_wiki", "thema x.md");
  writeFileSync(datei, "x");
  assert.equal(protokolliere(v, { sid: "s1", toolName: "Read", toolInput: { file_path: datei } }), true);
  const zeile = readFileSync(logDatei(v), "utf8").trim();
  assert.match(zeile, /art=lesen ziel=09_wiki%2Fthema%20x\.md$/, zeile);
});

test("Read außerhalb des Vaults schreibt nichts", () => {
  const v = neuerVault();
  const ausserhalb = mkdtempSync(join(tmpdir(), "ausserhalb "));
  const datei = join(ausserhalb, "x.md");
  writeFileSync(datei, "x");
  assert.equal(protokolliere(v, { sid: "s1", toolName: "Read", toolInput: { file_path: datei } }), false);
  assert.equal(existsSync(logDatei(v)), false);
});

// Dateiname nur mit Zeichen, die auch Windows erlaubt (kein ?, *, <, >, |, ", :) — trotzdem alles, was kodiert werden muss.
test("Pfad mit Leerzeichen und Umlaut: korrekt kodiert und über leseGelesen wieder lesbar", () => {
  const v = neuerVault();
  mkdirSync(join(v, "09_wiki", "Käse Straße"), { recursive: true });
  const datei = join(v, "09_wiki", "Käse Straße", "nötig, oder & #1 (50%).md");
  writeFileSync(datei, "x");
  assert.equal(protokolliere(v, { sid: "s1", toolName: "Read", toolInput: { file_path: datei } }), true);
  const gelesen = leseGelesen(v, 0);
  assert.equal(gelesen.length, 1);
  assert.equal(gelesen[0].art, "lesen");
  assert.match(readFileSync(logDatei(v), "utf8"), /ziel=09_wiki%2FK%C3%A4se%20Stra%C3%9Fe%2Fn%C3%B6tig%2C%20oder%20%26%20%231%20\(50%25\)\.md$/m);
  assert.equal(gelesen[0].ziel, "09_wiki/Käse Straße/nötig, oder & #1 (50%).md");
  assert.equal(gelesen[0].sid, "s1");
});

test("MCP-Werkzeugname schreibt art=mcp mit <server>%2F<werkzeug>", () => {
  const v = neuerVault();
  assert.equal(protokolliere(v, { sid: "s1", toolName: "mcp__beispiel_wissen_MCP__wissen_suchen", toolInput: {} }), true);
  const zeile = readFileSync(logDatei(v), "utf8").trim();
  assert.match(zeile, /art=mcp ziel=beispiel_wissen_MCP%2Fwissen_suchen$/, zeile);
});

test("anderes Werkzeug (Bash, Edit, Write, Grep) schreibt nichts", () => {
  const v = neuerVault();
  for (const toolName of ["Bash", "Edit", "Write", "Grep"]) {
    assert.equal(protokolliere(v, { sid: "s1", toolName, toolInput: { file_path: "/x" } }), false);
  }
  assert.equal(existsSync(logDatei(v)), false);
});

test("Read ohne file_path / mit leerem file_path schreibt nichts", () => {
  const v = neuerVault();
  assert.equal(protokolliere(v, { sid: "s1", toolName: "Read", toolInput: {} }), false);
  assert.equal(protokolliere(v, { sid: "s1", toolName: "Read", toolInput: { file_path: "" } }), false);
  assert.equal(existsSync(logDatei(v)), false);
});

test("leseGelesen: nur art=lesen, neueste zuerst, max 200", () => {
  const v = neuerVault();
  mkdirSync(join(v, "09_wiki"), { recursive: true });
  for (let i = 0; i < 5; i++) {
    const datei = join(v, "09_wiki", `d${i}.md`);
    writeFileSync(datei, "x");
    protokolliere(v, { sid: "s1", toolName: "Read", toolInput: { file_path: datei } });
  }
  protokolliere(v, { sid: "s1", toolName: "mcp__server__tool", toolInput: {} }); // zählt nicht als "lesen"
  const gelesen = leseGelesen(v, 0);
  assert.equal(gelesen.length, 5);
  assert.equal(gelesen[0].ziel, "09_wiki/d4.md"); // neueste zuerst
  assert.equal(gelesen.at(-1).ziel, "09_wiki/d0.md");
});

test("leseGelesen: seitMs filtert", () => {
  const v = neuerVault();
  mkdirSync(join(v, "09_wiki"), { recursive: true });
  const datei = join(v, "09_wiki", "alt.md");
  writeFileSync(datei, "x");
  protokolliere(v, { sid: "s1", toolName: "Read", toolInput: { file_path: datei } });
  assert.equal(leseGelesen(v, Date.now() + 60000).length, 0);
});

// --- Hook (werkzeug-protokoll.mjs): stdin-JSON, nie Ausgabe, Exit immer 0 ---
const hook = fileURLToPath(new URL("../adapters/claude-code/werkzeug-protokoll.mjs", import.meta.url));
function lauf(eingabe, env = {}) {
  const t0 = Date.now();
  const out = execFileSync(process.execPath, [hook], {
    input: typeof eingabe === "string" ? eingabe : JSON.stringify(eingabe),
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  return { out, ms: Date.now() - t0 };
}

test("Hook: Read im Vault → stdout leer, Exit 0, Laufzeit < 400ms, Zeile geschrieben", () => {
  const v = neuerVault();
  mkdirSync(join(v, "09_wiki"), { recursive: true });
  writeFileSync(join(v, "brain.config.json"), "{}");
  const datei = join(v, "09_wiki", "a.md");
  writeFileSync(datei, "x");
  const { out, ms } = lauf({ session_id: "sidA", tool_name: "Read", tool_input: { file_path: datei } }, { BRAIN_VAULT: v });
  assert.equal(out, "");
  assert.ok(ms < 400, `Laufzeit ${ms}ms`);
  assert.match(readFileSync(logDatei(v), "utf8"), /art=lesen/);
});

test("Hook: mcp__-Werkzeug ohne Vault-Bezug → Zeile art=mcp", () => {
  const v = neuerVault();
  writeFileSync(join(v, "brain.config.json"), "{}");
  const { out } = lauf({ session_id: "sidM", tool_name: "mcp__amazon-ads-bc__billing-list_invoices", tool_input: {} }, { BRAIN_VAULT: v });
  assert.equal(out, "");
  assert.match(readFileSync(logDatei(v), "utf8"), /art=mcp ziel=amazon-ads-bc%2Fbilling-list_invoices/);
});

test("Hook: kaputtes stdin → Exit 0, keine Ausgabe", () => {
  const v = neuerVault();
  writeFileSync(join(v, "brain.config.json"), "{}");
  const { out } = lauf("kaputt{{{", { BRAIN_VAULT: v });
  assert.equal(out, "");
  assert.equal(existsSync(logDatei(v)), false);
});

test("Hook: BRAIN_ERNTE=1 → keine Zeile, auch für Read im Vault", () => {
  const v = neuerVault();
  mkdirSync(join(v, "09_wiki"), { recursive: true });
  writeFileSync(join(v, "brain.config.json"), "{}");
  const datei = join(v, "09_wiki", "b.md");
  writeFileSync(datei, "x");
  lauf({ session_id: "sidB", tool_name: "Read", tool_input: { file_path: datei } }, { BRAIN_VAULT: v, BRAIN_ERNTE: "1" });
  assert.equal(existsSync(logDatei(v)), false);
});

test("Hook: liveAufleuchten:false unterdrückt Read-Zeilen, MCP-Zeilen bleiben", () => {
  const v = neuerVault();
  mkdirSync(join(v, "09_wiki"), { recursive: true });
  writeFileSync(join(v, "brain.config.json"), JSON.stringify({ automatik: { liveAufleuchten: false } }));
  const datei = join(v, "09_wiki", "c.md");
  writeFileSync(datei, "x");
  lauf({ session_id: "sidC", tool_name: "Read", tool_input: { file_path: datei } }, { BRAIN_VAULT: v });
  assert.equal(existsSync(logDatei(v)), false);
  lauf({ session_id: "sidC", tool_name: "mcp__server__tool", tool_input: {} }, { BRAIN_VAULT: v });
  assert.match(readFileSync(logDatei(v), "utf8"), /art=mcp/);
});
