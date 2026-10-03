// .tools/tests/test-lektionen.mjs — Session-Auswerter (Lektionen). Nur erfundene Transkripte; nie das echte claude
// (BRAIN_CLAUDE → fake-claude.mjs), nie echte Verläufe: HOME/USERPROFILE → Temp-Home, PATH → leerer Temp-Ordner.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, symlinkSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { tmpdir, homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const HIER = dirname(fileURLToPath(import.meta.url));
const FAKE = join(HIER, "fake-claude.mjs");
const CLI = join(HIER, "..", "lektionen.mjs");

const LEER_PATH = mkdtempSync(join(tmpdir(), "lektion-leerer-path-"));
const TEMP_HOME = mkdtempSync(join(tmpdir(), "lektion-home-"));
Object.assign(process.env, { PATH: LEER_PATH, HOME: TEMP_HOME, USERPROFILE: TEMP_HOME });
for (const k of ["BRAIN_CLAUDE", "BRAIN_ERNTE", "BRAIN_VAULT"]) delete process.env[k];
for (const k of Object.keys(process.env)) if (k.startsWith("GIT_")) delete process.env[k];

const L = await import("../lektionen.mjs");
const { listeVorschlaege, entscheide } = await import("../vorschlaege.mjs");
const FAKE_BEFEHL = { befehl: process.execPath, args: [FAKE] };
const KOEDER_PW = ["pass", "word"].join("") + "=Koeder123";

function neuerVault(automatik = {}) {
  const v = mkdtempSync(join(tmpdir(), "lektion vault, Jo's Ü "));
  writeFileSync(join(v, "brain.config.json"), JSON.stringify({ automatik }));
  return v;
}
const ORDNER = join(tmpdir(), "projekte", "garten");
const z = (o) => JSON.stringify({ cwd: ORDNER, sessionId: "sitzung-l1", ...o });
const nutzer = (text, extra = {}) => z({ type: "user", message: { role: "user", content: text }, ...extra });
const antwort = (text, werkzeug) => z({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text }, ...(werkzeug ? [{ type: "tool_use", id: werkzeug.id, name: werkzeug.name, input: werkzeug.input }] : [])] } });
const ergebnis = (id, text, fehler = true) => z({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, is_error: fehler, content: text }] } });
function transkript(zeilen) {
  const d = mkdtempSync(join(tmpdir(), "lektion-transkript-"));
  const f = join(d, "sitzung.jsonl");
  writeFileSync(f, "\uFEFF" + zeilen.join("\r\n") + "\r\n");
  return f;
}
const opt = (extra = {}) => ({ ernteNichtIn: [], cwd: ORDNER, ...extra });

// Zwei Korrekturen zum selben Thema (Gießplan + Tomaten), dazwischen Plaudern.
const ZWEI_KORREKTUREN = [
  nutzer("Erstelle mir einen Gießplan für das Gemüsebeet."),
  antwort("Hier ist der Gießplan: Tomaten täglich morgens gießen."),
  nutzer("Nein, die Tomaten im Gießplan bitte nur abends gießen."),
  antwort("Verstanden, Gießplan angepasst: Tomaten morgens und abends."),
  nutzer("Wie tief setze ich Kartoffeln?"),
  antwort("Etwa zehn Zentimeter tief."),
  nutzer("Schon wieder falsch: Tomaten im Gießplan nur abends, nicht morgens!"),
  antwort("Entschuldigung, Gießplan korrigiert."),
];

test("1× Korrektur → kein Kandidat", () => {
  const f = transkript(ZWEI_KORREKTUREN.slice(0, 6));
  assert.deepEqual(L.findeLektionen(f, opt()), []);
});

test("2× Korrektur zum selben Thema → ein Kandidat (art korrektur, anzahl 2, Thema aus gemeinsamen Wörtern)", () => {
  const f = transkript(ZWEI_KORREKTUREN);
  const k = L.findeLektionen(f, opt());
  assert.equal(k.length, 1, JSON.stringify(k));
  assert.equal(k[0].art, "korrektur");
  assert.equal(k[0].anzahl, 2);
  assert.match(k[0].thema, /gießplan/);
  assert.match(k[0].thema, /tomaten/);
  assert.match(k[0].auszug, /Nutzer: Nein, die Tomaten/);
  assert.match(k[0].auszug, /Assistent: Hier ist der Gießplan/);
  assert.ok(k[0].auszug.length <= L.MAX_AUSZUG);
  assert.equal(k[0].ordner, ORDNER);
  assert.equal(k[0].sitzung, "sitzung-l1");
  assert.ok(!/Kartoffeln/.test(k[0].auszug), "nur die Korrekturen im Auszug");
});

