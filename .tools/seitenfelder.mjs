// .tools/seitenfelder.mjs — Seitenfelder für Zeit und Ersetzen (B1, §4.2/§4.3): gilt_seit (JJJJ-MM-TT), ersetzt_durch
// (Wikilink auf die Nachfolgeseite), kritisch (true|false), zweifel ("<datum>: <grund>", setzt der Tageslauf nach W7).
// Lesen (Brain-Hinweis W6, Tageslauf B2) und Prüfen (Lint). Fail-safe: ein kaputtes `kritisch` gilt als kritisch —
// der Tageslauf fasst die Seite dann nie an. Nur echtes Frontmatter zählt. Rein, nur Node-Standardbibliothek.
import { entferneBom } from "./pfade.mjs";
import { datumNr } from "./gueltigkeit.mjs";

// Frontmatter-Inhalt (ohne ---) oder "" — BOM und CRLF egal; ein offenes Frontmatter zählt nicht.
export function frontmatterText(text) {
  const t = entferneBom(String(text ?? "")).replace(/\r\n?/g, "\n");
  const m = t.match(/^---\n([\s\S]*?)\n---(?:\n|$)/);
  return m ? m[1] : "";
}
function rohFeld(fm, schluessel) {
  const m = fm.match(new RegExp(`^${schluessel}:[ \\t]*(.*)$`, "m"));
  return m ? m[1].trim() : null;
}
function ohneAnfuehrung(w) {
  if (w.startsWith("\"")) { try { const j = JSON.parse(w); return typeof j === "string" ? j : ""; } catch { return ""; } }
  if (w.length >= 2 && w.startsWith("'") && w.endsWith("'")) return w.slice(1, -1).replace(/''/g, "'");
  return w;
}

// "[[ziel]]", "[[ziel|Text]]", "[[ziel#Abschnitt]]" → "ziel"; sonst "" (kein einzelner gültiger Wikilink).
export function linkZiel(wert) {
  const m = /^\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]$/.exec(String(wert ?? "").trim());
  return m ? m[1].trim() : "";
}

export function leseSeitenFelder(text) {
  const fm = frontmatterText(text);
  const roh = { giltSeit: rohFeld(fm, "gilt_seit"), ersetztDurch: rohFeld(fm, "ersetzt_durch"), kritisch: rohFeld(fm, "kritisch"), zweifel: rohFeld(fm, "zweifel") };
  const gs = roh.giltSeit === null ? null : ohneAnfuehrung(roh.giltSeit);
  const zw = roh.zweifel === null ? "" : ohneAnfuehrung(roh.zweifel).trim();
  return {
    giltSeit: gs !== null && datumNr(gs) !== null ? gs : null,
    ersetztDurch: roh.ersetztDurch === null ? null : linkZiel(ohneAnfuehrung(roh.ersetztDurch)),
    kritisch: roh.kritisch !== null && roh.kritisch !== "false",
    zweifel: zw || null,
    roh,
  };
}

// Formatfehler (blockierend im Lint). Ob der Nachfolger existiert, prüft der Lint (braucht die Seitenliste).
export function pruefeSeitenFelder(text) {
  const f = leseSeitenFelder(text);
  const befunde = [];
  if (f.roh.kritisch !== null && f.roh.kritisch !== "true" && f.roh.kritisch !== "false") {
    befunde.push({ klasse: "KRITISCH", meldung: "kritisch muss true oder false sein (ohne Anführungszeichen) — bis dahin gilt die Seite als kritisch" });
  }
  if (f.roh.giltSeit !== null && f.giltSeit === null) befunde.push({ klasse: "GILT_SEIT", meldung: "gilt_seit ist kein gültiges Datum JJJJ-MM-TT" });
  if (f.ersetztDurch === "") befunde.push({ klasse: "ERSETZT", meldung: "ersetzt_durch ist kein Wikilink — Format: ersetzt_durch: \"[[nachfolger]]\"" });
  return befunde;
}
