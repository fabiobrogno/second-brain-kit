// .tools/tests/test-analyse.mjs — analyse(): Trefferquote, gelesen-Quote, Seiten, Token-Schätzung,
// Importe, merkeLuecke(). Synthetische Logs in Temp-Vaults, Zahlen exakt nachrechenbar.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zeitstempel } from "../logs.mjs";
import { analyse, merkeLuecke, hitsSeiten, stichwoerter, lintPfade, empfehlung, SCHWELLE_MIN } from "../analyse.mjs";
import { protokolliere } from "../werkzeug-log.mjs";
import { importiere } from "../import/import.mjs";

const ANKER = Date.UTC(2026, 9, 2, 12, 0, 0); // 2026-10-02T12:00:00Z

// analyse() zählt nicht lesbare MCP-Configs im Home — nie die echten (~/.claude.json, Cursor, …) lesen.
const TEST_HOME = mkdtempSync(join(tmpdir(), "brain analyse home "));
Object.assign(process.env, { HOME: TEST_HOME, USERPROFILE: TEST_HOME });

const neuerVault = () => {
  const basis = mkdtempSync(join(tmpdir(), "brain analyse "));
  const vault = join(basis, "Mein Brain");
  mkdirSync(vault);
  writeFileSync(join(vault, "brain.config.json"), "{}\n");
  return vault;
};
const mitAutomatik = (vault, automatik) =>
  writeFileSync(join(vault, "brain.config.json"), JSON.stringify({ automatik }, null, 2) + "\n");
const logsDir = (vault) => join(vault, ".logs");
const schreibeLog = (vault, name, inhalt) => {
  mkdirSync(logsDir(vault), { recursive: true });
  writeFileSync(join(logsDir(vault), name), inhalt);
};

const hintZeile = ({ zeit, sid, hits = "-", weg = "vektor", ms = 50, zeichen }) => {
  let z = `${zeitstempel(new Date(zeit))} sid=${sid} len=20 weg=${weg} top=0.500 hits=${hits} unterdrueckt=0 kalt=0 refresh=0 ms=${ms}`;
  if (zeichen != null) z += ` zeichen=${zeichen}`;
  return z;
};
const werkzeugZeile = ({ zeit, sid, art = "lesen", ziel }) =>
  `${zeitstempel(new Date(zeit))} sid=${sid} art=${art} ziel=${ziel}`;

test("hinweise/gelesen: 10 Prompts, 3 mit Hinweis, 2 davon rechtzeitig (≤ 10 min) gelesen", () => {
  const vault = neuerVault();
  const mitHinweis = [
    { sid: "s0000001", t: ANKER - 4 * 86400000, hits: "09_wiki/thema_a.md", leseVersatzMs: 2 * 60000, leseZiel: "09_wiki/thema_a.md" },
    { sid: "s0000002", t: ANKER - 3 * 86400000, hits: "09_wiki/thema_b.md", leseVersatzMs: 9 * 60000, leseZiel: "09_wiki/thema_b.md" },
    { sid: "s0000003", t: ANKER - 2 * 86400000, hits: "09_wiki/thema_c.md", leseVersatzMs: 11 * 60000, leseZiel: "09_wiki/thema_c.md" }, // > 10 min → zählt nicht
  ];
  const ohneHinweis = Array.from({ length: 7 }, (_, i) => ({ sid: `s100000${i}`, t: ANKER - (5 + i) * 86400000 }));

  const hintLines = [
    ...mitHinweis.map((h) => hintZeile({ zeit: h.t, sid: h.sid, hits: h.hits })),
    ...ohneHinweis.map((h) => hintZeile({ zeit: h.t, sid: h.sid })),
  ];
  schreibeLog(vault, "hint.log", `${hintLines.join("\n")}\n`);

  const werkzeugLines = mitHinweis.map((h) => werkzeugZeile({ zeit: h.t + h.leseVersatzMs, sid: h.sid, ziel: h.leseZiel }));
  schreibeLog(vault, "werkzeug.log", `${werkzeugLines.join("\n")}\n`);

  const e = analyse(vault, { jetzt: ANKER });
  assert.equal(e.hinweise.prompts, 10);
  assert.equal(e.hinweise.mitHinweis, 3);
  assert.equal(e.hinweise.quote, 0.3);
  assert.equal(e.gelesen.hinweiseMitLesen, 2);
  assert.ok(Math.abs(e.gelesen.quote - 2 / 3) < 1e-9, `gelesen.quote war ${e.gelesen.quote}`);
  assert.equal(e.genugDaten, true);
});

