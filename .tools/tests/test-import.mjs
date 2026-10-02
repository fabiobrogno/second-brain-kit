// .tools/tests/test-import.mjs — Import alter Brains: Erkennung, Kopie (Quelle bytegleich, nichts außerhalb des Ziels),
// Duplikate, Fast-Duplikate, Widersprüche (auch gegen das Wiki), Begleitdatei ohne absoluten Pfad, Bilder nur verlinkt,
// Rückfrage ab 2000 Notizen, Zip (Notion, Zip64), CLI und Leistung (5000 Notizen).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, lstatSync, existsSync, utimesSync,
} from "node:fs";
import { kopiereBaum } from "./kopiere-baum.mjs";
import { join, relative, sep, dirname } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { importiere, normName } from "../import/import.mjs";
import { erkenneArt } from "../import/erkennen.mjs";
import { aehnlichkeit, findeGruppen } from "../import/aehnlich.mjs";
import { vergleicheNotizen } from "../import/widerspruch.mjs";
import { baueZip, leseZip, ZipFehler } from "../import/zip.mjs";
import { minisuche } from "../minisuche.mjs";

const HIER = dirname(fileURLToPath(import.meta.url));
const FIX = join(HIER, "fixture-import");
const SKRIPT = join(HIER, "..", "import", "import.mjs");
const JETZT = new Date("2026-10-02T08:00:00Z");
const PNG = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000", "hex");

const temp = (p = "brain import ") => mkdtempSync(join(tmpdir(), p));
const rel = (basis, voll) => relative(basis, voll).split(sep).join("/");

function hashBaum(dir) {
  const out = {};
  const lauf = (d) => {
    for (const n of readdirSync(d)) {
      const f = join(d, n), st = lstatSync(f);
      if (st.isDirectory()) lauf(f);
      else out[rel(dir, f)] = createHash("sha256").update(readFileSync(f)).digest("hex");
    }
  };
  if (existsSync(dir)) lauf(dir);
  return out;
}

function neuesVault() {
  const v = join(temp("brain vault "), "Mein Brain, Ü's");
  mkdirSync(join(v, "09_wiki"), { recursive: true });
  mkdirSync(join(v, "30_wissen"), { recursive: true });
  mkdirSync(join(v, "00_inbox"), { recursive: true });
  writeFileSync(join(v, "brain.config.json"), JSON.stringify({ wiki: { ordner: "09_wiki" } }, null, 2) + "\n");
  kopiereBaum(join(FIX, "wiki", "thema_gartenplan.md"), join(v, "09_wiki", "thema_gartenplan.md"));
  // Exaktes Duplikat im bestehenden Brain (anderer Name, gleicher Inhalt).
  kopiereBaum(join(FIX, "obsidian", "Garten", "Kompost.md"), join(v, "30_wissen", "kompost.md"));
  return v;
}

// Die Obsidian-Quelle: Fixture + im Test erzeugte Teile (CRLF/BOM-Duplikat, Bilder, PDF, Riesendatei, Datumsstände).
let QUELLE = null;
function obsidianQuelle() {
  if (QUELLE) return QUELLE;
  const q = join(temp(), "Mein altes Brain, Küche's");
  kopiereBaum(join(FIX, "obsidian"), q);
  // Ohne .gitattributes im Kit checkt Git unter Windows (autocrlf) die Fixture mit CRLF aus — erst auf LF
  // bringen, sonst entstünde aus "\r\n" → "\r  \r\n" eine echte Zusatz-Leerzeile statt nur anderer Zeilenenden.
  const brot = readFileSync(join(q, "Rezepte und Küche", "Brotteig.md"), "utf8").replace(/\r\n/g, "\n");
  writeFileSync(join(q, "Rezepte und Küche", "Brotteig (Windows).md"), "\uFEFF" + brot.replace(/\n/g, "  \r\n"));
  mkdirSync(join(q, "Anhänge"), { recursive: true });   // leerer Ordner kommt nicht durch git
  writeFileSync(join(q, "Anhänge", "foto-suppe.png"), PNG);
  writeFileSync(join(q, "Anhänge", "karte föhr.jpg"), PNG);
  writeFileSync(join(q, "Anhänge", "unbenutzt.png"), PNG);
  writeFileSync(join(q, "Technik", "Handbuch Fahrradlampe.pdf"), "%PDF-1.4\n% erfundenes Handbuch\n%%EOF\n");
  writeFileSync(join(q, "Technik", "riesig.txt"), "x".repeat(5 * 1024 * 1024 + 10));
  writeFileSync(join(q, "Technik", "werkzeug.exe"), Buffer.from([0x4d, 0x5a, 0, 0, 1, 2, 3]));
  utimesSync(join(q, "Reisen", "Radtour Bodensee.md"), new Date("2025-02-01T10:00:00"), new Date("2025-02-01T10:00:00"));
  utimesSync(join(q, "Fahrrad", "Radtour Bodensee.md"), new Date("2025-03-10T10:00:00"), new Date("2025-03-10T10:00:00"));
  QUELLE = q;
  return q;
}

