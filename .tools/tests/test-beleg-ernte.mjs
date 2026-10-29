// .tools/tests/test-beleg-ernte.mjs — Beleg-Integration für die Ernte (B1, §4.1): Selbstbestätigungs-Sperre (Pfade),
// Herkunft je Rolle laut Spec über beleg.mjs + markiereEigenes, Web-Adresse, Fundstelle.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, symlinkSync, realpathSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { findeZitat } from "../beleg.mjs";
import {
  pfadFormen, nenntPfad, sperrPfade, aufrufGesperrt, markiereEigenes, webAdresse, ohneEingespieltes, ergebnisText,
  baueFundstelle, leseFundstelle, FUNDSTELLE_MUSTER, HERKUNFT_WERTE, MAX_ZITAT,
} from "../beleg-ernte.mjs";
import { gartenEintraege, GARTEN_VAULT } from "./fixture-garten.mjs";

const tempOrdner = (n) => mkdtempSync(join(tmpdir(), n + "-"));

const HOME = "/heim/jo";

test("Pfade: Leerzeichen, Umlaute, Apostroph, Backslashes, ~, Groß/Klein (macOS), Nachbarordner ist nicht der Vault", () => {
  const formen = pfadFormen("~/Mein Brän, Jo's", { home: HOME });
  assert.deepEqual([...formen].sort(), ["/heim/jo/Mein Brän, Jo's", "~/Mein Brän, Jo's"].sort());
  for (const t of [`cat "/heim/jo/Mein Brän, Jo's/09_wiki/a.md"`, "~/Mein Brän, Jo's/x", "/HEIM/jo/mein brän, jo's/x"]) assert.ok(nenntPfad(t, formen, { plattform: "darwin" }), t);
  for (const t of ["/heim/jo/Mein Brän, Jo's-kit/x", "/heim/jo/Mein Brän, Jo's.bak/x", "/sicherung/heim/jo/Mein Brän, Jo's/x", "/heim/jo/Mein"]) assert.ok(!nenntPfad(t, formen, { plattform: "darwin" }), t);
  assert.ok(!nenntPfad("/HEIM/jo/mein brän, jo's/x", formen, { plattform: "linux" }), "Linux unterscheidet Groß/Klein");
  const win = pfadFormen("C:\\Daten\\Mein Brän", { home: "C:\\heim\\jo" });
  assert.ok(nenntPfad("type C:\\daten\\mein brän\\09_wiki\\a.md", win, { plattform: "win32" }));
  assert.ok(!nenntPfad("type C:\\Daten\\Mein Brän-kit\\a.md", win, { plattform: "win32" }));
  const brain = pfadFormen("~/brain", { home: HOME });
  assert.ok(!nenntPfad("cd ~/brain-kit-v0.7 && cat .tools/ernte.mjs", brain, { plattform: "darwin" }), "Nachbar-Worktree");
  assert.ok(nenntPfad("cd ~/brain && cat 09_wiki/a.md", brain, { plattform: "darwin" }));
});

test("pfadFormen: der echte Pfad hinter einem Symlink zählt mit", { skip: process.platform === "win32" }, () => {
  const basis = tempOrdner("Sym Brän");
  const echt = join(basis, "echt");
  mkdirSync(echt);
  const verweis = join(basis, "verweis");
  symlinkSync(echt, verweis);
  const formen = pfadFormen(verweis, { home: HOME });
  assert.ok(nenntPfad(`cat ${realpathSync(echt)}/09_wiki/a.md`, formen));
  assert.ok(nenntPfad(`cat ${verweis}/09_wiki/a.md`, formen));
  rmSync(basis, { recursive: true, force: true });
});