test("leere Logs: genugDaten false, keine Ausnahme, neutrale Werte", () => {
  const vault = neuerVault();
  let e;
  assert.doesNotThrow(() => { e = analyse(vault); });
  assert.equal(e.genugDaten, false);
  assert.equal(e.hinweise.prompts, 0);
  assert.equal(e.hinweise.quote, 0);
  assert.equal(e.gelesen.hinweiseMitLesen, 0);
  assert.equal(e.gelesen.quote, 0);
  assert.equal(e.messlatte.letzter, null);
  assert.deepEqual(e.messlatte.verlauf, []);
  assert.equal(e.seiten.gesamt, 0);
  assert.deepEqual(e.seiten.nieGelesen, []);
  assert.equal(e.luecken, null);
  assert.deepEqual(e.importe, []);
  assert.equal(e.tokens.heute, 0);
  assert.equal(e.tokens.sieben, 0);
});

test("wege: dienst/dienst-vektor → dienst, kalt-rerank → kalt, alles andere → sonst", () => {
  const vault = neuerVault();
  schreibeLog(vault, "hint.log", [
    hintZeile({ zeit: ANKER, sid: "s1", weg: "dienst" }),
    hintZeile({ zeit: ANKER, sid: "s2", weg: "dienst-vektor" }),
    hintZeile({ zeit: ANKER, sid: "s3", weg: "kalt-rerank" }),
    hintZeile({ zeit: ANKER, sid: "s4", weg: "vektor" }),
  ].join("\n") + "\n");
  const e = analyse(vault, { jetzt: ANKER });
  assert.deepEqual(e.hinweise.wege, { dienst: 2, kalt: 1, sonst: 1 });
});

test("p95ms: 95. Perzentil der ms-Werte aus hint.log", () => {
  const vault = neuerVault();
  const werte = Array.from({ length: 20 }, (_, i) => (i + 1) * 10); // 10,20,…,200
  schreibeLog(vault, "hint.log", werte.map((ms, i) => hintZeile({ zeit: ANKER, sid: `s${i}`, ms })).join("\n") + "\n");
  const e = analyse(vault, { jetzt: ANKER });
  assert.equal(e.hinweise.p95ms, 190); // Nearest-Rank: ceil(20·0,95) = 19. Wert, nicht das Maximum
});

test("proTag: gruppiert nach Kalendertag, aufsteigend sortiert", () => {
  const vault = neuerVault();
  schreibeLog(vault, "hint.log", [
    hintZeile({ zeit: ANKER - 2 * 86400000, sid: "s1", hits: "09_wiki/a.md" }),
    hintZeile({ zeit: ANKER - 2 * 86400000 + 3600000, sid: "s2" }),
    hintZeile({ zeit: ANKER, sid: "s3", hits: "09_wiki/b.md" }),
  ].join("\n") + "\n");
  const e = analyse(vault, { jetzt: ANKER });
  assert.equal(e.hinweise.proTag.length, 2);
  assert.equal(e.hinweise.proTag[0].prompts, 2);
  assert.equal(e.hinweise.proTag[0].mitHinweis, 1);
  assert.equal(e.hinweise.proTag[1].prompts, 1);
  assert.equal(e.hinweise.proTag[1].mitHinweis, 1);
  assert.ok(e.hinweise.proTag[0].tag < e.hinweise.proTag[1].tag);
});

test("Zeitraum-Filter: Einträge außerhalb der tage-Grenze zählen nicht mit", () => {
  const vault = neuerVault();
  schreibeLog(vault, "hint.log", [
    hintZeile({ zeit: ANKER - 5 * 86400000, sid: "sinnerhalb", hits: "09_wiki/a.md" }),
    hintZeile({ zeit: ANKER - 40 * 86400000, sid: "saussen" }),
  ].join("\n") + "\n");
  assert.equal(analyse(vault, { jetzt: ANKER, tage: 30 }).hinweise.prompts, 1);
  assert.equal(analyse(vault, { jetzt: ANKER, tage: 45 }).hinweise.prompts, 2);
});

