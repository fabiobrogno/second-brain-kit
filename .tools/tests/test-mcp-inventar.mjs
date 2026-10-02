// .tools/tests/test-mcp-inventar.mjs — MCP-Server aus Client-Configs + Werkzeug-Log: nur Namen, nie Werte.
// Nutzt NUR die erfundenen Fixture-Configs unter fixture-mcp/ (eigenes `home`) — die echten ~/.claude.json,
// ~/.cursor/mcp.json usw. werden hier nie gelesen (jeder Aufruf übergibt `home` explizit).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { inventar, quellDateien } from "../ansicht/mcp-inventar.mjs";
import { zeitstempel, haengeAn } from "../logs.mjs";

const T = fileURLToPath(new URL("..", import.meta.url));
const FIXTURE_HOME = join(T, "tests", "fixture-mcp", "home");
const FIXTURE_VAULT = join(T, "tests", "fixture-mcp", "vault");
const tempDir = (name = "mcp-inventar ") => mkdtempSync(join(tmpdir(), name));

test("darwin: alle Clients zusammengeführt, demo-server mit 2 Quellen, kaputte Cursor-Datei → nichtLesbar, kein Absturz", () => {
  const r = inventar(FIXTURE_VAULT, { home: FIXTURE_HOME, plattform: "darwin", env: {} });
  const byName = Object.fromEntries(r.server.map((s) => [s.name, s]));
  assert.deepEqual(byName["demo-server"].quellen, ["Claude Code", "Vault"]);
  assert.deepEqual(byName["codecli-only"].quellen, ["Claude Code"]);
  assert.deepEqual(byName["projekt-only"].quellen, ["Claude Code (Projekt)"]);
  assert.deepEqual(byName["vault-only"].quellen, ["Vault"]);
  assert.deepEqual(byName["desktop-only"].quellen, ["Claude Desktop"]);
  assert.deepEqual(byName["codex-server"].quellen, ["Codex"]);
  assert.deepEqual(byName["mit-punkt.x"].quellen, ["Codex"]);
  assert.deepEqual(byName["gemini-server"].quellen, ["Gemini"]);
  assert.ok(!("../x" in byName), "ungültiger Name muss verworfen sein");
  assert.ok(!("winserver" in byName), "win32-Desktop-Config darf unter darwin nicht gelesen werden");
  assert.ok(!("linserver" in byName), "linux-Desktop-Config darf unter darwin nicht gelesen werden");
  assert.ok(r.nichtLesbar.some((p) => p.endsWith(join(".cursor", "mcp.json"))), r.nichtLesbar.join(", "));
  // sortiert nach name
  const namen = r.server.map((s) => s.name);
  assert.deepEqual(namen, [...namen].sort((a, b) => a.localeCompare(b)));
});

test("JSON.stringify des Ergebnisses enthält keinen Köderwert, keine URL, kein args/command/env/headers-Schlüssel", () => {
  const r = inventar(FIXTURE_VAULT, { home: FIXTURE_HOME, plattform: "darwin", env: {} });
  const s = JSON.stringify(r);
  assert.ok(!s.includes("KOEDER"), s);
  assert.ok(!s.includes("koeder.example"), s);
  assert.ok(!s.includes("args"), s);
  assert.ok(!s.includes("command"), s);
  assert.ok(!s.includes("headers"), s);
  assert.ok(!s.includes("../x"), s);
});

test("win32: APPDATA-Fallback (~/AppData/Roaming) ohne gesetztes APPDATA", () => {
  const r = inventar(FIXTURE_VAULT, { home: FIXTURE_HOME, plattform: "win32", env: {} });
  const namen = r.server.map((s) => s.name);
  assert.ok(namen.includes("winserver"), namen.join(", "));
  assert.ok(!namen.includes("desktop-only"), "darwin-Desktop-Config darf unter win32 nicht gelesen werden");
  assert.ok(!namen.includes("linserver"));
});