test("2 Korrekturen zu verschiedenen Themen → kein Kandidat; „wieder“ allein ist keine Korrektur", () => {
  const f = transkript([
    nutzer("Plane das Hochbeet."), antwort("Hochbeet geplant."),
    nutzer("Nein, das Hochbeet braucht mehr Kompost."), antwort("Ok."),
    nutzer("Falsch, der Rasenmäher muss in die Garage."), antwort("Ok."),
    nutzer("Mach das Fenster wieder zu."), antwort("Ok."),
    nutzer("Fenster wieder zu, Garage wieder auf."), antwort("Ok."),
  ]);
  assert.deepEqual(L.findeLektionen(f, opt()), []);
  assert.equal(L.korrekturGewicht("Mach das Fenster wieder zu."), 1);
  assert.ok(L.korrekturGewicht("Schon wieder falsch!") >= 2);
  assert.ok(L.korrekturGewicht("nein") >= 2);
});

test("eine Korrektur mit „merk dir“ zählt sofort", () => {
  const f = transkript([
    nutzer("Schreib die Pflanzliste."), antwort("Pflanzliste: Rosen, Tulpen."),
    nutzer("Nein, merk dir: Pflanzlisten immer alphabetisch sortieren."), antwort("Gemerkt."),
  ]);
  const k = L.findeLektionen(f, opt());
  assert.equal(k.length, 1);
  assert.equal(k[0].anzahl, 1);
  assert.match(k[0].thema, /pflanzlisten|alphabetisch|sortieren/);
});

test("Fehlschlag-Paar: gleiches Werkzeug, gleiche Fehlersignatur (Pfade/Zahlen egal) → ein Kandidat", () => {
  const f = transkript([
    nutzer("Starte die Tests."),
    antwort("Starte.", { id: "w1", name: "Bash", input: { command: "npm test -- --filter beet" } }),
    ergebnis("w1", "Error: Cannot find module '/srv/beet/lib/a.js' (code 127)"),
    antwort("Nochmal.", { id: "w2", name: "Bash", input: { command: "npm test -- --filter rasen" } }),
    ergebnis("w2", "Error: Cannot find module '/srv/rasen/lib/b.js' (code 128)"),
    antwort("Lesen.", { id: "w3", name: "Read", input: { file_path: "/x/y.md" } }),
    ergebnis("w3", "File does not exist."),
  ]);
  const k = L.findeLektionen(f, opt());
  assert.equal(k.length, 1, JSON.stringify(k));
  assert.equal(k[0].art, "fehlschlag");
  assert.equal(k[0].anzahl, 2);
  assert.equal(k[0].thema, "Bash: npm test");
  assert.match(k[0].auszug, /Aufruf: Bash: npm test\n/, "nur der Befehlsanfang, nie die ganze Zeile");
  assert.ok(!/--filter|\/srv\/beet/.test(k[0].auszug), "keine Befehlszeile, keine Ordner im Auszug");
  assert.match(k[0].auszug, /Cannot find module 'a\.js'/, "Pfade im Fehlertext nur als Dateiname");
  assert.match(k[0].auszug, /Fehler: Error: Cannot find module/);
  assert.equal(L.fehlerSignatur("Fehler in /a/b/c.js Zeile 12"), L.fehlerSignatur("Fehler in C:\\x\\y.js Zeile 7"));
});

test("Fehlschlag: verschiedene Fehler, gleicher Befehlsanfang → Kandidat; erfolgreiche Ergebnisse zählen nicht", () => {
  const f = transkript([
    antwort("a", { id: "w1", name: "Bash", input: { command: "gradle build --offline" } }),
    ergebnis("w1", "Build failed: missing dependency"),
    antwort("b", { id: "w2", name: "Bash", input: { command: "gradle build --info" } }),
    ergebnis("w2", "Daemon crashed unexpectedly"),
    antwort("c", { id: "w3", name: "Bash", input: { command: "ls -la" } }),
    ergebnis("w3", "ok", false),
    antwort("d", { id: "w4", name: "Bash", input: { command: "ls -la" } }),
    ergebnis("w4", "ok", false),
  ]);
  const k = L.findeLektionen(f, opt());
  assert.equal(k.length, 1, JSON.stringify(k));
  assert.equal(k[0].thema, "Bash: gradle build");
});

