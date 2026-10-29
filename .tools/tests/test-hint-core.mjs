import { test } from "node:test";
import assert from "node:assert/strict";
import { qmdToRel, shouldQuery, decide, format, countSuppressed, suchtext, istFolgefrage, ablaufZusatz } from "../hint-core.mjs";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const map = {
  paths: { "09-wiki/thema-a.md": "09_wiki/thema_a.md", "09-wiki/thema-b.md": "09_wiki/thema_b.md",
           "20-firma/quelle-q.md": "20_firma/quelle-q.md", "09-wiki/log.md": "09_wiki/_log.md" },
  pages: { "09_wiki/thema_a.md": { name: "a", description: "Thema A" }, "09_wiki/thema_b.md": { name: "b", description: "Thema B" } },
  bySource: { "20_firma/quelle-q.md": ["09_wiki/thema_b.md"] },
};
const r = (file, score) => ({ file: "qmd://brain/" + file, score });

test("qmdToRel bildet QMD-Pfade ab, Unbekanntes → null", () => {
  assert.equal(qmdToRel("qmd://brain/09-wiki/thema-a.md", map), "09_wiki/thema_a.md");
  assert.equal(qmdToRel("qmd://brain/unbekannt.md", map), null);
});
test("shouldQuery: still bei Slash-Commands, Kurzantworten, Zustimmung", () => {
  for (const p of ["", "ja", "danke dir", "ok passt, weiter", "/ingest ~/x.md", "  /brain-lint  "]) assert.equal(shouldQuery(p), false, p);
  for (const p of ["warum bricht der nightly sync ab", "wann sind die abrechnungszahlen endgültig"]) assert.equal(shouldQuery(p), true, p);
});
test("decide: unter Schwelle → nichts", () => {
  assert.deepEqual(decide([r("09-wiki/thema-a.md", 0.40)], map, new Set(), { schwelle: 0.45 }), []);
});
test("decide: Wiki-Treffer direkt, Rohquelle → zitierende Wiki-Seite", () => {
  const h = decide([r("20-firma/quelle-q.md", 0.55), r("09-wiki/thema-a.md", 0.50)], map, new Set(), { schwelle: 0.45 });
  assert.deepEqual(h.map(x => x.page), ["09_wiki/thema_b.md", "09_wiki/thema_a.md"]);
});
test("decide: _-Dateien (Log/Index) nie melden", () => {
  assert.deepEqual(decide([r("09-wiki/log.md", 0.9)], map, new Set()), []);
});
test("decide: Dedupe gegen seen und innerhalb der Liste, max begrenzt", () => {
  const res = [r("09-wiki/thema-b.md", 0.6), r("20-firma/quelle-q.md", 0.58), r("09-wiki/thema-a.md", 0.5)];
  assert.deepEqual(decide(res, map, new Set(["09_wiki/thema_a.md"])).map(x => x.page), ["09_wiki/thema_b.md"]);
  assert.equal(decide(res, map, new Set(), { max: 1 }).length, 1);
});
test("decide: kaputte Ergebnisse werfen nicht", () => {
  assert.deepEqual(decide([{}, { file: 5, score: "x" }, null], map, new Set()), []);
});
test("format: leer bei 0 Treffern, sonst Kopf + 1 Zeile je Seite, Beschreibung ≤ 90 Zeichen", () => {
  assert.equal(format([]), "");
  const out = format([{ page: "09_wiki/thema_a.md", score: 0.5, description: "x".repeat(200) }]);
  const zeilen = out.split("\n");
  assert.equal(zeilen.length, 2);
  assert.match(zeilen[1], /^- 09_wiki\/thema_a\.md — x{90}$/);
});

import { qmdPath } from "../qmd-pfad.mjs";
test("qmdPath entspricht QMDs handelize (Groß/klein bleibt, Nicht-Alnum-Folgen → ein '-', Ränder weg, ___ → /)", () => {
  const faelle = {
    "09_wiki/thema_beispiel-datenreife.md": "09-wiki/thema-beispiel-datenreife.md",
    "09_wiki/_index.md": "09-wiki/index.md",
    "INDEX.md": "INDEX.md",
    "README.md": "README.md",
    "v2.1-notes.md": "v2-1-notes.md",
    "foo_.md": "foo.md",
    "a__b.md": "a-b.md",
    "Über & Co.md": "Über-Co.md",
    "a___b.md": "a/b.md",
    "10_projekte/alpha/notiz-a.md": "10-projekte/alpha/notiz-a.md",
  };
  for (const [ein, aus] of Object.entries(faelle)) assert.equal(qmdPath(ein), aus, ein);
});

