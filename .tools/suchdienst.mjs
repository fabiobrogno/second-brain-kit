#!/usr/bin/env node
// Suchdienst: hält QMD-Store + Reranker warm, damit der Hinweis-Hook in ~1 s rerankt statt jedes Mal Modelle zu laden.
// Nutzung: node suchdienst.mjs [vault]. Eine Instanz je Vault — der Socket selbst ist das Lock (kein PID-Lock).
// Protokoll: je Verbindung eine JSON-Zeile {query, limit, top} → eine JSON-Zeile {ok, results|code}.
// Loggt nie Prompt-Text. Leerlauf (BRAIN_DIENST_IDLE_MS, Standard 30 min) → Socket + PID weg, Exit 0.
import net from "node:net";
import { readFileSync, writeFileSync, unlinkSync, chmodSync, statSync, appendFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { vaultPfad } from "./pfade.mjs";

const vault = vaultPfad();
const logs = join(vault, ".logs"), sock = join(logs, "suchdienst.sock"), pidDatei = join(logs, "suchdienst.pid");
const log = (s) => { try { appendFileSync(join(logs, "hooks.log"), `${new Date().toISOString().slice(0, 19)} suchdienst ${s}\n`); } catch {} };
if (Buffer.byteLength(sock) > 100) { log("fehler=SOCKPFAD"); process.exit(0); }   // macOS-Grenze für Unix-Sockets ~104 Bytes
mkdirSync(logs, { recursive: true });

const probe = () => new Promise((ja) => { const c = net.createConnection(sock); c.on("connect", () => { c.destroy(); ja(true); }); c.on("error", () => ja(false)); });
const lauschen = (server) => new Promise((ja, nein) => { server.once("error", nein); server.listen(sock, () => { server.off("error", nein); ja(); }); });

let meinIno = null, ende = false, bereit = false;
const aufraeumen = (grund) => {
  if (ende) return; ende = true;
  try { if (statSync(sock).ino === meinIno) unlinkSync(sock); } catch {}
  try { if (readFileSync(pidDatei, "utf8").trim() === String(process.pid)) rmSync(pidDatei, { force: true }); } catch {}
  log(`ende grund=${grund}`); process.exit(0);   // kein dispose: llama.cpp-Teardown hängt/stürzt gelegentlich
};

// Anfragen nacheinander abarbeiten (ein Modell, ein Kontext)
let kette = Promise.resolve(), leerlauf = null, lib = null, mapCache = { mtime: 0, map: null };
const idleMs = Number(process.env.BRAIN_DIENST_IDLE_MS || 30 * 60000);
const weckeLeerlauf = () => { clearTimeout(leerlauf); leerlauf = setTimeout(() => aufraeumen("leerlauf"), idleMs); };
const wikiMap = () => { const f = join(logs, "wiki-map.json"), m = statSync(f).mtimeMs;
  if (m !== mapCache.mtime) mapCache = { mtime: m, map: JSON.parse(readFileSync(f, "utf8")) }; return mapCache.map; };

async function beantworte(zeile) {
  if (!bereit) return { ok: false, code: "EWARM" };   // Aufwärmen läuft: sofort antworten statt den Hook in den Timeout zu schicken
  try { if (statSync(sock).ino !== meinIno) { setImmediate(() => aufraeumen("socket-ersetzt")); return { ok: false, code: "EERSETZT" }; } }
  catch { setImmediate(() => aufraeumen("socket-weg")); return { ok: false, code: "EERSETZT" }; }
  const { query, limit = 20, top = 3 } = JSON.parse(zeile);
  const { sucheMitRerank } = await import("./such-kern.mjs");
  const store = await lib.oeffneStore();
  const results = await sucheMitRerank({ query: String(query || "").slice(0, 2000), store, reranker: lib.rerank, kartenDir: join(logs, "hint-karten"), map: wikiMap(), limit, top });
  return { ok: true, results };
}

const server = net.createServer((c) => {
  weckeLeerlauf();
  let rein = "", gelesen = false;
  c.on("error", () => {});
  c.on("data", (d) => {
    if (gelesen) return;
    rein += d; if (rein.length > 65536) { c.destroy(); return; }
    if (!rein.includes("\n")) return;
    gelesen = true;
    const zeile = rein.slice(0, rein.indexOf("\n"));
    kette = kette.then(async () => {
      if (c.destroyed) return;   // Client längst weg (Timeout) → keinen Stau abarbeiten
      let antwort; try { antwort = await beantworte(zeile); } catch (e) { antwort = { ok: false, code: e.code || "EDIENST" }; }
      try { c.end(JSON.stringify(antwort) + "\n"); } catch {}
      weckeLeerlauf();
    });
  });
});

// Socket = Lock: belegt und antwortet → es läuft schon einer; Leiche → wegräumen und einmal neu versuchen
try { await lauschen(server); }
catch (e) {
  if (e.code !== "EADDRINUSE" || await probe()) process.exit(0);
  try { unlinkSync(sock); await lauschen(server); } catch { process.exit(0); }
}
chmodSync(sock, 0o600);
meinIno = statSync(sock).ino;
writeFileSync(pidDatei, String(process.pid));
process.on("SIGTERM", () => aufraeumen("sigterm"));
process.on("SIGINT", () => aufraeumen("sigint"));
// Erst jetzt QMD laden (Lock vor schwerem Import) und aufwärmen
lib = await import(process.env.BRAIN_DIENST_LIB ? pathToFileURL(process.env.BRAIN_DIENST_LIB).href : "./qmd-dienst-lib.mjs");
try { await lib.oeffneStore(); await lib.rerank("aufwärmen", [{ file: "w", text: "aufwärmen" }]); log(`start pid=${process.pid} warm`); }
catch (e) { log(`start pid=${process.pid} aufwaermen-fehler=${e.code || e.name}`); }
// Zwei gleichzeitige Starts auf einer Leiche: wer den Socket nicht (mehr) besitzt, geht
try { if (statSync(sock).ino !== meinIno) aufraeumen("socket-verloren"); } catch { aufraeumen("socket-weg"); }
writeFileSync(pidDatei, String(process.pid));
bereit = true;
weckeLeerlauf();