test("Secret im Auszug → Kandidat verworfen (fail-closed, nicht gekürzt)", () => {
  const korrekt = transkript([
    nutzer("Trag den Zugang zum Gartenportal ein."), antwort("Erledigt."),
    nutzer(`Nein, das Gartenportal Konto ist anders:\n${KOEDER_PW}`), antwort("Ok."),
    nutzer("Falsch, Gartenportal Konto nochmal prüfen."), antwort("Ok."),
  ]);
  assert.deepEqual(L.findeLektionen(korrekt, opt()), []);
  const fehl = transkript([
    antwort("a", { id: "w1", name: "Bash", input: { command: `curl -u nutzer https://beispiel.invalid --${["pass", "word"].join("")} Koeder123` } }),
    ergebnis("w1", "401 Unauthorized"),
    antwort("b", { id: "w2", name: "Bash", input: { command: `curl -u nutzer https://beispiel.invalid --${["pass", "word"].join("")} Koeder123` } }),
    ergebnis("w2", "401 Unauthorized"),
  ]);
  assert.deepEqual(L.findeLektionen(fehl, opt()), []);
});

// ---------- Leck-Varianten aus dem W1-Review (#1–#3). Alle Köder werden erst zur Laufzeit zusammengesetzt. ----------
const j = (...t) => t.join("");
const ALLE_AUSZUEGE = (k) => k.map(x => `${x.thema}\n${x.auszug}`).join("\n");
// Zwei Korrekturen zum selben Thema; die Assistenz-Antwort davor trägt den Köder.
const korrekturMit = (koeder) => transkript([
  nutzer("Schreib die Lieferadresse für den Gartenkunden in den Auftrag."),
  antwort(`Auftrag Gartenkunde: ${koeder}`),
  nutzer("Nein, beim Gartenkunden Auftrag fehlt die Lieferzeit."), antwort("Ok, Gartenkunde Auftrag ergänzt."),
  nutzer("Schon wieder falsch: Gartenkunde Auftrag ohne Lieferzeit!"), antwort("Korrigiert."),
]);

test("Kundendaten (E-Mail, Telefon, IBAN, Anschrift) im Kontext → Kandidat verworfen; ohne Köder bleibt er", () => {
  const varianten = {
    email: j("Kontakt ", "erika.beispiel", "@", "kunde-muster", ".test"),
    telefonInt: j("Tel. +49 ", "171 ", "2345678"),
    telefonNational: j("Rückruf unter 0171 ", "2345678"),
    telefonStichwort: j("Telefon:\n", "030 12 34 56"),
    iban: j("IBAN DE89 ", "3704 0044 ", "0532 0130 00"),
    strasse: j("Lieferung an Muster", "straße 12"),
    strasseKurz: j("Hauptstr. ", "3a"),
    plzOrt: j("Erika Beispiel, Lindenweg 4", ", 12345 ", "Musterstadt"),
  };
  assert.equal(L.findeLektionen(korrekturMit("Lieferzeit fehlt noch"), opt()).length, 1, "Gegenprobe ohne Köder");
  for (const [name, koeder] of Object.entries(varianten)) {
    assert.deepEqual(L.findeLektionen(korrekturMit(koeder), opt()), [], name);
  }
  // Köder im Fehlertext eines doppelten Fehlschlags
  const fehl = transkript([
    antwort("a", { id: "w1", name: "Bash", input: { command: "node versand.js" } }),
    ergebnis("w1", j("Zustellung gescheitert an ", "erika.beispiel", "@", "kunde-muster", ".test")),
    antwort("b", { id: "w2", name: "Bash", input: { command: "node versand.js" } }),
    ergebnis("w2", j("Zustellung gescheitert an ", "erika.beispiel", "@", "kunde-muster", ".test")),
  ]);
  assert.deepEqual(L.findeLektionen(fehl, opt()), []);
});