function notizenOrdner(anzahl, { start = 0 } = {}) {
  const q = join(temp(), "Viele Notizen");
  const woerter = "apfel birne kirsche pflaume garten beet spaten rechen fahrrad kette sattel lenker reise koffer zug fähre "
    + "berg see wald wiese suppe brot kuchen teig ofen pfanne topf messer gabel löffel tasse kanne brille buch regal "
    + "lampe kerze decke kissen sofa stuhl tisch fenster blume rose tulpe veilchen moos stein sand kies wolke regen";
  const w = woerter.split(" ");
  let s = 12345;
  const zufall = () => { s = (Math.imul(s, 1103515245) + 12345) >>> 0; return s >>> 8; };
  for (let i = start; i < start + anzahl; i++) {
    const ordner = join(q, `bereich-${i % 7}`);
    mkdirSync(ordner, { recursive: true });
    const satz = Array.from({ length: 90 }, () => w[zufall() % w.length]).join(" ");
    writeFileSync(join(ordner, `notiz-${i}.md`), `# Notiz ${i}\n\nNummer ${i}: ${satz}.\n`);
  }
  return q;
}

test("erkenneArt: Obsidian, Logseq, Notion (Zip), Ordner", () => {
  assert.equal(erkenneArt(obsidianQuelle()), "obsidian");
  assert.equal(erkenneArt(join(FIX, "logseq")), "logseq");
  const z = join(temp(), "Export Notion.zip");
  writeFileSync(z, baueZip([{ name: "Export/Reiseplanung 0123456789abcdef0123456789abcdef.md", daten: "# Reiseplanung\n" }]));
  assert.equal(erkenneArt(z), "notion");
  const o = join(temp(), "Notizen");
  mkdirSync(o);
  writeFileSync(join(o, "einkauf.md"), "# Einkauf\n");
  assert.equal(erkenneArt(o), "ordner");
  assert.throws(() => erkenneArt(join(o, "gibt-es-nicht")), /gibt es nicht/);
});

test("aehnlichkeit: gleich → 1, fremd → 0, Fast-Duplikat ≥ 0,8", () => {
  const a = "eins zwei drei vier fünf sechs sieben acht neun zehn elf zwölf";
  assert.equal(aehnlichkeit(a, a), 1);
  assert.equal(aehnlichkeit(a, "ganz andere wörter ohne jede überschneidung hier"), 0);
  const t = readFileSync(join(FIX, "obsidian", "Garten", "Tomaten pflanzen.md"), "utf8");
  const k = readFileSync(join(FIX, "obsidian", "Garten", "Tomaten pflanzen (Kopie).md"), "utf8");
  assert.ok(aehnlichkeit(t, k) >= 0.8, `Ähnlichkeit ${aehnlichkeit(t, k)}`);
  const g = findeGruppen([{ id: "a", text: t }, { id: "b", text: k }, { id: "c", text: a }]);
  assert.deepEqual(g.map(x => x.dateien), [["a", "b"]]);
});

test("normName: [a-z0-9-], Umlaute ausgeschrieben", () => {
  assert.equal(normName("Mein altes Brain, Küche's"), "mein-altes-brain-kueche-s");
  assert.equal(normName("Ölmühle/../Straße"), "oelmuehle-strasse");
  assert.equal(normName("..."), "import");
});

