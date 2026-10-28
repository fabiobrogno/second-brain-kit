// .tools/tests/test-pflege-bericht.mjs — pflegebericht(): exakt auf einem erfundenen Fixture-Vault (alle 16
// Posten, Listen, nächste Schritte, zuTun), Wochen-Zeile, leerer Vault, CLI (Text/JSON). Nur mkdtemp-Ordner;
// HOME/USERPROFILE auf ein Temp-Verzeichnis (analyse() liest MCP-Configs im Home).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const TEST_HOME = mkdtempSync(join(tmpdir(), "brain pflege home "));
Object.assign(process.env, { HOME: TEST_HOME, USERPROFILE: TEST_HOME });
const { pflegebericht, wochenZeile, textBericht, POSTEN, gueltigkeitRueckfall, offeneKonflikte, markiereEntschieden, aktuellerBericht, leseBerichtCache, BERICHT_CACHE, eintragText } = await import("../pflege.mjs");
const { schreibeEntscheidung } = await import("../entscheidungen.mjs");
const { schreibeVorschlag } = await import("../vorschlaege.mjs");

const HIER = dirname(fileURLToPath(import.meta.url));
const JETZT = new Date(2026, 9, 3, 12, 0, 0).getTime(); // 03.10.2026 12:00 Ortszeit
const KASTEN = (a, b) => `> [!KONFLIKT] offen — Du entscheidest\n> A: "${a}" — Quelle: [[quelle_a]]\n> B: "${b}" — Quelle: [[quelle_b]]\n`;
const seite = (titel, rumpf, fm = "") => `---\nname: ${titel}\ndescription: Testseite ${titel}\n${fm}---\n# ${titel}\n\n${rumpf}\n`;
const GLEICH = "Das Testgerät misst Temperatur und Feuchte im Lager und meldet Werte alle zehn Minuten an die Zentrale.";

function fixture() {
  const v = join(mkdtempSync(join(tmpdir(), "brain pfl, ege 'x' ")), "Mein Brain ü");
  const w = (rel, text) => { const p = join(v, ...rel.split("/")); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, text); };
  w("brain.config.json", JSON.stringify({ automatik: { luecken: true } }) + "\n");
  w("09_wiki/ueberblick.md", seite("Überblick", "[[thema_alt]] [[thema_bald]] [[thema_konflikt]] [[thema_halb]] [[thema_lang]] [[thema_doppel_a]] [[thema_doppel_b]] [[thema_titel_x]]"));
  w("09_wiki/ich.md", seite("Ich", "Ich-Karte der Testperson."));
  w("09_wiki/geräte/thema_alt.md", seite("Altes Gerät", "Stand von früher.", "pruefen_bis: 2026-09-28\n"));
  w("09_wiki/geräte/thema_bald.md", seite("Bald fälliges Gerät", "Läuft bald ab. [[thema_titel_y]]", "pruefen_bis: 2026-10-10\n"));
  w("09_wiki/geräte/thema_ok.md", seite("Frisches Gerät", "Noch lange gültig.", "pruefen_bis: 2027-01-01\n"));
  w("09_wiki/geräte/thema_konflikt.md", seite("Strittiges Gerät", KASTEN("Port 4711", "Port 4712") + "\n" + KASTEN("rot", "blau")));
  // unvollständiger Kasten (nur A): eigener Posten konflikteKaputt, kein offener Konflikt (Final-Review #3)
  w("09_wiki/geräte/thema_halb.md", seite("Halbes Gerät", "> [!KONFLIKT] offen — Du entscheidest\n> A: \"nur eine Seite\"\n"));
  w("09_wiki/geräte/thema_lang.md", seite("Langes Gerät", Array.from({ length: 160 }, (_, i) => `Zeile ${i + 1} über das lange Gerät.`).join("\n")));
  w("09_wiki/lager/thema_doppel_a.md", seite("Sensor Nord", GLEICH));
  w("09_wiki/lager/thema_doppel_b.md", seite("Sensor Süd", GLEICH));
  w("09_wiki/lager/thema_titel_x.md", seite("Gleicher Titel", "Erste Beschreibung mit eigenem Inhalt zum Lagerplatz eins."));
  w("09_wiki/lager/thema_titel_y.md", seite("Gleicher  titel!", "Zweite Beschreibung, ganz anders formuliert, über Regal sieben."));
  w("09_wiki/_schema.md", "# Schema\n\n[[thema_ok]]\n"); // „_“-Dateien zählen nicht als Verlinkung
  w("00_inbox/_lektionen/lektion-erst-pruefen.md", "---\ntyp: lektion\n---\n# Erst prüfen\n");
  w("00_inbox/_pflege/20261002-090000-pflege-abc123.md", "---\ntyp: vorschlag\nart: pflege\nbefund: veraltet\n---\n# Drucker prüfen\n");
  w("00_inbox/_import/notizen-x/_bericht.json", JSON.stringify({ quelle: "notizen-x", notizen: 3, duplikateExakt: [], widersprueche: [] }));
  w(".logs/werkzeug.log", "2026-10-02T10:00:00 sid=abc art=lesen ziel=09_wiki/geräte/thema_alt.md\n");
  w(".logs/luecken.log", "2026-10-02T10:00:00 quelle=search text=preis widget\n");
  w(".logs/hint-eval.log", "hint-eval 2026-09-20 positiv=5/5 still=2/2 kontrolle=0/0 holdout=0/0 p95ms=100 ok=1\n"
    + "hint-eval 2026-10-01 positiv=4/5 still=2/2 kontrolle=0/0 holdout=0/0 p95ms=110 ok=1\n");
  schreibeEntscheidung(v, { seite: "09_wiki/geräte/thema_konflikt.md", nr: 1, wahl: "a" }, new Date(Date.UTC(2026, 9, 2, 9)));
  schreibeVorschlag(v, { art: "fakt", titel: "Testgerät hat Port 4711", text: "Laut Sitzung hört das Testgerät auf Port 4711." }, new Date(Date.UTC(2026, 9, 2, 9)));
  return v;
}

