#!/usr/bin/env node
// .tools/doctor.mjs — "brain doctor": druckt je Prüfung eine Zeile `OK|FEHLT|WARN <prüfung> — <was tun>`,
// in Alltagssprache (keine Fachwörter, Details bleiben hier im Code/Log). Exit 0, solange kein FEHLT dabei
// ist (WARN blockiert nichts — der Alltag funktioniert trotzdem, nur nicht optimal).
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { totalmem } from "node:os";
import { vaultPfad, ladeConfig, configFehler, ordner, istQuellVault, renderVorlage } from "./pfade.mjs";
import { gitBefehl } from "./werkzeug.mjs";
import { qmdBefehl } from "./qmd-befehl.mjs";
import { pruefeUpdate, hinweisZeile } from "./update-check.mjs";

const vault = vaultPfad();
const cfgFuerGit = ladeConfig(vault);
const GIT = gitBefehl({ cfg: cfgFuerGit });
const zeilen = [];
const zeile = (status, pruefung, aktion) => zeilen.push(`${status} ${pruefung} — ${aktion}`);

// 1. Node-Version (die gesamte Kit-Technik braucht ≥ 20)
{
  const major = Number(process.versions.node.split(".")[0]);
  if (major >= 20) zeile("OK", "Node", `Version ${process.versions.node}`);
  else zeile("FEHLT", "Node", `Version ${process.versions.node} ist zu alt — brauche mindestens 20. Node neu installieren (siehe INSTALL.md).`);
}

// 2. git (Versionsgeschichte + Sicherheits-Check vor jedem Commit hängen daran)
let habeGit = false;
try { execFileSync(GIT, ["--version"], { windowsHide: true, stdio: "ignore" }); habeGit = true; zeile("OK", "git", "vorhanden"); }
catch { zeile("FEHLT", "git", "nicht gefunden — ohne git gibt es keine Versionsgeschichte und der Sicherheits-Check vor jedem Commit läuft nicht. git installieren (siehe INSTALL.md) und die Einrichtung erneut ausführen."); }

// 3. qmd (die bessere Suche) — fehlt sie, funktioniert die einfache Suche trotzdem, darum nur WARN.
// Ausnahme: "minimal" ist eine BEWUSSTE Wahl (z. B. von der Person oder per --profil minimal), keine
// Notlage — dafür gibt es kein WARN, sondern eine schlichte Bestätigung.
const b = qmdBefehl();
const gewaehltesProfil = ladeConfig(vault).suche?.profil;
let habeQmd = false;
if (gewaehltesProfil === "minimal") {
  zeile("OK", "Suche", "Einfache Suche aktiv (bewusst gewählt).");
} else {
  try { execFileSync(b.cmd, [...b.vorArgs, "--help"], { windowsHide: true, stdio: "ignore" }); habeQmd = true; zeile("OK", "Suche (qmd)", "vorhanden"); }
  catch { zeile("WARN", "Suche (qmd)", "noch nicht installiert — die einfache Suche ist aktiv. Sag „mach die Suche besser“, um sie nachzurüsten."); }
}

// 4. Collection "brain" (nur sinnvoll, wenn qmd da ist UND das gewählte Profil es auch nutzt — bei
// "minimal" fragt brain.mjs search() qmd nie, egal ob eine Sammlung existiert; habeQmd bleibt in dem
// Fall ohnehin false, siehe oben).
if (habeQmd && gewaehltesProfil !== "minimal") {
  let kennt = false;
  try { kennt = execFileSync(b.cmd, [...b.vorArgs, "collection", "list"], { windowsHide: true, encoding: "utf8" }).includes("brain"); } catch {}
  if (kennt) zeile("OK", "Such-Sammlung", "eingerichtet");
  else zeile("WARN", "Such-Sammlung", "noch nicht angelegt — führe „brain refresh“ aus.");
}

