#!/usr/bin/env node
// .tools/skills-build.mjs — rendert Skills/AGENTS.md für einen Vault.
// Nutzung: <vault> --ziel claude-commands <ordner> | agents <datei> | agents-skills <ordner>
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync, copyFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { renderVorlage } from "./pfade.mjs";
const T = dirname(fileURLToPath(import.meta.url));
const [vault, , art, ziel] = process.argv.slice(2);
const render = (s) => renderVorlage(s, vault);
const MARKER = "<!-- brain-kit -->";
const fm = (roh) => { const raw = roh.replace(/\r\n/g, "\n"); const m = raw.match(/^---\n([\s\S]*?)\n---\n?/); const f = Object.fromEntries((m?.[1] || "").split("\n").map(z => z.split(/:\s(.*)/s).slice(0, 2)));
  return { f, kopf: m ? m[0] : "", body: m ? raw.slice(m[0].length) : raw }; };
const stempel = () => new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
// Gleichnamige Datei ohne unsere Marke gehört der Person (eigener Command/Skill) → erst sichern, dann ersetzen.
function schreibeGeneriert(datei, inhalt) {
  if (existsSync(datei)) {
    let alt = "";
    try { alt = readFileSync(datei, "utf8"); } catch {}
    if (!alt.includes(MARKER)) {
      const bak = `${datei}.bak-${stempel()}`;
      copyFileSync(datei, bak);
      console.log(`Eigene Datei gesichert: ${bak} (ersetzt durch die Brain-Fassung)`);
    }
  }
  writeFileSync(datei, inhalt);
}
if (art === "agents") writeFileSync(ziel, render(readFileSync(join(T, "kit", "AGENTS.md"), "utf8")));
else if (art === "claude-commands") {
  mkdirSync(ziel, { recursive: true });
  // Claude-Code-Commandnamen: allgemeine Wörter (update, backup, lint …) bekommen das Präfix brain-, damit sie
  // nicht mit fremden Commands kollidieren; die Skills selbst behalten ihre kurzen Namen.
  const cmdName = { lint: "brain-lint", review: "brain-review", feedback: "brain-feedback", update: "brain-update", backup: "brain-backup", import: "brain-import", lektion: "brain-lektion" };
  for (const s of readdirSync(join(T, "skills"))) {
    const { f, body } = fm(readFileSync(join(T, "skills", s, "SKILL.md"), "utf8"));
    const kopf = `---\ndescription: ${f.description}\n${f["argument-hint"] ? `argument-hint: ${f["argument-hint"]}\n` : ""}---\n${MARKER}\n`;
    schreibeGeneriert(join(ziel, `${cmdName[s] || s}.md`), kopf + render(body));
  }
} else if (art === "agents-skills") {
  // Codex liest Projekt-Skills unter <repo>/.agents/skills/<name>/SKILL.md (Task 0 verifiziert).
  mkdirSync(ziel, { recursive: true });
  for (const s of readdirSync(join(T, "skills"))) {
    const dir = join(ziel, s);
    mkdirSync(dir, { recursive: true });
    const { kopf, body } = fm(readFileSync(join(T, "skills", s, "SKILL.md"), "utf8"));
    schreibeGeneriert(join(dir, "SKILL.md"), render(kopf) + `${MARKER}\n` + render(body));
  }
} else { console.error("Nutzung: skills-build.mjs <vault> --ziel claude-commands <ordner> | agents <datei> | agents-skills <ordner>"); process.exit(64); }
