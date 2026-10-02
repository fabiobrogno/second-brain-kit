// .tools/ansicht/suche.js — Suche der 3D-Ansicht wie `brain search` (klassisches Skript, kein ESM).
// Setzt window.BrainSuche = { suche, hervorheben, tokenisiere }. In Node per vm mit { window: {} } testbar.
// suche(nodes, frage, n, { filter }) — filter(node, i) blendet Knoten vor dem Kürzen auf n aus (Ansicht: Bereichsfilter).
//
// Ranking identisch zu .tools/minisuche.mjs: BM25 (k1=1.2, b=0.75), Dokumenttext = body + 3× beschreibung
// (rohe Frontmatter-description; fehlt sie: ""). `desc` (Anzeigetext, ggf. erster Absatz) zählt NICHT —
// er dient nur als Auszug-Fallback. Tokens = /[\p{L}\p{N}]+/gu auf NFC + Kleinbuchstaben. Zusatz: Fragebegriffe ab 5 Zeichen, die im Bestand
// nicht vorkommen, werden auf Bestandswörter mit Levenshtein-Abstand ≤ 1 erweitert (Tippfehler); das LETZTE
// Token der Frage (ab 3 Zeichen, nicht im Bestand) zusätzlich auf alle Bestandswörter mit diesem Präfix (Live-Tippen).
// Begriffe, die exakt vorkommen, werden nie erweitert — dadurch bleibt die Parität zu minisuche erhalten.
// Nachrang Titel: liefert BM25 weniger als n Treffer, werden Knoten angehängt, deren title/name ein Token der
// Frage enthält (das letzte Token ab 3 Zeichen auch als Präfix) — mit score 0 und auszug = desc, in Bestandsreihenfolge.
// BM25-Treffer bleiben unverändert vorne (Parität). So findet man auch Seiten ohne H1, deren Titel nur im Dateinamen steht.
// Gewollt (wie brain search): keine UND-Verknüpfung, keine Stoppwörter, kein Wiki-Bonus,
// kein ß→ss- oder Akzent-Folding („strasse“ findet nicht „Straße“), Titel zählt im BM25 nicht.
// Cache: der Index wird pro Array-IDENTITÄT von `nodes` gehalten (WeakMap). Ein neues Array → neuer Index;
// Änderungen innerhalb desselben Arrays (push, Knoten ändern) werden NICHT bemerkt — dann neues Array übergeben.
(function (root) {
  "use strict";

  const K1 = 1.2;
  const B = 0.75;
  const TOKEN_MUSTER = /[\p{L}\p{N}]+/gu;
  const TIPPFEHLER_AB = 5;
  const PRAEFIX_AB = 3;
  const AUSZUG_LAENGE = 160;

  function tokenisiere(text) {
    return String(text == null ? "" : text).normalize("NFC").toLowerCase().match(TOKEN_MUSTER) || [];
  }

  function dokumentText(n) {
    const body = n && n.body != null ? String(n.body) : "";
    const b = n && typeof n.beschreibung === "string" ? n.beschreibung.trim() : "";
    return b ? body + " " + b + " " + b + " " + b : body;
  }

  // Index je nodes-Array einmal bauen (die Ansicht ruft suche() pro Tastendruck) — siehe Kopfkommentar.
  const CACHE = typeof WeakMap === "function" ? new WeakMap() : null;
  function index(nodes) {
    if (CACHE && CACHE.has(nodes)) return CACHE.get(nodes);
    const docs = nodes.map((n) => {
      const tf = new Map();
      const toks = tokenisiere(dokumentText(n));
      for (const t of toks) tf.set(t, (tf.get(t) || 0) + 1);
      return { tf: tf, len: toks.length };
    });
    const df = new Map();
    for (const d of docs) for (const t of d.tf.keys()) df.set(t, (df.get(t) || 0) + 1);
    const N = docs.length;
    const avgdl = docs.reduce((a, d) => a + d.len, 0) / N || 1;
    // Vokabular sortiert (Präfix per Binärsuche) und nach Länge in Codepoints gebucketet (Levenshtein nur ±1).
    const vokabel = Array.from(df.keys()).sort();
    const nachLaenge = new Map();
    for (const t of vokabel) {
      const cp = Array.from(t), l = cp.length;
      if (!nachLaenge.has(l)) nachLaenge.set(l, []);
      nachLaenge.get(l).push({ t: t, cp: cp });
    }
    // Titel-Tokens (title + name) nur für den Nachrang — zählen nicht im BM25
    const titel = nodes.map((n) => Array.from(new Set(tokenisiere((n && n.title != null ? n.title : "") + " " + (n && n.name != null ? n.name : "")))));
    const idx = { docs: docs, df: df, N: N, avgdl: avgdl, vokabel: vokabel, nachLaenge: nachLaenge, titel: titel };
    if (CACHE) CACHE.set(nodes, idx);
    return idx;
  }

  // Alle Vokabeln mit Präfix p: untere Grenze per Binärsuche, dann vorwärts, solange das Präfix passt.
  function mitPraefix(vokabel, p) {
    let lo = 0, hi = vokabel.length;
    while (lo < hi) { const mid = (lo + hi) >>> 1; if (vokabel[mid] < p) lo = mid + 1; else hi = mid; }
    const out = [];
    for (let k = lo; k < vokabel.length && vokabel[k].startsWith(p); k++) out.push(vokabel[k]);
    return out;
  }

  // Levenshtein auf Codepoint-Arrays (Astral-Zeichen zählen als ein Zeichen), Abbruch sobald > max sicher.
  function lev(a, b, max) {
    if (Math.abs(a.length - b.length) > max) return max + 1;
    let prev = [];
    for (let j = 0; j <= b.length; j++) prev.push(j);
    for (let i = 1; i <= a.length; i++) {
      const cur = [i]; let zeileMin = i;
      for (let j = 1; j <= b.length; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        if (cur[j] < zeileMin) zeileMin = cur[j];
      }
      if (zeileMin > max) return max + 1;
      prev = cur;
    }
    return prev[b.length];
  }

  // Fragebegriffe → tatsächlich gesuchte Bestandswörter.
  function begriffeFuer(frage, idx) {
    const alle = tokenisiere(frage);
    const letztes = alle.length ? alle[alle.length - 1] : "";
    const roh = Array.from(new Set(alle));
    const out = new Set();
    for (const q of roh) {
      if (idx.df.has(q)) { out.add(q); continue; }
      const qcp = Array.from(q), laenge = qcp.length;
      if (q === letztes && laenge >= PRAEFIX_AB) for (const t of mitPraefix(idx.vokabel, q)) out.add(t);
      if (laenge < TIPPFEHLER_AB) continue;
      for (let l = laenge - 1; l <= laenge + 1; l++) {
        for (const v of idx.nachLaenge.get(l) || []) if (lev(qcp, v.cp, 1) <= 1) out.add(v.t);
      }
    }
    return Array.from(out);
  }

  // Lesbarer Klartext eines Knotens für den Auszug: ohne Überschriften, Wiki-Links als Text, ohne MD-Zeichen.
  function klartext(body) {
    return String(body == null ? "" : body).replace(/\r/g, "").split("\n")
      .filter((l) => !/^\s*#/.test(l)).join("\n")
      .replace(/\[\[([^\]|#\n]{1,300})(?:#[^\]|\n]{0,300})?(?:\|([^\]\n]{1,300}))?\]\]/g, (_, a, b) => (b || a).trim())
      .replace(/!?\[([^\]\n]{0,300})\]\((?:[^()\n]|\([^()\n]{0,2000}\)){0,2000}\)/g, "$1")
      .replace(/<[^<>]*>/g, " ")
      .replace(/[#*`>|_~]/g, " ")
      .replace(/\s+/g, " ").trim();
  }

  // Auszug: Klartext ab ein paar Wörtern vor dem ersten Treffer, max. AUSZUG_LAENGE Zeichen,
  // mit "… " / " …" an abgeschnittenen Enden. Ohne Treffer im Text: desc, sonst "".
  function auszug(n, begriffe) {
    const set = new Set(begriffe);
    const woerter = klartext(n.body).split(" ").filter(Boolean);
    for (let k = 0; k < woerter.length; k++) {
      if (tokenisiere(woerter[k]).some((t) => set.has(t))) {
        const a = Math.max(0, k - 6);
        let s = woerter.slice(a).join(" ");
        const abgeschnitten = s.length > AUSZUG_LAENGE;
        if (abgeschnitten) s = s.slice(0, AUSZUG_LAENGE).replace(/\s+\S*$/, "");
        return (a > 0 ? "… " : "") + s + (abgeschnitten ? " …" : "");
      }
    }
    return n.desc != null ? String(n.desc) : "";
  }

  // suche(nodes, frage, n=10, opts?) → [{ id, score, auszug, begriffe }] absteigend nach score (nur score > 0).
  //   opts.filter(node, i) → false schließt den Knoten aus, BEVOR auf n gekürzt wird (z. B. ausgeblendete
  //   Bereiche der Ansicht). Ranking-Statistik (N, df, avgdl) bleibt die des ganzen Bestands — wie brain search.
  function suche(nodes, frage, n, opts) {
    const max = n == null ? 10 : n;
    const filter = opts && typeof opts.filter === "function" ? opts.filter : null;
    if (!Array.isArray(nodes) || !nodes.length || max <= 0) return [];
    const idx = index(nodes);
    const begriffe = begriffeFuer(frage, idx);
    const titelHits = (bm25) => titelNachrang(nodes, idx, frage, max - bm25.length, filter, new Set(bm25.map((t) => t.id)));
    if (!begriffe.length) return titelHits([]);
    const idf = new Map(begriffe.map((b) => {
      const nq = idx.df.get(b) || 0;
      return [b, Math.log(1 + (idx.N - nq + 0.5) / (nq + 0.5))];
    }));
    const treffer = [];
    for (let i = 0; i < idx.N; i++) {
      if (filter && !filter(nodes[i], i)) continue;
      const d = idx.docs[i];
      let score = 0;
      for (const b of begriffe) {
        const f = d.tf.get(b);
        if (!f) continue;
        score += idf.get(b) * (f * (K1 + 1)) / (f + K1 * (1 - B + B * (d.len / idx.avgdl)));
      }
      if (score > 0) treffer.push({ i: i, score: score });
    }
    treffer.sort((a, b) => b.score - a.score);
    const bm25 = treffer.slice(0, max).map((t) => {
      const node = nodes[t.i];
      const eigene = begriffe.filter((b) => idx.docs[t.i].tf.has(b));
      return { id: node.id, score: t.score, auszug: auszug(node, eigene), begriffe: eigene };
    });
    return bm25.length < max ? bm25.concat(titelHits(bm25)) : bm25;
  }

  // Nachrang: Knoten, deren title/name ein Fragetoken enthält (letztes Token ab PRAEFIX_AB auch als Präfix).
  function titelNachrang(nodes, idx, frage, rest, filter, schon) {
    if (rest <= 0) return [];
    const alle = tokenisiere(frage);
    if (!alle.length) return [];
    const set = new Set(alle), letztes = alle[alle.length - 1];
    const praefix = Array.from(letztes).length >= PRAEFIX_AB ? letztes : null;
    const out = [];
    for (let i = 0; i < nodes.length && out.length < rest; i++) {
      const node = nodes[i];
      if (!node || schon.has(node.id) || (filter && !filter(node, i))) continue;
      const passend = idx.titel[i].filter((t) => set.has(t) || (praefix && t.startsWith(praefix)));
      if (passend.length) out.push({ id: node.id, score: 0, auszug: node.desc != null ? String(node.desc) : "", begriffe: passend });
    }
    return out;
  }

  // hervorheben(text, begriffe) → escaptes HTML, Wörter aus `begriffe` in <mark>.
  function hervorheben(text, begriffe) {
    const set = new Set((begriffe || []).map((b) => String(b).normalize("NFC").toLowerCase()));
    const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
    // \p{M}: zerlegte Umlaute (NFD, z. B. macOS-Dateinamen) bleiben ein Wort; Vergleich auf NFC wie tokenisiere,
    // ausgegeben wird der Originaltext (escaped).
    return String(text == null ? "" : text).split(/([\p{L}\p{M}\p{N}]+)/u)
      .map((teil, k) => (k % 2 === 1 && set.has(teil.normalize("NFC").toLowerCase()) ? "<mark>" + esc(teil) + "</mark>" : esc(teil)))
      .join("");
  }

  root.BrainSuche = { suche: suche, hervorheben: hervorheben, tokenisiere: tokenisiere };
})(typeof window !== "undefined" ? window : globalThis);
