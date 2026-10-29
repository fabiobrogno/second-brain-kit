// .tools/fakten.mjs — Fakt-Zeilen im Wiki (B1, §4.2): Format bauen und lesen, Beleg-Links prüfen (Lint FAKT-BELEG).
//   - <Aussage> · Stand 21.10.2026 · [[<cluster>/belege/<JJJJ-MM>/<id>]]
//   - ~~<Aussage>~~ · ersetzt am 23.10.2026 durch die Zeile darunter
// Kandidat ist nur eine Listenzeile mit „ · Stand TT.MM.JJJJ“ (Mittelpunkt U+00B7) — Hand-Stichpunkte wie „(Stand 19.10.)“
// sind nie Fakt-Zeilen. Frontmatter und Code-Zäune zählen nicht. Einfügen/Ersetzen im Wiki kommt mit dem Tageslauf (B2).
// Rein, nur Node-Standardbibliothek.
const P = "·";
export const BELEG_LINK_MUSTER = /^([^/\s\]|#]+)\/belege\/(\d{4}-(?:0[1-9]|1[0-2]))\/([a-z0-9-]{1,80})$/;
const zwei = (n) => String(n).padStart(2, "0");
const einzeilig = (s) => String(s ?? "").replace(/\s+/g, " ").trim();

export function datumDE(d = new Date()) {
  return `${zwei(d.getDate())}.${zwei(d.getMonth() + 1)}.${d.getFullYear()}`;
}
export function belegZiel(cluster, id, datum = new Date()) {
  const ziel = `${cluster}/belege/${datum.getFullYear()}-${zwei(datum.getMonth() + 1)}/${id}`;
  if (!BELEG_LINK_MUSTER.test(ziel)) throw new Error("Beleg-Ziel ungültig");
  return ziel;
}
export function baueFaktZeile({ aussage, datum = new Date(), beleg } = {}) {
  const a = einzeilig(aussage);
  if (!a || a.startsWith("~~") || a.includes(` ${P} `) || a.includes("[[")) throw new Error("Aussage ungültig");
  if (!BELEG_LINK_MUSTER.test(String(beleg ?? ""))) throw new Error("Beleg-Link ungültig");
  return `- ${a} ${P} Stand ${datumDE(datum)} ${P} [[${beleg}]]`;
}
export function baueErsetzteZeile({ aussage, datum = new Date() } = {}) {
  const a = einzeilig(aussage).replace(/~~/g, "");
  if (!a) throw new Error("Aussage ungültig");
  return `- ~~${a}~~ ${P} ersetzt am ${datumDE(datum)} durch die Zeile darunter`;
}

const KANDIDAT = new RegExp(`^- .+ ${P} Stand \\d{2}\\.\\d{2}\\.\\d{4}(?: ${P} |\\s*$)`);
const FAKT = new RegExp(`^- (.+?) ${P} Stand (\\d{2}\\.\\d{2}\\.\\d{4}) ${P} \\[\\[([^\\]|#]+)(?:\\|[^\\]]*)?\\]\\]\\s*$`);
const ERSETZT = new RegExp(`^- ~~(.+)~~ ${P} ersetzt am (\\d{2}\\.\\d{2}\\.\\d{4}) durch die Zeile darunter\\s*$`);

export function leseFaktZeilen(text) {
  const zeilen = String(text ?? "").replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").split("\n");
  let i = 0;
  if (zeilen[0] === "---") { const ende = zeilen.indexOf("---", 1); if (ende > 0) i = ende + 1; }
  const out = [];
  let zaun = false;
  for (; i < zeilen.length; i++) {
    const z = zeilen[i];
    if (/^\s*(```|~~~)/.test(z)) { zaun = !zaun; continue; }
    if (zaun) continue;
    let m;
    if ((m = ERSETZT.exec(z))) { out.push({ zeile: i + 1, art: "ersetzt", aussage: m[1], datum: m[2], beleg: "" }); continue; }
    if (!KANDIDAT.test(z)) continue;
    if ((m = FAKT.exec(z))) out.push({ zeile: i + 1, art: "fakt", aussage: m[1], datum: m[2], beleg: m[3].trim() });
    else out.push({ zeile: i + 1, art: "kaputt", aussage: z.slice(2).split(` ${P} Stand `)[0].trim(), datum: "", beleg: "" });
  }
  return out;
}

// Befunde ohne Zeilennummer (der pre-commit vergleicht Befundzeilen mit HEAD — Zeilennummern wären immer „neu“).
const kurz = (s) => { const t = einzeilig(s); return t.length > 40 ? t.slice(0, 39) + "…" : t; };
export function pruefeFaktBelege(text, { existiert = () => false, cluster = [] } = {}) {
  const befunde = [];
  for (const f of leseFaktZeilen(text)) {
    if (f.art === "ersetzt") continue;
    if (f.art === "kaputt") {
      befunde.push({ meldung: `„${kurz(f.aussage)}“ ohne Beleg-Link — Format: - <Aussage> ${P} Stand TT.MM.JJJJ ${P} [[<cluster>/belege/<JJJJ-MM>/<id>]]` });
      continue;
    }
    const m = BELEG_LINK_MUSTER.exec(f.beleg);
    if (!m || (cluster.length && !cluster.includes(m[1]))) {
      befunde.push({ meldung: `„${kurz(f.aussage)}“ — [[${f.beleg}]] ist kein Beleg-Pfad (<cluster>/belege/<JJJJ-MM>/<id>)` });
      continue;
    }
    if (!existiert(f.beleg)) befunde.push({ meldung: `„${kurz(f.aussage)}“ — Beleg [[${f.beleg}]] fehlt` });
  }
  return befunde;
}
