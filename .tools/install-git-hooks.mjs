#!/usr/bin/env node
// Aktiviert die versionierten Brain-Git-Hooks (core.hooksPath = .tools/git-hooks) — idempotent, gilt für alle Sessions/Worktrees.
// Nutzung: node install-git-hooks.mjs [vault]
import { chmodSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { EIGENER_VAULT, ladeConfig } from "./pfade.mjs";
import { gitBefehl } from "./werkzeug.mjs";

const V = process.argv[2] || EIGENER_VAULT;
const GIT = gitBefehl({ cfg: ladeConfig(V) });
if (process.platform !== "win32") {
  chmodSync(join(V, ".tools", "git-hooks", "pre-commit"), 0o755);
}
execFileSync(GIT, ["-C", V, "config", "core.hooksPath", ".tools/git-hooks"], { windowsHide: true });
const aktiv = execFileSync(GIT, ["-C", V, "config", "core.hooksPath"], { encoding: "utf8", windowsHide: true }).trim();
console.log(`Brain-Hooks aktiv: ${aktiv}`);