test("importiere Obsidian: Quelle bytegleich, nur Ziel beschrieben, Duplikate, Gruppen, Widersprüche, Bericht", () => {
  const q = obsidianQuelle(), v = neuesVault();
  const quelleVorher = hashBaum(q), vaultVorher = hashBaum(v);
  const r = importiere(v, q, { jetzt: JETZT });

  assert.equal(r.status, "ok");
  assert.equal(r.art, "obsidian");
  assert.equal(r.name, "mein-altes-brain-kueche-s");
  assert.equal(r.ziel, "00_inbox/_import/mein-altes-brain-kueche-s");
  assert.deepEqual(hashBaum(q), quelleVorher, "Quelle verändert");

  // Nichts außerhalb des Ziels geschrieben oder verändert.
  const nachher = hashBaum(v);
  for (const [f, h] of Object.entries(vaultVorher)) assert.equal(nachher[f], h, `verändert: ${f}`);
  for (const f of Object.keys(nachher)) if (!(f in vaultVorher)) assert.ok(f.startsWith(r.ziel + "/"), `außerhalb geschrieben: ${f}`);

  const Z = join(v, ...r.ziel.split("/"));
  const da = (p) => existsSync(join(Z, ...p.split("/")));
  // Exakte Duplikate: im Import (LF und CRLF/BOM) und gegen das Brain — nicht kopiert, aber gelistet.
  const dup = r.duplikateExakt.map(d => [d.datei, d.gleichWie, d.ort].join(" | ")).sort();
  assert.equal(dup.length, 3, dup.join("\n"));
  assert.ok(dup.includes("Garten/Kompost.md | 30_wissen/kompost.md | brain"));
  assert.ok(r.duplikateExakt.some(d => [d.datei, d.gleichWie].sort().join() === ["Archiv alt/Packliste Kopie.md", "Reisen/Packliste.md"].sort().join()));
  assert.ok(r.duplikateExakt.some(d => [d.datei, d.gleichWie].sort().join() === ["Rezepte und Küche/Brotteig (Windows).md", "Rezepte und Küche/Brotteig.md"].sort().join()));
  for (const d of r.duplikateExakt) assert.ok(!da(d.datei), `Duplikat kopiert: ${d.datei}`);
  assert.ok(!da("Garten/Kompost.md"));

  // Fast-Duplikate.
  assert.deepEqual(r.gruppen.map(g => g.dateien), [["Garten/Tomaten pflanzen (Kopie).md", "Garten/Tomaten pflanzen.md"]]);

  // Genau die drei Widersprüche — keiner zwischen den Reifendruck-Notizen (verschiedene Sachen).
  assert.equal(r.widersprueche.length, 3, JSON.stringify(r.widersprueche, null, 1));
  const art = (a) => r.widersprueche.find(w => w.art === a);
  assert.match(art("zahl").a.satz + art("zahl").b.satz, /49 €.*59 €|59 €.*49 €/);
  const d = art("datum");
  assert.match(d.a.satz + d.b.satz, /01\.03\.2025.*15\.03\.2025|15\.03\.2025.*01\.03\.2025/);
  assert.equal(d[d.neuer].datei, "Fahrrad/Radtour Bodensee.md");
  assert.match(art("jaNein").a.satz + art("jaNein").b.satz, /aktiv.*aus|aus.*aktiv/);
  assert.ok(!r.widersprueche.some(w => /Reifendruck/.test(w.a.datei + w.b.datei)));

  // Überschneidung mit dem Wiki: über den Namen (Gartenplan) und über das Link-Ziel (Willkommen verlinkt [[Gartenplan]]).
  assert.deepEqual(r.ueberschneidungen.map(u => [u.datei, u.seite, u.ueber]), [
    ["Garten/Gartenplan.md", "09_wiki/thema_gartenplan.md", "name"], ["Willkommen.md", "09_wiki/thema_gartenplan.md", "link"]]);

  // Kopie: Struktur, Umlaute, Leerzeichen; Bilder nur verlinkt; Auslassungen.
  for (const p of ["Reisen/Fähre nach Föhr.md", "Rezepte und Küche/Gemüsesuppe.md", "Technik/Notizen zum Drucker.txt",
    "Technik/Handbuch Fahrradlampe.pdf", "Anhänge/foto-suppe.png", "Anhänge/karte föhr.jpg", "Willkommen.md"]) assert.ok(da(p), `fehlt: ${p}`);
  for (const p of ["Anhänge/unbenutzt.png", ".obsidian/app.json", ".trash/Alter Einkaufszettel.md", "Technik/riesig.txt", "Technik/werkzeug.exe"]) {
    assert.ok(!da(p), `kopiert, obwohl ausgelassen: ${p}`);
  }
  assert.equal(readFileSync(join(Z, "Reisen", "Fähre nach Föhr.md"), "utf8"),
    readFileSync(join(q, "Reisen", "Fähre nach Föhr.md"), "utf8"), "Inhalt nicht bytegleich");

  // Begleitdatei ohne absoluten Pfad.
  const begleitRoh = readFileSync(join(Z, "_import.json"), "utf8");
  const begleit = JSON.parse(begleitRoh);
  assert.equal(begleit.art, "obsidian");
  assert.equal(begleit.quelle, "Mein altes Brain, Küche's");
  assert.equal(begleit.importiert, JETZT.toISOString());
  for (const s of [q, dirname(q), v, tmpdir(), q.split(sep).join("/")]) assert.ok(!begleitRoh.includes(s), "absoluter Pfad in _import.json");
  const willkommen = begleit.dateien.find(f => f.rel === "Willkommen.md");
  assert.deepEqual(willkommen.links.sort(), ["Gartenplan", "Kochkurs Pasta"]);
  assert.match(willkommen.sha, /^[0-9a-f]{64}$/);
  assert.deepEqual(begleit.dateien.find(f => f.rel === "Archiv alt/Pasta-Kurs.md").aliase, ["Kochkurs Pasta"]);
  assert.equal(begleit.dateien.length, r.kopiert);

  // Bericht.
  const bericht = JSON.parse(readFileSync(join(Z, "_bericht.json"), "utf8"));
  assert.equal(bericht.widersprueche.length, 3);
  // analyse.mjs liest duplikateExakt als Anzahl; die Liste steht daneben.
  assert.equal(bericht.duplikateExakt, 3);
  assert.equal(bericht.duplikateExaktListe.length, 3);
  assert.equal(bericht.pdfs, 1);
  assert.ok(!readFileSync(join(Z, "_bericht.json"), "utf8").includes(dirname(q)));
  const md = readFileSync(join(Z, "_bericht.md"), "utf8");
  assert.match(md, /Mögliche Widersprüche/);
  assert.match(md, /ergänzt Seite `09_wiki\/thema_gartenplan\.md`/);
  assert.match(md, /`Willkommen\.md` verweist auf Seite `09_wiki\/thema_gartenplan\.md`/);
  assert.match(md, /3 exakte Duplikate übersprungen/);
  assert.match(md, /schon im Brain/);
  assert.ok(r.pakete.some(p => p.name === "Garten" && p.tokenSchaetzung === Math.ceil(p.zeichen / 4 * 1.6)));
  assert.equal(r.tokenSchaetzung, r.pakete.reduce((s, p) => s + p.tokenSchaetzung, 0));

  // Sofort auffindbar per minisuche.
  const treffer = minisuche(v, "Fähre Dagebüll", 3);
  assert.equal(treffer[0]?.pfad, `${r.ziel}/Reisen/Fähre nach Föhr.md`);

  // Zweiter Import derselben Quelle → eigenes Ziel mit -2; alles Notizen sind jetzt Duplikate gegen das Brain.
  const r2 = importiere(v, q, { jetzt: JETZT });
  assert.equal(r2.name, "mein-altes-brain-kueche-s-2");
  assert.ok(r2.duplikateExakt.filter(d => d.ort === "brain").length >= 15);
});