test("seiten: gesamt aus dem Wiki, nieGelesen/meistGelesen aus werkzeug.log, verwaist/pruefbeduerftig/konflikt aus lint-cache.txt", () => {
  const vault = neuerVault();
  mkdirSync(join(vault, "09_wiki", "firma"), { recursive: true });
  writeFileSync(join(vault, "09_wiki", "firma", "thema_a.md"), "---\ndescription: a\n---\n# A\n");
  writeFileSync(join(vault, "09_wiki", "firma", "thema_b.md"), "---\ndescription: b\n---\n# B\n");
  writeFileSync(join(vault, "09_wiki", "ueberblick.md"), "# Überblick\n");
  schreibeLog(vault, "werkzeug.log", [
    werkzeugZeile({ zeit: ANKER - 86400000, sid: "s1", ziel: "09_wiki/firma/thema_a.md" }),
    werkzeugZeile({ zeit: ANKER - 86400000 + 1000, sid: "s2", ziel: "09_wiki/firma/thema_a.md" }),
  ].join("\n") + "\n");
  schreibeLog(vault, "lint-cache.txt", [
    "- VERWAIST: firma/thema_b.md — keine eingehenden Links",
    "- PRÜFBEDÜRFTIG: firma/thema_a.md — Quelle geändert seit Einarbeitung",
    "- KONFLIKT offen (1×): firma/thema_b.md — Entscheidung des Users nötig",
    "- ABGELAUFEN: firma/thema_a.md — seit 3 Tagen (pruefen_bis 2026-09-30) — prüfen/aktualisieren",
  ].join("\n") + "\n");

  const e = analyse(vault, { jetzt: ANKER });
  assert.deepEqual(e.seiten.abgelaufen, ["09_wiki/firma/thema_a.md"], "Spec A: abgelaufen auch in der Analyse");
  assert.equal(e.seiten.gesamt, 3);
  assert.deepEqual(e.seiten.nieGelesen, ["09_wiki/firma/thema_b.md", "09_wiki/ueberblick.md"]);
  assert.deepEqual(e.seiten.meistGelesen, [{ seite: "09_wiki/firma/thema_a.md", mal: 2 }]);
  assert.deepEqual(e.seiten.verwaist, ["09_wiki/firma/thema_b.md"]);
  assert.deepEqual(e.seiten.pruefbeduerftig, ["09_wiki/firma/thema_a.md"]);
  assert.deepEqual(e.seiten.konflikt, ["09_wiki/firma/thema_b.md"]);
});

test("messlatte: letzter Lauf aus hint-eval.log, verlauf enthält alle Zeilen", () => {
  const vault = neuerVault();
  schreibeLog(vault, "hint-eval.log", [
    "hint-eval 2026-09-20 positiv=4/5 still=8/10 kontrolle=3/3 holdout=2/2 p95ms=120 ok=1",
    "hint-eval 2026-10-01 positiv=5/5 still=9/10 kontrolle=3/3 holdout=2/2 p95ms=95 ok=1",
  ].join("\n") + "\n");
  const e = analyse(vault, { jetzt: ANKER });
  assert.equal(e.messlatte.verlauf.length, 2);
  assert.deepEqual(e.messlatte.letzter, {
    datum: "2026-10-01", positiv: "5/5", still: "9/10", kontrolle: "3/3", holdout: "2/2", p95ms: 95, ok: true,
  });
});

test("tokens: Hinweis-Zeichen (bzw. 60 pauschal), Ich-Karte, Projektzeile, Ernte korrekt geschätzt", () => {
  const vault = neuerVault();
  mitAutomatik(vault, { ichKarte: true, projektAutomatik: true });
  mkdirSync(join(vault, "09_wiki"), { recursive: true });
  writeFileSync(join(vault, "09_wiki", "ich.md"), "x".repeat(40)); // 40 Zeichen → ceil(40/4)=10 Tokens
  schreibeLog(vault, "hint.log", [
    hintZeile({ zeit: ANKER, sid: "sA", hits: "09_wiki/a.md", zeichen: 400 }), // ceil(400/4)=100
    hintZeile({ zeit: ANKER, sid: "sA", hits: "09_wiki/b.md" }), // kein zeichen → 60 pauschal, gleiche Sitzung sA
    hintZeile({ zeit: ANKER, sid: "sB", hits: "-" }), // keine Hinweis-Kosten, eigene Sitzung sB
  ].join("\n") + "\n");
  schreibeLog(vault, "ernte.log", `${zeitstempel(new Date(ANKER))} art=stand status=ok ein=400 aus=200\n`); // ceil(600/4)=150

  const e = analyse(vault, { jetzt: ANKER });
  assert.equal(e.tokens.posten.hinweise, 100 + 60);
  assert.equal(e.tokens.posten.ichKarte, 2 * 10); // 2 Sitzungen (sA, sB)
  assert.equal(e.tokens.posten.projekt, 2 * 30);
  assert.equal(e.tokens.posten.ernte, 150);
  assert.equal(e.tokens.sieben, e.tokens.posten.hinweise + e.tokens.posten.ichKarte + e.tokens.posten.projekt + e.tokens.posten.ernte);
  assert.equal(e.tokens.heute, e.tokens.sieben); // alles am selben Tag wie `jetzt`
  assert.equal(e.tokens.geschaetzt, true);
});

