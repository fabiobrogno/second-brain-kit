// .tools/tests/test-werkzeug.mjs — gitBefehl(): config vor MinGit-Ort vor nacktem "git".
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { gitBefehl } from "../werkzeug.mjs";

test("gitBefehl: ohne Config/MinGit → nacktes 'git'", () => {
  const home = mkdtempSync(join(tmpdir(), "wz-"));
  assert.equal(gitBefehl({ cfg: {}, plattform: "darwin", home }), "git");
  assert.equal(gitBefehl({ cfg: {}, plattform: "win32", home }), "git");
});

test("gitBefehl: win32 mit vorhandenem MinGit (ohne Config) → dessen absoluter Pfad", () => {
  const home = mkdtempSync(join(tmpdir(), "wz-"));
  const mingit = join(home, ".brain-kit", "git", "cmd");
  mkdirSync(mingit, { recursive: true });
  writeFileSync(join(mingit, "git.exe"), "");
  assert.equal(gitBefehl({ cfg: {}, plattform: "win32", home }), join(mingit, "git.exe"));
  // auf einer anderen Plattform zählt der MinGit-Ort nicht (gibt es praktisch nicht, aber die Reihenfolge
  // muss trotzdem stimmen: ohne win32 bleibt es beim nackten "git")
  assert.equal(gitBefehl({ cfg: {}, plattform: "darwin", home }), "git");
});

test("gitBefehl: Config-Eintrag werkzeuge.git geht JEDEM anderen Rückfall vor", () => {
  const home = mkdtempSync(join(tmpdir(), "wz-"));
  const mingit = join(home, ".brain-kit", "git", "cmd");
  mkdirSync(mingit, { recursive: true });
  writeFileSync(join(mingit, "git.exe"), "");
  const cfg = { werkzeuge: { git: "/ein/anderer/git" } };
  assert.equal(gitBefehl({ cfg, plattform: "win32", home }), "/ein/anderer/git");
  assert.equal(gitBefehl({ cfg, plattform: "darwin", home }), "/ein/anderer/git");
});

test("gitBefehl: kaputter/fehlender cfg-Wert (kein String) fällt zurück statt zu werfen", () => {
  const home = mkdtempSync(join(tmpdir(), "wz-"));
  assert.equal(gitBefehl({ cfg: { werkzeuge: { git: 123 } }, plattform: "darwin", home }), "git");
  assert.equal(gitBefehl({ cfg: null, plattform: "darwin", home }), "git");
  assert.equal(gitBefehl(), gitBefehl({ cfg: {} })); // Default-Parameter funktionieren ohne Argument
});
