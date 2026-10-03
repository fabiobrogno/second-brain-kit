// .tools/pii-muster.mjs — Kundendaten-Heuristik (v0.4, W1-Review #1): E-Mail, Telefonnummer, IBAN, Postanschrift.
// Gedacht für fail-closed-Filter (Lektionen, Pflege-Lauf): Trifft ein Muster, wird der ganze Text verworfen — nie
// gekürzt oder maskiert weitergegeben. Lieber eine Lektion zu wenig als eine Adresse im Vorschlag.
// Meldet nur, OB und WELCHE Art getroffen hat — nie den getroffenen Text. Nur Node-Standardbibliothek, rein.

// Telefon: international (+49 …, 0049 …) oder national mit führender 0 (0171 …, 030/…), mindestens 7 Ziffern;
// dazu jede Ziffernfolge hinter „Tel./Telefon/Handy/Mobil/Fax/Phone“. Daten (2026-10-03), Uhrzeiten und
// Versionsnummern fallen durch die Ziffernzahl bzw. das Fehlen von + / 0 am Anfang heraus.
const TEL_INTERNATIONAL = /(?<![\w.+-])(?:\+|00)\d{1,3}[\s/.-]?(?:\(0\)[\s/.-]?)?\d{1,5}(?:[\s/.-]?\d{2,}){1,5}(?![\w-])/gu;
const TEL_NATIONAL = /(?<![\w.:-])0\d{2,5}(?:\s?\/\s?|[\s-])\d{3,}(?:[\s-]?\d{2,}){0,3}(?![\w.:-])/gu;
const TEL_STICHWORT = /\b(?:tel|telefon|telephone|phone|handy|mobil|mobile|fax)\b\.?\s*(?:nr\.?\s*)?:?\s*(\+?[\d\s/().-]{6,})/giu;

export const PII_TEILMUSTER = {
  email: /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)*\.\p{L}{2,}/u,
  iban: /(?<![\p{L}\p{N}])[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{4}){3,7}(?:[ ]?[A-Z0-9]{1,3})?(?![\p{L}\p{N}])/giu,
  // Straße + Hausnummer: „Musterstraße 12“, „Hauptstr. 3a“, „Am Birkenweg 4“, „Lindenallee 7“
  strasse: /(?<![\p{L}\p{N}])\p{Lu}[\p{L}-]*(?:straße|strasse|str\.|gasse|allee|weg|platz|damm|ufer|chaussee|steig|pfad)\s+\d{1,4}\s?[a-z]?\b/u,
  strasseGetrennt: /(?<![\p{L}\p{N}])(?:\p{Lu}[\p{L}-]+\s)+(?:Straße|Strasse|Str\.|Gasse|Allee|Weg|Platz|Damm|Ufer|Chaussee)\s+\d{1,4}\s?[a-z]?\b/u,
  // PLZ + Ort nach einem Komma („…, 12345 Musterstadt“) — ohne Komma wären „10000 Zeilen“ & Co. Fehltreffer
  plzOrt: /,\s*\d{5}\s+\p{Lu}\p{Ll}{2,}/u,
};

const ziffern = (s) => (String(s).match(/\d/g) || []).length;

function hatTelefon(text) {
  for (const re of [TEL_INTERNATIONAL, TEL_NATIONAL]) {
    re.lastIndex = 0;
    for (const m of text.matchAll(re)) if (ziffern(m[0]) >= 7 && ziffern(m[0]) <= 15) return true;
  }
  TEL_STICHWORT.lastIndex = 0;
  for (const m of text.matchAll(TEL_STICHWORT)) if (ziffern(m[1]) >= 6) return true;
  return false;
}

// → Liste der getroffenen Arten (["email", "telefon", …]); leer = nichts gefunden. Nie der Text selbst.
export function findePii(text) {
  const t = String(text ?? "");
  if (!t) return [];
  const arten = [];
  if (PII_TEILMUSTER.email.test(t)) arten.push("email");
  if (hatTelefon(t)) arten.push("telefon");
  // IBAN: Länderkürzel + Prüfziffer + Kontoteil mit mindestens 12 Ziffern (DE: 20)
  if ([...t.matchAll(PII_TEILMUSTER.iban)].some(m => ziffern(m[0]) >= 12)) arten.push("iban");
  if (PII_TEILMUSTER.strasse.test(t) || PII_TEILMUSTER.strasseGetrennt.test(t) || PII_TEILMUSTER.plzOrt.test(t)) arten.push("adresse");
  return arten;
}

// Auch über Zeilenumbrüche hinweg („Tel.:⏎0171 …“): einmal roh, einmal mit zusammengezogenem Leerraum.
export function hatPii(text) {
  const t = String(text ?? "");
  return findePii(t).length > 0 || findePii(t.replace(/\s+/g, " ")).length > 0;
}
