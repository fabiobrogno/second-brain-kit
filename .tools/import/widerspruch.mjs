// .tools/import/widerspruch.mjs — Widerspruchs-Kandidaten zwischen zwei Notizen derselben Sache.
// Verglichen werden nur Sätze mit gemeinsamem Schlüsselwort (≥ 5 Zeichen, kein Stoppwort) und ähnlichem
// „Satzrahmen“ (der Satz ohne Zahlen/Daten/Versionen/Ja-Nein-Wörter). Widerspruch, wenn sich im selben Rahmen
// Datum, Version, Zahl/Betrag oder die Ja/Nein-Richtung unterscheiden. Entschieden wird nie — nur gemeldet.
// Zahlen werden numerisch verglichen („1.000 €“ = „1000 €“, „49,00“ = „49“); „an“/„aus“ zählen nur als Aussage,
// „nicht/kein“ davor kehrt die Richtung um; „Kapitel 3“ ist eine Bezeichnung, kein Wert.

const STOPP = new Set(("aber alles allem allen aller alles also andere anderen andern anders auch dabei damit dann "
  + "darauf darum dass deine deinem deinen deiner dem den denn derem deren derer dessen diese diesem diesen dieser "
  + "dieses doch dort durch eine einem einen einer eines einige einigen einiger etwas euer eure eurem euren eurer "
  + "gegen gewesen haben hatte hatten hier hinter immer indem infolge jede jedem jeden jeder jedes jener jetzt kann "
  + "keine keinem keinen keiner kommt koennen können machen manche mehr meine meinem meinen meiner muss nach nicht "
  + "nichts noch nun nur ohne sehr sein seine seinem seinen seiner selbst sich sind solche sollte sondern sowie "
  + "ueber über unter viel vielleicht vom von vor wann warum weil welche welchem welchen welcher welches wenn werde "
  + "werden wieder will wird wurde wurden zwischen about after again their there these those which while would "
  + "where other could should because before being").split(" "));
const POSITIV = new Set(["ja", "aktiv", "an", "true", "eingeschaltet", "aktiviert"]);
const NEGATIV = new Set(["nein", "inaktiv", "aus", "false", "ausgeschaltet", "deaktiviert"]);
// „an“/„aus“ sind meist Präpositionen („an den See“, „aus dem Haus“) — sie zählen nur als Aussage am Satzende
// bzw. vor einem Satzzeichen oder direkt nach „ist/sind/bleibt …“.
const NUR_PRAEDIKAT = new Set(["an", "aus"]);
const KOPULA = new Set(["ist", "sind", "bleibt", "bleiben", "war", "waren", "steht", "stehen", "bleibe", "is", "are", "was", "were"]);
// „nicht aktiv“, „kein Backup aktiv“ → Richtung umgekehrt.
const VERNEINUNG = new Set(["nicht", "kein", "keine", "not", "no"]);
// Zahl direkt nach einem Ordnungswort ist eine Bezeichnung („Kapitel 3“), kein Wert → gehört zum Satzrahmen.
const ORDNUNGSWORT = new Set(["kapitel", "abschnitt", "teil", "schritt", "punkt", "seite", "band", "folge", "nummer", "nr",
  "raum", "zimmer", "gleis", "tag", "woche", "chapter", "section", "part", "step", "page", "room", "no"]);
// Wörter, die ein Datum nur einleiten („Stand 2026-07-30“) — sie sagen nichts über das Subjekt des Satzes.
const DATUMSWORT = new Set(["stand", "datum", "am", "seit", "bis", "vom", "ab", "update", "updated", "aktualisiert", "geändert",
  "geaendert", "erstellt", "zuletzt", "date", "since", "until", "on", "as", "of"]);
