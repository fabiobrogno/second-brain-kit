#!/usr/bin/env node
// Aktualisiert den Suchindex (Re-Index + Embeddings) — nur wenn sich seit dem letzten erfolgreichen
// Lauf eine Notiz/Karteikarte geändert hat (sonst bremst der SessionStart-Refresh den Hinweis-Hook).
// Nie blockierend aufrufen (caller nutzt spawn/&). Erfolgsstempel: .logs/search-refreshed
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { vaultPfad } from "./pfade.mjs";
import { neuerAls } from "./neuer-als.mjs";
import { qmdBefehl } from "./qmd-befehl.mjs";

const T = dirname(fileURLToPath(import.meta.url));
// Vault als Positionsargument erlaubt (session-hintergrund.mjs ruft mit [V] auf), sonst BRAIN_VAULT/~/brain
const vault = vaultPfad();
// QMD_BIN (Tests) geht vor der Plattform-Auflösung. Endet es auf .mjs/.js, ist es ein Node-Skript und wird
// über process.execPath gestartet (Windows kann .cmd/.bat ohne shell:true nicht direkt spawnen, CVE-2024-27980) —
// sonst wie bisher direkt aufrufen, ohne vorArgs. Nie shell:true (Injektionsrisiko bei Nutzereingaben).
const b = process.env.QMD_BIN
  ? (/\.(mjs|js)$/.test(process.env.QMD_BIN) ? { cmd: process.execPath, vorArgs: [process.env.QMD_BIN] } : { cmd: process.env.QMD_BIN, vorArgs: [] })
  : qmdBefehl();
const stamp = join(vault, ".logs", "search-refreshed");

if (!neuerAls(vault, stamp)) {
  // nichts zu tun → Suche aufwärmen (Kaltstart-Timeouts)
  spawnSync(process.execPath, [join(T, "hint-warm.mjs")], { stdio: "ignore", windowsHide: true });
  process.exit(0);
}

mkdirSync(join(vault, ".logs"), { recursive: true });
const run = join(vault, ".logs", "search-refresh.running");
writeFileSync(run, "");
try {
  const schritte = [["update"], ["embed", "-c", "brain"], ["embed", "-c", "brainkarten"]];
  let ok = true;
  for (const args of schritte) {
    const r = spawnSync(b.cmd, [...b.vorArgs, ...args], { stdio: "ignore", windowsHide: true });
    if (r.error || r.status !== 0) { ok = false; break; } // fehlt qmd oder Schritt schlägt fehl → still beenden
  }
  if (ok) writeFileSync(stamp, "");
} finally {
  rmSync(run, { force: true });
}
process.exit(0);
