#!/usr/bin/env node
// .tools/w7.mjs — Fehler-Signal W7/K8 (B1, §4.4): Folgt auf eine Antwort, vor deren Prompt ein Brain-Hinweis eine Wiki-Seite
// gezeigt hat, eine Korrektur der Person, wird {seite, sitzung, zitat der Korrektur} an .logs/w7.jsonl angehängt. Der
// Tageslauf (B2) setzt daraus `zweifel` und stellt eine Rückfrage. 0 Tokens, nur Regeln.
// Quelle des Hinweises ist der Verlauf selbst (attachment hook_success, UserPromptSubmit, „Brain-Treffer …“) — genau das,
// was Claude gesehen hat, in der richtigen Reihenfolge. Läuft losgelöst über ernte-ausloeser.mjs (SessionEnd/PreCompact);
// mehrere Läufe derselben Sitzung schreiben jeden Fund nur einmal (Schlüssel sitzung|uuid|seite, Sperre .logs/w7.lock).
// CLI: node .tools/w7.mjs --transkript <pfad> --sid <id> --cwd <pfad> [vault]. Gibt nie etwas aus; Ergebnis in .logs/w7.log.
import { readFileSync, appendFileSync, mkdirSync, unlinkSync, realpathSync } from "node:fs";
import { join, isAbsolute, win32 } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { ladeTranskript, trenneEingespieltes } from "./beleg.mjs";
import { korrekturGewicht } from "./lektionen.mjs";
import { hatSecretsImKontext } from "./secrets-muster.mjs";
import { hatPii } from "./pii-muster.mjs";
import { leseAutomatik } from "./einstellungen.mjs";
import { istAusgeschlossen, nimmLock, leseArgs } from "./ernte.mjs";
import { haengeAn, zeitstempel } from "./logs.mjs";
import { ordner } from "./pfade.mjs";

const W7_MUSTER = /\bstimmt (?:so )?nicht\b|\bdas war falsch\b|\bnicht mehr aktuell\b|\bveraltet\b|\bist überholt\b/iu;
const MAX_ZITAT = 300;

export function istKorrektur(text) {
  const t = String(text ?? "");
  return korrekturGewicht(t) >= 2 || W7_MUSTER.test(t.slice(0, 600));
}

// Text der Person aus einer Verlaufszeile (ohne eingespielte Blöcke; Werkzeug-Ergebnisse und Meta-Zeilen zählen nicht).
function nutzerText(o) {
  if (o.type !== "user" || o.isMeta || o.isCompactSummary) return "";
  const c = o.message?.content;
  const roh = typeof c === "string" ? c
    : Array.isArray(c) ? c.filter((b) => b?.type === "text" && typeof b.text === "string").map((b) => b.text).join("\n") : "";
  return trenneEingespieltes(roh).rein;
}
function assistentHatText(o) {
  const c = o.message?.content;
  if (typeof c === "string") return c.trim() !== "";
  return Array.isArray(c) && c.some((b) => b?.type === "text" && typeof b.text === "string" && b.text.trim() !== "");
}
// Hook-Ausgabe im Verlauf: attachment hook_success → { ereignis, text }.
function hookAusgabe(o) {
  const a = o.type === "attachment" ? o.attachment : null;
  if (!a || a.type !== "hook_success") return null;
  const text = ["content", "stdout", "text"].map((k) => a[k]).find((t) => typeof t === "string" && t) ?? "";
  return { ereignis: String(a.hookEvent ?? ""), text };
}
const kuerze = (t, n) => (t.length <= n ? t : t.slice(0, n - 1) + "…");

// Wiki-Seiten aus einem Brain-Hinweis (Zeilen „- <pfad>[ (Zusatz)] — …“, hint-core.format) → vault-relativ.
export function hinweisSeiten(text, { vault, wiki = "09_wiki", home = homedir(), plattform = process.platform } = {}) {
  const t = String(text ?? "").trimStart();
  if (!t.startsWith("Brain-Treffer")) return [];
  const falt = plattform === "darwin" || plattform === "win32";
  const norm = (p) => { const f = String(p).replace(/\\/g, "/").replace(/\/+$/, "").normalize("NFC"); return falt ? f.toLowerCase() : f; };
  const v = vault ? norm(vault) : "";
  const h = String(home ?? "").replace(/\\/g, "/").replace(/\/+$/, "");
  const out = [];
  for (const zeile of t.split(/\r?\n/)) {
    const m = /^- (.+?\.md)(?: \([^)]*\))* — /.exec(zeile);
    if (!m) continue;
    let p = m[1].replace(/\\/g, "/").normalize("NFC");
    if (p.startsWith("~/")) p = h + p.slice(1);
    let rel = null;
    if (v && norm(p).startsWith(v + "/")) rel = p.slice(v.length + 1);
    else if (!isAbsolute(p) && !win32.isAbsolute(p)) rel = p;
    if (!rel || !rel.startsWith(wiki + "/") || rel.split("/").includes("..") || rel.split("/").pop().startsWith("_")) continue;
    if (!out.includes(rel)) out.push(rel);
  }
  return out;
}

