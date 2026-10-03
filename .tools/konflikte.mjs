// .tools/konflikte.mjs — liest offene Konflikt-Kästen aus einer Wiki-Seite (Spec v0.4, Baustein B). Rein, liest nichts.
// Format (wiki/_schema.md), Einrückung erlaubt:
//   > [!KONFLIKT] offen — Du entscheidest
//   > A: "<Aussage>" — Quelle: [[pfad-a]]
//   > B: "<Aussage>" — Quelle: [[pfad-b]]
// Toleriert (W1-Review #13): Obsidian-Faltung `[!KONFLIKT]-`/`[!KONFLIKT]+`, `**A:**`/`**A**:`, Listenpunkt
// `> - A:`, kleines `a:`/`b:`, eine Leerzeile mitten im Kasten, „Quellen:“ mit mehreren Links (die erste zählt).
// Ergebnis: [{ nr, a: { text, quelle }, b: { text, quelle }, zeile, fp }]
//   nr    = laufende Nummer aller offenen Kästen der Seite (1, 2, …) in Dokumentreihenfolge — ein kaputter
//           Kasten behält seine Nummer (wird aber übersprungen), damit die Nummern der übrigen stabil bleiben;
//   zeile = 1-basierte Zeile der [!KONFLIKT]-Kopfzeile; quelle = Ziel des ersten [[Links]] (ohne |Alias) oder null;
//   fp    = Fingerabdruck der beiden Aussagen (12 Hex-Zeichen) — bleibt gleich, wenn andere Kästen dazukommen
//           oder wegfallen; daran hängt eine Entscheidung, nicht an der nr (W1-Review #5).
// Kaputt (übersprungen, aber gezählt): A oder B fehlt bzw. ohne Aussage. Kästen in Codeblöcken zählen nicht; ein
// Codeblock endet erst mit einem Zaun derselben Zeichenart und mindestens gleicher Länge (```` umschließt ```).
import { createHash } from "node:crypto";
import { entferneBom } from "./pfade.mjs";

const KOPF = /^\s*>\s*\[!KONFLIKT\][-+]?\s*offen\b/i;
const AB = /^\s*>\s*(?:[-*+]\s+)?(?:\*\*|__)?([AaBb])(?:\*\*|__)?\s*:(?:\*\*|__)?\s*(.*)$/;
const ZAUN = /^\s*(`{3,}|~{3,})/;
const MAX_TEXT = 1000;

function seite(rest) {
  const teile = rest.split(/\s+[—–-]{1,2}\s+(?:\*\*|__)?Quellen?(?:\*\*|__)?:\s*/i);
  let text = teile[0].trim();
  // umschließende Anführungszeichen weg: "…", „…“, “…”, »…«
  const q = text.match(/^(?:"([\s\S]*)"|„([\s\S]*)[“”"]|“([\s\S]*)”|»([\s\S]*)«)$/);
  if (q) text = (q[1] ?? q[2] ?? q[3] ?? q[4]).trim();
  if (text.length > MAX_TEXT) text = text.slice(0, MAX_TEXT - 1) + "…";
  let quelle = null;
  if (teile.length > 1) {
    const rest2 = teile.slice(1).join(" ");
    const l = rest2.match(/\[\[([^\]|#]+)(?:[#|][^\]]*)?\]\]/);
    quelle = l ? l[1].trim() : (rest2.split(/\s*,\s*/)[0].trim() || null);
  }
  return text ? { text, quelle } : null;
}

// Fingerabdruck eines Kastens aus den beiden Aussagen (Leerraum vereinheitlicht).
export function fingerabdruck(a, b) {
  const t = (x) => String((x && typeof x === "object" ? x.text : x) ?? "").replace(/\s+/g, " ").trim();
  return createHash("sha256").update(`${t(a)}\n${t(b)}`).digest("hex").slice(0, 12);
}

// → { konflikte: [...wie oben], kaputt: Zahl der Kästen ohne A oder B }
export function konfliktKaesten(markdownText) {
  const zeilen = entferneBom(String(markdownText ?? "")).split(/\r?\n/);
  const out = [];
  let nr = 0, kaputt = 0, zaun = null; // zaun = { zeichen, laenge } solange ein Codeblock offen ist
  for (let i = 0; i < zeilen.length; i++) {
    const z = ZAUN.exec(zeilen[i]);
    if (z) {
      if (!zaun) { zaun = { zeichen: z[1][0], laenge: z[1].length }; continue; }
      if (z[1][0] === zaun.zeichen && z[1].length >= zaun.laenge && /^\s*[`~]+\s*$/.test(zeilen[i])) { zaun = null; continue; }
    }
    if (zaun || !KOPF.test(zeilen[i])) continue;
    nr++;
    let a = null, b = null;
    for (let j = i + 1; j < zeilen.length && !KOPF.test(zeilen[j]); j++) {
      if (!/^\s*>/.test(zeilen[j])) {
        // eine Leerzeile mitten im Kasten: weiter, wenn direkt danach die fehlende A/B-Zeile folgt
        if (!zeilen[j].trim() && (!a || !b) && j + 1 < zeilen.length && AB.test(zeilen[j + 1])) continue;
        break;
      }
      const m = zeilen[j].match(AB);
      if (!m) continue;
      const wer = m[1].toUpperCase();
      if (wer === "A" && !a) a = seite(m[2]);
      else if (wer === "B" && !b) b = seite(m[2]);
    }
    if (a && b) out.push({ nr, a, b, zeile: i + 1, fp: fingerabdruck(a, b) });
    else kaputt++;
  }
  return { konflikte: out, kaputt };
}

export function konflikte(markdownText) {
  return konfliktKaesten(markdownText).konflikte;
}