test("sperrPfade + aufrufGesperrt: Vault/ernteNichtIn, cwd darin, verschachtelte Eingabe, relativ vom Eltern-cwd; Relatives/Wurzel zählt nicht", () => {
  assert.deepEqual([...sperrPfade("/vault/beispiel", ["~/firma", "", "/", "relativ/ordner", 5], { home: HOME })].sort(), ["/heim/jo/firma", "/vault/beispiel", "~/firma"].sort());
  const sperr = sperrPfade("/heim/jo/brain", [], { home: HOME });
  assert.ok(aufrufGesperrt({ command: "ls" }, "/heim/jo/brain/09_wiki", sperr), "cwd im Vault");
  assert.ok(aufrufGesperrt({ file_path: "/heim/jo/brain/09_wiki/a.md" }, "/projekte/garten", sperr));
  assert.ok(aufrufGesperrt({ args: ["-n", "~/brain/09_wiki/a.md"] }, "/projekte/garten", sperr));
  assert.ok(aufrufGesperrt({ command: "cat brain/09_wiki/a.md" }, "/heim/jo", sperr), "relativ vom Home aus");
  assert.ok(aufrufGesperrt({ command: "cat ./brain/09_wiki/a.md" }, "/heim/jo", sperr));
  assert.ok(aufrufGesperrt({ command: "cat ../brain/09_wiki/a.md" }, "/heim/jo/projekt", sperr), "relativ vom Nachbarordner aus");
  assert.ok(aufrufGesperrt({ command: "brain search tomaten" }, "/projekte/garten", sperr), "brain-Befehl ohne Pfad");
  assert.ok(aufrufGesperrt({ query: "qmd://wiki/a.md" }, "/projekte/garten", sperr));
  assert.ok(!aufrufGesperrt({ command: "cat ../brain-app/a.md" }, "/heim/jo/projekt", sperr), "Nachbar mit ähnlichem Namen");
  assert.ok(nenntPfad("danach cd /heim/jo/brain.", sperr, { plattform: "linux" }), "Punkt am Satzende");
  assert.ok(!nenntPfad("/heim/jo/brain.bak/x", sperr, { plattform: "linux" }));
  assert.ok(!aufrufGesperrt({ command: "cat brain-app/README.md" }, "/heim/jo", sperr), "Nachbarordner");
  assert.ok(!aufrufGesperrt({ command: "cat brain/x" }, "/projekte/garten", sperr));
  assert.ok(!aufrufGesperrt({ file_path: "/heim/jo/brain/a.md" }, "/heim/jo", []), "ohne Sperrliste nie gesperrt");
});

// Spec §4.1 je Rolle — über das vorhandene beleg.mjs, nach markiereEigenes (eigenes Brain, Fehler, unbekannte Aufrufe → ki).
const FAELLE = [
  ["u01", "Die Tomaten stehen im Hochbeet Nord", "du"],
  ["u02", "Ich lege den Gießplan für das Hochbeet Nord an.", "ki"],
  ["u04", "Tropfschlauch mit 2 Litern pro Stunde", "tool"],
  ["u04", "Die Erdbeeren brauchen Stroh als Unterlage.", "ki"],
  ["u06", "Möhren säen ab Mitte April in Reihe 3.", "tool"],
  ["u08", "Kompost braucht sechs Monate bis zur Reife.", "web"],
  ["u10", "Das Hochbeet Süd bekommt Schneckenkragen.", "ki"],
  ["u11", "Kartoffeln vertragen keinen Frost.", "ki"],
  ["u12", "Mulch hält die Feuchtigkeit im Boden.", "ki"],
  ["u13", "Der Rasen wird nur samstags gemäht.", "ki"],
  ["u13", "Der Rasenmäher steht im Schuppen links.", "du"],
  ["u15", "Der Apfelbaum wurde 2019 gepflanzt.", "ki"],
  ["u17", "Frostwarnung für die Nacht auf Dienstag.", "tool"],
  ["u21", "Der Komposter steht hinter dem Schuppen.", "tool"],
  ["u23", "Datei gartenplan.csv nicht gefunden", "ki"],
  ["u24", "Die Hecke ist 40 Meter lang.", "ki"],
  ["u25", "Zusammenfassung: Beet A hat Lehmboden.", "ki"],
  ["u26", "Der Gärtner sagt: \"Bohnen nie vor den Eisheiligen\" - das gilt auch für Kürbis...", "du"],
  ["u27", "Die Regentonne fasst 300 Liter.", "du"],
  ["u28", "Die Gartenschere liegt in der Werkzeugkiste.", "du"],
  ["u29", "Die Laube hat ein Blechdach.", "ki"],
  ["u30", "Die Gießkanne ist leer.", "ki"],
  ["u32", "Der Zaun ist grün gestrichen.", "tool"],
  ["u35", "Lavendel mag sonnige Standorte.", "web"],
  ["u37", "Die Kartoffeln liegen im Keller.", "tool"],
  ["u39", "Die Kräuterspirale liegt am Südhang.", "ki"],
  ["u41", "Der Gartenkalender beginnt im Februar.", "ki"],
  ["u42", "Die Wasseruhr hängt im Keller.", "du"],
  ["u44", "Rosen brauchen einen Rückschnitt im März.", "web"],
  ["u46", "Der Holzstapel ist trocken.", "ki"],
  [null, "die regentonne fasst 300 liter.", null],
  [null, "Die Regentonne fasst 400 Liter.", null],
  [null, "hinter dem Schuppen. Notiert:", null],
  [null, "Die Tomaten bekommen Brennnesseljauche und Kompost.", null],
  [null, "Reihe 3", null],
];