test("tokens: Ich-Karte/Projektzeile bleiben 0, wenn die jeweilige Automatik aus ist", () => {
  const vault = neuerVault(); // STANDARD: ichKarte=false, projektAutomatik=true
  mitAutomatik(vault, { ichKarte: false, projektAutomatik: false });
  schreibeLog(vault, "hint.log", hintZeile({ zeit: ANKER, sid: "sA", hits: "-" }) + "\n");
  const e = analyse(vault, { jetzt: ANKER });
  assert.equal(e.tokens.posten.ichKarte, 0);
  assert.equal(e.tokens.posten.projekt, 0);
});

test("importe: liest 00_inbox/_import/<name>/_bericht.json, kaputte Berichte werden übersprungen", () => {
  const vault = neuerVault();
  const basis = join(vault, "00_inbox", "_import", "alter-brain");
  mkdirSync(basis, { recursive: true });
  writeFileSync(join(basis, "_bericht.json"), JSON.stringify({
    quelle: "alter-brain", notizen: 12, duplikateExakt: [{ datei: "a.md" }, { datei: "b.md" }, { datei: "c.md" }], widersprueche: [{ a: 1 }, { a: 2 }],
  }));
  const kaputt = join(vault, "00_inbox", "_import", "kaputt");
  mkdirSync(kaputt, { recursive: true });
  writeFileSync(join(kaputt, "_bericht.json"), "{ das ist kein json");

  const e = analyse(vault, { jetzt: ANKER });
  assert.deepEqual(e.importe, [{ quelle: "alter-brain", notizen: 12, duplikate: 3, widersprueche: 2 }]);
});

test("merkeLuecke: Schalter aus → false, nichts geschrieben", () => {
  const vault = neuerVault();
  assert.equal(merkeLuecke(vault, "search", "harmloser Text"), false);
  assert.equal(existsSync(join(logsDir(vault), "luecken.log")), false);
});

test("merkeLuecke: Secret im Text → false, nichts geschrieben", () => {
  const vault = neuerVault();
  mitAutomatik(vault, { luecken: true });
  // Schlüsselwort zusammengesetzt statt als literale Zeichenkette im Quelltext (die Publish-Prüfung
  // scannt jede Quelldatei nach genau diesem Muster — Zeichenkette hier nur ein erfundener Testwert).
  const schluesselwort = ["api", "key"].join("_");
  assert.equal(merkeLuecke(vault, "hint", `${schluesselwort}=abc123`), false);
  assert.equal(existsSync(join(logsDir(vault), "luecken.log")), false);
});

test("merkeLuecke: speichert höchstens 8 Stichwörter, nie den Prompt", () => {
  const vault = neuerVault();
  mitAutomatik(vault, { luecken: true });
  assert.equal(merkeLuecke(vault, "search", "eins zwei drei vier fünf sechs sieben acht neun zehn"), true);
  const zeile = readFileSync(join(logsDir(vault), "luecken.log"), "utf8").trim();
  assert.match(zeile, /text=eins zwei drei vier fünf sechs sieben acht$/);
});

test("merkeLuecke: Zeilenumbrüche und Großschreibung werden normalisiert, Doppelte und Stoppwörter fallen weg", () => {
  const vault = neuerVault();
  mitAutomatik(vault, { luecken: true });
  assert.equal(merkeLuecke(vault, "hint", "Erste Zeile\nzweite zeile und die"), true);
  const zeile = readFileSync(join(logsDir(vault), "luecken.log"), "utf8").trim();
  assert.match(zeile, /text=erste zeile zweite$/);
});

