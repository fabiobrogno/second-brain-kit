// .tools/tests/test-ansicht-daten.mjs — Daten der 3D-Ansicht: Bereiche aus der Config, Ausgabe nur nach .logs/ansicht/
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, utimesSync, renameSync, rmSync, symlinkSync } from "node:fs";
import { kopiereBaum } from "./kopiere-baum.mjs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { erzeugeAnsichtsDaten, baueAnsichtsDaten, datenSchluessel, bedeutungen, mcpIcon } from "../ansicht/daten.mjs";
import { fingerabdruck } from "../konflikte.mjs";

// Harte Sicherheitsregel (global.md): JEDER Test, der Home-Konfigurationen liest (hier: das MCP-Inventar
// in daten.mjs), setzt HOME/USERPROFILE auf ein leeres Temp-Verzeichnis — die echten ~/.claude.json,
// ~/.cursor/mcp.json usw. werden in diesem Prozess NIE gelesen. Seit daten.mjs MCP-Server einbindet, gilt
// das für JEDEN Aufruf von erzeugeAnsichtsDaten/baueAnsichtsDaten in dieser Datei (node --test startet pro
// Testdatei einen eigenen Prozess — diese Überschreibung wirkt nur hier, nicht auf andere Testdateien).
// Klammer-Zugriff statt Punktnotation auf process.env — test-plattform.mjs verbietet repoweit den lesenden
// Zugriff per Punktnotation in Laufzeitcode (soll os.homedir() nutzen); hier wird HOME für den Testprozess
// bewusst umgelegt, damit os.homedir() selbst das leere Temp-Verzeichnis liefert.
const LEERES_HOME = mkdtempSync(join(tmpdir(), "ansicht-leeres-home "));
process.env["HOME"] = LEERES_HOME;
process.env["USERPROFILE"] = LEERES_HOME;

const T = fileURLToPath(new URL("..", import.meta.url));
const lies = (pfad) => {
  const s = readFileSync(pfad, "utf8");
  const start = s.indexOf("window.BRAIN_DATA = ");
  return { s, data: JSON.parse(s.slice(start + "window.BRAIN_DATA = ".length).trim().replace(/;$/, "")) };
};
const tempVault = (name = "ansicht ") => mkdtempSync(join(tmpdir(), name));
// Auszug aus .tools/kit/vorlage/brain.config.json — inline, weil ein installierter Vault die Kit-Vorlage nicht
// mitbringt (die Tests laufen dort im pre-commit genauso). Im Quell-Vault wird die Kopie gegen das Original geprüft.
const KIT_AUSZUG = { ordner: { inbox: "inbox", wiki: "wiki", archiv: "archiv" }, clusters: [{ id: "notizen", name: "Notizen", farbe: "blau" }] };
const kitConfig = () => JSON.stringify(KIT_AUSZUG);
const VORLAGE = join(T, "kit", "vorlage", "brain.config.json");

test("Inline-Auszug entspricht der Kit-Vorlage (nur wo die Vorlage existiert)", { skip: !existsSync(VORLAGE) && "keine Kit-Vorlage (installierter Vault)" }, () => {
  const echt = JSON.parse(readFileSync(VORLAGE, "utf8"));
  assert.deepEqual({ ordner: echt.ordner, clusters: echt.clusters }, KIT_AUSZUG);
});

