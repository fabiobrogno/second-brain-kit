// Ansicht-Dienst: reine Anfrage-Logik (dienst-lib.mjs#behandle) — ohne Socket, mit Stub-Handlern.
// Kernrisiko (Spec §3b.1): eine fremde Webseite darf über den Dienst keinerlei Brain-Inhalt bekommen.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { behandle, vaultIdVon, MAX_KOERPER } from "../ansicht/dienst-lib.mjs";

const PORT = 41234;
const HOST = `127.0.0.1:${PORT}`;
const SCHLUESSEL = "ab".repeat(32);
const VAULT = mkdtempSync(join(tmpdir(), "dienst-lib-"));
const ANSICHT = join(VAULT, "ansicht");
mkdirSync(join(ANSICHT, "vendor"), { recursive: true });
writeFileSync(join(ANSICHT, "index.html"), "<!doctype html><title>Brain</title>");
writeFileSync(join(ANSICHT, "app.js"), "console.log('app');");
writeFileSync(join(ANSICHT, "style.css"), "body{}");
writeFileSync(join(ANSICHT, "vendor", "lib.js"), "// lib");
writeFileSync(join(ANSICHT, "data.js"), "window.BRAIN_DATA = {\"geheim\":1};");
writeFileSync(join(ANSICHT, "daten.mjs"), "export const x = 1;");
writeFileSync(join(VAULT, "brain.config.json"), "{\"geheim\":true}");
process.on("exit", () => rmSync(VAULT, { recursive: true, force: true }));

const aufrufe = [];
const stubs = () => ({
  daten: async (v) => { aufrufe.push(["daten", v]); return { nodes: [{ id: "a" }], edges: [] }; },
  einstellungenLesen: async () => ({ werte: { ichKarte: false }, stand: "1", fehler: null, claudeGefunden: false }),
  einstellungenSchreiben: async (v, werte, stand) => { aufrufe.push(["schreiben", werte, stand]); return { ok: true, stand: "2" }; },
  analyse: async () => ({ kennzahlen: {} }),
  vorschlaegeListe: async () => ({ vorschlaege: [] }),
  vorschlagEntscheiden: async (v, id, aktion) => { aufrufe.push(["entscheide", id, aktion]); return { ok: true }; },
  gelesen: async (v, seit) => { aufrufe.push(["gelesen", seit]); return { seiten: [] }; },
});
const kontext = (extra = {}) => ({ vault: VAULT, "token": SCHLUESSEL, port: PORT, handler: stubs(), ansichtDir: ANSICHT, version: "0.3.0", ...extra });
const anfrage = (methode, pfad, headers = {}, body) => {
  const [p, q = ""] = pfad.split("?");
  return { methode, pfad: p, query: Object.fromEntries(new URLSearchParams(q)), headers: { host: HOST, ...headers }, body };
};
const api = (methode, pfad, headers = {}, body) => anfrage(methode, pfad, { "x-brain-token": SCHLUESSEL, ...headers }, body);
const schreibend = (methode, pfad, body, headers = {}) =>
  api(methode, pfad, { origin: `http://${HOST}`, "content-type": "application/json", ...headers }, body === undefined ? undefined : Buffer.from(body));
const json = (r) => JSON.parse(Buffer.isBuffer(r.body) ? r.body.toString("utf8") : r.body);
const text = (r) => (Buffer.isBuffer(r.body) ? r.body.toString("utf8") : String(r.body));

