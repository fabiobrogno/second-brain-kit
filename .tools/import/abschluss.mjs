#!/usr/bin/env node
// .tools/import/abschluss.mjs — Import-Paket als eingearbeitet abschließen (Issue #6).
// Ein normaler Ingest sortiert seine Quelle in einen Cluster ein (Schritt 5). Beim Import tut das dieses Werkzeug:
// es verschiebt die Dateien EINES Pakets von <inbox>/_import/<quelle>/ nach <cluster>/<quelle>/ (Unterstruktur
// bleibt, Inhalt bytegleich → quellen_sha ändert sich nicht), vermerkt den Fortschritt je Paket in _bericht.json
// ("eingearbeitet") und — sobald alle Pakete erledigt sind — verschiebt Bericht und Metadaten nach
// <archiv>/import-berichte/<quelle>/. analyse/pflege zählen nur Pakete ohne diesen Vermerk (offenePakete()).
// Aufruf VOR dem Schreiben der Wiki-Seiten, damit quellen: gleich auf den endgültigen Ort zeigt.
//
// CLI: node .tools/import/abschluss.mjs <vault> <quelle> <paket|--alle> --ziel <cluster>
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, readdirSync, rmdirSync, realpathSync } from "node:fs";
import { join, resolve, relative, dirname, isAbsolute } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { ladeConfig, ordner, entferneBom } from "../pfade.mjs";
import { gitBefehl } from "../werkzeug.mjs";

export class AbschlussFehler extends Error {}