test("pflegebericht: exakt auf dem Fixture", () => {
  const b = pflegebericht(fixture(), { jetzt: JETZT });
  assert.equal(b.erstellt, new Date(JETZT).toISOString().slice(0, 19) + "Z");
  assert.deepEqual(b.posten.map(p => p.schluessel), POSTEN);
  const p = Object.fromEntries(b.posten.map(x => [x.schluessel, x]));
  // Listeneinträge strukturiert (übersetzbar in der Ansicht); eintragText liefert den deutschen Satz (CLI, KI)
  const txt = (x) => x.liste.map(e => eintragText(x.schluessel, e));
  assert.deepEqual(txt(p.abgelaufen), ["09_wiki/geräte/thema_alt.md — seit 5 Tagen (prüfen bis 2026-09-28)"]);
  assert.deepEqual(txt(p.bald), ["09_wiki/geräte/thema_bald.md — prüfen bis 2026-10-10"]);
  assert.deepEqual(p.abgelaufen, { schluessel: "abgelaufen", anzahl: 1, liste: [{ seite: "09_wiki/geräte/thema_alt.md", tage: 5, frist: "2026-09-28", grund: "pruefen_bis" }],
    naechsterSchritt: "Inhalt prüfen und aktualisieren — sag „prüf die abgelaufenen Seiten“; danach die Frist erneuern (neues pruefen_bis, bei verfall reicht ein neuer Commit)." });
  assert.deepEqual(p.bald, { schluessel: "bald", anzahl: 1, liste: [{ seite: "09_wiki/geräte/thema_bald.md", frist: "2026-10-10" }],
    naechsterSchritt: "Bald fällig — nichts Eiliges, beim nächsten Einarbeiten mitprüfen." });
  // zwei Kästen, Kasten 1 ist schon entschieden (Auftrag wartet) → nur noch einer offen
  assert.deepEqual(p.konflikte, { schluessel: "konflikte", anzahl: 1, liste: [{ seite: "09_wiki/geräte/thema_konflikt.md", anzahl: 1 }],
    naechsterSchritt: "Im Gehirn unter „Pflege“ entscheiden, welche Aussage gilt." });
  assert.deepEqual(p.konflikteKaputt, { schluessel: "konflikteKaputt", anzahl: 1, liste: [{ seite: "09_wiki/geräte/thema_halb.md", anzahl: 1 }],
    naechsterSchritt: "Konflikt-Kasten unvollständig — A und B ergänzen oder den Kasten entfernen (sag „reparier die Konflikt-Kästen“)." });
  assert.deepEqual(txt(p.pflegeAuftraege), ["20261002-090000-pflege-abc123"]);
  assert.match(p.pflegeAuftraege.naechsterSchritt, /keine Quelle/);
  assert.deepEqual(txt(p.entscheidungen), ["09_wiki/geräte/thema_konflikt.md — Konflikt 1: A gilt"]);
  assert.deepEqual(p.entscheidungen.liste, [{ seite: "09_wiki/geräte/thema_konflikt.md", konflikt: 1, wahl: "a" }]);
  assert.equal(p.entscheidungen.anzahl, 1);
  assert.deepEqual(txt(p.vorschlaege), ["Testgerät hat Port 4711"]);
  assert.deepEqual(txt(p.lektionen), ["lektion-erst-pruefen"]);
  // thema_ok ist nur aus _schema.md verlinkt (zählt nicht); ueberblick.md und ich.md sind ausgenommen
  assert.deepEqual(txt(p.verwaist), ["09_wiki/geräte/thema_ok.md"]);
  assert.deepEqual(txt(p.nieGelesen), [
    "09_wiki/geräte/thema_bald.md", "09_wiki/geräte/thema_halb.md", "09_wiki/geräte/thema_konflikt.md", "09_wiki/geräte/thema_lang.md", "09_wiki/geräte/thema_ok.md",
    "09_wiki/ich.md", "09_wiki/lager/thema_doppel_a.md", "09_wiki/lager/thema_doppel_b.md", "09_wiki/lager/thema_titel_x.md",
    "09_wiki/lager/thema_titel_y.md", "09_wiki/ueberblick.md"]);
  assert.deepEqual(txt(p.luecken), ["preis widget"]);
  assert.deepEqual(txt(p.dubletten), [
    "09_wiki/lager/thema_doppel_a.md ↔ 09_wiki/lager/thema_doppel_b.md (Ähnlichkeit 1)",
    "09_wiki/lager/thema_titel_x.md ↔ 09_wiki/lager/thema_titel_y.md (gleicher Titel)"]);
  assert.deepEqual(txt(p.zuLang), ["09_wiki/geräte/thema_lang.md (167 Zeilen)"]);
  assert.deepEqual(txt(p.importe), ["notizen-x (3 Notizen)"]);
  assert.deepEqual(p.zufuehrungen.liste, []); // keine Zuführungen eingetragen → ruhig
  assert.deepEqual(txt(p.messlatte), ["2026-10-01: positiv 4/5, still 2/2", "2026-09-20: positiv 5/5, still 2/2"]);
  assert.deepEqual(p.dubletten.liste[1], { seiten: ["09_wiki/lager/thema_titel_x.md", "09_wiki/lager/thema_titel_y.md"], aehnlichkeit: null, grund: "titel" });
  assert.deepEqual(p.messlatte, { schluessel: "messlatte", anzahl: 1,
    liste: [{ datum: "2026-10-01", positiv: "4/5", still: "2/2", ok: true }, { datum: "2026-09-20", positiv: "5/5", still: "2/2", ok: true }],
    naechsterSchritt: "Die Suchqualität ist gesunken — beim nächsten Review die verfehlten Fragen ansehen („brain messlatte“)." });
  // Handlungsbedarf: 1 abgelaufen + 1 Konflikt + 1 kaputter Kasten + 1 Entscheidung + 1 Vorschlag + 1 Lektion
  // + 1 Pflege-Auftrag + 1 verwaist + 2 Dubletten + 1 zu lang + 1 Import + 1 Messlatte = 13 (bald, nie gelesen,
  // Lücken sind nur Hinweise)
  assert.equal(b.zuTun, 11, "Entscheidungen und Pflege-Aufträge zählen als beauftragt, nicht als zu tun");
  assert.equal(b.beauftragt, 2);
  for (const x of b.posten) {
    if (x.schluessel !== "messlatte") assert.equal(x.anzahl >= x.liste.length, true, x.schluessel); // Messlatte: Liste = letzte Läufe
    assert.ok(x.naechsterSchritt.length > 5, x.schluessel);
  }
  // ohne Vorschläge/Entscheidungen — die haben eigene Sitzungsstart-Zeilen (W1-Review #7); kaputte Kästen,
  // übernommene Lektionen und Pflege-Aufträge haben keine und stehen deshalb drin (Final-Review #3/#4)
  assert.equal(wochenZeile(b), "Brain-Woche: 1 abgelaufen · 1 Konflikt · 1 Konflikt-Kasten unvollständig — im Gehirn unter Pflege");
  assert.equal(wochenZeile({ zuTun: 2, posten: [{ schluessel: "lektionen", anzahl: 1 }, { schluessel: "pflegeAuftraege", anzahl: 2 }] }),
    "Brain-Woche: 1 Lektion wartet · 2 Pflege-Aufträge warten — im Gehirn unter Pflege");
  assert.equal(wochenZeile({ zuTun: 4, posten: [{ schluessel: "vorschlaege", anzahl: 3 }, { schluessel: "entscheidungen", anzahl: 1 }] }), "", "nur eigene Zeilen → keine Wochen-Zeile");
  assert.match(textBericht(b), /^Pflegebericht \(2026-10-03\): 11 Sachen zu tun\. 2 beauftragt — wird beim nächsten Einarbeiten erledigt\.\n- 1 abgelaufen: 09_wiki\/geräte\/thema_alt\.md/);
});