test("Widerspruch gegen das bestehende Wiki; keine falschen bei verschiedenen Sachen", () => {
  const v = neuesVault();
  const q = join(temp(), "Garten alt");
  mkdirSync(q);
  writeFileSync(join(q, "Gartenplan.md"), "# Gartenplan\n\nDas Hochbeet steht an der Südseite. Die Beete werden am 20.04.2025 bepflanzt.\n");
  writeFileSync(join(v, "09_wiki", "thema_gartenplan.md"),
    readFileSync(join(FIX, "wiki", "thema_gartenplan.md"), "utf8") + "Die Beete werden am 12.04.2025 bepflanzt.\n");
  writeFileSync(join(q, "Teich.md"), "# Teich\n\nDie Pumpe im Teich läuft 6 Stunden am Tag.\n");
  writeFileSync(join(q, "Brunnen.md"), "# Brunnen\n\nDie Pumpe im Brunnen läuft 2 Stunden am Tag.\n");
  const r = importiere(v, q, { jetzt: JETZT });
  assert.equal(r.widersprueche.length, 1, JSON.stringify(r.widersprueche));
  const w = r.widersprueche[0];
  assert.equal(w.art, "datum");
  assert.equal(w.a.datei, "Gartenplan.md");
  assert.equal(w.b.datei, "09_wiki/thema_gartenplan.md");
  assert.equal(w.b.ort, "brain");
  // Direkter Vergleich: Ja/Nein und Versionen.
  const vgl = (x, y) => vergleicheNotizen({ datei: "a", text: x, datum: "2025-01-01" }, { datei: "b", text: y, datum: "2025-02-01" });
  assert.equal(vgl("Die Nachtabsenkung der Heizung ist aktiv.", "Die Nachtabsenkung der Heizung ist inaktiv.")[0]?.art, "jaNein");
  assert.equal(vgl("Die Wetterstation läuft mit Firmware v1.2.0.", "Die Wetterstation läuft mit Firmware v1.3.0.")[0]?.neuer, "b");
  assert.deepEqual(vgl("Die Wetterstation misst 5 Werte.", "Die Wetterstation misst 5 Werte."), []);
  assert.deepEqual(vgl("Der Kuchen braucht 200 Gramm Zucker.", "Das Fahrrad wiegt 12 Kilogramm."), []);
});

test("Zugangsdaten: Notiz wird NICHT kopiert, Bericht nennt nur den Pfad, nie den Inhalt", () => {
  const v = neuesVault();
  const q = join(temp(), "Technik alt");
  mkdirSync(q);
  const geheim = "api" + "_key=" + "wolke7zebra";
  writeFileSync(join(q, "Router.md"), `# Router\n\nDer Router nutzt ${geheim} und startet um 3 Uhr neu.\n`);
  mkdirSync(join(q, "alt"));
  writeFileSync(join(q, "alt", "Router.md"), `# Router\n\nDer Router nutzt ${geheim} und startet um 4 Uhr neu.\n`);
  writeFileSync(join(q, "Drucker.md"), "# Drucker\n\nDer Drucker steht im Flur.\n");
  const r = importiere(v, q, { jetzt: JETZT });
  assert.deepEqual(r.secretsIn.sort(), ["Router.md", "alt/Router.md"]);
  assert.equal(r.notizen, 3);
  assert.equal(r.widersprueche.length, 0, "nicht übernommene Notizen dürfen nicht verglichen werden");
  const Z = join(v, ...r.ziel.split("/"));
  assert.ok(!existsSync(join(Z, "Router.md")) && !existsSync(join(Z, "alt", "Router.md")), "Notiz mit Zugangsdaten kopiert");
  assert.ok(existsSync(join(Z, "Drucker.md")));
  for (const f of ["_bericht.md", "_bericht.json", "_import.json"]) assert.ok(!readFileSync(join(Z, f), "utf8").includes("wolke7zebra"), f);
  const md = readFileSync(join(Z, "_bericht.md"), "utf8");
  assert.match(md, /Nicht importiert — enthält vermutlich Zugangsdaten/);
  assert.match(md, /`Router\.md` \(Zeile 3\)/);
  assert.match(md, /2 Notizen wegen Zugangsdaten nicht übernommen/);
  const bericht = JSON.parse(readFileSync(join(Z, "_bericht.json"), "utf8"));
  assert.ok(bericht.ausgelassen.some(a => a.rel === "Router.md" && /nicht importiert — enthält vermutlich Zugangsdaten/.test(a.grund)));
  // Erneuter Import nach dem Bereinigen der Quelle: nur die bereinigte Notiz kommt dazu.
  writeFileSync(join(q, "Router.md"), "# Router\n\nDer Router startet um 3 Uhr neu.\n");
  const r2 = importiere(v, q, { jetzt: JETZT });
  assert.deepEqual(r2.secretsIn, ["alt/Router.md"]);
  assert.ok(existsSync(join(v, ...r2.ziel.split("/"), "Router.md")));
  assert.ok(r2.duplikateExakt.some(d => d.datei === "Drucker.md" && d.ort === "brain"));
});

