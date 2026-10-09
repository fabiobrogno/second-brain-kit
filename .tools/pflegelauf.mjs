#!/usr/bin/env node
// .tools/pflegelauf.mjs — Pflege-Lauf mit KI (v0.4, Spec D; opt-in): Pflegebericht (pflege.mjs) + Kandidatenseiten
// aus review-kandidaten.mjs → Haiku (schlank wie die Ernte, dieselben Helfer aus ernte.mjs) → höchstens 8 Vorschläge
// `art: pflege` in <inbox>/_vorschlaege/. Ändert NIE das Wiki. Dazu (Spec H) der Session-Auswerter über die Verläufe
// der letzten 7 Tage — nur die des eigenen Vaults (~/.claude/projects/<kodierter Vault-Pfad>/), Schalter `lektionen`.
// Wöchentlich (Schalter pflegeLauf = "woechentlich"): session-start ruft starteWennFaellig() — losgelöst.
// Per Klick: Dienst-Route POST /api/pflege/lauf → starteLosgeloest(vault). Höchstens ein Lauf zugleich.
// Gibt beim Lauf nie etwas aus; Ergebnis in .logs/pflege-lauf.log (Zeichen und Token-Zahlen aus `usage`).
// CLI: node .tools/pflegelauf.mjs [--anlass knopf|woechentlich] [vault]
// Testhaken: BRAIN_PFLEGELAUF_SKRIPT ersetzt den Pfad zu diesem Skript beim losgelösten Start.
import { readFileSync, readdirSync, statSync, lstatSync, realpathSync, unlinkSync, mkdirSync, writeFileSync, utimesSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawn, execFile } from "node:child_process";
import { findeSecrets, ohneSecrets, hatSecretsImKontext } from "./secrets-muster.mjs";
import { hatPii } from "./pii-muster.mjs";
import { haengeAn, zeitstempel, leseZeilen } from "./logs.mjs";
import { leseAutomatik } from "./einstellungen.mjs";
import { schreibeVorschlag, KI_BEFUNDE } from "./vorschlaege.mjs";
import { EIGENER_VAULT, ordner, entferneBom } from "./pfade.mjs";
import { findeClaude, rufeHaiku, leseClaudeAntwort, nimmLock } from "./ernte.mjs";
import { lektionenAusVerlaeufen } from "./lektionen.mjs";

const HIER = dirname(fileURLToPath(import.meta.url));
export const MAX_VORSCHLAEGE = 8;
export const MAX_EINGABE = 24000;
const MAX_SEITE = 4000;
const WOCHE_MS = 7 * 24 * 3600 * 1000;
const LOCK_ALT_MS = 5 * 60 * 1000;
const fwd = (p) => String(p).split("\\").join("/");
const ohneGit = (env) => Object.fromEntries(Object.entries(env).filter(([k]) => !k.startsWith("GIT_")));

export const PFLEGE_AUFTRAG = [
  "Du prüfst ein persönliches Markdown-Wiki auf Pflegebedarf. Unten stehen ein Pflegebericht und Auszüge geänderter Seiten.",
  "Schreibe NIE Zugangsdaten, Passwörter, Tokens, Schlüssel, Adressen, Telefonnummern oder Kundendaten.",
  `Nenne höchstens ${MAX_VORSCHLAEGE} konkrete Pflege-Vorschläge, wichtigste zuerst. Je Vorschlag genau:`,
  "### <Titel, höchstens 60 Zeichen>",
  `befund: ${KI_BEFUNDE.filter(b => b !== "sonstiges").join(" | ")} | sonstiges`,
  "<1–3 Sätze: welche Seiten, was genau, nächster Schritt>",
  "Nur Vorschläge, keine Änderungen. Gibt es nichts zu tun, antworte nur: NICHTS",
].join("\n");
export const BERICHT_KOPF = "--- PFLEGEBERICHT ---\n\n";
export const SEITEN_KOPF = "\n--- SEITEN ---\n\n";