test("fixture: eigene Cluster — jede Seite hat einen Bereich aus areas, keine generierten Dateien, Ausgabe unter .logs/ansicht", () => {
  const v = join(tempVault(), "vault");
  kopiereBaum(join(T, "tests", "fixture"), v);
  // generierte Datei und Vorlage dürfen nicht als Knoten erscheinen
  writeFileSync(join(v, "09_wiki", "_index.md"), "# generiert\n");
  mkdirSync(join(v, "01_vorlagen"), { recursive: true });
  writeFileSync(join(v, "01_vorlagen", "notiz.md"), "# Vorlage\n");
  const r = erzeugeAnsichtsDaten(v);
  assert.equal(r.pfad, join(v, ".logs", "ansicht", "data.js"));
  const { s, data } = lies(r.pfad);
  assert.match(s.split("\n").find(z => !z.startsWith("//")), /^window\.BRAIN_DATA = /);
  const areaIds = new Set(data.areas.map(a => a.id));
  assert.ok(areaIds.has("10_projekte") && areaIds.has("inbox") && areaIds.has("archiv"));
  assert.ok(data.nodes.length > 0);
  assert.equal(r.seiten, data.nodes.length);
  assert.equal(r.verbindungen, data.edges.length);
  for (const n of data.nodes) assert.ok(areaIds.has(n.area), `${n.id}: Bereich ${n.area} fehlt in areas`);
  const ids = data.nodes.map(n => n.id);
  assert.ok(!ids.some(id => /(^|\/)_[^/]*\.md$/.test(id) || id.startsWith("01_vorlagen/") || id === "INDEX.md"), ids.join(", "));
  const byId = Object.fromEntries(data.nodes.map(n => [n.id, n]));
  assert.equal(byId["10_projekte/alpha/notiz-a.md"].area, "10_projekte");
  assert.equal(byId["00_inbox/neu.md"].area, "inbox");
  assert.equal(byId["90_archiv/alt.md"].area, "archiv");
  assert.equal(byId["09_wiki/firma/amazon/thema_beta.md"].area, "zentrum"); // kein Cluster „firma“
  assert.equal(data.inbox, 1);
  for (const n of data.nodes) for (const k of ["id", "name", "title", "area", "group", "wiki", "type", "typeLabel", "desc", "size", "rev", "quellen", "usedIn", "body", "added", "changed", "status", "statusNote"]) assert.ok(k in n, `${n.id}: Feld ${k} fehlt`);
  assert.ok(!existsSync(join(T, "ansicht", "data.js")), "data.js darf nie ins getrackte .tools/ansicht/");
});

test("Kit-Vorlage-Config: 2 Notizen + 1 Wiki-Seite → 3 Knoten, Bereich notizen in Region frontal, CRLF tolerant", () => {
  const v = tempVault();
  writeFileSync(join(v, "brain.config.json"), kitConfig());
  for (const d of ["inbox", "wiki", "archiv", "notizen", "vorlagen"]) mkdirSync(join(v, d));
  writeFileSync(join(v, "vorlagen", "notiz.md"), "# Vorlage\n");
  writeFileSync(join(v, "wiki", "_schema.md"), "# Schema\n");
  writeFileSync(join(v, "wiki", "_log.md"), "# Log\n");
  writeFileSync(join(v, "notizen", "eins.md"), "---\r\ndescription: Erste Notiz\r\n---\r\n# Eins\r\n\r\nSiehe [[zwei]].\r\n");
  writeFileSync(join(v, "notizen", "zwei.md"), "# Zwei\n\nText.\n");
  writeFileSync(join(v, "wiki", "thema_x.md"), "---\nname: X\ntyp: thema\nquellen: [\"notizen/zwei.md\"]\n---\n# Thema X\n\nÜber [[eins]].\n");
  const r = erzeugeAnsichtsDaten(v);
  const { data } = lies(r.pfad);
  assert.equal(data.nodes.length, 3, data.nodes.map(n => n.id).join(", "));
  const notizen = data.areas.find(a => a.id === "notizen");
  assert.equal(notizen.region, "frontal");
  assert.equal(notizen.name, "Notizen");
  assert.equal(notizen.farbe, "blau");
  const byId = Object.fromEntries(data.nodes.map(n => [n.id, n]));
  assert.equal(byId["notizen/eins.md"].title, "Eins");
  assert.equal(byId["notizen/eins.md"].desc, "Erste Notiz");
  assert.equal(byId["notizen/eins.md"].area, "notizen");
  assert.equal(byId["wiki/thema_x.md"].area, "zentrum");
  assert.deepEqual(byId["notizen/zwei.md"].usedIn, ["wiki/thema_x.md"]);
  const kanten = data.edges.map(e => `${e.s}>${e.t}:${e.kind}`).sort();
  assert.deepEqual(kanten, ["notizen/eins.md>notizen/zwei.md:link", "wiki/thema_x.md>notizen/eins.md:link", "wiki/thema_x.md>notizen/zwei.md:quelle"]);
});

