import { test } from "node:test";
import assert from "node:assert/strict";
import { istGeneriert, istWikiSeite, resolveLink, wikilinks, doppelteNamen } from "../wiki-pfade.mjs";

test("istGeneriert: _index oben und _<ordner> im gleichnamigen Ordner — _log/_schema nicht", () => {
  assert.equal(istGeneriert("09_wiki/_index.md", "09_wiki"), true);
  assert.equal(istGeneriert("09_wiki/firma/amazon/_amazon.md", "09_wiki"), true);
  assert.equal(istGeneriert("09_wiki/firma/_firma.md", "09_wiki"), true);
  for (const r of ["09_wiki/_log.md", "09_wiki/_schema.md", "09_wiki/firma/amazon/_notiz.md", "20_firma/_index.md"]) assert.equal(istGeneriert(r, "09_wiki"), false, r);
});
test("istWikiSeite: nur unter 09_wiki und ohne _-Präfix, auch in Unterordnern", () => {
  assert.equal(istWikiSeite("09_wiki/firma/amazon/thema_x.md", "09_wiki"), true);
  assert.equal(istWikiSeite("09_wiki/thema_x.md", "09_wiki"), true);
  assert.equal(istWikiSeite("09_wiki/_log.md", "09_wiki"), false);
  assert.equal(istWikiSeite("20_firma/thema_x.md", "09_wiki"), false);
});
test("resolveLink: Basename findet Seite in Unterordner, Pfad-Links auf Rohquellen, unbekannt → null", () => {
  const ids = ["09_wiki/firma/amazon/thema_x.md", "20_firma/quelle.md", "09_wiki/ueberblick.md"];
  assert.equal(resolveLink(ids, "thema_x", "09_wiki"), "09_wiki/firma/amazon/thema_x.md");
  assert.equal(resolveLink(ids, "20_firma/quelle", "09_wiki"), "20_firma/quelle.md");
  assert.equal(resolveLink(ids, "ueberblick", "09_wiki"), "09_wiki/ueberblick.md");
  assert.equal(resolveLink(ids, "gibt_es_nicht", "09_wiki"), null);
  assert.equal(resolveLink(ids, "thema_x", "09_wiki", new Set(ids)), "09_wiki/firma/amazon/thema_x.md");
});
test("wikilinks: ignoriert Codeblöcke und Inline-Code, entfernt Alias und Anker", () => {
  const zaun = "`".repeat(3);
  const t = `Siehe [[thema_a]] und [[thema_b|B]] und [[thema_c#abschnitt]].\n${zaun}\n[[im_code]]\n${zaun}\nUnd \`[[inline]]\`.`;
  assert.deepEqual(wikilinks(t), ["thema_a", "thema_b", "thema_c"]);
});
test("doppelteNamen: gleicher handelisierter Basename mit Wiki-Beteiligung wird gemeldet", () => {
  const ids = ["09_wiki/firma/thema_a_b.md", "09_wiki/wissen/thema_a-b.md", "20_firma/x.md", "30_wissen/x.md", "20_firma/thema_c.md", "09_wiki/wissen/thema_c.md"];
  const g = doppelteNamen(ids, (id) => id.startsWith("09_wiki/"));
  assert.deepEqual(g, [["09_wiki/firma/thema_a_b.md", "09_wiki/wissen/thema_a-b.md"], ["20_firma/thema_c.md", "09_wiki/wissen/thema_c.md"]]);
});

test("resolveLink: Link mit .md-Endung löst auf, nur eine endständige", () => {
  const ids = ["09_wiki/firma/amazon/thema_x.md"];
  assert.equal(resolveLink(ids, "thema_x.md", "09_wiki"), "09_wiki/firma/amazon/thema_x.md");
  assert.equal(resolveLink(ids, "thema_x.md.md", "09_wiki"), null);
});