test("win32: env.APPDATA überschreibt den Fallback-Pfad", () => {
  const home = tempDir();
  const appdata = join(tempDir(), "custom-appdata");
  mkdirSync(join(appdata, "Claude"), { recursive: true });
  writeFileSync(join(appdata, "Claude", "claude_desktop_config.json"), JSON.stringify({ mcpServers: { "custom-win": {} } }));
  const r = inventar(tempDir(), { home, plattform: "win32", env: { APPDATA: appdata } });
  assert.deepEqual(r.server.map((s) => s.name), ["custom-win"]);
});

test("linux: XDG_CONFIG_HOME-Fallback (~/.config) ohne gesetztes XDG_CONFIG_HOME", () => {
  const r = inventar(FIXTURE_VAULT, { home: FIXTURE_HOME, plattform: "linux", env: {} });
  const namen = r.server.map((s) => s.name);
  assert.ok(namen.includes("linserver"), namen.join(", "));
  assert.ok(!namen.includes("desktop-only"));
  assert.ok(!namen.includes("winserver"));
});

test("linux: env.XDG_CONFIG_HOME überschreibt den Fallback-Pfad", () => {
  const home = tempDir();
  const xdg = join(tempDir(), "custom-xdg");
  mkdirSync(join(xdg, "Claude"), { recursive: true });
  writeFileSync(join(xdg, "Claude", "claude_desktop_config.json"), JSON.stringify({ mcpServers: { "custom-linux": {} } }));
  const r = inventar(tempDir(), { home, plattform: "linux", env: { XDG_CONFIG_HOME: xdg } });
  assert.deepEqual(r.server.map((s) => s.name), ["custom-linux"]);
});

test("riesige Datei (> 5 MB) → nichtLesbar, kein Wurf, kein Inhalt übernommen", () => {
  const home = tempDir();
  const riesig = "x".repeat(6 * 1024 * 1024);
  writeFileSync(join(home, ".claude.json"), JSON.stringify({ mcpServers: { ok: { args: [riesig] } } }));
  const r = inventar(tempDir(), { home, plattform: "darwin", env: {} });
  assert.deepEqual(r.server, []);
  assert.ok(r.nichtLesbar.some((p) => p.endsWith(".claude.json")));
});

