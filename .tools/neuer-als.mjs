// .tools/neuer-als.mjs — Ersatz für `find -newer`: gibt es eine .md (außer .git), die neuer ist als die Stempeldatei?
import { readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
export function neuerAls(vault, stempel) {
  if (!existsSync(stempel)) return true;
  const grenze = statSync(stempel).mtimeMs;
  const lauf = (d) => { for (const e of readdirSync(d, { withFileTypes: true })) {
    if (e.name === ".git" || e.name === "node_modules") continue;
    const f = join(d, e.name);
    if (e.isDirectory()) { if (lauf(f)) return true; }
    else if (e.name.endsWith(".md") && statSync(f).mtimeMs > grenze) return true;
  } return false; };
  return lauf(vault);
}
