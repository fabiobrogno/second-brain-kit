// .tools/tests/test-ansicht-paritaet.mjs — die Suche der Ansicht (suche.js) rankt die ECHTEN Ansichtsdaten
// (daten.mjs → data.js) wie `brain search` (minisuche): gleiche Top-3 und Scores; beschreibung wie minisuche.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, cpSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { erzeugeAnsichtsDaten } from "../ansicht/daten.mjs";
import { minisuche } from "../minisuche.mjs";
import { resolveLink } from "../wiki-pfade.mjs";

// Harte Sicherheitsregel (global.md): erzeugeAnsichtsDaten() bindet seit Task 3 das MCP-Inventar ein, das
// ohne Überschreibung die ECHTEN Client-Configs des Testrechners läse (~/.claude.json usw.) — das würde hier
// zusätzliche, nicht erfundene Knoten in `nodes` mischen und die Suchgewichte/-Parität verfälschen. Klammer-
// Zugriff statt Punktnotation auf process.env, damit test-plattform.mjs (verbietet den lesenden Zugriff per
// Punktnotation in Laufzeitcode) nicht anschlägt — hier wird HOME nur für die Testisolation umgelegt.
const LEERES_HOME = mkdtempSync(join(tmpdir(), "paritaet-leeres-home "));
process.env["HOME"] = LEERES_HOME;
process.env["USERPROFILE"] = LEERES_HOME;

const T = fileURLToPath(new URL("..", import.meta.url));

function ladeSuche() {
  const ctx = vm.createContext({ window: {} });
  vm.runInContext(readFileSync(join(T, "ansicht", "suche.js"), "utf8"), ctx, { filename: "suche.js" });
  return ctx.window.BrainSuche;
}
const BrainSuche = ladeSuche();
// Rückgaben aus dem vm-Realm per JSON-Rundreise in diesen Realm holen
const suche = (...a) => JSON.parse(JSON.stringify(BrainSuche.suche(...a)));

function datenAus(vault) {
  const r = erzeugeAnsichtsDaten(vault);
  const s = readFileSync(r.pfad, "utf8");
  const start = s.indexOf("window.BRAIN_DATA = ");
  return JSON.parse(s.slice(start + "window.BRAIN_DATA = ".length).trim().replace(/;$/, ""));
}
function mitTempVault(fn) {
  const basis = mkdtempSync(join(tmpdir(), "ansicht-paritaet-"));
  try { return fn(join(basis, "vault")); } finally { rmSync(basis, { recursive: true, force: true }); }
}

test("Parität: Knoten aus erzeugeAnsichtsDaten(Fixture-Kopie) → gleiche Top-3 wie minisuche", () => {
  mitTempVault((v) => {
    cpSync(join(T, "tests", "fixture"), v, { recursive: true });
    const { nodes } = datenAus(v);
    assert.ok(nodes.some((n) => n.beschreibung), "Fixture hat Seiten mit description — sonst prüft der Test das Gewicht nicht");
    for (const frage of ["thema alpha", "testthema beta amazon", "siehe gamma"]) {
      const erwartet = minisuche(v, frage, 3);
      assert.ok(erwartet.length >= 2, `„${frage}“ muss auf der Fixture treffen`);
      const ist = suche(nodes, frage, 3);
      assert.deepEqual(ist.map((h) => h.id), erwartet.map((h) => h.pfad), `Top-3 für „${frage}“`);
      ist.forEach((h, k) => assert.ok(Math.abs(h.score - erwartet[k].score) < 1e-9, `gleicher Score für „${frage}“ (#${k + 1})`));
    }
  });
});

test("daten.mjs: beschreibung = letzte description-Zeile (wie minisuche), sonst \"\"; desc bleibt Anzeigetext", () => {
  mitTempVault((v) => {
    mkdirSync(join(v, "wiki"), { recursive: true });
    writeFileSync(join(v, "brain.config.json"), JSON.stringify({ ordner: { wiki: "wiki" }, clusters: [] }));
    writeFileSync(join(v, "wiki", "doppelt.md"), "---\ndescription: erste Fassung\ntyp: thema\ndescription: \"zweite Fassung\"\n---\n# Doppelt\n\nText der Seite ohne Treffer hier.\n");
    writeFileSync(join(v, "wiki", "ohne.md"), "# Ohne\n\nDiese Seite hat gar kein Frontmatter und darum auch keine description.\n");
    writeFileSync(join(v, "wiki", "crlf.md"), "---\r\ndescription: 'mit CRLF'\r\n---\r\n# CRLF\r\n\r\nInhalt.\r\n");
    const by = Object.fromEntries(datenAus(v).nodes.map((n) => [n.id, n]));
    assert.equal(by["wiki/doppelt.md"].beschreibung, "zweite Fassung");
    assert.equal(by["wiki/ohne.md"].beschreibung, "");
    assert.equal(by["wiki/crlf.md"].beschreibung, "mit CRLF");
    assert.equal(by["wiki/ohne.md"].desc.startsWith("Diese Seite"), true, "desc fällt auf den ersten Absatz zurück");
    assert.equal(by["wiki/doppelt.md"].desc, "zweite Fassung", "desc nimmt wie beschreibung die letzte Zeile");
    // Suchgewicht folgt der letzten Zeile — wie brain search
    for (const frage of ["zweite", "erste"]) {
      const ist = suche(Object.values(by), frage, 3).map((h) => h.id);
      assert.deepEqual(ist, minisuche(v, frage, 3).map((h) => h.pfad), `„${frage}“ wie minisuche`);
    }
    assert.equal(suche(Object.values(by), "zweite", 3)[0]?.id, "wiki/doppelt.md");
  });
});

