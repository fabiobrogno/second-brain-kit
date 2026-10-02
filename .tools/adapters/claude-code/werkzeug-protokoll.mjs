#!/usr/bin/env node
// PreToolUse-Hook: Werkzeug-Protokoll (0-Token-Regel) — hält fest, welche Dateien Read innerhalb des
// Vaults gelesen hat (Aufleuchten) und welche MCP-Werkzeuge benutzt wurden (immer, unabhängig von
// "liveAufleuchten" — das steuert nur das Aufleuchten, nicht die MCP-Protokollierung). Gibt NIE etwas
// aus (weder stdout noch stderr), Exit immer 0 — ein Fehler hier darf den Werkzeug-Aufruf nie blockieren.
// Tut nichts bei BRAIN_ERNTE=1 (Selbstaufruf-Schutz: der Ernte-Lauf darf sich nicht selbst protokollieren).
import { readFileSync } from "node:fs";
import { vaultPfad } from "../../pfade.mjs";
import { wert } from "../../einstellungen.mjs";
import { protokolliere } from "../../werkzeug-log.mjs";

function leseStdin() {
  try { return readFileSync(0, "utf8"); } catch { return ""; }
}

try {
  if (process.env.BRAIN_ERNTE !== "1") {
    const eingabe = JSON.parse(leseStdin());
    const toolName = String(eingabe?.tool_name || "");
    const istMcp = /^mcp__.+__.+$/.test(toolName);
    const vault = vaultPfad();
    if (istMcp || wert(vault, "liveAufleuchten") !== false) {
      protokolliere(vault, { sid: eingabe?.session_id, toolName, toolInput: eingabe?.tool_input });
    }
  }
} catch { /* nie blockierend, nie Ausgabe */ }
process.exit(0);