test("Wiki-Unterordner wird dem Cluster mit passendem Namen (ohne Ziffernpräfix/Umlaute) zugeordnet", () => {
  const v = tempVault();
  writeFileSync(join(v, "brain.config.json"), JSON.stringify({ clusters: [{ id: "10_projekte", name: "Projekte" }, { id: "40_persoenlich", name: "Persönlich" }] }));
  mkdirSync(join(v, "09_wiki", "projekte"), { recursive: true }); mkdirSync(join(v, "09_wiki", "Persönlich"), { recursive: true });
  writeFileSync(join(v, "09_wiki", "projekte", "a.md"), "# A\n");
  writeFileSync(join(v, "09_wiki", "Persönlich", "b.md"), "# B\n");
  const { data } = lies(erzeugeAnsichtsDaten(v).pfad);
  const byId = Object.fromEntries(data.nodes.map(n => [n.id, n]));
  assert.equal(byId["09_wiki/projekte/a.md"].area, "10_projekte");
  assert.equal(byId["09_wiki/Persönlich/b.md"].area, "40_persoenlich");
  assert.deepEqual(data.areas.map(a => a.region), ["frontal", "temporal", "tief", "kleinhirn", "wolke"]);
});

test("cfg.ansicht.regionen überschreibt die Region", () => {
  const v = tempVault();
  const cfg = JSON.parse(kitConfig()); cfg.ansicht = { regionen: { notizen: "okzipital" } };
  writeFileSync(join(v, "brain.config.json"), JSON.stringify(cfg));
  const { data } = lies(erzeugeAnsichtsDaten(v).pfad);
  assert.equal(data.areas.find(a => a.id === "notizen").region, "okzipital");
});

test("leerer Vault → nodes: [], kein Fehler", () => {
  const v = tempVault();
  const r = erzeugeAnsichtsDaten(v);
  const { data } = lies(r.pfad);
  assert.deepEqual(data.nodes, []);
  assert.deepEqual(data.edges, []);
  assert.equal(r.seiten, 0);
  assert.ok(data.areas.some(a => a.id === "inbox"));
});

test("7 Cluster ohne Farbe → kein doppeltes Paar (farbe, region); ungültige farbe/Region fallen auf Standard zurück", () => {
  const v = tempVault();
  const clusters = Array.from({ length: 7 }, (_, i) => ({ id: `${i}0_c${i}`, name: `C${i}` }));
  clusters[1].farbe = "pink";
  writeFileSync(join(v, "brain.config.json"), JSON.stringify({ clusters, ansicht: { regionen: { "00_c0": "nase" } } }));
  const r = erzeugeAnsichtsDaten(v);
  const { data } = lies(r.pfad);
  const c = data.areas.filter(a => /_c\d$/.test(a.id));
  assert.equal(c.length, 7);
  const paare = c.map(a => `${a.farbe}/${a.region}`);
  assert.equal(new Set(paare).size, 7, paare.join(", "));
  assert.equal(c[0].region, "frontal");                 // ungültiger Override → Standard
  assert.ok(["blau", "orange", "gruen", "gelb", "rot", "lila", "grau"].includes(c[1].farbe));
  assert.deepEqual(r.warnungen, []);
});

test("fehlender Vault → verständlicher Fehler, kein Ordner angelegt", () => {
  const v = join(tempVault(), "brian");
  assert.throws(() => erzeugeAnsichtsDaten(v), /Brain-Ordner nicht gefunden/);
  assert.equal(existsSync(v), false);
});

test("kaputte Config, doppelte und reservierte Cluster → Warnungen, Bereiche dedupliziert", () => {
  const v = tempVault();
  writeFileSync(join(v, "brain.config.json"), "{ kaputt,");
  assert.match(erzeugeAnsichtsDaten(v).warnungen.join("\n"), /brain\.config\.json ist kaputt/);
  writeFileSync(join(v, "brain.config.json"), JSON.stringify({ clusters: [{ id: "a" }, { id: "a" }, { id: "inbox" }] }));
  const r = erzeugeAnsichtsDaten(v);
  assert.equal(r.warnungen.length, 2, r.warnungen.join("\n"));
  const { data } = lies(r.pfad);
  assert.deepEqual(data.areas.map(a => a.id), ["a", "zentrum", "archiv", "inbox"]);
});

test("UTF-8-BOM vor dem Frontmatter wird ignoriert", () => {
  const v = tempVault();
  writeFileSync(join(v, "brain.config.json"), kitConfig());
  mkdirSync(join(v, "notizen"));
  writeFileSync(join(v, "notizen", "bom.md"), "\uFEFF---\r\ndescription: BOM-Beschreibung\r\n---\r\n# Bom\r\n");
  const { data } = lies(erzeugeAnsichtsDaten(v).pfad);
  assert.equal(data.nodes[0].desc, "BOM-Beschreibung");
  assert.equal(data.nodes[0].title, "Bom");
});

