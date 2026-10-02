// .tools/werkzeug.mjs — absoluter git-Pfad für Laufzeit-Aufrufe (execFileSync/spawnSync/spawn), NIE der
// nackte Name "git" (der ginge über PATH/eine Shell-Suche). Ein frisch eingerichtetes Windows-System hat
// das private, ohne Admin-Rechte installierte MinGit (~/.brain-kit/git) oft nicht im PATH — und genau
// dieses PATH reichen Claude Code/Cron unverändert an Hooks und Hintergrundprozesse weiter, die dann mit
// "git" nicht gefunden scheitern.
//
// Reihenfolge: 1) brain.config.json → werkzeuge.git (von install.mjs geschrieben, wenn es MinGit
// installiert oder ein vorhandenes git gefunden hat — der Wert gilt unabhängig davon, ob PATH inzwischen
// anders aussieht); 2) der bekannte MinGit-Ort unter diesem Home (win32), falls er existiert, auch ohne
// Config-Eintrag; 3) der nackte Name "git" (PATH) als letzter Rückfall.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export function gitBefehl({ cfg = {}, plattform = process.platform, home = homedir() } = {}) {
  if (typeof cfg?.werkzeuge?.git === "string" && cfg.werkzeuge.git) return cfg.werkzeuge.git;
  if (plattform === "win32") {
    const mingit = join(home, ".brain-kit", "git", "cmd", "git.exe");
    if (existsSync(mingit)) return mingit;
  }
  return "git";
}