// 5. core.hooksPath (Sicherheits-Riegel vor jedem Commit)
try {
  const aktiv = execFileSync(GIT, ["-C", vault, "config", "core.hooksPath"], { windowsHide: true, encoding: "utf8" }).trim();
  if (aktiv === ".tools/git-hooks") zeile("OK", "Sicherheits-Check vor dem Commit", "aktiv");
  else zeile("FEHLT", "Sicherheits-Check vor dem Commit", `nicht aktiv (${aktiv || "kein Wert"}) — führe „node .tools/install-git-hooks.mjs ${vault}“ aus.`);
} catch { zeile("FEHLT", "Sicherheits-Check vor dem Commit", "kein git-Repo gefunden — die Einrichtung ist nicht abgeschlossen."); }

// 6. Config gültig + systemVersion gesetzt
const fehler = configFehler(vault);
if (fehler) zeile("FEHLT", "Einstellungsdatei", `brain.config.json ist beschädigt (${fehler}) — Sag „repariere meine Brain-Einstellungen“.`);
else {
  const cfg = ladeConfig(vault);
  if (cfg.systemVersion) zeile("OK", "Einstellungsdatei", `gültig, Version ${cfg.systemVersion}`);
  else if (istQuellVault(vault)) zeile("OK", "Quell-Vault (Entwicklung)", "systemVersion nicht nötig");
  else zeile("FEHLT", "Einstellungsdatei", "systemVersion fehlt — die Einrichtung ist nicht abgeschlossen. Führe die Installation erneut aus.");
}

// 7. Vault-Ordner vorhanden
{
  const cfg = ladeConfig(vault);
  const o = ordner(vault, cfg);
  const fehlend = Object.entries(o).filter(([, name]) => !existsSync(join(vault, name)));
  if (!fehlend.length) zeile("OK", "Ordner", "inbox/wiki/archiv vorhanden");
  else zeile("FEHLT", "Ordner", `fehlt: ${fehlend.map(([, n]) => n).join(", ")} — führe die Installation erneut aus.`);
}

// 8. Freier Arbeitsspeicher vs. gewähltes Suchprofil
{
  const cfg = ladeConfig(vault);
  const profil = cfg.suche?.profil;
  const ramGB = totalmem() / 1e9;
  if (profil === "voll" && ramGB < 8) zeile("WARN", "Suchprofil", `"voll" bei ${ramGB.toFixed(1)} GB Arbeitsspeicher — Profil "leicht" ist empfohlen (sag „stell die Suche auf leicht“).`);
  else zeile("OK", "Suchprofil", `${profil || "leicht"} (${ramGB.toFixed(1)} GB Arbeitsspeicher)`);
}

// 9. AGENTS.md aktuell (Hash des frischen Renders == Datei auf der Platte)
{
  const quelle = join(vault, ".tools", "kit", "AGENTS.md");
  const ziel = join(vault, "AGENTS.md");
  if (!existsSync(quelle) || !existsSync(ziel)) zeile("WARN", "AGENTS.md", "fehlt — wird bei der nächsten Sitzung automatisch erzeugt.");
  else {
    const render = renderVorlage(readFileSync(quelle, "utf8"), vault);
    if (render.replace(/\r\n/g, "\n") === readFileSync(ziel, "utf8").replace(/\r\n/g, "\n")) zeile("OK", "AGENTS.md", "aktuell");
    else zeile("WARN", "AGENTS.md", "nicht mehr aktuell — wird bei der nächsten Sitzung automatisch neu erzeugt.");
  }
}

// Update-Hinweis (Spec §3.9) — eigene Zeile, kein OK/FEHLT/WARN, blockiert nie.
let updateZeile = null;
try { updateZeile = hinweisZeile(await pruefeUpdate(vault), vault); } catch { /* offline/Fehler → still */ }

zeilen.forEach(z => console.log(z));
if (updateZeile) console.log(updateZeile);
process.exit(zeilen.some(z => z.startsWith("FEHLT")) ? 2 : 0);
