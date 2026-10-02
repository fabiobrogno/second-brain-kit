// lib/voraussetzungen.mjs — git, gh, QMD nach <home>/.brain-kit/, ohne Admin-Rechte, je System.
// Reine, testbare Namens-/Prüf-Funktionen oben; die "sorgeFür…"-Orchestrator-Funktionen unten führen
// die eigentliche Einrichtung aus (Seiteneffekte, inkl. echter Downloads über das injizierbare `laden`),
// geben aber IMMER ein Ergebnis-Objekt zurück statt zu werfen — ein fehlender git/gh/QMD darf den
// Alltag nie abbrechen (Profil "minimal" bzw. Status "fehler"/"fehlt" reichen).
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, readdirSync, renameSync, statSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

// --- reine Funktionen -------------------------------------------------------------------------

// endung: optionales Override ("tar.gz" statt des Standards "tar.xz" auf macOS/Linux) — z. B. wenn
// auf dem Zielsystem kein `xz` vorhanden ist (beide Endungen sind offizielle Node-Veröffentlichungen).
export function nodeArchivName(plattform, arch, version, endung) {
  const v = version.startsWith("v") ? version : `v${version}`;
  if (plattform === "win32") return `node-${v}-win-${arch}.${endung || "zip"}`;
  return `node-${v}-${plattform}-${arch}.${endung || "tar.xz"}`;
}

// Reines Mapping: Ergebnis von sorgeFuerGit() → absoluter git-Pfad fürs Vault-Config-Feld werkzeuge.git,
// oder null, wenn kein privates Werkzeug installiert wurde (git war schon vorhanden/System-Installation —
// dafür braucht es keinen festen Eintrag, PATH reicht). Von install.mjs UND vom Unit-Test genutzt, damit
// genau dieselbe Regel geprüft wird, die auch läuft.
export function werkzeugeGitAus(gitErgebnis) {
  if (gitErgebnis?.status === "mingit" && gitErgebnis.pfad) {
    return join(gitErgebnis.pfad, "cmd", "git.exe").split("\\").join("/");
  }
  return null;
}

// Reine Prüfung: läuft dieser Lauf selbst unter einem privaten, von bootstrap.sh/.ps1 ohne Admin-Rechte
// installierten Node (<heim>/node/…)? execPath/heim injizierbar fürs Testen. Beide Seiten werden zuerst
// über realpath aufgelöst (existiert der Pfad nicht — z. B. eine synthetische Testfixture — bleibt er
// unverändert): macOS löst $TMPDIR/$HOME u. a. über /private auf, process.execPath aber IMMER real —
// ein reiner String-Vergleich auf den unaufgelösten Pfaden würde sonst sogar beim echten privaten Node
// still false liefern.
export function istPrivaterNode(execPath, heim) {
  const real = (p) => { try { return realpathSync(p); } catch { return p; } };
  const execFwd = String(real(execPath)).split("\\").join("/");
  const heimFwd = String(real(heim)).split("\\").join("/");
  return execFwd === `${heimFwd}/node/bin/node` || execFwd.startsWith(`${heimFwd}/node/`);
}

export function minGitArchivName(arch, version) {
  if (arch === "arm64") return `MinGit-${version}-arm64.zip`;
  if (arch === "ia32" || arch === "x86") return `MinGit-${version}-32-bit.zip`;
  return `MinGit-${version}-64-bit.zip`;
}

const GH_OS = { darwin: "macOS", linux: "linux", win32: "windows" };
const GH_ARCH = { x64: "amd64", arm64: "arm64", ia32: "386" };
export function ghArchivName(plattform, arch, version) {
  const v = version.startsWith("v") ? version.slice(1) : version;
  const os = GH_OS[plattform] || plattform, ar = GH_ARCH[arch] || arch;
  // Offizielle cli/cli-Releases: macOS und Windows als .zip, Linux als .tar.gz.
  const ext = plattform === "linux" ? "tar.gz" : "zip";
  return `gh_${v}_${os}_${ar}.${ext}`;
}

// sha256Text = Inhalt einer SHASUMS256.txt/checksums.txt-ähnlichen Datei ("<hash>  <dateiname>" je Zeile).
export function pruefsummeOk(datei, sha256Text, name) {
  if (!existsSync(datei)) return false;
  const hash = createHash("sha256").update(readFileSync(datei)).digest("hex").toLowerCase();
  const zeile = sha256Text.split("\n").map(z => z.trim()).find(z => z.endsWith(name));
  if (!zeile) return false;
  const soll = zeile.split(/\s+/)[0].toLowerCase();
  return soll === hash;
}

// digest = GitHub-Releases-API-Format eines Assets, z. B. "sha256:<hex>".
export function digestOk(datei, digest) {
  if (!existsSync(datei) || !digest) return false;
  const [algo, soll] = String(digest).split(":");
  if (algo !== "sha256" || !soll) return false;
  const hash = createHash("sha256").update(readFileSync(datei)).digest("hex").toLowerCase();
  return hash === soll.toLowerCase();
}

