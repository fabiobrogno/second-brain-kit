// .tools/qmd-ausgabe.mjs — Parser für `qmd search|vsearch|query ... --files`-Ausgabe.
// Format je Treffer (siehe @tobilu/qmd cli/formatter.js, searchResultsToFiles):
//   #<docid>,<score>,<pfad>[,"<kontext>"]
// Der optionale Kontext-Teil ist CSV-gequotet (doppelte Anführungszeichen escapen) und darf
// eingebettete Kommas UND Zeilenumbrüche enthalten — nur echte Record-Startzeilen zählen,
// Fortsetzungszeilen eines mehrzeiligen Kontexts werden ignoriert. Der Pfad selbst enthält keine
// Kommas, kann aber Leerzeichen/Umlaute haben — er endet am ersten Komma danach (falls vorhanden).
const RECORD = /^#[0-9a-f]+,([\d.]+),([^,]+)/;

export function parseQmdDateien(text) {
  const out = [];
  for (const zeile of String(text).split("\n")) {
    const treffer = zeile.match(RECORD);
    if (!treffer) continue;
    out.push({ pfad: treffer[2].trim(), score: Number(treffer[1]) });
  }
  return out;
}
