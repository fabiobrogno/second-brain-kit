// .tools/fragen.mjs — Frontmatter-Feld `fragen:` (Treffsicherheit): 2–6 typische Fragen einer Wiki-Seite in den
// Worten der Person. Sie fließen in die Suchkarte (brain-index.mjs), damit der Hinweis bei genau diesen Fragen trifft.
// Format (eine Zeile, JSON wie `quellen`/`auch`):  fragen: ["Wie …?", "Wo steht …?"]
// Lint (brain-lint.mjs) prüft: JSON-Liste aus Texten, höchstens 6, je höchstens 160 Zeichen. Nur Standardbibliothek.

export const MAX_FRAGEN = 6;
export const MAX_FRAGE_LAENGE = 160;

// Rohwert hinter „fragen:" aus dem Frontmatter-Text (ohne ---), sonst null (Feld fehlt).
export function fragenRoh(frontmatter) {
  const m = String(frontmatter ?? "").replace(/\r\n/g, "\n").match(/^fragen:[ \t]*(.*)$/m);
  return m ? m[1].trim() : null;
}

// → { fragen: [gültige, getrimmte Texte], fehler: [Befunde] }. Fehlt das Feld (null/undefined): beides leer.
// Für die Karte zählen nur gültige Einträge; der Lint meldet jeden Befund.
export function pruefeFragen(roh) {
  if (roh == null) return { fragen: [], fehler: [] };
  const text = String(roh).trim();
  if (!text) return { fragen: [], fehler: ["leer — als JSON-Liste in einer Zeile schreiben: fragen: [\"…\", \"…\"]"] };
  let liste;
  try { liste = JSON.parse(text); } catch { return { fragen: [], fehler: ["kein gültiges JSON — Format: fragen: [\"…\", \"…\"]"] }; }
  if (!Array.isArray(liste)) return { fragen: [], fehler: ["keine Liste — Format: fragen: [\"…\", \"…\"]"] };
  const fragen = [], fehler = [];
  if (liste.length > MAX_FRAGEN) fehler.push(`${liste.length} Fragen — höchstens ${MAX_FRAGEN}`);
  liste.forEach((f, i) => {
    if (typeof f !== "string") { fehler.push(`Eintrag ${i + 1} ist kein Text`); return; }
    const t = f.replace(/\s+/g, " ").trim();
    if (!t) { fehler.push(`Eintrag ${i + 1} ist leer`); return; }
    if (t.length > MAX_FRAGE_LAENGE) { fehler.push(`Eintrag ${i + 1} hat ${t.length} Zeichen — höchstens ${MAX_FRAGE_LAENGE}`); return; }
    if (fragen.length < MAX_FRAGEN && !fragen.includes(t)) fragen.push(t);
  });
  return { fragen, fehler };
}

// Kartenzeile („Fragen: a · b") oder "" ohne gültige Fragen — Seiten ohne das Feld behalten ihre Karte byte-gleich.
export function fragenZeile(roh) {
  const { fragen } = pruefeFragen(roh);
  return fragen.length ? `Fragen: ${fragen.join(" · ")}` : "";
}