test("ab 2000 Notizen: erst Rückfrage (nichts kopiert), mit bestaetigt kopiert", () => {
  const v = neuesVault(), q = notizenOrdner(2001);
  const vorher = hashBaum(v);
  const r = importiere(v, q, { jetzt: JETZT });
  assert.equal(r.status, "bestaetigen");
  assert.equal(r.notizen, 2001);
  assert.equal(r.kopiert, 0);
  assert.ok(r.tokenSchaetzung > 0);
  assert.deepEqual(hashBaum(v), vorher, "bei Rückfrage geschrieben");
  assert.ok(!existsSync(join(v, "00_inbox", "_import")));
  const r2 = importiere(v, q, { bestaetigt: true, jetzt: JETZT });
  assert.equal(r2.status, "ok");
  assert.equal(r2.kopiert, 2001);
});

test("Zip: Notion-Export (Store + Deflate) importiert; Zip64 und verschlüsselt → klare Meldung", () => {
  const H = "0123456789abcdef0123456789abcdef", H2 = "fedcba9876543210fedcba9876543210";
  const z = join(temp(), "Notion Export.zip");
  writeFileSync(z, baueZip([
    { name: `Export/Reiseplanung ${H}.md`, daten: `# Reiseplanung\n\nSiehe [Packliste](Reiseplanung%20${H}/Packliste%20${H2}.md).\n![Karte](Reiseplanung%20${H}/karte.png)\n` },
    { name: `Export/Reiseplanung ${H}/Packliste ${H2}.md`, daten: "# Packliste\n\nZelt, Isomatte und Kocher einpacken. ".repeat(20), komprimiert: true },
    { name: `Export/Reiseplanung ${H}/karte.png`, daten: PNG },
    { name: `Export/Reiseplanung ${H}/unbenutzt.png`, daten: PNG },
    { name: "Export/Aufgaben " + H2 + ".csv", daten: "Name,Status\nZelt kaufen,erledigt\n" },
    { name: "../ausbruch.md", daten: "# nie\n" },
    { name: "Export/Frage: wohin?.md", daten: "# Frage\n\nWohin geht die nächste Reise?\n" },
  ]));
  assert.equal(leseZip(readFileSync(z)).length, 7);
  const v = neuesVault();
  const vorher = hashBaum(v);
  const r = importiere(v, z, { jetzt: JETZT });
  assert.equal(r.art, "notion");
  assert.equal(r.name, "notion-export");
  const Z = join(v, ...r.ziel.split("/"));
  assert.ok(existsSync(join(Z, "Export", `Reiseplanung ${H}`, `Packliste ${H2}.md`)));
  assert.ok(existsSync(join(Z, "Export", `Reiseplanung ${H}`, "karte.png")));
  assert.ok(!existsSync(join(Z, "Export", `Reiseplanung ${H}`, "unbenutzt.png")));
  assert.ok(existsSync(join(Z, "Export", `Aufgaben ${H2}.csv`)));
  assert.ok(existsSync(join(Z, "Export", "Frage_ wohin_.md")), "Name nicht plattformfest bereinigt");
  assert.ok(!existsSync(join(Z, "..", "ausbruch.md")) && !existsSync(join(Z, "ausbruch.md")));
  for (const f of Object.keys(hashBaum(v))) if (!(f in vorher)) assert.ok(f.startsWith(r.ziel + "/"), `außerhalb: ${f}`);
  const begleit = JSON.parse(readFileSync(join(Z, "_import.json"), "utf8"));
  assert.equal(begleit.quelle, "Notion Export");
  const reise = begleit.dateien.find(f => f.rel === `Export/Reiseplanung ${H}.md`);
  assert.equal(reise.titel, "Reiseplanung");
  assert.deepEqual(reise.links, [`Reiseplanung ${H}/Packliste ${H2}.md`]);

  // Zip64: Locator vor dem Ende-Satz und 0xFFFF-Zähler.
  const z64 = Buffer.alloc(56 + 20 + 22);
  z64.writeUInt32LE(0x06064b50, 0);
  z64.writeUInt32LE(0x07064b50, 56);
  const e = 76;
  z64.writeUInt32LE(0x06054b50, e); z64.writeUInt16LE(0xffff, e + 8); z64.writeUInt16LE(0xffff, e + 10);
  z64.writeUInt32LE(0xffffffff, e + 12); z64.writeUInt32LE(0xffffffff, e + 16);
  const p64 = join(temp(), "gross.zip");
  writeFileSync(p64, z64);
  assert.throws(() => importiere(v, p64), (err) => err instanceof ZipFehler && /Zip64/.test(err.message) && /bitte entpacken und den Ordner importieren/.test(err.message));

  // Verschlüsselt: Bit 0 im zentralen Verzeichnis gesetzt.
  const enc = baueZip([{ name: "geheim.md", daten: "# Tagebuch\n" }]);
  const zd = enc.readUInt32LE(enc.length - 22 + 16);
  enc.writeUInt16LE(enc.readUInt16LE(zd + 8) | 1, zd + 8);
  assert.throws(() => leseZip(enc), /verschlüsselt.*bitte entpacken/);
});

