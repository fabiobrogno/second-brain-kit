// .tools/ansicht/dienst-lib.mjs — reine Anfrage-Logik des Ansicht-Dienstes (Spec §3.A, §3b.1): Routing und
// Sicherheitsprüfungen, ohne Socket testbar (test-dienst-lib.mjs). Der HTTP-Teil steckt in dienst.mjs.
//
// Kernrisiko: Eine fremde Webseite im selben Browser darf über diesen Dienst keinerlei Brain-Inhalt bekommen
// und nichts schreiben. Darum, in dieser Reihenfolge:
//   1. Host muss exakt 127.0.0.1:<port> sein (gegen DNS-Rebinding: evil.example → 127.0.0.1).
//   2. Sec-Fetch-Site, falls gesetzt, nur same-origin/none — auch für die Startseite (kein Einbetten per
//      iframe, kein <script src>/<img src> von fremden Seiten; ältere Browser ohne den Header bekommen höchstens
//      statische Kit-Dateien, die nie Nutzerdaten enthalten).
//   3. /api/* nur mit X-Brain-Token (zeitkonstanter Vergleich). Ein eigener Header erzwingt bei fremden
//      Seiten einen CORS-Preflight, den der Dienst nie erlaubt (kein Access-Control-Allow-*).
//   4. Schreibende Anfragen zusätzlich nur mit Origin = eigene Herkunft.
// data.js wird nie ausgeliefert (die Seite holt Daten per fetch("/api/daten") mit Token).
import { readFileSync, realpathSync, statSync } from "node:fs";
import { createHash, timingSafeEqual } from "node:crypto";
import { join, dirname, sep } from "node:path";
import { fileURLToPath } from "node:url";
// Gleiches ID-Muster wie vorschlaege.mjs (eine Quelle, einheitliche Fehlermeldungen).
import { ID_MUSTER } from "../vorschlaege.mjs";

const HIER = dirname(fileURLToPath(import.meta.url));
export const MAX_KOERPER = 64 * 1024;

const CSP = "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'";
const TYPEN = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2", ".woff": "font/woff", ".ttf": "font/ttf", ".png": "image/png", ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8", ".txt": "text/plain; charset=utf-8", ".md": "text/plain; charset=utf-8",
};
// .html nur als Startseite (index.html), nicht als beliebige Datei
const ERLAUBTE_ENDUNGEN = new Set([".js", ".css", ".woff2", ".woff", ".ttf", ".png", ".svg", ".json", ".txt", ".md"]);
const AKTIONEN = new Set(["uebernehmen", "verwerfen"]);
// Konflikt-Entscheidungen (v0.4): gleiche Wahl-Werte und Notiz-Grenze wie entscheidungen.mjs (dort die volle
// Prüfung inkl. echter Datei im Wiki); hier nur die billige Vorprüfung der Anfrage.
const WAHLEN = new Set(["a", "b", "beide", "spaeter"]);
const MAX_NOTIZ = 300;

// Seiten-ID aus dem Pfad (URI-kodiert, "/" als %2F): dekodiert, ohne Steuerzeichen/Backslash, keine leeren,
// Punkt- oder ..-Segmente, endet auf .md. Sonst null.
function seitenId(roh) {
  let s;
  try { s = decodeURIComponent(roh); } catch { return null; }
  if (!s || s.length > 300 || /[\\\0-\x1f\x7f]/.test(s) || !s.endsWith(".md")) return null;
  if (s.split("/").some(t => !t || t === "." || t === ".." || t.startsWith("."))) return null;
  return s;
}

// Vault-ID: erste 16 Hex-Zeichen von sha256(realpath(vault)) — unterscheidet Dienste verschiedener Vaults.
export function vaultIdVon(vault) {
  let p = vault;
  try { p = realpathSync(vault); } catch {}
  return createHash("sha256").update(p).digest("hex").slice(0, 16);
}