let hatGit = true; try { execFileSync("git", ["--version"], { stdio: "ignore", windowsHide: true }); } catch { hatGit = false; }
test("Vault als Unterordner eines git-Repos → Zeitleiste trotzdem gefüllt", { skip: !hatGit && "kein git" }, () => {
  const repo = tempVault("ansicht-repo "), v = join(repo, "mein vault");
  mkdirSync(join(v, "notizen"), { recursive: true });
  writeFileSync(join(v, "brain.config.json"), kitConfig());
  writeFileSync(join(v, "notizen", "über.md"), "# Über\n");
  // GIT_*-Variablen entfernen: im pre-commit setzt git GIT_DIR/GIT_INDEX_FILE — ohne das Ausfiltern würden
  // init/add/commit unten das ECHTE Repo treffen statt des Temp-Repos.
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_")));
  const g = (...a) => execFileSync("git", ["-C", repo, ...a], { stdio: "ignore", windowsHide: true, env });
  g("init", "-q"); g("add", "-A");
  g("-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-q", "--no-gpg-sign", "-m", "x");
  const { data } = lies(erzeugeAnsichtsDaten(v).pfad);
  assert.match(String(data.nodes[0].added), /^\d{4}-\d{2}-\d{2}$/);
});

test("baueAnsichtsDaten(vault) liefert dasselbe Datenobjekt wie data.js, ohne zu schreiben", () => {
  const v = tempVault();
  writeFileSync(join(v, "brain.config.json"), kitConfig());
  mkdirSync(join(v, "notizen"));
  writeFileSync(join(v, "notizen", "a.md"), "# A\n");
  const d = baueAnsichtsDaten(v);
  assert.equal(existsSync(join(v, ".logs", "ansicht", "data.js")), false, "baueAnsichtsDaten darf nie schreiben");
  assert.equal(d.nodes.length, 1);
  assert.equal(d.nodes[0].id, "notizen/a.md");
  const { data } = lies(erzeugeAnsichtsDaten(v).pfad);
  assert.deepEqual(data.nodes.map((n) => n.id), d.nodes.map((n) => n.id));
});

test("ohne MCP-Server: kein Bereich 'werkzeuge', keine Knoten vom Typ 'mcp'", () => {
  const v = tempVault();
  writeFileSync(join(v, "brain.config.json"), kitConfig());
  mkdirSync(join(v, "notizen"));
  writeFileSync(join(v, "notizen", "a.md"), "# A\n");
  const d = baueAnsichtsDaten(v);
  assert.ok(!d.areas.some((a) => a.id === "werkzeuge"));
  assert.ok(!d.nodes.some((n) => n.type === "mcp"));
  assert.deepEqual(d.mcp, []);
});

test("MCP-Server aus <vault>/.mcp.json: Bereich 'werkzeuge' (Region hirnstamm, Farbe tuerkis), Knoten mcp:demo-server, Kante über Frontmatter mcp: [..]", () => {
  const v = tempVault();
  writeFileSync(join(v, "brain.config.json"), kitConfig());
  writeFileSync(join(v, ".mcp.json"), JSON.stringify({ mcpServers: { "demo-server": { command: "node", env: { X: "KOEDER-geheim-123" } } } }));
  mkdirSync(join(v, "wiki"), { recursive: true });
  writeFileSync(join(v, "wiki", "seite-x.md"), "---\nmcp: [demo-server]\n---\n# Seite X\n");
  const d = baueAnsichtsDaten(v);
  const werkzeuge = d.areas.find((a) => a.id === "werkzeuge");
  assert.ok(werkzeuge, "Bereich werkzeuge fehlt");
  assert.equal(werkzeuge.region, "hirnstamm");
  assert.equal(werkzeuge.farbe, "tuerkis");
  assert.deepEqual(d.mcp.map((s) => s.name), ["demo-server"]);
  assert.deepEqual(d.mcp[0].quellen, ["Vault"]);
  const mcpNode = d.nodes.find((n) => n.id === "mcp:demo-server");
  assert.ok(mcpNode, "Knoten mcp:demo-server fehlt");
  assert.equal(mcpNode.area, "werkzeuge");
  assert.equal(mcpNode.type, "mcp");
  const kante = d.edges.find((e) => (e.s === "wiki/seite-x.md" && e.t === "mcp:demo-server") || (e.t === "wiki/seite-x.md" && e.s === "mcp:demo-server"));
  assert.ok(kante, "Kante Seite ↔ mcp:demo-server fehlt");
  assert.equal(kante.kind, "mcp");
  assert.ok(!JSON.stringify(d).includes("KOEDER"), "kein Köderwert in den Ansichtsdaten");
});