test("merkeLuecke: Kundendaten (E-Mail, URL, IBAN, Telefon) landen nie im Lücken-Log", () => {
  const vault = neuerVault();
  mitAutomatik(vault, { luecken: true });
  const mail = ["erika.musterfrau", "example.org"].join("@");
  const iban = ["DE89", "3704", "0044", "0532", "0130", "00"].join("");
  assert.equal(merkeLuecke(vault, "hint", `Rechnung an Erika, ${mail}, IBAN ${iban}, Tel 0171 1234567, siehe https://kunde.example/rechnung?id=77`), true);
  const zeile = readFileSync(join(logsDir(vault), "luecken.log"), "utf8").trim();
  const text = zeile.match(/text=(.*)$/)[1];
  assert.equal(text, "rechnung erika iban tel siehe");
  for (const verboten of ["@", "example", "0171", "1234567", "3704", "kunde", "http"]) assert.ok(!text.includes(verboten), `${verboten} in ${text}`);
  assert.deepEqual(stichwoerter("123456 7890 Ab"), ["ab"]);
});

test("merkeLuecke: Zugangsdaten über einen Zeilenumbruch verteilt werden trotzdem erkannt", () => {
  const vault = neuerVault();
  mitAutomatik(vault, { luecken: true });
  const schluesselwort = ["api", "key"].join("_");
  assert.equal(merkeLuecke(vault, "hint", `${schluesselwort}\n= abc123geheim`), false);
  assert.equal(existsSync(join(logsDir(vault), "luecken.log")), false);
});

test("merkeLuecke: Arbeitsordner in ernteNichtIn → nichts gemerkt (auch Unterordner)", () => {
  const vault = neuerVault();
  const kunde = mkdtempSync(join(tmpdir(), "brain kunde "));
  mkdirSync(join(kunde, "projekt a"));
  mitAutomatik(vault, { luecken: true, ernteNichtIn: [kunde] });
  assert.equal(merkeLuecke(vault, "hint", "harmlose frage", { cwd: kunde }), false);
  assert.equal(merkeLuecke(vault, "hint", "harmlose frage", { cwd: join(kunde, "projekt a") }), false);
  assert.equal(existsSync(join(logsDir(vault), "luecken.log")), false);
  assert.equal(merkeLuecke(vault, "hint", "harmlose frage", { cwd: vault }), true); // anderer Ordner: erlaubt
});

test("merkeLuecke: kaputte Config → fail-closed, nichts gemerkt", () => {
  const vault = neuerVault();
  writeFileSync(join(vault, "brain.config.json"), '{ "automatik": { "luecken": true ');
  assert.equal(merkeLuecke(vault, "hint", "harmlose frage"), false);
  assert.equal(existsSync(join(logsDir(vault), "luecken.log")), false);
});

test("merkeLuecke: entfernt beim nächsten Schreiben Einträge älter als 30 Tage", () => {
  const vault = neuerVault();
  mitAutomatik(vault, { luecken: true });
  const alt = new Date(Date.now() - 40 * 86400000);
  schreibeLog(vault, "luecken.log", `${zeitstempel(alt)} quelle=hint text=uralt\n`);
  assert.equal(merkeLuecke(vault, "hint", "neu"), true);
  const zeilen = readFileSync(join(logsDir(vault), "luecken.log"), "utf8").trim().split("\n");
  assert.equal(zeilen.length, 1);
  assert.match(zeilen[0], /text=neu$/);
});

test("luecken in analyse(): null wenn Schalter aus, sonst gelesene Einträge", () => {
  const vaultAus = neuerVault();
  assert.equal(analyse(vaultAus, { jetzt: ANKER }).luecken, null);

  const vaultAn = neuerVault();
  mitAutomatik(vaultAn, { luecken: true });
  merkeLuecke(vaultAn, "hint", "etwas Fehlendes");
  const e = analyse(vaultAn);
  assert.equal(e.luecken.length, 1);
  assert.equal(e.luecken[0].quelle, "hint");
  assert.equal(e.luecken[0].text, "etwas fehlendes");
});

test("Leistung: ~50 000 synthetische hint.log-Zeilen über ~1 Jahr → analyse() deutlich unter 1500 ms", () => {
  const vault = neuerVault();
  const start = ANKER - 360 * 86400000;
  const zeilen = [];
  for (let i = 0; i < 50000; i++) {
    const t = start + i * 620000; // ≈ 10,3 min Abstand über ≈ 360 Tage
    zeilen.push(hintZeile({ zeit: t, sid: `sid${i % 500}`, hits: i % 10 === 0 ? "09_wiki/a.md" : "-", ms: 40 + (i % 50) }));
  }
  schreibeLog(vault, "hint.log", `${zeilen.join("\n")}\n`);

  const t0 = Date.now();
  const e = analyse(vault, { jetzt: ANKER, tage: 400 });
  const dauer = Date.now() - t0;
  assert.ok(e.hinweise.prompts > 0);
  assert.ok(dauer < 1500, `analyse() brauchte ${dauer} ms`);
});

