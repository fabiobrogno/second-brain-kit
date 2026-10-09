// .tools/logs.mjs — gemeinsames Log-Modul: Anhängen mit Rotation, Zeitstempel, Zeilen-Parser.
// Ersetzt die bisher mehrfach kopierten Anhänge-/Rotations-Schnipsel (hint.log, hooks.log, feedback.log …).
// Nur Node-Standardbibliothek, keine Abhängigkeiten.
import { appendFileSync, readFileSync, writeFileSync, renameSync, unlinkSync, mkdirSync, statSync } from "node:fs";
import { dirname } from "node:path";

// UTC, 19 Zeichen, ohne "Z" (wie bisher hint.log: new Date().toISOString().slice(0, 19)) — leseZeilen()
// hängt beim Rückparsen "Z" wieder an.
export function zeitstempel(d = new Date()) {
  return d.toISOString().slice(0, 19);
}

// Hängt `zeile + "\n"` an (legt den Ordner bei Bedarf an). Überschreitet die Datei danach `max` Zeilen,
// wird atomar (tmp + rename) auf die letzten `behalte` Zeilen gekürzt. Wirft nie — ein Logging-Fehler
// darf nie einen Hook/Hintergrundprozess abschießen.
// Nit 15: Vor jedem Anhängen die ganze Datei zu lesen und zu zählen wäre bei bis zu `max` Zeilen teuer
// fürs 60-ms-Hook-Budget. Billige Vorprüfung über die Dateigröße (wie schon in brain-hint.mjs): jede
// Log-Zeile in diesem Projekt beginnt mit einem 19-stelligen Zeitstempel + Leerzeichen, 20 Byte/Zeile ist
// also eine sichere untere Schranke — unterhalb von `max * 20` Byte kann die Datei gar nicht über `max`
// Zeilen liegen, lesen+zählen lohnt sich dann noch nicht.
export function haengeAn(datei, zeile, { max = 5000, behalte = 2500 } = {}) {
  try {
    mkdirSync(dirname(datei), { recursive: true });
    appendFileSync(datei, zeile + "\n");
    if (statSync(datei).size <= max * 20) return;
    const zeilen = readFileSync(datei, "utf8").split(/\r?\n/).filter(Boolean);
    if (zeilen.length > max) {
      const tmp = `${datei}.${process.pid}.tmp`;
      writeFileSync(tmp, zeilen.slice(-behalte).join("\n") + "\n");
      try { renameSync(tmp, datei); } catch { try { unlinkSync(tmp); } catch {} }
    }
  } catch {}
}

// Parst "<zeit> k=v k=v …". Werte ohne Leerzeichen; enthält ein Wert Leerzeichen, schreibt der Aufrufer
// ihn als encodeURIComponent — hier wird jeder Wert (außer `text`) mit decodeURIComponent dekodiert
// (Fehler → Rohwert übernehmen). `text=` ist IMMER das letzte Feld und bleibt roh bis Zeilenende (darf
// selbst Leerzeichen/"=" enthalten).
// Review-Fund 2b: ein Token OHNE "=" (z. B. ein beschädigter/alter Log-Rest) brach die ganze Zeile ab —
// alle folgenden Felder gingen verloren. Robuster: das kaputte Token bis zum nächsten Leerzeichen
// überspringen und mit den übrigen Feldern weitermachen.
export function leseFelder(zeile) {
  const z = String(zeile).replace(/\r$/, "");
  const erstesLeerzeichen = z.indexOf(" ");
  const out = { zeit: erstesLeerzeichen === -1 ? z : z.slice(0, erstesLeerzeichen) };
  let rest = erstesLeerzeichen === -1 ? "" : z.slice(erstesLeerzeichen + 1);
  while (rest.length) {
    const m = rest.match(/^([^\s=]+)=/);
    if (!m) {
      const sp = rest.indexOf(" ");
      rest = sp === -1 ? "" : rest.slice(sp + 1);
      continue;
    }
    const schluessel = m[1];
    rest = rest.slice(m[0].length);
    if (schluessel === "text") { out.text = rest; break; }
    const sp = rest.indexOf(" ");
    const wert = sp === -1 ? rest : rest.slice(0, sp);
    rest = sp === -1 ? "" : rest.slice(sp + 1);
    try { out[schluessel] = decodeURIComponent(wert); } catch { out[schluessel] = wert; }
  }
  return out;
}

// Alle Zeilen einer Log-Datei als leseFelder(), gefiltert auf Zeit ≥ seitMs. Fehlende Datei → [].
export function leseZeilen(datei, { seitMs = 0 } = {}) {
  let inhalt;
  try { inhalt = readFileSync(datei, "utf8"); } catch { return []; }
  const out = [];
  for (const z of inhalt.split(/\r?\n/)) {
    if (!z) continue;
    const f = leseFelder(z);
    const t = Date.parse(f.zeit + "Z");
    if ((Number.isNaN(t) ? 0 : t) >= seitMs) out.push(f);
  }
  return out;
}

// `hits=` wird hier aus dem ROHEN Feldwert zerlegt (leseFelder dekodiert das ganze Feld und verlöre sonst die
// Grenze zwischen Seiten, deren Name selbst ein Komma trägt). Unterstützt: alles in einem URI-kodiert mit Tab
// als Trenner (`encodeURIComponent(seiten.join("\t"))`), je Seite kodiert und mit "," verbunden, und alte rohe
// Zeilen ("a.md,b.md").
export function hitsSeiten(roh) {
  const r = String(roh ?? "");
  if (!r || r === "-") return [];
  const dekodiere = (x) => { try { return decodeURIComponent(x); } catch { return x; } };
  const ganz = dekodiere(r);
  const teile = ganz.includes("\t") ? ganz.split("\t") : r.split(",").map(dekodiere);
  return teile.map((t) => t.trim()).filter(Boolean);
}