// Promise-basiertes Warten (kein Kindprozess) — in Tests überschreibbar, damit nie wirklich gewartet wird.
function schlafAsync(ms) { return new Promise(r => setTimeout(r, ms)); }

function echtEntpacken(datei, zielDir) {
  mkdirSync(zielDir, { recursive: true });
  const tar = process.platform === "win32" ? "tar.exe" : "tar";
  execFileSync(tar, ["-xf", datei, "-C", zielDir], { windowsHide: true, stdio: "ignore" });
}

async function ladeDatei(laden, url, zielDatei) {
  const antwort = await laden(url);
  writeFileSync(zielDatei, Buffer.from(await antwort.arrayBuffer()));
}

// --- Orchestrator-Funktionen (Seiteneffekte, nie werfend) -------------------------------------

// Bewusst das nackte PATH-"git" (nicht gitBefehl() aus .tools/werkzeug.mjs): diese Prüfung entscheidet
// GERADE ERST, ob MinGit installiert werden muss — es gibt noch keinen bekannten Werkzeug-Ort/keine
// Config, die gitBefehl() befragen könnte. Außerdem liegt diese Datei in der Kit-Baustelle (kit/repo/lib/)
// und landet nach dem Export an einem anderen relativen Ort als ihre Quelle (→ <ziel>/lib/); ein einzelner
// relativer Import von werkzeug.mjs könnte nicht an beiden Orten stimmen. Test-Ausnahme: siehe test-plattform.mjs.
function echtHabeGit() { try { execFileSync("git", ["--version"], { windowsHide: true, stdio: "ignore" }); return true; } catch { return false; } }

const GIT_RELEASES_API = "https://api.github.com/repos/git-for-windows/git/releases/latest";
const FREUNDLICH_GIT_FEHLER = "Die Git-Installation hat gerade nicht geklappt — ich versuche es beim nächsten Mal wieder.";

// Windows-Zweig: lädt das offizielle, portable MinGit-Zip (git-for-windows-Release), prüft die
// Prüfsumme gegen das `digest`-Feld der GitHub-Releases-API und entpackt nach <home>/.brain-kit/git.
async function mingitEinrichten({ home, arch = process.arch, laden, entpacken = echtEntpacken, version }) {
  const zielDir = join(home, ".brain-kit", "git");
  mkdirSync(zielDir, { recursive: true });
  try {
    const release = await (await laden(GIT_RELEASES_API)).json();
    const tag = version || release.tag_name || "";
    const gitVersion = tag.replace(/^v/, "").replace(/\.windows\.\d+$/, "");
    const name = minGitArchivName(arch, gitVersion);
    const asset = (release.assets || []).find(a => a.name === name);
    if (!asset) return { status: "fehler", satz: FREUNDLICH_GIT_FEHLER };
    const datei = join(home, ".brain-kit", name);
    await ladeDatei(laden, asset.browser_download_url, datei);
    if (!digestOk(datei, asset.digest)) { try { rmSync(datei); } catch {} return { status: "fehler", satz: FREUNDLICH_GIT_FEHLER }; }
    await entpacken(datei, zielDir);
    try { rmSync(datei); } catch {}
    return { status: "mingit", pfad: zielDir, pathZusatz: [join(zielDir, "cmd"), join(zielDir, "mingw64", "bin")] };
  } catch {
    return { status: "fehler", satz: FREUNDLICH_GIT_FEHLER };
  }
}

export async function sorgeFuerGit({ plattform, home, quelle, habeGit = echtHabeGit, schlafFn = schlafAsync, maxWartenMs = 30 * 60 * 1000, intervallMs = 10_000, laden = fetch, entpacken, arch, version } = {}) {
  if (habeGit()) return { status: "vorhanden" };
  if (plattform === "darwin") {
    const satz = "Gleich erscheint ein Fenster von Apple — bitte auf „Installieren“ klicken, ich warte.";
    try { execFileSync("xcode-select", ["--install"], { windowsHide: true, stdio: "ignore" }); } catch {}
    let vergangen = 0;
    while (vergangen < maxWartenMs) {
      try { execFileSync("xcode-select", ["-p"], { windowsHide: true, stdio: "ignore" }); return { status: "installiert", satz }; } catch {}
      await schlafFn(intervallMs); vergangen += intervallMs;
    }
    return { status: "timeout", satz };
  }
  if (plattform === "win32") {
    // Quelle = bereits vorhandenes lokales Archiv (z. B. Testfixture) — sonst echter Download.
    if (quelle && existsSync(quelle)) {
      const zielDir = join(home, ".brain-kit", "git");
      mkdirSync(zielDir, { recursive: true });
      try { await (entpacken || echtEntpacken)(quelle, zielDir); } catch {}
      return { status: "mingit", pfad: zielDir, pathZusatz: [join(zielDir, "cmd"), join(zielDir, "mingw64", "bin")] };
    }
    return mingitEinrichten({ home, arch, laden, entpacken, version });
  }
  return { status: "fehlt", satz: "Bitte installiere git einmal selbst, z. B. mit: sudo apt install git (oder dnf/pacman install git je nach System)." };
}

