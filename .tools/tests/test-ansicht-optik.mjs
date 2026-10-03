// Ansicht app.js, Gehirn-Optik (v0.4): reine Hilfen aus window.BrainOptik — Form je Seitentyp, Größe nach
// Bedeutungsstufe, Statusring (Abgelaufen), Bündel zwischen Bereichen, Zoomstufen, MCP-Namen und -Waben.
// app.js läuft per vm ohne DOM; dann legt es nur die Hilfen an (keine Szene, kein three.js nötig).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ANSICHT = join(dirname(fileURLToPath(import.meta.url)), "..", "ansicht");
const APP = readFileSync(join(ANSICHT, "app.js"), "utf8");
const ctx = vm.createContext({ window: {} });
vm.runInContext(APP, ctx, { filename: "app.js" });
const O = ctx.window.BrainOptik;
const plain = (x) => JSON.parse(JSON.stringify(x));

test("BrainOptik ist ohne DOM vorhanden", () => {
  for (const f of ["formFuer", "groesseFuer", "ringFuer", "buendel", "buendelBreite", "zoomStufe", "mcpName", "sechseckScheibe", "gruppenWinkel"]) assert.equal(typeof O[f], "function", f);
});

test("Formwahl: jeder Seitentyp hat seine Form, Unbekanntes wird ein Kreis wie ein Thema", () => {
  assert.equal(O.formFuer("thema"), 0);
  assert.equal(O.formFuer("entitaet"), 1);
  assert.equal(O.formFuer("quelle"), 2);
  assert.equal(O.formFuer("synthese"), 3);
  assert.equal(O.formFuer("notiz"), 4);
  assert.equal(O.formFuer("ueberblick"), 5);
  assert.equal(O.formFuer("mcp"), 6);
  assert.equal(O.formFuer("gibtsnicht"), 0);
  assert.equal(O.formFuer(undefined), 0);
  assert.equal(O.formFuer("toString"), 0, "keine geerbten Schlüssel");
  assert.equal(new Set(Object.values(O.FORMEN)).size, Object.keys(O.FORMEN).length, "Formen eindeutig");
});

test("Größe: steigt mit der Bedeutungsstufe, Notizen kleiner, Stufe begrenzt auf 1..3", () => {
  const g = [1, 2, 3].map((s) => O.groesseFuer(s, "thema"));
  assert.ok(g[0] < g[1] && g[1] < g[2]);
  assert.ok(O.groesseFuer(3, "notiz") < O.groesseFuer(3, "thema"));
  assert.equal(O.groesseFuer(0, "thema"), O.groesseFuer(1, "thema"));
  assert.equal(O.groesseFuer(9, "thema"), O.groesseFuer(3, "thema"));
  assert.equal(O.groesseFuer("x", "thema"), O.groesseFuer(1, "thema"));
  assert.ok(O.groesseFuer(1, "ueberblick") >= g[2]);
});

test("Statusring: Konflikt vor Prüfbedürftig vor Abgelaufen (bernstein), sonst keiner", () => {
  assert.equal(O.ringFuer("konflikt", "abgelaufen"), 2);
  assert.equal(O.ringFuer("pruef", "abgelaufen"), 1);
  assert.equal(O.ringFuer("ok", "abgelaufen"), 3);
  assert.equal(O.ringFuer("ok", "bald"), 0);
  assert.equal(O.ringFuer("ok", "ohne"), 0);
  assert.equal(O.ringFuer("ok", undefined), 0);
});

test("Bündel: je Bereichspaar eines (Richtung egal), Kanten im Bereich und gefilterte zählen nicht", () => {
  const kanten = [["a", "b"], ["b", "a"], ["a", "a"], ["a", "c"], ["c", "b"], ["b", "a"], ["x", null]];
  const r = plain(O.buendel(kanten.length, (k) => kanten[k]));
  assert.deepEqual(r.map((b) => [b.a, b.b, b.n]), [["a", "b", 3], ["a", "c", 1], ["b", "c", 1]]);
  assert.deepEqual(r[0].kanten, [0, 1, 5]);
  const ohne5 = plain(O.buendel(kanten.length, (k) => kanten[k], (k) => k !== 5));
  assert.equal(ohne5[0].n, 2);
  assert.deepEqual(plain(O.buendel(0, () => ["a", "b"])), []);
});

test("Bündel: 5000 Kanten über 6 Bereiche bleiben schnell und ergeben höchstens 15 Paare", () => {
  const B = ["a", "b", "c", "d", "e", "f"];
  const t0 = performance.now();
  const r = O.buendel(5000, (k) => [B[k % 6], B[(k * 7 + 3) % 6]]);
  assert.ok(performance.now() - t0 < 50);
  assert.ok(r.length <= 15);
  assert.equal(r.reduce((s, b) => s + b.n, 0), 5000 - [...Array(5000).keys()].filter((k) => k % 6 === (k * 7 + 3) % 6).length);
});

