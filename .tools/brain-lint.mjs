#!/usr/bin/env node
// Read-only-Lint. Nutzung: node brain-lint.mjs [vaultPfad]. Ausgabe: 1 Zeile pro Befund.
// Exit 0 = keine Befunde, Exit 2 = Befunde (niemals etwas ändern!).
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, sep, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { istWikiSeite, resolveLink, wikilinks, doppelteNamen } from "./wiki-pfade.mjs";
import { walk } from "./vault-dateien.mjs";
import { vaultPfad, ladeConfig, ordner, configFehler, entferneBom } from "./pfade.mjs";
import { gitBefehl } from "./werkzeug.mjs";
import { gueltigkeit } from "./gueltigkeit.mjs";
import { fragenRoh, pruefeFragen } from "./fragen.mjs";
import { leseSeitenFelder, pruefeSeitenFelder } from "./seitenfelder.mjs";

// --struktur: nur blockierende Prüfungen, ohne Indexer-Lauf/QMD/~/.claude — für den pre-commit-Hook (auf Schnappschüssen)
const struktur = process.argv.includes("--struktur");
const vault = vaultPfad();
const cfg = ladeConfig(vault);
const mod = cfg.module || {};
const teamWissen = mod.teamWissen ?? false;
const claudeMemory = mod.claudeMemory ?? false;
const GIT = gitBefehl({ cfg });
const { inbox: inboxName, wiki: wikiName, archiv: archivName } = ordner(vault, cfg);
const wikiDir = join(vault, wikiName);
const findings = [];
// Kaputtes brain.config.json: ladeConfig() liefert dafür nur still {} — das muss aber gemeldet werden,
// sonst merkt niemand, dass gerade mit Standardwerten statt der echten Konfiguration gearbeitet wird.
const configDefekt = configFehler(vault);
if (configDefekt) findings.push(`CONFIG: brain.config.json ist kein gültiges JSON (${configDefekt}) — es gelten Standardwerte; Datei reparieren`);
// Normal: graph.json aktuell erzeugen lassen (Kanten für VERWAIST). Struktur: nur Dateien lesen.
if (!struktur) execFileSync(process.execPath, [join(dirname(fileURLToPath(import.meta.url)), "brain-index.mjs"), vault], { stdio: "pipe", windowsHide: true });
const graph = struktur ? { nodes: walk(vault, { wikiDir: wikiName }).map(f => ({ id: f.rel })), edges: [] } : JSON.parse(readFileSync(join(vault, "graph.json"), "utf8"));
const ids = graph.nodes.map(n => n.id.split(sep).join("/")), idSet = new Set(ids);
// Seiten relativ zu 09_wiki, auch in Unterordnern
const pages = ids.filter(id => istWikiSeite(id, wikiName)).map(id => id.slice(wikiName.length + 1));
// eingehende Kanten zählen nur von echten Seiten/Rohquellen (_log/_schema zählen nicht als Verlinkung)
const linked = new Set(graph.edges.filter(e => !e.source.split(sep).pop().startsWith("_"))
  .map(e => e.target.split(sep).join("/")).filter(t => t.startsWith(wikiName + "/")).map(t => t.slice(wikiName.length + 1)));