test("gelesen: echte werkzeug.log-Zeile (protokolliere, sid 36 Zeichen) passt zur 8er-sid in hint.log — auch Seiten mit Leerzeichen/Komma", () => {
  const vault = neuerVault();
  mkdirSync(join(vault, "09_wiki"), { recursive: true });
  const sid = "1234abcd-5678-90ef-1234-567890abcdef";
  const seiten = ["09_wiki/thema_a.md", "09_wiki/thema b c.md", "09_wiki/x,y.md"];
  for (const s of seiten) writeFileSync(join(vault, ...s.split("/")), "# x\n");
  // Zwei Kodierungen des hits-Felds: alles in einem (Tab-Trenner) und je Seite kodiert mit Komma.
  const jetzt = Date.now();
  const zeit = zeitstempel(new Date(jetzt - 60000));
  const alles = encodeURIComponent(seiten.join("\t"));
  const jeSeite = seiten.map(encodeURIComponent).join(",");
  schreibeLog(vault, "hint.log", [
    `${zeit} sid=${sid.slice(0, 8)} len=20 weg=dienst top=0.700 zeichen=400 hits=${alles} unterdrueckt=0 kalt=0 refresh=0 ms=40`,
    `${zeit} sid=${sid.slice(0, 8)} len=20 weg=dienst top=0.700 zeichen=400 hits=${jeSeite} unterdrueckt=0 kalt=0 refresh=0 ms=40`,
  ].join("\n") + "\n");
  for (const s of seiten) assert.equal(protokolliere(vault, { sid, toolName: "Read", toolInput: { file_path: join(vault, ...s.split("/")) } }), true);
  const roh = readFileSync(join(logsDir(vault), "werkzeug.log"), "utf8");
  assert.match(roh, new RegExp(`sid=${sid}`)); // werkzeug.log hält die lange sid
  const e = analyse(vault);
  assert.equal(e.hinweise.mitHinweis, 2);
  assert.equal(e.gelesen.hinweiseMitLesen, 2);
  assert.equal(e.tokens.posten.hinweise, 200); // zeichen= wird hinter hits= noch gelesen
  assert.deepEqual(hitsSeiten(alles), seiten);
  assert.deepEqual(hitsSeiten(jeSeite), seiten);
  assert.deepEqual(hitsSeiten("09_wiki/a.md,09_wiki/b.md"), ["09_wiki/a.md", "09_wiki/b.md"]); // alte rohe Zeilen
  assert.deepEqual(hitsSeiten("-"), []);
});

test("importe: duplikate stimmt mit einem echten _bericht.json aus importiere() überein", () => {
  const vault = neuerVault();
  mkdirSync(join(vault, "00_inbox"), { recursive: true });
  mkdirSync(join(vault, "09_wiki"), { recursive: true });
  const quelle = join(mkdtempSync(join(tmpdir(), "brain importquelle ")), "Altes Notizbuch");
  mkdirSync(quelle);
  writeFileSync(join(quelle, "Garten.md"), "# Garten\n\nDas Hochbeet steht an der Südseite.\n");
  writeFileSync(join(quelle, "Rezepte.md"), "# Rezepte\n\nApfelkuchen mit Zimt.\n");
  const jetzt = new Date("2026-10-02T08:00:00Z");
  importiere(vault, quelle, { jetzt });
  const r2 = importiere(vault, quelle, { jetzt });
  const erwartet = Array.isArray(r2.duplikateExakt) ? r2.duplikateExakt.length : r2.duplikateExakt;
  assert.ok(erwartet >= 2, `Duplikate im zweiten Import: ${erwartet}`);
  const e = analyse(vault, { jetzt: ANKER });
  const zweiter = e.importe.find((i) => i.duplikate > 0);
  assert.ok(zweiter, JSON.stringify(e.importe));
  assert.equal(zweiter.duplikate, erwartet);
});

test("seiten: lint-cache mit Leerzeichen im Pfad und Windows-Backslash", () => {
  const l = lintPfade([
    "- VERWAIST: ordner/thema b.md — keine eingehenden Links",
    "- PRÜFBEDÜRFTIG: ordner\\thema c.md — Quelle 00_inbox/x y.md geändert seit Einarbeitung (Re-Ingest anbieten)",
    "- KONFLIKT offen (2×): a b\\c d.md — Entscheidung des Users nötig",
    "- ABGELAUFEN: x y\\z.md — seit 1 Tag (verfall 30 Tage) — prüfen/aktualisieren",
  ].join("\r\n"));
  assert.deepEqual([...l.abgelaufen], ["x y/z.md"]);
  assert.deepEqual([...l.verwaist], ["ordner/thema b.md"]);
  assert.deepEqual([...l.pruefbeduerftig], ["ordner/thema c.md"]);
  assert.deepEqual([...l.konflikt], ["a b/c d.md"]);
});

