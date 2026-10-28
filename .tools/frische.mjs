// .tools/frische.mjs — neuere Fakten gewinnen, Widerspruch wird angezeigt (statt still entschieden). Kein LLM.
// Datum einer Seite: Frontmatter `geprueft` > `aktualisiert` > `stand` > `gilt_seit`, sonst das Ersatzdatum, das der
// Aufrufer mitgibt (die Suche selbst übergibt keins). Zwei Treffer mit Widerspruch (Erkennung aus
// import/widerspruch.mjs) → der neuere rückt vor den älteren, beide Quellen werden genannt. Gleiches oder fehlendes
// Datum: Reihenfolge bleibt, der Widerspruch wird trotzdem gemeldet.
// Als Widerspruch zählt nur dieselbe Sache: gleiche Seite nach Name/Alias UND Sätze, die sich allein im Wert
// unterscheiden. Geschwister („Tarif Basis“ vs. „Tarif Premium“) werden weder gemeldet noch umsortiert; im Zweifel
// passiert nichts. Eine Seite mit `ersetzt_durch` rückt nie als „neuer“ vor.
import { openSync, readSync, closeSync } from "node:fs";
import { join } from "node:path";
import { entferneBom } from "./pfade.mjs";
import { vergleicheNotizen, nurWertUnterschied } from "./import/widerspruch.mjs";
import { datumNr } from "./gueltigkeit.mjs";
import { leseSeitenFelder } from "./seitenfelder.mjs";
import { haengeAn, zeitstempel } from "./logs.mjs";

const DATUMSFELDER = ["geprueft", "aktualisiert", "stand", "gilt_seit"];
const MAX_ZITAT = 70;
const MAX_ZEILEN = 3;
const LESE_BYTES = 4096;

// Fehler der Frische-Prüfung sind nie still: eine Zeile in .logs/hooks.log. Wirft nie (die Suche darf nicht brechen).
export function frischeFehler(vault, ort, e) {
  if (!vault) return;
  const grund = String(e?.message || e || "unbekannt").replace(/\s+/g, " ").slice(0, 120);
  haengeAn(join(vault, ".logs", "hooks.log"), `${zeitstempel()} frische fehler ort=${ort} grund=${encodeURIComponent(grund)}`);
}