test("Quelle, die das Brain enthält, wird abgelehnt; Logseq-Titel und Aliase", () => {
  const v = neuesVault();
  assert.throws(() => importiere(v, dirname(v)), /enthält dieses Brain/);
  const r = importiere(v, join(FIX, "logseq"), { name: "Werkstatt Notizen", jetzt: JETZT });
  assert.equal(r.art, "logseq");
  assert.equal(r.name, "werkstatt-notizen");
  const begleit = JSON.parse(readFileSync(join(v, ...r.ziel.split("/"), "_import.json"), "utf8"));
  const seite = begleit.dateien.find(f => f.rel === "pages/Fahrradwerkstatt.md");
  assert.equal(seite.titel, "Fahrradwerkstatt");
  assert.deepEqual(seite.aliase, ["Werkstatt"]);
  assert.ok(!begleit.dateien.some(f => f.rel.endsWith("config.edn")));
});

test("CLI: kurzer Bericht mit Exit 0; Rückfrage mit Exit 0; kaputte Zip mit klarer Meldung", () => {
  const umg = { ...process.env };
  for (const k of Object.keys(umg)) if (k.startsWith("GIT_") || k === "BRAIN_VAULT") delete umg[k];
  const lauf = (...a) => spawnSync(process.execPath, [SKRIPT, ...a], { encoding: "utf8", windowsHide: true, env: umg });
  const v = neuesVault();
  const ok = lauf(obsidianQuelle(), v, "--name", "Altes Obsidian");
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  assert.match(ok.stdout, /Import fertig: 24 Notizen/);
  assert.match(ok.stdout, /3 mögliche Widersprüche/);
  assert.ok(existsSync(join(v, "00_inbox", "_import", "altes-obsidian", "_bericht.md")));
  const viele = lauf(notizenOrdner(2000), v);
  assert.equal(viele.status, 0, viele.stdout + viele.stderr);
  assert.match(viele.stdout, /2000 Notizen/);
  assert.match(viele.stdout, /--ja/);
  assert.ok(!existsSync(join(v, "00_inbox", "_import", "viele-notizen")));
  const kaputt = join(temp(), "kaputt.zip");
  writeFileSync(kaputt, Buffer.from("PK\u0003\u0004 keine echte zip"));
  const k = lauf(kaputt, v);
  assert.equal(k.status, 1);
  assert.match(k.stdout, /bitte entpacken und den Ordner importieren/);
  assert.ok(!/at .*\.mjs:\d+/.test(k.stdout + k.stderr), "Stacktrace ausgegeben");
});

test("Leistung: 5000 Notizen Vorprüfung + Kopie < 60 s (Ziel < 20 s)", () => {
  const q = notizenOrdner(5000);
  // 40 Fast-Duplikate und 10 gleichnamige Paare mit widersprüchlichem Preis.
  for (let i = 0; i < 40; i++) {
    const f = join(q, `bereich-${i % 7}`, `notiz-${i}.md`);
    writeFileSync(join(q, `bereich-${i % 7}`, `notiz-${i} kopie.md`), readFileSync(f, "utf8").replace("Nummer", "Fassung"));
  }
  mkdirSync(join(q, "preise"));
  for (let i = 0; i < 10; i++) {
    writeFileSync(join(q, "preise", `Kurs ${i}.md`), `# Kurs ${i}\n\nDer Kurs Nummer ${i} kostet 40 € pro Abend.\n`);
    writeFileSync(join(q, `bereich-${i % 7}`, `Kurs ${i}.md`), `# Kurs ${i}\n\nDer Kurs Nummer ${i} kostet 45 € pro Abend.\n`);
  }
  const v = neuesVault();
  const t0 = Date.now();
  const r = importiere(v, q, { bestaetigt: true, jetzt: JETZT });
  const ms = Date.now() - t0;
  assert.equal(r.status, "ok");
  assert.equal(r.notizen, 5060);
  assert.ok(r.gruppen.length >= 40, `nur ${r.gruppen.length} Gruppen`);
  assert.equal(r.widersprueche.filter(w => w.art === "zahl").length, 10);
  assert.ok(ms < 60000, `zu langsam: ${ms} ms`);
  if (ms > 20000) console.log(`# Hinweis: Import von 5060 Notizen brauchte ${ms} ms (Ziel < 20 s)`);
});