test("Herkunft je Rolle (Spec §4.1) mit beleg.mjs + markiereEigenes: 100 % der Fälle", () => {
  const zeilen = markiereEigenes(gartenEintraege(), { sperr: sperrPfade(GARTEN_VAULT, [], { home: HOME }) });
  const falsch = [];
  for (const [uuid, zitat, herkunft] of FAELLE) {
    const r = findeZitat(zeilen, zitat);
    const ok = herkunft === null ? r === null : r !== null && r.herkunft === herkunft && r.uuid === uuid;
    if (!ok) falsch.push(`${zitat} → ${JSON.stringify(r)} (erwartet ${herkunft} ${uuid})`);
  }
  assert.deepEqual(falsch, []);
});

test("markiereEigenes: nur Werkzeug-Ergebnisse wandern; uuid/Zeit bleiben; Nachbarordner und fremde Zeilen unverändert", () => {
  const ein = gartenEintraege();
  const aus = markiereEigenes(ein, { sperr: sperrPfade(GARTEN_VAULT, [], { home: HOME }) });
  const u10 = aus.filter((o) => o.uuid === "u10");
  assert.deepEqual(u10.map((o) => o.type), ["assistant"]);
  assert.equal(u10[0].timestamp, "2026-10-21T08:10:00.000Z");
  assert.equal(u10[0].message.content[0].text, "Das Hochbeet Süd bekommt Schneckenkragen.");
  assert.deepEqual(aus.find((o) => o.uuid === "u32"), ein.find((o) => o.uuid === "u32"));
  assert.deepEqual(aus.find((o) => o.uuid === "u01"), ein.find((o) => o.uuid === "u01"));
  assert.deepEqual(markiereEigenes(null), []);
});

test("webAdresse: WebFetch-Adresse ohne Query/Fragment; WebSearch und Unbekanntes → leer", () => {
  const z = gartenEintraege();
  assert.equal(webAdresse(z, "u08"), "https://example.com/gartentipps");
  assert.equal(webAdresse(z, "u44"), "https://example.com/rosen");
  assert.equal(webAdresse(z, "u35"), "");
  assert.equal(webAdresse(z, "u99"), "");
});

test("ohneEingespieltes/ergebnisText: eingespielte Blöcke raus (offener Block bis zum Ende), Text-Blöcke verbunden", () => {
  assert.equal(ohneEingespieltes("A <system-reminder>x</system-reminder> B <task-notification>offen"), "A \n B");
  assert.equal(ohneEingespieltes("<command-name>/clear</command-name>"), "");
  assert.equal(ergebnisText([{ type: "text", text: "a" }, { type: "image" }, { type: "text", text: "b" }]), "a\nb");
  assert.equal(ergebnisText(5), "");
});

test("Fundstelle: <sitzung>#<uuid> <Zeit>, Unbekanntes als ?, Rundweg; Konstanten", () => {
  const f = baueFundstelle({ sitzung: "sitzung-beleg", uuid: "u06", zeit: "2026-10-21T08:06:00.000Z" });
  assert.equal(f, "sitzung-beleg#u06 2026-10-21T08:06:00.000Z");
  assert.match(f, FUNDSTELLE_MUSTER);
  assert.deepEqual(leseFundstelle(f), { sitzung: "sitzung-beleg", uuid: "u06", zeit: "2026-10-21T08:06:00.000Z" });
  assert.equal(baueFundstelle({ sitzung: "s/../x", uuid: "", zeit: "gestern" }), "sx#? ?");
  assert.deepEqual(leseFundstelle("sx#? ?"), { sitzung: "sx", uuid: "", zeit: "" });
  assert.equal(leseFundstelle("kaputt"), null);
  assert.deepEqual(HERKUNFT_WERTE, ["du", "tool", "web", "ki"]);
  assert.equal(MAX_ZITAT, 300);
});

test("markiereEigenes: Suchtreffer mit Brain-Pfad im Ergebnis sind nie Beleg, auch wenn der Aufruf den Vault nicht nennt", () => {
  const sperr = sperrPfade("/heim/jo/brain", [], { home: HOME });
  const zeilen = [
    { type: "assistant", uuid: "a1", cwd: "/projekte/garten", message: { role: "assistant", content: [
      { type: "tool_use", id: "t1", name: "Grep", input: { pattern: "Tomaten", path: "/heim/jo" } },
      { type: "tool_use", id: "t2", name: "Grep", input: { pattern: "Zaun", path: "/projekte/garten" } }] } },
    { type: "user", uuid: "r1", cwd: "/projekte/garten", message: { role: "user", content: [
      { type: "tool_result", tool_use_id: "t1", content: "~/brain/09_wiki/x.md: Tomaten brauchen Sonne." },
      { type: "tool_result", tool_use_id: "t2", content: "zaun.md: Der Zaun ist grün." }] } },
  ];
  const aus = markiereEigenes(zeilen, { sperr, plattform: "linux" });
  assert.equal(findeZitat(aus, "Tomaten brauchen Sonne.").herkunft, "ki");
  assert.equal(findeZitat(aus, "Der Zaun ist grün.").herkunft, "tool");
});