test("Zugangsdaten in der Folgezeile oder auf der Befehlszeile (curl -u, --user, -H) → verworfen", () => {
  const pw = j("Geheim", "Xy99");
  for (const prompt of [
    j("Nein, das Gartenportal Konto nutzt das ", "pass", "wort:\n", pw),
    j("Falsch, Gartenportal Konto: ", "Kenn", "wort lautet\n", pw),
  ]) {
    const f = transkript([
      nutzer("Trag den Zugang zum Gartenportal ein."), antwort("Erledigt."),
      nutzer(prompt), antwort("Ok."),
      nutzer("Falsch, Gartenportal Konto nochmal prüfen."), antwort("Ok."),
    ]);
    const k = L.findeLektionen(f, opt());
    assert.ok(!ALLE_AUSZUEGE(k).includes(pw), `Folgezeile: ${JSON.stringify(k)}`);
    assert.deepEqual(k, []);
  }
  const geheim = j("Sup3r", "Geheim");
  for (const befehl of [
    j("curl -u ", "admin", ":", geheim, " https://beispiel.invalid/api"),
    j("curl --user ", "admin", ":", geheim, " https://beispiel.invalid/api"),
    j("curl -u", "admin", ":", geheim, " https://beispiel.invalid/api"),
    j("curl -H 'X-Api-", "Key: ", geheim, "' https://beispiel.invalid/api"),
    j("curl -H \"Auth", "orization: Basic ", geheim, "\" https://beispiel.invalid/api"),
  ]) {
    const f = transkript([
      antwort("a", { id: "w1", name: "Bash", input: { command: befehl } }), ergebnis("w1", "401 Unauthorized"),
      antwort("b", { id: "w2", name: "Bash", input: { command: befehl } }), ergebnis("w2", "401 Unauthorized"),
    ]);
    const k = L.findeLektionen(f, opt());
    assert.ok(!ALLE_AUSZUEGE(k).includes(geheim), befehl);
    assert.deepEqual(k, [], befehl);
  }
});

test("ernteNichtIn: Werkzeug-Pfade, Pfade im Befehl, im Fehlertext oder im Prompt → nie im Auszug", () => {
  const firma = join(tmpdir(), "firma-ablage");
  const vertrag = join(firma, "kunden", j("Beispiel", "_Erika_Vertrag.md"));
  const aus = opt({ ernteNichtIn: [firma] });
  const doppelt = (input, fehlertext = "File does not exist.") => transkript([
    antwort("a", { id: "w1", name: input.command ? "Bash" : "Read", input }), ergebnis("w1", fehlertext),
    antwort("b", { id: "w2", name: input.command ? "Bash" : "Read", input }), ergebnis("w2", fehlertext),
  ]);
  // Gegenprobe: ohne Ausschluss gibt es den Kandidaten — aber Pfade nur als Dateiname
  const k0 = L.findeLektionen(doppelt({ file_path: vertrag }), opt());
  assert.equal(k0.length, 1);
  assert.ok(!ALLE_AUSZUEGE(k0).includes(firma), "nie der Ordner im Auszug");
  // Ausgeschlossen: Pfadfeld, Pfad im Befehl, Pfad relativ zum cwd, ~-Pfad
  assert.deepEqual(L.findeLektionen(doppelt({ file_path: vertrag }), aus), [], "file_path");
  assert.deepEqual(L.findeLektionen(doppelt({ path: firma, pattern: "*.md" }), aus), [], "path");
  assert.deepEqual(L.findeLektionen(doppelt({ command: `cat ${vertrag}` }), aus), [], "Befehl");
  // relativ zum cwd der Verlaufszeile (ORDNER)
  assert.deepEqual(L.findeLektionen(doppelt({ file_path: relative(ORDNER, vertrag) }), aus), [], "relativ");
  assert.deepEqual(L.findeLektionen(doppelt({ command: `cat ${relative(ORDNER, vertrag)}` }), aus), [], "relativ im Befehl");
  // ~ = Temp-Home dieses Tests (HOME/USERPROFILE oben gesetzt)
  assert.deepEqual(L.findeLektionen(doppelt({ command: "cat ~/firma/kunden/a.md" }), opt({ ernteNichtIn: [join(homedir(), "firma")] })), [], "~-Pfad");
  assert.deepEqual(L.findeLektionen(doppelt({ command: "cat ~/firma/kunden/a.md" }), opt({ ernteNichtIn: ["~/firma"] })), [], "~ in beiden");
  // Pfad aus dem Ausschluss nur im Fehlertext bzw. nur im Prompt
  assert.deepEqual(L.findeLektionen(doppelt({ command: "node pruefe.js" }, `Fehler beim Lesen von ${vertrag}`), aus), [], "Fehlertext");
  const prompt = transkript([
    nutzer("Fasse den Gartenvertrag zusammen."), antwort("Zusammenfassung erstellt."),
    nutzer(`Nein, der Gartenvertrag liegt in ${vertrag}`), antwort("Ok."),
    nutzer("Falsch, der Gartenvertrag liegt woanders."), antwort("Ok."),
  ]);
  assert.deepEqual(L.findeLektionen(prompt, aus), [], "Prompt");
  assert.equal(L.findeLektionen(prompt, opt()).length, 1, "Gegenprobe ohne Ausschluss");
  assert.ok(!ALLE_AUSZUEGE(L.findeLektionen(prompt, opt())).includes(firma), "Ordner gekürzt");
});

