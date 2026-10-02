// .tools/tests/test-ansicht-daten.mjs — Daten der 3D-Ansicht: Bereiche aus der Config, Ausgabe nur nach .logs/ansicht/
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, cpSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { erzeugeAnsichtsDaten } from "../ansicht/daten.mjs";

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
  cpSync(join(T, "tests", "fixture"), v, { recursive: true });
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