const PFLEGE_DIR = (vault) => join(vault, ".logs", "pflege");
const LOCK = (vault) => join(PFLEGE_DIR(vault), "lauf.lock");
// Zwischen dem losgelösten Start und dem Lock des Kindprozesses vergeht etwas Zeit — diese Marke überbrückt sie,
// damit ein zweiter Klick gleich „läuft schon“ (409) bekommt. Das Kind entfernt sie, sobald es den Lock hat.
const GESTARTET = (vault) => join(PFLEGE_DIR(vault), "gestartet");
const GESTARTET_MS = 60 * 1000;
export const START_MARKE = (vault) => join(vault, ".logs", "pflege-lauf-start");

// ---------- Eingaben ----------

// Pflegebericht aus pflege.mjs (Task 2) — per Lazy-Import, fehlt das Modul → null (Lauf geht ohne Bericht weiter).
const PFLEGE_MODUL = join(HIER, "pflege.mjs");
async function ladePflegeModul(modulPfad = PFLEGE_MODUL) {
  try { return await import(pathToFileURL(modulPfad).href); } catch { return null; }
}
export async function ladePflegebericht(vault, { jetzt = Date.now(), modulPfad = PFLEGE_MODUL } = {}) {
  try {
    const m = await ladePflegeModul(modulPfad);
    if (!m || typeof m.pflegebericht !== "function") return null;
    const b = await m.pflegebericht(vault, { jetzt });
    return b && Array.isArray(b.posten) ? b : null;
  } catch { return null; }
}

let eintragText = null;
try { ({ eintragText } = await import(pathToFileURL(PFLEGE_MODUL).href)); } catch { /* pflege.mjs fehlt → JSON */ }
export function berichtText(bericht) {
  if (!bericht || !Array.isArray(bericht.posten)) return "";
  const z = [];
  for (const p of bericht.posten) {
    if (!p || !(Number(p.anzahl) > 0)) continue;
    // Einträge sind strukturiert (pflege.mjs) → als deutscher Text für die KI; ältere Strings bleiben, wie sie sind
    const text = (e) => (typeof e === "string" ? e : typeof eintragText === "function" ? eintragText(p.schluessel, e) : JSON.stringify(e));
    const liste = Array.isArray(p.liste) ? p.liste.slice(0, 10).map(text).join(", ") : "";
    z.push(`- ${p.schluessel}: ${Number(p.anzahl)}${liste ? ` (${liste})` : ""}${p.naechsterSchritt ? ` — ${p.naechsterSchritt}` : ""}`);
  }
  return z.join("\n");
}

// review-kandidaten.mjs ist ein CLI-Skript (Ausgabe JSON) → als Kindprozess, ohne geerbte GIT_*.
export function ladeKandidaten(vault) {
  return new Promise((fertig) => {
    try {
      execFile(process.execPath, [join(HIER, "review-kandidaten.mjs"), vault],
        { windowsHide: true, timeout: 30000, maxBuffer: 4 * 1024 * 1024, encoding: "utf8", env: { ...ohneGit(process.env), BRAIN_VAULT: vault } },
        (err, stdout) => {
          if (err) { fertig({ seiten: [], nachbarn: [] }); return; }
          try {
            const j = JSON.parse(stdout);
            fertig({ seiten: Array.isArray(j.seiten) ? j.seiten : [], nachbarn: Array.isArray(j.nachbarn) ? j.nachbarn : [] });
          } catch { fertig({ seiten: [], nachbarn: [] }); }
        });
    } catch { fertig({ seiten: [], nachbarn: [] }); }
  });
}

const norm = (p) => { const f = fwd(p).replace(/\/+$/, ""); return process.platform === "darwin" || process.platform === "win32" ? f.toLowerCase() : f; };
// Seitentexte (Secret-gefiltert, je ≤ 4000 Zeichen) — nur echte Dateien, die (nach realpath) im Wiki liegen.
export function seitenText(vault, pfade, budget) {
  let wikiEcht;
  try { wikiEcht = norm(realpathSync(join(vault, ordner(vault).wiki))); } catch { return ""; }
  const teile = [];
  let rest = budget;
  for (const rel of pfade) {
    if (rest <= 200) break;
    if (typeof rel !== "string" || !rel.endsWith(".md")) continue;
    const f = join(vault, rel);
    try {
      if (!lstatSync(f).isFile()) continue;
      if (!norm(realpathSync(f)).startsWith(wikiEcht + "/")) continue;
      let t = ohneSecrets(entferneBom(readFileSync(f, "utf8"))).trim();
      if (findeSecrets(t).length) continue;
      if (t.length > MAX_SEITE) t = t.slice(0, MAX_SEITE) + "\n…";
      const block = `## ${fwd(rel)}\n${t}\n`;
      if (block.length > rest) { teile.push(block.slice(0, rest)); rest = 0; break; }
      teile.push(block); rest -= block.length + 1;
    } catch { /* unlesbar → überspringen */ }
  }
  return teile.join("\n");
}