const META = ["_import.json", "_bericht.json", "_bericht.md"];
// Ein Pfadteil, der unter Windows, macOS und Linux gültig ist (import.mjs schreibt _import.json mit diesen Namen;
// Paketnamen im Bericht stammen dagegen aus dem Original-Pfad — beim Abgleich beides gelten lassen).
export function sichererTeil(t) {
  let s = t.replace(/[<>:"|?*\u0000-\u001f\\]/g, "_").replace(/[. ]+$/, (m) => "_".repeat(m.length));
  if (/^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(s)) s = "_" + s;
  return s || "_";
}
export const sichererRel = (rel) => rel.split("/").map(sichererTeil).join("/");
export const paketVon = (rel) => (rel.includes("/") ? rel.split("/")[0] : "(oberste Ebene)");
const zahl = (x) => (Number.isFinite(Number(x)) ? Number(x) : 0);
const isoTag = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// Noch nicht eingearbeitete Pakete eines Berichts. Altberichte (kein `eingearbeitet`) → alle offen; ohne Paketliste
// gilt der ganze Import als ein offenes Paket.
export function offenePakete(bericht) {
  const b = bericht && typeof bericht === "object" ? bericht : {};
  const fertig = b.eingearbeitet && typeof b.eingearbeitet === "object" ? b.eingearbeitet : {};
  if (Array.isArray(b.pakete) && b.pakete.length) {
    return b.pakete.filter(p => p && typeof p.name === "string" && !Object.hasOwn(fertig, p.name))
      .map(p => ({ name: p.name, notizen: zahl(p.notizen) }));
  }
  return [{ name: "(gesamter Import)", notizen: zahl(b.notizen) }];
}

const lies = (pfad) => JSON.parse(entferneBom(readFileSync(pfad, "utf8")));
const innerhalb = (eltern, kind) => { const r = relative(eltern, kind); return r !== "" && !r.startsWith("..") && !isAbsolute(r); };

function verschiebe(vault, git, von, nach) {
  mkdirSync(dirname(nach), { recursive: true });
  if (existsSync(join(vault, ".git"))) {
    try {
      execFileSync(git, ["-C", vault, "ls-files", "--error-unmatch", "--", relative(vault, von).split("\\").join("/")], { stdio: "ignore", windowsHide: true });
      execFileSync(git, ["-C", vault, "mv", "--", relative(vault, von).split("\\").join("/"), relative(vault, nach).split("\\").join("/")], { stdio: "ignore", windowsHide: true });
      return;
    } catch { /* nicht versioniert oder git mv geht nicht → normal verschieben */ }
  }
  renameSync(von, nach);
}

// Leere Ordner von unten nach oben entfernen (Git kennt keine leeren Ordner).
function raeumeLeere(dir, stop) {
  let d = dir;
  while (innerhalb(stop, d)) {
    try { if (readdirSync(d).length) return; rmdirSync(d); } catch { return; }
    d = dirname(d);
  }
}
function raeumeBaum(dir) {
  let eintraege = [];
  try { eintraege = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of eintraege) if (e.isDirectory()) raeumeBaum(join(dir, e.name));
  try { if (!readdirSync(dir).length) rmdirSync(dir); } catch {}
}

export function schliesseAb(vault, quelle, { paket, alle = false, ziel, jetzt = new Date() } = {}) {
  vault = resolve(vault);
  const cfg = ladeConfig(vault), o = ordner(vault, cfg);
  const git = gitBefehl({ cfg });
  if (typeof quelle !== "string" || !quelle || /[\\/]/.test(quelle) || quelle === "." || quelle === "..") throw new AbschlussFehler("Welcher Import? Bitte den Namen unter " + o.inbox + "/_import/ angeben.");
  const quellDir = join(vault, o.inbox, "_import", quelle);
  const archivDir = join(vault, o.archiv, "import-berichte", quelle);
  if (!existsSync(join(quellDir, "_bericht.json"))) throw new AbschlussFehler(`Import „${quelle}“ nicht gefunden (oder schon abgeschlossen).`);
  // Nach einem Abbruch beim Abschluss liegt _import.json evtl. schon im Archiv (_bericht.json wandert zuletzt).
  const begleitPfad = [join(quellDir, "_import.json"), join(archivDir, "_import.json")].find(existsSync);
  if (!begleitPfad) throw new AbschlussFehler(`Import „${quelle}“ nicht gefunden (oder schon abgeschlossen).`);
  let bericht, begleit;
  try { bericht = lies(join(quellDir, "_bericht.json")); begleit = lies(begleitPfad); }
  catch { throw new AbschlussFehler(`Bericht von „${quelle}“ ist nicht lesbar.`); }

  const cluster = (Array.isArray(cfg.clusters) ? cfg.clusters : []).map(c => c?.id).filter(x => typeof x === "string");
  if (!ziel || !cluster.includes(ziel)) throw new AbschlussFehler(`Ziel-Cluster fehlt oder ist unbekannt (--ziel <cluster>). Möglich: ${cluster.join(", ") || "(keine in brain.config.json)"}.`);

  const dateien = (Array.isArray(begleit.dateien) ? begleit.dateien : []).map(d => d?.rel).filter(r => typeof r === "string" && r && !r.split("/").includes("..") && !isAbsolute(r) && !r.includes("\\"));
  const bekannt = Array.isArray(bericht.pakete) && bericht.pakete.length ? bericht.pakete.map(p => p?.name) : [...new Set(dateien.map(paketVon))];
  if (!alle) {
    if (!paket) throw new AbschlussFehler("Welches Paket? Name aus dem Bericht angeben oder --alle.");
    if (!bekannt.includes(paket)) throw new AbschlussFehler(`Paket „${paket}“ gibt es in „${quelle}“ nicht. Pakete: ${bekannt.join(", ")}.`);
  }
  const imPaket = (r, n) => paketVon(r) === n || paketVon(r) === sichererTeil(n);
  const fertigNeu = { ...(bericht.eingearbeitet && typeof bericht.eingearbeitet === "object" ? bericht.eingearbeitet : {}) };
  const schonFertig = !alle && Object.hasOwn(fertigNeu, paket);
  // Einzelpaket ohne eine Datei in den Metadaten: Namensabgleich kaputt — NICHT stillschweigend als erledigt vermerken.
  // (Dateien, die laut Metadaten existieren, aber schon fehlen, sind der erlaubte Altfall: Paket wurde von Hand
  // verschoben; dann wird nur vermerkt.)
  if (!alle && !schonFertig && !dateien.some(r => imPaket(r, paket))) throw new AbschlussFehler(`Zu Paket „${paket}“ gibt es in den Metadaten von „${quelle}“ keine Dateien — nichts verschoben und nichts vermerkt.`);
  const jetztOffen = schonFertig ? [] : alle ? bekannt.filter(n => !Object.hasOwn(fertigNeu, n)) : [paket];
  const nochOffen = bekannt.filter(n => !Object.hasOwn(fertigNeu, n) && !jetztOffen.includes(n));
  const abgeschlossen = nochOffen.length === 0;
  // Schon eingearbeitet und noch andere offen: nichts tun, Vermerk bleibt. Ist alles erledigt, aber der Import liegt
  // noch in der Inbox (Abbruch beim Abschluss), wird der Abschluss nachgeholt.
  if (schonFertig && !abgeschlossen) return { status: "schon", schon: fertigNeu[paket].datum, verschoben: [], offen: nochOffen, abgeschlossen: false, zuStagen: [], ziel: `${ziel}/${quelle}` };

  // Welche Dateien wandern: die der Pakete; beim Abschluss alle übrigen mit (Beilagen ohne Paket-Eintrag).
  const zuVerschieben = dateien.filter(r => abgeschlossen || jetztOffen.some(n => imPaket(r, n))).filter(r => existsSync(join(quellDir, ...r.split("/"))));
  const zielBasis = join(vault, ziel, quelle);
  for (const r of zuVerschieben) {
    const nach = join(zielBasis, ...r.split("/"));
    if (!innerhalb(zielBasis, nach)) throw new AbschlussFehler(`Unsicherer Pfad: ${r}`);
    if (existsSync(nach)) throw new AbschlussFehler(`Am Ziel ist schon vorhanden: ${ziel}/${quelle}/${r} — nichts verschoben.`);
  }
  // Archiv: Datei dort UND in der Inbox = Konflikt; nur dort = schon von einem früheren Lauf verschoben.
  if (abgeschlossen) for (const m of META) if (existsSync(join(archivDir, m)) && existsSync(join(quellDir, m)) && m !== "_bericht.json") throw new AbschlussFehler(`Im Archiv liegt schon ${m} zu „${quelle}“ (${o.archiv}/import-berichte/${quelle}/) — nichts verschoben.`);
  if (abgeschlossen && existsSync(join(archivDir, "_bericht.json"))) throw new AbschlussFehler(`Im Archiv liegt schon ein Bericht „${quelle}“ (${o.archiv}/import-berichte/${quelle}/) — nichts verschoben.`);

  const verschoben = [];
  for (const r of zuVerschieben) {
    try { verschiebe(vault, git, join(quellDir, ...r.split("/")), join(zielBasis, ...r.split("/"))); }
    catch (e) { throw new AbschlussFehler(`Verschieben von ${r} fehlgeschlagen (${e.code || "Fehler"}) — ${verschoben.length} Dateien sind schon verschoben; Aufruf wiederholen.`); }
    verschoben.push(`${ziel}/${quelle}/${r}`);
  }
  const datum = isoTag(jetzt instanceof Date ? jetzt : new Date(jetzt));
  for (const n of jetztOffen) fertigNeu[n] = { datum, ziel: `${ziel}/${quelle}`, dateien: zuVerschieben.filter(r => paketVon(r) === n).length };
  bericht.eingearbeitet = fertigNeu;
  writeFileSync(join(quellDir, "_bericht.json"), JSON.stringify(bericht, null, 2) + "\n");
  raeumeBaum(quellDir);

  const zuStagen = [`${ziel}/${quelle}`];
  if (abgeschlossen) {
    // _bericht.json zuletzt: solange es in der Inbox liegt, gilt der Import als nicht abgeschlossen (Wiederholung möglich).
    for (const m of ["_import.json", "_bericht.md", "_bericht.json"]) {
      if (!existsSync(join(quellDir, m))) continue;
      try { verschiebe(vault, git, join(quellDir, m), join(archivDir, m)); }
      catch (e) { throw new AbschlussFehler(`Verschieben von ${m} ins Archiv fehlgeschlagen (${e.code || "Fehler"}) — Aufruf wiederholen.`); }
    }
    raeumeLeere(quellDir, join(vault, o.inbox));
    zuStagen.push(`${o.archiv}/import-berichte/${quelle}`);
  } else zuStagen.push(`${o.inbox}/_import/${quelle}/_bericht.json`);
  return { status: "ok", verschoben, offen: nochOffen, abgeschlossen, zuStagen, ziel: `${ziel}/${quelle}` };
}

export function kurzBericht(r, quelle) {
  if (r.status === "schon") return `Paket war schon eingearbeitet (am ${r.schon}) — nichts geändert. Noch offen: ${r.offen.join(", ")}.`;
  const z = [`${r.verschoben.length} Dateien nach ${r.ziel}/ verschoben (Unterstruktur unverändert).`];
  if (r.abgeschlossen) z.push(`Import „${quelle}“ ist vollständig eingearbeitet — Bericht und Metadaten liegen jetzt unter ${r.zuStagen[r.zuStagen.length - 1]}/.`);
  else z.push(`Noch offen: ${r.offen.join(", ")}.`);
  z.push(`Fürs Commit stagen (zusätzlich zu den Wiki-Seiten): ${r.zuStagen.join(", ")}`);
  return z.join("\n");
}

export function cli(argv = process.argv.slice(2)) {
  const pos = [], opt = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--alle") opt.alle = true;
    else if (a === "--ziel") opt.ziel = argv[++i];
    else if (a.startsWith("--ziel=")) opt.ziel = a.slice(7);
    else pos.push(a);
  }
  if (pos.length < 2 || (!opt.alle && pos.length < 3)) {
    console.log("Aufruf: brain import fertig <quelle> <paket|--alle> --ziel <cluster>");
    return 64;
  }
  try {
    const r = schliesseAb(pos[0], pos[1], { paket: pos[2], alle: opt.alle, ziel: opt.ziel });
    console.log(kurzBericht(r, pos[1]));
    return 0;
  } catch (e) {
    if (e instanceof AbschlussFehler) { console.log(e.message); return 1; }
    console.log("Abschluss abgebrochen: " + String(e?.message || e).split("\n")[0]);
    return 1;
  }
}

const selbst = fileURLToPath(import.meta.url);
let aufruf = "";
try { aufruf = realpathSync(process.argv[1] || ""); } catch {}
if (aufruf && aufruf === realpathSync(selbst)) process.exitCode = cli();
