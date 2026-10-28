// .tools/tests/test-heikel-abnahme.mjs — Abnahme heikel (B1, §4.3) gegen die Spec: Geldbeträge/Preise/Kosten, Vertrag/
// Recht/DSGVO, Personennamen (PII-Filter), Zugänge/Server/Produktion. Ergänzt test-heikel.mjs, ändert es nicht.
import { test } from "node:test";
import assert from "node:assert/strict";
import { istHeikel } from "../heikel.mjs";

const KOEDER = ["pass", "word"].join("") + "=Koeder123";
const hat = (t, grund) => istHeikel(t).gruende.includes(grund);

test("je Grund aus der Spec mindestens ein Fall; Form { heikel, gruende }", () => {
  for (const t of ["Das Saatgut kostet 0 €.", "Der Preis steigt im Mai.", "Die Kosten für den Zaun sind gedeckt."]) assert.ok(hat(t, "geld"), t);
  for (const t of ["Der Mietvertrag läuft bis 2027.", "DSGVO-Auskunft beantworten"]) assert.ok(hat(t, "recht"), t);
  for (const t of ["Schreib an jo@example.com", "Tel. 0171 2345678"]) assert.ok(hat(t, "person"), t);
  for (const t of [KOEDER, "Der Server startet neu.", "Die Produktion ist betroffen."]) assert.ok(hat(t, "zugang"), t);
  const r = istHeikel("Der Vertrag kostet 40 €.");
  assert.equal(r.heikel, true);
  assert.ok(Array.isArray(r.gruende) && r.gruende.every((g) => ["geld", "recht", "person", "zugang"].includes(g)));
});

test("Garten-Alltag ist nicht heikel; leer/null wirft nie", () => {
  for (const t of ["Der Salat wächst im Hochbeet.", "Die Tomaten stehen in Reihe 3.", "", null]) {
    assert.deepEqual(istHeikel(t), { heikel: false, gruende: [] }, String(t));
  }
});