test("BOM: Datei mit UTF-8-BOM — Frontmatter erkannt, Ranking wie minisuche", () => {
  mitTempVault((v) => {
    cpSync(join(T, "tests", "fixture"), v, { recursive: true });
    writeFileSync(join(v, "10_projekte", "bom.md"), "\uFEFF---\ndescription: Kontingent Drosselung\n---\n# Bom\n\nKurzer Text über das Kontingent.\n");
    const { nodes } = datenAus(v);
    const bom = nodes.find((n) => n.id === "10_projekte/bom.md");
    assert.equal(bom.beschreibung, "Kontingent Drosselung");
    for (const frage of ["kontingent", "drosselung", "description"]) {
      const ist = suche(nodes, frage, 3).filter((h) => h.score > 0);
      const erwartet = minisuche(v, frage, 3);
      assert.deepEqual(ist.map((h) => h.id), erwartet.map((h) => h.pfad), `„${frage}“`);
      ist.forEach((h, k) => assert.ok(Math.abs(h.score - erwartet[k].score) < 1e-9, `Score „${frage}“`));
    }
    assert.deepEqual(minisuche(v, "description", 3), [], "Frontmatter-Schlüssel zählen nicht als Text");
    assert.equal(minisuche(v, "drosselung", 3)[0]?.pfad, "10_projekte/bom.md", "description ×3 greift trotz BOM");
  });
});

test("Titel-Nachrang auf echten Ansichtsdaten: Seite ohne H1, Titel nur aus dem Dateinamen", () => {
  mitTempVault((v) => {
    cpSync(join(T, "tests", "fixture"), v, { recursive: true });
    writeFileSync(join(v, "10_projekte", "einkaufsplanung.md"), "Nur Stichpunkte: Bestellung, Lager.\n");
    const { nodes } = datenAus(v);
    const n = nodes.find((x) => x.id === "10_projekte/einkaufsplanung.md");
    assert.equal(n.title, "einkaufsplanung", "Titel stammt aus dem Dateinamen");
    assert.deepEqual(minisuche(v, "einkaufsplanung", 3), [], "brain search findet sie nicht (Wort nur im Dateinamen)");
    const r = suche(nodes, "einkaufsplanung", 3);
    assert.deepEqual(r.map((h) => h.id), ["10_projekte/einkaufsplanung.md"]);
    assert.equal(r[0].score, 0);
    assert.equal(r[0].auszug, n.desc);
    assert.equal(suche(nodes, "einkauf", 3)[0]?.id, "10_projekte/einkaufsplanung.md", "Präfix des letzten Tokens");
  });
});

test("linkZiele: Panel-Links lösen wie resolveLink/Kanten auf ([[x.md]], Teilpfad, Namenskollision)", () => {
  mitTempVault((v) => {
    cpSync(join(T, "tests", "fixture"), v, { recursive: true });
    writeFileSync(join(v, "09_wiki", "x.md"), "# X Wiki\n\nWiki-Seite x.\n");
    writeFileSync(join(v, "10_projekte", "x.md"), "# X Projekt\n\nProjekt-Seite x.\n");
    const links = ["thema_beta.md", "amazon/thema_beta", "x", "10_projekte/x", "gibtsnicht", "__proto__"];
    writeFileSync(join(v, "10_projekte", "links.md"), "# Links\n\n" + links.map((l) => `[[${l}]]`).join(" ") + "\n\n`[[im_code]]`\n");
    const data = datenAus(v);
    const ids = data.nodes.map((n) => n.id);
    const seite = data.nodes.find((n) => n.id === "10_projekte/links.md");
    const erwartet = {};
    for (const l of links) { const z = resolveLink(ids, l, "09_wiki"); if (z) erwartet[l] = z; }
    assert.deepEqual({ ...seite.linkZiele }, erwartet);
    assert.equal(seite.linkZiele["thema_beta.md"], "09_wiki/firma/amazon/thema_beta.md");
    assert.equal(seite.linkZiele["amazon/thema_beta"], "09_wiki/firma/amazon/thema_beta.md");
    assert.equal(seite.linkZiele.x, "09_wiki/x.md", "Kollision: Wiki-Ordner bevorzugt wie resolveLink");
    assert.equal(seite.linkZiele["10_projekte/x"], "10_projekte/x.md");
    assert.ok(!Object.prototype.hasOwnProperty.call(seite.linkZiele, "gibtsnicht"));
    assert.ok(!Object.prototype.hasOwnProperty.call(seite.linkZiele, "im_code"), "Links im Code zählen nicht");
    // Jeder Panel-Link hat die passende Kante (Verweist auf)
    for (const z of Object.values(seite.linkZiele)) {
      assert.ok(data.edges.some((e) => e.kind === "link" && [e.s, e.t].sort().join("|") === [seite.id, z].sort().join("|")), `Kante zu ${z}`);
    }
  });
});
