// .tools/tests/kopiere-baum.mjs — Test-Hilfe: rekursives Kopieren ohne fs.cpSync.
// Unter Windows (CI, Node 22) legte cpSync Ordner mit Umlauten still unter einem anderen Namen an — danach
// fehlte z. B. „Rezepte und Küche/Brotteig.md“ ohne jede Fehlermeldung. copyFileSync/mkdirSync behalten
// jeden Namen. Gleiche Technik wie kopiereBaum() in install.mjs.
import { copyFileSync, lstatSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";

export function kopiereBaum(quelle, ziel) {
  const st = lstatSync(quelle);
  if (st.isSymbolicLink()) return;
  if (st.isDirectory()) {
    mkdirSync(ziel, { recursive: true });
    for (const name of readdirSync(quelle)) kopiereBaum(join(quelle, name), join(ziel, name));
  } else if (st.isFile()) {
    copyFileSync(quelle, ziel);
  }
}
