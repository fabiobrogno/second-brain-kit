// Gemeinsamer Datei-Walker (Indexer + Struktur-Lint): alle .md relativ zum Vault, ohne Punkt-Pfade,
// ohne generierte Dateien (INDEX.md, _index.md, _<ordner>.md), ohne AGENTS.md/CLAUDE.md im Vault-Root
// (Agenten-Anweisungen, kein Wissen) und ohne .brainignore-Einträge. Sortiert.
import { readdirSync, statSync, existsSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { istGeneriert } from "./wiki-pfade.mjs";
import { ordner } from "./pfade.mjs";

export function ignorierListe(vault) {
  const f = join(vault, ".brainignore");
  return existsSync(f) ? readFileSync(f, "utf8").split("\n").map(s => s.trim()).filter(Boolean) : [];
}
export function walk(vault, { wikiDir = ordner(vault).wiki, ignore = ignorierListe(vault) } = {}) {
  const skip = (rel) => rel.startsWith(".") || rel === "INDEX.md" || rel === "AGENTS.md" || rel === "CLAUDE.md"
    || istGeneriert(rel.split(sep).join("/"), wikiDir)
    || ignore.some(p => rel === p || rel.startsWith(p + sep) || rel.startsWith(p));
  const out = [];
  const lauf = (dir) => {
    for (const name of readdirSync(dir).sort()) {
      const full = join(dir, name), rel = relative(vault, full);
      if (skip(rel)) continue;
      const st = statSync(full);
      if (st.isDirectory()) lauf(full);
      else if (name.endsWith(".md")) out.push({ full, rel, size: st.size });
    }
  };
  lauf(vault);
  return out;
}
