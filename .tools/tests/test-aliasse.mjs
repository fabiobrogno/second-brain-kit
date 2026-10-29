// .tools/tests/test-aliasse.mjs — Entitäts-Aliasse (B1, §4.5): Format, Normalisierung, Index, Dubletten, Kartenzeile.
import { test } from "node:test";
import assert from "node:assert/strict";
import { auchGenanntRoh, pruefeAuchGenannt, normalisiereName, eigenerName, aliasIndex, aliasDubletten, aliasZeile } from "../aliasse.mjs";

test("pruefeAuchGenannt: JSON-Liste aus Texten, höchstens 10, je ≤ 60; Feld fehlt → nichts", () => {
  assert.deepEqual(pruefeAuchGenannt("[\"Nucleus Base\", \" nucleus-core \", \"Nucleus Base\"]"), { aliase: ["Nucleus Base", "nucleus-core"], fehler: [] });
  assert.deepEqual(pruefeAuchGenannt(null), { aliase: [], fehler: [] });
  assert.match(pruefeAuchGenannt("nucleus").fehler[0], /^kein gültiges JSON/);
  assert.match(pruefeAuchGenannt("{\"a\":1}").fehler[0], /^keine Liste/);
  assert.match(pruefeAuchGenannt("").fehler[0], /^leer/);
  assert.deepEqual(pruefeAuchGenannt(JSON.stringify(Array.from({ length: 11 }, (_, i) => `n${i}`))).fehler, ["11 Namen — höchstens 10"]);
  assert.deepEqual(pruefeAuchGenannt(JSON.stringify(["a".repeat(61), 5, " "])).fehler, ["Eintrag 1 hat 61 Zeichen — höchstens 60", "Eintrag 2 ist kein Text", "Eintrag 3 ist leer"]);
  assert.equal(auchGenanntRoh("name: x\r\nauch_genannt: [\"a\"]\r\n"), "[\"a\"]");
  assert.equal(auchGenanntRoh("name: x\n"), null);
});

test("normalisiereName/eigenerName: Groß/Klein, Umlaute, Trenner; Typ-Präfix weg, name-Feld zählt", () => {
  assert.equal(normalisiereName("Nucleus Base"), "nucleus-base");
  assert.equal(normalisiereName("nucleus_base"), "nucleus-base");
  assert.equal(normalisiereName("Nücleus  Straße!"), "nuecleus-strasse");
  assert.equal(eigenerName("09_wiki/technik/entitaet_nucleus.md"), "nucleus");
  assert.equal(eigenerName("09_wiki/technik/entitaet_nucleus.md", "Nucleus Core"), "nucleus-core");
  assert.equal(eigenerName("09_wiki/garten/thema_beet.md", "thema_beet"), "beet");
});

test("aliasIndex: sortiert, normalisiert; aliasDubletten nur, wenn ein Alias beteiligt ist; aliasZeile", () => {
  const idx = aliasIndex([
    { id: "b.md", name: "kern", aliase: [] },
    { id: "a.md", name: "nucleus", aliase: ["Kern", "Nucleus Base"] },
    { id: "c.md", name: "beet", aliase: [] },
    { id: "d.md", name: "beet", aliase: [] },
  ]);
  assert.deepEqual(idx, { version: 1, seiten: { "a.md": ["kern", "nucleus-base"] },
    namen: { beet: ["c.md", "d.md"], kern: ["a.md", "b.md"], nucleus: ["a.md"], "nucleus-base": ["a.md"] } });
  assert.deepEqual(aliasDubletten(idx), [{ name: "kern", ids: ["a.md", "b.md"] }]);
  assert.equal(aliasZeile("[\"Nucleus Base\", \"nucleus-core\"]"), "Auch genannt: Nucleus Base · nucleus-core");
  assert.equal(aliasZeile(null), "");
});