// Setzt im zentralen Verzeichnis die angegebene (entpackte) Größe eines Eintrags — so entsteht eine „Bombe“, deren
// Angaben groß sind, ohne dass der Test große Daten erzeugt. Entpackt wird sie nie (Abbruch bzw. Auslassen vorher).
function setzeGroesse(zip, index, groesse) {
  let p = zip.readUInt32LE(zip.length - 22 + 16);
  for (let i = 0; i < index; i++) p += 46 + zip.readUInt16LE(p + 28) + zip.readUInt16LE(p + 30) + zip.readUInt16LE(p + 32);
  zip.writeUInt32LE(groesse, p + 24);
  return zip;
}

test("Zip-Bombe: Grenzen greifen VOR dem Entpacken (gesamt 500 MB, Datei 5 MB, 100:1, keine Zip in der Zip)", () => {
  const v = neuesVault();
  const rssVorher = process.memoryUsage().rss;
  // Gesamtgröße laut Verzeichnis über 500 MB → Abbruch mit klarer Meldung, nichts geschrieben.
  const gross = setzeGroesse(setzeGroesse(baueZip([{ name: "a.md", daten: "# a\n" }, { name: "b.md", daten: "# b\n" }]), 0, 300 * 1024 * 1024), 1, 300 * 1024 * 1024);
  const pg = join(temp(), "bombe.zip");
  writeFileSync(pg, gross);
  assert.throws(() => importiere(v, pg, { jetzt: JETZT }), (e) => e instanceof ZipFehler && /500 MB/.test(e.message));
  assert.ok(!existsSync(join(v, "00_inbox", "_import")));

  // Einzelne Einträge: > 5 MB, stark gepackt (1 MB Nullen), innere Zip — ausgelassen, nie entpackt.
  const innen = baueZip([{ name: "innen.md", daten: "# innen\n" }]);
  const zip = baueZip([
    { name: "ok.md", daten: "# Okay\n\nDas Fahrrad steht im Keller.\n" },
    { name: "riesig.md", daten: "# riesig\n" },
    { name: "nullen.md", daten: Buffer.alloc(1024 * 1024), komprimiert: true },
    { name: "Anhang/alt.zip", daten: innen },
  ]);
  setzeGroesse(zip, 1, 6 * 1024 * 1024);
  const pz = join(temp(), "gemischt.zip");
  writeFileSync(pz, zip);
  const r = importiere(v, pz, { jetzt: JETZT });
  assert.equal(r.status, "ok");
  const bericht = JSON.parse(readFileSync(join(v, ...r.ziel.split("/"), "_bericht.json"), "utf8"));
  const grund = (rel) => bericht.ausgelassen.find(a => a.rel === rel)?.grund;
  assert.equal(grund("riesig.md"), "größer als 5 MB");
  assert.equal(grund("nullen.md"), "verdächtig stark gepackt");
  assert.match(grund("Anhang/alt.zip"), /Zip in der Zip/);
  assert.equal(r.kopiert, 1);
  assert.ok(process.memoryUsage().rss - rssVorher < 200 * 1024 * 1024, "Speicher gewachsen");
});

test("Zip: Pfad-Ausbruch (.., absolut, Laufwerk, UNC) wird verworfen; nichts außerhalb des Ziels", () => {
  const v = neuesVault();
  const vorher = hashBaum(v);
  const boese = ["../x.md", "/abs.md", "C:/win.md", "C:rel.md", "d:\\tief\\x.md", "\\\\server\\freigabe\\x.md", "ok/../../x.md", "a/./../../y.md"];
  const z = join(temp(), "pfade.zip");
  writeFileSync(z, baueZip([{ name: "gut/notiz.md", daten: "# Gut\n" }, ...boese.map(n => ({ name: n, daten: "# böse\n" }))]));
  const r = importiere(v, z, { jetzt: JETZT });
  assert.equal(r.kopiert, 1);
  const bericht = JSON.parse(readFileSync(join(v, ...r.ziel.split("/"), "_bericht.json"), "utf8"));
  for (const n of boese) assert.ok(bericht.ausgelassen.some(a => a.rel === n && a.grund === "unsicherer Pfad"), `nicht verworfen: ${n}`);
  for (const f of Object.keys(hashBaum(v))) if (!(f in vorher)) assert.ok(f.startsWith(r.ziel + "/"), `außerhalb: ${f}`);
});

test("Rückfrage kommt VOR dem Einlesen (angegebene Größen ≥ 50 MB, Inhalt wird nicht gelesen)", () => {
  const v = neuesVault();
  // 11 Notizen à 60 KB, laut Verzeichnis je 4,9 MB (Verhältnis < 100:1). Würde der Import sie lesen, schlüge die
  // Größen-/Prüfsummenprüfung fehl — die Rückfrage muss also vorher kommen.
  const eintraege = Array.from({ length: 11 }, (_, i) => ({ name: `n${i}.md`, daten: Buffer.alloc(60 * 1024, 0x61) }));
  const zip = baueZip(eintraege);
  for (let i = 0; i < 11; i++) setzeGroesse(zip, i, Math.floor(4.9 * 1024 * 1024));
  const p = join(temp(), "gross.zip");
  writeFileSync(p, zip);
  const r = importiere(v, p, { jetzt: JETZT });
  assert.equal(r.status, "bestaetigen");
  assert.equal(r.notizen, 11);
  assert.ok(r.tokenSchaetzung > 0);
  assert.ok(!existsSync(join(v, "00_inbox", "_import")));
});

