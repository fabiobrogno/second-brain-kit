// .tools/tests/test-icons.mjs — MCP-Logos: Zuordnung (iconFuer/normalisiere), Parität Node (icons-zuordnung.mjs)
// vs. Browser-Duplikat (icons.js), Monogramm-Rückfall, reine Atlas-Geometrie (rasterLayout) und die
// mitgelieferten SVGs selbst (vorhanden, keine <script>-Tags, keine on…=-Handler, Lizenztext).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { normalisiere, iconFuer } from "../ansicht/icons-zuordnung.mjs";

const HIER = dirname(fileURLToPath(import.meta.url));
const ANSICHT = join(HIER, "..", "ansicht");
const ICONS_DIR = join(ANSICHT, "vendor", "icons");
const ZUORDNUNG = JSON.parse(readFileSync(join(ICONS_DIR, "zuordnung.json"), "utf8"));

function ladeBrowserSkript() {
  const ctx = vm.createContext({ window: {} });
  vm.runInContext(readFileSync(join(ANSICHT, "icons.js"), "utf8"), ctx, { filename: "icons.js" });
  return ctx.window.BrainIcons;
}
const BrainIcons = ladeBrowserSkript();

// --- TDD iconFuer (Node-Modul) — Beispiele aus dem Task-4-Brief + den real genutzten MCP-Servernamen ---

test("iconFuer: Präfix claude_ai_ + bekannter Dienst → Slug", () => {
  assert.equal(iconFuer("claude_ai_Gmail", ZUORDNUNG), "gmail");
  assert.equal(iconFuer("claude_ai_Google_Calendar", ZUORDNUNG), "googlecalendar");
  assert.equal(iconFuer("claude_ai_Google_Drive", ZUORDNUNG), "googledrive");
  assert.equal(iconFuer("claude_ai_Shopify", ZUORDNUNG), "shopify");
  assert.equal(iconFuer("claude_ai_Notion", ZUORDNUNG), "notion");
  assert.equal(iconFuer("claude_ai_Asana", ZUORDNUNG), "asana");
  assert.equal(iconFuer("claude_ai_n8n", ZUORDNUNG), "n8n");
  assert.equal(iconFuer("claude_ai_Miro", ZUORDNUNG), "miro");
});

test("iconFuer: Meta Ads trifft den Meta-Slug (Teilwort), nicht null", () => {
  assert.equal(iconFuer("claude_ai_Meta_Ads", ZUORDNUNG), "meta");
});

test("iconFuer: Vor-/Nachsilbe mcp-/-mcp wird abgetrennt", () => {
  assert.equal(iconFuer("shopify-dev-mcp", ZUORDNUNG), "shopify");
  assert.equal(iconFuer("mongodb-amazon", ZUORDNUNG), "mongodb");
  assert.equal(iconFuer("mongodb", ZUORDNUNG), "mongodb");
});

test("iconFuer: chrome-devtools trifft Google Chrome (Teilwort „chrome“)", () => {
  assert.equal(iconFuer("chrome-devtools", ZUORDNUNG), "googlechrome");
});

test("iconFuer: Ziffern werden auf beiden Seiten gleich entfernt (n8n bleibt trotzdem treffbar)", () => {
  assert.equal(iconFuer("n8n", ZUORDNUNG), "n8n");
  assert.equal(iconFuer("claude_ai_n8n", ZUORDNUNG), "n8n");
});

test("iconFuer: längster Treffer gewinnt bei mehreren passenden Schlüsseln", () => {
  const z = { google: "google", googlecalendar: "googlecalendar" };
  assert.equal(iconFuer("claude_ai_Google_Calendar", z), "googlecalendar");
  assert.equal(iconFuer("claude_ai_Google_Drive", z), "google", "kein spezifischerer Schlüssel vorhanden, also der allgemeine");
});

test("iconFuer: unbekannter/leerer/kaputter Name → null, kein Absturz", () => {
  assert.equal(iconFuer("unbekannt", ZUORDNUNG), null);
  assert.equal(iconFuer("", ZUORDNUNG), null);
  assert.equal(iconFuer(undefined, ZUORDNUNG), null);
  assert.equal(iconFuer(null, ZUORDNUNG), null);
  assert.equal(iconFuer(42, ZUORDNUNG), null);
  assert.equal(iconFuer("claude_ai_Gmail", null), null);
  assert.equal(iconFuer("claude_ai_Gmail", {}), null);
});