test("markiereEntschieden / offeneKonflikte: Konflikte tragen die getroffene Wahl", () => {
  const v = fixture();
  const k = markiereEntschieden(v, offeneKonflikte(v));
  assert.deepEqual(k.map(x => [x.seite, x.nr, x.entschieden]), [
    ["09_wiki/geräte/thema_konflikt.md", 1, "a"], ["09_wiki/geräte/thema_konflikt.md", 2, null]]);
  assert.deepEqual(markiereEntschieden(v, null), []);
});

test("pflegebericht: Liste höchstens 20, Anzahl vollständig", () => {
  const v = join(mkdtempSync(join(tmpdir(), "brain pflege viele ")), "v");
  mkdirSync(join(v, "09_wiki"), { recursive: true });
  for (let i = 0; i < 25; i++) writeFileSync(join(v, "09_wiki", `thema_${String(i).padStart(2, "0")}.md`), seite(`Seite ${i}`, `Eigener Inhalt Nummer ${i} mit Text ${i * 7}.`, "pruefen_bis: 2026-01-01\n"));
  const p = pflegebericht(v, { jetzt: JETZT }).posten.find(x => x.schluessel === "abgelaufen");
  assert.equal(p.anzahl, 25);
  assert.equal(p.liste.length, 20);
});

