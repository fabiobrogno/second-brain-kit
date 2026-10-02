// .tools/oeffner.mjs — welches Programm öffnet eine Datei im Standardprogramm des Systems (für `brain zeig`).
// Reine Funktion, damit sie ohne echtes Öffnen auf jedem OS testbar ist (test-oeffner.mjs).
// oeffnerAufruf({ datei, url }, plattform, oeffner) → { cmd, args }
//   datei: nativer Pfad der Datei, url: ihre file://-URL (pathToFileURL(datei).href),
//   oeffner: optionaler Testhaken (BRAIN_OEFFNER) — ersetzt das Programm, bekommt die Datei als einziges Argument.
// Windows: NICHT `explorer.exe <pfad>` — explorer wertet Kommas als Trenner (Syntax „/select,…“), ein Vault
// unter „C:\Users\Müller, Anna\…“ öffnete dann einen Explorer-Ordner statt des Browsers. Stattdessen
// `rundll32.exe url.dll,FileProtocolHandler <url>` (ohne Shell, öffnet das Standardprogramm für die URL)
// mit kodierten Kommas (%2C) in der URL, damit kein Komma mehr auf der Kommandozeile steht.
export function oeffnerAufruf({ datei, url }, plattform = process.platform, oeffner = "") {
  if (oeffner) return { cmd: oeffner, args: [datei] };
  if (plattform === "win32") return { cmd: "rundll32.exe", args: ["url.dll,FileProtocolHandler", url.replace(/,/g, "%2C")] };
  return { cmd: plattform === "darwin" ? "open" : "xdg-open", args: [datei] };
}