// B1: ersetzte Seiten (alt → Nachfolger, beide relativ zum Wiki) für Ketten und noch bestehende Links nach der Schleife
const ersetzt = new Map();
for (const p of pages) {
  const full = join(wikiDir, p);
  const raw = entferneBom(readFileSync(full, "utf8")).replace(/\r\n/g, "\n"); // BOM weg, CRLF (Windows-Checkout) wie LF behandeln
  const zeilen = raw.split("\n").length;
  if (zeilen > 150) findings.push(`LANG: ${p} hat ${zeilen} Zeilen (> 150) — Details in die Rohquelle`);
  const st = statSync(full);
  const fmm = raw.match(/^---\n([\s\S]*?)\n---/);
  const fm = fmm ? fmm[1] : "";
  const arr = (key) => { const m = fm.match(new RegExp("^" + key + ":\\s*\\[([^\\]]*)\\]", "m")); return m ? m[1].split(",").map(s => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean) : []; };
  // offene Konflikte
  const k = (raw.match(/\[!KONFLIKT\] offen/g) || []).length;
  if (k) findings.push(`KONFLIKT offen (${k}×): ${p} — Entscheidung des Users nötig`);
  // Frontmatter-Pflicht
  if (!/^description:/m.test(fm)) findings.push(`FRONTMATTER unvollständig: ${p} — description fehlt`);
  // Beweisbindung (Video 4): gespeicherter Quellen-Hash vs. aktueller Quellinhalt
  const quellen = arr("quellen"), shas = arr("quellen_sha");
  quellen.forEach((q, i) => {
    const qf = join(vault, q);
    if (!existsSync(qf)) { findings.push(`TOTE QUELLE: ${p} → ${q}`); return; }
    if (!shas[i]) { findings.push(`OHNE HASH: ${p} — ${q} ohne quellen_sha (beim nächsten Ingest ergänzen)`); return; }
    const cur = createHash("sha256").update(readFileSync(qf)).digest("hex").slice(0, 16);
    if (cur !== shas[i]) findings.push(`PRÜFBEDÜRFTIG: ${p} — Quelle ${q} geändert seit Einarbeitung (Re-Ingest anbieten)`);
  });
  // alt — nur Zusatzhinweis (mtime beweist keine Aktualität, Video 4)
  if ((Date.now() - st.mtimeMs) / 86400000 > 60) findings.push(`HINWEIS alt (>60 Tage): ${p}`);
  // verwaist (keine eingehende Kante; _index zählt nicht — generiert)
  if (!struktur && !linked.has(p) && p !== "ueberblick.md") findings.push(`VERWAIST: ${p} — keine eingehenden Links`);
  if (cfg.wiki?.ordnerPflicht && !p.includes("/") && p !== "ueberblick.md") findings.push(`ORDNER: ${p} liegt direkt in ${wikiName} — in Bereich/Thema-Ordner einsortieren (_schema.md)`);
  // Gültigkeit (gueltigkeit.mjs): `pruefen_bis` (absolute Frist) und `verfall: <tage>` (Momentaufnahme — maßgeblich
  // ist der letzte Commit der Seite, nicht die mtime). Seiten ohne diese Felder bleiben still (rückwärtskompatibel).
  if (!struktur && /^(pruefen_bis|verfall):/m.test(fm)) {
    let ct = 0;
    if (/^verfall:/m.test(fm)) try { ct = Number(execFileSync(GIT, ["-C", vault, "log", "-1", "--follow", "--format=%ct", "--", join(wikiName, p)], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], windowsHide: true }).trim()) * 1000; } catch {}
    const g = gueltigkeit(fm, { letzterCommitMs: ct || null });
    if (g.status === "abgelaufen") {
      const grund = g.grund === "verfall" ? `verfall ${(fm.match(/^verfall:\s*(\d+)/m) || [])[1]} Tage` : `pruefen_bis ${g.pruefenBis}`;
      findings.push(`ABGELAUFEN: ${p} — seit ${g.tageUeber} ${g.tageUeber === 1 ? "Tag" : "Tagen"} (${grund}) — prüfen/aktualisieren`);
    }
  }
  // Team-Drift — nur wenn module.teamWissen aktiv; Frontmatter team_id + saved_at
  if (teamWissen && /team_id:/.test(fm)) {
    const saved = fm.match(/saved_at:\s*(\S+)/);
    if (saved && new Date(saved[1]).getTime() < st.mtimeMs - 60000)
      findings.push(`TEAM-DRIFT: ${p} — lokal neuer als Team-Kopie (${saved[1]}) → Seite erneut in die Team-Wissensbasis speichern`);
  }
  // tote Wikilinks (nur Wiki-Seiten; Codeblöcke/Inline-Code ausgenommen)
  for (const l of wikilinks(raw.replace(/^---\n[\s\S]*?\n---\n?/, ""))) if (!resolveLink(ids, l, wikiName, idSet)) findings.push(`TOTER LINK: ${p} → [[${l}]]`);
  // fragen: JSON-Liste aus Texten, höchstens 6, je ≤ 160 Zeichen (fragen.mjs) — sonst fehlt die Seite still in der Suchkarte
  for (const f of pruefeFragen(fragenRoh(fm)).fehler) findings.push(`FRAGEN: ${p} — ${f}`);
  // auch-Bezüge müssen auf existierende Ordner zeigen
  for (const a of arr("auch")) if (!/^[\p{L}\d_-]+(\/[\p{L}\d_-]+)*$/u.test(a) || !existsSync(join(wikiDir, ...a.split("/")))) findings.push(`AUCH: ${p} → ${a} existiert nicht bzw. ist kein Ordner im Wiki`);
  // B1 Zeit/Ersetzen/Kritisch/Zweifel (seitenfelder.mjs): Formatfehler blockieren, Zweifel wird PRÜFBEDÜRFTIG
  for (const b of pruefeSeitenFelder(raw)) findings.push(`${b.klasse}: ${p} — ${b.meldung}`);
  const sf = leseSeitenFelder(raw);
  if (sf.ersetztDurch) {
    const ziel = resolveLink(ids, sf.ersetztDurch, wikiName, idSet);
    const zielRel = ziel && istWikiSeite(ziel, wikiName) ? ziel.slice(wikiName.length + 1) : null;
    if (!zielRel) findings.push(`ERSETZT: ${p} — Nachfolger [[${sf.ersetztDurch}]] existiert nicht`);
    else if (zielRel === p) findings.push(`ERSETZT: ${p} — Nachfolger ist die Seite selbst`);
    else ersetzt.set(p, zielRel);
  }
  if (sf.zweifel) findings.push(`PRÜFBEDÜRFTIG (ZWEIFEL): ${p} — ${sf.zweifel.replace(/\s+/g, " ").slice(0, 120)}`);
}
// Ersetzte Seiten: Kette (Nachfolger selbst ersetzt) und — nur im Normalmodus, braucht die Kanten — eingehende Links
// von anderen Wiki-Seiten als dem Nachfolger. Nicht blockierend: der Tageslauf ersetzt zuerst und stellt Links danach um.
for (const [alt, neu] of ersetzt) {
  if (ersetzt.has(neu)) findings.push(`ERSETZT-HINWEIS: ${alt} — Nachfolger ${neu} ist selbst ersetzt (Kette) — direkt auf den letzten Nachfolger zeigen`);
  if (struktur) continue;
  const quellen = new Set();
  for (const e of graph.edges) {
    const von = e.source.split(sep).join("/"), nach = e.target.split(sep).join("/");
    if (nach !== `${wikiName}/${alt}` || !istWikiSeite(von, wikiName)) continue;
    const q = von.slice(wikiName.length + 1);
    if (q !== neu && q !== alt) quellen.add(q);
  }
  for (const q of [...quellen].sort()) findings.push(`ERSETZT-HINWEIS: ${alt} — wird noch verlinkt von ${q} (Link auf ${neu} umstellen)`);
}
for (const g of doppelteNamen(ids, (id) => istWikiSeite(id, wikiName))) findings.push(`DOPPELTER NAME: ${g.join(" · ")} — [[Link]] löst mehrdeutig auf, einen umbenennen`);
// Blockierende Klassen (pre-commit). Struktur-Modus endet hier.
const BLOCKIEREND = /^(FRONTMATTER|TOTER LINK|DOPPELTER NAME|AUCH|FRAGEN|ORDNER|TOTE QUELLE|CONFIG|KRITISCH|GILT_SEIT|ERSETZT(?=:))\b/;
if (struktur) {
  const b = findings.filter(f => BLOCKIEREND.test(f));
  b.forEach(f => console.log("- " + f));
  process.exit(b.length ? 2 : 0);
}
// Ich-Karte: zu lang verdünnt das Wesentliche, sobald sie bei jedem Prompt mitgegeben wird (Warnung, kein Blocker)
const ichKartePfad = join(wikiDir, "ich.md");
if (existsSync(ichKartePfad)) {
  const n = entferneBom(readFileSync(ichKartePfad, "utf8")).replace(/\r\n/g, "\n").length;
  if (n > 1500) findings.push(`ICH-KARTE zu lang (${n} Zeichen, höchstens 1500)`);
}

