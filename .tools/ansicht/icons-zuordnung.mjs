// .tools/ansicht/icons-zuordnung.mjs — reine Zuordnungslogik MCP-Servername → Simple-Icons-Slug.
// Keine Datei-/Netzwerkzugriffe hier: `zuordnung` (Inhalt von vendor/icons/zuordnung.json) wird übergeben,
// nicht selbst gelesen. Dieselbe Logik liegt als klassisches Skript-Duplikat in `icons.js` (Browser, ohne
// ESM-Import geladen) — Test `test-icons.mjs` prüft, dass beide Kopien bei denselben Eingaben übereinstimmen.
//
// normalisiere(): Präfix `claude_ai_` (Herkunft der claude.ai-Connector-Namen) ab, dann Vor-/Nachsilbe
// `mcp-`/`-mcp` (viele MCP-Pakete heißen `<dienst>-mcp` oder `mcp-<dienst>`), dann Ziffern-Rauschen (siehe
// unten), danach alle restlichen Trennzeichen raus (übrig bleiben a–z und die Ziffern, die als Teil einer
// Marke überlebt haben, z. B. "n8n") — Groß-/Kleinschreibung ist davor schon vereinheitlicht. Dasselbe
// Verfahren läuft über die Schlüssel der Zuordnung; verglichen wird nur an Wortgrenzen des Originalnamens
// (woerter(): Trenner und CamelCase) — kein Teilwort-Treffer; bei mehreren Treffern gewinnt der LÄNGSTE
// normalisierte Schlüssel (spezifischer schlägt allgemein, z. B.
// "googlecalendar" vor "google"). Kein Treffer → null (Aufrufer zeigt dann ein Monogramm, siehe
// icons.js#monogramm).
function entferneZiffernRauschen(s) {
  return s.replace(/[0-9]+/g, (treffer, pos) => {
    const vor = s[pos - 1];
    const nach = s[pos + treffer.length];
    const vorBuchstabe = vor != null && /[a-z]/.test(vor);
    const nachBuchstabe = nach != null && /[a-z]/.test(nach);
    return vorBuchstabe && nachBuchstabe ? treffer : "";
  });
}

export function normalisiere(name) {
  if (typeof name !== "string") return "";
  let s = name.toLowerCase();
  if (s.startsWith("claude_ai_")) s = s.slice("claude_ai_".length);
  if (s.startsWith("mcp-")) s = s.slice(4);
  if (s.endsWith("-mcp")) s = s.slice(0, -4);
  s = entferneZiffernRauschen(s);
  return s.replace(/[^a-z0-9]/g, "");
}

// Wörter des Originalnamens: Trenner (_ - . Leerzeichen …) und CamelCase-Grenzen („GoogleCalendar“ → google,
// calendar); Präfix claude_ai_ und ein „mcp“ am Anfang/Ende fallen weg, Ziffern-Rauschen wie in normalisiere().
export function woerter(name) {
  if (typeof name !== "string") return [];
  let s = name.replace(/^claude_ai_/i, "").replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
  s = entferneZiffernRauschen(s);
  const w = s.split(/[^a-z0-9]+/).filter(Boolean);
  if (w.length > 1 && w[0] === "mcp") w.shift();
  if (w.length > 1 && w[w.length - 1] === "mcp") w.pop();
  return w;
}

// Ein Schlüssel trifft nur an Wortgrenzen: er muss genau einer Folge ganzer Wörter entsprechen („Meta_Ads“ → meta,
// „Google_Calendar“ → googlecalendar), nie einem Wortteil („metabase“, „pinstripe“, „notional“ → kein Logo).
export function iconFuer(name, zuordnung) {
  const w = woerter(name);
  if (!w.length || !zuordnung || typeof zuordnung !== "object") return null;
  const folgen = new Set();
  for (let i = 0; i < w.length; i++) {
    let f = "";
    for (let j = i; j < w.length; j++) { f += w[j]; folgen.add(f); }
  }
  let bester = null;
  let besteLaenge = 0;
  for (const [schluessel, slug] of Object.entries(zuordnung)) {
    if (typeof slug !== "string" || !slug) continue;
    const k = normalisiere(schluessel);
    if (!k) continue;
    if (folgen.has(k) && k.length > besteLaenge) { bester = slug; besteLaenge = k.length; }
  }
  return bester;
}