test("Widersprüche: keine Fehlalarme bei Präpositionen, Zahlformaten, Kapitelnummern; Verneinung erkannt", () => {
  const vgl = (x, y) => vergleicheNotizen({ datei: "a", text: x, datum: "2025-01-01" }, { datei: "b", text: y, datum: "2025-02-01" }).map(w => w.art);
  // Fehlalarme aus dem Review.
  assert.deepEqual(vgl("Ich fahre an den See bei Konstanz.", "Ich fahre aus dem Haus zum See bei Konstanz."), []);
  assert.deepEqual(vgl("Der Kurs kostet 49 €.", "Der Kurs kostet 49,00 €."), []);
  assert.deepEqual(vgl("Die Miete beträgt 1.000 €.", "Die Miete beträgt 1000 €."), []);
  assert.deepEqual(vgl("Kapitel 3 beschreibt die Gartenarbeit.", "Kapitel 4 beschreibt die Gartenarbeit."), []);
  assert.deepEqual(vgl("Kapitel 3 kostet 5 €.", "Kapitel 4 kostet 6 €."), []);
  // Weiterhin gefunden.
  assert.deepEqual(vgl("Backup ist nicht aktiv.", "Backup ist aktiv."), ["jaNein"]);
  assert.deepEqual(vgl("Das Backup ist aktiv.", "Das Backup ist aus."), ["jaNein"]);
  assert.deepEqual(vgl("Die Heizung bleibt an.", "Die Heizung bleibt aus."), ["jaNein"]);
  assert.deepEqual(vgl("Die Miete beträgt 1.000 €.", "Die Miete beträgt 1.200 €."), ["zahl"]);
  assert.deepEqual(vgl("Der Kurs kostet 49 €.", "Der Kurs kostet 59 €."), ["zahl"]);
});

test("Wiki-Überschneidung über Alias und Link-Ziel; Übersichtsseiten mit vielen Links zählen nicht", () => {
  const v = neuesVault();
  writeFileSync(join(v, "09_wiki", "thema_preise.md"),
    "---\nname: preise\ndescription: Preise\naliases: [Abo-Kosten]\n---\n# Preise\n\nDas Zeitschriften-Abo kostet 12 € im Monat.\n");
  writeFileSync(join(v, "09_wiki", "thema_fahrrad.md"), "---\nname: fahrrad\ndescription: Fahrrad\n---\n# Fahrrad\n\nDer Reifendruck liegt bei 4 bar.\n");
  const q = join(temp(), "Alt");
  mkdirSync(q);
  writeFileSync(join(q, "Abo-Kosten.md"), "# Abo-Kosten\n\nDas Zeitschriften-Abo kostet 15 € im Monat.\n");
  writeFileSync(join(q, "Haushalt.md"), "# Haushalt\n\nSiehe [[thema_preise]].\n");
  writeFileSync(join(q, "Start.md"), "# Start\n\n[[Preise]] [[Fahrrad]] [[a]] [[b]] [[c]] [[d]]\n");
  const r = importiere(v, q, { jetzt: JETZT });
  const ue = r.ueberschneidungen.map(u => [u.datei, u.seite, u.ueber]).sort();
  assert.deepEqual(ue, [["Abo-Kosten.md", "09_wiki/thema_preise.md", "name"], ["Haushalt.md", "09_wiki/thema_preise.md", "link"]]);
  assert.equal(r.widersprueche.length, 1, JSON.stringify(r.widersprueche));
  assert.equal(r.widersprueche[0].b.datei, "09_wiki/thema_preise.md");
});

// Final-Review #10: erneuter Import desselben Ordners (der empfohlene Weg nach dem Bereinigen) kopiert auch
// .txt, PDFs und Bilder nicht ein zweites Mal — Abgleich über die _import.json früherer Importe.
test("erneuter Import: .md, .txt, .pdf und Bilder des ersten Imports gelten als Duplikat, nichts doppelt kopiert", () => {
  const v = neuesVault(), q = obsidianQuelle();
  const erst = importiere(v, q, { name: "alt", jetzt: JETZT });
  assert.equal(erst.status, "ok");
  const zweit = importiere(v, q, { name: "alt", jetzt: JETZT });
  assert.equal(zweit.status, "ok");
  assert.equal(zweit.ziel, "00_inbox/_import/alt-2");
  const kopiert = Object.keys(hashBaum(join(v, "00_inbox", "_import", "alt-2"))).filter(f => !f.startsWith("_"));
  assert.deepEqual(kopiert, [], `doppelt kopiert: ${kopiert.join(", ")}`);
  assert.ok(zweit.duplikateExakt.some(d => d.datei === "Technik/Handbuch Fahrradlampe.pdf" && d.gleichWie.startsWith("00_inbox/_import/alt/")));
  assert.ok(zweit.duplikateExakt.some(d => /\.txt$/.test(d.datei)), "auch .txt als Duplikat erkannt");
});