let versionCache = null;
function kitVersion() {
  if (versionCache === null) {
    try { versionCache = readFileSync(join(HIER, "..", "VERSION"), "utf8").trim(); } catch { versionCache = ""; }
  }
  return versionCache;
}

function grundHeader(istApi) {
  const h = {
    "Content-Security-Policy": CSP,
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "X-Frame-Options": "DENY",
    "Cross-Origin-Resource-Policy": "same-origin",
  };
  if (istApi) h["Cache-Control"] = "no-store";
  return h;
}

function antwort(status, daten, istApi = true) {
  return {
    status,
    headers: { ...grundHeader(istApi), "Content-Type": "application/json; charset=utf-8" },
    body: Buffer.from(JSON.stringify(daten)),
  };
}

const endung = (name) => { const i = name.lastIndexOf("."); return i > 0 ? name.slice(i).toLowerCase() : ""; };

// Statische Datei unter ansichtDir — nur bei sauberem Pfad (kein .., kein Backslash, kein Nullbyte, keine
// Punkt-Segmente, keine leeren Segmente), erlaubter Endung, nie data.js / Module (.mjs) und nur reguläre
// Dateien, deren echter Pfad (Symlinks aufgelöst) im Ansicht-Ordner liegt. Alles andere: 404 (kein Hinweis
// darauf, ob etwas existiert).
function statisch(pfad, ansichtDir) {
  const nicht = antwort(404, { fehler: "nicht gefunden" }, false);
  if (pfad === "/" || pfad === "/index.html") return lies(join(ansichtDir, "index.html"), ".html", ansichtDir) || nicht;
  if (/[\\\0]/.test(pfad) || /%(2e|2f|5c|00)/i.test(pfad)) return nicht;
  let dekodiert;
  try { dekodiert = decodeURIComponent(pfad); } catch { return nicht; }
  if (/[\\\0%]/.test(dekodiert)) return nicht;
  const teile = dekodiert.split("/").slice(1);
  if (!teile.length || teile.some(t => !t || t.startsWith(".") || t === "..")) return nicht;
  const name = teile[teile.length - 1];
  if (name.toLowerCase() === "data.js") return nicht;
  const end = endung(name);
  if (!ERLAUBTE_ENDUNGEN.has(end)) return nicht;
  return lies(join(ansichtDir, ...teile), end, ansichtDir) || nicht;
}

function lies(datei, end, ansichtDir) {
  try {
    const wurzel = realpathSync(ansichtDir);
    const echt = realpathSync(datei);
    if (!echt.startsWith(wurzel + sep)) return null;
    if (!statSync(echt).isFile()) return null;
    // Groß-/Kleinschreibung (macOS/Windows): auch über einen anders geschriebenen Namen nie data.js
    if (echt.slice(wurzel.length + 1).split(sep).pop().toLowerCase() === "data.js") return null;
    return { status: 200, headers: { ...grundHeader(false), "Content-Type": TYPEN[end] || "application/octet-stream", "Cache-Control": "no-cache" }, body: readFileSync(echt) };
  } catch { return null; }
}

function tokenOk(gesendet, soll) {
  const t = Buffer.from(String(gesendet || ""));
  const s = Buffer.from(String(soll || ""));
  return s.length > 0 && t.length === s.length && timingSafeEqual(t, s);
}

function queryWert(query, k) {
  if (!query) return undefined;
  if (typeof query.get === "function") return query.get(k) ?? undefined;
  return query[k];
}

