import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, renameSync, realpathSync } from "node:fs";
import { join, dirname, delimiter } from "node:path";
import { tmpdir } from "node:os";
import { qmdBefehl, qmdPrivatBin } from "../qmd-befehl.mjs";

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
  assert.deepEqual(qmdBefehl("win32", leer, leer), { cmd: "qmd", vorArgs: [] });
  assert.deepEqual(qmdBefehl("win32", "", leer), { cmd: "qmd", vorArgs: [] });
});

test("win32: qmd.cmd vorhanden, aber kein package.json danach → Fallback", () => {
  const dir = mkdtempSync(join(tmpdir(), "qmd-ohne-paket-"));
  writeFileSync(join(dir, "qmd.cmd"), "@echo off\r\n");
  assert.deepEqual(qmdBefehl("win32", dir), { cmd: "qmd", vorArgs: [] });
});

test("andere Plattformen ohne privates qmd → 'qmd' ohne vorArgs, PATH wird nicht angefasst", () => {
  const home = mkdtempSync(join(tmpdir(), "qmd-home-"));
  assert.deepEqual(qmdBefehl("darwin", "/usr/bin:/usr/local/bin", home), { cmd: "qmd", vorArgs: [] });
  assert.deepEqual(qmdBefehl("linux", "", home), { cmd: "qmd", vorArgs: [] });
});

test("macOS/Linux: privates qmd aus der Installation (~/.brain-kit/bin/qmd) per absolutem Pfad (#2)", () => {
  const home = mkdtempSync(join(tmpdir(), "qmd-home-"));
  mkdirSync(join(home, ".brain-kit", "bin"), { recursive: true });
  writeFileSync(join(home, ".brain-kit", "bin", "qmd"), "#!/bin/sh\n");
  const bin = join(home, ".brain-kit", "bin", "qmd");
  assert.equal(qmdPrivatBin(home), bin);
  // Über den laufenden Node gestartet (der Starter braucht sonst `node` im PATH), dessen Ordner kommt in den PATH.
  assert.deepEqual(qmdBefehl("darwin", "/usr/bin", home), { cmd: process.execPath, vorArgs: [realpathSync(bin)] });
  assert.deepEqual(qmdBefehl("linux", "", home), { cmd: process.execPath, vorArgs: [realpathSync(bin)] });
  assert.ok(process.env.PATH.split(delimiter).includes(dirname(process.execPath)));
});

test("win32: qmd.cmd unter ~/.brain-kit (npm --prefix) wird auch ohne PATH-Eintrag gefunden (#2)", () => {
  const { dir, entry } = fakeWin32Layout({ bin: "bin/qmd.js" });
  // fakeWin32Layout legt qmd.cmd + node_modules direkt in dir an — genau npms --prefix-Layout unter Windows.
  const home = mkdtempSync(join(tmpdir(), "qmd-home-"));
  renameSync(dir, join(home, ".brain-kit"));
  const r = qmdBefehl("win32", "C:\\andere\\pfad", home);
  assert.deepEqual(r, { cmd: process.execPath, vorArgs: [join(home, ".brain-kit", "node_modules", "@tobilu", "qmd", entry)] });
});