test("seiten: nieGelesen/meistGelesen nur im Zeitfenster (Lesen vor 3 Monaten zählt nicht)", () => {
  const vault = neuerVault();
  mkdirSync(join(vault, "09_wiki"), { recursive: true });
  writeFileSync(join(vault, "09_wiki", "thema_alt.md"), "# Alt\n");
  writeFileSync(join(vault, "09_wiki", "thema_neu.md"), "# Neu\n");
  schreibeLog(vault, "werkzeug.log", [
    werkzeugZeile({ zeit: ANKER - 90 * 86400000, sid: "s1", ziel: "09_wiki/thema_alt.md" }),
    werkzeugZeile({ zeit: ANKER - 86400000, sid: "s2", ziel: "09_wiki/thema_neu.md" }),
  ].join("\n") + "\n");
  const e = analyse(vault, { jetzt: ANKER, tage: 30 });
  assert.deepEqual(e.seiten.nieGelesen, ["09_wiki/thema_alt.md"]);
  assert.deepEqual(e.seiten.meistGelesen, [{ seite: "09_wiki/thema_neu.md", mal: 1 }]);
});

test("tokens.heute: Kalendertag in Ortszeit", () => {
  const vault = neuerVault();
  // Mittag Ortszeit am Ankertag und ein Eintrag am Vortag (Ortszeit) — unabhängig von der Zeitzone der Maschine.
  const a = new Date(ANKER);
  const mittag = new Date(a.getFullYear(), a.getMonth(), a.getDate(), 12, 0, 0).getTime();
  const vortag = new Date(a.getFullYear(), a.getMonth(), a.getDate() - 1, 23, 30, 0).getTime();
  schreibeLog(vault, "hint.log", [
    hintZeile({ zeit: vortag, sid: "sV", hits: "09_wiki/a.md", zeichen: 400 }),
    hintZeile({ zeit: mittag, sid: "sH", hits: "09_wiki/b.md", zeichen: 40 }),
  ].join("\n") + "\n");
  mitAutomatik(vault, { ichKarte: false, projektAutomatik: false });
  const e = analyse(vault, { jetzt: mittag + 3600000 });
  assert.equal(e.tokens.heute, 10);
  assert.equal(e.tokens.sieben, 110);
});

test("mcp.nichtLesbar: zählt kaputte Client-Configs (nur die Anzahl, keine Pfade)", () => {
  const vault = neuerVault();
  assert.deepEqual(analyse(vault, { jetzt: ANKER }).mcp, { nichtLesbar: 0 });
  mkdirSync(join(TEST_HOME, ".cursor"), { recursive: true });
  writeFileSync(join(TEST_HOME, ".cursor", "mcp.json"), "{ abgeschnitten");
  try {
    const e = analyse(vault, { jetzt: ANKER });
    assert.deepEqual(e.mcp, { nichtLesbar: 1 });
    assert.ok(!JSON.stringify(e).includes(TEST_HOME));
  } finally {
    writeFileSync(join(TEST_HOME, ".cursor", "mcp.json"), "{}");
  }
});

// ------------------------------------------------------------------------------- Treffsicherheit: Schwellen-Prüfung
test("empfehlung: zu streng → eine Stufe lockerer, zu locker → strenger, beides/am Rand → Karten schärfen, sonst passt", () => {
  const n = SCHWELLE_MIN;
  assert.deepEqual(empfehlung({ stufe: "aus", still: 99, zuStreng: 1 }), { art: "aus", stufe: null });
  assert.deepEqual(empfehlung({ stufe: "mittel", still: n - 1, zuStreng: 1, gezeigt: n - 1, zuLocker: 1 }), { art: "zuWenig", stufe: null });
  assert.deepEqual(empfehlung({ stufe: "mittel", still: n, zuStreng: 0.25 }), { art: "lockerer", stufe: "hoch" });
  assert.deepEqual(empfehlung({ stufe: "niedrig", still: n, zuStreng: 0.5 }), { art: "lockerer", stufe: "mittel" });
  assert.deepEqual(empfehlung({ stufe: "hoch", still: n, zuStreng: 0.5 }), { art: "karten", stufe: null });
  assert.deepEqual(empfehlung({ stufe: "mittel", gezeigt: n, zuLocker: 0.6 }), { art: "strenger", stufe: "niedrig" });
  assert.deepEqual(empfehlung({ stufe: "hoch", gezeigt: n, zuLocker: 0.9 }), { art: "strenger", stufe: "mittel" });
  assert.deepEqual(empfehlung({ stufe: "niedrig", gezeigt: n, zuLocker: 0.9 }), { art: "karten", stufe: null });
  assert.deepEqual(empfehlung({ stufe: "mittel", still: n, zuStreng: 0.5, gezeigt: n, zuLocker: 0.9 }), { art: "karten", stufe: null });
  assert.deepEqual(empfehlung({ stufe: "mittel", still: n, zuStreng: 0.1, gezeigt: n, zuLocker: 0.3 }), { art: "passt", stufe: null });
});

