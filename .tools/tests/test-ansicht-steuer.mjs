// Steuerzentrale der Ansicht (Task 9): texte.js (de/en vollständig), api.js (Zugangs-Header, 403, file://),
// steuer.js (lädt ohne DOM, reine Hilfen, nur bekannte Textschlüssel, kein innerHTML).
// Alles klassische Browser-Skripte — hier per vm in einen Kontext mit einem nachgebauten `window` geladen.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const HIER = dirname(fileURLToPath(import.meta.url));
const ANSICHT = join(HIER, "..", "ansicht");
const quelle = (datei) => readFileSync(join(ANSICHT, datei), "utf8");

function speicher(start = {}) {
  const m = new Map(Object.entries(start));
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
    _m: m,
  };
}

function ladeIn(win, ...dateien) {
  const ctx = vm.createContext({ window: win });
  for (const d of dateien) vm.runInContext(quelle(d), ctx, { filename: d });
  return win;
}

// ------------------------------------------------------------------------------------------- texte.js
test("texte: jeder Schlüssel gibt es auf Deutsch und Englisch, keiner ist leer", () => {
  const { BrainTexte } = ladeIn({ navigator: { language: "de-DE" } }, "texte.js");
  const de = Object.keys(BrainTexte.tabelle.de).sort();
  const en = Object.keys(BrainTexte.tabelle.en).sort();
  assert.ok(de.length > 40, "genug Texte");
  assert.deepEqual(en, de);
  for (const s of ["de", "en"]) {
    for (const [k, v] of Object.entries(BrainTexte.tabelle[s])) {
      assert.equal(typeof v, "string", `${s}.${k}`);
      assert.ok(v.trim(), `${s}.${k} leer`);
    }
  }
  // Platzhalter stimmen in beiden Sprachen überein
  for (const k of de) {
    const ph = (s) => [...s.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort().join(",");
    assert.equal(ph(BrainTexte.tabelle.en[k]), ph(BrainTexte.tabelle.de[k]), `Platzhalter in ${k}`);
  }
});

test("texte: t() setzt Werte ein, fällt auf Deutsch und dann auf den Schlüssel zurück", () => {
  const { BrainTexte } = ladeIn({ navigator: { language: "en-US" }, localStorage: speicher() }, "texte.js");
  assert.equal(BrainTexte.sprache, "en");
  assert.match(BrainTexte.t("tokensHeute", { n: "1,200" }), /1,200/);
  assert.equal(BrainTexte.t("gibtEsNicht"), "gibtEsNicht");
  BrainTexte.ergaenze({ de: { nurDeutsch: "nur {x}" } });
  assert.equal(BrainTexte.t("nurDeutsch", { x: "hier" }), "nur hier");
  // Werte werden nicht als Platzhalter weiter ersetzt
  assert.equal(BrainTexte.t("nurDeutsch", { x: "{x}" }), "nur {x}");
});

test("texte: Sprache aus localStorage vor navigator.language, sonst Deutsch", () => {
  assert.equal(ladeIn({ navigator: { language: "en-GB" }, localStorage: speicher({ "brain-sprache": "de" }) }, "texte.js").BrainTexte.sprache, "de");
  assert.equal(ladeIn({ navigator: { language: "en-GB" }, localStorage: speicher() }, "texte.js").BrainTexte.sprache, "en");
  assert.equal(ladeIn({ navigator: { language: "fr-FR" } }, "texte.js").BrainTexte.sprache, "de");
  assert.equal(ladeIn({}, "texte.js").BrainTexte.sprache, "de");
  // localStorage, der wirft (z. B. gesperrte Website-Daten), bricht nichts
  const wirft = { getItem() { throw new Error("gesperrt"); }, setItem() { throw new Error("gesperrt"); } };
  const w = ladeIn({ navigator: { language: "en" }, localStorage: wirft }, "texte.js");
  assert.equal(w.BrainTexte.sprache, "en");
  assert.equal(w.BrainTexte.setzeSprache("de"), true);
  assert.equal(w.BrainTexte.sprache, "de");
});

test("texte: setzeSprache speichert, meldet das Ereignis und lehnt Unbekanntes ab", () => {
  const ls = speicher();
  const ereignisse = [];
  const win = {
    navigator: { language: "de" }, localStorage: ls,
    document: { documentElement: { lang: "de" }, dispatchEvent: (e) => ereignisse.push(e) },
    CustomEvent: class { constructor(typ, o) { this.type = typ; this.detail = o && o.detail; } },
  };
  const { BrainTexte } = ladeIn(win, "texte.js");
  assert.equal(BrainTexte.setzeSprache("en"), true);
  assert.equal(BrainTexte.sprache, "en");
  assert.equal(ls.getItem("brain-sprache"), "en");
  assert.equal(win.document.documentElement.lang, "en");
  assert.equal(ereignisse.length, 1);
  assert.equal(ereignisse[0].type, "brain:sprache");
  assert.equal(BrainTexte.setzeSprache("xx"), false);
  assert.equal(BrainTexte.sprache, "en");
});

test("texte: ausConfig() — Vorrang vor navigator, aber nicht vor einer Nutzerwahl; kein Ereignis, kein localStorage-Schreiben", () => {
  // Ohne gespeicherte Nutzerwahl: Config-Sprache gewinnt gegen navigator.
  const ereignisse = [];
  const win = {
    navigator: { language: "de" }, localStorage: speicher(),
    document: { documentElement: { lang: "de" }, dispatchEvent: (e) => ereignisse.push(e) },
    CustomEvent: class { constructor(typ, o) { this.type = typ; this.detail = o && o.detail; } },
  };
  const { BrainTexte } = ladeIn(win, "texte.js");
  assert.equal(BrainTexte.sprache, "de");
  assert.equal(BrainTexte.ausConfig("en"), true);
  assert.equal(BrainTexte.sprache, "en");
  assert.equal(win.document.documentElement.lang, "en");
  assert.equal(ereignisse.length, 0, "ausConfig meldet kein brain:sprache (anders als setzeSprache)");
  assert.equal(win.localStorage.getItem("brain-sprache"), null, "ausConfig schreibt nicht in den localStorage");
  // Unverändert, wenn schon dieselbe Sprache gilt
  assert.equal(BrainTexte.ausConfig("en"), false);
  // Unbekannte Sprache wird abgelehnt
  assert.equal(BrainTexte.ausConfig("fr"), false);
  assert.equal(BrainTexte.sprache, "en");
});

test("texte: ausConfig() weicht einer schon getroffenen Nutzerwahl (localStorage) nie", () => {
  const win = { navigator: { language: "de" }, localStorage: speicher({ "brain-sprache": "de" }) };
  const { BrainTexte } = ladeIn(win, "texte.js");
  assert.equal(BrainTexte.sprache, "de");
  assert.equal(BrainTexte.ausConfig("en"), false, "Nutzerwahl (localStorage) hat Vorrang vor der Config-Sprache");
  assert.equal(BrainTexte.sprache, "de");
});

// --------------------------------------------------------------------------------------------- api.js
const ZUGANG = "ab".repeat(32);

function apiFenster({ protocol = "http:", hash = "", gespeichert = null, antworten = [] } = {}) {
  const aufrufe = [], ereignisse = [], ersetzt = [];
  const ss = speicher(gespeichert ? { "brain-zugang": gespeichert } : {});
  const win = {
    location: { protocol, hash, pathname: "/", search: "" },
    history: { replaceState: (_s, _t, url) => { ersetzt.push(url); win.location.hash = url.includes("#") ? url.slice(url.indexOf("#")) : ""; } },
    sessionStorage: ss,
    document: { dispatchEvent: (e) => ereignisse.push(e.type) },
    CustomEvent: class { constructor(typ) { this.type = typ; } },
    fetch: async (pfad, opt = {}) => {
      aufrufe.push({ pfad, opt });
      const a = antworten.shift() || { status: 200, body: { ok: true } };
      return {
        status: a.status, ok: a.status >= 200 && a.status < 300,
        json: async () => (typeof a.body === "string" ? JSON.parse(a.body) : a.body),
      };
    },
  };
  return { win, aufrufe, ereignisse, ersetzt, ss };
}

test("api: Zugang aus dem Fragment → Header gesetzt, Fragment entfernt, nur im sessionStorage", async () => {
  const f = apiFenster({ hash: `#t=${ZUGANG}`, antworten: [{ status: 200, body: { vaultId: "x" } }] });
  const { BrainApi } = ladeIn(f.win, "api.js");
  assert.equal(BrainApi.verfuegbar, true);
  assert.equal(BrainApi["token"], ZUGANG);
  assert.equal(f.win.location.hash, "", "Fragment weg");
  assert.equal(f.ersetzt.length, 1);
  assert.ok(!f.ersetzt[0].includes(ZUGANG));
  assert.equal(f.ss.getItem("brain-zugang"), ZUGANG);
  const daten = await BrainApi.holeJson("/api/ping");
  assert.equal(daten.vaultId, "x");
  assert.equal(f.aufrufe[0].pfad, "/api/ping");
  assert.equal(f.aufrufe[0].opt.headers["X-Brain-Token"], ZUGANG);
  assert.equal(f.aufrufe[0].opt.cache, "no-store");
});

test("api: anderes Fragment (#seite=…) bleibt erhalten", () => {
  const f = apiFenster({ hash: `#t=${ZUGANG}&seite=09_wiki%2Fa.md` });
  ladeIn(f.win, "api.js");
  assert.equal(f.win.location.hash, "#seite=09_wiki%2Fa.md");
  const g = apiFenster({ hash: "#seite=x" , gespeichert: ZUGANG });
  ladeIn(g.win, "api.js");
  assert.equal(g.ersetzt.length, 0, "ohne Zugang im Fragment wird nichts ersetzt");
});

test("api: ohne Fragment kommt der Zugang aus dem sessionStorage (Neuladen im selben Tab)", async () => {
  const f = apiFenster({ gespeichert: ZUGANG });
  const { BrainApi } = ladeIn(f.win, "api.js");
  assert.equal(BrainApi.verfuegbar, true);
  await BrainApi.holeJson("/api/einstellungen");
  assert.equal(f.aufrufe[0].opt.headers["X-Brain-Token"], ZUGANG);
});

test("api: sende schickt Methode, JSON-Körper und Header", async () => {
  const f = apiFenster({ hash: `#t=${ZUGANG}`, antworten: [{ status: 200, body: { ok: true, stand: "2" } }] });
  const { BrainApi } = ladeIn(f.win, "api.js");
  const r = await BrainApi.sende("PUT", "/api/einstellungen", { werte: { luecken: true }, stand: "1" });
  assert.equal(r.stand, "2");
  const { opt } = f.aufrufe[0];
  assert.equal(opt.method, "PUT");
  assert.equal(opt.headers["Content-Type"], "application/json");
  assert.equal(opt.headers["X-Brain-Token"], ZUGANG);
  assert.deepEqual(JSON.parse(opt.body), { werte: { luecken: true }, stand: "1" });
});

test("api: 403 → Ereignis brain:neu-oeffnen und Fehler mit status", async () => {
  const f = apiFenster({ hash: `#t=${ZUGANG}`, antworten: [{ status: 403, body: { fehler: "Token fehlt" } }] });
  const { BrainApi } = ladeIn(f.win, "api.js");
  await assert.rejects(BrainApi.holeJson("/api/daten"), (e) => e.status === 403);
  assert.deepEqual(f.ereignisse, ["brain:neu-oeffnen"]);
});

test("api: 409 → Fehler mit status und Meldung des Dienstes, kein neu-öffnen", async () => {
  const f = apiFenster({ hash: `#t=${ZUGANG}`, antworten: [{ status: 409, body: { fehler: "geändert" } }] });
  const { BrainApi } = ladeIn(f.win, "api.js");
  await assert.rejects(BrainApi.sende("PUT", "/api/einstellungen", {}), (e) => e.status === 409 && e.message === "geändert");
  assert.deepEqual(f.ereignisse, []);
});

test("api: kaputte Antwort (kein JSON) → verständlicher Fehler", async () => {
  const f = apiFenster({ hash: `#t=${ZUGANG}` });
  f.win.fetch = async () => ({ status: 500, ok: false, json: async () => { throw new SyntaxError("x"); } });
  const { BrainApi } = ladeIn(f.win, "api.js");
  await assert.rejects(BrainApi.holeJson("/api/analyse"), (e) => e.status === 500);
});

test("api: file:// → verfuegbar=false, kein fetch", async () => {
  const f = apiFenster({ protocol: "file:", hash: `#t=${ZUGANG}` });
  const { BrainApi } = ladeIn(f.win, "api.js");
  assert.equal(BrainApi.verfuegbar, false);
  await assert.rejects(BrainApi.holeJson("/api/ping"), (e) => e.status === 0);
  assert.equal(f.aufrufe.length, 0);
});

test("api: http ohne Zugang → verfuegbar=false; ungültiger Zugang im Fragment wird ignoriert", () => {
  assert.equal(ladeIn(apiFenster().win, "api.js").BrainApi.verfuegbar, false);
  const f = apiFenster({ hash: "#t=<script>" });
  assert.equal(ladeIn(f.win, "api.js").BrainApi.verfuegbar, false);
});

// ------------------------------------------------------------------------------------------ steuer.js
test("steuer: lädt ohne DOM und ohne app.js, init ohne document wirft nicht", () => {
  const win = ladeIn({ navigator: { language: "de" } }, "texte.js", "steuer.js");
  assert.equal(typeof win.BrainSteuer.init, "function");
  assert.doesNotThrow(() => win.BrainSteuer.init({}));
});

test("steuer: aenderungen() liefert nur geänderte Schlüssel, allesAus() schaltet die KI-Automatiken ab", () => {
  const { BrainSteuer } = ladeIn({}, "steuer.js");
  const h = BrainSteuer.hilfen;
  const alt = { staendeIntervallStunden: 2, ernteSitzungsende: true, ernteNichtIn: ["a"], ichKarte: true, projektAutomatik: true,
    hinweise: "hoch", liveAufleuchten: true, updateHinweis: true, sicherungTaeglich: true, luecken: true };
  assert.deepEqual(JSON.parse(JSON.stringify(h.aenderungen(alt, { ...alt }))), {});
  const neu = { ...alt, ernteNichtIn: ["a", "b"], luecken: false };
  assert.deepEqual(JSON.parse(JSON.stringify(h.aenderungen(alt, neu))), { ernteNichtIn: ["a", "b"], luecken: false });
  const aus = h.allesAus(alt);
  assert.equal(aus.staendeIntervallStunden, 0);
  assert.equal(aus.ernteSitzungsende, false);
  assert.equal(aus.ichKarte, false);
  assert.equal(aus.projektAutomatik, false);
  assert.equal(aus.liveAufleuchten, false);
  assert.equal(aus.luecken, false);
  // was es schon in v0.2 gab, bleibt wie es ist
  assert.equal(aus.hinweise, "hoch");
  assert.equal(aus.updateHinweis, true);
  assert.equal(aus.sicherungTaeglich, true);
  assert.deepEqual([...aus.ernteNichtIn], ["a"]);
});

test("steuer: Badge „nur Claude Code“ an Projekt-Automatik, nicht an der Ich-Karte", () => {
  const { BrainSteuer } = ladeIn({}, "steuer.js");
  const feld = (s) => BrainSteuer.hilfen.FELDER.find((f) => f.schluessel === s);
  assert.equal(feld("projektAutomatik").nurClaude, true, "Projekt-Automatik läuft über SessionStart — nur Claude Code");
  assert.ok(!feld("ichKarte").nurClaude, "Ich-Karte wirkt über AGENTS.md auch bei anderen KIs — kein Badge");
});

test("steuer: neuerOrdner() prüft leer, doppelt, Länge und Anzahl", () => {
  const { BrainSteuer } = ladeIn({}, "steuer.js");
  const n = BrainSteuer.hilfen.neuerOrdner;
  assert.deepEqual(JSON.parse(JSON.stringify(n([], "  ~/Kunden  "))), { ok: true, pfad: "~/Kunden" });
  assert.equal(n([], "   ").ok, false);
  assert.equal(n(["~/Kunden"], "~/Kunden").fehler, "ordnerDoppelt");
  assert.equal(n([], "x".repeat(301)).fehler, "ordnerZuLang");
  assert.equal(n(Array.from({ length: 20 }, (_, i) => `o${i}`), "neu").fehler, "ordnerZuViele");
});

test("steuer: jedes Einstellungs-Schema-Feld hat Titel, Satz und Kosten — und alle benutzten Textschlüssel gibt es", async () => {
  const { BrainTexte } = ladeIn({}, "texte.js");
  const { BrainSteuer } = ladeIn({}, "steuer.js");
  const { SCHEMA } = await import("../einstellungen.mjs");
  const felder = [...BrainSteuer.hilfen.FELDER.map(f => f.schluessel)].sort();
  assert.deepEqual(felder, Object.keys(SCHEMA).sort(), "Maske deckt genau das Schema ab");
  const code = quelle("steuer.js");
  const benutzt = new Set([...code.matchAll(/\bt\("([A-Za-z0-9_]+)"\s*[,)]/g)].map(m => m[1]));
  for (const f of BrainSteuer.hilfen.FELDER) {
    benutzt.add(`titel_${f.schluessel}`); benutzt.add(`satz_${f.schluessel}`); benutzt.add(f.kosten);
  }
  for (const k of BrainSteuer.hilfen.TEXTSCHLUESSEL) benutzt.add(k);
  for (const k of benutzt) {
    assert.ok(k in BrainTexte.tabelle.de, `de fehlt: ${k}`);
    assert.ok(k in BrainTexte.tabelle.en, `en fehlt: ${k}`);
  }
});

test("steuer/api/texte: kein innerHTML, kein eval, keine Inline-Handler", () => {
  for (const d of ["steuer.js", "api.js", "texte.js"]) {
    const c = quelle(d);
    assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(c), `${d}: kein HTML aus Strings`);
    assert.ok(!/\beval\(|new Function\(/.test(c), `${d}: kein eval`);
    assert.ok(!/setAttribute\(\s*["']on/i.test(c), `${d}: keine Inline-Handler`);
  }
});