test("ping ohne Token → 403", async () => {
  const r = await behandle(anfrage("GET", "/api/ping"), kontext());
  assert.equal(r.status, 403);
});
test("ping mit falschem Token gleicher Länge → 403", async () => {
  const r = await behandle(anfrage("GET", "/api/ping", { "x-brain-token": "cd".repeat(32) }), kontext());
  assert.equal(r.status, 403);
});
test("ping mit falschem Token anderer Länge → 403", async () => {
  const r = await behandle(anfrage("GET", "/api/ping", { "x-brain-token": "ab" }), kontext());
  assert.equal(r.status, 403);
});
test("ping mit richtigem Token → 200, vaultId + version", async () => {
  const r = await behandle(api("GET", "/api/ping"), kontext());
  assert.equal(r.status, 200);
  const soll = createHash("sha256").update(realpathSync(VAULT)).digest("hex").slice(0, 16);
  assert.deepEqual(json(r), { vaultId: soll, version: "0.3.0" });
  assert.equal(vaultIdVon(VAULT), soll);
});
test("Host evil.example:PORT → 403", async () => {
  const r = await behandle(api("GET", "/api/ping", { host: `evil.example:${PORT}` }), kontext());
  assert.ok(r.status === 403 || r.status === 421);
});
test("Host localhost:PORT → 403 (nur 127.0.0.1:<port>)", async () => {
  const r = await behandle(api("GET", "/api/ping", { host: `localhost:${PORT}` }), kontext());
  assert.equal(r.status, 403);
});
test("Host fehlt → 403; auch die Startseite", async () => {
  const r = await behandle({ methode: "GET", pfad: "/", query: {}, headers: {} }, kontext());
  assert.equal(r.status, 403);
});
test("Host mit anderem Port → 403", async () => {
  const r = await behandle(anfrage("GET", "/", { host: "127.0.0.1:1" }), kontext());
  assert.equal(r.status, 403);
});
test("PUT ohne Origin → 403", async () => {
  const r = await behandle(api("PUT", "/api/einstellungen", { "content-type": "application/json" }, Buffer.from("{\"werte\":{},\"stand\":\"1\"}")), kontext());
  assert.equal(r.status, 403);
});
test("PUT mit fremdem Origin → 403", async () => {
  const r = await behandle(schreibend("PUT", "/api/einstellungen", "{\"werte\":{},\"stand\":\"1\"}", { origin: "http://evil.example" }), kontext());
  assert.equal(r.status, 403);
});
test("PUT mit Origin localhost → 403", async () => {
  const r = await behandle(schreibend("PUT", "/api/einstellungen", "{\"werte\":{},\"stand\":\"1\"}", { origin: `http://localhost:${PORT}` }), kontext());
  assert.equal(r.status, 403);
});
test("PUT mit eigener Herkunft → an Handler", async () => {
  aufrufe.length = 0;
  const r = await behandle(schreibend("PUT", "/api/einstellungen", "{\"werte\":{\"ichKarte\":true},\"stand\":\"1\"}"), kontext());
  assert.equal(r.status, 200);
  assert.deepEqual(json(r), { ok: true, stand: "2" });
  assert.deepEqual(aufrufe, [["schreiben", { ichKarte: true }, "1"]]);
});
test("PUT: stand aus If-Match, wenn im Körper keiner steht", async () => {
  aufrufe.length = 0;
  const r = await behandle(schreibend("PUT", "/api/einstellungen", "{\"werte\":{\"ichKarte\":true}}", { "if-match": "7" }), kontext());
  assert.equal(r.status, 200);
  assert.deepEqual(aufrufe, [["schreiben", { ichKarte: true }, "7"]]);
});
test("POST stopp ohne Origin → 403, mit Origin → 200 + stopp", async () => {
  const ohne = await behandle(api("POST", "/api/stopp"), kontext());
  assert.equal(ohne.status, 403);
  assert.ok(!ohne.stopp);
  const mit = await behandle(schreibend("POST", "/api/stopp"), kontext());
  assert.equal(mit.status, 200);
  assert.equal(mit.stopp, true);
});
test("Sec-Fetch-Site cross-site bei GET /app.js → 403", async () => {
  const r = await behandle(anfrage("GET", "/app.js", { "sec-fetch-site": "cross-site" }), kontext());
  assert.equal(r.status, 403);
});
test("Sec-Fetch-Site cross-site auch bei GET / → 403 (kein Einbetten per iframe)", async () => {
  const r = await behandle(anfrage("GET", "/", { "sec-fetch-site": "cross-site" }), kontext());
  assert.equal(r.status, 403);
});
test("Sec-Fetch-Site same-site → 403 (anderer Port gilt als fremd)", async () => {
  const r = await behandle(api("GET", "/api/daten", { "sec-fetch-site": "same-site" }), kontext());
  assert.equal(r.status, 403);
});
test("GET / ohne Sec-Fetch-Site, mit none und same-origin → 200 index.html", async () => {
  for (const sfs of [undefined, "none", "same-origin"]) {
    const r = await behandle(anfrage("GET", "/", sfs ? { "sec-fetch-site": sfs } : {}), kontext());
    assert.equal(r.status, 200, `sfs=${sfs}`);
    assert.match(text(r), /<title>Brain<\/title>/);
    assert.match(r.headers["Content-Type"], /^text\/html/);
  }
  const r = await behandle(anfrage("GET", "/index.html"), kontext());
  assert.equal(r.status, 200);
});
test("Statische Dateien: .js/.css/Unterordner → 200 mit passendem Typ", async () => {
  const js = await behandle(anfrage("GET", "/app.js", { "sec-fetch-site": "same-origin" }), kontext());
  assert.equal(js.status, 200);
  assert.match(js.headers["Content-Type"], /javascript/);
  const css = await behandle(anfrage("GET", "/style.css"), kontext());
  assert.match(css.headers["Content-Type"], /^text\/css/);
  const sub = await behandle(anfrage("GET", "/vendor/lib.js"), kontext());
  assert.equal(sub.status, 200);
});
test("Pfad-Ausbrüche und data.js → 404", async () => {
  for (const p of ["/data.js", "/../brain.config.json", "/%2e%2e/brain.config.json", "/%2E%2E/brain.config.json",
    "/vendor/..%5c..%5cbrain.config.json", "/vendor\\..\\..\\brain.config.json", "/x%00.js", "/x\0.js",
    "/vendor/../data.js", "/daten.mjs", "/vendor", "/vendor/", "/gibt-es-nicht.js", "/.logs/ansicht/data.js",
    "/../../.logs/ansicht/data.js", "/%64ata.js", "//etc/passwd", "/DATA.JS"]) {
    const r = await behandle(anfrage("GET", p), kontext());
    assert.equal(r.status, 404, `Pfad ${JSON.stringify(p)} → ${r.status}`);
    assert.doesNotMatch(text(r), /geheim/);
  }
});
test("Körper > 64 KB → 413", async () => {
  const gross = "{\"werte\":{},\"x\":\"" + "a".repeat(MAX_KOERPER) + "\"}";
  const r = await behandle(schreibend("PUT", "/api/einstellungen", gross), kontext());
  assert.equal(r.status, 413);
  assert.equal(MAX_KOERPER, 64 * 1024);
});
test("Kein JSON → 400", async () => {
  const r = await behandle(schreibend("PUT", "/api/einstellungen", "kein json"), kontext());
  assert.equal(r.status, 400);
  assert.ok(json(r).fehler);
  const arr = await behandle(schreibend("PUT", "/api/einstellungen", "[1,2]"), kontext());
  assert.equal(arr.status, 400);
});
test("Sicherheits-Header auf jeder Antwort, /api zusätzlich no-store, nie CORS", async () => {
  const faelle = [
    [anfrage("GET", "/"), false], [anfrage("GET", "/app.js"), false], [anfrage("GET", "/data.js"), false],
    [anfrage("GET", "/", { host: "evil.example" }), false],
    [api("GET", "/api/ping"), true], [anfrage("GET", "/api/ping"), true], [api("GET", "/api/daten"), true],
  ];
  for (const [a, istApi] of faelle) {
    const r = await behandle(a, kontext());
    const h = r.headers;
    assert.equal(h["Content-Security-Policy"], "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'", a.pfad);
    assert.equal(h["X-Content-Type-Options"], "nosniff");
    assert.equal(h["Referrer-Policy"], "no-referrer");
    assert.equal(h["X-Frame-Options"], "DENY");
    if (istApi) assert.equal(h["Cache-Control"], "no-store", a.pfad);
    for (const k of Object.keys(h)) assert.ok(!/^access-control-/i.test(k), `CORS-Header ${k}`);
  }
});
test("GET /api/daten → Handler-Daten als JSON", async () => {
  const r = await behandle(api("GET", "/api/daten"), kontext());
  assert.equal(r.status, 200);
  assert.match(r.headers["Content-Type"], /^application\/json/);
  assert.deepEqual(json(r).nodes, [{ id: "a" }]);
});
test("GET /api/einstellungen, /api/analyse, /api/vorschlaege → Handler", async () => {
  assert.equal(json(await behandle(api("GET", "/api/einstellungen"), kontext())).claudeGefunden, false);
  assert.deepEqual(json(await behandle(api("GET", "/api/analyse"), kontext())), { kennzahlen: {} });
  assert.deepEqual(json(await behandle(api("GET", "/api/vorschlaege"), kontext())), { vorschlaege: [] });
});
test("POST /api/vorschlaege/<id>/<aktion> → Handler; falsche Aktion/ID → 404/400", async () => {
  aufrufe.length = 0;
  const ok = await behandle(schreibend("POST", "/api/vorschlaege/20261002-090000-fakt-abc123/uebernehmen"), kontext());
  assert.equal(ok.status, 200);
  const ok2 = await behandle(schreibend("POST", "/api/vorschlaege/xyz/verwerfen"), kontext());
  assert.equal(ok2.status, 200);
  assert.deepEqual(aufrufe, [["entscheide", "20261002-090000-fakt-abc123", "uebernehmen"], ["entscheide", "xyz", "verwerfen"]]);
  const aktion = await behandle(schreibend("POST", "/api/vorschlaege/xyz/loeschen"), kontext());
  assert.equal(aktion.status, 404);
  for (const id of ["..", "%2e%2e", "a%2fb", "a.b", "Gross", "mit_unterstrich"]) {
    const r = await behandle(schreibend("POST", `/api/vorschlaege/${id}/verwerfen`), kontext());
    assert.ok(r.status === 400 || r.status === 404, `id ${id} → ${r.status}`);
  }
  assert.equal(aufrufe.length, 2);
});
test("GET /api/gelesen?seit=<ms> → Handler mit Zahl", async () => {
  aufrufe.length = 0;
  await behandle(api("GET", "/api/gelesen?seit=1700000000000"), kontext());
  await behandle(api("GET", "/api/gelesen?seit=quatsch"), kontext());
  assert.deepEqual(aufrufe, [["gelesen", 1700000000000], ["gelesen", 0]]);
});
test("Falsche Methode → 405, unbekannte API → 404", async () => {
  assert.equal((await behandle(schreibend("POST", "/api/daten"), kontext())).status, 405);
  assert.equal((await behandle(api("GET", "/api/stopp"), kontext())).status, 405);
  assert.equal((await behandle(api("GET", "/api/gibtsnicht"), kontext())).status, 404);
  assert.equal((await behandle(anfrage("POST", "/app.js", { origin: `http://${HOST}` }), kontext())).status, 405);
});
test("Handler wirft {code: 409} → 409 mit fehler", async () => {
  const h = stubs();
  h.einstellungenSchreiben = async () => { throw Object.assign(new Error("Die Einstellungen wurden zwischenzeitlich geändert — bitte neu laden."), { code: 409 }); };
  const r = await behandle(schreibend("PUT", "/api/einstellungen", "{\"werte\":{},\"stand\":\"1\"}"), kontext({ handler: h }));
  assert.equal(r.status, 409);
  assert.match(json(r).fehler, /geändert/);
});
test("Handler wirft {code: 400} → 400 mit fehler", async () => {
  const h = stubs();
  h.einstellungenSchreiben = async () => { throw Object.assign(new Error("Unbekannter Schlüssel"), { code: 400 }); };
  const r = await behandle(schreibend("PUT", "/api/einstellungen", "{\"werte\":{\"x\":1},\"stand\":\"1\"}"), kontext({ handler: h }));
  assert.equal(r.status, 400);
});
test("Handler wirft ohne code → 500 „Interner Fehler“ ohne Stacktrace", async () => {
  const h = stubs();
  h.analyse = async () => { throw new Error("ENOENT: geheim/pfad at Object.<anonymous> (x.mjs:1:1)"); };
  const r = await behandle(api("GET", "/api/analyse"), kontext({ handler: h }));
  assert.equal(r.status, 500);
  assert.deepEqual(json(r), { fehler: "Interner Fehler" });
  const h2 = stubs();
  h2.analyse = async () => { throw Object.assign(new Error("x"), { code: "ENOENT" }); };
  const r2 = await behandle(api("GET", "/api/analyse"), kontext({ handler: h2 }));
  assert.equal(r2.status, 500);
  assert.deepEqual(json(r2), { fehler: "Interner Fehler" });
});
test("fehlender Handler (Modul nicht da) → 503 nicht verfügbar", async () => {
  for (const [m, p, name] of [["GET", "/api/analyse", "analyse"], ["GET", "/api/vorschlaege", "vorschlaegeListe"],
    ["GET", "/api/gelesen?seit=1", "gelesen"], ["GET", "/api/daten", "daten"]]) {
    const h = stubs(); delete h[name];
    const r = await behandle(api(m, p), kontext({ handler: h }));
    assert.equal(r.status, 503, p);
    assert.deepEqual(json(r), { fehler: "nicht verfügbar" });
  }
  const h = stubs();
  h.analyse = async () => { throw Object.assign(new Error("nicht verfügbar"), { code: 503 }); };
  const r = await behandle(api("GET", "/api/analyse"), kontext({ handler: h }));
  assert.equal(r.status, 503);
});
