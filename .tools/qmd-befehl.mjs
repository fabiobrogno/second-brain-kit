// .tools/qmd-befehl.mjs — Windows kennt keine Unix-Symlinks: node_modules/.bin/qmd.cmd lässt sich ohne
// shell:true nicht direkt per spawnSync starten (ENOENT/falscher Exit). Löst stattdessen über das
// @tobilu/qmd-Paket (liegt bei npms Windows-Layout im selben Ordner wie der .cmd-Shim) den echten
// JS-Entry auf und startet den mit `node <entry>`. Andere Plattformen: das private qmd aus der Installation
// (~/.brain-kit/bin/qmd, `npm i -g --prefix ~/.brain-kit`) per absolutem Pfad — dieser Ordner steht in keinem
// PATH, den Claude Code/Hooks sehen —, sonst "qmd" (PATH/Symlink).
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { join, dirname, delimiter } from "node:path";
import { homedir } from "node:os";

// Mindest-Arbeitsspeicher (GB, 10^9 Byte wie os.totalmem) für Suchprofil „voll“ — doctor und Installation warnen darunter.
export const VOLL_AB_GB = 15;

// Ort, an den sorgeFuerQmd() (kit/repo/lib/voraussetzungen.mjs) qmd installiert. npm legt bei --prefix den
// Starter unter Unix nach <prefix>/bin, unter Windows direkt nach <prefix> (qmd.cmd + node_modules daneben).
export function qmdPrivatBin(home = homedir()) {
  const bin = join(home, ".brain-kit", "bin", "qmd");
  return existsSync(bin) ? bin : null;
}

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

// Der qmd-Starter (bin/qmd) startet sein eigentliches CLI über den Programmnamen „node“ — ohne node im PATH (frische
// Rechner mit privatem Node, Hooks/GUI-Apps mit Minimal-PATH) scheitert er. Darum laufen wir ihn mit dem
// laufenden Node und hängen dessen Ordner an den PATH an, den alle Kindprozesse erben.
function mitNode(entry) {
  const nodeDir = dirname(process.execPath);
  const teile = (process.env.PATH ?? "").split(delimiter);
  if (!teile.includes(nodeDir)) process.env.PATH = [...teile.filter(Boolean), nodeDir].join(delimiter);
  return { cmd: process.execPath, vorArgs: [entry] };
}

export function qmdBefehl(plattform = process.platform, pfad = process.env.PATH ?? "", home = homedir()) {
  if (plattform !== "win32") {
    const privat = qmdPrivatBin(home);
    if (!privat) return { cmd: "qmd", vorArgs: [] };
    try { return mitNode(realpathSync(privat)); } catch { return { cmd: privat, vorArgs: [] }; }
  }
  const paket = findePaketVerzeichnis(`${pfad};${join(home, ".brain-kit")}`);
  if (!paket) return { cmd: "qmd", vorArgs: [] };
  try {
    const pkg = JSON.parse(readFileSync(join(paket, "package.json"), "utf8"));
    const bin = typeof pkg.bin === "string" ? pkg.bin : pkg.bin?.qmd;
    if (!bin) return { cmd: "qmd", vorArgs: [] };
    return mitNode(join(paket, bin));
  } catch { return { cmd: "qmd", vorArgs: [] }; }
}

// Für modulPfad() in qmd-vector.mjs: dasselbe Paketverzeichnis, aber ohne den Bin-Umweg — dist/index.js
// liegt im Paket-Root, unabhängig vom bin-Feld. Nur auf win32 relevant (sonst reicht die PATH-Suche dort).
export function qmdPaketVerzeichnisWin32(pfad = process.env.PATH ?? "", home = homedir()) {
  return findePaketVerzeichnis(`${pfad};${join(home, ".brain-kit")}`);
}