test("countSuppressed: zählt nur wegen seen unterdrückte Seiten über Schwelle", () => {
  const res = [r("09-wiki/thema-a.md", 0.6), r("20-firma/quelle-q.md", 0.5), r("09-wiki/thema-a.md", 0.2)];
  assert.equal(countSuppressed(res, map, new Set(["09_wiki/thema_a.md"]), { schwelle: 0.45 }), 1);
  assert.equal(countSuppressed(res, map, new Set(), { schwelle: 0.45 }), 0);
  assert.equal(countSuppressed(res, map, new Set(["09_wiki/thema_a.md", "09_wiki/thema_b.md"]), { schwelle: 0.45 }), 2);
});

test("format: Überblick-Zeile nur bei gleichem Themenordner mit existierender Übersicht", () => {
  const v = mkdtempSync(join(tmpdir(), "brain-")); mkdirSync(join(v, "09_wiki/firma/amazon"), { recursive: true }); writeFileSync(join(v, "09_wiki/firma/amazon/_amazon.md"), "# x");
  const h = (p) => ({ page: p, score: 0.5, description: "d" });
  assert.match(format([h("09_wiki/firma/amazon/a.md"), h("09_wiki/firma/amazon/b.md")], { vault: v }), new RegExp(`Überblick: ${v.split("\\").join("/").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/09_wiki/firma/amazon/_amazon\\.md`));
  assert.doesNotMatch(format([h("09_wiki/firma/amazon/a.md"), h("09_wiki/wissen/x/b.md")], { vault: v }), /Überblick/);
  assert.doesNotMatch(format([h("09_wiki/firma/amazon/a.md")], { vault: v }), /Überblick/);
  assert.doesNotMatch(format([h("09_wiki/wissen/x/a.md"), h("09_wiki/wissen/x/b.md")], { vault: v }), /Überblick/);
  assert.doesNotMatch(format([h("09_wiki/a.md"), h("09_wiki/b.md")], { vault: v }), /Überblick/);
});
test("suchtext: kurz unverändert, lang = Anfang + Ende ≤ 500, Mitte (Secret) fehlt", () => {
  assert.equal(suchtext("kurze frage"), "kurze frage");
  const t = suchtext("a".repeat(300) + "GEHEIM".repeat(2000) + "z".repeat(197));
  assert.ok(t.length <= 500 && t.startsWith("aaa") && t.endsWith("zzz") && !t.includes("GEHEIM"));
});

test("istFolgefrage: echte Anschlussfragen ja, Bestätigungen nein", () => {
  for (const p of ["und beim zweiten account?", "und bei den anderen", "was ist mit fr?", "warum nicht?"]) assert.equal(istFolgefrage(p), true, p);
  for (const p of ["ja bitte", "ok passt", "danke dir", "weiter", "mach das", "jo"]) assert.equal(istFolgefrage(p), false, p);
});

test("format: echter Vault-Pfad statt fest ~/brain; Home wird als ~ abgekürzt", async () => {
  const { homedir } = await import("node:os");
  const h = homedir().split("\\").join("/");
  const hit = [{ page: "wiki/a.md", score: 0.9, description: "d" }];
  assert.match(format(hit, { vault: join(homedir(), "Documents", "Brain") }), /^- ~\/Documents\/Brain\/wiki\/a\.md — d$/m);
  assert.match(format(hit, { vault: "/srv/wissen" }), /^- \/srv\/wissen\/wiki\/a\.md — d$/m);
  assert.doesNotMatch(format(hit, { vault: "/srv/wissen" }), /~\/brain/);
  assert.ok(!h.endsWith("/"));
});