test("pflegebericht: leerer Vault → nichts zu tun, keine Wochen-Zeile; ohne Protokoll kein „nie gelesen“", () => {
  const v = join(mkdtempSync(join(tmpdir(), "brain pflege leer ")), "v");
  mkdirSync(join(v, "09_wiki"), { recursive: true });
  writeFileSync(join(v, "09_wiki", "ueberblick.md"), seite("Überblick", "Noch leer."));
  const b = pflegebericht(v, { jetzt: JETZT });
  assert.equal(b.zuTun, 0);
  assert.ok(b.posten.every(p => p.anzahl === 0));
  assert.equal(wochenZeile(b), "");
  assert.match(b.posten.find(p => p.schluessel === "nieGelesen").naechsterSchritt, /Werkzeug-Protokoll/);
  assert.match(b.posten.find(p => p.schluessel === "messlatte").naechsterSchritt, /brain messlatte/);
  assert.match(textBericht(b), /nichts zu tun\.$/);
});

test("Gültigkeits-Rückfall: Datumsgrenzen, verfall mit/ohne Commit, ungültige Daten", () => {
  const j = new Date(2026, 9, 3, 12).getTime();
  assert.equal(gueltigkeitRueckfall("pruefen_bis: 2026-10-03", { jetzt: j }).status, "bald");
  assert.equal(gueltigkeitRueckfall("pruefen_bis: 2026-10-02", { jetzt: j }).status, "abgelaufen");
  assert.equal(gueltigkeitRueckfall("pruefen_bis: 2026-10-17", { jetzt: j }).status, "bald");
  assert.equal(gueltigkeitRueckfall("pruefen_bis: 2026-10-18", { jetzt: j }).status, "ok");
  assert.equal(gueltigkeitRueckfall("pruefen_bis: 2026-02-30", { jetzt: j }).status, "ohne");
  assert.equal(gueltigkeitRueckfall("verfall: 30", { jetzt: j }).status, "ohne");
  const g = gueltigkeitRueckfall("verfall: 30", { jetzt: j, letzterCommitMs: j - 40 * 86400000 });
  assert.deepEqual([g.status, g.tageUeber, g.grund], ["abgelaufen", 10, "verfall"]);
  // Kalendertage wie gueltigkeit.mjs: Commit 01.10. 23:00, verfall 1 → am 03.10. 08:00 abgelaufen, Frist 02.10.
  const spaet = gueltigkeitRueckfall("verfall: 1", { jetzt: new Date(2026, 9, 3, 8).getTime(), letzterCommitMs: new Date(2026, 9, 1, 23).getTime() });
  assert.deepEqual([spaet.status, spaet.pruefenBis], ["abgelaufen", "2026-10-02"]);
});

