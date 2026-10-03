// Ansicht app.js: reine Hilfen (Texte mit Rückfall, Aufleuchten aus /api/gelesen, Kantenauswahl für große Brains)
// und das Grundgerüst index.html (Skript-Reihenfolge, keine Inline-Skripte/-Handler wegen der CSP des Dienstes).
// app.js ist ein klassisches Browser-Skript; ohne `document` legt es nur window.BrainAppHilfen an.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const HIER = dirname(fileURLToPath(import.meta.url));
const ANSICHT = join(HIER, "..", "ansicht");
const APP = readFileSync(join(ANSICHT, "app.js"), "utf8");
const INDEX = readFileSync(join(ANSICHT, "index.html"), "utf8");

function lade(fenster = {}) {
  const ctx = vm.createContext({ window: fenster });
  vm.runInContext(APP, ctx, { filename: "app.js" });
  return ctx.window;
}
const W = lade();
const H = W.BrainAppHilfen;
const plain = (x) => JSON.parse(JSON.stringify(x));

test("ohne DOM: nur die Hilfen, kein Absturz, keine BrainApp", () => {
  assert.equal(typeof H.text, "function");
  assert.equal(W.BrainApp, undefined);
});

test("Texte: ohne BrainTexte gelten die deutschen Standardtexte, Platzhalter werden gefüllt", () => {
  assert.equal(H.text(undefined, "suchen"), "Suchen");
  assert.equal(H.text(undefined, "vonSeiten", { n: 3, gesamt: 9 }), "3 von 9 Seiten");
  assert.equal(H.text(undefined, "gibtEsNicht"), "gibtEsNicht");
});

test("Texte: BrainTexte hat Vorrang, unbekannte Schlüssel (Rückgabe = Schlüssel) und Fehler fallen auf Deutsch zurück", () => {
  const en = { t: (k, w) => (k === "suchen" ? "Search" : k === "vonSeiten" ? `${w.n} of ${w.gesamt} pages` : k) };
  assert.equal(H.text(en, "suchen"), "Search");
  assert.equal(H.text(en, "vonSeiten", { n: 1, gesamt: 2 }), "1 of 2 pages");
  assert.equal(H.text(en, "keinTreffer"), "Kein Treffer");
  assert.equal(H.text({ t() { throw new Error("x"); } }, "suchen"), "Suchen");
  assert.equal(H.text({ t: () => "" }, "suchen"), "Suchen");
});

