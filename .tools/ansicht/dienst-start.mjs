// .tools/ansicht/dienst-start.mjs — Ansicht-Dienst finden, starten, stoppen (für `brain zeig` und doctor).
// starteOderFinde(vault, { warteMs }) → { url, neu } | null
//   Läuft schon ein Dienst dieses Vaults (dienst.json + GET /api/ping mit passender vaultId), wird er
//   wiederverwendet; sonst wird dienst.mjs losgelöst gestartet (detached, windowsHide, unref) und bis zu
//   warteMs auf „bereit <port>“ gewartet. null = kein Dienst (Aufrufer fällt auf die file://-Ansicht zurück).
//   url enthält den Token im Fragment (#t=…) — nur zum Öffnen im Browser, nie ausgeben oder loggen.
// laufender(vault) → { port, pid, token } | null   (nur nachsehen, nichts starten)
// stoppe(vault) → true, wenn ein laufender Dienst beendet wurde.
// Testhaken: BRAIN_DIENST_AUS=1 → Start gilt als gescheitert (file://-Rückfall prüfbar).
import http from "node:http";
import { spawn } from "node:child_process";
import { readFileSync, rmSync, existsSync, writeFileSync, mkdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { vaultIdVon } from "./dienst-lib.mjs";

const HIER = dirname(fileURLToPath(import.meta.url));
const dienstDatei = (vault) => join(vault, ".logs", "ansicht", "dienst.json");
const warte = (ms) => new Promise((r) => setTimeout(r, ms));

function leseDienstDatei(vault) {
  try {
    const j = JSON.parse(readFileSync(dienstDatei(vault), "utf8").replace(/^\uFEFF/, ""));
    if (!Number.isInteger(j.port) || j.port <= 0 || j.port > 65535 || !/^[0-9a-f]{64}$/.test(String(j.token))) return null;
    return j;
  } catch { return null; }
}

// Anfrage an den Dienst mit Token (und Origin bei schreibenden Methoden) → { status, json } | null
function frage(port, token, pfad, { methode = "GET", timeoutMs = 800 } = {}) {
  return new Promise((ja) => {
    const headers = { "X-Brain-Token": token };
    if (methode !== "GET") { headers.Origin = `http://127.0.0.1:${port}`; headers["Content-Length"] = 0; }
    let fertig = false;
    const ende = (wert) => { if (fertig) return; fertig = true; clearTimeout(timer); ja(wert); };
    // encodeURI: ein Pfad mit Leerzeichen/Umlaut würfe in http.request synchron (ERR_UNESCAPED_CHARACTERS).
    let req;
    try {
      req = http.request({ host: "127.0.0.1", port, path: encodeURI(pfad), method: methode, headers }, (res) => {
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (d) => { if (text.length < 65536) text += d; });
        res.on("end", () => { let json = null; try { json = JSON.parse(text); } catch {} ende({ status: res.statusCode, json }); });
        res.on("error", () => ende(null));
      });
    } catch { ja(null); return; }   // ungültiger Pfad/Kopf (z. B. kaputtes Token in dienst.json) → „kein Dienst“
    const timer = setTimeout(() => { req.destroy(); ende(null); }, timeoutMs);
    req.on("error", () => ende(null));
    req.end();
  });
}

// Läuft ein Dienst DIESES Vaults? (dienst.json allein reicht nicht: Prozess kann tot sein, Port neu vergeben)
export async function laufender(vault, { timeoutMs = 800 } = {}) {
  const j = leseDienstDatei(vault);
  if (!j) return null;
  const r = await frage(j.port, j.token, "/api/ping", { timeoutMs });
  if (!r || r.status !== 200 || !r.json || r.json.vaultId !== vaultIdVon(vault)) return null;
  const { port, pid, token } = j;
  return { port, pid, token };
}

const url = (port, token) => `http://127.0.0.1:${port}/#t=${token}`;
const lockDatei = (vault) => join(vault, ".logs", "ansicht", "dienst.lock");
const LOCK_ALT_MS = 15000;

function prozessLebt(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; }
}

// Start-Lock (wx): zwei gleichzeitige `brain zeig` starten nie zwei Dienste. Ein Lock älter als 15 s gilt
// als liegengeblieben. → true = Lock genommen.
function nimmStartLock(vault) {
  const f = lockDatei(vault);
  try { mkdirSync(dirname(f), { recursive: true }); } catch {}
  for (let versuch = 0; versuch < 2; versuch++) {
    try { writeFileSync(f, `${process.pid}\n`, { flag: "wx" }); return true; }
    catch (e) {
      if (e.code !== "EEXIST") return false;
      let alt = false;
      try { alt = Date.now() - statSync(f).mtimeMs > LOCK_ALT_MS; } catch { continue; }
      if (!alt) return false;
      try { rmSync(f, { force: true }); } catch {}
    }
  }
  return false;
}

