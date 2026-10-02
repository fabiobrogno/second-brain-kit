// Kindprozess für die Hinweis-Suche: isoliert QMD/SQLite/llama.cpp vollständig. Synchrones Blockieren
// (gesperrte DB) oder ein nativer Absturz beim Prozessende (llama.cpp) treffen nur diesen Prozess, nie den Hook.
// Eingabe per stdin (Prompt nie in der Prozessliste), Ausgabe: eine JSON-Zeile auf stdout.
import { readFileSync } from "node:fs";
const { modulUrl, query, opts } = JSON.parse(readFileSync(0, "utf8"));
let out;
try { const { sucheKarten } = await import(modulUrl); out = { ok: true, results: await sucheKarten(query, opts) }; }
catch (e) { out = { ok: false, code: e.code || e.name || "unbekannt" }; }
process.stdout.write(JSON.stringify(out) + "\n", () => process.exit(0));