test("Werkzeug-Log: ziel=claude_ai_Gmail%2Fsearch → neuer Server nur aus dem Log, Quelle 'genutzt'", () => {
  const v = tempDir("mcp-log-vault ");
  haengeAn(join(v, ".logs", "werkzeug.log"), `${zeitstempel()} sid=abcd1234 art=mcp ziel=claude_ai_Gmail%2Fsearch`);
  const home = tempDir("mcp-log-home ");
  const r = inventar(v, { home, plattform: "darwin", env: {} });
  assert.deepEqual(r.server, [{ name: "claude_ai_Gmail", quellen: ["genutzt"], benutzt: 1, zuletzt: r.server[0].zuletzt, werkzeuge: ["search"] }]);
  assert.match(r.server[0].zuletzt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
});

test("Werkzeug-Log für einen bereits aus Configs bekannten Server: Nutzung wird angehängt, 'genutzt' NICHT zusätzlich als Quelle", () => {
  const v = tempDir("mcp-log-vault2 ");
  writeFileSync(join(v, ".mcp.json"), JSON.stringify({ mcpServers: { "demo-server": {} } }));
  haengeAn(join(v, ".logs", "werkzeug.log"), `${zeitstempel()} sid=abcd1234 art=mcp ziel=demo-server%2Flesen`);
  const home = tempDir("mcp-log-home2 ");
  const r = inventar(v, { home, plattform: "darwin", env: {} });
  assert.equal(r.server.length, 1);
  assert.deepEqual(r.server[0].quellen, ["Vault"]);
  assert.equal(r.server[0].benutzt, 1);
  assert.deepEqual(r.server[0].werkzeuge, ["lesen"]);
});

test("ungültiger Servername im Werkzeug-Log wird verworfen", () => {
  const v = tempDir("mcp-log-vault3 ");
  haengeAn(join(v, ".logs", "werkzeug.log"), `${zeitstempel()} sid=abcd1234 art=mcp ziel=bad!server%2Flesen`);
  const home = tempDir("mcp-log-home3 ");
  const r = inventar(v, { home, plattform: "darwin", env: {} });
  assert.deepEqual(r.server, []);
});

test("leerer Vault/Home → leeres Ergebnis, kein Absturz", () => {
  const home = tempDir(), v = tempDir();
  const r = inventar(v, { home, plattform: "darwin", env: {} });
  assert.deepEqual(r, { server: [], nichtLesbar: [] });
});

test("quellDateien(vault) liefert die Pfade aller Inventar-Quellen (für datenSchluessel-mtimes) — unabhängig von Existenz", () => {
  const home = tempDir(), v = tempDir();
  const pfade = quellDateien(v, { home, plattform: "linux", env: {} });
  assert.ok(pfade.some((p) => p.endsWith(".claude.json")));
  assert.ok(pfade.some((p) => p === join(v, ".mcp.json")));
  assert.ok(pfade.some((p) => p.includes(".cursor")));
  assert.ok(pfade.some((p) => p.includes(".codex")));
  assert.ok(pfade.some((p) => p.includes(".gemini")));
  assert.ok(pfade.some((p) => p.includes(".config") && p.includes("Claude")));
});

test("Codex: Untertabellen ([mcp_servers.x.env], [mcp_servers.x.tools]) werden keine Phantom-Server", () => {
  const home = tempDir();
  mkdirSync(join(home, ".codex"), { recursive: true });
  writeFileSync(join(home, ".codex", "config.toml"), [
    "[mcp_servers.github]",
    'command = "npx"',
    "[mcp_servers.github.env]",
    'BEISPIEL = "KOEDER-wert"',
    "[mcp_servers.github.tools.suche]",
    "aktiv = true",
    '[mcp_servers."mit.punkt"] # Kommentar hinter der Tabelle',
    "[mcp_servers.zweiter] # auch hier",
  ].join("\r\n"));
  const r = inventar(tempDir(), { home, plattform: "linux", env: {} });
  assert.deepEqual(r.server.map((s) => s.name), ["github", "mit.punkt", "zweiter"]);
  assert.ok(!JSON.stringify(r).includes("KOEDER"));
});

test("JSON-Configs mit BOM (PowerShell 5.1) sind lesbar, nicht „nicht lesbar“", () => {
  const home = tempDir();
  mkdirSync(join(home, ".cursor"), { recursive: true });
  writeFileSync(join(home, ".cursor", "mcp.json"), "﻿" + JSON.stringify({ mcpServers: { "bom-server": {} } }));
  const r = inventar(tempDir(), { home, plattform: "win32", env: {} });
  assert.deepEqual(r.server.map((s) => s.name), ["bom-server"]);
  assert.deepEqual(r.nichtLesbar, []);
});

test("Werkzeugnamen aus dem Werkzeug-Log nur bis 128 Zeichen aus [A-Za-z0-9._-]", () => {
  const vault = tempDir();
  const log = join(vault, ".logs", "werkzeug.log");
  const z = zeitstempel();
  for (const w of ["gut_werkzeug", "x".repeat(129), "mit leerzeichen", "<script>"]) {
    haengeAn(log, `${z} sid=s1 art=mcp ziel=${encodeURIComponent(`srv/${w}`)}`);
  }
  const r = inventar(vault, { home: tempDir(), plattform: "linux", env: {} });
  assert.equal(r.server.length, 1);
  assert.equal(r.server[0].benutzt, 4);
  assert.deepEqual(r.server[0].werkzeuge, ["gut_werkzeug"]);
});