test("Namensgleichheit (normalisierter Servername Teil des normalisierten Seitennamens, ab 4 Zeichen) erzeugt ebenfalls eine Kante", () => {
  const v = tempVault();
  writeFileSync(join(v, "brain.config.json"), kitConfig());
  writeFileSync(join(v, ".mcp.json"), JSON.stringify({ mcpServers: { "alpha-notes": {} } }));
  mkdirSync(join(v, "wiki"), { recursive: true });
  writeFileSync(join(v, "wiki", "alpha-notes-dashboard.md"), "# Dashboard\n");
  const d = baueAnsichtsDaten(v);
  const kante = d.edges.find((e) => e.kind === "mcp");
  assert.ok(kante, "Namensgleichheits-Kante fehlt");
  assert.ok([kante.s, kante.t].includes("mcp:alpha-notes"));
  assert.ok([kante.s, kante.t].includes("wiki/alpha-notes-dashboard.md"));
});

test("cfg.ansicht.mcp === false schaltet MCP-Knoten und Bereich 'werkzeuge' ab", () => {
  const v = tempVault();
  const cfg = JSON.parse(kitConfig()); cfg.ansicht = { mcp: false };
  writeFileSync(join(v, "brain.config.json"), JSON.stringify(cfg));
  writeFileSync(join(v, ".mcp.json"), JSON.stringify({ mcpServers: { "demo-server": {} } }));
  const d = baueAnsichtsDaten(v);
  assert.ok(!d.areas.some((a) => a.id === "werkzeuge"));
  assert.ok(!d.nodes.some((n) => n.type === "mcp"));
});

test("datenSchluessel(vault): ändert sich bei einer geänderten Wiki-Datei, bleibt sonst gleich", () => {
  const v = tempVault();
  writeFileSync(join(v, "brain.config.json"), kitConfig());
  mkdirSync(join(v, "wiki"), { recursive: true });
  writeFileSync(join(v, "wiki", "a.md"), "# A\n");
  const k1 = datenSchluessel(v);
  const k1b = datenSchluessel(v);
  assert.equal(k1, k1b, "ohne Änderung muss der Schlüssel stabil bleiben");
  writeFileSync(join(v, "wiki", "a.md"), "# A geändert\n");
  // mtime bewusst weit in die Zukunft setzen — manche Dateisysteme runden auf ganze Sekunden, zwei
  // Schreibvorgänge kurz hintereinander dürften sonst dieselbe mtime bekommen (flaky).
  utimesSync(join(v, "wiki", "a.md"), new Date(Date.now() + 60_000), new Date(Date.now() + 60_000));
  const k2 = datenSchluessel(v);
  assert.notEqual(k1, k2, "nach einer Änderung muss der Schlüssel sich ändern");
});

test("datenSchluessel: Umbenennen, Löschen, Verschieben, Config, Archiv- und Cluster-Ordner ändern den Schlüssel", () => {
  const v = tempVault("ansicht schluessel ");
  writeFileSync(join(v, "brain.config.json"), kitConfig());
  for (const d of ["wiki", "inbox", "archiv", "notizen"]) mkdirSync(join(v, d), { recursive: true });
  writeFileSync(join(v, "wiki", "a.md"), "# A\n");
  writeFileSync(join(v, "inbox", "b.md"), "# B\n");
  const gesehen = new Set([datenSchluessel(v)]);
  const schritt = (name, fn) => {
    fn();
    const k = datenSchluessel(v);
    assert.ok(!gesehen.has(k), `${name} muss den Schlüssel ändern`);
    gesehen.add(k);
  };
  // rename behält die mtime der Datei — auch das muss erkannt werden
  schritt("Umbenennen im Wiki", () => renameSync(join(v, "wiki", "a.md"), join(v, "wiki", "a neu.md")));
  schritt("Verschieben Inbox → Archiv", () => renameSync(join(v, "inbox", "b.md"), join(v, "archiv", "b.md")));
  schritt("Löschen", () => rmSync(join(v, "archiv", "b.md")));
  schritt("neue Datei im Archiv", () => writeFileSync(join(v, "archiv", "c.md"), "# C\n"));
  schritt("neue Datei im Cluster-Ordner", () => writeFileSync(join(v, "notizen", "d.md"), "# D\n"));
  schritt("Config geändert (ansicht.mcp: false)", () => writeFileSync(join(v, "brain.config.json"), JSON.stringify({ ...KIT_AUSZUG, ansicht: { mcp: false } })));
  // Ohne Änderung bleibt er stabil; .logs außer werkzeug.log/lint-cache zählt nicht
  const k = datenSchluessel(v);
  mkdirSync(join(v, ".logs"), { recursive: true });
  writeFileSync(join(v, ".logs", "hint.log"), "x\n");
  assert.equal(datenSchluessel(v), k);
  schritt("Lint-Cache", () => writeFileSync(join(v, ".logs", "lint-cache.txt"), "- VERWAIST: x.md — keine eingehenden Links\n"));
});

