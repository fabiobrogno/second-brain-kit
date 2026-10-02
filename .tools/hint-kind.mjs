// Suche im Kindprozess: Timeout per SIGKILL greift auch bei synchron blockierendem Native-/SQLite-Code,
// native Abstürze beim Prozessende bleiben im Kind. Genutzt von brain-hint.mjs und hint-warm.mjs.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

export const suche = (modulUrl, query, opts, ms) => new Promise((ja, nein) => {
  const c = spawn(process.execPath, [fileURLToPath(new URL("./hint-suche.mjs", import.meta.url))], { stdio: ["pipe", "pipe", "ignore"], windowsHide: true });
  let out = "", fertig = false;
  const fehler = (code) => Object.assign(new Error("Suche"), { code });
  const t = setTimeout(() => { c.kill("SIGKILL"); if (!fertig) { fertig = true; nein(fehler("ETIMEDOUT")); } }, ms);
  c.on("error", e => { clearTimeout(t); if (!fertig) { fertig = true; nein(e); } });
  const auswerten = () => {
    clearTimeout(t);
    if (fertig) return; fertig = true;
    try { const m = JSON.parse(out); m.ok ? ja(m.results) : nein(fehler(m.code)); } catch { nein(fehler("SUCHE_ABGEBROCHEN")); }
  };
  // Sobald die JSON-Zeile vollständig ist: auswerten und Kind hart beenden (llama.cpp hängt beim Teardown).
  c.stdout.on("data", d => { out += d; if (out.includes("\n")) { c.kill("SIGKILL"); auswerten(); } });
  c.stdout.on("end", auswerten);
  c.stdin.end(JSON.stringify({ modulUrl, query, opts }));
});