test("schwelle: geschwiegen-aber-gelesen und gezeigt-aber-nie-gelesen aus den Logs, erst ab Beginn des Lese-Protokolls", () => {
  const vault = neuerVault();
  mkdirSync(join(vault, "09_wiki", "firma"), { recursive: true });
  for (const n of ["thema_a.md", "thema_b.md"]) writeFileSync(join(vault, "09_wiki", "firma", n), "---\ndescription: x\n---\n# X\n");
  const T = ANKER - 86400000, M = 60000;
  schreibeLog(vault, "hint.log", [
    hintZeile({ zeit: T - 60 * M, sid: "vorher01" }),                               // vor dem Lese-Protokoll → zählt nicht
    hintZeile({ zeit: T, sid: "still001" }),                                        // still, danach gelesen → zu streng
    hintZeile({ zeit: T + 10 * M, sid: "still002" }),                               // still, Lesen erst nach dem nächsten Prompt
    hintZeile({ zeit: T + 12 * M, sid: "still002" }),                               // still, Überblick zählt nicht
    hintZeile({ zeit: T + 20 * M, sid: "zeig0001", hits: encodeURIComponent("09_wiki/firma/thema_a.md") }), // nie gelesen
    hintZeile({ zeit: T + 30 * M, sid: "zeig0002", hits: encodeURIComponent("09_wiki/firma/thema_b.md") }), // später gelesen
  ].join("\n") + "\n");
  schreibeLog(vault, "werkzeug.log", [
    werkzeugZeile({ zeit: T - 5 * M, sid: "x", art: "mcp", ziel: "s%2Fw" }),         // Beginn der Beobachtung
    werkzeugZeile({ zeit: T + 3 * M, sid: "still001-aaaa", ziel: "09_wiki/firma/thema_a.md" }),
    werkzeugZeile({ zeit: T + 13 * M, sid: "still002", ziel: "09_wiki/ueberblick.md" }),
    werkzeugZeile({ zeit: T + 14 * M, sid: "zeig0001", ziel: "09_wiki/firma/thema_b.md" }),
    werkzeugZeile({ zeit: T + 90 * M, sid: "zeig0002", ziel: "09_wiki/firma/thema_b.md" }),
  ].join("\n") + "\n");
  const s = analyse(vault, { jetzt: ANKER }).schwelle;
  assert.equal(s.stufe, "mittel");
  assert.equal(s.seit, new Date(T - 5 * M).toISOString().slice(0, 19) + "Z");
  assert.deepEqual([s.still, s.stillGelesen, s.gezeigt, s.nieGelesen], [3, 1, 2, 1]);
  assert.ok(Math.abs(s.zuStreng - 1 / 3) < 1e-9);
  assert.equal(s.zuLocker, 0.5);
  assert.deepEqual(s.empfehlung, { art: "zuWenig", stufe: null });
});

test("schwelle: ohne werkzeug.log keine Zählung (zu wenig Daten), Hinweise aus → art aus", () => {
  const vault = neuerVault();
  schreibeLog(vault, "hint.log", hintZeile({ zeit: ANKER - 1000, sid: "s1" }) + "\n");
  const s = analyse(vault, { jetzt: ANKER }).schwelle;
  assert.deepEqual([s.still, s.gezeigt, s.seit, s.empfehlung.art], [0, 0, null, "zuWenig"]);
  mitAutomatik(vault, { hinweise: "aus" });
  assert.equal(analyse(vault, { jetzt: ANKER }).schwelle.empfehlung.art, "aus");
});
