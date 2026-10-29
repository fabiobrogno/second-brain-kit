// .tools/aliasse.mjs — Entitäts-Aliasse (B1, §4.5): Frontmatter `auch_genannt: ["nucleus", "nucleus-base"]` (eine Zeile,
// JSON wie `fragen`). brain-index baut daraus .logs/aliasse.json (Name → Seiten, fürs Einordnen im Tageslauf B2) und die
// Kartenzeile „Auch genannt: …“; der Lint prüft das Format (ALIAS, blockierend) und meldet Namen, die über einen Alias
// auf mehrere Seiten zeigen (DOPPELTER NAME, nur Normalmodus). Rein, nur Node-Standardbibliothek.
export const MAX_ALIASSE = 10;
export const MAX_ALIAS_LAENGE = 60;
const TYP_PRAEFIX = /^(?:thema|entitaet|synthese|quelle)_/;
const FORMAT = "Format: auch_genannt: [\"…\", \"…\"]";

export function auchGenanntRoh(frontmatter) {
  const m = String(frontmatter ?? "").replace(/\r\n?/g, "\n").match(/^auch_genannt:[ \t]*(.*)$/m);
  return m ? m[1].trim() : null;
}

export function pruefeAuchGenannt(roh) {
  if (roh == null) return { aliase: [], fehler: [] };
  const text = String(roh).trim();
  if (!text) return { aliase: [], fehler: [`leer — ${FORMAT}`] };
  let liste;
  try { liste = JSON.parse(text); } catch { return { aliase: [], fehler: [`kein gültiges JSON — ${FORMAT}`] }; }
  if (!Array.isArray(liste)) return { aliase: [], fehler: [`keine Liste — ${FORMAT}`] };
  const aliase = [], fehler = [];
  if (liste.length > MAX_ALIASSE) fehler.push(`${liste.length} Namen — höchstens ${MAX_ALIASSE}`);
  liste.forEach((a, i) => {
    if (typeof a !== "string") { fehler.push(`Eintrag ${i + 1} ist kein Text`); return; }
    const t = a.replace(/\s+/g, " ").trim();
    if (!t) { fehler.push(`Eintrag ${i + 1} ist leer`); return; }
    if (t.length > MAX_ALIAS_LAENGE) { fehler.push(`Eintrag ${i + 1} hat ${t.length} Zeichen — höchstens ${MAX_ALIAS_LAENGE}`); return; }
    if (aliase.length < MAX_ALIASSE && !aliase.includes(t)) aliase.push(t);
  });
  return { aliase, fehler };
}

export function normalisiereName(s) {
  return String(s ?? "").normalize("NFC").toLowerCase()
    .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
    .replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "");
}
// Eigener Name einer Seite: `name:` aus dem Frontmatter, sonst Dateiname — ohne Typ-Präfix, normalisiert.
export function eigenerName(id, fmName = "") {
  const basis = String(fmName ?? "").trim() || String(id ?? "").split("/").pop().replace(/\.md$/i, "");
  return normalisiereName(basis.replace(TYP_PRAEFIX, ""));
}

export function aliasIndex(seiten) {
  const proSeite = {}, namen = new Map();
  const dazu = (n, id) => { if (!n) return; if (!namen.has(n)) namen.set(n, new Set()); namen.get(n).add(id); };
  for (const s of [...(Array.isArray(seiten) ? seiten : [])].sort((a, b) => a.id.localeCompare(b.id))) {
    const aliase = [...new Set((s.aliase || []).map(normalisiereName).filter(Boolean))].sort();
    if (aliase.length) proSeite[s.id] = aliase;
    dazu(normalisiereName(s.name), s.id);
    for (const a of aliase) dazu(a, s.id);
  }
  return { version: 1, seiten: proSeite, namen: Object.fromEntries([...namen.keys()].sort().map((k) => [k, [...namen.get(k)].sort()])) };
}

// Nur Gruppen, an denen ein Alias beteiligt ist — reine Dateinamen-Dubletten meldet der Lint schon über doppelteNamen.
export function aliasDubletten(index) {
  const out = [];
  for (const [name, ids] of Object.entries(index?.namen || {})) {
    if (ids.length < 2 || !ids.some((id) => (index.seiten?.[id] || []).includes(name))) continue;
    out.push({ name, ids });
  }
  return out;
}

export function aliasZeile(roh) {
  const { aliase } = pruefeAuchGenannt(roh);
  return aliase.length ? `Auch genannt: ${aliase.join(" · ")}` : "";
}