// ---------- Wochen-Zeile (Sitzungsstart) ----------

export const WOCHE_MARKE = (vault) => join(vault, ".logs", "pflege-woche");
// Kurzlabels (Vorschläge, Lektionen, Entscheidungen haben eigene Sitzungsstart-Zeilen; Messlatte ist ein Trend;
// bald/nie gelesen/Lücken sind nur Hinweise — wie pflege.mjs#wochenZeile).
const WOCHE_LABEL = {
  abgelaufen: (n) => `${n} abgelaufen`,
  konflikte: (n) => `${n} ${n === 1 ? "Konflikt" : "Konflikte"}`, dubletten: (n) => `${n} ${n === 1 ? "Dublette" : "Dubletten"}`,
  verwaist: (n) => `${n} verwaist`,
  zuLang: (n) => `${n} zu lang`, importe: (n) => `${n} ${n === 1 ? "Import" : "Importe"} offen`,
};
function eigeneWochenZeile(bericht) {
  const teile = bericht.posten
    .filter(p => p && Object.hasOwn(WOCHE_LABEL, p.schluessel) && Number(p.anzahl) > 0)
    .map(p => WOCHE_LABEL[p.schluessel](Math.round(Number(p.anzahl))));
  return teile.length ? `Brain-Woche: ${teile.slice(0, 4).join(" · ")} — im Gehirn unter Pflege` : "";
}
// Bericht aus dem Cache der letzten Berechnung (.logs/pflege-bericht.json, geschrieben von session-hintergrund
// über `pflege.mjs --cache`) — 0 Wartezeit im Sitzungsstart (W1-Review #6). Fehlt er oder ist er älter als eine
// Woche → null (dann keine Zeile und keine Marke; der Hintergrund rechnet ihn für den nächsten Start).
export async function berichtAusCache(vault, { jetzt = Date.now() } = {}) {
  try {
    const f = join(vault, ".logs", "pflege-bericht.json");
    if (jetzt - statSync(f).mtimeMs > WOCHE_MS) return null;
    const j = JSON.parse(readFileSync(f, "utf8"));
    return j && j.bericht && Array.isArray(j.bericht.posten) ? j.bericht : null;
  } catch { return null; }
}

// Einmal je 7 Tage (Marke .logs/pflege-woche), nur wenn etwas zu tun ist (~25 Tokens). Fehlt der Bericht (kein
// Cache) oder ist nichts zu tun, gibt es keine Zeile und keine Marke. Den Text baut pflege.mjs#wochenZeile(bericht) (→ Zeile oder
// null); fehlt die Funktion, gilt ein eigener Rückfall. → genau eine Zeile oder "".
export async function wochenHinweis(vault, { jetzt = Date.now(), ladeBericht = berichtAusCache, modulPfad = PFLEGE_MODUL } = {}) {
  if (process.env.BRAIN_ERNTE === "1") return "";
  const { werte } = leseAutomatik(vault);
  if (werte.wochenbericht === false) return "";
  try { if (jetzt - statSync(WOCHE_MARKE(vault)).mtimeMs <= WOCHE_MS) return ""; } catch {}
  const bericht = await ladeBericht(vault, { jetzt });
  if (!bericht) return "";
  let zeile;
  try {
    const m = await ladePflegeModul(modulPfad);
    if (m && typeof m.wochenZeile === "function") {
      const z = m.wochenZeile(bericht);
      zeile = typeof z === "string" ? z : "";
    }
  } catch { zeile = undefined; }
  if (zeile === undefined) zeile = eigeneWochenZeile(bericht);
  zeile = String(zeile).split(/\r?\n/)[0].trim().slice(0, 200);
  // Die Woche wird nur mit einer Meldung verbraucht (Final-Review #5): ohne Befund keine Marke — läuft am Tag 2
  // eine Seite ab, meldet der nächste Start es sofort.
  if (!zeile) return "";
  try {
    mkdirSync(dirname(WOCHE_MARKE(vault)), { recursive: true });
    writeFileSync(WOCHE_MARKE(vault), "");
    const d = new Date(jetzt); utimesSync(WOCHE_MARKE(vault), d, d);
  } catch {}
  return zeile;
}

