// .tools/frische.mjs — neuere Fakten gewinnen, Widerspruch wird angezeigt (statt still entschieden). Kein LLM.
// Datum einer Seite: Frontmatter `geprueft` > `aktualisiert` > `stand`, sonst das mitgegebene Ersatzdatum (git/mtime).
// Zwei Treffer mit Widerspruch (Erkennung aus import/widerspruch.mjs) → der neuere rückt vor den älteren, beide
// Quellen werden genannt. Gleiches oder fehlendes Datum: Reihenfolge bleibt, der Widerspruch wird trotzdem gemeldet.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { entferneBom } from "./pfade.mjs";
import { vergleicheNotizen } from "./import/widerspruch.mjs";
import { datumNr } from "./gueltigkeit.mjs";

const DATUMSFELDER = ["geprueft", "aktualisiert", "stand"];
const MAX_ZITAT = 70;

// Text einer Markdown-Seite → { datum: "YYYY-MM-DD"|null, rumpf }
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
  return { datum: datum || ersatzDatum || null, rumpf };
}

const kurz = (s) => { const x = String(s).replace(/\s+/g, " ").trim(); return x.length > MAX_ZITAT ? x.slice(0, MAX_ZITAT - 1) + "…" : x; };

// treffer: [{ page, … }] in Rangfolge; lies(page) → { text, datum? } | null.
// Ergebnis: { treffer (neu geordnet), widersprueche: [{ neu, alt, neuDatum, altDatum, neuSatz, altSatz, art, entschieden }] }
export function frischePruefen(treffer, lies) {
  const liste = treffer.map(h => ({ ...h }));
  const notiz = liste.map(h => {
    let r = null; try { r = lies(h.page); } catch {}
    if (!r) return null;
    const s = seiteLesen(r.text, r.datum || null);
    return { datei: h.page, text: s.rumpf, datum: s.datum };
  });
  const widersprueche = [];
  for (let i = 0; i < liste.length; i++) for (let j = i + 1; j < liste.length; j++) {
    if (!notiz[i] || !notiz[j]) continue;
    const w = vergleicheNotizen(notiz[i], notiz[j])[0];
    if (!w) continue;
    const entschieden = w.neuer != null;
    const bNeuer = w.neuer === "b";
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

// Eine Zeile je Widerspruch, beide Quellen genannt. `name` formt den Seitennamen (z. B. Anzeigepfad).
export function widerspruchZeilen(widersprueche, name = (p) => p) {
  const d = (x) => x ? ` (${x})` : "";
  return widersprueche.map(w => w.entschieden
    ? `- ⚠ Widerspruch: ${name(w.neu)}${d(w.neuDatum)} sagt „${kurz(w.neuSatz)}“, ${name(w.alt)}${d(w.altDatum)} sagt „${kurz(w.altSatz)}“ — der neuere steht vorn, bei Bedarf klären.`
    : `- ⚠ Widerspruch (ohne Datumsunterschied, nicht entschieden): ${name(w.neu)} sagt „${kurz(w.neuSatz)}“, ${name(w.alt)} sagt „${kurz(w.altSatz)}“.`);
}

// Seite im Vault lesen (vault-relativer Pfad); Fehler wirft → frischePruefen überspringt die Seite.
export const vaultLeser = (vault) => (page) => ({ text: readFileSync(join(vault, ...String(page).split("/")), "utf8") });
