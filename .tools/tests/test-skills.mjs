import { nodeBefehl } from "../pfade.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const T = fileURLToPath(new URL("..", import.meta.url)), build = join(T, "skills-build.mjs");

test("jeder Skill hat name + description und erwähnt keine Claude-Slash-Commands", () => {
  for (const s of readdirSync(join(T, "skills"))) {
    // Quelle kann unter Windows mit CRLF ausgecheckt sein (core.autocrlf) — der Build liest sie CRLF-tolerant
    const raw = readFileSync(join(T, "skills", s, "SKILL.md"), "utf8").replace(/\r\n/g, "\n");
    assert.match(raw, new RegExp(`^---\\nname: ${s}\\n`), s);
    assert.match(raw, /\ndescription: .{20,}\n/, s);
    assert.doesNotMatch(raw, /(^|\s)\/(ingest|brain-lint|handoff)\b/, `${s}: agent-neutral formulieren („Skill ingest“)`);
  }
});
test("Build erzeugt Claude-Commands mit description", () => {
  const z = mkdtempSync(join(tmpdir(), "cmd-"));
  const v = mkdtempSync(join(tmpdir(), "v-")); writeFileSync(join(v, "brain.config.json"), "{}");
  execFileSync(process.execPath, [build, v, "--ziel", "claude-commands", z]);
  assert.match(readFileSync(join(z, "ingest.md"), "utf8"), /^---\ndescription: /);
});
test("AGENTS.md wird mit echten Ordnernamen gerendert, ohne Platzhalter", () => {
  const v = mkdtempSync(join(tmpdir(), "v-")); writeFileSync(join(v, "brain.config.json"), JSON.stringify({ ordner: { wiki: "wiki", inbox: "inbox" } }));
  const ziel = join(v, "AGENTS.md");
  execFileSync(process.execPath, [build, v, "--ziel", "agents", ziel]);
  const a = readFileSync(ziel, "utf8");
  assert.doesNotMatch(a, /\{\{/); assert.match(a, /inbox\//); assert.match(a, /wiki\/_schema\.md/);
});
test("Build erzeugt Codex-Skills unter <ordner>/<name>/SKILL.md, Platzhalter gerendert, Frontmatter erhalten", () => {
  const z = mkdtempSync(join(tmpdir(), "askills-"));
  const v = mkdtempSync(join(tmpdir(), "v-")); writeFileSync(join(v, "brain.config.json"), "{}");
  execFileSync(process.execPath, [build, v, "--ziel", "agents-skills", z]);
  for (const s of readdirSync(join(T, "skills"))) {
    const raw = readFileSync(join(z, s, "SKILL.md"), "utf8");
    assert.match(raw, new RegExp(`^---\\nname: ${s}\\n`), s);
    assert.doesNotMatch(raw, /\{\{/, s);
  }
});
test("Vault-Pfad mit Leerzeichen: jede Zeile mit .tools/brain.mjs hat den Pfad in doppelten Anführungszeichen", () => {
  const z = mkdtempSync(join(tmpdir(), "cmdq-"));
  const v = mkdtempSync(join(tmpdir(), "v mit Leerzeichen "));
  writeFileSync(join(v, "brain.config.json"), "{}");
  execFileSync(process.execPath, [build, v, "--ziel", "claude-commands", z]);
  for (const datei of readdirSync(z)) {
    for (const zeile of readFileSync(join(z, datei), "utf8").split("\n")) {
      if (!zeile.includes(".tools/brain.mjs")) continue;
      const gesamt = (zeile.match(/\.tools\/brain\.mjs/g) || []).length;
      const gequotet = (zeile.match(/"[^"\n]*\.tools\/brain\.mjs"/g) || []).length;
      assert.equal(gequotet, gesamt, `${datei}: ungequotetes .tools/brain.mjs — ${zeile}`);
    }
  }
});
test("AGENTS.md und Skills nutzen den absoluten Node-Pfad (nie nacktes node) — Rendering mit dem laufenden Node", () => {
  const v = mkdtempSync(join(tmpdir(), "v-")); writeFileSync(join(v, "brain.config.json"), "{}");
  const ziel = join(v, "AGENTS.md");
  execFileSync(process.execPath, [build, v, "--ziel", "agents", ziel]);
  const nodeQ = nodeBefehl();
  const a = readFileSync(ziel, "utf8");
  assert.ok(a.includes(`${nodeQ} "${v.split("\\").join("/")}/.tools/brain.mjs" search`), a);
  assert.doesNotMatch(a, /`node /);
  const z = mkdtempSync(join(tmpdir(), "cmdn-"));
  execFileSync(process.execPath, [build, v, "--ziel", "claude-commands", z]);
  for (const d of readdirSync(z)) assert.doesNotMatch(readFileSync(join(z, d), "utf8"), /`node |\(node /, d);
});
test("Skills sind plattformneutral: kein date/rm -f/shasum/cut/cd /tmp/( … ) &, kein fester Archivordner, kein Werkzeugname", () => {
  for (const s of readdirSync(join(T, "skills"))) {
    const raw = readFileSync(join(T, "skills", s, "SKILL.md"), "utf8");
    for (const verboten of [/`date /, /\brm -f\b/, /\bshasum\b/, /\|\s*cut\b/, /cd \/tmp/, /\)\s*&`/, /90_archiv/, /`node /, /Infisical/]) {
      assert.doesNotMatch(raw, verboten, `${s}: ${verboten}`);
    }
  }
});
test("Claude-Commands: update/backup heißen brain-update/brain-backup, alle tragen die brain-kit-Marke", () => {
  const z = mkdtempSync(join(tmpdir(), "cmdm-"));
  const v = mkdtempSync(join(tmpdir(), "v-")); writeFileSync(join(v, "brain.config.json"), "{}");
  execFileSync(process.execPath, [build, v, "--ziel", "claude-commands", z]);
  const dateien = readdirSync(z).sort();
  assert.deepEqual(dateien, ["brain-backup.md", "brain-feedback.md", "brain-lint.md", "brain-review.md", "brain-update.md", "handoff.md", "ingest.md"]);
  for (const d of dateien) assert.match(readFileSync(join(z, d), "utf8"), /^---\n[\s\S]*?\n---\n<!-- brain-kit -->\n/, d);
});
test("Gleichnamiger fremder Command ohne Marke: Backup .bak-<zeit> + ersetzt + Meldung; eigener wird still überschrieben", () => {
  const z = mkdtempSync(join(tmpdir(), "cmdf-"));
  const v = mkdtempSync(join(tmpdir(), "v-")); writeFileSync(join(v, "brain.config.json"), "{}");
  writeFileSync(join(z, "ingest.md"), "# mein eigener ingest\n");
  const out = execFileSync(process.execPath, [build, v, "--ziel", "claude-commands", z], { encoding: "utf8" });
  const bak = readdirSync(z).filter(f => /^ingest\.md\.bak-\d{8}-\d{6}$/.test(f));
  assert.equal(bak.length, 1, readdirSync(z).join(","));
  assert.equal(readFileSync(join(z, bak[0]), "utf8"), "# mein eigener ingest\n");
  assert.match(readFileSync(join(z, "ingest.md"), "utf8"), /<!-- brain-kit -->/);
  assert.match(out, /Eigene Datei gesichert: .*ingest\.md\.bak-/);
  const out2 = execFileSync(process.execPath, [build, v, "--ziel", "claude-commands", z], { encoding: "utf8" });
  assert.equal(out2, "");
  assert.equal(readdirSync(z).filter(f => f.includes(".bak-")).length, 1);
});