// Handler-Aufruf: fehlt die Funktion (Modul eines parallelen Tasks noch nicht da) → 503. Fehler mit
// numerischem code 400–599 werden mit ihrer Meldung weitergereicht; alles andere wird zu 500 „Interner
// Fehler“ ohne Details (keine Pfade, kein Stacktrace nach außen).
async function rufe(handler, name, ...args) {
  const f = handler && handler[name];
  if (typeof f !== "function") return antwort(503, { fehler: "nicht verfügbar" });
  try {
    const erg = await f(...args);
    return antwort(200, erg === undefined ? { ok: true } : erg);
  } catch (e) {
    const code = e && typeof e.code === "number" && e.code >= 400 && e.code <= 599 ? e.code : 500;
    if (code === 500 && !(e && e.code === 500)) return antwort(500, { fehler: "Interner Fehler" });
    // grund (kurz, einzeilig): warum etwas nicht ging — z. B. Pflege-Lauf „läuft schon“ (409) / „claude fehlt“ (503)
    const grund = e && typeof e.grund === "string" ? { grund: e.grund.split("\n")[0].slice(0, 120) } : {};
    if (code === 503) return antwort(503, { fehler: grund.grund ? grund.grund : "nicht verfügbar", ...grund });
    return antwort(code, { fehler: String(e.message || "Fehler").split("\n")[0].slice(0, 300), ...grund });
  }
}

// Ergebnis von pflegelauf.mjs#starteLosgeloest → Antwort der Route POST /api/pflege/lauf (W1-Review #15):
// gestartet → 200 { gestartet: true }; nicht gestartet → Fehler mit grund: „läuft schon“ 409, „claude fehlt“ 503,
// alles andere 500 — die Oberfläche muss `gestartet` nicht mehr selbst auswerten.
export function laufErgebnis(r) {
  const erg = r && typeof r === "object" ? r : { ok: true, gestartet: r !== false };
  if (erg.gestartet !== false) return erg;
  const grund = String(erg.grund || "nicht gestartet").split("\n")[0].slice(0, 120);
  const code = /läuft schon/i.test(grund) ? 409 : /claude/i.test(grund) ? 503 : 500;
  throw Object.assign(new Error(grund), { code, grund });
}

function jsonKoerper(body) {
  if (!body || !body.length) return { fehler: antwort(400, { fehler: "Körper fehlt" }) };
  try {
    const wert = JSON.parse(Buffer.isBuffer(body) ? body.toString("utf8") : String(body));
    if (!wert || typeof wert !== "object" || Array.isArray(wert)) return { fehler: antwort(400, { fehler: "Körper muss ein JSON-Objekt sein" }) };
    return { wert };
  } catch { return { fehler: antwort(400, { fehler: "Körper ist kein gültiges JSON" }) }; }
}