test("iconFuer: von Simple Icons entfernte Marken → null (Monogramm-Fälle)", () => {
  for (const name of [
    "claude_ai_Canva",
    "claude_ai_Klaviyo",
    "claude_ai_Microsoft_365",
    "slack",
    "playwright",
    "amazon-ads",
    "context7",
    "browser-use",
  ]) {
    assert.equal(iconFuer(name, ZUORDNUNG), null, name);
  }
});

test("iconFuer: vollständige Testliste aus dem Task — jeder Name hat ein definiertes Ergebnis (Slug oder null)", () => {
  const NAMEN = [
    "claude_ai_Gmail", "claude_ai_Google_Calendar", "claude_ai_Shopify", "claude_ai_Notion", "claude_ai_Canva",
    "claude_ai_Asana", "claude_ai_Klaviyo", "claude_ai_Meta_Ads", "claude_ai_Miro", "claude_ai_n8n",
    "claude_ai_Microsoft_365", "claude_ai_Google_Drive", "mongodb", "mongodb-amazon", "shopify-dev-mcp",
    "chrome-devtools", "context7", "browser-use", "github", "slack", "figma", "linear", "stripe", "supabase",
    "postgres", "sentry", "docker", "playwright", "amazon-ads",
  ];
  const erwartet = {
    claude_ai_Gmail: "gmail", claude_ai_Google_Calendar: "googlecalendar", claude_ai_Shopify: "shopify",
    claude_ai_Notion: "notion", claude_ai_Canva: null, claude_ai_Asana: "asana", claude_ai_Klaviyo: null,
    claude_ai_Meta_Ads: "meta", claude_ai_Miro: "miro", claude_ai_n8n: "n8n", claude_ai_Microsoft_365: null,
    claude_ai_Google_Drive: "googledrive", mongodb: "mongodb", "mongodb-amazon": "mongodb",
    "shopify-dev-mcp": "shopify", "chrome-devtools": "googlechrome", context7: null, "browser-use": null,
    github: "github", slack: null, figma: "figma", linear: "linear", stripe: "stripe", supabase: "supabase",
    postgres: "postgresql", sentry: "sentry", docker: "docker", playwright: null, "amazon-ads": null,
  };
  for (const n of NAMEN) assert.equal(iconFuer(n, ZUORDNUNG), erwartet[n], n);
});

// W1-Review #9: Teilwort-Fehltreffer → kein (falsches) Markenlogo; Treffer nur an Wortgrenzen/CamelCase.
const FEHLTREFFER = [
  "metabase-mcp", "metadata-server", "mcp-metamask", "Kometa", "x-metaverse", "nonlinear-solver", "rediscover",
  "credis", "zoominfo", "notional", "pinstripe", "miroslav-tools", "jirafe", "digital-mcp", "digitalocean",
];
test("iconFuer: Teilwörter treffen nicht (metabase ≠ meta, pinstripe ≠ stripe, notional ≠ notion …)", () => {
  for (const n of FEHLTREFFER) assert.equal(iconFuer(n, ZUORDNUNG), null, n);
});
test("iconFuer: Wortgrenzen aus Trennern und CamelCase treffen weiter", () => {
  assert.equal(iconFuer("MetaAds", ZUORDNUNG), "meta");
  assert.equal(iconFuer("GoogleCalendar", ZUORDNUNG), "googlecalendar");
  assert.equal(iconFuer("GitHub", ZUORDNUNG), "github");
  assert.equal(iconFuer("redis-cache", ZUORDNUNG), "redis");
  assert.equal(iconFuer("mcp-stripe", ZUORDNUNG), "stripe");
  assert.equal(iconFuer("zoom.us", ZUORDNUNG), "zoom");
  assert.equal(iconFuer("linear_app", ZUORDNUNG), "linear");
});

// --- Parität: icons.js (Browser-Duplikat) liefert für dieselben Eingaben dasselbe wie icons-zuordnung.mjs ---

