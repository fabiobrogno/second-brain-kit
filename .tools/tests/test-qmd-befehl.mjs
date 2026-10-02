import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { qmdBefehl } from "../qmd-befehl.mjs";

function fakeWin32Layout({ bin }) {
  const dir = mkdtempSync(join(tmpdir(), "qmd-win-"));
  writeFileSync(join(dir, "qmd.cmd"), "@echo off\r\nnode %~dp0\\node_modules\\@tobilu\\qmd\\bin\\qmd.js %*\r\n");
  const paket = join(dir, "node_modules", "@tobilu", "qmd");
  const entry = typeof bin === "string" ? bin : bin.qmd;
  mkdirSync(join(paket, dirname(entry)), { recursive: true });
  writeFileSync(join(paket, "package.json"), JSON.stringify({ name: "@tobilu/qmd", bin }));
  writeFileSync(join(paket, entry), "// fake qmd entry\n");
  return { dir, paket, entry };
}

test("win32: qmd.cmd + bin als String löst zum echten JS-Entry über node auf", () => {
  const { dir, paket, entry } = fakeWin32Layout({ bin: "bin/qmd.js" });
  const r = qmdBefehl("win32", `${dir};C:\\andere\\pfad`);
  assert.deepEqual(r, { cmd: process.execPath, vorArgs: [join(paket, entry)] });
});

test("win32: bin als Objekt — Schlüssel 'qmd' wird verwendet", () => {
  const { dir, paket, entry } = fakeWin32Layout({ bin: { qmd: "bin/qmd.js", andere: "bin/andere.js" } });
  const r = qmdBefehl("win32", dir);
  assert.deepEqual(r, { cmd: process.execPath, vorArgs: [join(paket, entry)] });
});

test("win32 ohne Treffer (kein qmd.cmd im PATH) → Fallback auf bloßes 'qmd'", () => {
  const leer = mkdtempSync(join(tmpdir(), "qmd-leer-"));
  assert.deepEqual(qmdBefehl("win32", leer), { cmd: "qmd", vorArgs: [] });
  assert.deepEqual(qmdBefehl("win32", ""), { cmd: "qmd", vorArgs: [] });
});

test("win32: qmd.cmd vorhanden, aber kein package.json danach → Fallback", () => {
  const dir = mkdtempSync(join(tmpdir(), "qmd-ohne-paket-"));
  writeFileSync(join(dir, "qmd.cmd"), "@echo off\r\n");
  assert.deepEqual(qmdBefehl("win32", dir), { cmd: "qmd", vorArgs: [] });
});

test("andere Plattformen → immer 'qmd' ohne vorArgs, PATH wird nicht angefasst", () => {
  assert.deepEqual(qmdBefehl("darwin", "/usr/bin:/usr/local/bin"), { cmd: "qmd", vorArgs: [] });
  assert.deepEqual(qmdBefehl("linux", ""), { cmd: "qmd", vorArgs: [] });
});
