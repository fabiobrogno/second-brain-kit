import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pruefeUpdate, istNeuer, hinweisZeile, leseCache } from "../update-check.mjs";

function vaultMit(version) {
  const v = mkdtempSync(join(tmpdir(), "update-check-"));
  mkdirSync(join(v, ".tools"), { recursive: true });
  writeFileSync(join(v, ".tools", "VERSION"), `${version}\n`);
  return v;
}
function releaseDatei(tag) {
  const f = join(mkdtempSync(join(tmpdir(), "release-")), "release.json");
  writeFileSync(f, JSON.stringify({ tag_name: tag }));
  return f;
}

test("istNeuer: SemVer-Vergleich, auch mit/ohne führendes v", () => {
  assert.equal(istNeuer("0.2.0", "0.1.0"), true);
  assert.equal(istNeuer("v0.2.0", "v0.1.0"), true);
  assert.equal(istNeuer("0.1.0", "0.1.0"), false);
  assert.equal(istNeuer("0.1.0", "0.2.0"), false);
  assert.equal(istNeuer("1.0.0", "0.9.9"), true);
});

test("pruefeUpdate: neuere Version → neuer:true + Hinweiszeile", async () => {
  const v = vaultMit("0.1.0");
  const erg = await pruefeUpdate(v, { quelle: releaseDatei("v0.2.0") });
  assert.equal(erg.neuer, true);
  assert.equal(erg.neueste, "0.2.0");
  assert.match(hinweisZeile(erg), /neue Version.*v0\.2\.0.*update mein Brain/);
});

test("pruefeUpdate: gleiche Version → neuer:false, keine Hinweiszeile", async () => {
  const v = vaultMit("0.1.0");
  const erg = await pruefeUpdate(v, { quelle: releaseDatei("v0.1.0") });
  assert.equal(erg.neuer, false);
  assert.equal(hinweisZeile(erg), null);
});

test("pruefeUpdate: ältere Remote-Version (lokal neuer, z. B. Entwicklung) → neuer:false", async () => {
  const v = vaultMit("0.3.0");
  const erg = await pruefeUpdate(v, { quelle: releaseDatei("v0.2.0") });
  assert.equal(erg.neuer, false);
});

test("pruefeUpdate: offline/Fehlerquelle → still, neuer:false, nie werfend", async () => {
  const v = vaultMit("0.1.0");
  const erg = await pruefeUpdate(v, { quelle: join(v, "datei-gibt-es-nicht.json") });
  assert.equal(erg.neuer, false);
  assert.equal(erg.neueste, null);
  assert.equal(hinweisZeile(erg), null);
});

test("pruefeUpdate: zweiter Aufruf innerhalb 24h liefert den Cache, ruft die Quelle nicht erneut auf", async () => {
  const v = vaultMit("0.1.0");
  const quelleDatei = releaseDatei("v0.2.0");
  const erg1 = await pruefeUpdate(v, { quelle: quelleDatei, jetzt: 1000 });
  assert.equal(erg1.neuer, true);
  // Quelle danach "kaputt" machen — ein zweiter echter Lauf würde das sofort als Fehler sehen.
  writeFileSync(quelleDatei, "{kaputt");
  const erg2 = await pruefeUpdate(v, { quelle: quelleDatei, jetzt: 1000 + 60 * 60 * 1000 });
  assert.deepEqual(erg2, erg1);
  // Nach 24h+ wird wieder echt geprüft (und liefert jetzt den Fehlerfall der kaputten Quelle).
  const erg3 = await pruefeUpdate(v, { quelle: quelleDatei, jetzt: 1000 + 25 * 60 * 60 * 1000 });
  assert.equal(erg3.neueste, null);
});

test("hinweisZeile: ignoriert einen veralteten Cache-Treffer, sobald die LIVE-Version schon aufgeholt hat (Fix round 1)", async () => {
  // Cache sagt noch "neuer: v0.2.0" (z. B. kurz vor einem Update geschrieben) — die .tools/VERSION im
  // Vault ist inzwischen (durch das Update) selbst schon 0.2.0. Ohne Live-Nachprüfung würde der Hinweis
  // bis zur nächsten 24h-Drosselung fälschlich weiter erscheinen.
  const v = vaultMit("0.2.0");
  const erg = { zeit: Date.now(), aktuelle: "0.1.0", neueste: "0.2.0", neuer: true };
  assert.equal(hinweisZeile(erg, v), null);
  // Ohne vault-Parameter (Rückwärtskompatibilität) bleibt das alte, nur-Cache-basierte Verhalten.
  assert.match(hinweisZeile(erg), /neue Version/);
});

test("pruefeUpdate: Cache wird nach .logs/update-check geschrieben", async () => {
  const v = vaultMit("0.1.0");
  await pruefeUpdate(v, { quelle: releaseDatei("v0.1.0"), jetzt: 42 });
  const roh = JSON.parse(readFileSync(join(v, ".logs", "update-check"), "utf8"));
  assert.equal(roh.zeit, 42);
  assert.deepEqual(leseCache(v), roh);
});