test("kuerzePfade: nur Dateinamen, Wörter mit / und Adressen bleiben", () => {
  assert.equal(L.kuerzePfade("Lies /srv/a/b/c.md jetzt"), "Lies c.md jetzt");
  assert.equal(L.kuerzePfade("C:\\Daten\\Kunde\\x.md"), "x.md");
  assert.equal(L.kuerzePfade("~/ablage/y.txt und ../z/w.md"), "y.txt und w.md");
  assert.equal(L.kuerzePfade("und/oder https://beispiel.invalid/a/b"), "und/oder https://beispiel.invalid/a/b");
  assert.equal(L.kuerzePfade("siehe ablage/kunde/brief.md"), "siehe brief.md");
});

test("ausgeschlossener Ordner, unbekannter Ordner, fehlendes Transkript → nichts", () => {
  const f = transkript(ZWEI_KORREKTUREN);
  assert.deepEqual(L.findeLektionen(f, opt({ ernteNichtIn: [join(tmpdir(), "projekte")] })), [], "cwd ausgeschlossen");
  assert.deepEqual(L.findeLektionen(f, opt({ cwd: "" })), [], "ohne Ordner");
  assert.deepEqual(L.findeLektionen(f, opt({ cwd: "relativ/ordner" })), [], "relativer Ordner");
  assert.deepEqual(L.findeLektionen(f, opt({ ernteNichtIn: "kaputt" })), [], "kaputte Liste");
  assert.deepEqual(L.findeLektionen(join(tmpdir(), "gibt-es-nicht.jsonl"), opt()), []);
  // Sitzung wechselt zwischendurch in einen ausgeschlossenen Ordner → die ganze Sitzung bleibt unberührt.
  const kunden = join(tmpdir(), "kunden-ordner");
  const gemischt = transkript([...ZWEI_KORREKTUREN, nutzer("weiter", { cwd: kunden })]);
  assert.deepEqual(L.findeLektionen(gemischt, opt({ ernteNichtIn: [kunden] })), []);
  assert.equal(L.findeLektionen(gemischt, opt()).length, 1);
});

test("formuliereLektionen ohne KI → Rohkandidat als Vorschlag art lektion (ziel memory, Regel leer)", async () => {
  const v = neuerVault();
  const k = L.findeLektionen(transkript(ZWEI_KORREKTUREN), opt());
  const r = await L.formuliereLektionen(v, k, { mitKi: false, jetzt: Date.UTC(2026, 9, 3, 8) });
  assert.equal(r.status, "ok"); assert.equal(r.vorschlaege.length, 1);
  const [vs] = listeVorschlaege(v);
  assert.equal(vs.art, "lektion"); assert.equal(vs.ziel, "memory"); assert.equal(vs.regel, "");
  assert.match(vs.titel, /^Wiederholte Korrektur: /);
  assert.match(vs.text, /Rohkandidat/); assert.match(vs.text, /Tomaten/);
  assert.equal(vs.quelleOrdner, ORDNER);
});