test("format: Treffer auf abgelaufene Seiten tragen „(abgelaufen seit N Tagen)“ (Spec A, W1-Review #8)", () => {
  const v = mkdtempSync(join(tmpdir(), "hint ablauf, Ü "));
  mkdirSync(join(v, "09_wiki"), { recursive: true });
  writeFileSync(join(v, "09_wiki", "alt.md"), "\uFEFF---\r\nname: alt\r\npruefen_bis: 2026-09-30\r\n---\r\n# Alt\r\n");
  writeFileSync(join(v, "09_wiki", "frisch.md"), "---\nname: frisch\npruefen_bis: 2026-12-01\n---\n# Frisch\n");
  writeFileSync(join(v, "09_wiki", "text.md"), "# Text\n\npruefen_bis: 2020-01-01\n");
  writeFileSync(join(v, "09_wiki", "eins.md"), "---\npruefen_bis: 2026-10-02\n---\n");
  const jetzt = new Date(2026, 9, 3, 12).getTime();
  const out = format([
    { page: "09_wiki/alt.md", description: "Alte Seite" }, { page: "09_wiki/frisch.md", description: "Frisch" },
  ], { vault: v, jetzt });
  assert.match(out, /alt\.md \(abgelaufen seit 3 Tagen\) — Alte Seite/);
  assert.doesNotMatch(out.split("\n")[2], /abgelaufen/);
  assert.equal(ablaufZusatz(v, "09_wiki/text.md", { jetzt }), "", "ohne Frontmatter kein Zusatz");
  assert.equal(ablaufZusatz(v, "09_wiki/eins.md", { jetzt }), " (abgelaufen seit 1 Tag)");
  assert.equal(ablaufZusatz(v, "09_wiki/gibtsnicht.md", { jetzt }), "");
  assert.equal(ablaufZusatz(null, "09_wiki/alt.md", { jetzt }), "");
});

test("Systemnachrichten werden nie durchsucht; Lücken nur bei echten Wissensfragen", async () => {
  const { shouldQuery, istWissensfrage, istSystemNachricht } = await import("../hint-core.mjs");
  for (const s of ["<task-notification><task-id>x</task-id> completed", "<agent-message from=\"a1\">Bericht fertig mit vielen Wörtern</agent-message>",
    "[SYSTEM NOTIFICATION - NOT USER INPUT] irgendwas langes hier", "Another Claude session sent a message: Status fertig"]) {
    assert.equal(istSystemNachricht(s), true, s); assert.equal(shouldQuery(s), false, s); assert.equal(istWissensfrage(s), false, s);
  }
  assert.equal(istWissensfrage("wie funktioniert der Amazon Sync eigentlich genau"), true);
  assert.equal(istWissensfrage("welche Preise gelten für die Toner?"), true);
  assert.equal(istWissensfrage("mach das bitte schnell fertig und sichere alles"), false);
  assert.equal(istWissensfrage("ich sag dir ehrlich ich find das richtig krass"), false);
  assert.equal(shouldQuery("mach das bitte schnell fertig und sichere alles"), true);
});

test("format (W6): ersetzte Seite nennt den Nachfolger, Zweifel → PRÜFBEDÜRFTIG, normale Seite bleibt unverändert", () => {
  const v = mkdtempSync(join(tmpdir(), "hint-w6-"));
  mkdirSync(join(v, "wiki"), { recursive: true });
  const seite = (fm) => `---\nname: x\ndescription: d\n${fm}---\n\n# X\n`;
  writeFileSync(join(v, "wiki", "alt.md"), seite('ersetzt_durch: "[[neu]]"\n'));
  writeFileSync(join(v, "wiki", "zw.md"), seite('zweifel: "2026-10-22: Nutzer sagt, abends gießen"\n'));
  writeFileSync(join(v, "wiki", "ok.md"), seite(""));
  const h = (p) => ({ page: `wiki/${p}.md`, score: 0.9, description: "d" });
  const out = format([h("alt"), h("zw"), h("ok")], { vault: v });
  assert.match(out, /alt\.md \(ERSETZT durch \[\[neu\]\] — nicht als aktuell verwenden\) — d/);
  assert.match(out, /zw\.md \(PRÜFBEDÜRFTIG: 2026-10-22: Nutzer sagt, abends gießen\) — d/);
  assert.match(out, /ok\.md — d$/m);
});
test("format (W6): ungültiges ersetzt_durch und Seiten ohne Vault erzeugen keinen Zusatz", () => {
  const v = mkdtempSync(join(tmpdir(), "hint-w6b-"));
  mkdirSync(join(v, "wiki"), { recursive: true });
  writeFileSync(join(v, "wiki", "kaputt.md"), "---\nname: x\ndescription: d\nersetzt_durch: neu\n---\n\n# X\n");
  assert.doesNotMatch(format([{ page: "wiki/kaputt.md", score: 0.9, description: "d" }], { vault: v }), /ERSETZT/);
  assert.doesNotMatch(format([{ page: "wiki/kaputt.md", score: 0.9, description: "d" }]), /ERSETZT/);
});