// ---------- Antwort ----------

export function parsePflege(ausgabe) {
  const t = String(ausgabe || "").replace(/\r\n?/g, "\n").trim();
  if (!t || /^NICHTS\b/.test(t)) return [];
  const out = [];
  for (const block of t.split(/^###[ \t]+/m).slice(1)) {
    const [kopf, ...rest] = block.split("\n");
    const titel = kopf.trim().slice(0, 60);
    let befund = "sonstiges";
    const text = [];
    for (const z of rest) {
      const m = /^\s*befund\s*:\s*(.*)$/i.exec(z);
      if (m) {
        const b = m[1].trim().toLowerCase().replace(/ü/g, "ue");
        befund = KI_BEFUNDE.includes(b) ? b : "sonstiges";
      } else text.push(z);
    }
    const inhalt = text.join("\n").trim();
    if (titel && inhalt) out.push({ titel, befund, text: inhalt });
  }
  return out.slice(0, MAX_VORSCHLAEGE);
}

// ---------- Verläufe der Woche (Session-Auswerter) ----------

// Claude Code legt Verläufe unter ~/.claude/projects/<cwd mit jedem Nicht-Alphanumerischen als „-">/ ab.
export function kodierterOrdner(pfad) {
  return String(pfad).replace(/[^A-Za-z0-9]/g, "-");
}
export function verlaeufeDerWoche(vault, { home = homedir(), jetzt = Date.now() } = {}) {
  const dir = join(home, ".claude", "projects", kodierterOrdner(vault));
  let namen;
  try { namen = readdirSync(dir); } catch { return []; }
  const out = [];
  for (const n of namen) {
    if (!n.endsWith(".jsonl")) continue;
    const f = join(dir, n);
    try {
      const st = lstatSync(f);
      if (!st.isFile() || jetzt - st.mtimeMs > WOCHE_MS) continue;
      out.push({ transkript: f, sid: basename(n, ".jsonl"), cwd: vault, zeit: st.mtimeMs });
    } catch {}
  }
  return out.sort((a, b) => b.zeit - a.zeit).slice(0, 50);
}

// ---------- Lauf ----------

export async function pflegeLauf(vault, { claudeBefehl, jetzt = Date.now(), anlass = "knopf", home = homedir(), ladeBericht = ladePflegebericht, ladeKand = ladeKandidaten } = {}) {
  const ergebnis = (status, grund, extra = {}) => ({ status, ...(grund ? { grund } : {}), vorschlaege: [], ...extra });
  if (process.env.BRAIN_ERNTE === "1") return ergebnis("uebersprungen", "Selbstaufruf");
  const log = join(vault, ".logs", "pflege-lauf.log");
  const protokoll = (status, felder) => haengeAn(log, `${zeitstempel(new Date(jetzt))} anlass=${anlass} status=${status}${felder}`);
  try {
    const { werte, fehler } = leseAutomatik(vault);
    if (fehler) return ergebnis("uebersprungen", "Config nicht lesbar");
    if (!nimmLock(LOCK(vault), jetzt)) return ergebnis("uebersprungen", "läuft schon");
    try { unlinkSync(GESTARTET(vault)); } catch {}
    try {
      // Session-Auswerter über die Verläufe der Woche (eigener Lock, eigene Schalterprüfung, 0 Tokens bei „lokal").
      let lektionen = 0;
      if (werte.lektionen !== "aus") {
        const verlaeufe = verlaeufeDerWoche(vault, { home, jetzt });
        if (verlaeufe.length) {
          const r = await lektionenAusVerlaeufen(vault, verlaeufe, { claudeBefehl, jetzt, anlass: "pflege-lauf" });
          lektionen = r.vorschlaege?.length || 0;
        }
      }
      const bericht = await ladeBericht(vault, { jetzt });
      const bText = berichtText(bericht);
      const kandidaten = await ladeKand(vault);
      const budget = MAX_EINGABE - BERICHT_KOPF.length - SEITEN_KOPF.length - bText.length;
      const sText = seitenText(vault, [...new Set([...kandidaten.seiten, ...kandidaten.nachbarn])], Math.max(0, budget));
      if (!bText && !sText) {
        protokoll("ok", ` ein=0 aus=0 vorschlaege=0 verworfen=0 lektionen=${lektionen} grund=nichts-zu-pruefen`);
        return ergebnis("ok", "nichts zu prüfen", { lektionen });
      }
      const befehl = claudeBefehl === undefined ? findeClaude() : claudeBefehl;
      if (!befehl) {
        protokoll("fehler", ` ein=0 aus=0 lektionen=${lektionen} grund=claude-fehlt`);
        return ergebnis("fehler", "claude nicht gefunden", { lektionen });
      }
      const eingabe = (BERICHT_KOPF + (bText || "(kein Bericht)") + SEITEN_KOPF + (sText || "(keine geänderten Seiten)") + "\n").slice(0, MAX_EINGABE + 200);
      const einZeichen = PFLEGE_AUFTRAG.length + eingabe.length;
      const r = await rufeHaiku(befehl, PFLEGE_AUFTRAG, eingabe, vault, { zweck: "pflege" });
      const antwort = r.fehler ? null : leseClaudeAntwort(r.ausgabe);
      const f = r.fehler || antwort.fehler;
      const tok = (t) => (t ? ` tokEin=${t.ein} tokAus=${t.aus}` : "");
      if (f) {
        protokoll("fehler", ` ein=${einZeichen} aus=0${tok(antwort?.tokens)} lektionen=${lektionen} grund=${encodeURIComponent(f)}`);
        return ergebnis("fehler", f, { lektionen });
      }
      const ids = [];
      let verworfen = 0;
      for (const v of parsePflege(antwort.text)) {
        // Zugangs- oder Kundendaten in der KI-Antwort → Vorschlag verworfen (fail-closed, nie gekürzt)
        if (hatSecretsImKontext(`${v.titel}\n${v.text}`) || hatPii(`${v.titel}\n${v.text}`)) { verworfen++; continue; }
        try { ids.push(schreibeVorschlag(vault, { art: "pflege", titel: v.titel, text: v.text, befund: v.befund, ordner: "", sitzung: "pflege-lauf" }, new Date(jetzt))); }
        catch { verworfen++; }
      }
      protokoll("ok", ` ein=${einZeichen} aus=${antwort.text.length}${tok(antwort.tokens)} vorschlaege=${ids.length} verworfen=${verworfen} lektionen=${lektionen}`);
      return ergebnis("ok", null, { vorschlaege: ids, verworfen, lektionen, tokens: antwort.tokens });
    } finally { try { unlinkSync(LOCK(vault)); } catch {} }
  } catch {
    protokoll("fehler", " grund=intern");
    return ergebnis("fehler", "interner Fehler");
  }
}

// ---------- Losgelöst starten ----------

function laeuft(vault, jetzt = Date.now()) {
  try { if (jetzt - statSync(LOCK(vault)).mtimeMs <= LOCK_ALT_MS) return true; } catch {}
  try { return jetzt - statSync(GESTARTET(vault)).mtimeMs <= GESTARTET_MS; } catch { return false; }
}

// → { gestartet: true } | { gestartet: false, grund } — für den Dienst (POST /api/pflege/lauf) und session-start.
export function starteLosgeloest(vault, { anlass = "knopf" } = {}) {
  if (process.env.BRAIN_ERNTE === "1") return { gestartet: false, grund: "Selbstaufruf" };
  if (laeuft(vault)) return { gestartet: false, grund: "läuft schon" };
  if (!process.env.BRAIN_PFLEGELAUF_SKRIPT && !findeClaude()) return { gestartet: false, grund: "claude fehlt" };
  const skript = process.env.BRAIN_PFLEGELAUF_SKRIPT || fileURLToPath(import.meta.url);
  const a = anlass === "woechentlich" ? "woechentlich" : "knopf";
  try {
    const kind = spawn(process.execPath, [skript, "--anlass", a, vault], {
      cwd: vault, detached: true, stdio: "ignore", windowsHide: true, env: { ...ohneGit(process.env), BRAIN_VAULT: vault },
    });
    kind.on("error", () => {});
    kind.unref();
    try { mkdirSync(PFLEGE_DIR(vault), { recursive: true }); writeFileSync(GESTARTET(vault), ""); } catch {}
    return { gestartet: true };
  } catch { return { gestartet: false, grund: "Start fehlgeschlagen" }; }
}

// Wöchentlich fällig: Schalter „woechentlich" und letzter Start (Marke .logs/pflege-lauf-start) > 7 Tage her.
export function faellig(vault, { jetzt = Date.now(), werte = leseAutomatik(vault).werte } = {}) {
  if (werte.pflegeLauf !== "woechentlich") return false;
  try { return jetzt - statSync(START_MARKE(vault)).mtimeMs > WOCHE_MS; } catch { return true; }
}

// session-start (Hintergrund-Zweig): fällig → Marke setzen, dann losgelöst starten. → true, wenn gestartet.
export function starteWennFaellig(vault, { jetzt = Date.now() } = {}) {
  if (process.env.BRAIN_ERNTE === "1") return false;
  const { werte, fehler } = leseAutomatik(vault);
  if (fehler || !faellig(vault, { jetzt, werte })) return false;
  const r = starteLosgeloest(vault, { anlass: "woechentlich" });
  if (r.gestartet || r.grund === "claude fehlt") {
    // Auch ohne claude die Marke setzen — sonst versucht es jeder Sitzungsstart erneut.
    try {
      mkdirSync(dirname(START_MARKE(vault)), { recursive: true });
      writeFileSync(START_MARKE(vault), "");
      const d = new Date(jetzt); utimesSync(START_MARKE(vault), d, d);
    } catch {}
  }
  return r.gestartet === true;
}

// Für die Steuerzentrale: ist claude da, läuft gerade ein Lauf, was kostete der letzte?
export function pflegeLaufStatus(vault) {
  const zeilen = leseZeilen(join(vault, ".logs", "pflege-lauf.log"));
  const letzte = zeilen.length ? zeilen[zeilen.length - 1] : null;
  return {
    claude: Boolean(findeClaude()),
    laeuft: laeuft(vault),
    letzter: letzte ? {
      // logs.mjs schreibt UTC ohne Zone — mit „Z“ liest die Ansicht sie nicht als Ortszeit (Final-Review #2)
      zeit: letzte.zeit ? (/(?:[zZ]|[+-]\d{2}:?\d{2})$/.test(String(letzte.zeit)) ? String(letzte.zeit) : `${letzte.zeit}Z`) : null, status: letzte.status ?? null, anlass: letzte.anlass ?? null,
      vorschlaege: Number(letzte.vorschlaege) || 0,
      tokEin: letzte.tokEin != null ? Number(letzte.tokEin) : null, tokAus: letzte.tokAus != null ? Number(letzte.tokAus) : null,
    } : null,
  };
}

// ---------- CLI ----------

const selbst = fileURLToPath(import.meta.url);
let aufruf = "";
try { aufruf = realpathSync(process.argv[1] || ""); } catch {}
if (aufruf && aufruf === realpathSync(selbst)) {
  const argv = process.argv.slice(2);
  let anlass = "knopf", vault = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--anlass") { anlass = argv[i + 1] === "woechentlich" ? "woechentlich" : "knopf"; i++; }
    else if (!argv[i].startsWith("--")) vault = vault || argv[i];
  }
  const r = await pflegeLauf(vault || process.env.BRAIN_VAULT || EIGENER_VAULT, { anlass });
  process.exitCode = r.status === "fehler" ? 1 : 0;
}
