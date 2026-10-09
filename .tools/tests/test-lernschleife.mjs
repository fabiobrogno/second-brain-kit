// .tools/tests/test-lernschleife.mjs — Lernschleife (0 Tokens): Lücke/Fragespur (nur Stichwörter + 8er-sid) ×
// werkzeug.log → Kandidat „Frage → Seite“ → wöchentlicher Pflege-Vorschlag (art: pflege, befund: frage).
// Temp-HOME und Temp-Vault, synthetische Logs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zeitstempel } from "../logs.mjs";
import { merkeLuecke, merkeFragespur, analyse } from "../analyse.mjs";
import { kandidaten, vorschlagsListe, wochenLauf, faellig, WOCHE_MARKE } from "../lernschleife.mjs";
import { listeVorschlaege } from "../vorschlaege.mjs";

const TEST_HOME = mkdtempSync(join(tmpdir(), "brain lernschleife home "));
Object.assign(process.env, { HOME: TEST_HOME, USERPROFILE: TEST_HOME });

const T0 = Date.UTC(2026, 9, 1, 10, 0, 0);
const z = (ms) => zeitstempel(new Date(ms));
const MIN = 60000;

function neuerVault({ luecken = true } = {}) {
  const v = join(mkdtempSync(join(tmpdir(), "brain lernschleife ")), "Mein Brain");
  mkdirSync(join(v, "09_wiki", "wissen"), { recursive: true });
  mkdirSync(join(v, ".logs"), { recursive: true });
  writeFileSync(join(v, "brain.config.json"), JSON.stringify({ automatik: { luecken } }) + "\n");
  const seite = (name, fm = "") => writeFileSync(join(v, "09_wiki", "wissen", name), `---\nname: x\ndescription: x\ntyp: thema\n${fm}rev: 1\n---\n# X\n`);
  seite("thema_faehre.md"); seite("thema_hafen.md"); seite("thema_mit_fragen.md", 'fragen: ["Wann fährt die Fähre nach Föhr?"]\n');
  writeFileSync(join(v, "09_wiki", "ueberblick.md"), "# Überblick\n");
  return v;
}
const log = (v, name, zeilen) => writeFileSync(join(v, ".logs", name), zeilen.join("\n") + "\n");
const hint = (ms, sid, hits = "-") => `${z(ms)} sid=${sid} len=30 weg=vektor top=0.300 zeichen=0 hits=${hits} unterdrueckt=0 kalt=0 refresh=0 ms=40`;
const lesen = (ms, sid, ziel) => `${z(ms)} sid=${sid} art=lesen ziel=${encodeURIComponent(ziel)}`;
const luecke = (ms, sid, text) => `${z(ms)} sid=${sid} quelle=hint text=${text}`;
const spur = (ms, sid, hits, text) => `${z(ms)} sid=${sid} hits=${encodeURIComponent(hits.join("\t"))} text=${text}`;

test("merkeLuecke/merkeFragespur: nur Stichwörter + 8er-sid, nie Prompttext; eval-Sitzung, Schalter aus, Secret → nichts", () => {
  const v = neuerVault();
  assert.equal(merkeLuecke(v, "hint", "Wann fährt die erste Fähre nach Föhr?", { cwd: "/", sid: "abcdef123456789" }), true);
  const l = readFileSync(join(v, ".logs", "luecken.log"), "utf8");
  assert.match(l, / sid=abcdef12 quelle=hint text=fährt erste fähre föhr\n$/);
  assert.ok(!l.includes("Wann fährt"));
  assert.equal(merkeLuecke(v, "hint", "Wann fährt die Fähre?", { cwd: "/", sid: "eval-1-2" }), false, "Messlatte");
  assert.equal(merkeFragespur(v, "Wo legt die Fähre ab?", { cwd: "/", sid: "s1", hits: [] }), false, "ohne Treffer keine Spur");
  assert.equal(merkeFragespur(v, "Wo legt die Fähre ab?", { cwd: "/", sid: "s1", hits: ["09_wiki/a b.md", "09_wiki/c.md"] }), true);
  assert.match(readFileSync(join(v, ".logs", "fragespur.log"), "utf8"), / sid=s1 hits=09_wiki%2Fa%20b\.md%0909_wiki%2Fc\.md text=legt fähre ab\n$/);
  const koeder = ["pass", "word"].join("") + "=Geheim123456";
  assert.equal(merkeFragespur(v, `Wie lautet ${koeder} für die Fähre?`, { cwd: "/", sid: "s1", hits: ["09_wiki/c.md"] }), false, "Secret");
  const aus = neuerVault({ luecken: false });
  assert.equal(merkeFragespur(aus, "Wo legt die Fähre ab?", { cwd: "/", sid: "s1", hits: ["09_wiki/c.md"] }), false, "Schalter aus");
  assert.ok(!existsSync(join(aus, ".logs", "fragespur.log")));
  // die Lückenliste der Analyse zeigt die sid nicht
  const a = analyse(v, { jetzt: Date.now() });
  assert.deepEqual(Object.keys(a.luecken[0]).sort(), ["quelle", "text", "zeit"]);
});

