// Vorige echte User-Nachricht aus dem Claude-Code-Transkript (JSONL) — für Folgefragen wie „und beim zweiten?".
// Liest nur die letzten 256 KB, rückwärts; Tool-Results (Array-Inhalt), Befehle (<…>, /…) und halbe Zeilen zählen nicht.
// Wirft nie; speichert und loggt nichts.
import { openSync, readSync, fstatSync, closeSync } from "node:fs";

export function vorigeFrage(pfad, aktuell, maxBytes = 262144) {
  let fd;
  try {
    fd = openSync(pfad, "r");
    const groesse = fstatSync(fd).size, start = Math.max(0, groesse - maxBytes);
    const buf = Buffer.alloc(groesse - start); readSync(fd, buf, 0, buf.length, start);
    const zeilen = buf.toString("utf8").split("\n");
    if (start > 0) zeilen.shift();                       // erste Zeile ist abgeschnitten
    const jetzt = String(aktuell || "").trim();
    for (let i = zeilen.length - 1; i >= 0; i--) {
      let m; try { m = JSON.parse(zeilen[i]); } catch { continue; }
      if (m?.isMeta || m?.isCompactSummary) continue;
      const c = m?.type === "user" ? m.message?.content : null;
      if (typeof c !== "string") continue;
      const t = c.trim();
      if (!t || t === jetzt || t.startsWith("<") || t.startsWith("/")) continue;
      return t;
    }
    return null;
  } catch { return null; } finally { if (fd !== undefined) try { closeSync(fd); } catch {} }
}