export async function starteOderFinde(vault, { warteMs = 3000 } = {}) {
  if (process.env.BRAIN_DIENST_AUS === "1") return null;
  const da = await gefunden(vault);
  if (da) return da;
  if (!nimmStartLock(vault)) {
    // Ein anderer Aufruf startet gerade — auf dessen Dienst warten statt einen zweiten zu starten.
    for (let i = 0; i < Math.ceil(warteMs / 100); i++) {
      await warte(100);
      const r = await laufender(vault, { timeoutMs: 300 });
      if (r) return { url: url(r.port, r.token), neu: false };
    }
    return null;
  }
  try { return await starteNeu(vault, warteMs); }
  finally { try { rmSync(lockDatei(vault), { force: true }); } catch {} }
}

// Laufender Dienst? Antwortet er nicht sofort, lebt sein Prozess aber noch (beschäftigt: großer Vault,
// Virenscanner), einmal mit 3 s erneut fragen — erst dann gilt dienst.json als veraltet und wird entfernt.
async function gefunden(vault) {
  const da = await laufender(vault);
  if (da) return { url: url(da.port, da.token), neu: false };
  const j = leseDienstDatei(vault);
  if (j && prozessLebt(j.pid)) {
    const nochmal = await laufender(vault, { timeoutMs: 3000 });
    if (nochmal) return { url: url(nochmal.port, nochmal.token), neu: false };
  }
  return null;
}

async function starteNeu(vault, warteMs) {
  // Nach dem Lock nochmal nachsehen (ein paralleler Aufruf kann inzwischen fertig sein).
  const da = await laufender(vault);
  if (da) return { url: url(da.port, da.token), neu: false };
  // Veraltete dienst.json (Prozess weg oder stumm) aufräumen, damit niemand ihr mehr folgt
  if (existsSync(dienstDatei(vault))) { try { rmSync(dienstDatei(vault), { force: true }); } catch {} }

  let kind;
  try {
    // cwd = Vault: der losgelöste Dienst hält sonst (Windows) den Projektordner der KI-Sitzung gesperrt.
    kind = spawn(process.execPath, [join(HIER, "dienst.mjs"), vault], {
      cwd: vault, detached: true, stdio: ["ignore", "pipe", "ignore"], windowsHide: true,
    });
  } catch { return null; }
  const port = await new Promise((ja) => {
    let puffer = "", fertig = false;
    const ende = (wert) => { if (fertig) return; fertig = true; clearTimeout(timer); ja(wert); };
    const timer = setTimeout(() => ende(null), warteMs);
    kind.stdout.setEncoding("utf8");
    kind.stdout.on("data", (d) => {
      puffer += d;
      const m = puffer.match(/^bereit (\d+)\r?\n/m);
      if (m) ende(Number(m[1]));
    });
    kind.on("error", () => ende(null));
    kind.on("exit", () => ende(null));
  });
  kind.stdout.destroy();
  kind.removeAllListeners();
  kind.on("error", () => {});
  if (!port) {
    // Zu langsam oder gescheitert: keinen halb gestarteten Prozess zurücklassen. Hat er sich beendet, weil
    // inzwischen ein anderer Dienst dieses Vaults läuft, diesen nehmen.
    try { kind.kill(); } catch {}
    const anderer = await laufender(vault);
    return anderer ? { url: url(anderer.port, anderer.token), neu: false } : null;
  }
  kind.unref();
  const j = leseDienstDatei(vault);
  if (!j || j.port !== port) return null;
  return { url: url(j.port, j.token), neu: true };
}

export async function stoppe(vault) {
  const da = await laufender(vault);
  if (!da) {
    // Kein erreichbarer Dienst dieses Vaults — eine liegengebliebene dienst.json ist nur Ballast
    try { rmSync(dienstDatei(vault), { force: true }); } catch {}
    return false;
  }
  await frage(da.port, da.token, "/api/stopp", { methode: "POST", timeoutMs: 1500 });
  for (let i = 0; i < 40; i++) {
    if (!existsSync(dienstDatei(vault)) && !(await frage(da.port, da.token, "/api/ping", { timeoutMs: 200 }))) return true;
    await warte(50);
  }
  return !(await laufender(vault));
}
