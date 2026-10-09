// .tools/tests/test-pflegelauf.mjs — Pflege-Lauf mit KI (opt-in). Nie das echte claude: fake-claude.mjs über
// claudeBefehl bzw. BRAIN_CLAUDE; HOME/USERPROFILE → Temp-Home (Verläufe unter ~/.claude/projects sind erfunden),
// PATH → leerer Temp-Ordner (außer für den einen git-Test von ladeKandidaten). Keine geerbten GIT_*.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, symlinkSync, utimesSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const HIER = dirname(fileURLToPath(import.meta.url));
const FAKE = join(HIER, "fake-claude.mjs");
const CLI = join(HIER, "..", "pflegelauf.mjs");
const ECHTER_PATH = process.env.PATH;
const LEER_PATH = mkdtempSync(join(tmpdir(), "pflege-leerer-path-"));
const TEMP_HOME = mkdtempSync(join(tmpdir(), "pflege-home-"));
Object.assign(process.env, { PATH: LEER_PATH, HOME: TEMP_HOME, USERPROFILE: TEMP_HOME });
for (const k of ["BRAIN_CLAUDE", "BRAIN_ERNTE", "BRAIN_VAULT", "BRAIN_PFLEGELAUF_SKRIPT"]) delete process.env[k];
for (const k of Object.keys(process.env)) if (k.startsWith("GIT_")) delete process.env[k];

const P = await import("../pflegelauf.mjs");
const { listeVorschlaege } = await import("../vorschlaege.mjs");
const FAKE_BEFEHL = { befehl: process.execPath, args: [FAKE] };
const KOEDER_PW = ["pass", "word"].join("") + "=Koeder123";
const TAG = 24 * 3600 * 1000;

function neuerVault(automatik = {}) {
  const v = mkdtempSync(join(tmpdir(), "pflege vault, Jo's Ü "));
  writeFileSync(join(v, "brain.config.json"), JSON.stringify({ automatik }));
  mkdirSync(join(v, "09_wiki", "garten"), { recursive: true });
  writeFileSync(join(v, "09_wiki", "garten", "thema_beet.md"), "\uFEFF---\nname: beet\n---\n# Beet\n\nDas Hochbeet steht im Süden.\r\n");
  writeFileSync(join(v, "09_wiki", "garten", "thema_kompost.md"), `# Kompost\n\nKomposter hinten links.\n${KOEDER_PW}\n`);
  return v;
}
function fakeUmgebung(ausgabe, { exit = 0 } = {}) {
  const d = mkdtempSync(join(tmpdir(), "pflege-fake-"));
  writeFileSync(join(d, "aus.txt"), ausgabe);
  Object.assign(process.env, { FAKE_CLAUDE_LOG: join(d, "ein.txt"), FAKE_CLAUDE_AUSGABE: join(d, "aus.txt"), FAKE_CLAUDE_EXIT: String(exit), FAKE_CLAUDE_ROH: "", FAKE_CLAUDE_OHNE_USAGE: "", FAKE_CLAUDE_WARTE: "0" });
  return { ein: join(d, "ein.txt"), args: join(d, "ein.txt.json") };
}
const BERICHT = { erstellt: "2026-10-03", zuTun: 3, posten: [
  { schluessel: "abgelaufen", anzahl: 2, liste: ["garten/thema_beet.md", "garten/thema_kompost.md"], naechsterSchritt: "Stand prüfen" },
  { schluessel: "dubletten", anzahl: 1, liste: ["garten/thema_beet.md ↔ garten/thema_hochbeet.md"], naechsterSchritt: "zusammenlegen" },
  { schluessel: "verwaist", anzahl: 0, liste: [], naechsterSchritt: "-" },
] };
const ladeBericht = async () => BERICHT;
const ladeKand = (seiten, nachbarn = []) => async () => ({ seiten, nachbarn });
const blocks = (n) => Array.from({ length: n }, (_, i) => `### Vorschlag ${i + 1}\nbefund: ${i === 0 ? "zusammenlegen" : i === 1 ? "Lücke" : "quatsch"}\nSeiten prüfen, Nummer ${i + 1}.`).join("\n\n");