function fakeUmgebung(ausgabe, { exit = 0 } = {}) {
  const d = mkdtempSync(join(tmpdir(), "lektion-fake-"));
  writeFileSync(join(d, "aus.txt"), ausgabe);
  Object.assign(process.env, { FAKE_CLAUDE_LOG: join(d, "ein.txt"), FAKE_CLAUDE_AUSGABE: join(d, "aus.txt"), FAKE_CLAUDE_EXIT: String(exit), FAKE_CLAUDE_ROH: "", FAKE_CLAUDE_OHNE_USAGE: "", FAKE_CLAUDE_WARTE: "0" });
  return { ein: join(d, "ein.txt"), args: join(d, "ein.txt.json") };
}

test("formuliereLektionen mit KI (fake-claude): schlanker Aufruf, Regel/Warum/Wie, Usage gemessen", async () => {
  const v = neuerVault();
  const k = L.findeLektionen(transkript(ZWEI_KORREKTUREN), opt());
  const f = fakeUmgebung("### Tomaten abends gießen\nziel: memory\nregel: Tomaten im Gießplan nur abends gießen.\nwarum: Der Nutzer hat das zweimal korrigiert.\nwie: Bei jedem Gießplan prüfen.\n");
  const r = await L.formuliereLektionen(v, k, { mitKi: true, claudeBefehl: FAKE_BEFEHL });
  assert.equal(r.status, "ok", JSON.stringify(r));
  assert.equal(r.vorschlaege.length, 1);
  assert.ok(r.tokens && r.tokens.ein > 0 && r.tokens.aus > 0);
  const eingabe = readFileSync(f.ein, "utf8");
  assert.ok(eingabe.startsWith(L.KANDIDATEN_KOPF));
  assert.match(eingabe, /Kandidat 1 \(korrektur, 2×\)/);
  const { args } = JSON.parse(readFileSync(f.args, "utf8"));
  assert.equal(args[args.indexOf("--system-prompt") + 1], L.LEKTION_AUFTRAG);
  const [vs] = listeVorschlaege(v);
  assert.equal(vs.art, "lektion"); assert.equal(vs.titel, "Tomaten abends gießen");
  assert.equal(vs.regel, "Tomaten im Gießplan nur abends gießen.");
  assert.equal(vs.warum, "Der Nutzer hat das zweimal korrigiert.");
  assert.equal(vs.wie, "Bei jedem Gießplan prüfen.");
  assert.match(vs.text, /\*\*Regel:\*\* Tomaten/);
});

test("KI-Antwort mit Zugangsdaten → verworfen; KI sagt NICHTS → kein Vorschlag; claude scheitert → Rohkandidat", async () => {
  const k = L.findeLektionen(transkript(ZWEI_KORREKTUREN), opt());
  const v1 = neuerVault();
  fakeUmgebung(`### Zugang\nziel: memory\nregel: Immer ${KOEDER_PW} nutzen.\n`);
  const r1 = await L.formuliereLektionen(v1, k, { mitKi: true, claudeBefehl: FAKE_BEFEHL });
  assert.equal(r1.vorschlaege.length, 0); assert.equal(r1.verworfen, 1);
  assert.deepEqual(listeVorschlaege(v1), []);
  const v2 = neuerVault();
  fakeUmgebung("NICHTS\n");
  assert.equal((await L.formuliereLektionen(v2, k, { mitKi: true, claudeBefehl: FAKE_BEFEHL })).vorschlaege.length, 0);
  const v3 = neuerVault();
  fakeUmgebung("egal", { exit: 1 });
  const r3 = await L.formuliereLektionen(v3, k, { mitKi: true, claudeBefehl: FAKE_BEFEHL });
  assert.equal(r3.status, "rueckfall"); assert.equal(r3.vorschlaege.length, 1);
  assert.match(listeVorschlaege(v3)[0].text, /Rohkandidat/);
  const v4 = neuerVault();
  const r4 = await L.formuliereLektionen(v4, k, { mitKi: true, claudeBefehl: null });
  assert.equal(r4.status, "rueckfall"); assert.equal(r4.fehler, "claude nicht gefunden");
});

test("höchstens 3 Kandidaten je Lauf", async () => {
  const v = neuerVault();
  const k = Array.from({ length: 5 }, (_, i) => ({ art: "korrektur", thema: `thema ${i}`, auszug: `Nutzer: Nein, Beet ${i}.`, anzahl: 2, ordner: ORDNER, sitzung: "s" }));
  const r = await L.formuliereLektionen(v, k, { mitKi: false });
  assert.equal(r.vorschlaege.length, 3);
});