// Pflege-Signale (informativ): langes Protokoll, fälliger Review, offene Rückmeldungen
const logDatei = join(wikiDir, "_log.md");
if (existsSync(logDatei)) { const n = readFileSync(logDatei, "utf8").split("\n").length;
  if (n > 500) findings.push(`LOG-LANG: _log.md hat ${n} Zeilen — ältere Einträge nach ${archivName}/ingest-log-<jahr>.md verschieben`); }
const reviewMarker = join(vault, ".logs", "letzter-review");
const reviewMs = existsSync(reviewMarker) ? statSync(reviewMarker).mtimeMs : 0;
if (!reviewMs || Date.now() - reviewMs > 30 * 86400000)
  findings.push(`REVIEW fällig: ${reviewMs ? `letzter vor ${Math.floor((Date.now() - reviewMs) / 86400000)} Tagen` : "noch nie"} — /brain-review`);
const fbDatei = join(vault, ".logs", "feedback.log");
if (existsSync(fbDatei)) { const offen = readFileSync(fbDatei, "utf8").split("\n").filter(z => z && new Date(z.slice(0, 19)).getTime() > reviewMs).length;
  if (offen) findings.push(`FEEDBACK: ${offen} offene Rückmeldung(en) seit dem letzten Review — /brain-review`); }
const inboxDir = join(vault, inboxName);
const inbox = existsSync(inboxDir) ? readdirSync(inboxDir).filter(f => !f.startsWith(".") && !["_vorschlaege", "_import", "_entscheidungen", "_lektionen", "_pflege"].includes(f)) : [];
if (inbox.length) findings.push(`INBOX: ${inbox.length} Datei(en) warten auf /ingest`);