test("parsePflege: höchstens 8, Befund normalisiert (Lücke → luecke, unbekannt → sonstiges), NICHTS → []", () => {
  const r = P.parsePflege(blocks(10));
  assert.equal(r.length, 8);
  assert.deepEqual(r.slice(0, 3).map(x => x.befund), ["zusammenlegen", "luecke", "sonstiges"]);
  assert.equal(r[0].text, "Seiten prüfen, Nummer 1.");
  assert.deepEqual(P.parsePflege("NICHTS"), []);
  assert.deepEqual(P.parsePflege("### Nur Titel\nbefund: veraltet\n"), []);
});

test("berichtText: nur Posten mit Anzahl > 0, mit Liste und nächstem Schritt", () => {
  assert.equal(P.berichtText(BERICHT), "- abgelaufen: 2 (garten/thema_beet.md, garten/thema_kompost.md) — Stand prüfen\n- dubletten: 1 (garten/thema_beet.md ↔ garten/thema_hochbeet.md) — zusammenlegen");
  assert.equal(P.berichtText(null), "");
});

test("ladePflegebericht: pflege.mjs fehlt → null; vorhandenes Modul wird lazy geladen", async () => {
  const v = neuerVault();
  assert.equal(await P.ladePflegebericht(v, { modulPfad: join(tmpdir(), "gibt-es-nicht", "pflege.mjs") }), null);
  const d = mkdtempSync(join(tmpdir(), "pflege-modul-"));
  writeFileSync(join(d, "pflege.mjs"), "export function pflegebericht(v, { jetzt }) { return { erstellt: String(jetzt), posten: [{ schluessel: 'bald', anzahl: 1, liste: ['x'], naechsterSchritt: 'y' }], zuTun: 1 }; }\n");
  const b = await P.ladePflegebericht(v, { jetzt: 42, modulPfad: join(d, "pflege.mjs") });
  assert.equal(b.erstellt, "42"); assert.equal(b.posten[0].schluessel, "bald");
  writeFileSync(join(d, "kaputt.mjs"), "export function pflegebericht() { throw new Error('x'); }\n");
  assert.equal(await P.ladePflegebericht(v, { modulPfad: join(d, "kaputt.mjs") }), null);
});