const norm = (s) => String(s).normalize("NFC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const ohneAnf = (v) => String(v).trim().replace(/^["']|["']$/g, "").trim();
// Namen einer Seite: Frontmatter `name` (sonst die erste Überschrift) und `aliase`/`aliases` (Inline- oder Blockliste).
function seitenNamen(kopf, rumpf) {
  const feld = (f) => { const m = kopf.match(new RegExp("^" + f + ":[ \\t]*(.*)$", "m")); return m ? m[1].replace(/\s+#.*$/, "") : null; };
  const out = new Set();
  const name = feld("name") != null ? ohneAnf(feld("name")) : (rumpf.match(/^#[ \t]+(.+)$/m) || [, ""])[1];
  if (norm(name)) out.add(norm(name));
  for (const f of ["aliase", "aliases"]) {
    const m = kopf.match(new RegExp("^" + f + ":[ \\t]*(.*)((?:\\n[ \\t]*-[ \\t]+.*)*)", "m"));
    if (!m) continue;
    const teile = [...m[1].replace(/^\[|\]$/g, "").split(","), ...m[2].split("\n").map(z => z.replace(/^[ \t]*-[ \t]+/, ""))];
    for (const t of teile) if (norm(ohneAnf(t))) out.add(norm(ohneAnf(t)));
  }
  return out;
}
const gleichesSubjekt = (a, b) => [...a].some(n => b.has(n));

// Text einer Markdown-Seite → { datum: "YYYY-MM-DD"|null, rumpf, ersetzt, namen }
export function seiteLesen(roh, ersatzDatum = null) {
  const t = entferneBom(String(roh ?? "")).replace(/\r\n?/g, "\n");
  const m = t.match(/^---\n([\s\S]*?)\n---(?:\n|$)/);
  const kopf = m ? m[1] : "", rumpf = m ? t.slice(m[0].length) : t;
  let datum = null;
  for (const f of DATUMSFELDER) {
    const k = kopf.match(new RegExp("^" + f + ":[ \\t]*(.*)$", "m"));
    const v = k ? k[1].replace(/\s+#.*$/, "").trim().replace(/^["']|["']$/g, "") : "";
    if (datumNr(v) != null) { datum = v; break; }
  }
  return { datum: datum || ersatzDatum || null, rumpf, ersetzt: leseSeitenFelder(t).roh.ersetztDurch !== null, namen: seitenNamen(kopf, rumpf) };
}

const kurz = (s) => { const x = String(s).replace(/\s+/g, " ").trim(); return x.length > MAX_ZITAT ? x.slice(0, MAX_ZITAT - 1) + "…" : x; };

// treffer: [{ page, … }] in Rangfolge; lies(page) → { text, datum? } | null.
// bei(ort, fehler): optional, wird für jede nicht lesbare Seite gerufen (Fehler nie still).
// Ergebnis: { treffer (neu geordnet), widersprueche: [{ neu, alt, neuDatum, altDatum, neuSatz, altSatz, art, entschieden }] }
export function frischePruefen(treffer, lies, { bei = null } = {}) {
  const liste = treffer.map(h => ({ ...h }));
  const notiz = liste.map(h => {
    let r = null;
    try { r = lies(h.page); } catch (e) { if (bei) bei(`lesen:${h.page}`, e); }
    if (!r) return null;
    const s = seiteLesen(r.text, r.datum || null);
    return { datei: h.page, text: s.rumpf, datum: s.datum, ersetzt: s.ersetzt, namen: s.namen };
  });
  const widersprueche = [];
  for (let i = 0; i < liste.length; i++) for (let j = i + 1; j < liste.length; j++) {
    if (!notiz[i] || !notiz[j]) continue;
    if (!gleichesSubjekt(notiz[i].namen, notiz[j].namen)) continue; // andere Seite → andere Sache
    const w = vergleicheNotizen(notiz[i], notiz[j]).find(x => nurWertUnterschied(x.a.satz, x.b.satz));
    if (!w) continue;
    // Eine ersetzte Seite gilt nie als die neuere: dann wird nichts entschieden, nur gemeldet.
    const neuer = w.neuer && !notiz[w.neuer === "b" ? j : i].ersetzt ? w.neuer : null;
    const entschieden = neuer != null;
    const bNeuer = neuer === "b";
    const [n, a] = bNeuer ? [j, i] : [i, j]; // ohne Datumsunterschied: Rangfolge bleibt, nichts wird entschieden
    widersprueche.push({
      neu: liste[n].page, alt: liste[a].page, neuDatum: notiz[n].datum, altDatum: notiz[a].datum,
      neuSatz: bNeuer ? w.b.satz : w.a.satz, altSatz: bNeuer ? w.a.satz : w.b.satz, art: w.art, entschieden,
    });
    if (entschieden && n > a) { // neuer liegt hinter dem älteren → vor ihn ziehen
      const [h] = liste.splice(n, 1); liste.splice(a, 0, h);
      const [nn] = notiz.splice(n, 1); notiz.splice(a, 0, nn);
    }
  }
  return { treffer: liste, widersprueche };
}

// Eine Zeile je Widerspruch, beide Quellen genannt — höchstens MAX_ZEILEN Zeilen (bei mehr: die letzte fasst den Rest
// zusammen). `name` formt den Seitennamen (z. B. Anzeigepfad).
export function widerspruchZeilen(widersprueche, name = (p) => p) {
  const d = (x) => x ? ` (${x})` : "";
  const zeilen = widersprueche.map(w => w.entschieden
    ? `- ⚠ Widerspruch: ${name(w.neu)}${d(w.neuDatum)} sagt „${kurz(w.neuSatz)}“, ${name(w.alt)}${d(w.altDatum)} sagt „${kurz(w.altSatz)}“ — der neuere steht vorn, bei Bedarf klären.`
    : `- ⚠ Widerspruch (ohne Datumsunterschied, nicht entschieden): ${name(w.neu)} sagt „${kurz(w.neuSatz)}“, ${name(w.alt)} sagt „${kurz(w.altSatz)}“.`);
  if (zeilen.length <= MAX_ZEILEN) return zeilen;
  const rest = zeilen.length - (MAX_ZEILEN - 1);
  return [...zeilen.slice(0, MAX_ZEILEN - 1), `- ⚠ … und ${rest} weitere Widersprüche zwischen den Treffern.`];
}

// Seite im Vault lesen (vault-relativer Pfad), höchstens die ersten 4 KB (am Zeilenende gekappt, damit kein halber Satz
// vergleicht); Fehler wirft → frischePruefen überspringt die Seite und meldet sie über `bei`.
export const vaultLeser = (vault) => (page) => {
  const fd = openSync(join(vault, ...String(page).split("/")), "r");
  try {
    const b = Buffer.alloc(LESE_BYTES);
    const n = readSync(fd, b, 0, LESE_BYTES, 0);
    let text = b.subarray(0, n).toString("utf8");
    if (n === LESE_BYTES && text.includes("\n")) text = text.slice(0, text.lastIndexOf("\n") + 1);
    return { text };
  } finally { closeSync(fd); }
};