test("D.sprache aus cfg.ansicht.sprache (nur de/en), Seite mit BOM, Lint-Pfade mit Leerzeichen", () => {
  const v = tempVault("ansicht sprache ");
  mkdirSync(join(v, "wiki"), { recursive: true });
  writeFileSync(join(v, "wiki", "thema b c.md"), "---\ndescription: x\n---\n# B C\n");
  mkdirSync(join(v, ".logs"), { recursive: true });
  writeFileSync(join(v, ".logs", "lint-cache.txt"), "- PRÜFBEDÜRFTIG: thema b c.md — Quelle inbox/x y.md geändert seit Einarbeitung\r\n");
  writeFileSync(join(v, "brain.config.json"), JSON.stringify({ ...KIT_AUSZUG, ansicht: { sprache: "en" } }));
  writeFileSync(join(v, "wiki", "mit-bom.md"), "\uFEFF---\r\ndescription: Beschreibung mit BOM\r\n---\r\n# Mit BOM\r\n");
  const d = baueAnsichtsDaten(v);
  assert.equal(d.sprache, "en");
  assert.equal(d.nodes.find((n) => n.id === "wiki/mit-bom.md")?.beschreibung, "Beschreibung mit BOM");
  assert.equal(d.nodes.find((n) => n.id === "wiki/thema b c.md")?.status, "pruef");
  writeFileSync(join(v, "brain.config.json"), JSON.stringify({ ...KIT_AUSZUG, ansicht: { sprache: "fr" } }));
  assert.equal("sprache" in baueAnsichtsDaten(v), false);
  writeFileSync(join(v, "brain.config.json"), JSON.stringify(KIT_AUSZUG));
  assert.equal("sprache" in baueAnsichtsDaten(v), false);
});