test("lektionsLauf: Schalter aus/kaputte Config/BRAIN_ERNTE → übersprungen; Wiederholung derselben Sitzung meldet nichts doppelt", async () => {
  const f = transkript(ZWEI_KORREKTUREN);
  const aus = neuerVault({ lektionen: "aus" });
  assert.equal((await L.lektionsLauf(aus, { transkript: f, sid: "s1", cwd: ORDNER })).grund, "Schalter aus");
  assert.deepEqual(listeVorschlaege(aus), []);
  const kaputt = mkdtempSync(join(tmpdir(), "lektion-kaputt-"));
  writeFileSync(join(kaputt, "brain.config.json"), "{ kaputt");
  assert.equal((await L.lektionsLauf(kaputt, { transkript: f, sid: "s1", cwd: ORDNER })).grund, "Config nicht lesbar");
  process.env.BRAIN_ERNTE = "1";
  try { assert.equal((await L.lektionsLauf(neuerVault(), { transkript: f, sid: "s1", cwd: ORDNER })).grund, "Selbstaufruf"); }
  finally { delete process.env.BRAIN_ERNTE; }

  const v = neuerVault();   // Standard: lektionen = "lokal"
  const r1 = await L.lektionsLauf(v, { transkript: f, sid: "s1", cwd: ORDNER });
  assert.equal(r1.status, "ok"); assert.equal(r1.vorschlaege.length, 1);
  const r2 = await L.lektionsLauf(v, { transkript: f, sid: "s1", cwd: ORDNER });
  assert.equal(r2.vorschlaege.length, 0, "SessionEnd nach PreCompact: kein Duplikat");
  assert.equal(listeVorschlaege(v).length, 1);
  const log = readFileSync(join(v, ".logs", "lektionen.log"), "utf8");
  assert.match(log, /anlass=sitzungsende modus=lokal status=ok kandidaten=1 vorschlaege=1/);
  const ex = neuerVault({ ernteNichtIn: [join(tmpdir(), "projekte")] });
  assert.equal((await L.lektionsLauf(ex, { transkript: f, sid: "s1", cwd: ORDNER })).vorschlaege.length, 0);
});

test("lektionsLauf mit-ki holt claude über BRAIN_CLAUDE (fake) und schreibt tokEin/tokAus ins Log", async () => {
  const v = neuerVault({ lektionen: "mit-ki" });
  fakeUmgebung("### Abends gießen\nziel: memory\nregel: Tomaten nur abends gießen.\nwarum: zweimal korrigiert\nwie: beim Gießplan\n");
  process.env.BRAIN_CLAUDE = FAKE;
  try {
    const r = await L.lektionsLauf(v, { transkript: transkript(ZWEI_KORREKTUREN), sid: "s2", cwd: ORDNER });
    assert.equal(r.vorschlaege.length, 1);
  } finally { delete process.env.BRAIN_CLAUDE; }
  assert.match(readFileSync(join(v, ".logs", "lektionen.log"), "utf8"), /modus=mit-ki status=ok .* tokEin=\d+ tokAus=\d+/);
});