test("Parität icons.js ↔ icons-zuordnung.mjs: normalisiere + iconFuer stimmen überein", () => {
  const NAMEN = [
    "claude_ai_Gmail", "claude_ai_Google_Calendar", "claude_ai_Meta_Ads", "shopify-dev-mcp", "mongodb-amazon",
    "chrome-devtools", "n8n", "claude_ai_n8n", "unbekannt", "", "context7", "claude_ai_Microsoft_365",
    "MCP-Github", "stripe-mcp", "MetaAds", "GitHub", ...FEHLTREFFER,
  ];
  for (const n of NAMEN) {
    assert.equal(BrainIcons.normalisiere(n), normalisiere(n), `normalisiere(${JSON.stringify(n)})`);
    assert.equal(BrainIcons.iconFuer(n, ZUORDNUNG), iconFuer(n, ZUORDNUNG), `iconFuer(${JSON.stringify(n)})`);
  }
});

// --- Monogramm-Rückfall: pure Funktion, deterministisch, kein DOM nötig ---

test("monogramm: Buchstaben aus Wortanfängen, deterministische Farbe", () => {
  const a = BrainIcons.monogramm("claude_ai_Canva", null);
  const b = BrainIcons.monogramm("claude_ai_Canva", null);
  assert.deepEqual(a, b, "gleicher Name → immer dasselbe Ergebnis");
  assert.equal(a.text, "CA");
  assert.equal(typeof a.farbe, "string");
});

test("monogramm: Palette des Themes (Array) → Farbe kommt aus der Palette, Index aus dem Namens-Hash", () => {
  const palette = ["#111111", "#222222", "#333333"];
  const m = BrainIcons.monogramm("slack", palette);
  assert.ok(palette.includes(m.farbe), m.farbe);
  // andere Namen dürfen auf einen anderen Palette-Eintrag fallen, aber bleiben innerhalb der Palette
  for (const n of ["slack", "canva", "klaviyo", "microsoft-365", "playwright"]) {
    assert.ok(palette.includes(BrainIcons.monogramm(n, palette).farbe), n);
  }
});

test("monogramm: ohne Namen kein Absturz", () => {
  const m = BrainIcons.monogramm("", null);
  assert.equal(m.text, "?");
  assert.equal(typeof m.farbe, "string");
});

// --- rasterLayout: reine Atlas-Geometrie, ohne Canvas prüfbar ---

test("rasterLayout: quadratisches Raster, Kachelgrenzen und UV in [0,1]", () => {
  for (const n of [1, 2, 3, 4, 5, 9, 46]) {
    const r = BrainIcons.rasterLayout(n, 64);
    assert.ok(r.spalten * r.zeilen >= n, `Raster für n=${n} muss mind. ${n} Kacheln fassen`);
    assert.equal(r.breite, r.spalten * 64);
    assert.equal(r.hoehe, r.zeilen * 64);
    for (let i = 0; i < n; i++) {
      const z = r.zelle(i);
      assert.ok(z.u0 >= 0 && z.u1 <= 1 && z.v0 >= 0 && z.v1 <= 1, `UV außerhalb [0,1] bei n=${n}, i=${i}`);
      assert.ok(z.u0 < z.u1 && z.v0 < z.v1);
    }
  }
});

test("rasterLayout: keine zwei Kacheln überlappen (Pixelkoordinaten)", () => {
  const r = BrainIcons.rasterLayout(10, 32);
  const gesehen = new Set();
  for (let i = 0; i < 10; i++) {
    const z = r.zelle(i);
    const key = z.x + "," + z.y;
    assert.ok(!gesehen.has(key), `Kachel ${i} kollidiert bei ${key}`);
    gesehen.add(key);
  }
});

// --- ladeAtlas: ohne echten Browser (kein document/fetch im vm-Kontext) → klare Ablehnung, kein Absturz ---

test("ladeAtlas: ohne Browser-Umgebung (Test/vm) lehnt das Versprechen sauber ab", async () => {
  await assert.rejects(() => BrainIcons.ladeAtlas(["gmail", "github"], { groesse: 64 }), /Browser/);
});

