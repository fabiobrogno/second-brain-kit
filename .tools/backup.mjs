// .tools/backup.mjs — Sicherung: github (push) | ordner (git bundle, 7 behalten) | keins. Alltagssprache, nie Abbruch im Alltag.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, statSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ladeConfig } from "./pfade.mjs";
import { gitBefehl } from "./werkzeug.mjs";
const git = (v, ...a) => execFileSync(gitBefehl({ cfg: ladeConfig(v) }), ["-C", v, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], windowsHide: true });

export function einrichten(vault, wahl) {
  const cfg = ladeConfig(vault);
  cfg.backup = wahl === "github" ? { art: "github" } : wahl.startsWith("ordner:") ? { art: "ordner", pfad: wahl.slice(7) } : { art: "keins" };
  writeFileSync(join(vault, "brain.config.json"), JSON.stringify(cfg, null, 2) + "\n");
  // Config-Änderung sofort sichern (wie bei systemVersion im Skill update) — per Pfadangabe NUR diese
  // Datei stagen und committen, damit andere bereits gestagte (fremde) Änderungen unangetastet bleiben.
  try {
    // Ohne git-Identität (frischer Rechner, wiederhergestellter Vault) scheiterte der Commit sonst still —
    // gleicher Rückfall wie in install.mjs, nur für diesen Vault.
    try { git(vault, "config", "user.email"); } catch { git(vault, "config", "user.email", "brain@localhost"); git(vault, "config", "user.name", "Second Brain"); }
    git(vault, "add", "--", "brain.config.json");
    git(vault, "commit", "-q", "-m", "brain: Sicherung eingerichtet", "--", "brain.config.json");
  } catch {}
  return cfg.backup;
}

// Wie viele Notizen sind noch nicht eingearbeitet (uncommitted/untracked) — die Sicherung sichert nur den
// committeten Stand, also müssen wir sagen, was dabei fehlt, statt es still zu verschweigen.
function nichtEingearbeitet(vault) {
  try {
    const out = execFileSync(gitBefehl({ cfg: ladeConfig(vault) }), ["-C", vault, "status", "--porcelain"], { encoding: "utf8", windowsHide: true });
    const n = out.split("\n").filter(Boolean).length;
    return n > 0 ? ` Achtung: ${n} Notiz(en) sind noch nicht eingearbeitet und deshalb nicht in der Sicherung — sag ‚arbeite meine Notizen ein‘.` : "";
  } catch { return ""; }
}

export function sichern(vault) {
  let b = ladeConfig(vault).backup;
  // Ohne backup-Eintrag, aber mit eingerichtetem Git-Remote: pushen wie bisher (gleiche Rückfall-Regel wie
  // im Sitzungsstart — ältere Vaults vor dieser Sicherungs-Funktion sichern unverändert weiter).
  if (!b) { let remote = ""; try { remote = git(vault, "remote").trim(); } catch {} b = remote ? { art: "github" } : { art: "keins" }; }
  if (b.art === "keins") return "Keine Sicherung eingerichtet. Sag „richte mir eine Sicherung ein“, wenn du eine möchtest.";
  const hinweis = nichtEingearbeitet(vault);
  if (b.art === "github") { try { git(vault, "push", "-q"); return "Online gesichert." + hinweis; } catch { return "Online-Sicherung hat gerade nicht geklappt (kein Internet?). Ich versuche es beim nächsten Mal wieder."; } }
  if (!existsSync(b.pfad)) return "Der Sicherungsordner ist gerade nicht da (Stick oder Platte nicht angeschlossen?). Ich sichere beim nächsten Mal.";
  // Datum nach Ortszeit (wie der Kalender des Nutzers), nicht UTC — sonst trüge eine Sicherung kurz nach Mitternacht das Vortagsdatum
  const h = new Date(), tag = `${h.getFullYear()}-${String(h.getMonth() + 1).padStart(2, "0")}-${String(h.getDate()).padStart(2, "0")}`;
  const datei = join(b.pfad, `brain-${tag}.bundle`);
  git(vault, "bundle", "create", datei, "--all");
  const alle = readdirSync(b.pfad).filter(f => /^brain-.*\.bundle$/.test(f)).sort((x, y) => statSync(join(b.pfad, y)).mtimeMs - statSync(join(b.pfad, x)).mtimeMs);
  for (const alt of alle.slice(7)) rmSync(join(b.pfad, alt));
  return `Gesichert in ${b.pfad}.` + hinweis;
}

export function wiederherstellen(quelle, ziel) {
  let nichtLeer = false;
  try { nichtLeer = existsSync(ziel) && readdirSync(ziel).length > 0; } catch { nichtLeer = true; }
  if (nichtLeer) return { ok: false, text: `Der Zielordner ${ziel} ist nicht leer — ich stelle nur in einen leeren oder neuen Ordner wieder her.` };
  try {
    execFileSync(gitBefehl(), ["clone", "-q", quelle, ziel], { stdio: "ignore", windowsHide: true });
    return { ok: true, text: `Wiederhergestellt nach ${ziel}.` };
  } catch {
    return { ok: false, text: "Wiederherstellen hat nicht geklappt — ist die Sicherungsdatei bzw. die Adresse richtig?" };
  }
}
