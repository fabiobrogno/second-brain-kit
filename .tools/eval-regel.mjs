// Positiv-Regel der Hinweis-Abnahme: nicht mehr Fehlschläge als der letzte BESTANDENE Lauf
// (sonst wird jede Verschlechterung zur neuen Latte), und ziel.positiv ist immer Untergrenze.
// basisFehler: expliziter, datierter Maßstab aus hint-eval.json (ziel.basis) — geht dem Log vor
export function positivOk({ pos, n, zielPositiv, logText, basisFehler }) {
  if (pos < zielPositiv) return false;
  if (typeof basisFehler === "number") return n - pos <= basisFehler;
  const laeufe = String(logText || "").split("\n").filter(z => z.startsWith("hint-eval ") && !/ ok=0\b/.test(z));
  const m = laeufe.pop()?.match(/positiv=(\d+)\/(\d+)/);
  if (!m) return true;
  return n - pos <= +m[2] - +m[1];
}
