// Nachbau von QMDs handelize() (dist/store.js, QMD 2.5.3) — so benennt QMD Dateien in qmd://<sammlung>/<pfad>.
// Groß/klein bleibt; jede Folge von Nicht-Buchstaben/Ziffern (auch Punkte) → ein "-"; Ränder ohne "-";
// "___" wird zum Ordner-Trenner; die Endung der Datei bleibt. (Emoji→Hex aus dem Original entfällt.)
export function qmdPath(rel) {
  const clean = (s) => s.replace(/[^\p{L}\p{N}$]+/gu, "-").replace(/^-+|-+$/g, "");
  const teile = rel.split(/[\\/]/).join("/").replace(/___/g, "/").split("/");
  return teile.map((seg, i) => {
    if (i < teile.length - 1) return clean(seg);
    const ext = (seg.match(/(\.[a-z0-9]+)$/i) || [, ""])[1];
    return clean(ext ? seg.slice(0, -ext.length) : seg) + ext;
  }).filter(Boolean).join("/");
}