// --- v0.4 Task 1: Gültigkeit, Konflikte, Lesezahl, Bedeutung, MCP-Gruppe/-Icon ---
test("v0.4: Knotenfelder gueltigkeit/pruefenBis/stand/konflikte/lesezahl/bedeutung, D.konflikte, MCP gruppe/icon", () => {
  const v = tempVault("ansicht v04 ");
  const jetzt = new Date(2026, 9, 3, 12, 0, 0).getTime();
  writeFileSync(join(v, "brain.config.json"), kitConfig());
  writeFileSync(join(v, ".mcp.json"), JSON.stringify({ mcpServers: { "claude_ai_Beispiel": {}, "demo-server": {} } }));
  mkdirSync(join(v, "wiki", "notizen"), { recursive: true });
  writeFileSync(join(v, "wiki", "notizen", "alt.md"), "﻿---\r\nname: alt\r\ndescription: alt\r\nstand: 2026-01-10\r\npruefen_bis: 2026-09-23\r\n---\r\n# Alt\r\n\r\n[[neu]]\r\n");
  writeFileSync(join(v, "wiki", "notizen", "neu.md"), "---\nname: neu\ndescription: neu\npruefen_bis: 2026-10-10\n---\n# Neu\n\n[[alt]] [[ohne]]\n");
  writeFileSync(join(v, "wiki", "notizen", "ohne.md"), [
    "---", "name: ohne", "description: ohne", "---", "# Ohne", "",
    "> [!KONFLIKT] offen — Du entscheidest", '> A: "eins" — Quelle: [[alt]]', '> B: "zwei" — Quelle: [[neu]]', "",
    "> [!KONFLIKT] offen — Du entscheidest", '> A: "kaputt, B fehlt"', "",
  ].join("\n"));
  mkdirSync(join(v, "notizen"));
  writeFileSync(join(v, "notizen", "roh.md"), "> [!KONFLIKT] offen\n> A: \"x\"\n> B: \"y\"\n"); // keine Wiki-Seite → nicht in D.konflikte
  mkdirSync(join(v, ".logs"));
  const zeit = (tage) => new Date(jetzt - tage * 86400000).toISOString().slice(0, 19);
  writeFileSync(join(v, ".logs", "werkzeug.log"), [
    `${zeit(1)} sid=a art=lesen ziel=${encodeURIComponent("wiki/notizen/neu.md")}`,
    `${zeit(2)} sid=a art=lesen ziel=${encodeURIComponent("wiki/notizen/neu.md")}`,
    `${zeit(40)} sid=a art=lesen ziel=${encodeURIComponent("wiki/notizen/neu.md")}`, // älter als 30 Tage
    `${zeit(3)} sid=a art=mcp ziel=${encodeURIComponent("demo-server/suche")}`,
    "kaputte zeile ohne felder",
  ].join("\n") + "\n");
  const d = baueAnsichtsDaten(v, { jetzt });
  const k = (id) => d.nodes.find((n) => n.id === id);
  const alt = k("wiki/notizen/alt.md"), neu = k("wiki/notizen/neu.md"), ohne = k("wiki/notizen/ohne.md");
  assert.deepEqual([alt.gueltigkeit, alt.pruefenBis, alt.stand], ["abgelaufen", "2026-09-23", "2026-01-10"]);
  assert.deepEqual([neu.gueltigkeit, neu.pruefenBis, neu.stand], ["bald", "2026-10-10", null]);
  assert.equal(ohne.gueltigkeit, "ohne");
  // W1-Review #13: Knotenzahl aus demselben Parser wie D.konflikte (jeder Ring hat einen Eintrag), kaputte getrennt
  assert.equal(ohne.konflikte, 1, "entscheidbare Kästen");
  assert.equal(ohne.konflikteKaputt, 1, "unvollständiger Kasten getrennt gezählt");
  assert.equal(ohne.status, "konflikt");
  assert.deepEqual(d.konflikte, [{ seite: "wiki/notizen/ohne.md", nr: 1, fp: fingerabdruck("eins", "zwei"), zeile: 7, a: { text: "eins", quelle: "alt" }, b: { text: "zwei", quelle: "neu" } }]);
  assert.equal(d.konflikte.length, d.nodes.filter(n => n.wiki).reduce((s, n) => s + n.konflikte, 0), "Ringzahl = Einträge");
  assert.equal(neu.lesezahl, 2);
  assert.equal(alt.lesezahl, 0);
  for (const n of d.nodes) {
    assert.ok(n.bedeutung >= 0 && n.bedeutung <= 1, `${n.id}: bedeutung ${n.bedeutung}`);
    assert.ok([1, 2, 3].includes(n.bedeutungStufe), `${n.id}: Stufe ${n.bedeutungStufe}`);
  }
  assert.equal(neu.bedeutung, 1, "meiste Verbindungen + Lesungen → 1");
  assert.equal(neu.bedeutungStufe, 3);
  assert.ok(alt.bedeutung < neu.bedeutung);
  const cai = k("mcp:claude_ai_Beispiel"), demo = k("mcp:demo-server");
  assert.equal(cai.gruppe, "Claude.ai");
  assert.equal(demo.gruppe, "Vault");
  assert.equal(demo.lesezahl, 1);
  assert.equal(cai.gueltigkeit, "ohne");
  assert.ok(cai.icon === null || typeof cai.icon === "string");
});

test("v0.4: ohne Frontmatter zählt „pruefen_bis:“ im Text nicht (W1-Review #12)", () => {
  const v = tempVault("ansicht ohne fm ");
  writeFileSync(join(v, "brain.config.json"), kitConfig());
  mkdirSync(join(v, "wiki"), { recursive: true });
  writeFileSync(join(v, "wiki", "erklaerung.md"), "# Felder\n\nSo schreibt man es:\npruefen_bis: 2020-01-01\n");
  writeFileSync(join(v, "wiki", "echt.md"), "---\nname: echt\npruefen_bis: 2020-01-01\n---\n# Echt\n");
  const d = baueAnsichtsDaten(v, { jetzt: new Date(2026, 9, 3, 12).getTime() });
  assert.equal(d.nodes.find(n => n.id === "wiki/erklaerung.md").gueltigkeit, "ohne");
  assert.equal(d.nodes.find(n => n.id === "wiki/echt.md").gueltigkeit, "abgelaufen");
});

