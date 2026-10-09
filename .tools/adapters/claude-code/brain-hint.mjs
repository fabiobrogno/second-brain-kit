#!/usr/bin/env node
// UserPromptSubmit-Hook: lokaler Brain-Hinweis über QMD-Vektorsuche auf den Karteikarten (0 API-Tokens).
// Schweigt ohne klaren Treffer. Nie blockierend: jeder Fehler → Exit 0 ohne Ausgabe, Befund ins Log.
// Loggt NIE Prompt-Text (Secrets-Regel) — nur Länge, Score, Seiten, Dauer, Zeichen des Hinweises.
// v0.3: Stufe automatik.hinweise (aus/niedrig/mittel/hoch), Import-Treffer „(Import, ungeprüft)",
// Lücken (nur mit Schalter luecken), Stand-Intervall (startet die Ernte --art stand losgelöst).
// BRAIN_ERNTE=1 (Selbstaufruf der Ernte) → sofort Exit 0 ohne Ausgabe.
if (process.env.BRAIN_ERNTE === "1") process.exit(0);
// Kit-Module erst nach dieser Prüfung laden (dynamisches import) — statische Importe würden vorher ausgewertet.
import { readFileSync, appendFileSync, writeFileSync, renameSync, mkdirSync, existsSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { join, basename } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
const { suche } = await import("../../hint-kind.mjs");
const { frageDienst, istGesperrt, meldeHaenger, starteDienst } = await import("../../dienst-client.mjs");
const { entscheide } = await import("../../such-kern.mjs");
const { shouldQuery, istWissensfrage, decide, format, countSuppressed, suchtext, istFolgefrage, qmdToRel } = await import("../../hint-core.mjs");
const { vorigeFrage } = await import("../../transkript.mjs");
const { vaultPfad, ordner, ladeConfig } = await import("../../pfade.mjs");
const { leseAutomatik, HINWEIS_SCHWELLEN } = await import("../../einstellungen.mjs");
const { starteErnte } = await import("./ernte-ausloeser.mjs");

const vault = vaultPfad();
const logs = join(vault, ".logs");
const t0 = Date.now();
let sid = "ohne";
let kalt = "-"; // unbekannt, bis die Session-Datei geprüft ist (frühe Fehler sind kein Kaltstart-Beleg)
// Marke zählt nur, wenn frisch (< 15 min): trap EXIT greift nicht bei SIGKILL/Absturz → Leiche verfälschte sonst jede Zeile
const refreshLaeuft = () => { try { return Date.now() - statSync(join(logs, "search-refresh.running")).mtimeMs < 15 * 60000 ? 1 : 0; } catch { return 0; } };
const log = (s) => {
  try {
    mkdirSync(logs, { recursive: true });
    const datei = join(logs, sid.startsWith("eval-") ? "hint-eval-runs.log" : "hint.log");
    appendFileSync(datei, `${new Date().toISOString().slice(0, 19)} sid=${sid.slice(0, 8)} ${s} kalt=${kalt} refresh=${refreshLaeuft()} ms=${Date.now() - t0}\n`);
    // Rotation (billig: nur ab ~150 KB lesen): > 2000 Zeilen → letzte 1000
    if (statSync(datei).size > 150000) {
      const z = readFileSync(datei, "utf8").split("\n").filter(Boolean);
      if (z.length > 2000) { const t = `${datei}.${process.pid}.tmp`; writeFileSync(t, z.slice(-1000).join("\n") + "\n"); renameSync(t, datei); }
    }
  } catch {}
};

// Treffer aus noch nicht eingearbeiteten Importen (<inbox>/_import/…): keine Wiki-Seite, darum nicht in
// decide()/entscheide(). Füllen nur freie Plätze nach den Wiki-Treffern auf, gekennzeichnet als ungeprüft.
// Eine Notiz, die eine Wiki-Seite schon als Quelle zitiert, ist eingearbeitet → kommt über die Wiki-Seite.
function importTreffer(basis, map, seen, { schwelle, max, vorhanden, praefix }) {
  const out = [];
  for (const r of Array.isArray(basis) ? basis : []) {
    if (vorhanden.length + out.length >= max) break;
    if (!r || typeof r.score !== "number" || r.score < schwelle) continue;
    const rel = qmdToRel(r.file, map);
    if (!rel || !rel.startsWith(praefix) || map.bySource?.[rel]?.length) continue;
    if (seen.has(rel) || vorhanden.some(h => h.page === rel) || out.some(h => h.page === rel)) continue;
    out.push({ page: rel, score: r.score, description: `(Import, ungeprüft) ${basename(rel).replace(/\.(md|markdown|txt)$/i, "")}`, import: true });
  }
  return out;
}
// Erste hint.log-Zeile dieser Sitzung (sid wird dort auf 8 Zeichen gekürzt) → Sitzungsbeginn in ms, sonst null.
function sitzungsBeginn(kurzSid) {
  try {
    for (const z of readFileSync(join(logs, "hint.log"), "utf8").split(/\r?\n/)) {
      if (!z.includes(` sid=${kurzSid} `)) continue;
      const ms = Date.parse(`${z.slice(0, 19)}Z`);
      if (Number.isFinite(ms)) return ms;
    }
  } catch {}
  return null;
}

// Stand-Intervall (Spec §G): .logs/ernte/<sid>.stand trägt den Zeitpunkt des letzten Stands. Älter als das
// Intervall → Ernte --art stand losgelöst starten und Zeitstempel erneuern. Fehlt die Datei: Sitzungsbeginn
// aus hint.log; ist auch der unbekannt, gilt „jetzt" als Startpunkt (Datei wird angelegt, keine Ernte).
function pruefeStand(input, stunden) {
  if (!(Number(stunden) > 0) || sid === "ohne" || sid.startsWith("eval-")) return;
  const transkript = input?.transcript_path ? String(input.transcript_path) : "";
  if (!transkript) return;
  const dir = join(logs, "ernte"), marke = join(dir, `${sid}.stand`), intervall = Number(stunden) * 3600000, jetzt = Date.now();
  let seit = null;
  try { seit = statSync(marke).mtimeMs; } catch { seit = sitzungsBeginn(sid.slice(0, 8)); }
  const faellig = seit != null && jetzt - seit >= intervall;
  if (seit != null && !faellig) return;
  mkdirSync(dir, { recursive: true });
  writeFileSync(marke, "");
  if (faellig) starteErnte(vault, { art: "stand", transkript, sid, cwd: input?.cwd ? String(input.cwd) : "" });
}

let input = null, automatik = null;
try {
  input = JSON.parse(readFileSync(0, "utf8") || "{}");
  const prompt = String(input.prompt || "");
  sid = String(input.session_id || "ohne").replace(/[^\w-]/g, "").slice(0, 64) || "ohne";
  automatik = leseAutomatik(vault).werte;
  // Folgefrage („und beim zweiten?"): vorige echte User-Nachricht aus dem Transkript mitnehmen (nie geloggt/gespeichert)
  const vorige = automatik.hinweise !== "aus" && istFolgefrage(prompt) && input.transcript_path ? vorigeFrage(String(input.transcript_path), prompt) : null;
  if (automatik.hinweise !== "aus" && (shouldQuery(prompt) || vorige)) {
    const voll = ladeConfig(vault); // toleriert fehlende/kaputte Config (→ {}) und ein BOM (Review B #7)
    const cfg = { ...(voll.hinweis && typeof voll.hinweis === "object" ? voll.hinweis : {}) };
    // Stufe niedrig/hoch verschiebt die Schwellen um ein Delta (Ruling nach W1-Review, HINWEIS_SCHWELLEN in
    // einstellungen.mjs): relativ zum jeweils geltenden Config-Wert (bzw. dessen Standard 0.45 weiter unten),
    // nie als absoluter Ersatzwert — sonst könnte „niedrig" je nach Config MEHR statt weniger Hinweise zeigen
    // als „mittel". mittel lässt die Config-Werte unverändert. Der Reranker bleibt aus, wenn er in der Config
    // aus ist (eine Stufe soll keinen Suchdienst einschalten).
    const stufe = HINWEIS_SCHWELLEN[automatik.hinweise];
    if (stufe) {
      cfg.schwelle = (cfg.schwelle ?? 0.45) + stufe.schwelle;
      if (cfg.rerankSchwelle != null) cfg.rerankSchwelle = cfg.rerankSchwelle + stufe.rerankSchwelle;
    }
    const praefix = `${ordner(vault, voll).inbox}/_import/`;
    const map = JSON.parse(readFileSync(join(logs, "wiki-map.json"), "utf8"));
    const seenDir = join(logs, "hint-seen");
    mkdirSync(seenDir, { recursive: true });
    const seenFile = join(seenDir, sid + ".txt");
    const seen = new Set(existsSync(seenFile) ? readFileSync(seenFile, "utf8").split("\n").filter(Boolean) : []);
    kalt = existsSync(seenFile) ? 0 : 1;
    if (!existsSync(seenFile)) writeFileSync(seenFile, "");
    const frage = suchtext(vorige ? `${vorige} ${prompt}` : prompt), max = cfg.max ?? 2, schwelle = cfg.schwelle ?? 0.45, gesamt = cfg.timeoutMs || 4000;
    let results = null, hits = null, weg = "vektor", basis = null, dienstFehler = "";
    // 1) Suchdienst (Reranker, warm) — nur mit Schalter rerankSchwelle und ohne frische Hänger-Sperre
    if (cfg.rerankSchwelle != null && !istGesperrt(vault)) {
      try {
        results = await frageDienst(vault, { query: frage, limit: 20, top: cfg.rerankTop ?? 3 }, { antwortMs: Math.max(300, Math.min(cfg.dienstMs ?? 2500, gesamt - 1500)) });
        if (results.some(x => typeof x.rr === "number")) {
          weg = "dienst"; basis = results.filter(x => typeof x.rr === "number").map(x => ({ file: x.file, score: x.rr }));
          hits = entscheide(results, map, seen, { rerankSchwelle: cfg.rerankSchwelle, max });
        } else { weg = "dienst-vektor"; basis = results; hits = decide(results, map, seen, { schwelle, max }); }
      } catch (e) {
        results = null; dienstFehler = ` dienst=${e.code || "fehler"}`;
        if (e.code === "ETIMEDOUT") meldeHaenger(vault); else if (e.code !== "ESOCKPFAD" && e.code !== "EWARM") starteDienst(vault);
      }
    }
    // 2) Rückfall: bisheriger Kindprozess-Weg (nur Vektor) mit der verbleibenden Zeit
    if (!hits) {
      const modul = process.env.BRAIN_HINT_SEARCH_MODULE || fileURLToPath(new URL("../../qmd-vector.mjs", import.meta.url));
      const rest = gesamt - (Date.now() - t0);
      // Schalter an und genug Zeit → einmalig selbst reranken (erster Prompt nach Pause ist so genauso sauber)
      const kaltRerank = cfg.rerankSchwelle != null && rest >= 3000;
      results = await suche(pathToFileURL(modul).href, frage, { collection: cfg.collection || "brainkarten", limit: 20, ...(kaltRerank ? { rerank: true, top: cfg.rerankTop ?? 3, vault } : {}) }, Math.max(500, rest));
      if (kaltRerank && results.some(x => typeof x.rr === "number")) {
        weg = "kalt-rerank"; basis = results.filter(x => typeof x.rr === "number").map(x => ({ file: x.file, score: x.rr }));
        hits = entscheide(results, map, seen, { rerankSchwelle: cfg.rerankSchwelle, max });
      } else { basis = results; hits = decide(results, map, seen, { schwelle, max }); }
    }
    const rerankWeg = weg === "dienst" || weg === "kalt-rerank";
    const wegSchwelle = rerankWeg ? cfg.rerankSchwelle : schwelle;
    hits = hits.concat(importTreffer(basis, map, seen, { schwelle: wegSchwelle, max, vorhanden: hits, praefix }));
    const top = rerankWeg ? Math.max(0, ...basis.map(x => x.score)) : (results[0]?.score ?? 0);
    const unterdrueckt = countSuppressed(basis, map, seen, { schwelle: wegSchwelle });
    const text = hits.length ? format(hits, { vault }) + "\n" : "";
    // hits=: EIN encodeURIComponent-Token über alle Seiten, Tab-getrennt (Review-Fund 2) — ein roher Join
    // mit "," ließ Seitennamen mit Leerzeichen/Komma (Import-Notizen) das k=v-Format bzw. die Trennung
    // zwischen den Treffern sprengen. decodeURIComponent (leseFelder) macht daraus wieder einen einzigen
    // String mit echten Tabs; analyse.mjs teilt den dann an "\t" (Rückfall "," für alte Log-Zeilen).
    const hitsFeld = hits.length ? encodeURIComponent(hits.map(h => h.page).join("\t")) : "-";
    log(`len=${prompt.length} weg=${weg}${dienstFehler} top=${top.toFixed?.(3) ?? 0} zeichen=${text.length} hits=${hitsFeld} unterdrueckt=${unterdrueckt}`);
    if (hits.length) {
      appendFileSync(seenFile, hits.map(h => h.page).join("\n") + "\n");
      process.stdout.write(text);
    }
    if (automatik.luecken && istWissensfrage(prompt)) {
      // Wissensfrage ohne Treffer → Lücke merken; mit Treffer → Fragespur (Lernschleife: las die KI danach eine
      // andere Seite?). Beide prüfen Schalter + Secrets + ernteNichtIn(cwd) selbst und speichern nur Stichwörter
      // plus die 8er-sid (Ruling 3/4; Modul nur bei Bedarf laden). cwd kommt aus demselben Hook-stdin (input).
      try {
        const { merkeLuecke, merkeFragespur } = await import("../../analyse.mjs");
        if (hits.length) merkeFragespur(vault, prompt, { cwd: input?.cwd, sid, hits: hits.map(h => h.page) });
        else merkeLuecke(vault, "hint", prompt, { cwd: input?.cwd, sid });
      } catch {}
    }
    for (const f of readdirSync(seenDir)) { const p = join(seenDir, f); if (Date.now() - statSync(p).mtimeMs > 2 * 86400000) unlinkSync(p); }
  }
} catch (e) { log(`fehler=${e.code || e.name || "unbekannt"}`); }
try { if (input && automatik) pruefeStand(input, automatik.staendeIntervallStunden); } catch {}
process.exit(0);