test("Übernehmen → <inbox>/_lektionen/; ins-wiki schreibt _lektionen.md (≤ 3 Zeilen) und archiviert", async () => {
  const v = neuerVault();
  fakeUmgebung("### Abends gießen\nziel: memory\nregel: Tomaten nur abends gießen.\nwarum: zweimal korrigiert.\nwie: Bei jedem Gießplan.\n");
  const r = await L.formuliereLektionen(v, L.findeLektionen(transkript(ZWEI_KORREKTUREN), opt()), { mitKi: true, claudeBefehl: FAKE_BEFEHL });
  const id = r.vorschlaege[0];
  const e = entscheide(v, id, "uebernehmen");
  assert.equal(e.ziel, `00_inbox/_lektionen/${id}.md`);
  const liste = L.listeLektionen(v);
  assert.equal(liste.length, 1); assert.equal(liste[0].id, id); assert.equal(liste[0].regel, "Tomaten nur abends gießen.");
  const w = L.lektionInsWiki(v, id);
  assert.equal(w.wiki, "09_wiki/_lektionen.md");
  const wiki = readFileSync(join(v, "09_wiki", "_lektionen.md"), "utf8");
  assert.match(wiki, /^# Lektionen\n/);
  assert.match(wiki, /- \*\*Abends gießen\*\* — Tomaten nur abends gießen\.\n  Warum: zweimal korrigiert\. · Wie: Bei jedem Gießplan\.\n$/);
  assert.deepEqual(L.listeLektionen(v), []);
  assert.ok(existsSync(join(v, "90_archiv", "lektionen-erledigt", `${id}.md`)));
});

test("Rohkandidat: ins-wiki ohne Regel → 400, mit --regel ok; skill-entwurf legt Gerüst an; erledigt; Sicherheit", async () => {
  const v = neuerVault();
  const ids = (await L.formuliereLektionen(v, L.findeLektionen(transkript(ZWEI_KORREKTUREN), opt()), { mitKi: false })).vorschlaege;
  entscheide(v, ids[0], "uebernehmen");
  assert.throws(() => L.lektionInsWiki(v, ids[0]), (e) => e.code === 400);
  assert.throws(() => L.lektionInsWiki(v, ids[0], { regel: `Nutze ${KOEDER_PW}` }), (e) => e.code === 400);
  assert.ok(!existsSync(join(v, "09_wiki", "_lektionen.md")));
  // CLI: --regel überschreibt
  const cli = spawnSync(process.execPath, [CLI, "ins-wiki", ids[0], "--regel", "Tomaten nur abends gießen.", v], { encoding: "utf8", windowsHide: true, env: process.env });
  assert.equal(cli.status, 0, cli.stderr);
  assert.match(readFileSync(join(v, "09_wiki", "_lektionen.md"), "utf8"), /— Tomaten nur abends gießen\.\n$/);

  const ids2 = (await L.formuliereLektionen(v, [{ art: "fehlschlag", thema: "Bash: npm test", auszug: "Aufruf: Bash: npm test", anzahl: 2, ordner: ORDNER, sitzung: "s" }], { mitKi: false })).vorschlaege;
  entscheide(v, ids2[0], "uebernehmen");
  const s = L.skillEntwurf(v, ids2[0]);
  assert.match(s.entwurf, /^00_inbox\/_lektionen\/skill-wiederholter-fehlschlag-bash-npm-test\.md$/);
  assert.match(readFileSync(join(v, s.entwurf), "utf8"), /^---\nname: wiederholter-fehlschlag-bash-npm-test\n/);
  assert.deepEqual(L.listeLektionen(v), [], "Entwurf zählt nicht als offene Lektion");

  for (const bad of ["../x", "A B", "", "x".repeat(81)]) assert.throws(() => L.lektionErledigt(v, bad), (e) => e.code === 400);
  assert.throws(() => L.lektionErledigt(v, "gibt-es-nicht"), (e) => e.code === 404);
  const cliListe = spawnSync(process.execPath, [CLI, "liste", v], { encoding: "utf8", windowsHide: true, env: process.env });
  assert.deepEqual(JSON.parse(cliListe.stdout), []);
});

test("Übernehmen: _lektionen als Symlink (etwa ins Wiki) → 400, nichts verschoben", async (t) => {
  if (process.platform === "win32") { t.skip("Symlinks unter Windows nur mit Rechten"); return; }
  const v = neuerVault();
  const ids = (await L.formuliereLektionen(v, L.findeLektionen(transkript(ZWEI_KORREKTUREN), opt()), { mitKi: false })).vorschlaege;
  mkdirSync(join(v, "09_wiki"), { recursive: true });
  symlinkSync(join(v, "09_wiki"), join(v, "00_inbox", "_lektionen"));
  assert.throws(() => entscheide(v, ids[0], "uebernehmen"), (e) => e.code === 400);
  assert.deepEqual(readdirSync(join(v, "09_wiki")), []);
  assert.equal(listeVorschlaege(v).length, 1);
});

test("CLI-Lauf gibt nie etwas aus", () => {
  const v = neuerVault();
  const r = spawnSync(process.execPath, [CLI, "--transkript", transkript(ZWEI_KORREKTUREN), "--sid", "s9", "--cwd", ORDNER, v], { encoding: "utf8", windowsHide: true, env: process.env });
  assert.equal(r.status, 0); assert.equal(r.stdout + r.stderr, "");
  assert.equal(listeVorschlaege(v).length, 1);
});
