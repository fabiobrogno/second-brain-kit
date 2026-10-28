// .tools/tests/test-gesundheit.mjs — Gesundheitswert 0–100: Formel (gesundheit.mjs) und fester Wert auf einem
// Test-Vault mit bekannten Mängeln (pflegebericht + CLI). Nur mkdtemp-Ordner.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const TEST_HOME = mkdtempSync(join(tmpdir(), "brain gesund home "));
Object.assign(process.env, { HOME: TEST_HOME, USERPROFILE: TEST_HOME });
const { gesundheitswert, gesundheitText, REGELN } = await import("../gesundheit.mjs");
const { pflegebericht, textBericht } = await import("../pflege.mjs");
const HIER = dirname(fileURLToPath(import.meta.url));
const JETZT = new Date(2026, 9, 3, 12, 0, 0).getTime();

test("Formel: ohne Mängel 100, Abzüge einzeln, Deckel, Boden 0", () => {
  assert.equal(gesundheitswert({}).wert, 100);
  assert.equal(gesundheitswert().wert, 100);
  assert.equal(gesundheitswert({ toteLinks: 3 }).wert, 94);
  assert.equal(gesundheitswert({ widersprueche: 2, doppelte: 1, verwaist: 4, zuLang: 1 }).wert, 100 - 10 - 3 - 4 - 1);
  // Deckel: ein Typ allein zieht höchstens seinen Deckel ab
  assert.equal(gesundheitswert({ toteLinks: 1000 }).wert, 75);
  assert.equal(gesundheitswert({ toteLinks: 99, widersprueche: 99, doppelte: 99, verwaist: 99, zuLang: 99 }).wert, 0);
  assert.equal(REGELN.reduce((s, r) => s + r.deckel, 0), 100);
  // Müll in den Zahlen wird als 0 gelesen
  assert.equal(gesundheitswert({ toteLinks: -4, verwaist: "x", zuLang: NaN }).wert, 100);
});

test("Text nennt nur vorhandene Abzüge", () => {
  assert.equal(gesundheitText(gesundheitswert({ toteLinks: 2, zuLang: 1 })), "Gesundheit: 95/100\n  − 4 kaputte Links (2)\n  − 1 zu lange Seiten (1)");
  assert.equal(gesundheitText(gesundheitswert({})), "Gesundheit: 100/100");
});

const seite = (titel, rumpf) => `---\nname: ${titel}\ndescription: Testseite ${titel}\n---\n# ${titel}\n\n${rumpf}\n`;
const GLEICH = "Das Testgerät misst Temperatur und Feuchte im Lager und meldet Werte alle zehn Minuten an die Zentrale.";
function vault() {
  const v = join(mkdtempSync(join(tmpdir(), "brain gesund ")), "Brain");
  const w = (rel, text) => { const p = join(v, ...rel.split("/")); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, text); };
  w("brain.config.json", "{}\n");
  // 2 tote Links, 1 offener Widerspruch, 1 Dublette (a/b), 1 doppelter Name (x/lager/gleich.md), 1 verwaiste Seite, 1 zu lange Seite
  w("09_wiki/ueberblick.md", seite("Überblick", "[[a]] [[b]] [[lang]] [[konflikt]] [[gibt_es_nicht]] [[auch_nicht]] [[gleich]]"));
  w("09_wiki/g/a.md", seite("Sensor Nord", GLEICH));
  w("09_wiki/g/b.md", seite("Sensor Süd", GLEICH));
  w("09_wiki/g/lang.md", seite("Langes Gerät", Array.from({ length: 160 }, (_, i) => `Zeile ${i + 1} über das lange Gerät.`).join("\n")));
  w("09_wiki/g/konflikt.md", seite("Strittig", "> [!KONFLIKT] offen — Du entscheidest\n> A: \"Port 4711\" — Quelle: [[q1]]\n> B: \"Port 4712\" — Quelle: [[q2]]\n"));
  w("09_wiki/g/gleich.md", seite("Erste Beschreibung", "Eigener Inhalt zum Lagerplatz eins, ganz ohne Überschneidung."));
  w("09_wiki/h/gleich.md", seite("Zweite Beschreibung", "Völlig anderer Text über Regal sieben und die Anlieferung am Montag."));
  w("09_wiki/g/waise.md", seite("Waise", "Niemand verlinkt mich, ich verlinke niemanden."));
  return v;
}

test("Test-Vault mit bekannten Mängeln ergibt festen Wert", () => {
  const b = pflegebericht(vault(), { jetzt: JETZT });
  const t = Object.fromEntries(b.gesundheit.teile.map(x => [x.schluessel, x]));
  assert.equal(t.toteLinks.anzahl, 2 + 2, "gibt_es_nicht, auch_nicht + zwei Quell-Links des Konflikt-Kastens (q1, q2)");
  assert.equal(t.widersprueche.anzahl, 1);
  assert.equal(t.doppelte.anzahl, 2, "1 Dublette (a/b) + 1 doppelter Name (gleich.md)");
  assert.equal(t.verwaist.anzahl, 2, "waise.md + eine der beiden gleich.md (mehrdeutiger Link zählt nicht)");
  assert.equal(t.zuLang.anzahl, 1);
  // 100 − 4×2 − 5 − 2×3 − 2 − 1 = 78
  assert.equal(b.gesundheit.wert, 78);
  assert.match(textBericht(b), /\nGesundheit: 78\/100\n  − 8 kaputte Links \(4\)/);
});

test("CLI --json trägt gesundheit", () => {
  const out = execFileSync(process.execPath, [join(HIER, "..", "pflege.mjs"), vault(), "--json"], { encoding: "utf8", env: { ...process.env, BRAIN_VAULT: "" } });
  assert.equal(JSON.parse(out).gesundheit.wert, 78);
});