test("kandidaten: Lücke + Lesen in derselben Sitzung binnen 10 min und vor dem nächsten Prompt → Frage → Seite", () => {
  const v = neuerVault();
  log(v, "luecken.log", [
    luecke(T0, "aaaa1111", "erste fähre föhr"),          // → thema_faehre (gelesen nach 2 min)
    luecke(T0 + 60 * MIN, "bbbb2222", "hafen dagebüll"),  // Lesen erst nach dem nächsten Prompt → nichts
    luecke(T0 + 120 * MIN, "cccc3333", "zu spät"),        // Lesen nach 11 min → nichts
    luecke(T0 + 180 * MIN, "dddd4444", "nur überblick"),  // nur Überblick gelesen → nichts
  ]);
  log(v, "hint.log", [
    hint(T0, "aaaa1111"), hint(T0 + 60 * MIN, "bbbb2222"), hint(T0 + 61 * MIN, "bbbb2222"),
    hint(T0 + 120 * MIN, "cccc3333"), hint(T0 + 180 * MIN, "dddd4444"),
  ]);
  log(v, "werkzeug.log", [
    lesen(T0 + 2 * MIN, "aaaa1111-0000-4000-8000-000000000000", "09_wiki/wissen/thema_faehre.md"),
    lesen(T0 + 3 * MIN, "aaaa1111-0000-4000-8000-000000000000", "09_wiki/wissen/thema_hafen.md"),
    lesen(T0 + 2 * MIN, "zzzz9999", "09_wiki/wissen/thema_hafen.md"),                     // fremde Sitzung
    lesen(T0 + 62 * MIN, "bbbb2222", "09_wiki/wissen/thema_hafen.md"),
    lesen(T0 + 131 * MIN, "cccc3333", "09_wiki/wissen/thema_hafen.md"),
    lesen(T0 + 181 * MIN, "dddd4444", "09_wiki/ueberblick.md"),
    lesen(T0 + 182 * MIN, "dddd4444", "09_wiki/_index.md"),
  ]);
  const k = kandidaten(v, { jetzt: T0 + 200 * MIN });
  assert.deepEqual(k.map(x => [x.stichwoerter.join(" "), x.seite, x.anlass]), [["erste fähre föhr", "09_wiki/wissen/thema_faehre.md", "ohne"]]);
});

test("kandidaten: Fragespur — Hinweis zeigte andere Seite, gelesen wurde eine nicht genannte → anders; genannte gelesen → nichts", () => {
  const v = neuerVault();
  log(v, "fragespur.log", [
    spur(T0, "aaaa1111", ["09_wiki/wissen/thema_hafen.md"], "erste fähre"),
    spur(T0 + 30 * MIN, "bbbb2222", ["09_wiki/wissen/thema_hafen.md"], "hafen"),
  ]);
  log(v, "werkzeug.log", [
    lesen(T0 + MIN, "aaaa1111", "09_wiki/wissen/thema_faehre.md"),
    lesen(T0 + 31 * MIN, "bbbb2222", "09_wiki/wissen/thema_faehre.md"),
    lesen(T0 + 32 * MIN, "bbbb2222", "09_wiki/wissen/thema_hafen.md"),
  ]);
  const k = kandidaten(v, { jetzt: T0 + 60 * MIN });
  assert.equal(k.length, 1);
  assert.deepEqual([k[0].seite, k[0].anlass, k[0].hinweis], ["09_wiki/wissen/thema_faehre.md", "anders", ["09_wiki/wissen/thema_hafen.md"]]);
});

