// Regression: QMD_BIN, das auf ein .mjs-Skript zeigt, muss über process.execPath (node) gestartet werden —
// nicht direkt exec'd (schlägt ohne Shebang/x-Bit mit EACCES/ENOEXEC fehl, speziell unter Windows immer,
// weil .mjs dort nie direkt ausführbar ist). fake-qmd-cli.mjs ist absichtlich NICHT ausführbar (644) angelegt:
// nur der process.execPath-Zweig in search-refresh.mjs kann es überhaupt starten.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const T = dirname(fileURLToPath(import.meta.url));
const R = join(T, "..", "search-refresh.mjs");
const FAKE = join(T, "fake-qmd-cli.mjs");

test("search-refresh.mjs: QMD_BIN mit .mjs-Endung läuft über process.execPath, nicht per direktem Exec", () => {
  const vault = mkdtempSync(join(tmpdir(), "sr-qmdbin-"));
  mkdirSync(join(vault, "20_firma"), { recursive: true });
  writeFileSync(join(vault, "20_firma", "a.md"), "# a\n");
  const calls = join(vault, "calls.txt");
  const r = spawnSync(process.execPath, [R], {
    env: { ...process.env, BRAIN_VAULT: vault, QMD_BIN: FAKE, FAKE_QMD_CALLS: calls },
    encoding: "utf8",
  });
  assert.equal(r.status, 0, `search-refresh.mjs endete mit Status ${r.status}: ${r.stderr}`);
  assert.ok(existsSync(calls), "Fake wurde nicht aufgerufen — .mjs-QMD_BIN lief nicht über process.execPath");
  assert.match(readFileSync(calls, "utf8"), /^update$/m);
  assert.ok(existsSync(join(vault, ".logs", "search-refreshed")), "Stempel fehlt — Lauf nicht als erfolgreich gewertet");
});

test("search-refresh.mjs: fehlende Sammlungen „brain“/„brainkarten“ werden angelegt, vorhandene nicht doppelt (#3)", () => {
  const vault = mkdtempSync(join(tmpdir(), "sr-sammlung-"));
  mkdirSync(join(vault, "20_firma"), { recursive: true });
  writeFileSync(join(vault, "20_firma", "a.md"), "# a\n");
  const calls = join(vault, "calls.txt");
  const sammlungen = join(vault, "sammlungen.txt");
  writeFileSync(sammlungen, "brain\n"); // Zustand nach der alten Installation: nur „brain“
  const env = { ...process.env, BRAIN_VAULT: vault, QMD_BIN: FAKE, FAKE_QMD_CALLS: calls, FAKE_QMD_SAMMLUNGEN: sammlungen };
  assert.equal(spawnSync(process.execPath, [R], { env, encoding: "utf8" }).status, 0);
  const log = readFileSync(calls, "utf8");
  assert.ok(log.includes(`collection add ${join(vault, ".logs", "hint-karten")} --name brainkarten`), log);
  assert.doesNotMatch(log, /--name brain$/m, "„brain“ war schon da und darf nicht erneut angelegt werden");
  assert.match(log, /^embed -c brainkarten$/m);
  assert.ok(existsSync(join(vault, ".logs", "search-refreshed")), "nach dem Anlegen muss der Lauf vollständig durchgehen");
});

test("search-refresh.mjs: antwortet qmd nicht, wird nichts indexiert und kein Stempel gesetzt", () => {
  const vault = mkdtempSync(join(tmpdir(), "sr-ohne-qmd-"));
  const r = spawnSync(process.execPath, [R], { env: { ...process.env, BRAIN_VAULT: vault, QMD_BIN: join(vault, "gibt-es-nicht") }, encoding: "utf8" });
  assert.equal(r.status, 0);
  assert.ok(!existsSync(join(vault, ".logs", "search-refreshed")));
});

test("search-refresh.mjs: scheitert collection add, laufen update/embed der vorhandenen Sammlung trotzdem — ohne Stempel", () => {
  const vault = mkdtempSync(join(tmpdir(), "sr-addfehler-"));
  const calls = join(vault, "calls.txt");
  const sammlungen = join(vault, "sammlungen.txt");
  writeFileSync(sammlungen, "brain\n");
  const env = { ...process.env, BRAIN_VAULT: vault, QMD_BIN: FAKE, FAKE_QMD_CALLS: calls, FAKE_QMD_SAMMLUNGEN: sammlungen, FAKE_QMD_ADD_FEHLER: "1" };
  assert.equal(spawnSync(process.execPath, [R], { env, encoding: "utf8" }).status, 0);
  const log = readFileSync(calls, "utf8");
  assert.match(log, /^update$/m);
  assert.match(log, /^embed -c brain$/m);
  assert.doesNotMatch(log, /^embed -c brainkarten$/m);
  assert.ok(!existsSync(join(vault, ".logs", "search-refreshed")), "ohne vollständige Einrichtung kein Erfolgsstempel");
});
