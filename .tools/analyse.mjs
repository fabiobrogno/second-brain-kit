#!/usr/bin/env node
// .tools/analyse.mjs — Kennzahlen für die Steuerzentrale (Task 5): Trefferquote des Brain-Hinweises,
// ob Hinweise auch gelesen werden, Seiten-Pflegezustand, Token-Schätzung, offene Importe. Rein lesend
// (außer `merkeLuecke`, die NUR das eigene `.logs/luecken.log` schreibt). Wirft nie — eine kaputte oder
// fehlende Log-Datei liefert einfach leere/neutrale Werte statt eine Ausnahme.
import {
  readFileSync, writeFileSync, renameSync, unlinkSync, mkdirSync, existsSync, readdirSync, realpathSync,
} from "node:fs";
import { join, dirname, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { zeitstempel, leseZeilen, leseFelder } from "./logs.mjs";
import { wert, leseAutomatik } from "./einstellungen.mjs";
import { findeSecrets } from "./secrets-muster.mjs";
import { vaultPfad, ladeConfig, ordner, entferneBom } from "./pfade.mjs";
import { istAusgeschlossen } from "./ernte.mjs";
import { inventar } from "./ansicht/mcp-inventar.mjs";
import { walk } from "./vault-dateien.mjs";
import { istWikiSeite } from "./wiki-pfade.mjs";

const TAG_MS = 86400000;
const ZEHN_MIN_MS = 10 * 60000;

const normRel = (rel) => String(rel).split(sep).join("/");
// Kalendertag in ORTSZEIT (Log-Zeitstempel sind UTC ohne "Z") — „heute“ wechselt um Mitternacht vor Ort,
// nicht um 01:00/02:00 Uhr. Unlesbarer Zeitstempel → die ersten 10 Zeichen wie bisher.
const zweistellig = (n) => String(n).padStart(2, "0");
const tagAusMs = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${zweistellig(d.getMonth() + 1)}-${zweistellig(d.getDate())}`; };
const tagVon = (zeit) => {
  const ms = Date.parse(`${zeit}Z`);
  return Number.isFinite(ms) ? tagAusMs(ms) : String(zeit || "").slice(0, 10);
};
// hint.log kürzt die sid auf 8 Zeichen, werkzeug.log hält bis 64 — verglichen wird immer die 8er-Form.
const kurzSid = (sid) => String(sid || "").slice(0, 8);
const zahl = (x, standard = 0) => { const n = Number(x); return Number.isFinite(n) ? n : standard; };

// --- hint.log: Trefferquote, Wege, Antwortzeit --------------------------------------------------------
// `hits=` wird hier aus dem ROHEN Feldwert zerlegt (leseFelder dekodiert das ganze Feld und verlöre sonst die
// Grenze zwischen Seiten, deren Name selbst ein Komma trägt). Unterstützt: alles in einem URI-kodiert mit Tab
// als Trenner (`encodeURIComponent(seiten.join("\t"))`), je Seite kodiert und mit "," verbunden, und alte rohe
// Zeilen ("a.md,b.md").
export function hitsSeiten(roh) {
  const r = String(roh ?? "");
  if (!r || r === "-") return [];
  const dekodiere = (x) => { try { return decodeURIComponent(x); } catch { return x; } };
  const ganz = dekodiere(r);
  const teile = ganz.includes("\t") ? ganz.split("\t") : r.split(",").map(dekodiere);
  return teile.map((t) => t.trim()).filter(Boolean);
}

function leseHinweise(vault, seitMs) {
  let inhalt;
  try { inhalt = readFileSync(join(vault, ".logs", "hint.log"), "utf8"); } catch { return []; }
  const out = [];
  for (const z of inhalt.split(/\r?\n/)) {
    if (!z) continue;
    const f = leseFelder(z);
    const t = Date.parse(`${f.zeit}Z`);
    if ((Number.isNaN(t) ? 0 : t) < seitMs) continue;
    const m = z.match(/(?:^| )hits=(\S*)/);
    f.seiten = hitsSeiten(m ? m[1] : "");
    out.push(f);
  }
  return out;
}

function hatHinweis(f) {
  if (Array.isArray(f.seiten)) return f.seiten.length > 0;
  return typeof f.hits === "string" && f.hits.length > 0 && f.hits !== "-";
}

function kostenJeHinweis(f) {
  const z = Number(f.zeichen);
  return Number.isFinite(z) && z >= 0 ? Math.ceil(z / 4) : 60;
}

function wegBucket(weg) {
  if (weg === "dienst" || weg === "dienst-vektor") return "dienst";
  if (weg === "kalt-rerank") return "kalt";
  return "sonst";
}

function p95(werte) {
  if (!werte.length) return 0;
  // Nearest-Rank: Rang ceil(n·0,95), also Index ceil(n·0,95) − 1 (bei n = 20 der 19. Wert, nicht das Maximum).
  const sortiert = [...werte].sort((a, b) => a - b);
  return sortiert[Math.max(0, Math.min(sortiert.length - 1, Math.ceil(sortiert.length * 0.95) - 1))] || 0;
}

function auswertenHinweise(zeilen) {
  const prompts = zeilen.length;
  const mitHinweis = zeilen.filter(hatHinweis);
  const wege = { dienst: 0, kalt: 0, sonst: 0 };
  for (const f of zeilen) wege[wegBucket(f.weg)]++;
  const proTagMap = new Map();
  for (const f of zeilen) {
    const tag = tagVon(f.zeit);
    if (!proTagMap.has(tag)) proTagMap.set(tag, { tag, prompts: 0, mitHinweis: 0 });
    const e = proTagMap.get(tag);
    e.prompts++;
    if (hatHinweis(f)) e.mitHinweis++;
  }
  const proTag = [...proTagMap.values()].sort((a, b) => a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0);
  return {
    prompts,
    mitHinweis: mitHinweis.length,
    quote: prompts ? mitHinweis.length / prompts : 0,
    proTag,
    wege,
    p95ms: p95(zeilen.map(f => zahl(f.ms, NaN)).filter(Number.isFinite)),
  };
}

// --- werkzeug.log: wurde die gehinweiste Seite auch gelesen? ------------------------------------------
function leseGelesenZeilen(vault, seitMs) {
  return leseZeilen(join(vault, ".logs", "werkzeug.log"), { seitMs }).filter(f => f.art === "lesen");
}

function auswertenGelesen(hinweisZeilen, gelesenZeilen) {
  const mitHinweis = hinweisZeilen.filter(hatHinweis);
  const nachSid = new Map();
  for (const w of gelesenZeilen) {
    const s = kurzSid(w.sid);
    if (!s) continue;
    if (!nachSid.has(s)) nachSid.set(s, []);
    nachSid.get(s).push(w);
  }
  let hinweiseMitLesen = 0;
  for (const h of mitHinweis) {
    const seiten = new Set(h.seiten || hitsSeiten(h.hits));
    const hintMs = Date.parse(`${h.zeit}Z`);
    const kandidaten = nachSid.get(kurzSid(h.sid)) || [];
    const gelesen = kandidaten.some((w) => {
      if (!seiten.has(w.ziel)) return false;
      const wMs = Date.parse(`${w.zeit}Z`);
      return Number.isFinite(wMs) && Number.isFinite(hintMs) && wMs >= hintMs && wMs - hintMs <= ZEHN_MIN_MS;
    });
    if (gelesen) hinweiseMitLesen++;
  }
  return { hinweiseMitLesen, quote: mitHinweis.length ? hinweiseMitLesen / mitHinweis.length : 0 };
}

// --- hint-eval.log: eigenes Zeilenformat (keine k=v-Zeile) --------------------------------------------
const HINT_EVAL_MUSTER = /^hint-eval (\S+) positiv=(\d+\/\d+) still=(\d+\/\d+) kontrolle=(\d+\/\d+) holdout=(\d+\/\d+) p95ms=(\d+) ok=([01])/;

function leseMesslatte(vault) {
  let inhalt = "";
  try { inhalt = readFileSync(join(vault, ".logs", "hint-eval.log"), "utf8"); } catch { return []; }
  const out = [];
  for (const zeile of inhalt.split(/\r?\n/)) {
    const m = zeile.match(HINT_EVAL_MUSTER);
    if (!m) continue;
    out.push({
      datum: m[1], positiv: m[2], still: m[3], kontrolle: m[4], holdout: m[5],
      p95ms: Number(m[6]), ok: m[7] === "1",
    });
  }
  return out;
}

// --- Seiten: Gesamtzahl, nie gelesen, meistgelesen, verwaist/prüfbedürftig/konflikt aus lint-cache.txt -
// lint-cache.txt: "- <ART>: <pfad> — <grund>". Der Pfad darf Leerzeichen tragen und kommt unter Windows mit "\\".
export function lintPfade(text) {
  const verwaist = new Set(), pruefbeduerftig = new Set(), konflikt = new Set();
  const pfad = (s) => s.trim().split("\\").join("/");
  for (const z of String(text ?? "").split(/\r?\n/)) {
    let m;
    if ((m = z.match(/^- VERWAIST:\s*(.+?)(?: — |$)/))) verwaist.add(pfad(m[1]));
    else if ((m = z.match(/^- PRÜFBEDÜRFTIG[^:]*:\s*(.+?)(?: — |$)/))) pruefbeduerftig.add(pfad(m[1]));
    else if ((m = z.match(/^- KONFLIKT[^:]*:\s*(.+?)(?: — |$)/))) konflikt.add(pfad(m[1]));
  }
  return { verwaist, pruefbeduerftig, konflikt };
}

// „Nie gelesen“ und „meistgelesen“ gelten im Analyse-Fenster (seitMs), nicht über die ganze (rotierende) Log-Datei.
function leseSeiten(vault, cfg, o, seitMs) {
  const dateien = walk(vault, { wikiDir: o.wiki });
  const seiten = dateien.map(f => normRel(f.rel)).filter(p => istWikiSeite(p, o.wiki));
  const alleGelesen = leseGelesenZeilen(vault, seitMs);
  const zaehler = new Map();
  for (const w of alleGelesen) {
    if (!w.ziel) continue;
    zaehler.set(w.ziel, (zaehler.get(w.ziel) || 0) + 1);
  }
  const seitenSet = new Set(seiten);
  const nieGelesen = seiten.filter(p => !zaehler.has(p)).sort();
  const meistGelesen = [...zaehler.entries()]
    .filter(([p]) => seitenSet.has(p))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([seite, mal]) => ({ seite, mal }));

  const mitWiki = (s) => (s.startsWith(`${o.wiki}/`) ? s : `${o.wiki}/${s}`);
  let verwaist = new Set(), pruefbeduerftig = new Set(), konflikt = new Set();
  const lintCache = join(vault, ".logs", "lint-cache.txt");
  if (existsSync(lintCache)) {
    let roh = "";
    try { roh = readFileSync(lintCache, "utf8"); } catch { /* unlesbar — keine Lint-Befunde */ }
    const l = lintPfade(roh);
    verwaist = new Set([...l.verwaist].map(mitWiki));
    pruefbeduerftig = new Set([...l.pruefbeduerftig].map(mitWiki));
    konflikt = new Set([...l.konflikt].map(mitWiki));
  }
  return {
    gesamt: seiten.length,
    nieGelesen,
    meistGelesen,
    verwaist: [...verwaist].sort(),
    pruefbeduerftig: [...pruefbeduerftig].sort(),
    konflikt: [...konflikt].sort(),
  };
}

// --- Token-Schätzung -----------------------------------------------------------------------------------
function sessionsProTag(zeilen) {
  const tage = new Map();
  for (const f of zeilen) {
    const tag = tagVon(f.zeit);
    if (!tage.has(tag)) tage.set(tag, new Set());
    if (f.sid) tage.get(tag).add(kurzSid(f.sid));
  }
  return tage;
}

function summeSessions(tageMap) {
  let n = 0;
  for (const s of tageMap.values()) n += s.size;
  return n;
}

function hinweisTokens(zeilen) {
  return zeilen.filter(hatHinweis).reduce((summe, f) => summe + kostenJeHinweis(f), 0);
}

// Gemessene Token aus der claude-JSON-Antwort (tokEin/tokAus), sonst geschätzt aus den Zeichen (ein/aus ÷ 4).
function ernteTokens(zeilen) {
  return zeilen.reduce((summe, f) => summe + (f.tokEin != null || f.tokAus != null
    ? zahl(f.tokEin) + zahl(f.tokAus)
    : Math.ceil((zahl(f.ein) + zahl(f.aus)) / 4)), 0);
}

function leseIchKarteLaenge(vault, o) {
  try { return entferneBom(readFileSync(join(vault, o.wiki, "ich.md"), "utf8")).length; } catch { return 0; }
}

function auswertenTokens(vault, cfg, o, jetzt) {
  const heuteTag = tagAusMs(jetzt);
  const siebenSeit = jetzt - 7 * TAG_MS;
  const hintSieben = leseHinweise(vault, siebenSeit);
  const hintHeute = hintSieben.filter(f => tagVon(f.zeit) === heuteTag);
  const ernteSieben = leseZeilen(join(vault, ".logs", "ernte.log"), { seitMs: siebenSeit });
  const ernteHeute = ernteSieben.filter(f => tagVon(f.zeit) === heuteTag);

  const sessionsSiebenMap = sessionsProTag(hintSieben);
  const sessionsSieben = summeSessions(sessionsSiebenMap);
  const sessionsHeute = (sessionsSiebenMap.get(heuteTag) || new Set()).size;

  const ichKarteAn = !!wert(vault, "ichKarte");
  const projektAn = !!wert(vault, "projektAutomatik");
  const ichKosten = Math.ceil(leseIchKarteLaenge(vault, o) / 4);

  const posten = {
    hinweise: hinweisTokens(hintSieben),
    ichKarte: ichKarteAn ? sessionsSieben * ichKosten : 0,
    projekt: projektAn ? sessionsSieben * 30 : 0,
    ernte: ernteTokens(ernteSieben),
  };
  const heute = hinweisTokens(hintHeute)
    + (ichKarteAn ? sessionsHeute * ichKosten : 0)
    + (projektAn ? sessionsHeute * 30 : 0)
    + ernteTokens(ernteHeute);
  const sieben = posten.hinweise + posten.ichKarte + posten.projekt + posten.ernte;

  return { heute, sieben, geschaetzt: true, posten };
}

// --- Importe (Task 7: 00_inbox/_import/<name>/_bericht.json) ------------------------------------------
function leseImporte(vault, o) {
  const basis = join(vault, o.inbox, "_import");
  if (!existsSync(basis)) return [];
  const out = [];
  let eintraege = [];
  try { eintraege = readdirSync(basis, { withFileTypes: true }); } catch { return []; }
  for (const eintrag of eintraege.sort((a, b) => a.name < b.name ? -1 : 1)) {
    if (!eintrag.isDirectory()) continue;
    const berichtPfad = join(basis, eintrag.name, "_bericht.json");
    if (!existsSync(berichtPfad)) continue;
    try {
      const b = JSON.parse(entferneBom(readFileSync(berichtPfad, "utf8")));
      const anzahl = (x) => (Array.isArray(x) ? x.length : zahl(x, 0));
      const widersprueche = anzahl(b.widersprueche);
      // Import (Task 7) schreibt `duplikateExakt` als Liste der übersprungenen Dateien; eine Zahl geht auch.
      const duplikate = anzahl(b.duplikateExakt ?? b.duplikate);
      out.push({ quelle: b.quelle || eintrag.name, notizen: zahl(b.notizen, 0), duplikate, widersprueche });
    } catch { /* kaputter Bericht — überspringen */ }
  }
  return out;
}

// --- Lücken (merkeLuecke + Lesen in analyse) --------------------------------------------------------
function lueckenDatei(vault) { return join(vault, ".logs", "luecken.log"); }

// Häufige Füllwörter (de/en) — tragen nichts zur Erkennung einer Lücke bei.
const STOPPWOERTER = new Set((
  "der die das den dem des ein eine einer einen einem eines und oder aber auch nicht kein keine ist sind war waren "
  + "wird werden wurde hat haben hatte ich du er sie es wir ihr mir mich dir dich uns euch mein meine dein deine sein "
  + "seine ihre unser unsere was wer wie wo wann warum wieso welche welcher welches gibt es zu zum zur im in am an "
  + "auf aus bei mit nach von vor für über unter um bis durch ohne gegen noch schon nur so da dann wenn ob als dass "
  + "denn doch mal bitte kannst kann könnte soll sollte muss müssen hier dort dies diese dieser dieses jetzt "
  + "the a an and or but not no is are was were be been has have had i you he she it we they me my your our their "
  + "what who how where when why which there to of in on at by for with from about into this that these those "
  + "can could should would do does did please"
).split(" "));
const MAX_STICHWOERTER = 8;

// Aus einem Prompt NUR normalisierte Stichwörter machen (Ruling 3): klein, ohne Stoppwörter, ohne URLs und
// E-Mail-Adressen, ohne Wörter mit Ziffernfolgen ab 4 Stellen (Telefon, IBAN, Kundennummer), höchstens 8.
export function stichwoerter(text) {
  const t = String(text ?? "").normalize("NFC")
    .replace(new RegExp(String.raw`\b[a-z][a-z0-9+.-]*:[/]{2}\S*`, "gi"), " ") // Adressen mit Schema (auch Datenbank-Adressen)
    .replace(/\bwww\.\S+/gi, " ")
    .replace(/\S+@\S+/g, " ");                               // E-Mail-Adressen und user@host
  const gesehen = new Set(), out = [];
  for (const roh of t.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    if (roh.length < 2 || /\d{4,}/.test(roh) || STOPPWOERTER.has(roh) || gesehen.has(roh)) continue;
    gesehen.add(roh);
    out.push(roh);
    if (out.length >= MAX_STICHWOERTER) break;
  }
  return out;
}

// Merkt eine Wissensfrage ohne Treffer — gespeichert werden nur Stichwörter (stichwoerter()), nie der Prompt.
// Verworfen wird bei: Schalter aus, Config unlesbar, Zugangsdaten im Text (vor UND nach dem Zusammenfügen
// der Zeilen geprüft), Arbeitsordner in `ernteNichtIn` (Standard: process.cwd()), keine Stichwörter übrig.
export function merkeLuecke(vault, quelle, text, { cwd = process.cwd() } = {}) {
  try {
    const { werte, fehler } = leseAutomatik(vault);
    if (fehler || !werte.luecken) return false;
    if (cwd && istAusgeschlossen(String(cwd), werte.ernteNichtIn)) return false;
    const t = String(text ?? "");
    const einzeilig = t.replace(/\s+/g, " ");
    if (findeSecrets(t).length > 0 || findeSecrets(einzeilig).length > 0) return false;
    const woerter = stichwoerter(einzeilig);
    if (!woerter.length) return false;
    const datei = lueckenDatei(vault);
    const cutoff = Date.now() - 30 * TAG_MS;
    let behalten = [];
    try {
      behalten = readFileSync(datei, "utf8").split(/\r?\n/).filter(Boolean).filter((z) => {
        const ms = Date.parse(`${z.slice(0, 19)}Z`);
        return Number.isFinite(ms) && ms >= cutoff;
      });
    } catch { /* Datei fehlt noch — kein Problem */ }
    const neueZeile = `${zeitstempel()} quelle=${encodeURIComponent(String(quelle))} text=${woerter.join(" ")}`;
    try {
      mkdirSync(dirname(datei), { recursive: true });
      const tmp = `${datei}.${process.pid}.tmp`;
      writeFileSync(tmp, [...behalten, neueZeile].join("\n") + "\n");
      try { renameSync(tmp, datei); } catch { try { unlinkSync(tmp); } catch {} }
    } catch { /* darf nie werfen — nur bestmöglich schreiben */ }
    return true;
  } catch { return false; }
}

// MCP: nur die ANZAHL nicht lesbarer Client-Configs (Pfade enthielten den Benutzernamen) — Spec §3.C.
function mcpZahlen(vault) {
  try { return { nichtLesbar: inventar(vault).nichtLesbar.length }; } catch { return { nichtLesbar: 0 }; }
}

// --- Hauptfunktion ---------------------------------------------------------------------------------
export function analyse(vault, { tage = 30, jetzt = Date.now() } = {}) {
  const cfg = ladeConfig(vault);
  const o = ordner(vault, cfg);
  const seitMs = jetzt - tage * TAG_MS;

  const hinweisZeilen = leseHinweise(vault, seitMs);
  const gelesenZeilen = leseGelesenZeilen(vault, seitMs);
  const hinweise = auswertenHinweise(hinweisZeilen);
  const gelesen = auswertenGelesen(hinweisZeilen, gelesenZeilen);
  const messlatteVerlauf = leseMesslatte(vault);
  const messlatte = { letzter: messlatteVerlauf.length ? messlatteVerlauf[messlatteVerlauf.length - 1] : null, verlauf: messlatteVerlauf };
  const seiten = leseSeiten(vault, cfg, o, seitMs);
  const tokens = auswertenTokens(vault, cfg, o, jetzt);
  const importe = leseImporte(vault, o);
  const luecken = wert(vault, "luecken")
    ? leseZeilen(lueckenDatei(vault), { seitMs }).map(f => ({ zeit: f.zeit, quelle: f.quelle, text: f.text }))
    : null;

  return {
    zeitraumTage: tage,
    genugDaten: hinweise.prompts >= 5,
    hinweise,
    gelesen,
    messlatte,
    seiten,
    luecken,
    tokens,
    importe,
    mcp: mcpZahlen(vault),
  };
}

// --- CLI: node analyse.mjs [vault] [--json] --------------------------------------------------------
function textBericht(e) {
  const pct = (x) => `${Math.round(x * 100)} %`;
  const zeilen = [];
  zeilen.push(`Zeitraum: letzte ${e.zeitraumTage} Tage${e.genugDaten ? "" : " (noch wenig Daten)"}.`);
  zeilen.push(`Prompts geprüft: ${e.hinweise.prompts}, davon mit Hinweis: ${e.hinweise.mitHinweis} (${pct(e.hinweise.quote)}).`);
  zeilen.push(`Hinweise auch gelesen: ${e.gelesen.hinweiseMitLesen} (${pct(e.gelesen.quote)}).`);
  zeilen.push(`Wege: Dienst ${e.hinweise.wege.dienst}, Kaltstart ${e.hinweise.wege.kalt}, sonst ${e.hinweise.wege.sonst}. p95 ${e.hinweise.p95ms} ms.`);
  zeilen.push(e.messlatte.letzter
    ? `Letzte Qualitätsmessung (${e.messlatte.letzter.datum}): positiv ${e.messlatte.letzter.positiv}, still ${e.messlatte.letzter.still}.`
    : "Noch keine Qualitätsmessung gelaufen.");
  zeilen.push(`Wiki-Seiten: ${e.seiten.gesamt}, nie gelesen: ${e.seiten.nieGelesen.length}, verwaist: ${e.seiten.verwaist.length}.`);
  zeilen.push(`Prüfbedürftig: ${e.seiten.pruefbeduerftig.length}, offene Konflikte: ${e.seiten.konflikt.length}.`);
  zeilen.push(`Geschätzte Tokens heute: ${e.tokens.heute}, letzte 7 Tage: ${e.tokens.sieben}.`);
  if (e.luecken) zeilen.push(`Gemerkte Lücken: ${e.luecken.length}.`);
  if (e.importe.length) zeilen.push(`Offene Importe: ${e.importe.length}.`);
  if (e.mcp?.nichtLesbar) zeilen.push(`MCP-Konfigurationen nicht lesbar: ${e.mcp.nichtLesbar}.`);
  return zeilen.join("\n");
}

const selbst = fileURLToPath(import.meta.url);
let aufruf = "";
try { aufruf = realpathSync(process.argv[1] || ""); } catch {}
if (aufruf && aufruf === realpathSync(selbst)) {
  const vault = vaultPfad();
  const ergebnis = analyse(vault);
  if (process.argv.includes("--json")) console.log(JSON.stringify(ergebnis));
  else console.log(textBericht(ergebnis));
}