test("vorschlagsListe: gleiche Paare zählen zusammen, häufigste zuerst; Frage schon in fragen: der Seite → kein Vorschlag", () => {
  const v = neuerVault();
  const k = (stw, seite, anlass = "ohne", zeit = z(T0)) => ({ stichwoerter: stw.split(" "), seite: `09_wiki/wissen/${seite}`, anlass, hinweis: [], zeit });
  const liste = vorschlagsListe(v, [
    k("hafen dagebüll", "thema_hafen.md"),
    k("erste fähre", "thema_faehre.md"), k("fähre erste", "thema_faehre.md", "anders"),
    k("fährt fähre föhr", "thema_mit_fragen.md"),
    k("weg", "thema_geloescht.md"),
  ]);
  assert.deepEqual(liste.map(g => [g.seite.split("/").pop(), g.anzahl]), [["thema_faehre.md", 2], ["thema_hafen.md", 1]]);
  assert.deepEqual([...liste[0].anlaesse].sort(), ["anders", "ohne"]);
});

test("wochenLauf: schreibt Pflege-Vorschläge (befund frage) mit Messlatten-Hinweis, einmal je Woche, jedes Paar nur einmal", () => {
  const v = neuerVault();
  log(v, "luecken.log", [luecke(T0, "aaaa1111", "erste fähre föhr")]);
  log(v, "werkzeug.log", [lesen(T0 + MIN, "aaaa1111", "09_wiki/wissen/thema_faehre.md")]);
  const jetzt = T0 + 60 * MIN;
  assert.equal(faellig(v, { jetzt }), true);
  const r = wochenLauf(v, { jetzt });
  assert.equal(r.status, "ok");
  assert.equal(r.vorschlaege.length, 1);
  const [vs] = listeVorschlaege(v);
  assert.equal(vs.art, "pflege");
  assert.equal(vs.befund, "frage");
  assert.match(vs.titel, /^Frage zu thema_faehre: „erste fähre föhr“$/);
  assert.match(vs.text, /Seite: `09_wiki\/wissen\/thema_faehre\.md`/);
  assert.match(vs.text, /Messlatte.*09_wiki\/_messlatte\.json/s);
  assert.match(vs.text, /"erwartet": \["thema_faehre\.md"\]/);
  assert.ok(existsSync(WOCHE_MARKE(v)));
  assert.equal(wochenLauf(v, { jetzt: jetzt + 3600000 }).status, "nicht-faellig");
  // Nach einer Woche: dasselbe Paar wird nicht noch einmal vorgeschlagen (Merkliste aus Hashes, kein Klartext)
  const spaeter = jetzt + 8 * 86400000;
  assert.deepEqual(wochenLauf(v, { jetzt: spaeter }).vorschlaege, []);
  assert.equal(listeVorschlaege(v).length, 1);
  const gesehen = readFileSync(join(v, ".logs", "lernschleife-gesehen.txt"), "utf8");
  assert.ok(!gesehen.includes("fähre") && /^[0-9a-f]{20}\n$/.test(gesehen), gesehen);
});

test("wochenLauf: ohne Daten (Schalter aus) entsteht nichts, die Woche gilt trotzdem als erledigt", () => {
  const v = neuerVault({ luecken: false });
  const r = wochenLauf(v, { jetzt: T0 });
  assert.deepEqual(r, { status: "ok", vorschlaege: [] });
  assert.equal(readdirSync(join(v, ".logs")).includes("lernschleife-woche"), true);
  utimesSync(WOCHE_MARKE(v), new Date(T0 - 8 * 86400000), new Date(T0 - 8 * 86400000));
  assert.equal(faellig(v, { jetzt: T0 }), true);
});

test("befund frage: nur aus der Lernschleife — der Pflege-Lauf (Haiku) darf ihn nicht setzen und bekommt ihn nicht angeboten", async () => {
  const { parsePflege, PFLEGE_AUFTRAG } = await import("../pflegelauf.mjs");
  assert.equal(parsePflege("### Titel\nbefund: frage\nText.")[0].befund, "sonstiges");
  assert.ok(!/\bfrage\b/.test(PFLEGE_AUFTRAG.split("\n").find(z => z.startsWith("befund:"))));
});