test("CLI: node pflege.mjs <vault> [--json]", () => {
  const v = fixture();
  const env = { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_") && k !== "BRAIN_VAULT")), HOME: TEST_HOME, USERPROFILE: TEST_HOME };
  const json = JSON.parse(execFileSync(process.execPath, [join(HIER, "..", "pflege.mjs"), v, "--json"], { encoding: "utf8", env, windowsHide: true }));
  assert.deepEqual(json.posten.map(p => p.schluessel), POSTEN);
  const text = execFileSync(process.execPath, [join(HIER, "..", "brain.mjs"), "pflege"], { encoding: "utf8", env: { ...env, BRAIN_VAULT: v }, windowsHide: true });
  assert.match(text, /^Pflegebericht \(\d{4}-\d{2}-\d{2}\): \d+ Sachen zu tun\./);
  assert.match(text, /→ Im Gehirn unter „Pflege“ entscheiden/);
});

test("Cache (W1-Review #6): aktuellerBericht schreibt .logs/pflege-bericht.json, nutzt ihn bei gleichem Schlüssel, rechnet nach Änderung neu; CLI --cache still", async () => {
  const v = fixture();
  const b1 = await aktuellerBericht(v, { jetzt: JETZT });
  const c1 = leseBerichtCache(v);
  assert.ok(c1 && typeof c1.schluessel === "string" && c1.schluessel.length === 64);
  assert.deepEqual(c1.bericht, b1);
  // gleicher Schlüssel → Cache wird benutzt (auch mit absichtlich verändertem Inhalt erkennbar)
  const markiert = { ...c1, bericht: { ...c1.bericht, zuTun: 4242 } };
  writeFileSync(BERICHT_CACHE(v), JSON.stringify(markiert));
  assert.equal((await aktuellerBericht(v, { jetzt: JETZT })).zuTun, 4242);
  // Vault ändert sich → neu gerechnet
  writeFileSync(join(v, "09_wiki", "geräte", "thema_neu.md"), seite("Neu", "Ganz neuer Inhalt."));
  assert.notEqual((await aktuellerBericht(v, { jetzt: JETZT })).zuTun, 4242);
  // CLI --cache gibt nichts aus und schreibt den Cache
  const w = fixture();
  const env = { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_") && k !== "BRAIN_VAULT")), HOME: TEST_HOME, USERPROFILE: TEST_HOME };
  const out = execFileSync(process.execPath, [join(HIER, "..", "pflege.mjs"), w, "--cache"], { encoding: "utf8", env, windowsHide: true });
  assert.equal(out, "");
  assert.ok(leseBerichtCache(w));
});

test("abgelaufen mit Grund verfall: Eintrag nennt verfall statt „prüfen bis“ (Final-Review #7)", () => {
  assert.equal(eintragText("abgelaufen", { seite: "09_wiki/x.md", tage: 62, frist: "2026-08-02", grund: "verfall" }), "09_wiki/x.md — seit 62 Tagen (verfall, Frist 2026-08-02)");
  assert.equal(eintragText("abgelaufen", { seite: "09_wiki/x.md", tage: 1, frist: "2026-10-02", grund: "pruefen_bis" }), "09_wiki/x.md — seit 1 Tag (prüfen bis 2026-10-02)");
  // echt über git: Seite mit verfall: 1, Commit vor 10 Tagen
  const v = join(mkdtempSync(join(tmpdir(), "brain pflege verfall ")), "v");
  mkdirSync(join(v, "09_wiki"), { recursive: true });
  writeFileSync(join(v, "09_wiki", "ueberblick.md"), seite("Überblick", "[[thema_moment]]"));
  writeFileSync(join(v, "09_wiki", "thema_moment.md"), seite("Momentaufnahme", "Stand von damals.", "verfall: 1\n"));
  const datum = new Date(JETZT - 10 * 86400000).toISOString();
  const env = { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_"))), HOME: TEST_HOME, USERPROFILE: TEST_HOME,
    GIT_AUTHOR_DATE: datum, GIT_COMMITTER_DATE: datum, GIT_CONFIG_NOSYSTEM: "1" };
  const git = (...a) => execFileSync("git", ["-C", v, "-c", "user.name=Test", "-c", "user.email=pruefer", "-c", "commit.gpgsign=false", ...a], { env, stdio: "ignore", windowsHide: true });
  git("init", "-q"); git("add", "--", "09_wiki"); git("commit", "-q", "-m", "start");
  const p = pflegebericht(v, { jetzt: JETZT }).posten.find(x => x.schluessel === "abgelaufen");
  assert.equal(p.anzahl, 1);
  assert.equal(p.liste[0].grund, "verfall");
  assert.match(eintragText("abgelaufen", p.liste[0]), /\(verfall, Frist \d{4}-\d{2}-\d{2}\)$/);
});