// Wörter, aus denen reine Navigationszeilen („Vorheriger Tag: … · Nächster Tag: …“) bestehen.
const NAVIGATIONSWORT = new Set(["vorheriger", "vorherige", "vorheriges", "vorherigen", "nächster", "nächste", "nächstes",
  "nächsten", "naechster", "naechste", "naechstes", "zurück", "zurueck", "weiter", "tag", "woche", "monat", "eintrag", "notiz",
  "seite", "übersicht", "uebersicht", "heute", "gestern", "morgen", "previous", "prev", "next", "back", "day", "week", "month",
  "entry", "note", "page", "index", "home", "up", "hoch", "inhalt"]);
const MAX_JE_PAAR = 10;
const RAHMEN_SCHWELLE = 0.5;

const R_DATUM = /(?<![\p{N}.])(\d{1,2})\.(\d{1,2})\.(\d{4}|\d{2})(?![\p{N}])|(?<![\p{N}])(\d{4})-(\d{2})-(\d{2})(?![\p{N}])/gu;
const R_URL = /(?:https?:\/\/|www\.)[^\s<>"')\]|]+/giu;
const R_VERSION = /(?<![\p{L}\p{N}.])v(\d+(?:\.\d+){1,2})(?![\p{N}])|(?<![\p{L}\p{N}.])(\d+\.\d+\.\d+)(?![\p{N}.])/giu;
const R_VERSION_WORT = /(?<![\p{L}\p{N}.])(\d+\.\d+)(?![\p{N}.])/gu;
const R_ZAHL = /(?<![\p{L}\p{N}])((?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d+|\.\d+)?)\s?(€|euro(?![\p{L}])|eur(?![\p{L}])|%|mb(?![\p{L}])|gb(?![\p{L}]))?/giu;
const R_ORDNUNG = /(?<![\p{L}\p{N}])(\p{L}+)\.?\s+(\d+)(?![\p{N}]|[.,]\p{N})/gu;

// „1.000“ → 1000, „49,00“ → 49, „1,5“ → 1.5, „1.5“ → 1.5 — numerisch vergleichbar.
export function zahlWert(roh) {
  let t = String(roh);
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(t)) t = t.replace(/\./g, "");
  const n = parseFloat(t.replace(",", "."));
  return Number.isFinite(n) ? String(n) : t;
}

