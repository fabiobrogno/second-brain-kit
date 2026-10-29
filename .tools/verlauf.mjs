// .tools/verlauf.mjs — gemeinsame Helfer für Claude-Code-Verlaufszeilen (JSONL).
// Kaputte oder halbe Zeilen sind kein Fehler: sie fallen weg.
export function parseZeile(roh) {
  if (roh && typeof roh === "object" && !Array.isArray(roh)) return roh;
  try { const o = JSON.parse(String(roh ?? "")); return o && typeof o === "object" && !Array.isArray(o) ? o : null; }
  catch { return null; }
}