export function sorgeFuerQmd({ home, npm } = {}) {
  const prefix = join(home, ".brain-kit");
  mkdirSync(prefix, { recursive: true });
  try {
    if (npm) {
      execFileSync(npm, ["i", "-g", "--prefix", prefix, "@tobilu/qmd"], { windowsHide: true, stdio: "ignore" });
    } else if (process.platform === "win32") {
      const npmCli = join(prefix, "node", "node_modules", "npm", "bin", "npm-cli.js");
      execFileSync(process.execPath, [npmCli, "i", "-g", "--prefix", prefix, "@tobilu/qmd"], { windowsHide: true, stdio: "ignore" });
    } else {
      execFileSync("npm", ["i", "-g", "--prefix", prefix, "@tobilu/qmd"], { windowsHide: true, stdio: "ignore" });
    }
    return { profil: "leicht" };
  } catch {
    return { profil: "minimal" };
  }
}

const GH_RELEASES_API = "https://api.github.com/repos/cli/cli/releases/latest";
const FREUNDLICH_GH_FEHLER = "Die GitHub-Werkzeug-Installation hat gerade nicht geklappt — ich versuche es beim nächsten Mal wieder.";

// Die gh-Archive haben je System eine andere Gestalt: macOS/Linux mit Wurzelordner gh_<v>_<os>_<arch>/bin/gh,
// Windows ohne (bin/gh.exe direkt). Darum in einen Zwischenordner entpacken, den Ordner mit bin/ suchen und
// ihn als <home>/.brain-kit/gh ablegen — zurück kommt der ECHTE bin-Ordner (dort liegt gh bzw. gh.exe).
function ghAblegen(tmpDir, home) {
  const ziel = join(home, ".brain-kit", "gh");
  let wurzel = null;
  if (existsSync(join(tmpDir, "bin"))) wurzel = tmpDir;
  else {
    const unter = readdirSync(tmpDir).map(n => join(tmpDir, n)).filter(p => statSync(p).isDirectory() && existsSync(join(p, "bin")));
    if (unter.length === 1) wurzel = unter[0];
  }
  if (!wurzel) return null;
  rmSync(ziel, { recursive: true, force: true });
  renameSync(wurzel, ziel);
  return join(ziel, "bin");
}

// gh (nur für die GitHub-Backup-Option): lädt das offizielle cli/cli-Release, prüft gegen dessen
// checksums.txt-Asset (gleiches Format wie Node) und legt es unter <home>/.brain-kit/gh ab (bin/ darin).
export async function sorgeFuerGh({ plattform, arch = process.arch, home, version, quelle, laden = fetch, entpacken = echtEntpacken } = {}) {
  const tmpDir = join(home, ".brain-kit", "gh-entpacken");
  rmSync(tmpDir, { recursive: true, force: true });
  mkdirSync(tmpDir, { recursive: true });
  const fertig = () => {
    const bin = ghAblegen(tmpDir, home);
    rmSync(tmpDir, { recursive: true, force: true });
    return bin ? { status: "bereit", pfad: bin } : { status: "fehler", satz: FREUNDLICH_GH_FEHLER };
  };
  if (quelle && existsSync(quelle)) {
    try { await entpacken(quelle, tmpDir); } catch { return { status: "fehler", satz: FREUNDLICH_GH_FEHLER }; }
    return fertig();
  }
  try {
    const release = await (await laden(GH_RELEASES_API)).json();
    const tag = version || release.tag_name || "";
    const ghVersion = tag.replace(/^v/, "");
    const name = ghArchivName(plattform, arch, ghVersion);
    const asset = (release.assets || []).find(a => a.name === name);
    if (!asset) return { status: "fehler", satz: FREUNDLICH_GH_FEHLER };
    const summenAsset = (release.assets || []).find(a => /checksums?\.txt$/i.test(a.name));
    const datei = join(home, ".brain-kit", name);
    await ladeDatei(laden, asset.browser_download_url, datei);
    let summenText = "";
    if (summenAsset) { const r = await laden(summenAsset.browser_download_url); summenText = await r.text(); }
    if (!pruefsummeOk(datei, summenText, name)) { try { rmSync(datei); } catch {} return { status: "fehler", satz: FREUNDLICH_GH_FEHLER }; }
    await entpacken(datei, tmpDir);
    try { rmSync(datei); } catch {}
    return { ...fertig(), name };
  } catch {
    return { status: "fehler", satz: FREUNDLICH_GH_FEHLER };
  }
}