// W1-Review #4: Logos nie über blob:-URLs (die CSP erlaubt nur img-src 'self' data:) — direkt same-origin als Bild.
test("ladeAtlas: holt jedes Logo vom eigenen Ursprung (vendor/icons/<slug>.svg) und zeichnet es als data:-Bild mit fester Größe, nie per blob:", async () => {
  const quelle = readFileSync(join(ANSICHT, "icons.js"), "utf8");
  assert.ok(!/createObjectURL|\bBlob\b|blob:/.test(quelle.replace(/^\s*\/\/.*$/gm, "")), "kein blob: im Code");
  const geholt = [], quellen = [];
  const fetch = async (url) => { geholt.push(url); return /fehlt/.test(url) ? { ok: false, status: 404 } : { ok: true, text: async () => '<svg viewBox="0 0 24 24"><path d="M0 0h24v24H0z"/></svg>' }; };
  class Bild {
    set src(w) { this._src = w; quellen.push(w); setTimeout(() => this.onload(), 0); }
    get src() { return this._src; }
  }
  const leinwand = { width: 0, height: 0, getContext: () => ({ fillRect() {}, drawImage() {} }) };
  const ctx = vm.createContext({ window: {}, setTimeout });
  ctx.window.document = { createElement: () => leinwand };
  ctx.window.Image = Bild;
  ctx.window.fetch = fetch;
  vm.runInContext(readFileSync(join(ANSICHT, "icons.js"), "utf8"), ctx, { filename: "icons.js" });
  const r = await ctx.window.BrainIcons.ladeAtlas(["gmail", "fehlt"], { groesse: 32 });
  assert.deepEqual(geholt, ["vendor/icons/gmail.svg", "vendor/icons/fehlt.svg"], "nur eigener Ursprung, relativ");
  assert.equal(quellen.length, 1);
  assert.match(quellen[0], /^data:image\/svg\+xml;charset=utf-8,/);
  assert.match(decodeURIComponent(quellen[0]), /<svg width="32" height="32"/, "feste Größe gesetzt");
  assert.deepEqual(Object.keys(r.uv), ["gmail"]);
  assert.deepEqual([...r.fehlend], ["fehlt"]);
});

// --- Die mitgelieferten SVGs selbst: vorhanden, zu jedem Slug aus zuordnung.json, keine Skripte/Handler ---

const SVG_DATEIEN = readdirSync(ICONS_DIR).filter((f) => f.endsWith(".svg"));

test("vendor/icons: mindestens 40 SVGs (Vorgabe aus dem Brief)", () => {
  assert.ok(SVG_DATEIEN.length >= 40, `nur ${SVG_DATEIEN.length} SVGs gefunden`);
});

test("vendor/icons: jeder Slug aus zuordnung.json hat eine passende SVG-Datei", () => {
  const vorhandeneSlugs = new Set(SVG_DATEIEN.map((f) => f.slice(0, -4)));
  const fehlend = [...new Set(Object.values(ZUORDNUNG))].filter((slug) => !vorhandeneSlugs.has(slug));
  assert.deepEqual(fehlend, []);
});

test("vendor/icons: reine SVGs ohne <script> und ohne on…=-Handler", () => {
  for (const datei of SVG_DATEIEN) {
    const txt = readFileSync(join(ICONS_DIR, datei), "utf8");
    assert.ok(!/<script/i.test(txt), `${datei} enthält <script>`);
    assert.ok(!/\bon[a-z]+\s*=/i.test(txt), `${datei} enthält einen on…=-Handler`);
    assert.ok(/^﻿?<svg[\s>]/.test(txt.trimStart()) || txt.trimStart().startsWith("<svg"), `${datei} beginnt nicht mit <svg`);
  }
});

test("LIZENZ.md: nennt CC0 und die gepinnte Version", () => {
  const txt = readFileSync(join(ICONS_DIR, "LIZENZ.md"), "utf8");
  assert.ok(txt.includes("CC0"), "CC0 fehlt");
  assert.ok(txt.includes("16.33.0"), "Versionsnummer fehlt");
  assert.ok(/microsoft/i.test(txt) && /slack/i.test(txt), "Monogramm-Fälle müssen aufgelistet sein");
});