test("Texte: jeder in app.js und index.html benutzte Schlüssel hat einen deutschen Standardtext", () => {
  const schluessel = new Set();
  for (const m of APP.matchAll(/\bt\("([A-Za-z]+)"/g)) schluessel.add(m[1]);
  for (const m of APP.matchAll(/:\s*"((?:typ|bereich)[A-Z][A-Za-z]+)"/g)) schluessel.add(m[1]);
  for (const m of INDEX.matchAll(/data-t(?:-title|-aria|-placeholder)?="([A-Za-z]+)"/g)) schluessel.add(m[1]);
  // Optik-Texte (v0.4) kommen per BrainTexte.ergaenze aus app.js (H.ZUSATZ), nicht aus STANDARD
  const fehlt = [...schluessel].filter((k) => !(k in H.STANDARD) && !(k in H.ZUSATZ.de));
  assert.deepEqual(fehlt, []);
  assert.ok(schluessel.size > 40, "Schlüssel gefunden: " + schluessel.size);
});

test("Texte: jeder Rückfall-Schlüssel aus app.js (STANDARD) hat auch einen echten Text in texte.js (de+en)", () => {
  const TEXTE = readFileSync(join(ANSICHT, "texte.js"), "utf8");
  const ctx = vm.createContext({ window: {} });
  vm.runInContext(TEXTE, ctx, { filename: "texte.js" });
  const { BrainTexte } = ctx.window;
  const fehltDe = Object.keys(H.STANDARD).filter((k) => !(k in BrainTexte.tabelle.de));
  const fehltEn = Object.keys(H.STANDARD).filter((k) => !(k in BrainTexte.tabelle.en));
  assert.deepEqual(fehltDe, [], "in texte.js (de) fehlende Schlüssel aus app.js");
  assert.deepEqual(fehltEn, [], "in texte.js (en) fehlende Schlüssel aus app.js");
  // Zusatztexte der Optik: de und en vollständig, keine Überschneidung mit STANDARD
  assert.deepEqual(Object.keys(H.ZUSATZ.de).sort(), Object.keys(H.ZUSATZ.en).sort());
  assert.deepEqual(Object.keys(H.ZUSATZ.de).filter((k) => k in H.STANDARD), []);
  // ergaenze() spielt sie ein: danach liefert BrainTexte sie in beiden Sprachen
  BrainTexte.ergaenze(H.ZUSATZ);
  assert.equal(BrainTexte.tabelle.en.statusAbgelaufen, "Expired");
  assert.equal(BrainTexte.tabelle.de.statusAbgelaufen, "Abgelaufen");
});

test("Aufleuchten: neue Lesezeilen → Seiten-IDs (dekodiert, ohne Doppelte), seit = jüngster Zeitstempel", () => {
  const gesehen = new Set();
  const zeilen = [
    { zeit: "2026-10-02T10:00:05", sid: "a", art: "lesen", ziel: encodeURIComponent("09_wiki/thema ä.md") },
    { zeit: "2026-10-02T10:00:04", sid: "a", art: "mcp", ziel: "server%2Fwerkzeug" },
    { zeit: "2026-10-02T10:00:03", sid: "b", art: "lesen", ziel: encodeURIComponent("09_wiki/thema ä.md") },
    { zeit: "2026-10-02T10:00:02", sid: "b", art: "lesen", ziel: "%E0%A4" },
    { zeit: "2026-10-02T10:00:01", sid: "b", art: "lesen", ziel: "" },
    null,
  ];
  const r = H.neueGelesene(zeilen, gesehen, 1000);
  assert.deepEqual(plain(r.ids), ["09_wiki/thema ä.md"]);
  assert.equal(r.seit, Date.parse("2026-10-02T10:00:05Z"));
  // dieselben Zeilen noch einmal (Dienst liefert ab `seit` inklusive) → nichts Neues
  assert.deepEqual(plain(H.neueGelesene(zeilen, gesehen, r.seit).ids), []);
  // neue Zeile in derselben Sekunde → wird erkannt
  const neu = [{ zeit: "2026-10-02T10:00:05", sid: "c", art: "lesen", ziel: "10_projekte%2Fx.md" }];
  assert.deepEqual(plain(H.neueGelesene(neu, gesehen, r.seit).ids), ["10_projekte/x.md"]);
  // kaputte Antwort → leer, seit unverändert
  assert.deepEqual(plain(H.neueGelesene({ fehler: "x" }, gesehen, 42)), { ids: [], seit: 42 });
});

test("Kanten großer Brains: nur Auswahl, Weg oder Suchtreffer — im Überblick keine", () => {
  // Kanten: 0: 0-1, 1: 1-2, 2: 2-3, 3: 0-3
  const E = [[0, 1], [1, 2], [2, 3], [0, 3]];
  const inzident = (i) => E.map((e, k) => (e.includes(i) ? k : -1)).filter((k) => k >= 0);
  const ende = (k) => E[k];
  const opt = { inzident, ende };
  assert.deepEqual(plain(H.kantenFuerFokus("sel", { ...opt, sel: 0 })).sort(), [0, 3]);
  assert.deepEqual(plain(H.kantenFuerFokus("path", { ...opt, wegKanten: [1, 1, 2] })), [1, 2]);
  const fokus = new Map([[1, 1], [2, 0.75]]);
  assert.deepEqual(plain(H.kantenFuerFokus("search", { ...opt, fokus })), [1]);
  assert.deepEqual(plain(H.kantenFuerFokus("none", opt)), []);
  assert.deepEqual(plain(H.kantenFuerFokus("care", opt)), []);
  assert.equal(H.kantenFuerFokus("sel", { ...opt, sel: 0, max: 1 }).length, 1);
});

test("index.html: Skript-Reihenfolge texte → api → markdown → suche → icons → app → steuer, steuer.css eingebunden", () => {
  const skripte = [...INDEX.matchAll(/<script\b([^>]*)>/g)].map((m) => (m[1].match(/src="([^"]+)"/) || [])[1]);
  assert.deepEqual(skripte, ["vendor/three.bundle.js", "vendor/brain-mesh/brain-mesh.js", "texte.js", "api.js", "markdown.js", "suche.js", "icons.js", "app.js", "steuer.js"]);
  assert.match(INDEX, /<link rel="stylesheet" href="style.css">\s*<link rel="stylesheet" href="steuer.css">/);
});

test("CSP: keine Inline-Skripte, keine Inline-Event-Handler (index.html und app.js)", () => {
  for (const m of INDEX.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
    assert.match(m[1], /\ssrc="/, "Skript ohne src: " + m[0].slice(0, 80));
    assert.equal(m[2].trim(), "", "Inline-Skript: " + m[0].slice(0, 80));
  }
  assert.doesNotMatch(INDEX, /\son[a-z]+\s*=\s*["']/i);
  assert.doesNotMatch(APP, /\son[a-z]+=\\?["'`]/i);
  assert.doesNotMatch(APP, /javascript:/i);
  assert.doesNotMatch(INDEX, /<script[^>]*data\.js/, "data.js lädt app.js nur unter file:// selbst nach");
});

// Trackpad-Pinch darf nie die Seite zoomen (sonst Neuaufbau der Ansicht → Gehirn blitzt schwarz).
test("app.js: Pinch (wheel + ctrlKey) und Safari-Gesten werden nie als Seiten-Zoom durchgelassen", () => {
  const quelle = readFileSync(new URL("../ansicht/app.js", import.meta.url), "utf8");
  assert.match(quelle, /addEventListener\("wheel", \(e\) => \{ if \(e\.ctrlKey\) e\.preventDefault\(\); \}, \{ passive: false \}\)/);
  assert.match(quelle, /\["gesturestart", "gesturechange", "gestureend"\]/);
});

// Beim Hineinzoomen darf kein Punkt unendlich groß werden (schwarzes Quadrat über dem Gehirn).
test("app.js: Punkt-Shader begrenzen die Größe, verwerfen Punkte an/hinter der Kamera und NaN-Koordinaten", () => {
  const quelle = readFileSync(new URL("../ansicht/app.js", import.meta.url), "utf8");
  assert.doesNotMatch(quelle, /gl_PointSize = uPR \* uScale \* s \* 70\.0 \/ -mv\.z;/);
  assert.match(quelle, /tiefe > 0\.06 \? min\(uPR \* uScale \* s \* 70\.0 \/ tiefe, uPR \* 160\.0\) : 0\.0/);
  // MCP-Plaketten: dieselbe Grenze (Größe gedeckelt, nichts an/hinter der Kamera, NaN-sicherer Kreis-Test)
  assert.match(quelle, /tiefe > 0\.06 \? min\(uPR \* uScale \* \(26\.0 \+ 8\.0 \* mhl\) \* 4\.6 \/ tiefe, uPR \* 110\.0\) : 0\.0/);
  assert.match(quelle, /if \(!\(length\(pc - 0\.5\) <= 0\.5\)\) discard;/);
  assert.match(quelle, /if \(!\(d <= 1\.0\)\) discard;/);
  assert.match(quelle, /if \(!\(d <= 0\.5\)\) discard;/);
});

// Ein ungültiger/überlaufender Bildpunkt darf nie in den Bloom gelangen (schwarzes Quadrat beim Zoomen).
test("app.js: Klemm-Durchgang zwischen RenderPass und Bloom; Punktwolken mit Größengrenze", () => {
  const quelle = readFileSync(new URL("../ansicht/app.js", import.meta.url), "utf8");
  const a = quelle.indexOf("composer.addPass(new RenderPass"), k = quelle.indexOf("composer.addPass(klemmPass)"), b = quelle.indexOf("new UnrealBloomPass(");
  assert.ok(a > 0 && k > a && b > k, "Reihenfolge RenderPass → klemmPass → Bloom");
  assert.match(quelle, /greaterThanEqual\(c, vec4\(0\.0\)\)/);
  assert.match(quelle, /punktGrenze\(hazeMat, /);
  assert.match(quelle, /punktGrenze\(inboxMat, /);
});
