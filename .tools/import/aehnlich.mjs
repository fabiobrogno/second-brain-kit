// .tools/import/aehnlich.mjs — Fast-Duplikate: Jaccard-Ähnlichkeit über 5-Wort-Shingles.
// Damit 5000 Notizen in Sekunden gehen, wird nicht jedes Paar verglichen: Kandidaten kommen aus Eimern
// (gleicher normalisierter Titel, oder gleiches MinHash-Band: 16 Hashes in 8 Bändern à 2), genau gerechnet
// wird nur innerhalb dieser Eimer. Gruppen bildet Union-Find über alle Paare mit Ähnlichkeit ≥ Schwelle.
const WORT = /[\p{L}\p{N}]+/gu;
const N_HASH = 16, ZEILEN = 2;

export function woerter(text) {
  return String(text).normalize("NFC").toLowerCase().match(WORT) || [];
}
export function shingles(text, k = 5) {
  const w = woerter(text);
  const s = new Set();
  if (!w.length) return s;
  if (w.length < k) { s.add(w.join(" ")); return s; }
  for (let i = 0; i + k <= w.length; i++) s.add(w.slice(i, i + k).join(" "));
  return s;
}

const alsSet = (x) => (x instanceof Set ? x : shingles(x));
export function aehnlichkeit(a, b) {
  const A = alsSet(a), B = alsSet(b);
  if (!A.size || !B.size) return 0;
  const [klein, gross] = A.size <= B.size ? [A, B] : [B, A];
  let schnitt = 0;
  for (const s of klein) if (gross.has(s)) schnitt++;
  return schnitt / (A.size + B.size - schnitt);
}

function fnv(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}
function mische(h, saat) {
  let x = (h ^ saat) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x7feb352d);
  x = Math.imul(x ^ (x >>> 15), 0x846ca68b);
  return (x ^ (x >>> 16)) >>> 0;
}
const SAATEN = Array.from({ length: N_HASH }, (_, i) => mische(0x9e3779b9 + i * 0x632be5ab, i + 1));

function minhash(set) {
  const sig = new Array(N_HASH).fill(0xffffffff);
  for (const s of set) {
    const h = fnv(s);
    for (let i = 0; i < N_HASH; i++) { const v = mische(h, SAATEN[i]); if (v < sig[i]) sig[i] = v; }
  }
  return sig;
}

// notizen: [{ id, text, titelNorm? }]. Rückgabe: [{ dateien: [id…], aehnlichkeit }] (min. Paar-Ähnlichkeit
// innerhalb der verbundenen Paare, gerundet auf 2 Stellen), sortiert nach erster Datei.
export function findeGruppen(notizen, { schwelle = 0.8 } = {}) {
  const sets = notizen.map(n => shingles(n.text));
  const eimer = new Map();
  const lege = (k, i) => { let e = eimer.get(k); if (!e) eimer.set(k, e = []); e.push(i); };
  notizen.forEach((n, i) => {
    if (!sets[i].size) return;
    if (n.titelNorm) lege("t:" + n.titelNorm, i);
    const sig = minhash(sets[i]);
    for (let b = 0; b < N_HASH / ZEILEN; b++) lege(`b${b}:` + sig.slice(b * ZEILEN, b * ZEILEN + ZEILEN).join(","), i);
  });
  const eltern = notizen.map((_, i) => i);
  const wurzel = (i) => { while (eltern[i] !== i) { eltern[i] = eltern[eltern[i]]; i = eltern[i]; } return i; };
  // Kein Merk-Set aller Paare (bei Tausenden fast gleicher Notizen wäre das O(n²) Speicher): schon verbundene
  // Paare überspringt der Wurzel-Vergleich, Paare unter der Schwelle werden höchstens je gemeinsamem Eimer neu gerechnet.
  const werte = new Map();
  for (const [schluessel, liste] of eimer) {
    if (liste.length < 2) continue;
    if (schluessel.startsWith("t:") && liste.length > 200) continue;   // Allerweltstitel („Ohne Titel“) — nur Inhalt zählt
    for (let x = 0; x < liste.length; x++) for (let y = x + 1; y < liste.length; y++) {
      const i = liste[x], j = liste[y], k = i * notizen.length + j;
      if (wurzel(i) === wurzel(j)) continue;
      // Größenfilter: Jaccard ≤ klein/groß — spart die Rechnung bei sehr ungleichen Notizen.
      const a = sets[i].size, b = sets[j].size;
      if (Math.min(a, b) / Math.max(a, b) < schwelle) continue;
      const s = aehnlichkeit(sets[i], sets[j]);
      if (s >= schwelle) {
        const ri = wurzel(i), rj = wurzel(j);
        if (ri !== rj) eltern[ri] = rj;
        werte.set(k, s);
      }
    }
  }
  const gruppen = new Map();
  notizen.forEach((_, i) => { const r = wurzel(i); if (!gruppen.has(r)) gruppen.set(r, []); gruppen.get(r).push(i); });
  const minJeGruppe = new Map();
  for (const [k, s] of werte) {
    const r = wurzel(Math.floor(k / notizen.length));
    if (!minJeGruppe.has(r) || s < minJeGruppe.get(r)) minJeGruppe.set(r, s);
  }
  const out = [];
  for (const [r, mitglieder] of gruppen) {
    if (mitglieder.length < 2) continue;
    out.push({ dateien: mitglieder.map(i => notizen[i].id), aehnlichkeit: Math.round((minJeGruppe.get(r) ?? 1) * 100) / 100 });
  }
  return out.sort((a, b) => (a.dateien[0] < b.dateien[0] ? -1 : 1));
}
