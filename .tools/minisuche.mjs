// .tools/minisuche.mjs — reine JS-Suche (kein qmd nötig): BM25 über die Vault-Notizen, k1=1.2, b=0.75.
// Das Frontmatter-Feld `description` zählt dreifach (Signal für Wiki-Seiten). Kein Cache in v0.1 —
// Ziel < 300 ms auf Fixture und eigenem Vault (siehe Task 10).
import { readFileSync } from "node:fs";
import { sep } from "node:path";
import { walk } from "./vault-dateien.mjs";
import { entferneBom } from "./pfade.mjs";

const K1 = 1.2;
const B = 0.75;
const TOKEN_MUSTER = /[\p{L}\p{N}]+/gu;

function tokenisiere(text) {
  return String(text).normalize("NFC").toLowerCase().match(TOKEN_MUSTER) || [];  // NFC: wie .tools/ansicht/suche.js
}

// Frontmatter-Beschreibung dreifach gewichten: Rumpf (ohne Frontmatter) + description 3×
// statt einmal natürlich im Rohtext.
function dokumentText(full) {
  const raw = entferneBom(readFileSync(full, "utf8")).replace(/\r\n/g, "\n"); // BOM (PowerShell 5.1) weg wie daten.mjs; CRLF (Windows-Checkout) wie LF
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!m) return raw;
  const rumpf = raw.slice(m[0].length);
  let beschreibung = "";
  for (const zeile of m[1].split("\n")) {
    const kv = zeile.match(/^description:\s*(.*)$/);
    if (kv) beschreibung = kv[1].trim().replace(/^["']|["']$/g, "");
  }
  return beschreibung ? `${rumpf} ${beschreibung} ${beschreibung} ${beschreibung}` : rumpf;
}

export function minisuche(vault, frage, n = 5) {
  const begriffe = [...new Set(tokenisiere(frage))];
  if (!begriffe.length) return [];
  const begriffSet = new Set(begriffe);
  const dateien = walk(vault);
  if (!dateien.length) return [];

  const dokumente = dateien.map(f => ({
    pfad: f.rel.split(sep).join("/"),
    tokens: tokenisiere(dokumentText(f.full)),
  }));
  const N = dokumente.length;
  const laengen = dokumente.map(d => d.tokens.length);
  const avgdl = laengen.reduce((a, b) => a + b, 0) / N || 1;

  const df = new Map(begriffe.map(b => [b, 0]));
  const haeufigkeiten = dokumente.map(d => {
    const tf = new Map();
    for (const t of d.tokens) if (begriffSet.has(t)) tf.set(t, (tf.get(t) || 0) + 1);
    for (const b of tf.keys()) df.set(b, df.get(b) + 1);
    return tf;
  });
  const idf = new Map(begriffe.map(b => {
    const nq = df.get(b) || 0;
    return [b, Math.log(1 + (N - nq + 0.5) / (nq + 0.5))];
  }));

  const ergebnisse = [];
  for (let i = 0; i < N; i++) {
    const tf = haeufigkeiten[i];
    let score = 0;
    for (const [b, f] of tf) {
      const nenner = f + K1 * (1 - B + B * (laengen[i] / avgdl));
      score += idf.get(b) * (f * (K1 + 1)) / nenner;
    }
    if (score > 0) ergebnisse.push({ pfad: dokumente[i].pfad, score });
  }
  ergebnisse.sort((a, b) => b.score - a.score);
  return ergebnisse.slice(0, n);
}