test("Bündelbreite: wächst logarithmisch und ist gedeckelt", () => {
  assert.ok(O.buendelBreite(1) < O.buendelBreite(10));
  assert.ok(O.buendelBreite(10) < O.buendelBreite(40));
  assert.equal(O.buendelBreite(1e6), O.buendelBreite(1e9));
  assert.ok(O.buendelBreite(1e9) <= 8);
  assert.ok(O.buendelBreite(0) > 0 && O.buendelBreite(-3) === O.buendelBreite(0));
});

test("Zoomstufe: fern/mittel/nah aus dem Kameraabstand, Gewichte weich und monoton", () => {
  assert.equal(O.zoomStufe(4.95).stufe, "fern");
  assert.equal(O.zoomStufe(3.0).stufe, "mittel");
  assert.equal(O.zoomStufe(1.8).stufe, "nah");
  assert.deepEqual(plain(O.zoomStufe(8)), { stufe: "fern", mittel: 0, nah: 0 });
  const z = O.zoomStufe(1.0); assert.equal(z.mittel, 1); assert.equal(z.nah, 1);
  let alt = { mittel: 0, nah: 0 };
  for (let d = 6; d >= 1; d -= 0.05) {
    const w = O.zoomStufe(d);
    assert.ok(w.mittel >= alt.mittel - 1e-12 && w.nah >= alt.nah - 1e-12, "monoton bei " + d);
    assert.ok(w.nah <= w.mittel + 1e-12, "nah nie vor mittel");
    alt = w;
  }
  // weicher Übergang: an der Schwelle halb
  assert.ok(Math.abs(O.zoomStufe(3.7).mittel - 0.5) < 1e-9);
  assert.equal(O.zoomStufe(NaN).stufe, "fern");
  assert.equal(O.zoomStufe(2, { mittel: 5, nah: 1 }).stufe, "mittel");
});

test("MCP-Namen: Präfix claude_ai_ weg, Unterstriche als Leerzeichen", () => {
  assert.equal(O.mcpName("claude_ai_Google_Calendar"), "Google Calendar");
  assert.equal(O.mcpName("claude_ai_Gmail"), "Gmail");
  assert.equal(O.mcpName("chrome-devtools"), "chrome-devtools");
  assert.equal(O.mcpName(""), "");
  assert.equal(O.mcpName(null), "");
});

test("Sechseck-Wabe: n Plätze, alle mindestens Abstand 1, kompakt um die Mitte", () => {
  for (const n of [0, 1, 2, 7, 8, 19, 40]) {
    const p = plain(O.sechseckScheibe(n));
    assert.equal(p.length, n);
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) assert.ok(Math.hypot(p[i][0] - p[j][0], p[i][1] - p[j][1]) > 0.99, `n=${n} ${i}/${j}`);
    if (n) assert.deepEqual(p[0], [0, 0]);
    if (n === 7) assert.ok(p.every(([x, y]) => Math.hypot(x, y) < 1.01));
  }
});

test("Gruppenwinkel: größte Herkunftsgruppe vorn (0), übrige abwechselnd links/rechts innerhalb der Spanne", () => {
  const w = plain(O.gruppenWinkel([{ name: "Cursor", n: 3 }, { name: "Claude.ai", n: 9 }, { name: "Codex", n: 2 }, { name: "Gemini", n: 1 }], Math.PI));
  assert.equal(w[1].winkel, 0);
  const seiten = w.filter((_, i) => i !== 1).map((g) => Math.sign(g.winkel));
  assert.ok(seiten.includes(1) && seiten.includes(-1));
  assert.ok(w.every((g) => Math.abs(g.winkel) <= Math.PI / 2 + 1e-9));
  assert.equal(new Set(w.map((g) => g.winkel)).size, 4, "keine zwei Gruppen am selben Platz");
  assert.deepEqual(plain(O.gruppenWinkel([{ name: "A", n: 1 }])), [{ name: "A", winkel: 0 }]);
});

test("Optik-Shader: Klemm-Durchgang bleibt, Bündel-Band beidseitig, Logos über data:-URL (CSP img-src 'self' data:)", () => {
  const a = APP.indexOf("composer.addPass(new RenderPass"), k = APP.indexOf("composer.addPass(klemmPass)"), b = APP.indexOf("new UnrealBloomPass(");
  assert.ok(a > 0 && k > a && b > k);
  assert.match(APP, /side: T\.DoubleSide/);
  const ICONS = readFileSync(join(ANSICHT, "icons.js"), "utf8");
  assert.doesNotMatch(ICONS, /createObjectURL/);
  assert.match(ICONS, /data:image\/svg\+xml/);
});
