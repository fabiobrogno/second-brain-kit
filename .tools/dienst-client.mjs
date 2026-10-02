// Client für den Suchdienst (Hook, Karten-Tor, Aufwärmer). Wirft Error mit .code: EDIENST (nicht erreichbar),
// ETIMEDOUT (hängt), ESOCKPFAD, oder den Code aus der Dienst-Antwort. Startet/erkennt Hänger über Marken in .logs/.
import net from "node:net";
import { spawn, execFileSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { statSync, writeFileSync, readFileSync, mkdirSync, rmSync } from "node:fs";

const pfade = (vault) => { const l = join(vault, ".logs"); return { l, sock: join(l, "suchdienst.sock"), pid: join(l, "suchdienst.pid"), haengt: join(l, "dienst-haengt"), start: join(l, "dienst-start") }; };
const fehler = (code) => Object.assign(new Error("Suchdienst"), { code });
const juengerAls = (f, ms) => { try { return Date.now() - statSync(f).mtimeMs < ms; } catch { return false; } };

export function frageDienst(vault, payload, { connectMs = 150, antwortMs = 2500 } = {}) {
  const { sock } = pfade(vault);
  if (Buffer.byteLength(sock) > 100) return Promise.reject(fehler("ESOCKPFAD"));
  return new Promise((ja, nein) => {
    let raus = "", fertig = false;
    const stop = (f, wert) => { if (fertig) return; fertig = true; clearTimeout(tc); clearTimeout(ta); c.destroy(); f(wert); };
    const c = net.createConnection(sock);
    const tc = setTimeout(() => stop(nein, fehler("EDIENST")), connectMs);
    let ta = null;
    c.on("connect", () => { clearTimeout(tc); ta = setTimeout(() => stop(nein, fehler("ETIMEDOUT")), antwortMs); c.write(JSON.stringify(payload) + "\n"); });
    c.on("data", (d) => { raus += d; if (!raus.includes("\n")) return;
      try { const m = JSON.parse(raus.slice(0, raus.indexOf("\n"))); m.ok ? stop(ja, m.results) : stop(nein, fehler(m.code || "EDIENST")); }
      catch { stop(nein, fehler("EDIENST")); } });
    c.on("error", () => stop(nein, fehler("EDIENST")));
    c.on("close", () => stop(nein, fehler("EDIENST")));
  });
}

// Nach einem Hänger 10 min nicht mehr fragen
export const istGesperrt = (vault) => juengerAls(pfade(vault).haengt, 10 * 60000);

// Hänger: Marke setzen und den Dienst hart beenden — aber nur, wenn die PID wirklich ein Suchdienst ist
export function meldeHaenger(vault) {
  const p = pfade(vault), zaehler = join(p.l, "dienst-timeouts");
  // Erst beim 2. Hänger in Folge (binnen 10 min) eingreifen — ein einzelner langsamer Moment (embed, Warteschlange) ist kein Hänger
  let n = 0; try { if (juengerAls(zaehler, 10 * 60000)) n = Number(readFileSync(zaehler, "utf8")) || 0; } catch {}
  try { mkdirSync(p.l, { recursive: true }); writeFileSync(zaehler, String(n + 1)); } catch {}
  if (n + 1 < 2) return;
  try { writeFileSync(p.haengt, new Date().toISOString()); rmSync(zaehler, { force: true }); } catch {}
  try {
    const pid = Number(readFileSync(p.pid, "utf8").trim());
    if (pid > 0 && execFileSync("ps", ["-p", String(pid), "-o", "command="], { encoding: "utf8", windowsHide: true }).includes("suchdienst.mjs")) {
      process.kill(pid, "SIGKILL"); rmSync(p.sock, { force: true }); rmSync(p.pid, { force: true });
    }
  } catch {}
}

// Losgelöst starten, höchstens 1× je 5 min (gegen Absturzschleifen mit ~1 GB Modell-Laden)
export function starteDienst(vault) {
  const p = pfade(vault);
  if (juengerAls(p.start, 5 * 60000) || istGesperrt(vault)) return false;
  try { mkdirSync(p.l, { recursive: true }); writeFileSync(p.start, new Date().toISOString()); } catch {}
  try {
    spawn(process.execPath, [fileURLToPath(new URL("./suchdienst.mjs", import.meta.url)), vault], { detached: true, stdio: "ignore", env: process.env, cwd: vault, windowsHide: true }).unref();
    return true;
  } catch { return false; }
}