// Memory-Routing-Wächter: fette project_*.md im Claude-Memory = Fakten-Wissen am falschen Ort
// (Memory soll nur Zeiger sein — Wissen gehört ins Brain). Deterministisch, maschinenlokal.
// Alt-Bestand (vor Brain-Go-Live) = eine Summenzeile (Backlog, opportunistisch migrieren);
// nur NEUE Verstöße einzeln melden — sonst stumpft das Rauschen ab.
const BRAIN_GO_LIVE = new Date("2026-08-12").getTime();
const memRoot = join(homedir(), ".claude", "projects");
if (claudeMemory && !struktur && existsSync(memRoot)) {
  let altbestand = 0;
  for (const proj of readdirSync(memRoot)) {
    const memDir = join(memRoot, proj, "memory");
    if (!existsSync(memDir)) continue;
    for (const f of readdirSync(memDir).filter(x => x.startsWith("project_") && x.endsWith(".md"))) {
      const full = join(memDir, f);
      const lines = readFileSync(full, "utf8").split("\n").length;
      if (lines <= 20) continue;
      if (statSync(full).mtimeMs < BRAIN_GO_LIVE) altbestand++;
      else findings.push(`MEMORY-ROUTING: ${f} (${lines} Zeilen, neu) — Fakten-Wissen gehört ins Brain, Memory auf Zeiger eindampfen`);
    }
  }
  if (altbestand) findings.push(`ALT-BACKLOG: ${altbestand} fette Alt-Memories (vor Brain-Start) — bei Wieder-Berührung verifizieren und ins Brain ingesten, nicht blind migrieren`);
}

// Frische-Vertrag (Harness-Video): nicht „läuft es?", sondern „bis zu welchem Stand ist was verarbeitet?"
const logsDir = join(vault, ".logs");
const newestMd = (dir) => { let t = 0; for (const n of readdirSync(dir)) { if (n.startsWith(".")) continue; const p = join(dir, n), s = statSync(p);
  t = Math.max(t, s.isDirectory() ? newestMd(p) : (n.endsWith(".md") ? s.mtimeMs : 0)); } return t; };
const stamp = join(logsDir, "search-refreshed");
if (existsSync(stamp) && newestMd(vault) > statSync(stamp).mtimeMs + 10 * 60000)
  findings.push(`SUCHINDEX: Notizen neuer als letzter erfolgreicher Such-Refresh — node "${join(vault, ".tools", "brain.mjs").split("\\").join("/")}" refresh laufen lassen`);
let lastIngest = 0;
try { lastIngest = Number(execFileSync(GIT, ["-C", vault, "log", "-1", "--format=%ct", "--grep=^ingest:"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], windowsHide: true }).trim()) * 1000 || 0; } catch {}
if (lastIngest && existsSync(memRoot)) {
  let neu = 0;
  for (const proj of readdirSync(memRoot)) { const d = join(memRoot, proj, "memory"); if (!existsSync(d)) continue;
    for (const f of readdirSync(d).filter(x => x.startsWith("project_") && x.endsWith(".md"))) if (statSync(join(d, f)).mtimeMs > lastIngest) neu++; }
  const tage = Math.floor((Date.now() - lastIngest) / 86400000);
  if (tage > 14 && neu) findings.push(`FRISCHE: letzte Einarbeitung vor ${tage} Tagen, seitdem ${neu} geänderte project_*-Memories — Wissen liegt evtl. am falschen Ort (/ingest anbieten)`);
}
const evalLog = join(logsDir, "hint-eval.log");
if (existsSync(evalLog)) {
  const zielDatei = process.env.BRAIN_EVAL_ZIEL || join(dirname(fileURLToPath(import.meta.url)), "tests", "hint-eval.json");
  let ziel = {}; try { ziel = JSON.parse(readFileSync(zielDatei, "utf8")).ziel || {}; } catch {}
  const last = readFileSync(evalLog, "utf8").trim().split("\n").reverse().find(z => z.startsWith("hint-eval ")) || "";
  const zahl = (k) => { const m = last.match(new RegExp(`${k}=(\\d+)/(\\d+)`)); return m ? +m[1] : null; };
  const unter = [];
  if (zahl("still") !== null && ziel.still && zahl("still") < ziel.still) unter.push(`still<${ziel.still}`);
  if (zahl("kontrolle") !== null && ziel.kontrolle_still && zahl("kontrolle") < ziel.kontrolle_still) unter.push(`kontrolle<${ziel.kontrolle_still}`);
  // holdout wird bewusst NIE geprüft (reiner Bericht, Spec Etappe 1.2)
  if (unter.length) findings.push(`HINWEIS-QUALITÄT: ${last} — unter Ziel (${unter.join(", ")}): Ursache per tests/hint-eval.mjs --scores (Schwelle nicht am Holdout kalibrieren)`);
}

if (!findings.length) { console.log("Lint: keine Befunde."); process.exit(0); }
findings.forEach(f => console.log("- " + f));
process.exit(2);