// Rumpf → Sätze (ohne Markdown-Zeichen am Zeilenanfang, Wikilinks als Anzeigetext).
export function saetze(text) {
  const out = [];
  const sauber = String(text).replace(/\r\n?/g, "\n").replace(/`{3}[\s\S]*?`{3}/g, "\n")
    .replace(/!?\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2").replace(/!?\[\[([^\]]+)\]\]/g, "$1");
  for (const zeile of sauber.split("\n")) {
    const z = zeile.replace(/^\s*(#{1,6}\s+|[-*+]\s+(\[[ xX]\]\s+)?|\d+[.)]\s+|>\s*)/, "").replace(/[*_]{2}/g, "").trim();
    if (!z) continue;
    for (const s of z.split(/(?<=[.!?])\s+(?=[\p{Lu}\p{N}"„(])/u)) if (s.trim()) out.push(s.trim());
  }
  return out;
}

// Ein Satz → Werte je Art, Ja/Nein-Richtung, Rahmen-Wörter und Schlüsselwörter.
export function werteAus(satz) {
  let rest = String(satz).normalize("NFC").toLowerCase();
  const datum = [], version = [], zahl = [], urls = [];
  // URLs vor allem anderen heraus: ihre Zahlen/Daten sind Teil der Adresse, kein Wert des Satzes.
  rest = rest.replace(R_URL, (u) => { urls.push(u.replace(/[.,;:!?]+$/, "")); return " "; });
  rest = rest.replace(R_DATUM, (_, t, m, j, J, M, T) => {
    if (J) datum.push(`${J}-${M}-${T}`);
    else datum.push(`${j.length === 2 ? "20" + j : j}-${m.padStart(2, "0")}-${t.padStart(2, "0")}`);
    return " ";
  });
  rest = rest.replace(R_VERSION, (_, a, b) => { version.push(a || b); return " "; });
  if (/(?<![\p{L}])(version|release|stand)(?![\p{L}])/u.test(rest)) rest = rest.replace(R_VERSION_WORT, (_, a) => { version.push(a); return " "; });
  // Bezeichnungen („Kapitel 3“) vor den Werten herausnehmen und als ein Rahmen-Wort behalten.
  const bezeichnungen = [];
  rest = rest.replace(R_ORDNUNG, (m, wort, n) => {
    if (!ORDNUNGSWORT.has(wort)) return m;
    bezeichnungen.push(`${wort}#${n}`);
    return ` ${wort} `;
  });
  rest = rest.replace(R_ZAHL, (_, n, einheit) => {
    const e = !einheit ? "" : /^eur/.test(einheit) ? "€" : einheit;
    zahl.push(zahlWert(n) + e);
    return " ";
  });
  // Ja/Nein mit Satzzeichen-Kontext: Wörter samt „steht vor Satzzeichen/Satzende“.
  const tokens = [...rest.matchAll(/([\p{L}\p{N}]+)|([.!?;:,]+)/gu)];
  let pos = false, neg = false;
  const rahmen = [...bezeichnungen];
  for (let i = 0; i < tokens.length; i++) {
    const w = tokens[i][1];
    if (!w) continue;
    const wort = w;
    if (POSITIV.has(wort) || NEGATIV.has(wort)) {
      const vor = tokens[i - 1]?.[1], vorvor = tokens[i - 2]?.[1];
      const danach = tokens[i + 1];
      if (NUR_PRAEDIKAT.has(wort)) {
        const amEnde = !danach || !!danach[2];
        const nachKopula = KOPULA.has(vor) || (VERNEINUNG.has(vor) && KOPULA.has(vorvor));
        if (!amEnde && !nachKopula) { rahmen.push(wort); continue; }
      }
      let r = POSITIV.has(wort) ? 1 : -1;
      if (VERNEINUNG.has(vor)) { r = -r; const k = rahmen.lastIndexOf(vor); if (k >= 0) rahmen.splice(k, 1); }
      if (r > 0) pos = true; else neg = true;
      continue;
    }
    rahmen.push(wort);
  }
  const richtung = pos && !neg ? 1 : neg && !pos ? -1 : 0;
  const schluessel = [...new Set(rahmen.filter(w => w.length >= 5 && !w.includes("#") && !STOPP.has(w) && !/^\p{N}+$/u.test(w)))];
  const thema = new Set(rahmen.filter(w => !DATUMSWORT.has(w) && !w.includes("#")));
  return { datum, version, zahl, urls, richtung, rahmen: new Set(rahmen), schluessel, bezeichnungen, thema };
}

const gleicheListe = (a, b) => [...a].sort().join("|") === [...b].sort().join("|");
function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let s = 0; for (const x of a) if (b.has(x)) s++;
  return s / (a.size + b.size - s);
}

// Reine Navigationszeile: nach Abzug von Daten, Links, URLs und Trennzeichen bleiben nur Navigationswörter.
export function istNavigation(satz) {
  const t = String(satz).toLowerCase().replace(R_URL, " ").replace(R_DATUM, " ").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  if (!t) return false;
  const w = t.split(" ").filter(x => !/^\p{N}+$/u.test(x));
  return w.length > 0 && w.some(x => !["tag", "woche", "monat", "seite", "heute", "index", "home", "inhalt"].includes(x)) && w.every(x => NAVIGATIONSWORT.has(x));
}

export function vergleicheSaetze(wa, wb) {
  if (!wa.schluessel.some(k => wb.schluessel.includes(k))) return null;
  if (jaccard(wa.rahmen, wb.rahmen) < RAHMEN_SCHWELLE) return null;
  // „Kapitel 3 …“ und „Kapitel 4 …“ sind verschiedene Dinge, kein Widerspruch.
  if (wa.bezeichnungen?.length && wb.bezeichnungen?.length && !gleicheListe(wa.bezeichnungen, wb.bezeichnungen)) return null;
  // Datum: nur beim gleichen Subjekt („Stand 2026-07-30“ zu verschiedenen Dingen ist keiner).
  if (wa.datum.length && wb.datum.length && !gleicheListe(wa.datum, wb.datum)) {
    const gleichesThema = wa.thema.size && wb.thema.size && jaccard(wa.thema, wb.thema) >= RAHMEN_SCHWELLE
      && wa.schluessel.some(k => wa.thema.has(k) && wb.schluessel.includes(k));
    if (gleichesThema) return "datum";
  }
  if (wa.version.length && wb.version.length && !gleicheListe(wa.version, wb.version)) return "version";
  if (wa.zahl.length && wb.zahl.length && !gleicheListe(wa.zahl, wb.zahl)) return "zahl";
  if (wa.richtung * wb.richtung === -1) return "jaNein";
  return null;
}

// Nur Sätze mit etwas Vergleichbarem (Wert oder Ja/Nein) und mindestens einem Schlüsselwort.
export function pruefbareSaetze(text) {
  const out = [];
  for (const satz of saetze(text)) {
    if (istNavigation(satz)) continue;
    const w = werteAus(satz);
    if (!w.schluessel.length) continue;
    if (!w.datum.length && !w.version.length && !w.zahl.length && !w.richtung) continue;
    out.push({ satz, w });
  }
  return out;
}

// a, b: { datei, text, datum, saetze? } → Liste von Widersprüchen.
export function vergleicheNotizen(a, b) {
  const sa = a.saetze || pruefbareSaetze(a.text), sb = b.saetze || pruefbareSaetze(b.text);
  const index = new Map();
  sb.forEach((s, i) => { for (const k of s.w.schluessel) { if (!index.has(k)) index.set(k, []); index.get(k).push(i); } });
  const out = [], gesehen = new Set();
  for (const x of sa) {
    const kandidaten = new Set();
    for (const k of x.w.schluessel) for (const i of index.get(k) || []) kandidaten.add(i);
    for (const i of [...kandidaten].sort((p, q) => p - q)) {
      const y = sb[i];
      const art = vergleicheSaetze(x.w, y.w);
      if (!art) continue;
      const schl = x.satz + "\u0000" + y.satz;
      if (gesehen.has(schl)) continue;
      gesehen.add(schl);
      const neuer = a.datum && b.datum && a.datum !== b.datum ? (a.datum > b.datum ? "a" : "b") : null;
      const seite = (n, satz) => ({ datei: n.datei, satz, datum: n.datum || null, ...(n.ort ? { ort: n.ort } : {}) });
      out.push({ a: seite(a, x.satz), b: seite(b, y.satz), art, neuer });
      if (out.length >= MAX_JE_PAAR) return out;
    }
  }
  return out;
}

// notizen: Map id → { datei, text, datum }; paare: [[idA, idB], …] (Reihenfolge egal, doppelte werden entfernt).
export function findeWidersprueche(notizen, paare) {
  const cache = new Map();
  const hole = (id) => {
    if (!cache.has(id)) { const n = notizen.get(id); cache.set(id, { ...n, saetze: pruefbareSaetze(n.text) }); }
    return cache.get(id);
  };
  const out = [], gesehen = new Set();
  for (const [x, y] of paare) {
    if (x === y || !notizen.has(x) || !notizen.has(y)) continue;
    const k = x < y ? `${x}\u0000${y}` : `${y}\u0000${x}`;
    if (gesehen.has(k)) continue;
    gesehen.add(k);
    out.push(...vergleicheNotizen(hole(x), hole(y)));
  }
  return out;
}
