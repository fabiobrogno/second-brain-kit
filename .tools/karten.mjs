// Karten-Hygiene: nur Begriffe mit Aussagewert in die Karteikarte — Etiketten („Shops:") und Füllwörter
// heben sonst das Grundrauschen der Vektorsuche (Befund 23.09.2026: Kontrolle 27 → 25/30).
const STOPP = new Set(["kein", "keine", "soll", "alle", "neuen", "neue", "nicht", "immer", "nur", "auch", "oder", "und",
  "eine", "einer", "einen", "der", "die", "das", "ist", "sind", "mit", "ohne", "vor", "nach", "wird", "werden"]);
const LEER_ABSCHNITTE = /^(verwandt|einstieg( in die details)?|quellen?|siehe auch)$/i;

export function saubereBegriffe(liste) {
  const out = [];
  for (const roh of liste) {
    let b = String(roh).replace(/\s+/g, " ").replace(/\s*\d+\.$/, "").replace(/^[\s,.;:–-]+|[\s,.;–-]+$/g, "").trim();
    // „Shops:" (≤ 2 Wörter) ist ein Etikett → weg; „Grüner Deploy beweist nichts:" ist eine Aussage → ohne Doppelpunkt behalten
    if (/:$/.test(b)) { if (b.split(" ").length <= 2) continue; b = b.replace(/:+$/, "").trim(); }
    if (!b) continue;
    const akronym = /^[A-ZÄÖÜ0-9]{2,6}$/.test(b);
    if (!akronym && (b.length < 4 || STOPP.has(b.toLowerCase()))) continue;
    if (!out.includes(b)) out.push(b);
  }
  return out;
}

export function saubereAbschnitte(liste) {
  return liste.map(s => String(s).trim()).filter(s => s && !LEER_ABSCHNITTE.test(s));
}

// Dünne Karten (Tabellen-/Listenseiten ohne Fettbegriffe): Inhalte aus Tabellenzellen und Listenpunkten,
// sonst dominiert die Beschreibung den Vektor (Befund 23.09.2026: repo-landschaft zog jede git-Frage).
// Tabellen-Kopfzeilen (vor der |---|-Zeile) und reine Daten/Zahlen fliegen raus.
export function inhaltsBegriffe(body) {
  const roh = [];
  const zeilen = String(body).split("\n");
  for (let i = 0; i < zeilen.length; i++) {
    const z = zeilen[i].trim();
    if (/^\|.*\|$/.test(z)) {
      if (/^\|[\s|:-]+\|$/.test(z) || /^\|[\s|:-]+\|$/.test((zeilen[i + 1] || "").trim())) continue;
      roh.push(...z.slice(1, -1).split("|"));
    } else if (/^[-*]\s+/.test(z)) {
      roh.push(z.replace(/^[-*]\s+/, "").replace(/\*\*[^*]*\*\*/g, ""));
    }
  }
  const teile = roh.flatMap(c => c.replace(/[`*[\]]/g, "").split(/,\s+|\s+·\s+/)).map(t => t.trim()).filter(t => /\p{L}/u.test(t) && t.length <= 60);
  return saubereBegriffe(teile);
}
