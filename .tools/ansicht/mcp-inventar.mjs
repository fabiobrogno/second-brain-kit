#!/usr/bin/env node
// .tools/ansicht/mcp-inventar.mjs — MCP-Server aus Client-Configs + Werkzeug-Log. NUR LESEND, und NUR Namen:
// aus keiner Config wird je `command`, `args`, `env`, `url` oder `headers` übernommen oder ausgegeben —
// auch nicht beim Testen. Kaputte/riesige/fremde Dateien führen nie zu einem Absturz, nur zu `nichtLesbar`.
import { readFileSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { leseZeilen } from "../logs.mjs";
import { entferneBom } from "../pfade.mjs";

const NAME_RE = /^[A-Za-z0-9._-]{1,64}$/;
const WERKZEUG_RE = /^[A-Za-z0-9._-]{1,128}$/;
// Codex-TOML: `[mcp_servers.<name>]` — ungequotet ohne Punkt (sonst wäre `[mcp_servers.github.env]`, die
// Untertabelle von `github`, ein eigener Server), Punkte nur in gequoteten Namen (`[mcp_servers."a.b"]`).
const CODEX_TABELLE = /^\s*\[mcp_servers\.(?:"([^"]+)"|([A-Za-z0-9_-]+))\]\s*(?:#.*)?$/;
const MAX_BYTES = 5 * 1024 * 1024;

// Reihenfolge bestimmt die Reihenfolge von Server.quellen im Ergebnis (deterministisch, nicht Fund-Reihenfolge).
const QUELLEN_ORDNUNG = ["Claude Code", "Claude Code (Projekt)", "Claude Desktop", "Cursor", "Codex", "Gemini", "Vault", "genutzt"];

function leseDatei(pfad, nichtLesbar) {
  try {
    if (!existsSync(pfad)) return null;
    const st = statSync(pfad);
    if (!st.isFile()) return null;
    if (st.size > MAX_BYTES) { nichtLesbar.push(pfad); return null; }
    return readFileSync(pfad, "utf8");
  } catch { nichtLesbar.push(pfad); return null; }
}
function leseJson(pfad, nichtLesbar) {
  const txt = leseDatei(pfad, nichtLesbar);
  if (txt == null) return null;
  try { return JSON.parse(entferneBom(txt)); } catch { nichtLesbar.push(pfad); return null; }
}
// Nur die SCHLÜSSEL von mcpServers — niemals die Werte (command/args/env/url/headers) anfassen.
function namenAus(mcpServers) {
  if (!mcpServers || typeof mcpServers !== "object") return [];
  return Object.keys(mcpServers).filter((n) => NAME_RE.test(n));
}
function merge(map, namen, quelle) {
  for (const name of namen) {
    let e = map.get(name);
    if (!e) { e = { name, quellen: new Set(), benutzt: 0, zuletzt: null, werkzeuge: new Set() }; map.set(name, e); }
    e.quellen.add(quelle);
  }
}

// Alle Client-Quellen mit Pfad + Typ. Codex ist TOML, der Rest JSON mit `mcpServers`; Claude Code hat
// zusätzlich `projects[*].mcpServers` (eigene Quelle "Claude Code (Projekt)").
function quellListe(vault, { home, plattform, env }) {
  let desktopPfad;
  if (plattform === "darwin") desktopPfad = join(home, "Library", "Application Support", "Claude", "claude_desktop_config.json");
  else if (plattform === "win32") desktopPfad = join(env.APPDATA || join(home, "AppData", "Roaming"), "Claude", "claude_desktop_config.json");
  else desktopPfad = join(env.XDG_CONFIG_HOME || join(home, ".config"), "Claude", "claude_desktop_config.json");
  return [
    { pfad: join(home, ".claude.json"), quelle: "Claude Code", typ: "claude-code" },
    { pfad: join(vault, ".mcp.json"), quelle: "Vault", typ: "json" },
    { pfad: desktopPfad, quelle: "Claude Desktop", typ: "json" },
    { pfad: join(home, ".cursor", "mcp.json"), quelle: "Cursor", typ: "json" },
    { pfad: join(home, ".codex", "config.toml"), quelle: "Codex", typ: "toml" },
    { pfad: join(home, ".gemini", "settings.json"), quelle: "Gemini", typ: "json" },
  ];
}

// Pfade aller Inventar-Quelldateien (unabhängig davon, ob sie existieren) — für datenSchluessel() in daten.mjs,
// das nur die mtimes braucht, nie den Inhalt.
export function quellDateien(vault, { home = homedir(), plattform = process.platform, env = process.env } = {}) {
  return quellListe(vault, { home, plattform, env }).map((q) => q.pfad);
}

export function inventar(vault, { home = homedir(), plattform = process.platform, env = process.env } = {}) {
  const nichtLesbar = [];
  const map = new Map();

  for (const { pfad, quelle, typ } of quellListe(vault, { home, plattform, env })) {
    if (typ === "toml") {
      const txt = leseDatei(pfad, nichtLesbar);
      if (txt == null) continue;
      const namen = [];
      for (const zeile of entferneBom(txt).split(/\r?\n/)) {
        const m = zeile.match(CODEX_TABELLE);
        if (!m) continue;
        const n = m[1] ?? m[2];
        if (NAME_RE.test(n)) namen.push(n);
      }
      merge(map, namen, quelle);
      continue;
    }
    const json = leseJson(pfad, nichtLesbar);
    if (!json) continue;
    if (typ === "claude-code") {
      merge(map, namenAus(json.mcpServers), quelle);
      const projects = json.projects;
      if (projects && typeof projects === "object") {
        for (const p of Object.values(projects)) merge(map, namenAus(p?.mcpServers), "Claude Code (Projekt)");
      }
      continue;
    }
    merge(map, namenAus(json.mcpServers), quelle);
  }

  // Werkzeug-Log: "<zeit> sid=<8> art=mcp ziel=<server>/<werkzeug>" (von leseZeilen schon dekodiert).
  // Ein Server, der NUR hier auftaucht (z. B. ein claude.ai-Connector ohne lokale Config), bekommt die
  // Quelle "genutzt"; ein bereits aus einer Config bekannter Server behält seine echte(n) Quelle(n).
  const logPfad = join(vault, ".logs", "werkzeug.log");
  for (const f of leseZeilen(logPfad)) {
    if (f.art !== "mcp" || typeof f.ziel !== "string") continue;
    const idx = f.ziel.indexOf("/");
    if (idx === -1) continue;
    const server = f.ziel.slice(0, idx), werkzeug = f.ziel.slice(idx + 1);
    if (!NAME_RE.test(server)) continue;
    let e = map.get(server);
    if (!e) { e = { name: server, quellen: new Set(["genutzt"]), benutzt: 0, zuletzt: null, werkzeuge: new Set() }; map.set(server, e); }
    e.benutzt += 1;
    if (WERKZEUG_RE.test(werkzeug)) e.werkzeuge.add(werkzeug);
    if (f.zeit && (!e.zuletzt || f.zeit > e.zuletzt)) e.zuletzt = f.zeit;
  }

  const server = [...map.values()]
    .map((e) => ({
      name: e.name,
      quellen: QUELLEN_ORDNUNG.filter((q) => e.quellen.has(q)),
      benutzt: e.benutzt,
      zuletzt: e.zuletzt,
      werkzeuge: [...e.werkzeuge].sort(),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return { server, nichtLesbar };
}