test("v0.4: Symlink-Seiten nach außen fließen nicht ein (W1-Review #16)", (t) => {
  const v = tempVault("ansicht symlink ");
  writeFileSync(join(v, "brain.config.json"), kitConfig());
  mkdirSync(join(v, "wiki"), { recursive: true });
  const aussen = mkdtempSync(join(tmpdir(), "ansicht-aussen-"));
  mkdirSync(join(aussen, "ordner"));
  const kasten = "# Fremd\n\n> [!KONFLIKT] offen\n> A: x\n> B: y\n";
  writeFileSync(join(aussen, "fremd.md"), kasten);
  writeFileSync(join(aussen, "ordner", "fremd2.md"), kasten);
  writeFileSync(join(v, "wiki", "innen.md"), kasten);
  try {
    symlinkSync(join(aussen, "fremd.md"), join(v, "wiki", "link.md"));
    symlinkSync(join(aussen, "ordner"), join(v, "wiki", "linkdir"), "dir");
  } catch { t.skip("keine Symlinks"); return; }
  const d = baueAnsichtsDaten(v);
  assert.deepEqual(d.konflikte.map(k => k.seite), ["wiki/innen.md"]);
  assert.ok(!d.nodes.some(n => /link/.test(n.id)), "keine Knoten für Symlinks nach außen");
});

test("v0.4: verfall zählt ab dem letzten Commit der Seite", { skip: !hatGit && "kein git" }, () => {
  const v = tempVault("ansicht verfall ");
  writeFileSync(join(v, "brain.config.json"), kitConfig());
  mkdirSync(join(v, "wiki"), { recursive: true });
  writeFileSync(join(v, "wiki", "moment.md"), "---\nname: moment\ndescription: m\nverfall: 30\n---\n# Moment\n");
  writeFileSync(join(v, "wiki", "ohne-commit.md"), "---\nname: oc\ndescription: m\nverfall: 30\n---\n# OC\n");
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_")));
  env.GIT_AUTHOR_DATE = env.GIT_COMMITTER_DATE = "2026-01-01T10:00:00";
  const g = (...a) => execFileSync("git", ["-C", v, ...a], { stdio: "ignore", windowsHide: true, env });
  g("init", "-q"); g("add", "--", "wiki/moment.md");
  g("-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-q", "--no-gpg-sign", "-m", "x");
  const d = baueAnsichtsDaten(v, { jetzt: new Date(2026, 9, 3, 12).getTime() });
  assert.equal(d.nodes.find((n) => n.id === "wiki/moment.md").gueltigkeit, "abgelaufen");
  assert.equal(d.nodes.find((n) => n.id === "wiki/ohne-commit.md").gueltigkeit, "ohne");
});

test("v0.4: bedeutungen() normiert auf 0..1 mit Stufen; mcpIcon() fällt auf null zurück", () => {
  assert.deepEqual(bedeutungen([]), []);
  assert.deepEqual(bedeutungen([{ verbindungen: 0, lesezahl: 0 }]), [{ bedeutung: 0, bedeutungStufe: 1 }]);
  const b = bedeutungen([{ verbindungen: 10, lesezahl: 10 }, { verbindungen: 1, lesezahl: 0 }, { verbindungen: 4, lesezahl: 3 }]);
  assert.deepEqual(b.map((x) => x.bedeutungStufe), [3, 1, 2]);
  assert.equal(b[0].bedeutung, 1);
  assert.equal(mcpIcon("claude_ai_Gmail", null, {}), null);
  assert.equal(mcpIcon("x", () => "gmail", null), null);
  assert.equal(mcpIcon("claude_ai_Gmail", (n, z) => z[n.replace(/^claude_ai_/, "").toLowerCase()] || null, { gmail: "gmail" }), "gmail");
  assert.equal(mcpIcon("x", () => { throw new Error("kaputt"); }, {}), null);
  assert.equal(mcpIcon("x", () => "", {}), null);
});
