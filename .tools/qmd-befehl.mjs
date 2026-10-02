// .tools/qmd-befehl.mjs — Windows kennt keine Unix-Symlinks: node_modules/.bin/qmd.cmd lässt sich ohne
// shell:true nicht direkt per spawnSync starten (ENOENT/falscher Exit). Löst stattdessen über das
// @tobilu/qmd-Paket (liegt bei npms Windows-Layout im selben Ordner wie der .cmd-Shim) den echten
// JS-Entry auf und startet den mit `node <entry>`. Andere Plattformen: einfach "qmd" (PATH/Symlink reicht).
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Intern: PATH-Einträge (win32-Delimiter ";", unabhängig vom Host-Betriebssystem, damit das auch beim
// Testen auf macOS/Linux simulierbar ist) nach qmd.cmd absuchen und das @tobilu/qmd-Paketverzeichnis
// daneben zurückgeben.
function findePaketVerzeichnis(pfad) {
  for (const dir of String(pfad).split(";").filter(Boolean)) {
    if (!existsSync(join(dir, "qmd.cmd"))) continue;
    const paket = join(dir, "node_modules", "@tobilu", "qmd");
    if (existsSync(join(paket, "package.json"))) return paket;
  }
  return null;
}

export function qmdBefehl(plattform = process.platform, pfad = process.env.PATH ?? "") {
  if (plattform !== "win32") return { cmd: "qmd", vorArgs: [] };
  const paket = findePaketVerzeichnis(pfad);
  if (!paket) return { cmd: "qmd", vorArgs: [] };
  try {
    const pkg = JSON.parse(readFileSync(join(paket, "package.json"), "utf8"));
    const bin = typeof pkg.bin === "string" ? pkg.bin : pkg.bin?.qmd;
    if (!bin) return { cmd: "qmd", vorArgs: [] };
    return { cmd: process.execPath, vorArgs: [join(paket, bin)] };
  } catch { return { cmd: "qmd", vorArgs: [] }; }
}

// Für modulPfad() in qmd-vector.mjs: dasselbe Paketverzeichnis, aber ohne den Bin-Umweg — dist/index.js
// liegt im Paket-Root, unabhängig vom bin-Feld. Nur auf win32 relevant (sonst reicht die PATH-Suche dort).
export function qmdPaketVerzeichnisWin32(pfad = process.env.PATH ?? "") {
  return findePaketVerzeichnis(pfad);
}