// anfrage = { methode, pfad, query, headers, body }, kontext = { vault, token, port, handler, ansichtDir?, version?, vaultId? }
// → { status, headers, body, stopp? }  (stopp: true → der Aufrufer beendet den Dienst nach dem Senden)
export async function behandle(anfrage, kontext) {
  const headers = anfrage.headers || {};
  const pfad = String(anfrage.pfad || "");
  const istApi = pfad.startsWith("/api/");
  const methode = String(anfrage.methode || "GET").toUpperCase();

  const host = `127.0.0.1:${kontext.port}`;
  if (headers.host !== host) return antwort(403, { fehler: "falscher Host" }, istApi);
  const sfs = headers["sec-fetch-site"];
  if (sfs && sfs !== "same-origin" && sfs !== "none") return antwort(403, { fehler: "fremde Herkunft" }, istApi);
  if (istApi) {
    if (!tokenOk(headers["x-brain-token"], kontext.token)) return antwort(403, { fehler: "Token fehlt" });
    if (methode !== "GET" && headers.origin !== `http://${host}`) return antwort(403, { fehler: "fremde Herkunft" });
  }
  if (anfrage.body && anfrage.body.length > MAX_KOERPER) return antwort(413, { fehler: "Anfrage zu groß" }, istApi);

  if (!istApi) {
    if (methode !== "GET" && methode !== "HEAD") return antwort(405, { fehler: "Methode nicht erlaubt" }, false);
    return statisch(pfad, kontext.ansichtDir || HIER);
  }

  const h = kontext.handler || {};
  const v = kontext.vault;
  const nurGet = (fn) => (methode === "GET" ? fn() : antwort(405, { fehler: "Methode nicht erlaubt" }));
  const teile = pfad.split("/").slice(2); // ["vorschlaege", "<id>", "<aktion>"]
  switch (pfad) {
    case "/api/ping":
      return nurGet(() => antwort(200, { vaultId: kontext.vaultId || vaultIdVon(v), version: kontext.version ?? kitVersion() }));
    case "/api/daten":
      return nurGet(() => rufe(h, "daten", v));
    case "/api/analyse":
      return nurGet(() => rufe(h, "analyse", v));
    case "/api/vorschlaege":
      return nurGet(() => rufe(h, "vorschlaegeListe", v));
    case "/api/gelesen":
      return nurGet(() => {
        const seit = Number(queryWert(anfrage.query, "seit"));
        return rufe(h, "gelesen", v, Number.isFinite(seit) && seit > 0 ? seit : 0);
      });
    case "/api/einstellungen":
      if (methode === "GET") return rufe(h, "einstellungenLesen", v);
      if (methode === "PUT") {
        const { wert, fehler } = jsonKoerper(anfrage.body);
        if (fehler) return fehler;
        const stand = wert.stand ?? headers["if-match"];
        return rufe(h, "einstellungenSchreiben", v, wert.werte, stand === undefined ? undefined : String(stand));
      }
      return antwort(405, { fehler: "Methode nicht erlaubt" });
    case "/api/pflege":
      return nurGet(() => rufe(h, "pflege", v));
    case "/api/pflege/lauf":
      if (methode !== "POST") return antwort(405, { fehler: "Methode nicht erlaubt" });
      return rufe(h, "pflegeLauf", v);
    case "/api/stopp":
      if (methode !== "POST") return antwort(405, { fehler: "Methode nicht erlaubt" });
      return { ...antwort(200, { ok: true }), stopp: true };
  }
  if (teile[0] === "vorschlaege" && teile.length === 3) {
    if (methode !== "POST") return antwort(405, { fehler: "Methode nicht erlaubt" });
    if (!AKTIONEN.has(teile[2])) return antwort(404, { fehler: "nicht gefunden" });
    if (!ID_MUSTER.test(teile[1])) return antwort(400, { fehler: "ungültige Vorschlags-ID" });
    return rufe(h, "vorschlagEntscheiden", v, teile[1], teile[2]);
  }
  if (teile[0] === "konflikte" && teile.length === 3) {
    if (methode !== "POST") return antwort(405, { fehler: "Methode nicht erlaubt" });
    const seite = seitenId(teile[1]);
    if (!seite) return antwort(400, { fehler: "ungültige Seite" });
    if (!/^[1-9]\d{0,3}$/.test(teile[2])) return antwort(400, { fehler: "ungültige Konflikt-Nummer" });
    const { wert, fehler } = jsonKoerper(anfrage.body);
    if (fehler) return fehler;
    if (!WAHLEN.has(wert.wahl)) return antwort(400, { fehler: "unbekannte Wahl" });
    const notiz = wert.notiz ?? "";
    if (typeof notiz !== "string") return antwort(400, { fehler: "Notiz muss Text sein" });
    if (notiz.length > MAX_NOTIZ) return antwort(400, { fehler: `Notiz ist zu lang (höchstens ${MAX_NOTIZ} Zeichen)` });
    // Fingerabdruck des Kastens (optional): passt er nicht mehr zur nr, antwortet der Handler 409.
    const fp = wert.fingerabdruck ?? null;
    if (fp !== null && (typeof fp !== "string" || !/^[0-9a-f]{12}$/.test(fp))) return antwort(400, { fehler: "ungültiger Fingerabdruck" });
    return rufe(h, "konfliktEntscheiden", v, seite, Number(teile[2]), wert.wahl, notiz, fp);
  }
  return antwort(404, { fehler: "nicht gefunden" });
}
