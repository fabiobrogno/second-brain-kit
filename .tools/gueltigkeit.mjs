// .tools/gueltigkeit.mjs — Gültigkeit einer Seite aus ihrem Frontmatter (Spec v0.4, Baustein A). Rein, liest nichts.
// Felder (alle optional): `stand: YYYY-MM-DD` (Wissensstand, nur Anzeige), `pruefen_bis: YYYY-MM-DD` (absolute
// Frist), `verfall: <Tage>` (relativ zum letzten Commit der Seite — ohne Commit-Zeit nicht auswertbar).
// Ergebnis: { status: "ok"|"bald"|"abgelaufen"|"ohne", stand, pruefenBis, tageUeber, grund }
//   abgelaufen = pruefen_bis < heute ODER (Commit-Tag + `verfall`) < heute — beides in Kalendertagen (lokal);
//   bald       = Frist in ≤ 14 Tagen (auch: Frist ist heute — heute gilt noch nicht als abgelaufen);
//   ohne       = keine auswertbare Frist (keine Felder, ungültige Daten, `verfall` ohne Commit).
//   pruefenBis = maßgebliche Frist als YYYY-MM-DD (bei `verfall`: Commit-Tag + Tage), grund = "pruefen_bis"|"verfall".
// Bei beiden Feldern zählt die strengere Frist (die weiter überschrittene bzw. die frühere).
import { entferneBom } from "./pfade.mjs";

export const BALD_TAGE = 14;
const TAG_MS = 86400000;

// Kalendertag (lokale Zeit) als fortlaufende Tageszahl — DST-fest über Date.UTC
const tagNr = (j, m, t) => Math.round(Date.UTC(j, m - 1, t) / TAG_MS);
const lokalerTag = (ms) => { const d = new Date(ms); return tagNr(d.getFullYear(), d.getMonth() + 1, d.getDate()); };
const alsDatum = (nr) => new Date(nr * TAG_MS).toISOString().slice(0, 10);

// "YYYY-MM-DD" → Tageszahl, sonst null (auch 2026-02-30 oder "morgen")
export function datumNr(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s ?? "").trim());
  if (!m) return null;
  const j = +m[1], mo = +m[2], t = +m[3];
  const d = new Date(Date.UTC(j, mo - 1, t));
  if (d.getUTCFullYear() !== j || d.getUTCMonth() !== mo - 1 || d.getUTCDate() !== t) return null;
  return tagNr(j, mo, t);
}

// Akzeptiert das ganze Markdown (mit ---…---) oder nur den Frontmatter-Inhalt; BOM und CRLF egal.
function feld(text, schluessel) {
  const t = entferneBom(String(text ?? "")).replace(/\r\n?/g, "\n");
  const block = t.startsWith("---\n") ? (t.match(/^---\n([\s\S]*?)\n---(?:\n|$)/) || [, ""])[1] : t;
  const m = block.match(new RegExp("^" + schluessel + ":[ \\t]*(.*)$", "m"));
  return m ? m[1].replace(/\s+#.*$/, "").trim().replace(/^["']|["']$/g, "") : null;
}

export function gueltigkeit(frontmatterText, { letzterCommitMs = null, jetzt = Date.now() } = {}) {
  const heute = lokalerTag(jetzt);
  const standNr = datumNr(feld(frontmatterText, "stand"));
  const stand = standNr == null ? null : alsDatum(standNr);
  const kandidaten = []; // { frist (Tageszahl), ueber (Tage), grund }

  const pbNr = datumNr(feld(frontmatterText, "pruefen_bis"));
  if (pbNr != null) kandidaten.push({ frist: pbNr, ueber: heute - pbNr, grund: "pruefen_bis" });

  const vRoh = feld(frontmatterText, "verfall");
  const verfall = vRoh != null && /^\d+$/.test(vRoh) ? Number(vRoh) : 0;
  const commit = Number(letzterCommitMs);
  if (verfall > 0 && Number.isFinite(commit) && commit > 0) {
    // Kalendertage wie bei pruefen_bis (W1-Review #10): Frist = Commit-Tag + verfall; abgelaufen ab dem Tag danach.
    // Status und angezeigte Frist kippen damit gemeinsam um Mitternacht, nicht zur Uhrzeit des Commits.
    const frist = lokalerTag(commit) + verfall;
    kandidaten.push({ frist, ueber: heute - frist, grund: "verfall" });
  }

  if (!kandidaten.length) return { status: "ohne", stand, pruefenBis: null, tageUeber: 0, grund: null };
  // strengste Frist: größte Überschreitung (bei Gleichstand die frühere Frist)
  kandidaten.sort((a, b) => b.ueber - a.ueber || a.frist - b.frist);
  const k = kandidaten[0];
  const status = k.ueber > 0 ? "abgelaufen" : -k.ueber <= BALD_TAGE ? "bald" : "ok";
  return { status, stand, pruefenBis: alsDatum(k.frist), tageUeber: Math.max(0, k.ueber), grund: k.grund };
}