test("pflegeLauf mit fake-claude: schlanker Aufruf, Bericht + Seiten (Secret-gefiltert, nur Wiki), ≤ 8 Vorschläge art pflege, Kosten im Log", async (t) => {
  const v = neuerVault();
  const draussen = mkdtempSync(join(tmpdir(), "pflege-draussen-"));
  writeFileSync(join(draussen, "fremd.md"), "FREMDER-INHALT-NIE-SENDEN\n");
  let link = null;
  if (process.platform !== "win32") { symlinkSync(join(draussen, "fremd.md"), join(v, "09_wiki", "garten", "link.md")); link = "09_wiki/garten/link.md"; }
  const f = fakeUmgebung(blocks(10));
  const r = await P.pflegeLauf(v, {
    claudeBefehl: FAKE_BEFEHL, ladeBericht,
    ladeKand: ladeKand(["09_wiki/garten/thema_beet.md"], ["09_wiki/garten/thema_kompost.md", "../" + "x.md", "brain.config.json", ...(link ? [link] : [])]),
  });
  assert.equal(r.status, "ok", JSON.stringify(r));
  assert.equal(r.vorschlaege.length, 8);
  const eingabe = readFileSync(f.ein, "utf8");
  assert.ok(eingabe.startsWith(P.BERICHT_KOPF));
  assert.match(eingabe, /- abgelaufen: 2 \(garten\/thema_beet\.md/);
  assert.match(eingabe, /## 09_wiki\/garten\/thema_beet\.md\n---\nname: beet/);
  assert.match(eingabe, /Komposter hinten links/);
  assert.ok(!eingabe.includes("Koeder123"), "Zugangsdaten nie senden");
  assert.ok(!eingabe.includes("FREMDER-INHALT"), "Symlink aus dem Wiki heraus nie lesen");
  assert.ok(!eingabe.includes("automatik"), "nur Wiki-Seiten");
  assert.ok(eingabe.length <= P.MAX_EINGABE + 200);
  const { args } = JSON.parse(readFileSync(f.args, "utf8"));
  assert.equal(args[args.indexOf("--system-prompt") + 1], P.PFLEGE_AUFTRAG);
  const liste = listeVorschlaege(v);
  assert.equal(liste.length, 8);
  assert.ok(liste.every(x => x.art === "pflege"));
  assert.deepEqual([...new Set(liste.map(x => x.befund))].sort(), ["luecke", "sonstiges", "zusammenlegen"]);
  assert.match(readFileSync(join(v, ".logs", "pflege-lauf.log"), "utf8"), /anlass=knopf status=ok ein=\d+ aus=\d+ tokEin=\d+ tokAus=\d+ vorschlaege=8 verworfen=0 lektionen=0/);
  assert.ok(!existsSync(join(v, ".logs", "pflege", "lauf.lock")), "Lock wieder frei");
  assert.deepEqual(readdirSync(join(v, "09_wiki", "garten")).sort(), ["thema_beet.md", "thema_kompost.md", ...(link ? ["link.md"] : [])].sort(), "Wiki unverändert");
  t.diagnostic(`eingabe=${eingabe.length} Zeichen`);
});

test("pflegeLauf: großes Wiki → Eingabe auf ≤ 24 000 Zeichen gekürzt", async () => {
  const v = neuerVault();
  const seiten = [];
  for (let i = 0; i < 12; i++) {
    writeFileSync(join(v, "09_wiki", "garten", `seite_${i}.md`), `# Seite ${i}\n\n${"Langer Gartentext. ".repeat(400)}\n`);
    seiten.push(`09_wiki/garten/seite_${i}.md`);
  }
  const f = fakeUmgebung("NICHTS");
  const r = await P.pflegeLauf(v, { claudeBefehl: FAKE_BEFEHL, ladeBericht, ladeKand: ladeKand(seiten) });
  assert.equal(r.status, "ok"); assert.equal(r.vorschlaege.length, 0);
  assert.ok(readFileSync(f.ein, "utf8").length <= P.MAX_EINGABE + 200);
});

test("pflegeLauf: nichts zu prüfen → kein claude-Aufruf; claude fehlt → fehler; Secret/Kundendaten in Antwort → verworfen", async () => {
  const v1 = neuerVault();
  const f1 = fakeUmgebung(blocks(1));
  const r1 = await P.pflegeLauf(v1, { claudeBefehl: FAKE_BEFEHL, ladeBericht: async () => null, ladeKand: ladeKand([]) });
  assert.equal(r1.grund, "nichts zu prüfen");
  assert.ok(!existsSync(f1.ein), "kein claude-Aufruf");
  const v2 = neuerVault();
  const r2 = await P.pflegeLauf(v2, { claudeBefehl: null, ladeBericht, ladeKand: ladeKand([]) });
  assert.equal(r2.status, "fehler"); assert.equal(r2.grund, "claude nicht gefunden");
  assert.match(readFileSync(join(v2, ".logs", "pflege-lauf.log"), "utf8"), /status=fehler .*grund=claude-fehlt/);
  const v3 = neuerVault();
  const kundenMail = ["erika.beispiel", "@", "kunde-muster", ".test"].join("");
  fakeUmgebung(`### Zugang\nbefund: veraltet\nNeuer Zugang ${KOEDER_PW}\n\n### Kunde\nbefund: veraltet\nKunde erreichbar unter ${kundenMail}.\n\n### Beet\nbefund: veraltet\nBeet-Seite prüfen.`);
  const r3 = await P.pflegeLauf(v3, { claudeBefehl: FAKE_BEFEHL, ladeBericht, ladeKand: ladeKand([]) });
  assert.equal(r3.vorschlaege.length, 1); assert.equal(r3.verworfen, 2, "Zugangs- und Kundendaten verworfen");
  assert.deepEqual(listeVorschlaege(v3).map(x => x.titel), ["Beet"]);
  const v4 = neuerVault();
  fakeUmgebung("egal", { exit: 2 });
  const r4 = await P.pflegeLauf(v4, { claudeBefehl: FAKE_BEFEHL, ladeBericht, ladeKand: ladeKand([]) });
  assert.equal(r4.status, "fehler");
  assert.deepEqual(listeVorschlaege(v4), []);
});

test("pflegeLauf: läuft schon (frischer Lock), BRAIN_ERNTE=1, kaputte Config → übersprungen", async () => {
  const v = neuerVault();
  mkdirSync(join(v, ".logs", "pflege"), { recursive: true });
  writeFileSync(join(v, ".logs", "pflege", "lauf.lock"), "1\n");
  assert.equal((await P.pflegeLauf(v, { claudeBefehl: FAKE_BEFEHL, ladeBericht, ladeKand: ladeKand([]) })).grund, "läuft schon");
  assert.equal(P.starteLosgeloest(v).grund, "läuft schon");
  process.env.BRAIN_ERNTE = "1";
  try { assert.equal((await P.pflegeLauf(neuerVault(), { claudeBefehl: FAKE_BEFEHL })).grund, "Selbstaufruf"); }
  finally { delete process.env.BRAIN_ERNTE; }
  const k = neuerVault();
  writeFileSync(join(k, "brain.config.json"), "{ kaputt");
  assert.equal((await P.pflegeLauf(k, { claudeBefehl: FAKE_BEFEHL })).grund, "Config nicht lesbar");
});

function verlauf(vault, name, alterTage = 0) {
  const dir = join(TEMP_HOME, ".claude", "projects", P.kodierterOrdner(vault));
  mkdirSync(dir, { recursive: true });
  const z = (type, content) => JSON.stringify({ type, cwd: vault, sessionId: name, message: { role: type, content } });
  const f = join(dir, `${name}.jsonl`);
  writeFileSync(f, [
    z("user", "Schreib die Einkaufsliste für den Baumarkt."), z("assistant", [{ type: "text", text: "Liste: Erde, Dünger." }]),
    z("user", "Nein, Einkaufsliste Baumarkt bitte nach Abteilung sortieren."), z("assistant", [{ type: "text", text: "Ok." }]),
    z("user", "Falsch, die Einkaufsliste für den Baumarkt nach Abteilung!"), z("assistant", [{ type: "text", text: "Korrigiert." }]),
  ].join("\n") + "\n");
  if (alterTage) { const d = new Date(Date.now() - alterTage * TAG); utimesSync(f, d, d); }
  return f;
}

test("Verläufe der Woche: nur eigener Vault, nur ≤ 7 Tage → Lektionen; Schalter aus → keine", async () => {
  assert.equal(P.kodierterOrdner("/srv/mein brain"), "-srv-mein-brain");
  assert.equal(P.kodierterOrdner("C:\\Nutzer\\x"), "C--Nutzer-x");
  const v = neuerVault();
  verlauf(v, "neu-1"); verlauf(v, "alt-1", 8);
  const fremd = neuerVault(); verlauf(fremd, "fremd-1");
  const vs = P.verlaeufeDerWoche(v);
  assert.deepEqual(vs.map(x => x.sid), ["neu-1"]);
  fakeUmgebung("NICHTS");
  const r = await P.pflegeLauf(v, { claudeBefehl: FAKE_BEFEHL, ladeBericht, ladeKand: ladeKand([]) });
  assert.equal(r.lektionen, 1);
  const lekt = listeVorschlaege(v).filter(x => x.art === "lektion");
  assert.equal(lekt.length, 1);
  assert.match(readFileSync(join(v, ".logs", "lektionen.log"), "utf8"), /anlass=pflege-lauf modus=lokal/);
  // zweiter Lauf: dieselbe Sitzung wird nicht erneut gemeldet
  const r2 = await P.pflegeLauf(v, { claudeBefehl: FAKE_BEFEHL, ladeBericht, ladeKand: ladeKand([]) });
  assert.equal(r2.lektionen, 0);
  const aus = neuerVault({ lektionen: "aus" }); verlauf(aus, "neu-2");
  assert.equal((await P.pflegeLauf(aus, { claudeBefehl: FAKE_BEFEHL, ladeBericht, ladeKand: ladeKand([]) })).lektionen, 0);
  const ex = neuerVault(); verlauf(ex, "neu-3");
  writeFileSync(join(ex, "brain.config.json"), JSON.stringify({ automatik: { ernteNichtIn: [ex] } }));
  assert.equal((await P.pflegeLauf(ex, { claudeBefehl: FAKE_BEFEHL, ladeBericht, ladeKand: ladeKand([]) })).lektionen, 0, "ausgeschlossener Ordner");
});

test("wöchentlich: faellig/starteWennFaellig mit Marke; starteLosgeloest ohne claude → „claude fehlt“", async () => {
  const fd = mkdtempSync(join(tmpdir(), "pflege-fake-skript-"));
  const skript = join(fd, "fake-pflegelauf.mjs");
  writeFileSync(skript, `import { writeFileSync } from "node:fs";\nwriteFileSync(process.env.FAKE_PFLEGE_LOG, JSON.stringify({ args: process.argv.slice(2), vault: process.env.BRAIN_VAULT || "" }));\n`);
  const aus = neuerVault();
  assert.equal(P.faellig(aus), false, "Standard aus");
  assert.equal(P.starteWennFaellig(aus), false);

  const v = neuerVault({ pflegeLauf: "woechentlich" });
  assert.equal(P.faellig(v), true);
  assert.deepEqual(P.starteLosgeloest(v), { gestartet: false, grund: "claude fehlt" });
  process.env.BRAIN_PFLEGELAUF_SKRIPT = skript;
  process.env.FAKE_PFLEGE_LOG = join(fd, "lauf.json");
  try {
    assert.equal(P.starteWennFaellig(v), true);
    const ende = Date.now() + 8000;
    // Datei kann schon existieren, aber noch leer sein (Kindprozess schreibt noch) — bis gültiges JSON drin steht.
    let lauf;
    while (Date.now() < ende && !lauf) {
      try { lauf = JSON.parse(readFileSync(process.env.FAKE_PFLEGE_LOG, "utf8")); } catch { await new Promise(r => setTimeout(r, 50)); }
    }
    assert.ok(lauf, "Fake-Pflegelauf hat nichts geschrieben");
    assert.deepEqual(lauf.args, ["--anlass", "woechentlich", v]);
    assert.equal(lauf.vault, v);
    assert.ok(existsSync(P.START_MARKE(v)));
    // Zweiter Klick, bevor das Kind seinen Lock hat → „läuft schon“ (Dienst: 409); der Lauf selbst räumt die Marke weg
    assert.deepEqual(P.starteLosgeloest(v), { gestartet: false, grund: "läuft schon" });
    assert.equal(P.pflegeLaufStatus(v).laeuft, true);
    await P.pflegeLauf(v, { claudeBefehl: FAKE_BEFEHL, ladeBericht: async () => null, ladeKand: ladeKand([]) });
    assert.equal(P.pflegeLaufStatus(v).laeuft, false);
    assert.equal(P.faellig(v), false);
    assert.equal(P.starteWennFaellig(v), false, "innerhalb von 7 Tagen nicht noch einmal");
    const alt = new Date(Date.now() - 8 * TAG); utimesSync(P.START_MARKE(v), alt, alt);
    assert.equal(P.faellig(v), true);
  } finally { delete process.env.BRAIN_PFLEGELAUF_SKRIPT; delete process.env.FAKE_PFLEGE_LOG; }
  // ohne claude: Marke trotzdem gesetzt, damit nicht jeder Sitzungsstart es erneut versucht
  const ohne = neuerVault({ pflegeLauf: "woechentlich" });
  assert.equal(P.starteWennFaellig(ohne), false);
  assert.ok(existsSync(P.START_MARKE(ohne)));
});

test("wochenHinweis: einmal je 7 Tage, nur bei Arbeit, ohne Bericht/ohne Befund keine Marke, Schalter aus → nichts (eigener Rückfall)", async () => {
  const ohneModul = join(tmpdir(), "gibt-es-nicht", "pflege.mjs");
  const W = (v, o = {}) => P.wochenHinweis(v, { modulPfad: ohneModul, ...o });
  const v = neuerVault();
  assert.equal(await W(v, { ladeBericht: async () => null }), "");
  assert.ok(!existsSync(P.WOCHE_MARKE(v)), "ohne Bericht keine Marke");
  const bericht = { posten: [...BERICHT.posten, { schluessel: "vorschlaege", anzahl: 5 }, { schluessel: "konflikte", anzahl: 1 }, { schluessel: "constructor", anzahl: 3 }] };
  assert.equal(await W(v, { ladeBericht: async () => bericht }), "Brain-Woche: 2 abgelaufen · 1 Dublette · 1 Konflikt — im Gehirn unter Pflege");
  assert.ok(existsSync(P.WOCHE_MARKE(v)));
  assert.equal(await W(v, { ladeBericht: async () => bericht }), "", "innerhalb der Woche nicht noch einmal");
  assert.ok((await W(v, { jetzt: Date.now() + 8 * TAG, ladeBericht: async () => bericht })).startsWith("Brain-Woche:"));
  const leer = neuerVault();
  assert.equal(await W(leer, { ladeBericht: async () => ({ posten: [{ schluessel: "abgelaufen", anzahl: 0 }] }) }), "");
  // Final-Review #5: die Woche wird nur mit einer Meldung verbraucht — sauberer Bericht setzt keine Marke …
  assert.ok(!existsSync(P.WOCHE_MARKE(leer)), "geprüft, nichts zu tun → keine Marke");
  // … und entsteht am nächsten Tag Arbeit, meldet der nächste Start sie sofort
  assert.equal(await W(leer, { jetzt: Date.now() + TAG, ladeBericht: async () => ({ posten: [{ schluessel: "abgelaufen", anzahl: 1 }] }) }),
    "Brain-Woche: 1 abgelaufen — im Gehirn unter Pflege");
  assert.ok(existsSync(P.WOCHE_MARKE(leer)));
  // auch über pflege.mjs#wochenZeile: Bericht nur mit eigenen Zeilen (Vorschläge) → leer → keine Marke
  const nurEigene = neuerVault();
  assert.equal(await P.wochenHinweis(nurEigene, { ladeBericht: async () => ({ posten: [{ schluessel: "vorschlaege", anzahl: 2 }] }) }), "");
  assert.ok(!existsSync(P.WOCHE_MARKE(nurEigene)));
  const aus = neuerVault({ wochenbericht: false });
  assert.equal(await W(aus, { ladeBericht: async () => bericht }), "");
});

test("wochenHinweis: Text kommt aus pflege.mjs#wochenZeile(bericht) (null → keine Zeile; nur eine Zeile)", async () => {
  const d = mkdtempSync(join(tmpdir(), "pflege-woche-modul-"));
  writeFileSync(join(d, "mit.mjs"), "export function wochenZeile(b) { return 'Brain-Woche: ' + b.posten.length + ' Posten\\nzweite Zeile'; }\n");
  writeFileSync(join(d, "null.mjs"), "export function wochenZeile() { return null; }\n");
  const bericht = async () => BERICHT;
  assert.equal(await P.wochenHinweis(neuerVault(), { ladeBericht: bericht, modulPfad: join(d, "mit.mjs") }), "Brain-Woche: 3 Posten");
  assert.equal(await P.wochenHinweis(neuerVault(), { ladeBericht: bericht, modulPfad: join(d, "null.mjs") }), "");
});

test("wochenHinweis ohne ladeBericht liest nur den Cache (.logs/pflege-bericht.json): fehlt/zu alt → keine Zeile, keine Marke", async () => {
  const { schreibeBerichtCache, BERICHT_CACHE } = await import("../pflege.mjs");
  const v = neuerVault();
  assert.equal(await P.wochenHinweis(v), "");
  assert.ok(!existsSync(P.WOCHE_MARKE(v)), "ohne Cache keine Marke");
  schreibeBerichtCache(v, { zuTun: 3, posten: [{ schluessel: "abgelaufen", anzahl: 2 }, { schluessel: "vorschlaege", anzahl: 1 }] });
  const alt = new Date(Date.now() - 8 * TAG); utimesSync(BERICHT_CACHE(v), alt, alt);
  assert.equal(await P.wochenHinweis(v), "", "Cache älter als eine Woche zählt nicht");
  utimesSync(BERICHT_CACHE(v), new Date(), new Date());
  assert.equal(await P.wochenHinweis(v), "Brain-Woche: 2 abgelaufen — im Gehirn unter Pflege");
  assert.ok(existsSync(P.WOCHE_MARKE(v)));
});

test("pflegeLaufStatus: claude/läuft/letzter Lauf mit Tokens", async () => {
  const v = neuerVault();
  assert.deepEqual(P.pflegeLaufStatus(v), { claude: false, laeuft: false, letzter: null });
  fakeUmgebung(blocks(2));
  await P.pflegeLauf(v, { claudeBefehl: FAKE_BEFEHL, ladeBericht, ladeKand: ladeKand([]) });
  const s = P.pflegeLaufStatus(v);
  assert.equal(s.letzter.status, "ok"); assert.equal(s.letzter.vorschlaege, 2);
  assert.ok(s.letzter.tokEin > 0 && s.letzter.tokAus > 0);
  // Final-Review #2: logs.mjs schreibt UTC ohne Zone — der Status liefert ISO mit „Z“, nie als Ortszeit lesbar
  assert.match(s.letzter.zeit, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  assert.ok(Math.abs(Date.parse(s.letzter.zeit) - Date.now()) < 60000, "Zeit stimmt in UTC");
});

test("ladeKandidaten: review-kandidaten.mjs als Kindprozess (git, ohne GIT_*) → geänderte Wiki-Seiten", async (t) => {
  const v = neuerVault();
  process.env.PATH = ECHTER_PATH;   // nur für git — claude wird hier nie gesucht
  try {
    const git = (...a) => spawnSync("git", ["-C", v, ...a], { encoding: "utf8", windowsHide: true, env: process.env });
    if (git("init", "-q").status !== 0) { t.skip("git fehlt"); return; }
    git("add", "--", "09_wiki");
    const c = git("-c", "user.email=t@example.com", "-c", "user.name=t", "commit", "-qm", "x");
    assert.equal(c.status, 0, c.stderr);
    const k = await P.ladeKandidaten(v);
    assert.deepEqual(k.seiten.sort(), ["09_wiki/garten/thema_beet.md", "09_wiki/garten/thema_kompost.md"]);
  } finally { process.env.PATH = LEER_PATH; }
});

test("CLI gibt nie etwas aus (BRAIN_CLAUDE → fake-claude)", () => {
  const v = neuerVault();
  const d = mkdtempSync(join(tmpdir(), "pflege-cli-"));
  writeFileSync(join(d, "aus.txt"), "NICHTS");
  const r = spawnSync(process.execPath, [CLI, "--anlass", "woechentlich", v], {
    encoding: "utf8", windowsHide: true,
    env: { ...process.env, BRAIN_CLAUDE: FAKE, FAKE_CLAUDE_AUSGABE: join(d, "aus.txt"), FAKE_CLAUDE_LOG: join(d, "ein.txt"), FAKE_CLAUDE_EXIT: "0" },
  });
  assert.equal(r.stdout + r.stderr, "");
  assert.equal(r.status, 0);
  assert.ok(statSync(join(v, ".logs", "pflege-lauf.log")).size > 0);
});