// Runden: Prompt → (Hinweis) → Antwort → nächster Prompt. Ein Hinweis vor dem ersten Prompt (Sitzungsstart) gehört zu ihm.
export function erkenneW7(eintraege, { vault, wiki = "09_wiki", sitzung = "", home = homedir(), plattform = process.platform } = {}) {
  const funde = [];
  let wartend = [];
  let runde = null;
  for (const o of Array.isArray(eintraege) ? eintraege : []) {
    if (!o || typeof o !== "object" || o.isSidechain === true) continue;
    const h = hookAusgabe(o);
    if (h) {
      if (h.ereignis !== "UserPromptSubmit") continue;
      const ziel = runde && !runde.antwort ? runde.seiten : wartend;
      for (const s of hinweisSeiten(h.text, { vault, wiki, home, plattform })) if (!ziel.includes(s)) ziel.push(s);
      continue;
    }
    if (o.type === "assistant") { if (runde && assistentHatText(o)) runde.antwort = true; continue; }
    const text = nutzerText(o);
    if (!text) continue;
    if (runde?.antwort && runde.seiten.length && istKorrektur(text)) {
      const zitat = hatSecretsImKontext(text) || hatPii(text) ? "" : kuerze(text.replace(/\s+/g, " ").trim(), MAX_ZITAT);
      for (const seite of runde.seiten) funde.push({ seite, sitzung, uuid: String(o.uuid ?? ""), zeit: String(o.timestamp ?? ""), zitat });
    }
    runde = { seiten: wartend, antwort: false };
    wartend = [];
  }
  return funde;
}

const DATEI = (vault) => join(vault, ".logs", "w7.jsonl");
const schluessel = (f) => `${f.sitzung}|${f.uuid || f.zeit}|${f.seite}`;

export function leseW7(vault) {
  let roh = "";
  try { roh = readFileSync(DATEI(vault), "utf8"); } catch { return []; }
  const out = [];
  for (const z of roh.split("\n")) { try { const o = JSON.parse(z); if (o && typeof o.seite === "string") out.push(o); } catch {} }
  return out;
}
export function schreibeW7(vault, funde, { jetzt = Date.now() } = {}) {
  const bekannt = new Set(leseW7(vault).map(schluessel));
  const neu = [];
  for (const f of funde) {
    const k = schluessel(f);
    if (bekannt.has(k)) continue;
    bekannt.add(k);
    neu.push({ v: 1, seite: f.seite, sitzung: f.sitzung, uuid: f.uuid, zeit: f.zeit, zitat: f.zitat, erkannt: new Date(jetzt).toISOString().slice(0, 19) + "Z" });
  }
  if (neu.length) {
    mkdirSync(join(vault, ".logs"), { recursive: true });
    appendFileSync(DATEI(vault), neu.map((o) => JSON.stringify(o)).join("\n") + "\n");
  }
  return neu.length;
}

const kurzWarten = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

// Fail-closed wie die Ernte: ohne lesbare Config oder bekannten Ordner nichts; ernteNichtIn gilt auch hier.
export function w7Lauf(vault, { transkript, sid = "", cwd = "", jetzt = Date.now(), home = homedir() } = {}) {
  if (process.env.BRAIN_ERNTE === "1") return { status: "uebersprungen", grund: "Selbstaufruf", funde: 0, neu: 0 };
  const ende = (status, grund = "", funde = 0, neu = 0) => {
    try { haengeAn(join(vault, ".logs", "w7.log"), `${zeitstempel(new Date(jetzt))} status=${status}${grund ? ` grund=${encodeURIComponent(grund)}` : ""} funde=${funde} neu=${neu}`); } catch {}
    return { status, ...(grund ? { grund } : {}), funde, neu };
  };
  try {
    const { werte, fehler } = leseAutomatik(vault);
    if (fehler) return ende("uebersprungen", "Config nicht lesbar");
    if (!cwd || !(isAbsolute(cwd) || win32.isAbsolute(cwd))) return ende("uebersprungen", "Ordner unbekannt");
    if (istAusgeschlossen(cwd, werte.ernteNichtIn, { home })) return ende("uebersprungen", "ausgeschlossener Ordner");
    if (typeof transkript !== "string" || !transkript) return ende("uebersprungen", "Transkript nicht lesbar");
    const eintraege = ladeTranskript(transkript);
    if (eintraege.some((o) => typeof o.cwd === "string" && istAusgeschlossen(o.cwd, werte.ernteNichtIn, { home }))) return ende("uebersprungen", "ausgeschlossener Ordner");
    const funde = erkenneW7(eintraege, { vault, wiki: ordner(vault).wiki, sitzung: String(sid || "").replace(/[^\w-]/g, "").slice(0, 64), home });
    if (!funde.length) return ende("ok");
    const lock = join(vault, ".logs", "w7.lock");
    let frei = false;
    for (let i = 0; i < 40 && !(frei = nimmLock(lock, jetzt)); i++) kurzWarten(50);
    if (!frei) return ende("uebersprungen", "läuft schon", funde.length);
    try { return ende("ok", "", funde.length, schreibeW7(vault, funde, { jetzt })); }
    finally { try { unlinkSync(lock); } catch {} }
  } catch { return ende("fehler", "intern"); }
}

let aufruf = "";
try { aufruf = realpathSync(process.argv[1] || ""); } catch {}
if (aufruf && aufruf === realpathSync(fileURLToPath(import.meta.url))) {
  try {
    const { flags, vault } = leseArgs(process.argv.slice(2));
    w7Lauf(vault, { transkript: flags.transkript, sid: flags.sid || "", cwd: flags.cwd || "" });
  } catch { /* nie Ausgabe, nie blockierend */ }
}
