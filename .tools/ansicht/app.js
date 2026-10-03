/* Brain 3D — Ansicht des Second Brain. Daten kommen über den lokalen Dienst (BrainApi → /api/daten); ohne Dienst
   (file://) aus window.BRAIN_DATA (<vault>/.logs/ansicht/data.js, gebaut von daten.mjs). Schreibt nie.
   three.js kommt lokal aus vendor/three.bundle.js (window.THREE), kein CDN zur Laufzeit. Bereiche, Farben und
   Hirnregionen kommen aus den Daten (config-gesteuert), nicht aus festen Namen. Keine Inline-Skripte/-Handler (CSP).
   Für steuer.js: window.BrainApp = { neuLaden(), waehle(id) }. Texte über window.BrainTexte.t (Rückfall: Deutsch). */
(function () {
  "use strict";

  // ================================================================== Texte (Rückfall, solange texte.js fehlt)
  const STANDARD = {
    ansicht3d: "3D-Ansicht des Brains", suchen: "Suchen", filter: "Filter",
    pflege: "Pflege", pflegeTitel: "Pflege (P)", zuruecksetzen: "Ansicht zurücksetzen", zuruecksetzenTitel: "Ansicht zurücksetzen (R)",
    hellDunkel: "Hell oder dunkel", hellDunkelTitel: "Hell / Dunkel (T)", schliessen: "Schließen",
    bereiche: "Bereiche", seitentyp: "Seitentyp", status: "Status",
    wachstumAbspielen: "Wachstum abspielen", zeitleiste: "Zeitleiste", keineSeiten: "Noch keine Seiten",
    hinweisZiehen: "Ziehen", hinweisDrehen: "drehen", hinweisScrollen: "Scrollen", hinweisZoomen: "zoomen",
    hinweisShiftKlick: "Shift-Klick", hinweisWeg: "Weg zwischen zwei Seiten",
    keineDaten: "Noch keine Daten — sag ‚zeig mir mein Brain‘", datenFehler: "Die Daten konnten nicht geladen werden — sag ‚zeig mir mein Brain‘",
    startFehler: "3D-Ansicht konnte nicht starten: {grund}.", fehltThree: "three.js oder das Gehirn-Modell fehlt", fehltSkripte: "markdown.js oder suche.js fehlt",
    neuOeffnen: "Die Ansicht ist nicht mehr verbunden — sag ‚zeig mir mein Brain‘, um sie neu zu öffnen.",
    typThema: "Thema", typEntitaet: "Steckbrief", typQuelle: "Quelle", typSynthese: "Synthese", typUeberblick: "Überblick", typNotiz: "Notiz", typMcp: "MCP-Server",
    bereichZentrum: "Überblick", bereichArchiv: "Archiv", bereichInbox: "Inbox", bereichWerkzeuge: "Werkzeuge",
    leer: "leer", keine: "keine", frisch: "frisch", offenerKonflikt: "Offener Konflikt", pruefbeduerftig: "Prüfbedürftig",
    stand: "Stand", seit: "Seit", geaendert: "Geändert", fokus: "Fokus", tabSeite: "Seite", tabVerbindungen: "Verbindungen",
    quellen: "Quellen", rohquelle: "Rohquelle", eingearbeitetIn: "Eingearbeitet in", verweistAuf: "Verweist auf", verlinktVon: "Verlinkt von",
    mcpServer: "MCP-Server", fussWeg: "Klick: Weg zu einer zweiten Seite", fussZurueck: "zurück",
    weg: "Weg", schritte: "{n} Schritte", keineVerbindung: "keine Verbindung",
    wegText: "Kürzeste Verbindung über Links und Quellen.", wegKeiner: "Zwischen diesen Seiten gibt es im sichtbaren Bereich keine Verbindung.",
    weitereTreffer: "{n} weitere leuchten im Brain", keinTreffer: "Kein Treffer",
    statusKonflikt: "Konflikt", statusPruef: "Prüfbedürftig", statusOk: "In Ordnung",
    konfliktOffen: "Konflikt offen", pruefKlein: "prüfbedürftig", keineBefunde: "Keine offenen Befunde",
    frischText: "{n} Seiten in den letzten 2 Tagen eingearbeitet — sie pulsieren.",
    vonSeiten: "{n} von {gesamt} Seiten", statistik: "{seiten} Seiten · {verbindungen} Verbindungen",
    mcpWerkzeuge: "Werkzeuge", mcpBenutzt: "Benutzt", mcpZuletzt: "Zuletzt", mcpMal: "{n}×", mcpNie: "nie",
    mcpKeineWerkzeuge: "Noch kein Werkzeug benutzt", mcpSeiten: "Verknüpfte Seiten",
    mcpKeineSeite: "Noch keine Brain-Seite zu diesem Werkzeug", mcpGenutzt: "genutzt",
  };

  // ================================================================== reine Hilfen (ohne DOM; test-ansicht-app.mjs)
  // Platzhalter {name} durch werte.name ersetzen
  const fuelle = (text, werte) => (werte ? String(text).replace(/\{(\w+)\}/g, (m, k) => (k in werte ? String(werte[k]) : m)) : String(text));
  // BrainTexte.t, wenn vorhanden und es den Schlüssel kennt (liefert etwas anderes als den Schlüssel) — sonst Deutsch
  function text(bt, schluessel, werte) {
    if (bt && typeof bt.t === "function") {
      try { const r = bt.t(schluessel, werte); if (typeof r === "string" && r && r !== schluessel) return r; } catch {}
    }
    return fuelle(schluessel in STANDARD ? STANDARD[schluessel] : schluessel in ZUSATZ.de ? ZUSATZ.de[schluessel] : schluessel, werte);
  }
  // Antwort von /api/gelesen (neueste zuerst, {zeit, sid, art, ziel}) → noch nicht gesehene Seiten-IDs.
  // gesehen: Set der schon verarbeiteten Zeilen (der Dienst liefert ab `seit` inklusive — Sekunden-Auflösung).
  // Rückgabe { ids, seit }: seit = jüngster Zeitstempel in ms (für die nächste Abfrage), sonst der alte Wert.
  function neueGelesene(eintraege, gesehen, seit) {
    const ids = [], schon = new Set();
    let neu = seit || 0;
    if (!Array.isArray(eintraege)) return { ids, seit: neu };
    for (const e of eintraege) {
      if (!e || e.art !== "lesen" || typeof e.ziel !== "string" || !e.ziel) continue;
      const k = e.zeit + "|" + e.sid + "|" + e.ziel;
      const ms = Date.parse(String(e.zeit) + "Z");
      if (Number.isFinite(ms) && ms > neu) neu = ms;
      if (gesehen.has(k)) continue;
      gesehen.add(k);
      let id; try { id = decodeURIComponent(e.ziel); } catch { continue; }
      if (!schon.has(id)) { schon.add(id); ids.push(id); }
    }
    if (gesehen.size > 4000) { const rest = [...gesehen].slice(-1000); gesehen.clear(); rest.forEach((k) => gesehen.add(k)); }
    return { ids, seit: neu };
  }
  // Kanten im „sparsamen“ Modus (großes Brain): nur die zur Auswahl/zum Weg/zur Suche gehörenden Kanten.
  // modus: "sel" | "path" | "search" | sonst; fokus: Map(Knoten → Gewicht); inzident(i) → Kantenindizes; ende(k) → [a, b]
  function kantenFuerFokus(modus, { sel = -1, wegKanten = [], fokus = new Map(), inzident, ende, max = 800 } = {}) {
    if (modus === "sel" && sel >= 0) return [...new Set(inzident(sel))].slice(0, max);
    if (modus === "path") return [...new Set(wegKanten)];
    if (modus === "search") {
      const out = new Set();
      for (const i of fokus.keys()) for (const k of inzident(i)) { const [a, b] = ende(k); if (fokus.has(a) && fokus.has(b)) out.add(k); if (out.size >= max) return [...out]; }
      return [...out];
    }
    return [];
  }
  const HILFEN = { fuelle, text, neueGelesene, kantenFuerFokus, STANDARD, ZUSATZ: null };
  if (typeof window !== "undefined") window.BrainAppHilfen = HILFEN;

  // ================================================================== Optik: reine Hilfen (ohne DOM; test-ansicht-optik.mjs)
  // Texte der Optik (v0.4) — über BrainTexte.ergaenze eingespielt, texte.js bleibt unberührt.
  const ZUSATZ = {
    de: {
      statusAbgelaufen: "Abgelaufen", abgelaufenKlein: "abgelaufen", abgelaufenBis: "Abgelaufen — prüfen bis {datum}",
      buendelTip: "{a} ↔ {b}: {n} Verbindungen", buendelTipEins: "{a} ↔ {b}: 1 Verbindung",
      bereichNurDieser: "Klick: nur diesen Bereich zeigen", bereichAlle: "Klick: alle Bereiche zeigen",
      mcpUngenutzt: "30 Tage nicht benutzt", mcpAufrufe30: "{n}× in 30 Tagen",
    },
    en: {
      statusAbgelaufen: "Expired", abgelaufenKlein: "expired", abgelaufenBis: "Expired — review by {datum}",
      buendelTip: "{a} ↔ {b}: {n} connections", buendelTipEins: "{a} ↔ {b}: 1 connection",
      bereichNurDieser: "Click: show only this area", bereichAlle: "Click: show all areas",
      mcpUngenutzt: "Not used in 30 days", mcpAufrufe30: "{n}× in 30 days",
    },
  };
  HILFEN.ZUSATZ = ZUSATZ;
  // Form je Seitentyp im Punkt-Shader: 0 Kreis (Thema), 1 Kreis mit Ring (Steckbrief), 2 Raute (Quelle),
  // 3 Stern mit vier Zacken (Synthese), 4 kleiner Kreis (Notiz), 5 großer Kreis (Überblick), 6 Logo-Plakette (MCP)
  const FORMEN = { thema: 0, entitaet: 1, quelle: 2, synthese: 3, notiz: 4, ueberblick: 5, mcp: 6 };
  const formFuer = (typ) => (Object.prototype.hasOwnProperty.call(FORMEN, typ) ? FORMEN[typ] : 0);
  // Grundgröße aus der Bedeutungsstufe (1–3, daten.mjs); Notizen kleiner, der Überblick größer
  function groesseFuer(stufe, typ) {
    const s = Math.max(1, Math.min(3, Math.round(Number(stufe) || 1)));
    const g = [0.6, 0.86, 1.22][s - 1];
    return typ === "notiz" ? g * 0.74 : typ === "ueberblick" ? 1.5 : g;
  }
  // Statusring: Konflikt (2) vor Prüfbedürftig (1) vor Abgelaufen (3, bernstein); sonst kein Ring
  const ringFuer = (status, gueltigkeit) => (status === "konflikt" ? 2 : status === "pruef" ? 1 : gueltigkeit === "abgelaufen" ? 3 : 0);
  // Kanten zwischen zwei Bereichen → je Bereichspaar EIN Bündel { a, b, n, kanten } (a < b), größte zuerst.
  // bereichVon(k) → [bereichA, bereichB] der Kante k; zaehlt(k) → false blendet eine Kante aus (Filter).
  function buendel(anzahl, bereichVon, zaehlt) {
    const m = new Map();
    for (let k = 0; k < anzahl; k++) {
      if (zaehlt && !zaehlt(k)) continue;
      const [x, y] = bereichVon(k);
      if (x === y || x == null || y == null) continue;
      const [a, b] = x < y ? [x, y] : [y, x], key = a + "\u0000" + b;
      let e = m.get(key); if (!e) m.set(key, (e = { a, b, n: 0, kanten: [] }));
      e.n++; e.kanten.push(k);
    }
    return [...m.values()].sort((p, q) => q.n - p.n || (p.a + p.b < q.a + q.b ? -1 : 1));
  }
  // Breite eines Bündels in CSS-Pixeln: logarithmisch mit der Anzahl, gedeckelt
  const buendelBreite = (n) => Math.min(6.5, 1.5 + 1.4 * Math.log2(1 + Math.max(0, n)));
  // Zoomstufe aus dem Kameraabstand: fern (Überblick) → mittel (Titel wichtiger Seiten) → nah (alles der Umgebung).
  // mittel/nah sind weiche Gewichte 0..1 (Übergang ± weich um die Schwelle), stufe die harte Einordnung.
  const glatt = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  function zoomStufe(abstand, { mittel = 3.7, nah = 2.3, weich = 0.35 } = {}) {
    const d = Number(abstand);
    if (!Number.isFinite(d)) return { stufe: "fern", mittel: 0, nah: 0 };
    const wm = glatt(mittel + weich, mittel - weich, d), wn = glatt(nah + weich, nah - weich, d);
    return { stufe: d <= nah ? "nah" : d <= mittel ? "mittel" : "fern", mittel: wm, nah: wn };
  }
  // Lesbarer Name eines MCP-Servers: Präfix claude_ai_ weg, Unterstriche → Leerzeichen
  function mcpName(name) {
    const s = String(name || "").replace(/^claude_ai_/i, "").replace(/_+/g, " ").trim();
    return s || String(name || "");
  }
  // n Plätze dicht gepackt um (0,0) (Sechseck-Spirale, Abstand 1): Mitte, dann Ringe à 6·r Plätze
  function sechseckScheibe(n) {
    const out = [];
    if (n > 0) out.push([0, 0]);
    const R = [[1, 0], [0.5, Math.sqrt(3) / 2], [-0.5, Math.sqrt(3) / 2], [-1, 0], [-0.5, -Math.sqrt(3) / 2], [0.5, -Math.sqrt(3) / 2]];
    for (let r = 1; out.length < n; r++) {
      for (let s = 0; s < 6 && out.length < n; s++) {
        const a = R[s], b = R[(s + 2) % 6];
        for (let k = 0; k < r && out.length < n; k++) out.push([a[0] * r + b[0] * k, a[1] * r + b[1] * k]);
      }
    }
    return out;
  }
  // MCP-Gruppen (nach Herkunft) auf einen Ring verteilen: größte Gruppe vorn (Winkel 0), die übrigen
  // abwechselnd links/rechts daneben. Rückgabe je Gruppe { name, winkel } (Bogenmaß), Reihenfolge wie Eingabe.
  function gruppenWinkel(gruppen, spanne = Math.PI * 1.5) {
    const sortiert = gruppen.map((g, i) => ({ ...g, i })).sort((a, b) => b.n - a.n || (a.name < b.name ? -1 : 1));
    // spanne = Gesamtbreite des Fächers; die äußersten Gruppen liegen bei ± spanne / 2
    const k = sortiert.length, aussen = Math.ceil((k - 1) / 2), schritt = aussen ? Math.min(Math.PI / 2.2, spanne / 2 / aussen) : 0;
    const w = new Array(k);
    sortiert.forEach((g, r) => { const seite = r % 2 ? 1 : -1, stufe = Math.ceil(r / 2); w[g.i] = { name: g.name, winkel: seite * stufe * schritt }; });
    return w;
  }
  const OPTIK = { FORMEN, formFuer, groesseFuer, ringFuer, buendel, buendelBreite, zoomStufe, mcpName, sechseckScheibe, gruppenWinkel, ZUSATZ };
  if (typeof window !== "undefined") window.BrainOptik = OPTIK;
  if (typeof document === "undefined" || !document.getElementById("gl")) return;

  try { if (window.BrainTexte && typeof window.BrainTexte.ergaenze === "function") window.BrainTexte.ergaenze(ZUSATZ); } catch {}
  const t = (k, w) => text(window.BrainTexte, k, w);
  // Sprache aus den Daten (D.sprache, von daten.mjs/cfg.ansicht.sprache): Vorrang vor navigator.language, aber
  // nicht vor einer ausdrücklichen Nutzerwahl (die steht schon im localStorage, ausConfig() greift dann nicht).
  // Vor ladeDaten() aufrufen, sonst würden Namen (z. B. Bereichsnamen) noch in der alten Sprache gebaut.
  function wendeSpracheAn(raw) {
    if (!raw || typeof raw.sprache !== "string") return;
    const bt = window.BrainTexte;
    if (bt && typeof bt.ausConfig === "function" && bt.ausConfig(raw.sprache)) uebersetzeDom();
  }
  const T = window.THREE;
  const $ = (s) => document.querySelector(s);

  // ================================================================== Schnittstelle für steuer.js (sofort da)
  let bereit = false, wartendeWahl = null, ladeKette = Promise.resolve();
  window.BrainApp = {
    neuLaden: () => (ladeKette = ladeKette.then(() => neuLaden()).catch(() => {})),
    waehle: (id) => { if (!bereit) { wartendeWahl = id; return false; } return waehleId(id); },
  };

  uebersetzeDom();
  if (!T || !window.BRAIN_MESH) { fail(t("fehltThree")); return; }
  if (!window.BrainMarkdown || !window.BrainSuche) { fail(t("fehltSkripte")); return; }
  const { OrbitControls, EffectComposer, RenderPass, UnrealBloomPass, OutputPass, MarchingCubes } = T;

  const params = new URLSearchParams(location.search);
  const SHOT = params.get("shot");
  const mqMobile = matchMedia("(max-width: 720px)");
  const isMobile = () => mqMobile.matches;
  const RM = matchMedia("(prefers-reduced-motion: reduce)").matches || params.has("still");
  const root = document.documentElement;
  if (params.get("theme") === "light" || SHOT === "light") root.dataset.theme = "light";
  if (params.has("bare")) document.body.classList.add("bare");
  try { const th = localStorage.getItem("brain3d-theme"); if (th && !SHOT && !params.get("theme")) root.dataset.theme = th; } catch {}

  // Datenquelle: Dienst (fetch mit Zugangs-Header aus api.js), sonst data.js (file://). Der Abruf startet sofort und
  // läuft parallel zum Aufbau der Gehirn-Szene.
  const api = () => (window.BrainApi && window.BrainApi.verfuegbar ? window.BrainApi : null);
  let quelle = "keine";
  function ladeSkript(src) {
    return new Promise((ok) => {
      const s = document.createElement("script");
      s.src = src; s.onload = () => { s.remove(); ok(true); }; s.onerror = () => { s.remove(); ok(false); };
      document.head.appendChild(s);
    });
  }
  async function holeRohdaten(neu) {
    const a = api();
    if (a) { quelle = "dienst"; return await a.holeJson("/api/daten"); }
    if (location.protocol === "file:") {
      if (!window.BRAIN_DATA || neu) await ladeSkript("../../.logs/ansicht/data.js" + (neu ? "?v=" + Date.now() : ""));
      quelle = "datei"; return window.BRAIN_DATA || null;
    }
    if (window.BRAIN_DATA) { quelle = "datei"; return window.BRAIN_DATA; }
    return null;
  }
  const datenVersprechen = holeRohdaten(false).catch((e) => ({ __fehler: e }));

  // ================================================================== rng
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  const hash = (str) => { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return ((h >>> 0) % 100000) / 100000; };

  // ================================================================== Gehirn aus MRT-Daten (vendor/brain-mesh, CC0)
  // Punkte, Normalen, Schattierung (Sulkustiefe) und Lappen-Karte kommen vorberechnet aus build-brain.mjs.
  const BM = window.BRAIN_MESH;
  const LOBE = BM.lobes;
  const BIN = (() => { const s = atob(BM.b64), u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; })();
  const GRID = BM.grid, G = GRID.G, G3 = G * G * G;
  const OCC = BIN.subarray(BM.n * 10, BM.n * 10 + G3), LAB = BIN.subarray(BM.n * 10 + G3, BM.n * 10 + 2 * G3);
  function decodeCloud(keep) {
    const n = BM.n, qp = new Uint16Array(BIN.buffer, 0, n * 3), qn = new Int8Array(BIN.buffer, n * 6, n * 2), qs = BIN.subarray(n * 8, n * 9), ql = BIN.subarray(n * 9, n * 10);
    const idx = []; for (let i = 0; i < n; i++) if (keep >= 1 || rnd() < keep) idx.push(i);
    const m = idx.length, pos = new Float32Array(m * 3), nor = new Float32Array(m * 3), shade = new Float32Array(m), part = new Float32Array(m), lobe = new Uint8Array(m);
    idx.forEach((i, o) => {
      for (let k = 0; k < 3; k++) pos[o*3+k] = BM.bmin[k] + (qp[i*3+k] / 65535) * (BM.bmax[k] - BM.bmin[k]);
      let x = qn[i*2] / 127, y = qn[i*2+1] / 127, z = 1 - Math.abs(x) - Math.abs(y);
      if (z < 0) { const ox = x; x = (1 - Math.abs(y)) * Math.sign(ox || 1); y = (1 - Math.abs(ox)) * Math.sign(y || 1); }
      const l = Math.hypot(x, y, z) || 1; nor[o*3] = x / l; nor[o*3+1] = y / l; nor[o*3+2] = z / l;
      shade[o] = qs[i] / 255; part[o] = ql[i] === LOBE.cerebellum ? 1 : ql[i] === LOBE.stem ? 2 : 0; lobe[o] = ql[i];
    });
    return { pos, nor, shade, part, lobe };
  }
  const cellOf = (x, y, z) => {
    const i = Math.floor((x - GRID.origin[0]) / GRID.step), j = Math.floor((y - GRID.origin[1]) / GRID.step), k = Math.floor((z - GRID.origin[2]) / GRID.step);
    return i < 0 || j < 0 || k < 0 || i >= G || j >= G || k >= G ? -1 : i + j * G + k * G * G;
  };
  const cellCenter = (q, out = [0, 0, 0]) => { const i = q % G, j = Math.floor(q / G) % G, k = Math.floor(q / (G * G)); out[0] = GRID.origin[0] + (i + 0.5) * GRID.step; out[1] = GRID.origin[1] + (j + 0.5) * GRID.step; out[2] = GRID.origin[2] + (k + 0.5) * GRID.step; return out; };

  // ================================================================== Datenzustand (neu gesetzt von ladeDaten)
  const TYPE_KEYS = { thema: "typThema", entitaet: "typEntitaet", quelle: "typQuelle", synthese: "typSynthese", ueberblick: "typUeberblick", notiz: "typNotiz", mcp: "typMcp" };
  const typName = (ty) => (TYPE_KEYS[ty] ? t(TYPE_KEYS[ty]) : ty);
  const FIXED = { zentrum: { id: "zentrum", farbe: "neutral", region: "tief" }, archiv: { id: "archiv", farbe: "grau", region: "kleinhirn" }, inbox: { id: "inbox", farbe: "lila", region: "wolke" } };
  const FIXED_NAME = { zentrum: "bereichZentrum", archiv: "bereichArchiv", inbox: "bereichInbox", werkzeuge: "bereichWerkzeuge" };
  const DAY = 86400000;
  const toT = (d) => { if (!d) return null; const v = Date.parse(String(d).slice(0, 10) + "T12:00:00Z"); return Number.isFinite(v) ? v : null; };
  let D = null, AREAS = {}, N = 0, E = 0, idx = new Map(), byName = new Map(), out = [], inn = [], adj = [];
  let tFirst = 0, tLast = 0, days = 1, DENSE = 1, mcpInfo = new Map(), S = null, nodeOn = new Uint8Array(0);
  // Die vier festen Bereiche (zentrum/archiv/inbox/werkzeuge) kommen von daten.mjs IMMER mit einem fest
  // deutschen `name` (Überblick/Archiv/Inbox/Werkzeuge, siehe .tools/ansicht/daten.mjs) — die Übersetzung aus
  // texte.js greift darum nur, wenn sie hier Vorrang vor AREAS[a]?.name bekommt. Nur echte Cluster (nicht in
  // FIXED_NAME) nutzen weiter ihren konfigurierten Namen unverändert (Themen des Vaults werden nicht übersetzt).
  const areaName = (a) => (FIXED_NAME[a] ? t(FIXED_NAME[a]) : AREAS[a]?.name || a);

  const css = (v) => getComputedStyle(root).getPropertyValue(v).trim();
  // Farbe je Bereich aus der festen Palette (style.css: --c-blau, --c-orange, … --c-neutral), je Thema einmal gelesen
  let farbCache = {};
  const areaColor = (a) => {
    const f = AREAS[a]?.farbe || "neutral";
    if (!farbCache[f]) farbCache[f] = css("--c-" + f) || css("--c-neutral") || "#ffffff";
    return farbCache[f];
  };

  // ================================================================== regions + layout (Bereich -> echter Hirnlappen)
  // Region (aus areas[].region) -> echte Hirnlappen. Das Zentrum (Wiki ohne Cluster) liegt im Balken + Tiefe, damit
  // es sich nicht mit einem Cluster in der Region „tief“ deckt. „hirnstamm“: MCP-Werkzeuge unten am Stamm.
  const REGION_LOBES = {
    frontal: [LOBE.frontal], temporal: [LOBE.temporal], parietal: [LOBE.parietal], tief: [LOBE.deep, LOBE.limbic],
    okzipital: [LOBE.occipital], kleinhirn: [LOBE.cerebellum], hirnstamm: [LOBE.stem],
  };
  const lobesOf = (a) => (a === "zentrum" ? [LOBE.callosum, LOBE.deep] : REGION_LOBES[AREAS[a]?.region] || [LOBE.deep]);
  const isWolke = (a) => AREAS[a]?.region === "wolke";
  const beidseitig = (a) => AREAS[a]?.region === "temporal"; // Schläfenlappen: zwei Hälften, je Seite ein Knotenpunkt
  const REG = { inbox: { c: [1.3, 0.75, 0.15], r: [0.18, 0.12, 0.18] } };
  let areaInfo = {};
  function buildArea(a) {
    if (areaInfo[a]) return areaInfo[a];
    const set = new Set(lobesOf(a));
    const valid = new Uint8Array(G3); let list = [];
    for (let q = 0; q < G3; q++) if (set.has(LAB[q]) && OCC[q] >= 175) { valid[q] = 1; list.push(q); }
    // schmale Regionen (Hirnstamm): lockerere Schwelle, notfalls die Tiefe — nie eine leere Region
    if (list.length < 8) for (let q = 0; q < G3; q++) if (!valid[q] && set.has(LAB[q]) && OCC[q] >= 90) { valid[q] = 1; list.push(q); }
    if (!list.length) for (let q = 0; q < G3; q++) if (LAB[q] === LOBE.deep && OCC[q] >= 175) { valid[q] = 1; list.push(q); }
    // nächstgelegene gültige Zelle für jede Zelle (BFS, 6er-Nachbarschaft)
    const near = new Int32Array(G3).fill(-1), queue = new Int32Array(G3); let h = 0, tt = 0;
    for (const q of list) { near[q] = q; queue[tt++] = q; }
    while (h < tt) {
      const q = queue[h++], i = q % G, j = Math.floor(q / G) % G, k = Math.floor(q / (G * G));
      const nb = [i > 0 ? q - 1 : -1, i < G - 1 ? q + 1 : -1, j > 0 ? q - G : -1, j < G - 1 ? q + G : -1, k > 0 ? q - G * G : -1, k < G - 1 ? q + G * G : -1];
      for (const r of nb) if (r >= 0 && near[r] < 0) { near[r] = near[q]; queue[tt++] = r; }
    }
    const c = [0, 0, 0], side = { "-1": [0, 0, 0, 0], "1": [0, 0, 0, 0] }, tmp = [0, 0, 0];
    for (const q of list) { cellCenter(q, tmp); for (let k = 0; k < 3; k++) c[k] += tmp[k] / list.length; const sd = side[tmp[2] < 0 ? "-1" : "1"]; sd[0] += tmp[0]; sd[1] += tmp[1]; sd[2] += tmp[2]; sd[3]++; }
    const sideC = (s) => { const v = side[s]; return v[3] ? [v[0] / v[3], v[1] / v[3], v[2] / v[3]] : c; };
    return (areaInfo[a] = { valid, list, near, c, sideC, vol: list.length * GRID.step ** 3 });
  }
  function keepIn(P, i, A) {
    const q = cellOf(P[i*3], P[i*3+1], P[i*3+2]);
    if (q >= 0 && A.valid[q]) return;
    const target = q >= 0 ? A.near[q] : A.list[0]; if (target < 0) return;
    const cc = cellCenter(target), hs = GRID.step * 0.45;
    for (let k = 0; k < 3; k++) P[i*3+k] = cc[k] + Math.max(-hs, Math.min(hs, P[i*3+k] - cc[k]));
  }
  let nodeSide = new Int8Array(0), nodeHub = [];
  // Kräfte-Layout in einem dichten Raster (Zählsortierung in Typed Arrays statt Map): bei 5000 Seiten zusätzlich
  // weniger Runden, damit der Start unter 2 s bleibt — die Startpositionen liegen ohnehin in der richtigen Region.
  function layout() {
    seed = 7;
    const P = new Float32Array(N * 3);
    const cnt = {}; D.nodes.forEach((n) => (cnt[n.area] = (cnt[n.area] || 0) + 1));
    const sp = D.nodes.map((n) => isWolke(n.area) ? 0.08 : 0.8 * Math.cbrt(buildArea(n.area).vol / cnt[n.area]));
    const groups = new Map();
    D.nodes.forEach((n, i) => {
      const gk = n.area + "|" + n.group;
      if (!groups.has(gk)) {
        if (isWolke(n.area)) { const R = REG.inbox; groups.set(gk, [R.c[0] + (hash(gk) - 0.5) * R.r[0], R.c[1] + (hash(gk + "y") - 0.5) * R.r[1], R.c[2] + (hash(gk + "z") - 0.5) * R.r[2]]); }
        else { const A = buildArea(n.area); const q = A.list[Math.floor(hash(gk) * A.list.length)] ?? A.list[0]; groups.set(gk, cellCenter(q, [0, 0, 0])); }
      }
      n._g = groups.get(gk);
      for (let k = 0; k < 3; k++) P[i*3+k] = n._g[k] + (rnd() - 0.5) * sp[i] * 2;
      if (!isWolke(n.area)) keepIn(P, i, buildArea(n.area));
    });
    // Rastergröße nach dem typischen Abstand (Median), nicht nach dem größten: ein Bereich mit wenigen Seiten
    // (großer Abstand) würde sonst alle Seiten in wenige Zellen werfen (fast O(N²)). Knoten mit großem Radius
    // suchen dafür mehr Zellen ab; jedes Paar rechnet der Knoten mit dem größeren Suchradius (gleich: kleinerer Index).
    const spSort = Float32Array.from(sp).sort();
    const CELL = Math.max(0.02, (spSort[spSort.length >> 1] || 0.05) * 1.7);
    const rz = new Int32Array(N); for (let i = 0; i < N; i++) rz[i] = Math.max(1, Math.ceil((sp[i] * 1.6) / CELL));
    const F = new Float32Array(N * 3);
    const iters = !N ? 0 : N > 3000 ? 60 : N > 1200 ? 110 : N > 300 ? 180 : 320;
    const sameArea = D.edges.filter((e) => D.nodes[e.a].area === D.nodes[e.b].area);
    const cx = new Int32Array(N), cy = new Int32Array(N), cz = new Int32Array(N), zel = new Int32Array(N), ord = new Int32Array(N);
    let start = new Int32Array(0);
    for (let it = 0; it < iters; it++) {
      F.fill(0);
      const cool = 1 - it / iters;
      let mx = Infinity, my = Infinity, mz = Infinity, Mx = -Infinity, My = -Infinity, Mz = -Infinity;
      for (let i = 0; i < N; i++) { const x = P[i*3], y = P[i*3+1], z = P[i*3+2]; if (x < mx) mx = x; if (x > Mx) Mx = x; if (y < my) my = y; if (y > My) My = y; if (z < mz) mz = z; if (z > Mz) Mz = z; }
      const nx = Math.floor((Mx - mx) / CELL) + 1, ny = Math.floor((My - my) / CELL) + 1, nz = Math.floor((Mz - mz) / CELL) + 1, nc = nx * ny * nz;
      if (start.length < nc + 1) start = new Int32Array(nc + 1); else start.fill(0, 0, nc + 1);
      for (let i = 0; i < N; i++) {
        cx[i] = Math.floor((P[i*3] - mx) / CELL); cy[i] = Math.floor((P[i*3+1] - my) / CELL); cz[i] = Math.floor((P[i*3+2] - mz) / CELL);
        zel[i] = (cx[i] * ny + cy[i]) * nz + cz[i]; start[zel[i] + 1]++;
      }
      for (let c = 0; c < nc; c++) start[c + 1] += start[c];
      { const fuell = start.slice(0, nc); for (let i = 0; i < N; i++) ord[fuell[zel[i]]++] = i; }
      for (let i = 0; i < N; i++) {
        const R0 = sp[i] * 1.6, ri = rz[i];
        const x0 = Math.max(0, cx[i] - ri), x1 = Math.min(nx - 1, cx[i] + ri), y0 = Math.max(0, cy[i] - ri), y1 = Math.min(ny - 1, cy[i] + ri), z0 = Math.max(0, cz[i] - ri), z1 = Math.min(nz - 1, cz[i] + ri);
        for (let gx = x0; gx <= x1; gx++) for (let gy = y0; gy <= y1; gy++) {
          const zeile = (gx * ny + gy) * nz;
          for (let p = start[zeile + z0], pe = start[zeile + z1 + 1]; p < pe; p++) {
            const j = ord[p];
            if (rz[j] > ri || (rz[j] === ri && j <= i)) continue;
            const ex = P[i*3] - P[j*3], ey = P[i*3+1] - P[j*3+1], ez = P[i*3+2] - P[j*3+2];
            const d = Math.sqrt(ex * ex + ey * ey + ez * ez) + 1e-6, R = Math.max(R0, sp[j] * 1.6);
            if (d >= R) continue;
            const f = (0.5 * (R - d)) / d;
            F[i*3] += ex * f; F[i*3+1] += ey * f; F[i*3+2] += ez * f; F[j*3] -= ex * f; F[j*3+1] -= ey * f; F[j*3+2] -= ez * f;
          }
        }
      }
      for (const e of sameArea) {
        const i = e.a, j = e.b, ex = P[j*3] - P[i*3], ey = P[j*3+1] - P[i*3+1], ez = P[j*3+2] - P[i*3+2];
        const d = Math.sqrt(ex * ex + ey * ey + ez * ez) + 1e-6, rest = (sp[i] + sp[j]) * 0.9, f = ((d - rest) * 0.05) / d;
        F[i*3] += ex * f; F[i*3+1] += ey * f; F[i*3+2] += ez * f; F[j*3] -= ex * f; F[j*3+1] -= ey * f; F[j*3+2] -= ez * f;
      }
      for (let i = 0; i < N; i++) {
        const g = D.nodes[i]._g, lim = sp[i] * 0.6;
        for (let k = 0; k < 3; k++) { F[i*3+k] += (g[k] - P[i*3+k]) * 0.006; P[i*3+k] += Math.max(-lim, Math.min(lim, F[i*3+k])) * (0.35 + 0.65 * cool); }
        if (!isWolke(D.nodes[i].area)) keepIn(P, i, buildArea(D.nodes[i].area));
      }
    }
    nodeSide = new Int8Array(N); nodeHub = [];
    D.nodes.forEach((n, i) => {
      nodeSide[i] = P[i*3+2] < 0 ? -1 : 1;
      nodeHub[i] = isWolke(n.area) ? REG.inbox.c : beidseitig(n.area) ? buildArea(n.area).sideC(String(nodeSide[i])) : buildArea(n.area).c;
    });
    return P;
  }
  // Etiketten-Anker: Schwerpunkt des Lappens (Schläfenlappen: rechte, kameranahe Seite), Richtung nach außen.
  // Ein Etikett je Bereich außer dem Zentrum; teilen sich zwei Bereiche eine Region, wird die Richtung leicht gedreht.
  const REGION_DIR = { frontal: [1, 0.25, 0], parietal: [-0.3, 1, 0], temporal: [0.45, -1, 0], tief: [-0.55, -1, 0], okzipital: [-1, 0.15, 0], kleinhirn: [-1, -0.7, 0], hirnstamm: [0.3, -1, 0], wolke: [0, 1, 0] };
  function regionLabelCfg() {
    const cfg = {}, used = {};
    for (const a of D.areas) {
      if (a.id === "zentrum") continue;
      const k = used[a.region] = (used[a.region] || 0) + 1, d = (REGION_DIR[a.region] || [0, -1, 0]).slice();
      // Unter dem Gehirn liegen die MCP-Plaketten: nach unten zeigende Etiketten seitlich ausweichen lassen
      if (mcpMitte && a.region !== "hirnstamm" && d[1] < -0.5) { d[0] = d[0] < 0 ? -1 : 1; d[1] = -0.3; }
      if (k > 1) { d[1] += 0.45 * (k - 1); }
      if (isWolke(a.id)) cfg[a.id] = { at: REG.inbox.c, dir: d, free: true };
      else if (a.id === "werkzeuge" && mcpMitte) cfg[a.id] = { at: [mcpMitte.x, mcpMitte.y - 0.36, mcpMitte.z], dir: [0, -1, 0], mitte: true };
      else cfg[a.id] = { at: beidseitig(a.id) ? buildArea(a.id).sideC("1") : buildArea(a.id).c, dir: d };
    }
    return cfg;
  }

  // ================================================================== three setup
  const canvas = $("#gl");
  const renderer = new T.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance" });
  const DPR = Math.min(window.devicePixelRatio || 1, isMobile() ? 1.5 : 2);
  renderer.setPixelRatio(DPR);
  const scene = new T.Scene();
  const camera = new T.PerspectiveCamera(32, 1, 0.05, 50);
  const HOME = { pos: new T.Vector3(1.5, 1.6, 4.35), target: new T.Vector3(-0.02, -0.22, 0) };
  if (isMobile()) HOME.pos.multiplyScalar(1.5);
  camera.position.copy(HOME.pos);
  const controls = new OrbitControls(camera, canvas);
  controls.target.copy(HOME.target);
  controls.enableDamping = true; controls.dampingFactor = 0.07; controls.rotateSpeed = 0.6; controls.zoomSpeed = 0.8;
  controls.minDistance = 0.9; controls.maxDistance = 11; controls.screenSpacePanning = true;
  controls.autoRotateSpeed = 0.32;
  controls.update();

  function bgTexture(light) {
    const c = document.createElement("canvas"); c.width = 1024; c.height = 1024;
    const g = c.getContext("2d");
    const gr = g.createRadialGradient(560, 460, 30, 512, 512, 720);
    if (light) { gr.addColorStop(0, "#ffffff"); gr.addColorStop(0.55, "#eef1f7"); gr.addColorStop(1, "#dfe3ec"); }
    else { gr.addColorStop(0, "#0d1426"); gr.addColorStop(0.45, "#070b16"); gr.addColorStop(1, "#020308"); }
    g.fillStyle = gr; g.fillRect(0, 0, 1024, 1024);
    const tx = new T.CanvasTexture(c); tx.colorSpace = T.SRGBColorSpace; return tx;
  }
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  // Sicherung vor dem Bloom: ein einzelner ungültiger (NaN/∞) oder überlaufender Bildpunkt — etwa wenn sich beim
  // Hineinzoomen viele leuchtende Punkte additiv überlagern — wurde vom Bloom zu einem schwarzen Quadrat verschmiert.
  // Dieser Durchgang setzt solche Werte auf 0 bzw. begrenzt sie, bevor der Bloom sie sieht.
  const klemmPass = (() => {
    const mat = new T.ShaderMaterial({
      uniforms: { tDiffuse: { value: null } },
      vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }",
      fragmentShader: "uniform sampler2D tDiffuse; varying vec2 vUv; void main(){ vec4 c = texture2D(tDiffuse, vUv);"
        + " vec4 ok = vec4(greaterThanEqual(c, vec4(0.0))); gl_FragColor = mix(vec4(0.0), min(c, vec4(32.0)), ok); }",
      depthTest: false, depthWrite: false,
    });
    const quad = new T.Mesh(new T.PlaneGeometry(2, 2), mat), kam = new T.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    return {
      enabled: true, needsSwap: true, clear: false, renderToScreen: false,
      setSize() {}, dispose() { mat.dispose(); quad.geometry.dispose(); },
      render(r, schreib, lies) { mat.uniforms.tDiffuse.value = lies.texture; r.setRenderTarget(this.renderToScreen ? null : schreib); r.render(quad, kam); },
    };
  })();
  composer.addPass(klemmPass);
  const bloom = new UnrealBloomPass(new T.Vector2(256, 256), 0.5, 0.45, 0.24);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  const U = { uTime: { value: 0 }, uPR: { value: DPR }, uLight: { value: 0 }, uScale: { value: 1 }, uMotion: { value: RM ? 0 : 1 } };

  // --- Hülle (Marching Cubes aus dem SDF, nach innen versetzt): verdeckt die Rückseite und leuchtet am Rand
  const SHELL_ISO = 0.78;
  const shellMat = new T.ShaderMaterial({
    uniforms: { ...U, uCol: { value: new T.Color() }, uDim: { value: 0 } },
    vertexShader: `varying vec3 vN; varying vec3 vV; void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform vec3 uCol; uniform float uLight, uDim; varying vec3 vN; varying vec3 vV;
      void main(){ float f = 1.0 - abs(dot(normalize(vN), normalize(vV))); float rim = pow(f, 2.6);
        if (uLight > 0.5) { gl_FragColor = vec4(mix(vec3(0.955,0.96,0.975), vec3(0.74,0.77,0.86), rim), 0.78); return; }
        vec3 base = vec3(0.012, 0.018, 0.04);
        vec3 c = base + uCol * (0.02 + 0.06 * rim) * (1.0 - 0.5 * uDim); gl_FragColor = vec4(c, 0.9); }`,
    transparent: true, depthWrite: true, blending: T.NormalBlending,
  });
  const shell = new MarchingCubes(G, shellMat, false, false, 300000);
  shell.isolation = 0;
  for (let q = 0; q < G3; q++) shell.field[q] = OCC[q] / 255 - SHELL_ISO;
  shell.update();
  shell.position.set(...GRID.origin.map((o) => o + (G / 2 + 0.5) * GRID.step)); shell.scale.setScalar((G / 2) * GRID.step);
  shell.renderOrder = 0; shell.frustumCulled = false;
  scene.add(shell);

  // --- Rinde als Punktwolke (tiefengetestet: nur sichtbare Oberfläche) + schwacher Durchschein der Rückseite
  const cloud = decodeCloud(isMobile() ? 0.8 : 1);
  const brainGeo = new T.BufferGeometry();
  brainGeo.setAttribute("position", new T.BufferAttribute(cloud.pos, 3));
  brainGeo.setAttribute("normal", new T.BufferAttribute(cloud.nor, 3));
  brainGeo.setAttribute("shade", new T.BufferAttribute(cloud.shade, 1));
  brainGeo.setAttribute("part", new T.BufferAttribute(cloud.part, 1));
  // Bereichs-Schimmer: je Rindenpunkt der Index seines Bereichs (-1 = keiner), Farben als Uniform-Liste
  const MAX_TINT = 24;
  const cloudTint = new Float32Array(cloud.shade.length).fill(-1);
  const aTint = new T.BufferAttribute(cloudTint, 1);
  brainGeo.setAttribute("tidx", aTint);
  const brainVS = `
      attribute float shade; attribute float part; attribute float tidx;
      uniform float uPR, uScale, uDim, uGhost, uArea, uTintK, uLight; uniform vec3 uColA, uColB; uniform vec3 uTints[${MAX_TINT}];
      varying float vA; varying vec3 vC;
      void main(){
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vec3 n = normalize(normalMatrix * normal);
        vec3 v = normalize(-mv.xyz);
        float f = dot(n, v);
        mv.xyz += v * 0.03;   // gegen die Hülle leicht nach vorn (wie Polygon-Offset)
        float rim = pow(1.0 - abs(f), 3.0);
        if (part < 0.5) rim *= smoothstep(0.08, 0.5, abs(position.z));
        float s = shade;
        float a = (0.58 + 0.3 * rim) * (0.03 + 0.97 * pow(s, 2.2));
        if (uGhost > 0.0) a = (f < 0.0 ? uGhost : 0.0) * (0.2 + 0.8 * s);
        float cz = (modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0)).z;
        a *= 1.0 - 0.45 * smoothstep(-0.2, 0.7, cz - mv.z);
        a *= 1.0 - 0.6 * uDim;
        vA = a;
        vC = mix(uColA, uColB, clamp(s * 0.72 + rim * 0.3, 0.0, 1.0));
        // Schimmer: Bereichsfarbe in die Punktfarbe mischen (0,25; hervorgehobener Bereich 0,6, übrige gedimmt)
        if (tidx > -0.5) {
          int ti = int(tidx + 0.5);
          vec3 tc = uTints[ti];
          bool an = uArea < -0.5 || abs(tidx - uArea) < 0.5;
          float k = uArea < -0.5 ? uTintK : (an ? 0.6 : 0.08);
          vC = uLight > 0.5 ? mix(vC, tc, k * 0.75) : mix(vC, tc * (0.55 + 0.75 * s), k);
          if (!an) a *= 0.5;
        } else if (uArea > -0.5) a *= 0.5;
        vA = a;
        gl_PointSize = -mv.z > 0.06 ? min(uPR * uScale * (1.5 + 1.7 * s) * (4.2 / -mv.z), uPR * 4.5) : 0.0;
        gl_Position = projectionMatrix * mv;
      }`;
  const pointFS = `uniform float uOpacity; varying float vA; varying vec3 vC;
      void main(){ float d = length(gl_PointCoord - 0.5); if (!(d <= 0.5)) discard; gl_FragColor = vec4(vC, vA * smoothstep(0.5, 0.05, d) * uOpacity); }`;
  const brainUniforms = { ...U, uColA: { value: new T.Color() }, uColB: { value: new T.Color() }, uOpacity: { value: 1 }, uDim: { value: 0 },
    uArea: { value: -1 }, uTintK: { value: 0.25 }, uTints: { value: Array.from({ length: MAX_TINT }, () => new T.Color()) } };
  const brainMat = new T.ShaderMaterial({ uniforms: { ...brainUniforms, uGhost: { value: 0 } }, vertexShader: brainVS, fragmentShader: pointFS, transparent: true, depthWrite: false, depthTest: true, blending: T.AdditiveBlending });
  const ghostMat = new T.ShaderMaterial({ uniforms: { ...brainUniforms, uGhost: { value: 0.035 } }, vertexShader: brainVS, fragmentShader: pointFS, transparent: true, depthWrite: false, depthTest: false, blending: T.AdditiveBlending });
  const brain = new T.Points(brainGeo, brainMat); brain.renderOrder = 1; scene.add(brain);
  const ghost = new T.Points(brainGeo, ghostMat); ghost.renderOrder = 1; scene.add(ghost);

  // --- Innenleben: dünner Nebel im Volumen (lichter innen, dichter an der Oberfläche)
  const hazeGeo = new T.BufferGeometry();
  { const a = [], tmp = [0, 0, 0]; for (let q = 0; q < G3 && a.length < 21000; q++) if (OCC[q] > 235 && rnd() < 0.12) { cellCenter(q, tmp); a.push(tmp[0] + (rnd() - 0.5) * GRID.step, tmp[1] + (rnd() - 0.5) * GRID.step, tmp[2] + (rnd() - 0.5) * GRID.step); } hazeGeo.setAttribute("position", new T.Float32BufferAttribute(a, 3)); }
  // three.js zeichnet PointsMaterial-Punkte als Quadrate ohne Größengrenze: ein Dunstpunkt direkt vor der Kamera wurde
  // beim Hineinzoomen bildschirmgroß (schwarzes Quadrat). Darum Größe begrenzen und Punkte an/hinter der Kamera verwerfen.
  const punktGrenze = (mat, maxPx) => {
    mat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace("#include <fog_vertex>",
        "#include <fog_vertex>\n  gl_PointSize = (-mvPosition.z > 0.06) ? min(gl_PointSize, " + maxPx.toFixed(1) + ") : 0.0;");
    };
    return mat;
  };
  const hazeMat = new T.PointsMaterial({ size: 0.006, color: 0x6f8cff, transparent: true, opacity: 0.07, depthWrite: false, depthTest: false, blending: T.AdditiveBlending, sizeAttenuation: true });
  punktGrenze(hazeMat, 5 * DPR);
  const haze = new T.Points(hazeGeo, hazeMat); haze.renderOrder = 1; scene.add(haze);
  const glowMat = new T.SpriteMaterial({ map: radialTex(), color: 0x3a5fd9, transparent: true, opacity: 0.12, depthWrite: false, depthTest: false, blending: T.AdditiveBlending });
  const glow = new T.Sprite(glowMat); glow.scale.set(3.4, 2.8, 1); glow.position.set(-0.05, -0.05, 0); glow.renderOrder = -1; scene.add(glow);
  function radialTex() {
    const c = document.createElement("canvas"); c.width = c.height = 256; const g = c.getContext("2d");
    const gr = g.createRadialGradient(128, 128, 0, 128, 128, 128); gr.addColorStop(0, "rgba(255,255,255,1)"); gr.addColorStop(0.35, "rgba(255,255,255,.35)"); gr.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = gr; g.fillRect(0, 0, 256, 256); return new T.CanvasTexture(c);
  }

  // --- Inbox-Wolke
  const inboxGeo = new T.BufferGeometry();
  { const a = []; const R = REG.inbox; for (let i = 0; i < 700; i++) { const th = rnd() * Math.PI * 2, ph = Math.acos(2 * rnd() - 1), g = Math.pow(rnd(), 0.9); a.push(R.c[0] + R.r[0] * g * Math.sin(ph) * Math.cos(th) * 1.5, R.c[1] + R.r[1] * g * Math.cos(ph) * 1.5, R.c[2] + R.r[2] * g * Math.sin(ph) * Math.sin(th) * 1.5); } inboxGeo.setAttribute("position", new T.Float32BufferAttribute(a, 3)); }
  const inboxMat = new T.PointsMaterial({ size: 0.008, color: 0xb8a4ff, transparent: true, opacity: 0.3, depthWrite: false, blending: T.AdditiveBlending, sizeAttenuation: true });
  punktGrenze(inboxMat, 6 * DPR);
  scene.add(new T.Points(inboxGeo, inboxMat));

  // --- Knoten: eine Points-Geometrie für alle Seiten. Aufleuchten (Live-Lesen) über das Attribut „glow“
  // (Startzeit in uTime-Sekunden) — der Shader rechnet das 8-s-Glühen selbst, nichts wird neu aufgebaut.
  const GLUEH_S = 8;
  // Gemeinsamer Vertex-Shader für Kern (nodeMat) und Lichthof (haloMat). Form je Typ (FORMEN), Größe aus der
  // Bedeutungsstufe; MCP-Server (Form 6) zeichnen eigene Logo-Plaketten (mcpMat), hier also nicht.
  const nodeVS = `
      attribute vec3 color; attribute float size, vis, hl, ring, pulse, phase, glow, form;
      uniform float uPR, uTime, uScale, uCare, uMotion, uGlueh; varying vec3 vC; varying float vA, vRing, vHl, vPulse, vGlow, vForm;
      void main(){
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        float p = pulse > 0.5 ? (uMotion > 0.5 ? 0.5 + 0.5 * sin(uTime * 2.4 + phase) : 0.6) : 0.0;
        float age = uTime - glow;
        float g = (age >= 0.0 && age < uGlueh) ? (1.0 - smoothstep(uGlueh * 0.6, uGlueh, age)) * (uMotion > 0.5 ? 0.8 + 0.2 * sin(age * 5.0) : 1.0) : 0.0;
        vPulse = p; vGlow = vis > 0.01 ? g : 0.0;
        float s = size * 1.6 * (1.0 + 0.4 * hl + 0.12 * p + 0.8 * vGlow) * (ring > 0.5 ? 1.0 + 0.35 * uCare : 1.0);
        // Punkte dicht vor oder hinter der Kamera (beim Hineinzoomen) nie zeichnen und die Größe begrenzen: sonst wird
        // gl_PointSize unendlich, gl_PointCoord ungültig, der Kreis-Test greift nicht und ein schwarzes Quadrat entsteht.
        float tiefe = -mv.z;
        gl_PointSize = tiefe > 0.06 ? min(uPR * uScale * s * 70.0 / tiefe, uPR * 160.0) : 0.0;
        if (form > 5.5) gl_PointSize = 0.0;
        gl_Position = projectionMatrix * mv;
        vC = color; vA = max(vis, vGlow); vRing = ring; vHl = hl; vForm = form;
      }`;
  const nodeMat = new T.ShaderMaterial({
    uniforms: { ...U, uRingK: { value: new T.Color() }, uRingP: { value: new T.Color() }, uRingA: { value: new T.Color() }, uCare: { value: 0 }, uBack: { value: 0.55 }, uGlueh: { value: GLUEH_S } },
    vertexShader: nodeVS,
    fragmentShader: `
      uniform vec3 uRingK, uRingP, uRingA; uniform float uLight, uCare, uBack; varying vec3 vC; varying float vA, vRing, vHl, vPulse, vGlow, vForm;
      void main(){
        vec2 p = (gl_PointCoord - 0.5) * 2.0;
        float d = length(p);
        if (!(d <= 1.0)) discard; // fängt auch ungültige (NaN) Werte ab
        float r = 0.34, aa = 0.07, sd;
        if (vForm < 0.5 || vForm > 4.5) sd = d - r;                                   // Thema, Überblick: Kreis
        else if (vForm < 1.5) sd = d - r * 0.55;                                        // Steckbrief: Kern …
        else if (vForm < 2.5) sd = (abs(p.x) + abs(p.y)) * 0.74 - r;                   // Quelle: Raute
        else if (vForm < 3.5) { float w = abs(cos(2.0 * atan(p.y, p.x)));              // Synthese: Stern, vier Zacken
          sd = d - r * (0.42 + 0.9 * w * w * w); }
        else sd = d - r * 0.8;                                                          // Notiz: kleiner Kreis
        float core = smoothstep(aa, -aa, sd);
        if (vForm > 0.5 && vForm < 1.5) core = max(core, smoothstep(0.06, 0.0, abs(d - r * 1.05) - 0.045)); // … mit Ring
        float back = smoothstep(r + 0.36, r + 0.04, d) * uBack;
        vec3 kern = uLight > 0.5 ? vC * 0.92 : mix(vC, vec3(1.0), 0.28 + 0.3 * vHl + 0.4 * vGlow);
        vec3 grund = uLight > 0.5 ? vec3(1.0) : vec3(0.008, 0.012, 0.03);
        vec3 c = mix(grund, kern, core);
        float a = max(core, back * (1.0 - core));
        if (vRing > 0.5) {
          vec3 rc = vRing > 2.5 ? uRingA : vRing > 1.5 ? uRingK : uRingP;
          float rr = smoothstep(0.1, 0.0, abs(d - 0.76) - 0.02) * (0.8 + 0.2 * uCare);
          c = mix(c, rc, rr); a = max(a, rr);
        }
        gl_FragColor = vec4(c, a * vA);
      }`,
    transparent: true, depthWrite: false, depthTest: false, blending: T.NormalBlending,
  });
  // Lichthof (nur dunkel, additiv): weiches Leuchten in der Bereichsfarbe, Puls frischer Seiten, Aufleuchten
  const haloMat = new T.ShaderMaterial({
    uniforms: nodeMat.uniforms, vertexShader: nodeVS,
    fragmentShader: `
      uniform float uHalo, uLight; varying vec3 vC; varying float vA, vRing, vHl, vPulse, vGlow, vForm;
      void main(){
        float d = length(gl_PointCoord - 0.5) * 2.0;
        if (!(d <= 1.0)) discard;
        float h = (exp(-d * d * 5.0) * (0.35 + 0.65 * vHl) + vPulse * exp(-d * d * 3.0) * 0.5) * uHalo + vGlow * exp(-d * d * 2.2) * 0.95;
        gl_FragColor = vec4(vC * h * 1.15, h * vA);
      }`,
    transparent: true, depthWrite: false, depthTest: false, blending: T.AdditiveBlending,
  });
  nodeMat.uniforms.uHalo = { value: 1 };
  let P = new Float32Array(0), nodes = null, halos = null, nodeGeo = null;
  let nCol, nSize, nVis, nHl, nRing, nPulse, nPhase, nGlow, nForm, aCol, aVis, aHl, aGlow, aRing;

  // --- Nervenbahnen: gebündelt über Regions-Knotenpunkte, mit gelegentlichen Impulsen. Kleine/mittlere Brains
  // zeichnen alle Kanten; große (> KANTEN_ALLE_BIS Seiten) nur die der Auswahl, des Wegs oder der Suchtreffer.
  const KANTEN_ALLE_BIS = 1500;
  const edgeMat = new T.ShaderMaterial({
    uniforms: { ...U, uBase: { value: 0.12 }, uSignal: { value: 1 }, uInnen: { value: 1 }, uQuer: { value: 1 } },
    vertexShader: `
      attribute vec3 color; attribute float t, ea, ehl, ph, quer; varying vec3 vC; varying float vA;
      uniform float uTime, uBase, uSignal, uMotion, uInnen, uQuer;
      void main(){
        float cyc = uTime * 0.13 + ph * 7.0;
        float s = fract(cyc);
        float gate = step(0.8, fract(sin(floor(cyc) * 12.9898 + ph * 78.233) * 43758.5453));
        float sig = smoothstep(0.07, 0.0, abs(t - s)) * uSignal * uMotion * clamp(gate + ehl, 0.0, 1.0);
        float ends = smoothstep(0.0, 0.12, t) * smoothstep(1.0, 0.88, t);
        // Überblick: Kanten zwischen Bereichen stecken in den Bündeln (uQuer), Kanten im Bereich sehr dezent (uInnen)
        float zoomK = ehl > 0.01 ? 1.0 : mix(uInnen, uQuer, quer);
        vA = ea * zoomK * (uBase * (0.35 + 0.65 * ends) * (1.0 + 2.6 * ehl) + sig * (0.5 + 0.9 * ehl));
        vC = color * (1.0 + 0.6 * ehl);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `varying vec3 vC; varying float vA; void main(){ gl_FragColor = vec4(vC, vA); }`,
    transparent: true, depthWrite: false, depthTest: false, blending: T.AdditiveBlending,
  });
  const CENTER = new T.Vector3(-0.08, 0.05, 0);
  let SEG = 22, kantenAlle = true, slots = [], edges = null, kurven = new Map();
  let eCol, eA, eHl, eBase, eVisCur, eHlCur, eVisT, eHlT, aeCol, aeA, aeHl;
  const hubOf = (i) => new T.Vector3(...nodeHub[i]).lerp(CENTER, 0.35);
  function kurve(k) {
    let pts = kurven.get(k); if (pts) return pts;
    const e = D.edges[k];
    const a = new T.Vector3(P[e.a*3], P[e.a*3+1], P[e.a*3+2]), b = new T.Vector3(P[e.b*3], P[e.b*3+1], P[e.b*3+2]);
    let curve;
    if (D.nodes[e.a].area !== D.nodes[e.b].area || (beidseitig(D.nodes[e.a].area) && nodeSide[e.a] !== nodeSide[e.b])) {
      const ha = hubOf(e.a), hb = hubOf(e.b);
      const lift = new T.Vector3(0, 0.12 + a.distanceTo(b) * 0.1, 0);
      curve = new T.CubicBezierCurve3(a, a.clone().lerp(ha, 0.8).add(lift), b.clone().lerp(hb, 0.8).add(lift), b);
    } else {
      const mid = a.clone().add(b).multiplyScalar(0.5), dist = a.distanceTo(b);
      const ctrl = mid.lerp(new T.Vector3(...(D.nodes[e.a]._g || [0, 0, 0])), 0.35); ctrl.y += dist * 0.15;
      curve = new T.QuadraticBezierCurve3(a, ctrl, b);
    }
    pts = new Float32Array((SEG + 1) * 3);
    curve.getPoints(SEG).forEach((p, s) => { pts[s*3] = p.x; pts[s*3+1] = p.y; pts[s*3+2] = p.z; });
    kurven.set(k, pts);
    return pts;
  }
  // Geometrie für die Kanten `liste` (Indizes in D.edges). Bereits gezeichnete Kanten behalten ihren Blendstand.
  function baueKanten(liste) {
    const alt = new Map(); slots.forEach((k, s) => alt.set(k, [eVisCur[s], eHlCur[s]]));
    slots = liste;
    const M = liste.length, V = M * SEG * 2;
    const ePos = new Float32Array(V * 3), eT = new Float32Array(V), ePh = new Float32Array(V), eQ = new Float32Array(V);
    eCol = new Float32Array(V * 3); eA = new Float32Array(V); eHl = new Float32Array(V);
    eBase = new Float32Array(M); eVisCur = new Float32Array(M); eHlCur = new Float32Array(M); eVisT = new Float32Array(M); eHlT = new Float32Array(M);
    liste.forEach((k, s) => {
      const e = D.edges[k], pts = kurve(k), ph = hash(e.s + "|" + e.t), av = alt.get(k), q = D.nodes[e.a].area !== D.nodes[e.b].area ? 1 : 0;
      eBase[s] = e.kind === "quelle" ? 0.55 : 1;
      eVisCur[s] = eVisT[s] = av ? av[0] : kantenAlle ? 1 : 0; eHlCur[s] = av ? av[1] : 0;
      for (let g = 0; g < SEG; g++) for (let h = 0; h < 2; h++) {
        const v = (s * SEG + g) * 2 + h, p = (g + h) * 3;
        ePos[v*3] = pts[p]; ePos[v*3+1] = pts[p+1]; ePos[v*3+2] = pts[p+2];
        eT[v] = (g + h) / SEG; ePh[v] = ph; eQ[v] = q; eA[v] = eVisCur[s]; eHl[v] = eHlCur[s];
      }
    });
    const geo = new T.BufferGeometry();
    geo.setAttribute("position", new T.BufferAttribute(ePos, 3));
    aeCol = new T.BufferAttribute(eCol, 3); aeA = new T.BufferAttribute(eA, 1); aeHl = new T.BufferAttribute(eHl, 1);
    geo.setAttribute("color", aeCol); geo.setAttribute("t", new T.BufferAttribute(eT, 1)); geo.setAttribute("ea", aeA); geo.setAttribute("ehl", aeHl); geo.setAttribute("ph", new T.BufferAttribute(ePh, 1)); geo.setAttribute("quer", new T.BufferAttribute(eQ, 1));
    if (edges) { scene.remove(edges); edges.geometry.dispose(); }
    edges = new T.LineSegments(geo, edgeMat); edges.renderOrder = 2; edges.frustumCulled = false; scene.add(edges);
    faerbeKanten();
  }
  function faerbeKanten() {
    if (!edges) return;
    const mixC = new T.Color(light ? "#33405f" : "#c9d6ff"), ca = new T.Color(), cb = new T.Color();
    slots.forEach((k, s) => {
      const e = D.edges[k]; ca.set(areaColor(D.nodes[e.a].area)); cb.set(areaColor(D.nodes[e.b].area));
      for (let g = 0; g < SEG; g++) for (let h = 0; h < 2; h++) {
        const v = (s * SEG + g) * 2 + h, f = (g + h) / SEG;
        eCol[v*3] = (ca.r + (cb.r - ca.r) * f) * 0.65 + mixC.r * 0.35;
        eCol[v*3+1] = (ca.g + (cb.g - ca.g) * f) * 0.65 + mixC.g * 0.35;
        eCol[v*3+2] = (ca.b + (cb.b - ca.b) * f) * 0.65 + mixC.b * 0.35;
      }
    });
    aeCol.needsUpdate = true;
  }

  // --- Bündel: alle Kanten zwischen zwei Bereichen als EIN weicher Bogen (Band in Bildschirmbreite), vorab
  // berechnet in ladeDaten; Breite nach Anzahl (buendelBreite). Hover zeigt „A ↔ B: n Verbindungen“.
  const BSEG = 40;
  const buendelMat = new T.ShaderMaterial({
    uniforms: { ...U, uRes: { value: new T.Vector2(1, 1) }, uAlpha: { value: 1 } },
    vertexShader: `
      attribute vec3 nach; attribute float seite, t, breite, bhl, stark; attribute vec3 ca, cb;
      uniform vec2 uRes; uniform float uPR; varying vec3 vC; varying float vS, vT, vHl, vK;
      void main(){
        vec4 a = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        vec4 b = projectionMatrix * modelViewMatrix * vec4(nach, 1.0);
        vec2 sa = a.xy / max(a.w, 1e-4) * uRes, sb = b.xy / max(b.w, 1e-4) * uRes;
        vec2 dir = sb - sa; float l = length(dir); dir = l > 1e-5 ? dir / l : vec2(1.0, 0.0);
        vec2 nrm = vec2(-dir.y, dir.x);
        float w = breite * uPR * (1.0 + 0.5 * bhl) * (0.35 + 0.65 * sin(3.14159 * clamp(t, 0.0, 1.0)));
        a.xy += nrm * seite * w / uRes * a.w;
        gl_Position = a;
        vC = mix(ca, cb, t); vS = seite; vT = t; vHl = bhl; vK = stark;
      }`,
    fragmentShader: `
      uniform float uAlpha, uLight, uTime, uMotion; varying vec3 vC; varying float vS, vT, vHl, vK;
      void main(){
        float q = abs(vS);
        float enden = smoothstep(0.0, 0.12, vT) * smoothstep(1.0, 0.88, vT);
        // heller Kern in der Bereichsfarbe, weicher dunkler Saum (hebt das Band von der leuchtenden Rinde ab)
        float kern = smoothstep(0.55, 0.0, q), saum = 1.0 - q * q;
        float fluss = uMotion * 0.35 * smoothstep(0.1, 0.0, abs(fract(vT * 1.5 - uTime * 0.06 + vC.r * 3.1) - 0.5));
        vec3 hell = uLight > 0.5 ? vC * 0.78 : mix(vC, vec3(1.0), 0.1 + 0.3 * vHl + fluss);
        vec3 grund = uLight > 0.5 ? vec3(1.0) : vec3(0.01, 0.014, 0.03);
        float k = kern * (0.42 + 0.45 * vHl + fluss) * max(vK, vHl);
        vec3 c = mix(grund, hell, clamp(k / max(k + saum * 0.32, 1e-4), 0.0, 1.0));
        float a = clamp(k + saum * 0.3 * max(vK, vHl) * (1.0 - k), 0.0, 1.0) * enden * uAlpha;
        gl_FragColor = vec4(c, a);
      }`,
    transparent: true, depthWrite: false, depthTest: false, blending: T.NormalBlending, side: T.DoubleSide,
  });
  let buendelListe = [], buendelObj = null, buendelPunkte = [], buendelHover = -1, aBhl = null;
  // Anker eines Bereichs: Schwerpunkt seiner Seiten (Schläfenlappen: Seite des Gegenübers), etwas zur Oberfläche hin
  function bereichsAnker(a, gegen) {
    const sum = { "-1": [0, 0, 0, 0], "1": [0, 0, 0, 0] };
    D.nodes.forEach((n, i) => { if (n.area === a && n.type !== "mcp") { const s = sum[nodeSide[i] < 0 ? "-1" : "1"]; s[0] += P[i*3]; s[1] += P[i*3+1]; s[2] += P[i*3+2]; s[3]++; } });
    const mit = (s) => (s[3] ? new T.Vector3(s[0] / s[3], s[1] / s[3], s[2] / s[3]) : null);
    let v;
    if (beidseitig(a) && gegen) { const l = mit(sum["-1"]), r = mit(sum["1"]); v = l && r ? (l.distanceTo(gegen) < r.distanceTo(gegen) ? l : r) : l || r; }
    else { const g = [sum["-1"][0] + sum["1"][0], sum["-1"][1] + sum["1"][1], sum["-1"][2] + sum["1"][2], sum["-1"][3] + sum["1"][3]]; v = mit(g); }
    if (a === "werkzeuge" && mcpMitte) return mcpMitte.clone();
    if (!v) v = isWolke(a) ? new T.Vector3(...REG.inbox.c) : new T.Vector3(...buildArea(a).c);
    return aufOberflaeche(v);
  }
  // Punkt in Richtung (v − Mitte) auf die Rinde schieben: größter Abstand der Rindenpunkte in einem engen Kegel
  function aufOberflaeche(v) {
    const d = v.clone().sub(CENTER), l = d.length(); if (l < 1e-6) return v;
    d.divideScalar(l);
    const pos = cloud.pos; let r = 0;
    for (let i = 0; i < pos.length; i += 3 * 7) {
      const x = pos[i] - CENTER.x, y = pos[i+1] - CENTER.y, z = pos[i+2] - CENTER.z, q = Math.sqrt(x * x + y * y + z * z) || 1;
      if ((x * d.x + y * d.y + z * d.z) / q > 0.985 && q > r) r = q;
    }
    return r > l ? CENTER.clone().addScaledVector(d, r * 0.97) : v;
  }
  function baueBuendel() {
    if (buendelObj) { scene.remove(buendelObj); buendelObj.geometry.dispose(); buendelObj = null; }
    // Überblick und Inbox bündeln wir nicht: der Überblick verlinkt naturgemäß alles, die Inbox ist Durchgang
    const ohne = (a) => a === "zentrum" || isWolke(a);
    buendelListe = buendel(E, (k) => [D.nodes[D.edges[k].a].area, D.nodes[D.edges[k].b].area], (k) => !ohne(D.nodes[D.edges[k].a].area) && !ohne(D.nodes[D.edges[k].b].area));
    buendelPunkte = []; buendelHover = -1;
    const M = buendelListe.length; if (!M) return;
    const V = M * (BSEG + 1) * 2, I = [];
    const pos = new Float32Array(V * 3), nach = new Float32Array(V * 3), seite = new Float32Array(V), tt = new Float32Array(V), br = new Float32Array(V), hl = new Float32Array(V), st = new Float32Array(V), ca = new Float32Array(V * 3), cb = new Float32Array(V * 3);
    const A = new T.Color(), B = new T.Color();
    buendelListe.forEach((bd, m) => {
      const pa0 = bereichsAnker(bd.a, null), pb = bereichsAnker(bd.b, pa0), pa = bereichsAnker(bd.a, pb);
      // Bogen über die Oberfläche (wie eine Flugroute über einen Globus), nicht quer durchs Innere
      const mid = pa.clone().add(pb).multiplyScalar(0.5), aus = mid.clone().sub(CENTER);
      if (aus.lengthSq() < 1e-6) aus.set(0, 1, 0);
      aus.normalize();
      const rand = Math.max(pa.distanceTo(CENTER), pb.distanceTo(CENTER));
      const ctrl = CENTER.clone().addScaledVector(aus, rand * (1.07 + 0.17 * pa.distanceTo(pb)));
      const kurve = new T.QuadraticBezierCurve3(pa, ctrl, pb), pts = kurve.getPoints(BSEG);
      buendelPunkte.push(pts);
      A.set(areaColor(bd.a)); B.set(areaColor(bd.b));
      const w = buendelBreite(bd.n);
      for (let s = 0; s <= BSEG; s++) {
        const p = pts[s], q = pts[Math.min(BSEG, s + 1)], qq = s === BSEG ? pts[s].clone().multiplyScalar(2).sub(pts[s - 1]) : q;
        for (let h = 0; h < 2; h++) {
          const v = (m * (BSEG + 1) + s) * 2 + h;
          pos[v*3] = p.x; pos[v*3+1] = p.y; pos[v*3+2] = p.z; nach[v*3] = qq.x; nach[v*3+1] = qq.y; nach[v*3+2] = qq.z;
          seite[v] = h ? 1 : -1; tt[v] = s / BSEG; br[v] = w;
          ca[v*3] = A.r; ca[v*3+1] = A.g; ca[v*3+2] = A.b; cb[v*3] = B.r; cb[v*3+1] = B.g; cb[v*3+2] = B.b;
        }
        if (s < BSEG) { const o = (m * (BSEG + 1) + s) * 2; I.push(o, o + 1, o + 2, o + 1, o + 3, o + 2); }
      }
    });
    const geo = new T.BufferGeometry();
    geo.setAttribute("position", new T.BufferAttribute(pos, 3)); geo.setAttribute("nach", new T.BufferAttribute(nach, 3));
    geo.setAttribute("seite", new T.BufferAttribute(seite, 1)); geo.setAttribute("t", new T.BufferAttribute(tt, 1)); geo.setAttribute("breite", new T.BufferAttribute(br, 1));
    aBhl = new T.BufferAttribute(hl, 1); geo.setAttribute("bhl", aBhl); geo.setAttribute("stark", new T.BufferAttribute(st, 1));
    geo.setAttribute("ca", new T.BufferAttribute(ca, 3)); geo.setAttribute("cb", new T.BufferAttribute(cb, 3));
    geo.setIndex(I);
    buendelObj = new T.Mesh(geo, buendelMat); buendelObj.renderOrder = 2; buendelObj.frustumCulled = false; scene.add(buendelObj);
  }
  // Bündel-Sichtbarkeit (Filter) und Hervorhebung: Anzahl der sichtbaren Kanten je Bündel, 0 → ausgeblendet
  function setzeBuendelSicht() {
    if (!buendelObj) return;
    const a = aBhl.array, br = buendelObj.geometry.getAttribute("breite"), st = buendelObj.geometry.getAttribute("stark");
    let max = 1;
    buendelListe.forEach((bd) => { let n = 0; for (const k of bd.kanten) if (nodeOn[D.edges[k].a] && nodeOn[D.edges[k].b]) n++; bd.sichtbar = n; if (n > max) max = n; });
    buendelListe.forEach((bd, m) => {
      const n = bd.sichtbar, w = n ? buendelBreite(n) : 0, h = m === buendelHover ? 1 : 0;
      // Stärke relativ zum größten Bündel: wenige große Ströme tragen das Bild, kleine bleiben ein Hauch
      const k = n ? 0.22 + 0.78 * Math.sqrt(n / max) : 0;
      for (let v = m * (BSEG + 1) * 2; v < (m + 1) * (BSEG + 1) * 2; v++) { br.array[v] = w; a[v] = h; st.array[v] = k; }
    });
    br.needsUpdate = true; aBhl.needsUpdate = true; st.needsUpdate = true;
  }
  // Bündel unter dem Mauszeiger (Bildschirmabstand zur Mittellinie), sonst -1
  function pickBuendel(cx, cy) {
    if (!buendelObj || buendelMat.uniforms.uAlpha.value < 0.2) return -1;
    const rect = canvas.getBoundingClientRect(), w = rect.width, h = rect.height;
    let best = -1, bd = Infinity;
    buendelPunkte.forEach((pts, m) => {
      const b = buendelListe[m]; if (!b.sichtbar) return;
      let prev = null;
      for (let s = 0; s <= BSEG; s += 2) {
        v3.copy(pts[s]).project(camera); if (v3.z > 1) { prev = null; continue; }
        const x = (v3.x * 0.5 + 0.5) * w + rect.left, y = (-v3.y * 0.5 + 0.5) * h + rect.top;
        if (prev) {
          const dx = x - prev[0], dy = y - prev[1], l2 = dx * dx + dy * dy || 1;
          const u = Math.max(0, Math.min(1, ((cx - prev[0]) * dx + (cy - prev[1]) * dy) / l2));
          const ex = prev[0] + u * dx - cx, ey = prev[1] + u * dy - cy, dd = Math.sqrt(ex * ex + ey * ey);
          const tol = buendelBreite(b.sichtbar) * 0.5 * Math.sin(Math.PI * (s / BSEG)) + 5;
          if (dd < tol && dd < bd) { bd = dd; best = m; }
        }
        prev = [x, y];
      }
    });
    return best;
  }

  // --- MCP-Server als Logo-Plaketten unter dem Hirnstamm, nach Herkunft (gruppe) in kleinen Waben gruppiert.
  // Logos: vendor/icons (Simple Icons, CC0) über BrainIcons.ladeAtlas, sonst Monogramm. Ungenutzte halbtransparent.
  const ZELLE = 128;
  let mcpIdx = [], mcpMitte = null, mcpGruppen = [], mcpObj = null, mcpGeo = null, mcpVis = null, mcpHl = null, aMcpVis = null, aMcpHl = null;
  let mcpLogos = null, mcpLogoLaden = null;
  const mcpAtlas = document.createElement("canvas");
  const mcpTex = new T.CanvasTexture(mcpAtlas); mcpTex.colorSpace = T.SRGBColorSpace; mcpTex.generateMipmaps = true; mcpTex.minFilter = T.LinearMipmapLinearFilter; mcpTex.anisotropy = 4;
  const mcpMat = new T.ShaderMaterial({
    uniforms: { ...U, uAtlas: { value: mcpTex }, uGitter: { value: new T.Vector2(1, 1) } },
    vertexShader: `
      attribute float zelle, mvis, mhl; uniform float uPR, uScale; varying float vZ, vA, vH;
      void main(){
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        float tiefe = -mv.z;
        gl_PointSize = tiefe > 0.06 ? min(uPR * uScale * (26.0 + 8.0 * mhl) * 4.6 / tiefe, uPR * 110.0) : 0.0;
        gl_Position = projectionMatrix * mv;
        vZ = zelle; vA = mvis; vH = mhl;
      }`,
    fragmentShader: `
      uniform sampler2D uAtlas; uniform vec2 uGitter; varying float vZ, vA, vH;
      void main(){
        vec2 pc = gl_PointCoord;
        if (!(length(pc - 0.5) <= 0.5)) discard;
        float sp = mod(vZ, uGitter.x), ze = floor(vZ / uGitter.x);
        vec4 c = texture2D(uAtlas, vec2((sp + pc.x) / uGitter.x, 1.0 - (ze + pc.y) / uGitter.y));
        gl_FragColor = vec4(c.rgb * (1.0 + 0.25 * vH), c.a * vA);
      }`,
    transparent: true, depthWrite: false, depthTest: false, blending: T.NormalBlending,
  });
  const mcpAnzeige = (n) => mcpName(n.title || n.name);
  const mcpAufrufe = (n) => (typeof n.lesezahl === "number" ? n.lesezahl : mcpInfo.get(n.name)?.benutzt || 0);
  // Plätze: Ring unter dem Hirnstamm, größte Herkunftsgruppe vorn (zur Startkamera), je Gruppe eine senkrechte Wabe
  function platziereMcp() {
    mcpIdx = []; mcpGruppen = []; mcpMitte = null;
    D.nodes.forEach((n, i) => { if (n.type === "mcp") mcpIdx.push(i); });
    if (!mcpIdx.length) return;
    const st = buildArea("werkzeuge").c;
    mcpMitte = new T.Vector3(st[0], BM.bmin[1] - 0.1, 0);
    const nachGruppe = new Map();
    for (const i of mcpIdx) { const g = D.nodes[i].gruppe || D.nodes[i].group || "MCP"; if (!nachGruppe.has(g)) nachGruppe.set(g, []); nachGruppe.get(g).push(i); }
    const liste = [...nachGruppe].map(([name, ii]) => ({ name, n: ii.length, ii }));
    const winkel = gruppenWinkel(liste, Math.PI * 0.72);
    mcpPlan = liste.map((g, k) => {
      g.ii.sort((a, b) => mcpAufrufe(D.nodes[b]) - mcpAufrufe(D.nodes[a]) || (D.nodes[a].title < D.nodes[b].title ? -1 : 1));
      const plaetze = sechseckScheibe(g.ii.length);
      mcpGruppen.push({ name: g.name, at: new T.Vector3(), n: g.ii.length });
      return { winkel: winkel[k].winkel, ii: g.ii, plaetze, unten: Math.min(0, ...plaetze.map((p) => p[1])) };
    });
    mcpR = 0.6 + 0.04 * Math.max(0, liste.length - 4);
    stelleMcp(Math.atan2(HOME.pos.z - HOME.target.z, HOME.pos.x - HOME.target.x));
  }
  // Die Plaketten-Reihe dreht sich um die Achse des Hirnstamms mit, damit sie der Kamera immer zugewandt bleibt
  // (sonst stünden die Waben von der Seite gesehen hintereinander). Im Auswahl-/Suchmodus bleibt sie stehen.
  let mcpPlan = [], mcpR = 0.6, mcpVorn = null, mcpKantenT = 0, mcpKantenAlt = false;
  const MCP_ABST = 0.08;
  function stelleMcp(vorn) {
    mcpVorn = vorn;
    mcpPlan.forEach((g, k) => {
      const w = vorn + g.winkel, cx = mcpMitte.x + Math.cos(w) * mcpR, cz = mcpMitte.z + Math.sin(w) * mcpR, tx = -Math.sin(w), tz = Math.cos(w);
      g.ii.forEach((i, r) => {
        const [x, y] = g.plaetze[r];
        P[i*3] = cx + tx * x * MCP_ABST; P[i*3+1] = mcpMitte.y + y * MCP_ABST; P[i*3+2] = cz + tz * x * MCP_ABST;
      });
      mcpGruppen[k].at.set(cx, mcpMitte.y + (g.unten - 1.05) * MCP_ABST, cz);
    });
  }
  function mcpFolgtKamera() {
    if (!mcpMitte || !mcpObj || S.mode !== "none" || fly) return;
    const vorn = Math.atan2(camera.position.z - mcpMitte.z, camera.position.x - mcpMitte.x);
    let d = vorn - mcpVorn; d = Math.atan2(Math.sin(d), Math.cos(d));
    if (Math.abs(d) < 1e-3) return;
    stelleMcp(vorn);
    const pos = mcpGeo.getAttribute("position");
    mcpIdx.forEach((i, m) => { pos.array[m*3] = P[i*3]; pos.array[m*3+1] = P[i*3+1]; pos.array[m*3+2] = P[i*3+2]; });
    pos.needsUpdate = true; nodeGeo.getAttribute("position").needsUpdate = true;
    mcpKantenAlt = true;
  }
  // Kanten an MCP-Knoten folgen den Plaketten (gedrosselt neu gebaut)
  function mcpKantenNachziehen() {
    if (!mcpKantenAlt || performance.now() - mcpKantenT < 200) return;
    mcpKantenAlt = false; mcpKantenT = performance.now();
    let neu = false;
    for (const [k] of kurven) { const e = D.edges[k]; if (D.nodes[e.a].type === "mcp" || D.nodes[e.b].type === "mcp") { kurven.delete(k); neu = true; } }
    if (neu) baueKanten(slots);
  }
  function baueMcp() {
    if (mcpObj) { scene.remove(mcpObj); mcpGeo.dispose(); mcpObj = null; }
    if (!mcpIdx.length) return;
    const M = mcpIdx.length, pos = new Float32Array(M * 3), zelle = new Float32Array(M);
    mcpVis = new Float32Array(M); mcpHl = new Float32Array(M);
    mcpIdx.forEach((i, m) => { pos[m*3] = P[i*3]; pos[m*3+1] = P[i*3+1]; pos[m*3+2] = P[i*3+2]; zelle[m] = m; });
    mcpGeo = new T.BufferGeometry();
    mcpGeo.setAttribute("position", new T.BufferAttribute(pos, 3)); mcpGeo.setAttribute("zelle", new T.BufferAttribute(zelle, 1));
    aMcpVis = new T.BufferAttribute(mcpVis, 1); aMcpHl = new T.BufferAttribute(mcpHl, 1);
    mcpGeo.setAttribute("mvis", aMcpVis); mcpGeo.setAttribute("mhl", aMcpHl);
    mcpObj = new T.Points(mcpGeo, mcpMat); mcpObj.renderOrder = 5; mcpObj.frustumCulled = false; scene.add(mcpObj);
    zeichneMcpAtlas();
    // Logos einmal je Slug-Satz laden (eigener Ursprung); ohne Dienst (file://) bleibt es beim Monogramm
    const slugs = [...new Set(mcpIdx.map((i) => D.nodes[i].icon).filter((s) => typeof s === "string" && /^[a-z0-9-]+$/.test(s)))];
    const schluessel = slugs.join(",");
    if (!slugs.length || location.protocol === "file:" || !window.BrainIcons || (mcpLogos && mcpLogos.schluessel === schluessel) || mcpLogoLaden === schluessel) return;
    mcpLogoLaden = schluessel;
    window.BrainIcons.ladeAtlas(slugs, { groesse: ZELLE }).then((r) => { mcpLogos = { ...r, schluessel }; zeichneMcpAtlas(); }, () => {}).finally(() => { mcpLogoLaden = null; });
  }
  function zeichneMcpAtlas() {
    if (!mcpIdx.length) return;
    const M = mcpIdx.length, sp = Math.ceil(Math.sqrt(M)), ze = Math.ceil(M / sp);
    mcpAtlas.width = sp * ZELLE; mcpAtlas.height = ze * ZELLE;
    mcpMat.uniforms.uGitter.value.set(sp, ze);
    const g = mcpAtlas.getContext("2d"), tmp = document.createElement("canvas"); tmp.width = tmp.height = ZELLE;
    const tg = tmp.getContext("2d");
    const palette = ["--c-blau", "--c-orange", "--c-gruen", "--c-gelb", "--c-rot", "--c-lila", "--c-tuerkis"].map(css);
    const rand = areaColor("werkzeuge"), logoFarbe = light ? "#1b2233" : "#eef3ff";
    g.clearRect(0, 0, mcpAtlas.width, mcpAtlas.height);
    mcpIdx.forEach((i, m) => {
      const n = D.nodes[i], x = (m % sp) * ZELLE, y = Math.floor(m / sp) * ZELLE, c = ZELLE / 2;
      g.save(); g.translate(x, y);
      g.beginPath(); g.arc(c, c, c - 6, 0, Math.PI * 2);
      g.fillStyle = light ? "rgba(255,255,255,0.97)" : "rgba(9,14,28,0.94)"; g.fill();
      g.lineWidth = 4; g.strokeStyle = rand; g.globalAlpha = 0.85; g.stroke(); g.globalAlpha = 1;
      const uv = mcpLogos && n.icon && mcpLogos.uv[n.icon];
      if (uv) {
        tg.clearRect(0, 0, ZELLE, ZELLE); tg.globalCompositeOperation = "source-over";
        const L = ZELLE * 0.5, o = (ZELLE - L) / 2, cw = mcpLogos.canvas.width, ch = mcpLogos.canvas.height;
        tg.drawImage(mcpLogos.canvas, uv[0] * cw, uv[1] * ch, (uv[2] - uv[0]) * cw, (uv[3] - uv[1]) * ch, o - L * 0.14, o - L * 0.14, L * 1.28, L * 1.28);
        tg.globalCompositeOperation = "source-in"; tg.fillStyle = logoFarbe; tg.fillRect(0, 0, ZELLE, ZELLE);
        g.drawImage(tmp, 0, 0);
      } else {
        const mg = window.BrainIcons ? window.BrainIcons.monogramm(mcpAnzeige(n), palette) : { text: mcpAnzeige(n).slice(0, 2).toUpperCase(), farbe: palette[0] };
        g.fillStyle = mg.farbe; g.font = `600 ${mg.text.length > 1 ? 44 : 54}px Geist, system-ui, sans-serif`;
        g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(mg.text, c, c + 3);
      }
      g.restore();
    });
    mcpTex.needsUpdate = true;
  }
  // Sichtbarkeit/Hervorhebung der Plaketten aus den Knotenwerten (je Bild, nur die wenigen MCP-Knoten)
  function aktualisiereMcp() {
    if (!mcpObj) return;
    let ch = false;
    mcpIdx.forEach((i, m) => {
      const v = nVis[i] * (mcpAufrufe(D.nodes[i]) > 0 ? 1 : 0.4), h = Math.max(nHl[i], i === S.hover ? 1 : 0);
      if (Math.abs(v - mcpVis[m]) > 1e-4 || Math.abs(h - mcpHl[m]) > 1e-4) { mcpVis[m] = v; mcpHl[m] = h; ch = true; }
    });
    if (ch) { aMcpVis.needsUpdate = true; aMcpHl.needsUpdate = true; }
  }

  // Bereichs-Schimmer: jeder Rindenpunkt gehört zum nächstgelegenen Bereich, dessen Region seinen Lappen enthält
  // (teilen sich Bereiche einen Lappen, entscheidet die Nähe zum Schwerpunkt ihrer Seiten — je Hirnhälfte).
  let tintBereiche = [];
  function berechneSchimmer() {
    tintBereiche = D.areas.filter((a) => !isWolke(a.id)).slice(0, MAX_TINT).map((a) => a.id);
    const anker = [];
    tintBereiche.forEach((a, k) => {
      const s = { "-1": [0, 0, 0, 0], "1": [0, 0, 0, 0] };
      D.nodes.forEach((n, i) => { if (n.area === a && n.type !== "mcp") { const q = s[nodeSide[i] < 0 ? "-1" : "1"]; q[0] += P[i*3]; q[1] += P[i*3+1]; q[2] += P[i*3+2]; q[3]++; } });
      const punkte = Object.values(s).filter((q) => q[3]).map((q) => [q[0] / q[3], q[1] / q[3], q[2] / q[3]]);
      if (!punkte.length) { const A = buildArea(a); punkte.push(beidseitig(a) ? A.sideC("-1") : A.c); if (beidseitig(a)) punkte.push(A.sideC("1")); }
      for (const L of lobesOf(a)) for (const p of punkte) anker.push([L, k, p]);
    });
    const proLappen = new Map();
    for (const [L, k, p] of anker) { if (!proLappen.has(L)) proLappen.set(L, []); proLappen.get(L).push([k, p]); }
    const pos = cloud.pos;
    for (let i = 0; i < cloudTint.length; i++) {
      const c = proLappen.get(cloud.lobe[i]);
      if (!c) { cloudTint[i] = -1; continue; }
      if (c.length === 1) { cloudTint[i] = c[0][0]; continue; }
      let best = -1, bd = Infinity;
      for (const [k, p] of c) { const dx = pos[i*3] - p[0], dy = pos[i*3+1] - p[1], dz = pos[i*3+2] - p[2], d = dx * dx + dy * dy + dz * dz; if (d < bd) { bd = d; best = k; } }
      cloudTint[i] = best;
    }
    aTint.needsUpdate = true;
    faerbeSchimmer();
  }
  function faerbeSchimmer() { tintBereiche.forEach((a, k) => brainUniforms.uTints.value[k].set(areaColor(a))); }
  // Hervorgehobener Bereich: Hover über Etikett/Filter vor „nur ein Bereich sichtbar“; sonst keiner
  let bereichHover = null;
  function setzeBereichsLicht() {
    let a = bereichHover;
    if (!a && S && S.mode === "none" && S.areas.size === 1) a = [...S.areas][0];
    const k = a ? tintBereiche.indexOf(a) : -1;
    brainUniforms.uArea.value = k;
    regionEls.forEach((r) => r.el.classList.toggle("an", !!a && r.a === a));
  }

  // ================================================================== theme
  let light = false;
  function applyTheme() {
    light = root.dataset.theme === "light";
    farbCache = {};
    U.uLight.value = light ? 1 : 0;
    scene.background = bgTexture(light);
    const blend = light ? T.NormalBlending : T.AdditiveBlending;
    [brainMat, ghostMat, edgeMat, hazeMat, inboxMat, glowMat].forEach((m) => { m.blending = blend; m.needsUpdate = true; });
    if (halos) halos.visible = !light;
    shellMat.uniforms.uCol.value.set("#5a7dff");
    brainUniforms.uColA.value.set(light ? "#9aa5c4" : "#27357a");
    brainUniforms.uColB.value.set(light ? "#2c3654" : "#c8d2f0");
    brainUniforms.uOpacity.value = light ? 1.1 : 1;
    ghostMat.uniforms.uGhost.value = light ? 0.0 : 0.035;
    hazeMat.opacity = light ? 0 : 0.07; glowMat.opacity = light ? 0 : 0.07;
    inboxMat.color.set(light ? "#6e55d8" : "#b8a4ff");
    edgeMat.uniforms.uBase.value = (light ? 0.22 : 0.12) * DENSE;
    nodeMat.uniforms.uRingK.value.set(css("--konflikt")); nodeMat.uniforms.uRingP.value.set(css("--pruef")); nodeMat.uniforms.uRingA.value.set(css("--abgelaufen"));
    bloom.enabled = !light;
    if (!D) return;
    const c = new T.Color();
    D.nodes.forEach((n, i) => { c.set(areaColor(n.area)); nCol[i*3] = c.r; nCol[i*3+1] = c.g; nCol[i*3+2] = c.b; });
    aCol.needsUpdate = true;
    faerbeKanten(); faerbeSchimmer(); baueBuendel(); setzeBuendelSicht(); zeichneMcpAtlas();
    buildRegionLabels(); drawHist();
  }

  // ================================================================== Daten laden / neu laden
  function ladeDaten(RAW) {
    const alt = S && D ? {
      sel: S.selected >= 0 ? D.nodes[S.selected].id : null, query: S.query,
      areasAus: Object.keys(AREAS).filter((a) => !S.areas.has(a)), typesAus: Object.keys(TYPE_KEYS).filter((x) => !S.types.has(x)),
      statusAus: ["ok", "pruef", "konflikt"].filter((x) => !S.status.has(x)), abgelaufen: S.abgelaufen, care: S.care, tab,
    } : null;
    D = { areas: (RAW.areas || []).slice(), nodes: (RAW.nodes || []).map((n) => ({ ...n })), edges: (RAW.edges || []).map((e) => ({ ...e })), inbox: RAW.inbox || 0, first: RAW.first, last: RAW.last, sprache: typeof RAW.sprache === "string" ? RAW.sprache : undefined };
    // Bereiche: aus den Daten; unbekannte Bereiche eines Knotens landen im Zentrum (nie ein Absturz wegen alter Daten)
    for (const k of Object.keys(FIXED)) if (!D.areas.some((a) => a.id === k)) D.areas.push({ ...FIXED[k], name: t(FIXED_NAME[k]) });
    AREAS = Object.fromEntries(D.areas.map((a) => [a.id, a]));
    D.nodes.forEach((n) => { if (!AREAS[n.area]) n.area = "zentrum"; if (!n.title) n.title = n.name || n.id; if (!Array.isArray(n.quellen)) n.quellen = []; });
    const synth = Number(params.get("synthetic") || 0);
    if (synth) addSynthetic(synth);
    N = D.nodes.length;
    idx = new Map(D.nodes.map((n, i) => [n.id, i]));
    byName = new Map();
    D.nodes.forEach((n, i) => { if (n.name) byName.set(n.name.toLowerCase(), i); byName.set(String(n.title).toLowerCase(), i); });
    D.edges = D.edges.filter((e) => idx.has(e.s) && idx.has(e.t));
    E = D.edges.length;
    out = D.nodes.map(() => []); inn = D.nodes.map(() => []); adj = D.nodes.map(() => new Set());
    D.edges.forEach((e, k) => { const a = idx.get(e.s), b = idx.get(e.t); e.a = a; e.b = b; out[a].push(k); inn[b].push(k); adj[a].add(b); adj[b].add(a); });
    tLast = toT(D.last) ?? toT(new Date().toISOString()); tFirst = toT(D.first) ?? tLast - DAY; // ohne Daten: Zeitleiste endet heute
    days = Math.max(1, Math.round((tLast - tFirst) / DAY));
    D.nodes.forEach((n) => {
      n.t = toT(n.added) ?? tFirst;
      n.fresh = n.type !== "mcp" && tLast - Math.max(n.t, toT(n.changed) ?? n.t) <= DAY;
      n.day = Math.max(0, Math.round((n.t - tFirst) / DAY));
    });
    DENSE = Math.min(1, Math.sqrt(300 / Math.max(N, 1)));    // 1 bei kleinen Brains, kleiner bei vielen Seiten
    mcpInfo = new Map((Array.isArray(RAW.mcp) ? RAW.mcp : []).filter((s) => s && s.name).map((s) => [s.name, s]));
    areaInfo = {}; farbCache = {};

    // Knoten
    P = layout();
    platziereMcp();
    if (nodes) { scene.remove(nodes); scene.remove(halos); nodeGeo.dispose(); }
    nodeGeo = new T.BufferGeometry();
    nCol = new Float32Array(N * 3); nSize = new Float32Array(N); nVis = new Float32Array(N); nHl = new Float32Array(N);
    nRing = new Float32Array(N); nPulse = new Float32Array(N); nPhase = new Float32Array(N); nGlow = new Float32Array(N).fill(-1e4); nForm = new Float32Array(N);
    const sizeK = Math.max(0.42, Math.min(1, Math.sqrt(250 / Math.max(N, 1))));
    D.nodes.forEach((n, i) => {
      // Bedeutungsstufe aus daten.mjs; alte Daten ohne Stufe: Wiki-Seiten mittel, Rohquellen klein
      const stufe = n.bedeutungStufe || (n.type === "ueberblick" ? 3 : n.wiki ? 2 : 1);
      nSize[i] = (n.type === "ueberblick" ? 1 : sizeK) * groesseFuer(stufe, n.type);
      nForm[i] = formFuer(n.type);
      nRing[i] = ringFuer(n.status, n.gueltigkeit);
      nPulse[i] = n.fresh ? 1 : 0; nPhase[i] = hash(n.id) * 6.28; nVis[i] = 1;
    });
    nodeGeo.setAttribute("position", new T.BufferAttribute(P, 3));
    aCol = new T.BufferAttribute(nCol, 3); aVis = new T.BufferAttribute(nVis, 1); aHl = new T.BufferAttribute(nHl, 1); aGlow = new T.BufferAttribute(nGlow, 1);
    nodeGeo.setAttribute("color", aCol); nodeGeo.setAttribute("size", new T.BufferAttribute(nSize, 1)); nodeGeo.setAttribute("vis", aVis); nodeGeo.setAttribute("hl", aHl);
    aRing = new T.BufferAttribute(nRing, 1);
    nodeGeo.setAttribute("form", new T.BufferAttribute(nForm, 1));
    nodeGeo.setAttribute("ring", aRing); nodeGeo.setAttribute("pulse", new T.BufferAttribute(nPulse, 1)); nodeGeo.setAttribute("phase", new T.BufferAttribute(nPhase, 1)); nodeGeo.setAttribute("glow", aGlow);
    halos = new T.Points(nodeGeo, haloMat); halos.renderOrder = 3; halos.frustumCulled = false; halos.visible = !light; scene.add(halos);
    nodes = new T.Points(nodeGeo, nodeMat); nodes.renderOrder = 4; nodes.frustumCulled = false; scene.add(nodes);
    nodeMat.uniforms.uBack.value = 0.3 + 0.3 * DENSE;
    baueMcp();
    berechneSchimmer();
    nodeMat.uniforms.uHalo.value = 0.4 + 0.6 * DENSE;
    bloom.strength = 0.5 * (0.6 + 0.4 * DENSE);

    // Kanten
    SEG = N > 1000 ? 16 : 22; kurven = new Map(); slots = [];
    kantenAlle = N <= KANTEN_ALLE_BIS;
    baueKanten(kantenAlle ? D.edges.map((_, k) => k) : []);
    baueBuendel();
    umgebungsStand = null;

    // Zustand (Filter bleiben beim Neuladen erhalten)
    S = { areas: new Set(Object.keys(AREAS)), types: new Set(Object.keys(TYPE_KEYS)), status: new Set(["ok", "pruef", "konflikt"]), abgelaufen: true, day: days, selected: -1, hover: -1, hits: [], query: "", pathA: -1, path: [], care: false, mode: "none", focus: new Map(), tVis: new Float32Array(N), tHl: new Float32Array(N) };
    if (alt) { alt.areasAus.forEach((a) => S.areas.delete(a)); alt.typesAus.forEach((x) => S.types.delete(x)); alt.statusAus.forEach((x) => S.status.delete(x)); S.abgelaufen = alt.abgelaufen; tab = alt.tab; }
    nodeOn = new Uint8Array(N);
    leuchtend.clear();
    labelPool.forEach((el) => el.remove()); labelPool.clear();
    tl.max = days;
    $("#tlFirst").textContent = fmtDate(D.first).slice(0, 6); $("#tlLast").textContent = fmtDate(D.last).slice(0, 6);
    applyTheme(); buildFilters(); buildCare(); setDay(days);
    $("#emptyNote").hidden = N > 0;
    if (alt) {
      const i = alt.sel !== null ? idx.get(alt.sel) : undefined;
      if (i !== undefined) select(i, { noFly: true });
      else { panel.hidden = true; if (alt.query) { qEl.value = alt.query; runSearch(alt.query, { fly: false }); } }
      if (alt.care && i === undefined) setCare(true);
    }
  }

  // ================================================================== state
  const brauchtPflege = (n) => n.status !== "ok" || n.gueltigkeit === "abgelaufen";
  // Große Brains, nah herangezoomt: Kanten der Umgebung des Blickpunkts (sonst zeigt der Überblick dort keine)
  const umgebung = new Set();
  let umgebungsStand = null;
  function umgebungsKanten() {
    umgebung.clear();
    const c = controls.target, R2 = 0.5 * 0.5, nah = new Uint8Array(N);
    for (let i = 0; i < N; i++) { if (!nodeOn[i]) continue; const dx = P[i*3] - c.x, dy = P[i*3+1] - c.y, dz = P[i*3+2] - c.z; if (dx * dx + dy * dy + dz * dz < R2) nah[i] = 1; }
    for (let k = 0; k < E && umgebung.size < 900; k++) { const e = D.edges[k]; if (nah[e.a] && nah[e.b]) umgebung.add(k); }
  }
  // Je Bild: Zoomstufe → Kanten-/Bündel-Sichtbarkeit; alle ~300 ms die Etiketten der Zoomstufe neu wählen
  let zoomZ = zoomStufe(99), ambient = [], ambientT = 0, ambientKam = new T.Vector3(), buendelA = 1;
  function zoomTakt(dt) {
    const camD = camera.position.distanceTo(controls.target);
    const z = (zoomZ = zoomStufe(camD)), none = S.mode === "none";
    edgeMat.uniforms.uInnen.value = none ? 0.3 + 0.7 * z.nah : 1;
    edgeMat.uniforms.uQuer.value = none ? 0.85 * z.nah : 1;
    const ziel = none ? 1 - 0.7 * z.nah : 0.1, k = snap || RM ? 1 : Math.min(1, dt * 5);
    buendelA += (ziel - buendelA) * k;
    buendelMat.uniforms.uAlpha.value = buendelA * (light ? 0.85 : 1);
    if (buendelObj) buendelObj.visible = buendelA > 0.01;
    if (!kantenAlle) {
      if (none && z.nah > 0.05) {
        if (!umgebungsStand || umgebungsStand.distanceTo(controls.target) > 0.12) { umgebungsStand = controls.target.clone(); umgebungsKanten(); recompute(); }
      } else if (umgebungsStand) { umgebungsStand = null; umgebung.clear(); recompute(); }
    }
    const jetzt = performance.now();
    if (jetzt - ambientT > 300 || (ambientKam.distanceToSquared(camera.position) > 1e-3 && jetzt - ambientT > 120)) {
      ambientT = jetzt; ambientKam.copy(camera.position);
      const neu = waehleAmbient(z);
      if (neu.length !== ambient.length || neu.some((i, r) => ambient[r] !== i)) { ambient = neu; updateLabelsSet(); }
    }
  }
  // Etiketten je Zoomstufe: fern = die wichtigsten Seiten, mittel = Titel sichtbarer wichtiger Seiten, nah = alle in der Nähe
  function waehleAmbient(z) {
    if (!D || S.mode !== "none" || isMobile() || document.body.classList.contains("bare")) return [];
    const w = canvas.clientWidth, h = canvas.clientHeight, blick = camera.position.clone().sub(controls.target).normalize();
    const kand = [];
    const wichtig = (n, i) => (typeof n.bedeutung === "number" ? n.bedeutung : nSize[i]);
    const minStufe = z.stufe === "fern" ? 3 : z.stufe === "mittel" ? (N > 600 ? 3 : 2) : 1;
    for (let i = 0; i < N; i++) {
      const n = D.nodes[i];
      if (!nodeOn[i] || (n.type === "mcp" && z.stufe === "fern")) continue;
      if ((n.bedeutungStufe || (n.wiki ? 2 : 1)) < minStufe && n.type !== "ueberblick") continue;
      w3.set(P[i*3], P[i*3+1], P[i*3+2]);
      if (z.stufe !== "nah" && n.type !== "mcp" && (w3.x - CENTER.x) * blick.x + (w3.y - CENTER.y) * blick.y + (w3.z - CENTER.z) * blick.z < -0.12) continue;
      v3.copy(w3).project(camera);
      if (v3.z > 1 || Math.abs(v3.x) > 0.92 || Math.abs(v3.y) > 0.86) continue;
      const mitte = Math.hypot(v3.x * w / 2, v3.y * h / 2);
      kand.push([i, z.stufe === "nah" ? mitte : -wichtig(n, i)]);
    }
    kand.sort((a, b) => a[1] - b[1]);
    const max = z.stufe === "fern" ? 7 : z.stufe === "mittel" ? 22 : 40;
    return kand.slice(0, max).map((x) => x[0]);
  }
  function recompute() {
    if (!D) return;
    for (let i = 0; i < N; i++) { const n = D.nodes[i]; nodeOn[i] = S.areas.has(n.area) && S.types.has(n.type in TYPE_KEYS ? n.type : "thema") && S.status.has(n.status) && (S.abgelaufen || n.gueltigkeit !== "abgelaufen") && n.day <= S.day ? 1 : 0; }
    const focus = new Map();
    let mode = "none";
    if (S.path.length) { mode = "path"; S.path.forEach((i) => focus.set(i, 1)); }
    else if (S.selected >= 0) { mode = "sel"; focus.set(S.selected, 1); adj[S.selected].forEach((j) => focus.set(j, 0.7)); }
    else if (S.hits.length) { mode = "search"; S.hits.forEach((h, r) => focus.set(h.i, r === 0 ? 1 : 0.75)); }
    else if (S.care) { mode = "care"; D.nodes.forEach((n, i) => { if (brauchtPflege(n)) focus.set(i, 1); }); }
    S.mode = mode; S.focus = focus;
    for (let i = 0; i < N; i++) { const f = focus.get(i); S.tVis[i] = nodeOn[i] ? (mode === "none" ? 0.92 : f !== undefined ? 1 : 0.12) : 0; S.tHl[i] = nodeOn[i] && f !== undefined ? f : 0; }
    const pathEdge = new Set();
    for (let k = 0; k + 1 < S.path.length; k++) { const a = S.path[k], b = S.path[k + 1]; for (const ei of out[a].concat(inn[a])) { const e = D.edges[ei]; if ((e.a === a && e.b === b) || (e.a === b && e.b === a)) pathEdge.add(ei); } }
    if (!kantenAlle) {
      const want = new Set(kantenFuerFokus(mode, { sel: S.selected, wegKanten: [...pathEdge], fokus: focus, inzident: (i) => out[i].concat(inn[i]), ende: (k) => [D.edges[k].a, D.edges[k].b] }));
      if (mode === "none") umgebung.forEach((k) => want.add(k));
      slots.forEach((k, s) => { if (eVisCur[s] > 0.01) want.add(k); }); // ausblendende Kanten noch behalten
      if (want.size !== slots.length || slots.some((k) => !want.has(k))) baueKanten([...want]);
    }
    slots.forEach((k, s) => {
      const e = D.edges[k], on = nodeOn[e.a] && nodeOn[e.b];
      let v = on ? eBase[s] : 0, h = 0;
      if (on && mode === "sel") { if (e.a === S.selected || e.b === S.selected) h = 1; else v *= 0.06; }
      else if (on && mode === "path") { if (pathEdge.has(k)) h = 1.4; else v *= 0.04; }
      else if (on && mode === "search") { const fa = focus.has(e.a), fb = focus.has(e.b); if (fa && fb) h = 0.6; else v *= fa || fb ? 0.3 : 0.06; }
      else if (on && mode === "care") v *= 0.12;
      if (!kantenAlle && mode === "none" && !umgebung.has(k)) v = 0;
      eVisT[s] = v; eHlT[s] = h;
    });
    setzeBuendelSicht(); setzeBereichsLicht();
    const dim = mode === "none" ? 0 : 0.75;
    brainUniforms.uDim.value = dim; shellMat.uniforms.uDim.value = dim;
    nodeMat.uniforms.uCare.value = S.care ? 1 : 0;
    edgeMat.uniforms.uSignal.value = (mode === "none" ? 1 : 0.7) * DENSE;
    updateLabelsSet(); updateStats();
    const proBereich = {}; for (let i = 0; i < N; i++) if (nodeOn[i]) proBereich[D.nodes[i].area] = (proBereich[D.nodes[i].area] || 0) + 1;
    for (const r of regionEls) if (!isWolke(r.a)) r.b.textContent = proBereich[r.a] || 0;
  }
  let snap = !!SHOT;
  function animateState(dt) {
    const k = snap || RM ? 1 : 1 - Math.pow(0.0008, dt);
    let ch = false;
    for (let i = 0; i < N; i++) {
      const v = nVis[i] + (S.tVis[i] - nVis[i]) * k, h = nHl[i] + (S.tHl[i] - nHl[i]) * k;
      if (Math.abs(v - nVis[i]) > 1e-4 || Math.abs(h - nHl[i]) > 1e-4) ch = true;
      nVis[i] = v; nHl[i] = h;
    }
    if (ch) { aVis.needsUpdate = true; aHl.needsUpdate = true; }
    let ce = false;
    for (let e = 0; e < slots.length; e++) {
      const v = eVisCur[e] + (eVisT[e] - eVisCur[e]) * k, h = eHlCur[e] + (eHlT[e] - eHlCur[e]) * k;
      if (Math.abs(v - eVisCur[e]) > 1e-4 || Math.abs(h - eHlCur[e]) > 1e-4) {
        ce = true; eVisCur[e] = v; eHlCur[e] = h;
        const o = e * SEG * 2; for (let s = 0; s < SEG * 2; s++) { eA[o + s] = v; eHl[o + s] = h; }
      }
    }
    if (ce) { aeA.needsUpdate = true; aeHl.needsUpdate = true; }
  }

  // ================================================================== Aufleuchten (Live-Lesen der KI)
  const leuchtend = new Map(); // Knoten → Endzeit (performance.now) für das Etikett
  function leuchte(i) {
    nGlow[i] = U.uTime.value; aGlow.needsUpdate = true;
    leuchtend.set(i, performance.now() + GLUEH_S * 1000);
    if (leuchtend.size > 6) leuchtend.delete(leuchtend.keys().next().value);
    updateLabelsSet();
    setTimeout(() => { const jetzt = performance.now(); for (const [j, bis] of leuchtend) if (bis <= jetzt) leuchtend.delete(j); updateLabelsSet(); }, GLUEH_S * 1000 + 50);
  }
  const leuchtstaerke = (i) => { const age = U.uTime.value - nGlow[i]; return age >= 0 && age < GLUEH_S ? 1 - age / GLUEH_S : 0; };

  // ================================================================== camera
  let fly = null, lastInput = performance.now();
  function touch() { lastInput = performance.now(); controls.autoRotate = false; }
  function flyTo(target, dist, dirOverride) {
    const to = new T.Vector3().copy(target);
    const dir = (dirOverride || camera.position.clone().sub(controls.target)).normalize();
    const pos = to.clone().add(dir.multiplyScalar(dist));
    controls.autoRotate = false; lastInput = performance.now();
    if (snap || RM) { camera.position.copy(pos); controls.target.copy(to); controls.update(); return; }
    fly = { t: 0, dur: 1.1, p0: camera.position.clone(), t0: controls.target.clone(), p1: pos, t1: to };
  }
  const nodePos = (i) => new T.Vector3(P[i*3], P[i*3+1], P[i*3+2]);
  function flyToNode(i) { flyTo(nodePos(i), isMobile() ? 4.2 : 3.3); }
  function frameNode(i) {
    const box = new T.Box3().expandByPoint(nodePos(i));
    adj[i].forEach((j) => { if (nodeOn[j]) box.expandByPoint(nodePos(j)); });
    const c = box.getCenter(new T.Vector3()).lerp(nodePos(i), 0.5), r = box.getSize(new T.Vector3()).length();
    flyTo(c, Math.max(isMobile() ? 2.6 : 1.9, r * 1.9));
  }
  function flyHome() { flyTo(HOME.target, HOME.pos.distanceTo(HOME.target), HOME.pos.clone().sub(HOME.target)); }

  // ================================================================== labels
  // Seiten-Etiketten nur für Auswahl (+ größte Nachbarn), Weg, Top-Suchtreffer, Hover und gerade aufleuchtende Seiten
  // — nie für alle, damit auch 5000 Seiten flüssig bleiben.
  const labelsEl = $("#labels");
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg"); svg.setAttribute("class", "leaders"); labelsEl.appendChild(svg);
  const labelPool = new Map();
  function updateLabelsSet() {
    if (!D) return;
    const L = new Map();
    const add = (i, cls) => { if (i < 0 || i >= N || !nodeOn[i]) return; if (!L.has(i) || cls === "main") L.set(i, cls); };
    if (S.mode === "sel") { [...adj[S.selected]].filter((j) => nodeOn[j]).sort((a, b) => nSize[b] - nSize[a]).slice(0, isMobile() ? 4 : 12).forEach((j) => add(j, "minor")); add(S.selected, "main"); }
    if (S.mode === "path") S.path.forEach((i, k) => add(i, k === 0 || k === S.path.length - 1 ? "main" : ""));
    if (S.mode === "search") S.hits.slice(0, isMobile() ? 3 : 7).forEach((h, r) => add(h.i, r === 0 ? "main" : ""));
    if (S.mode === "care") D.nodes.forEach((n, i) => { if (brauchtPflege(n)) add(i, ""); });
    for (const i of leuchtend.keys()) if (!L.has(i)) add(i, "glow");
    if (S.mode === "none") for (const i of ambient) add(i, D.nodes[i].bedeutungStufe === 3 || D.nodes[i].type === "ueberblick" ? "amb wichtig" : "amb");
    if (S.pathA >= 0 && !S.path.length) add(S.pathA, "main");
    if (S.hover >= 0) add(S.hover, L.get(S.hover) === "main" ? "main" : "hover");
    const keep = new Set(L.keys());
    for (const [i, el] of labelPool) if (!keep.has(i)) { el.remove(); labelPool.delete(i); }
    for (const [i, cls] of L) {
      let el = labelPool.get(i);
      if (!el) { el = document.createElement("div"); labelsEl.appendChild(el); labelPool.set(i, el); el.textContent = D.nodes[i].type === "mcp" ? mcpAnzeige(D.nodes[i]) : D.nodes[i].title; }
      if (el._cls !== cls) { el.className = "lbl " + cls; el._cls = cls; el._w = 0; }
    }
  }
  let regionEls = [], grpEls = [];
  function soloBereich(a) {
    const nurDieser = S.areas.size === 1 && S.areas.has(a);
    S.areas = nurDieser ? new Set(Object.keys(AREAS)) : new Set([a]);
    buildFilters(); recompute(); if (S.query) runSearch(qEl.value, { fly: false });
    regionEls.forEach((r) => (r.el.title = t(S.areas.size === 1 && S.areas.has(r.a) ? "bereichAlle" : "bereichNurDieser")));
  }
  function buildRegionLabels() {
    regionEls.forEach((r) => { r.el.remove(); r.line.remove(); r.dot.remove(); });
    grpEls.forEach((g) => g.el.remove());
    grpEls = mcpGruppen.map((g) => {
      const el = document.createElement("div"); el.className = "mcp-grp";
      el.textContent = g.name === "genutzt" ? t("mcpGenutzt") : g.name; labelsEl.appendChild(el);
      return { el, at: g.at };
    });
    const count = {}; D.nodes.forEach((n) => (count[n.area] = (count[n.area] || 0) + 1));
    regionEls = Object.entries(regionLabelCfg()).map(([a, cfg]) => {
      const el = document.createElement("div"); el.className = "region"; el.style.color = areaColor(a);
      el.title = t("bereichNurDieser");
      el.addEventListener("click", () => soloBereich(a));
      el.addEventListener("pointerenter", () => { bereichHover = a; setzeBereichsLicht(); });
      el.addEventListener("pointerleave", () => { if (bereichHover === a) { bereichHover = null; setzeBereichsLicht(); } });
      const sw = document.createElement("i"); sw.className = "sw"; el.appendChild(sw);
      el.append(areaName(a)); const b = document.createElement("b"); b.textContent = isWolke(a) ? (D.inbox ? D.inbox : t("leer")) : count[a] || 0; el.appendChild(b);
      labelsEl.appendChild(el);
      const line = document.createElementNS("http://www.w3.org/2000/svg", "line"); line.setAttribute("stroke", areaColor(a)); svg.appendChild(line);
      const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle"); dot.setAttribute("r", "2.2"); dot.setAttribute("fill", areaColor(a)); svg.appendChild(dot);
      return { a, el, line, dot, b, at: new T.Vector3(...cfg.at), dir: new T.Vector3(...cfg.dir).normalize(), free: !!cfg.free, mitte: !!cfg.mitte };
    });
  }
  // Silhouette im Bildschirm: max. Radius je Winkelsektor (aus einer Stichprobe der Rindenpunkte)
  const SIL_N = 900, silIdx = Array.from({ length: SIL_N }, (_, k) => Math.floor((k / SIL_N) * cloud.pos.length / 3));
  const BINS = 72, silR = new Float32Array(BINS);
  const v3 = new T.Vector3(), w3 = new T.Vector3();
  function toScreen(v, w, h) { v3.copy(v).project(camera); return { x: (v3.x * 0.5 + 0.5) * w, y: (-v3.y * 0.5 + 0.5) * h, z: v3.z }; }
  const rank = (el) => (el._cls === "main" ? 0 : el._cls === "hover" ? 1 : el._cls === "glow" ? 1 : el._cls === "minor" ? 3 : el._cls === "amb wichtig" ? 4 : el._cls === "amb" ? 5 : 2);
  function placeLabels() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    // Hindernisse: hervorgehobene Lichtpunkte
    const obstacles = [];
    if (S.mode !== "none") for (const i of S.focus.keys()) { if (!nodeOn[i]) continue; const p = toScreen(w3.set(P[i*3], P[i*3+1], P[i*3+2]), w, h); obstacles.push([p.x - 7, p.y - 7, p.x + 7, p.y + 7, i]); }
    const placed = [];
    for (const sel of ["#results.open", "#panel:not([hidden])", "#filters", "#care:not([hidden])", ".top .search", "#timeline", "#banner:not([hidden])"]) { const el = document.querySelector(sel); if (el && el.offsetParent !== null) { const b = el.getBoundingClientRect(); if (b.width) placed.push([b.left - 4, b.top - 4, b.right + 4, b.bottom + 4]); } }
    const ov = (r, self) => placed.some((q) => r[0] < q[2] && r[2] > q[0] && r[1] < q[3] && r[3] > q[1]) || obstacles.some((q) => q[4] !== self && r[0] < q[2] && r[2] > q[0] && r[1] < q[3] && r[3] > q[1]);
    const camD = camera.position.distanceTo(controls.target);
    const order = [...labelPool.entries()].sort((a, b) => rank(a[1]) - rank(b[1]));
    for (const [i, el] of order) {
      const p = toScreen(w3.set(P[i*3], P[i*3+1], P[i*3+2]), w, h);
      if (p.z > 1 || !nodeOn[i]) { el.style.opacity = 0; continue; }
      const bw = el._w || (el._w = el.offsetWidth), bh = el._cls === "main" ? 26 : 22, g = 9;
      const cands = [[p.x - bw / 2, p.y - g - bh], [p.x - bw / 2, p.y + g], [p.x + g + 2, p.y - bh / 2], [p.x - g - 2 - bw, p.y - bh / 2]];
      let ok = null;
      for (const [x, y] of cands) { const r = [x - 3, y - 2, x + bw + 3, y + bh + 2]; if (!ov(r, i) && x > 4 && x + bw < w - 4) { ok = [x, y, r]; break; } }
      if (!ok && el._cls === "main") { const [x, y] = cands[0]; ok = [x, y, [x, y, x + bw, y + bh]]; }
      let op = ok ? 1 : 0;
      if (el._cls === "minor") op *= Math.max(0, Math.min(1, (6.5 - camD) / 2.5));
      el.style.opacity = op;
      if (ok) { el.style.transform = `translate(${ok[0].toFixed(1)}px, ${ok[1].toFixed(1)}px)`; if (op > 0.05) placed.push(ok[2]); }
    }
    // Bereichs-Etiketten außerhalb der Silhouette mit Führungslinie
    const showRegions = S.mode === "none" && !isMobile() && !document.body.classList.contains("bare") && zoomZ.nah < 0.98;
    svg.setAttribute("width", w); svg.setAttribute("height", h);
    // Herkunftsgruppen der MCP-Server: kleiner Titel über jeder Wabe
    const grpAn = S.mode === "none" && !isMobile() && S.areas.has("werkzeuge") && S.types.has("mcp") && !document.body.classList.contains("bare");
    for (const g of grpEls) {
      const p = toScreen(g.at, w, h), bw = g.el._w || (g.el._w = g.el.offsetWidth);
      g.el.style.transform = `translate(${(p.x - bw / 2).toFixed(1)}px, ${(p.y - 6).toFixed(1)}px)`;
      g.el.style.opacity = grpAn && p.z < 1 ? 0.85 : 0;
    }
    for (const r of regionEls) r.el.style.pointerEvents = showRegions ? "" : "none";
    if (!showRegions) { for (const r of regionEls) { r.el.style.opacity = 0; r.line.style.opacity = 0; r.dot.style.opacity = 0; } return; }
    const regA = 1 - zoomZ.nah;
    const c = toScreen(w3.set(-0.05, -0.12, 0), w, h);
    silR.fill(0);
    for (const k of silIdx) {
      const p = toScreen(w3.set(cloud.pos[k*3], cloud.pos[k*3+1], cloud.pos[k*3+2]), w, h);
      const dx = p.x - c.x, dy = p.y - c.y, b = Math.floor(((Math.atan2(dy, dx) + Math.PI) / (2 * Math.PI)) * BINS) % BINS;
      const rr = Math.hypot(dx, dy); if (rr > silR[b]) silR[b] = rr;
    }
    const regPlaced = [];
    for (const r of regionEls) {
      const on = S.areas.has(r.a);
      const pa = toScreen(r.at, w, h);
      const pd = toScreen(w3.copy(r.at).addScaledVector(r.dir, 0.6), w, h);
      let ang = Math.atan2(pd.y - pa.y, pd.x - pa.x);
      const bw = r.el._w || (r.el._w = r.el.offsetWidth), bh = 16;
      let lx, ly;
      if (r.free) { lx = pa.x - bw / 2; ly = pa.y - 92; }
      else if (r.mitte) {
        // Werkzeuge: als Titel unter die Plaketten-Waben (unter den tiefsten Gruppentitel, mittig)
        let sx = 0, n = 0, my = -Infinity;
        for (const g of grpEls) { const q = toScreen(g.at, w, h); if (q.z < 1) { sx += q.x; n++; my = Math.max(my, q.y); } }
        if (n) { lx = sx / n - bw / 2; ly = my + 26; } else { lx = pa.x - bw / 2; ly = pa.y - bh / 2; }
      }
      else {
        // vom Bildschirm-Mittelpunkt aus in Richtung des Etiketts bis hinter die Silhouette
        const ax = pa.x - c.x, ay = pa.y - c.y;
        const ang2 = Math.atan2(ay + Math.sin(ang) * 400, ax + Math.cos(ang) * 400);
        let b = Math.floor(((ang2 + Math.PI) / (2 * Math.PI)) * BINS) % BINS;
        const rad = Math.max(silR[b], silR[(b + 1) % BINS], silR[(b + BINS - 1) % BINS]) + 30;
        let ex = c.x + Math.cos(ang2) * rad, ey = c.y + Math.sin(ang2) * rad;
        lx = Math.cos(ang2) >= 0 ? ex + 4 : ex - bw - 4; ly = ey - bh / 2;
        for (let tt = 0; tt < 6 && regPlaced.some((q) => lx < q[2] && lx + bw > q[0] && ly < q[3] && ly + bh > q[1]); tt++) { ly += Math.sin(ang2) >= 0 ? 18 : -18; }
        r.line.setAttribute("x1", pa.x); r.line.setAttribute("y1", pa.y); r.line.setAttribute("x2", Math.cos(ang2) >= 0 ? lx - 4 : lx + bw + 4); r.line.setAttribute("y2", ly + bh / 2);
        r.dot.setAttribute("cx", pa.x); r.dot.setAttribute("cy", pa.y);
      }
      regPlaced.push([lx, ly, lx + bw, ly + bh]);
      r.el.style.transform = `translate(${lx.toFixed(1)}px, ${ly.toFixed(1)}px)`;
      const op = (on ? 1 : 0) * regA;
      r.el.style.opacity = op * (r.el.classList.contains("an") ? 1 : 0.92); r.el.style.pointerEvents = op > 0.3 ? "" : "none"; r.line.style.opacity = r.free || r.mitte ? 0 : op * 0.4; r.dot.style.opacity = r.free || r.mitte ? 0 : op * 0.8;
    }
  }

  // ================================================================== picking + input
  function pick(cx, cy, radius = 16) {
    if (!D) return -1;
    const rect = canvas.getBoundingClientRect(), w = rect.width, h = rect.height;
    let best = -1, bd = radius * radius;
    for (let i = 0; i < N; i++) {
      if (!nodeOn[i] || nVis[i] < 0.08) continue;
      v3.set(P[i*3], P[i*3+1], P[i*3+2]).project(camera);
      if (v3.z > 1) continue;
      const x = (v3.x * 0.5 + 0.5) * w + rect.left, y = (-v3.y * 0.5 + 0.5) * h + rect.top;
      const d = (x - cx) ** 2 + (y - cy) ** 2 - (nHl[i] > 0.5 ? 60 : 0);
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }
  let down = null, hoverPlan = 0, hoverXY = null;
  const tipEl = document.createElement("div"); tipEl.className = "tip"; tipEl.hidden = true; $("#app").appendChild(tipEl);
  canvas.addEventListener("pointerleave", () => { tipEl.hidden = true; if (buendelHover >= 0) { buendelHover = -1; setzeBuendelSicht(); } });
  canvas.addEventListener("pointerdown", (e) => { down = { x: e.clientX, y: e.clientY }; touch(); hideHint(); tipEl.hidden = true; });
  canvas.addEventListener("wheel", touch, { passive: true });
  // Trackpad-Pinch (macOS: wheel mit ctrlKey, Safari: gesture*) nie als Seiten-Zoom durchlassen. OrbitControls
  // verhindert ihn nur im Ruhezustand — während Drehen/Kameraflug zoomte sonst die ganze Seite, die Ansicht wurde
  // neu angelegt und das Gehirn blitzte schwarz auf. Der Kamera-Zoom selbst läuft weiter über OrbitControls.
  window.addEventListener("wheel", (e) => { if (e.ctrlKey) e.preventDefault(); }, { passive: false });
  for (const ev of ["gesturestart", "gesturechange", "gestureend"]) document.addEventListener(ev, (e) => e.preventDefault(), { passive: false });
  // Hover höchstens einmal je Bild auswerten (bei 5000 Seiten sonst spürbar)
  canvas.addEventListener("pointermove", (e) => {
    if (e.pointerType !== "mouse" || e.buttons) return;
    hoverXY = [e.clientX, e.clientY];
    if (hoverPlan) return;
    hoverPlan = requestAnimationFrame(() => {
      hoverPlan = 0; if (!D || !hoverXY) return;
      const i = pick(hoverXY[0], hoverXY[1]);
      if (i !== S.hover) { S.hover = i; canvas.style.cursor = i >= 0 ? "pointer" : ""; updateLabelsSet(); }
      const b = i < 0 && S.mode === "none" ? pickBuendel(hoverXY[0], hoverXY[1]) : -1;
      if (b !== buendelHover) { buendelHover = b; setzeBuendelSicht(); }
      if (b >= 0) {
        const bd = buendelListe[b], werte = { a: areaName(bd.a), b: areaName(bd.b), n: bd.sichtbar };
        tipEl.textContent = t(bd.sichtbar === 1 ? "buendelTipEins" : "buendelTip", werte);
        tipEl.style.transform = `translate(${hoverXY[0] + 14}px, ${hoverXY[1] + 12}px)`; tipEl.hidden = false;
      } else tipEl.hidden = true;
    });
  });
  canvas.addEventListener("pointerup", (e) => {
    if (!D || !down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) return;
    const i = pick(e.clientX, e.clientY, e.pointerType === "mouse" ? 16 : 26);
    if (e.shiftKey && i >= 0) return pathClick(i);
    if (i >= 0) select(i); else if (S.selected >= 0 || S.path.length) clearSelection();
  });
  canvas.addEventListener("dblclick", (e) => { if (D && pick(e.clientX, e.clientY) < 0) resetAll(); });

  // ================================================================== markdown (markdown.js: alles escaped, nur eigene Tags, nur #seite=/http(s)-Links)
  const esc = window.BrainMarkdown.escape;
  // Wiki-Link-Ziel → Knoten. Zuerst die von daten.mjs per resolveLink vorberechneten Ziele der Seite (dieselbe
  // Auflösung wie Kanten und Lint: exakt, +.md, <wiki>/…, Teilpfad; Wiki-Ordner bevorzugt), danach als Zusatz
  // Titel/Name (byName). Fehlt linkZiele (alte data.js), gilt Pfad-ID und byName. Bereichsfarbe als Klasse.
  const FARB_KLASSE = new Set(["blau", "orange", "gruen", "gelb", "rot", "lila", "grau", "tuerkis", "neutral"]);
  const eigen = (o, k) => !!o && typeof o === "object" && Object.prototype.hasOwnProperty.call(o, k);
  function linkZielFuer(seite) {
    return (name) => {
      let j = eigen(seite.linkZiele, name) ? idx.get(seite.linkZiele[name]) : undefined;
      if (j === undefined && !seite.linkZiele) j = idx.get(name) ?? idx.get(name + ".md");
      if (j === undefined) j = byName.get(String(name).toLowerCase());
      if (j === undefined) return null;
      const n = D.nodes[j], farbe = AREAS[n.area]?.farbe;
      return { id: n.id, text: n.title, klasse: "f-" + (FARB_KLASSE.has(farbe) ? farbe : "neutral") };
    };
  }
  const renderMarkdown = (n) => window.BrainMarkdown.render(n.body, linkZielFuer(n), { titel: n.title });

  // ================================================================== selection + panel
  const panel = $("#panel"), panelBody = $("#panelBody");
  let tab = "seite";
  const fmtDate = (d) => (d ? d.slice(8, 10) + "." + d.slice(5, 7) + "." + d.slice(0, 4) : "—");
  function linkItem(j, extra = "") {
    const n = D.nodes[j];
    return `<li data-i="${j}"><span class="dotc" style="color:${areaColor(n.area)}"></span><span class="t">${esc(n.title)}</span><span class="k">${extra || esc(typName(n.type))}</span></li>`;
  }
  // Ausstehende entprellte Suche und verzögerten Suchflug verwerfen — eine Auswahl/ein Weg hat Vorrang
  function stopSearchTimers() { clearTimeout(qTimer); qTimer = 0; clearTimeout(flyTimer); flyTimer = 0; }
  function select(i, opts = {}) {
    stopSearchTimers();
    S.selected = i; S.path = []; S.pathA = -1;
    if (!opts.keepHits) S.hits = [];
    recompute(); renderPanel(); if (!opts.noFly) flyToNode(i);
    closeResults(); setHash(D.nodes[i].id);
  }
  // Für steuer.js (Analyse-Liste): Seite auswählen und — falls ausgefiltert — wieder sichtbar machen
  function waehleId(id) {
    const i = idx.get(id); if (i === undefined) return false;
    const n = D.nodes[i];
    if (!nodeOn[i]) { S.areas.add(n.area); S.types.add(n.type in TYPE_KEYS ? n.type : "thema"); S.status.add(n.status); buildFilters(); if (n.day > S.day) setDay(days); }
    if (S.care) setCare(false);
    select(i);
    return true;
  }
  function clearSelection() { S.selected = -1; S.path = []; S.pathA = -1; panel.hidden = true; careEl.hidden = !S.care; setHash(null); recompute(); }
  function setHash(id) { if (SHOT) return; try { history.replaceState(null, "", id ? "#seite=" + encodeURIComponent(id) : location.pathname + location.search); } catch {} }
  const linkListe = (title, arr, extra) => `<div class="links"><h4><span>${esc(title)}</span><span>${arr.length}</span></h4>${arr.length ? `<ul>${arr.map((j) => linkItem(j, extra && extra(j))).join("")}</ul>` : `<div class="muted">${esc(t("keine"))}</div>`}</div>`;
  function renderPanel() {
    if (!D) return;
    if (S.path.length) return renderPathPanel();
    const i = S.selected; if (i < 0) { panel.hidden = true; return; }
    const n = D.nodes[i];
    if (n.type === "mcp") return renderMcpPanel(i);
    const outs = out[i].filter((k) => D.edges[k].kind === "link").map((k) => D.edges[k].b);
    const ins = inn[i].filter((k) => D.edges[k].kind === "link").map((k) => D.edges[k].a);
    const werkzeuge = out[i].concat(inn[i]).filter((k) => D.edges[k].kind === "mcp").map((k) => (D.edges[k].a === i ? D.edges[k].b : D.edges[k].a));
    const srcs = n.quellen.map((q) => idx.get(q)).filter((j) => j !== undefined);
    const used = (n.usedIn || []).map((q) => idx.get(q)).filter((j) => j !== undefined);
    const conn = (n.wiki ? srcs.length : used.length) + outs.length + ins.length + werkzeuge.length;
    const status = (n.status !== "ok" ? `<div class="status-box ${n.status === "konflikt" ? "konflikt" : "pruef"}"><span class="ring"></span><div><b>${esc(n.status === "konflikt" ? t("offenerKonflikt") : t("pruefbeduerftig"))}</b><br>${esc(n.statusNote || "")}</div></div>` : "")
      + (n.gueltigkeit === "abgelaufen" ? `<div class="status-box abgelaufen"><span class="ring"></span><div><b>${esc(t("abgelaufenBis", { datum: n.pruefenBis ? fmtDate(n.pruefenBis) : "—" }))}</b></div></div>` : "");
    const body = n.body ? renderMarkdown(n) : `<p class="muted">${esc(n.desc || "")}</p>`;
    panelBody.innerHTML = `
      <div class="p-kicker"><span class="area" style="color:${areaColor(n.area)}"><span class="dotc" style="width:6px;height:6px"></span>${esc(areaName(n.area))}</span><span class="sep">/</span><span>${esc(typName(n.type))}</span>${n.fresh ? `<span class="sep">/</span><span class="fresh">${esc(t("frisch"))}</span>` : ""}</div>
      <h2>${esc(n.title)}</h2>
      ${n.wiki && n.desc ? `<p class="desc">${esc(n.desc)}</p>` : ""}
      ${status}
      <dl class="facts"><div><dt>${esc(t("stand"))}</dt><dd>${n.rev ? "rev " + esc(String(n.rev)) : "—"}</dd></div><div><dt>${esc(t("seit"))}</dt><dd>${fmtDate(n.added)}</dd></div><div><dt>${esc(t("geaendert"))}</dt><dd>${fmtDate(n.changed)}</dd></div></dl>
      <div class="p-actions"><button class="btn" id="btnFocus"><svg viewBox="0 0 24 24"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/><circle cx="12" cy="12" r="2.5"/></svg>${esc(t("fokus"))}</button><span class="path" title="${esc(n.id)}">${esc(n.id.length > 52 ? "…" + n.id.slice(-51) : n.id)}</span></div>
      <div class="tabs" role="tablist"><button role="tab" data-tab="seite" aria-selected="${tab === "seite"}">${esc(t("tabSeite"))}</button><button role="tab" data-tab="links" aria-selected="${tab === "links"}">${esc(t("tabVerbindungen"))} <span>${conn}</span></button></div>
      <div class="tabpane" ${tab === "seite" ? "" : "hidden"}><article class="md">${body}</article></div>
      <div class="tabpane" ${tab === "links" ? "" : "hidden"}>
        ${n.wiki ? linkListe(t("quellen"), srcs, () => esc(t("rohquelle"))) : linkListe(t("eingearbeitetIn"), used)}
        ${linkListe(t("verweistAuf"), outs)}
        ${linkListe(t("verlinktVon"), ins)}
        ${werkzeuge.length ? linkListe(t("mcpServer"), werkzeuge) : ""}
      </div>
      <div class="p-foot"><span><kbd>Shift</kbd>${esc(t("fussWeg"))}</span><span><kbd>Esc</kbd>${esc(t("fussZurueck"))}</span></div>`;
    panel.hidden = false; panel.scrollTop = 0; careEl.hidden = true;
  }
  // MCP-Server: woher bekannt (Quellen), welche Werkzeuge benutzt, wie oft/zuletzt, verknüpfte Brain-Seiten
  function renderMcpPanel(i) {
    const n = D.nodes[i], s = mcpInfo.get(n.name) || { quellen: [], werkzeuge: [], benutzt: 0, zuletzt: null };
    const seiten = [...adj[i]].filter((j) => D.nodes[j].type !== "mcp");
    const quellen = (s.quellen || []).map((q) => `<span class="chip mcp-q">${esc(q === "genutzt" ? t("mcpGenutzt") : q)}</span>`).join("");
    const wz = s.werkzeuge || [];
    const zuletzt = s.zuletzt ? fmtDate(String(s.zuletzt).slice(0, 10)) : "—";
    const aufrufe = mcpAufrufe(n);
    const mg = window.BrainIcons ? window.BrainIcons.monogramm(mcpAnzeige(n), ["--c-blau", "--c-orange", "--c-gruen", "--c-gelb", "--c-rot", "--c-lila", "--c-tuerkis"].map(css)) : { text: "?", farbe: "" };
    const logo = n.icon && /^[a-z0-9-]+$/.test(n.icon) && location.protocol !== "file:"
      ? `<img src="vendor/icons/${esc(n.icon)}.svg" alt="">` : `<span class="mono" style="color:${esc(mg.farbe)}">${esc(mg.text)}</span>`;
    panelBody.innerHTML = `
      <div class="p-kicker"><span class="area" style="color:${areaColor(n.area)}"><span class="dotc" style="width:6px;height:6px"></span>${esc(areaName(n.area))}</span><span class="sep">/</span><span>${esc(t("typMcp"))}</span>${n.gruppe ? `<span class="sep">/</span><span>${esc(n.gruppe)}</span>` : ""}</div>
      <div class="mcp-kopf"><div class="mcp-logo${aufrufe ? "" : " still"}">${logo}</div><div><h2>${esc(mcpAnzeige(n))}</h2><p class="desc">${esc(aufrufe ? t("mcpAufrufe30", { n: aufrufe }) : t("mcpUngenutzt"))}</p></div></div>
      <dl class="facts"><div><dt>${esc(t("mcpBenutzt"))}</dt><dd>${s.benutzt ? esc(t("mcpMal", { n: s.benutzt })) : esc(t("mcpNie"))}</dd></div><div><dt>${esc(t("mcpZuletzt"))}</dt><dd>${zuletzt}</dd></div><div><dt>${esc(t("mcpWerkzeuge"))}</dt><dd>${wz.length}</dd></div></dl>
      <div class="links"><h4><span>${esc(t("quellen"))}</span><span>${(s.quellen || []).length}</span></h4><div class="chips">${quellen || `<div class="muted">${esc(t("keine"))}</div>`}</div></div>
      <div class="links"><h4><span>${esc(t("mcpWerkzeuge"))}</span><span>${wz.length}</span></h4>${wz.length ? `<ul class="mcp-wz">${wz.map((w) => `<li><span class="t">${esc(w)}</span></li>`).join("")}</ul>` : `<div class="muted">${esc(t("mcpKeineWerkzeuge"))}</div>`}</div>
      ${seiten.length ? linkListe(t("mcpSeiten"), seiten) : `<div class="links"><h4><span>${esc(t("mcpSeiten"))}</span><span>0</span></h4><div class="muted">${esc(t("mcpKeineSeite"))}</div></div>`}
      <div class="p-foot"><span><kbd>Esc</kbd>${esc(t("fussZurueck"))}</span></div>`;
    panel.hidden = false; panel.scrollTop = 0; careEl.hidden = true;
  }
  panelBody.addEventListener("click", (e) => {
    const tb = e.target.closest("[data-tab]"); if (tb) { tab = tb.dataset.tab; renderPanel(); return; }
    if (e.target.closest("#btnFocus")) { if (S.selected >= 0) frameNode(S.selected); return; }
    // Wiki-Links aus markdown.js: <a class="wl" href="#seite=…"> — direkt auswählen statt über den Hash
    const wl = e.target.closest('a.wl[href^="#seite="]');
    if (wl) {
      e.preventDefault();
      let id = null; try { id = decodeURIComponent(wl.getAttribute("href").slice("#seite=".length)); } catch {}
      const j = id === null ? undefined : idx.get(id); if (j !== undefined) select(j);
      return;
    }
    const li = e.target.closest("[data-i]"); if (li) { e.preventDefault(); select(Number(li.dataset.i)); }
  });
  $("#panelClose").addEventListener("click", () => clearSelection());

  function shortest(a, b) {
    const prev = new Int32Array(N).fill(-1); prev[a] = a; const q = [a];
    for (let h = 0; h < q.length; h++) { const x = q[h]; if (x === b) break; for (const y of adj[x]) if (prev[y] < 0 && nodeOn[y]) { prev[y] = x; q.push(y); } }
    if (prev[b] < 0) return [];
    const p = [b]; let x = b; while (x !== a) { x = prev[x]; p.push(x); } return p.reverse();
  }
  function pathClick(i) {
    const a = S.selected >= 0 ? S.selected : S.pathA;
    if (a < 0 || a === i) { S.pathA = i; S.selected = -1; S.path = []; recompute(); return; }
    setPath(a, i);
  }
  function setPath(a, b) {
    stopSearchTimers();
    S.path = shortest(a, b); S.pathEnds = [a, b]; S.selected = -1; S.pathA = -1;
    recompute(); renderPathPanel();
    if (S.path.length) {
      const box = new T.Box3(); S.path.forEach((i) => box.expandByPoint(nodePos(i)));
      flyTo(box.getCenter(new T.Vector3()), Math.max(isMobile() ? 4.4 : 3.6, box.getSize(new T.Vector3()).length() * 2.2));
    }
  }
  function renderPathPanel() {
    const [a, b] = S.pathEnds, p = S.path;
    panelBody.innerHTML = `
      <div class="p-kicker"><span>${esc(t("weg"))}</span><span class="sep">/</span><span>${esc(p.length ? t("schritte", { n: p.length - 1 }) : t("keineVerbindung"))}</span></div>
      <h2>${esc(D.nodes[a].title)} <span class="arrow">→</span> ${esc(D.nodes[b].title)}</h2>
      <p class="desc">${esc(p.length ? t("wegText") : t("wegKeiner"))}</p>
      <div class="links"><ul class="route">${p.map((j) => linkItem(j)).join("")}</ul></div>
      <div class="p-foot"><span><kbd>Esc</kbd>${esc(t("fussZurueck"))}</span></div>`;
    panel.hidden = false; careEl.hidden = true;
  }

  // ================================================================== search (suche.js: BM25 wie brain search, Tippfehler + Präfix beim Tippen)
  const qEl = $("#q"), resEl = $("#results");
  // Treffer → Knotenindex; filter blendet ausgeblendete Knoten vor dem Kürzen aus
  function search(query, n, filter) {
    return window.BrainSuche.suche(D.nodes, query, n, filter ? { filter: (_, i) => filter(i) } : undefined)
      .map((h) => ({ i: idx.get(h.id), s: h.score, auszug: h.auszug, begriffe: h.begriffe }))
      .filter((h) => h.i !== undefined);
  }
  const hl = (txt, h) => window.BrainSuche.hervorheben(txt, h.begriffe);
  let active = 0, flyTimer = 0, qTimer = 0;

  function runSearch(q, { fly = true } = {}) {
    if (!D) return;
    clearTimeout(qTimer); qTimer = 0; // ein direkter Aufruf ersetzt eine wartende entprellte Suche
    S.query = q.trim();
    S.hits = S.query ? search(S.query, 60, (i) => nodeOn[i]) : [];
    active = 0;
    if (S.query) { S.selected = -1; S.path = []; panel.hidden = true; }
    recompute(); renderResults();
    clearTimeout(flyTimer);
    if (fly && S.hits.length) {
      const go = () => {
        if (!S.hits.length) return; // inzwischen ausgewählt oder Suche geleert
        const top = S.hits.slice(0, 6).map((h) => nodePos(h.i));
        const box = new T.Box3().setFromPoints(top), c = box.getCenter(new T.Vector3()).lerp(nodePos(S.hits[0].i), 0.5);
        flyTo(c, Math.max(isMobile() ? 4.2 : 3.4, box.getSize(new T.Vector3()).length() * 2.4));
      };
      snap ? go() : (flyTimer = setTimeout(go, 280));
    }
  }
  function renderResults() {
    if (!S || !S.query) { resEl.classList.remove("open"); return; }
    const top = S.hits.slice(0, 7);
    resEl.innerHTML = top.length
      ? top.map((h, r) => { const n = D.nodes[h.i]; return `<li role="option" data-i="${h.i}" aria-selected="${r === active}"><span class="dotc" style="color:${areaColor(n.area)}"></span><span class="t">${hl(n.title, h)}</span><span class="k">${esc(typName(n.type))}</span><span class="sn">${hl(h.auszug, h)}</span></li>`; }).join("") + (S.hits.length > 7 ? `<li class="empty">${esc(t("weitereTreffer", { n: S.hits.length - 7 }))}</li>` : "")
      : `<li class="empty">${esc(t("keinTreffer"))}</li>`;
    resEl.classList.add("open");
  }
  function closeResults() { resEl.classList.remove("open"); }
  // Entprellt: Suche erst 120 ms nach dem letzten Tastendruck (Enter/Pfeile holen sie sofort nach)
  qEl.addEventListener("input", () => { clearTimeout(qTimer); qTimer = setTimeout(() => runSearch(qEl.value), 120); });
  qEl.addEventListener("focus", () => { if (S && S.query) renderResults(); hideHint(); touch(); });
  qEl.addEventListener("keydown", (e) => {
    if (!D) return;
    if (qTimer && (e.key === "Enter" || e.key === "ArrowDown" || e.key === "ArrowUp")) runSearch(qEl.value);
    const n = Math.min(7, S.hits.length);
    if (e.key === "ArrowDown") { active = (active + 1) % Math.max(1, n); renderResults(); e.preventDefault(); }
    else if (e.key === "ArrowUp") { active = (active - 1 + n) % Math.max(1, n); renderResults(); e.preventDefault(); }
    else if (e.key === "Enter" && S.hits[active]) { select(S.hits[active].i); qEl.blur(); }
  });
  resEl.addEventListener("pointerdown", (e) => { const li = e.target.closest("li[data-i]"); if (li) { e.preventDefault(); select(Number(li.dataset.i)); qEl.blur(); } });
  document.addEventListener("pointerdown", (e) => { if (!e.target.closest("#search")) closeResults(); });

  // ================================================================== filters, care, timeline
  // Kleines Formsymbol je Seitentyp (Legende im Filter), passend zur Form im Punkt-Shader
  const FORM_SVG = {
    thema: '<circle cx="6" cy="6" r="3.6"/>', entitaet: '<circle cx="6" cy="6" r="2"/><circle cx="6" cy="6" r="4.4" fill="none" stroke-width="1.3"/>',
    quelle: '<path d="M6 1.4 10.6 6 6 10.6 1.4 6Z"/>', synthese: '<path d="M6 .8 7.2 4.8 11.2 6 7.2 7.2 6 11.2 4.8 7.2.8 6 4.8 4.8Z"/>',
    notiz: '<circle cx="6" cy="6" r="2.5"/>', mcp: '<rect x="1.5" y="1.5" width="9" height="9" rx="4.5" fill="none" stroke-width="1.3"/><circle cx="6" cy="6" r="1.6"/>',
  };
  function formSymbol(ty) {
    const sp = document.createElement("span"); sp.className = "form";
    sp.innerHTML = `<svg viewBox="0 0 12 12" aria-hidden="true">${FORM_SVG[ty] || FORM_SVG.thema}</svg>`;
    return sp;
  }
  function chip(label, color, count, pressed, onClick, wide, symbol) {
    const b = document.createElement("button");
    b.className = "chip" + (wide ? " wide" : ""); b.setAttribute("aria-pressed", pressed);
    const l = document.createElement("span");
    if (symbol) l.appendChild(symbol);
    if (color) { const sw = document.createElement("span"); sw.className = "sw"; sw.style.color = color; l.appendChild(sw); }
    l.append(label); b.appendChild(l);
    if (count !== null) { const c = document.createElement("span"); c.className = "n"; c.textContent = count; b.appendChild(c); }
    b.addEventListener("click", () => onClick(b));
    return b;
  }
  function toggleSet(set, key, b) { if (set.has(key)) set.delete(key); else set.add(key); b.setAttribute("aria-pressed", set.has(key)); recompute(); if (S.query) runSearch(qEl.value, { fly: false }); }
  function buildFilters() {
    const cntA = {}, cntT = {}, cntS = {};
    for (const n of D.nodes) { cntA[n.area] = (cntA[n.area] || 0) + 1; cntT[n.type] = (cntT[n.type] || 0) + 1; cntS[n.status] = (cntS[n.status] || 0) + 1; }
    const fa = $("#fArea"); fa.textContent = "";
    // Zentrum nur, wenn es Seiten hat; Reihenfolge wie in den Daten (Cluster aus der Config, dann Archiv, Inbox, Werkzeuge)
    D.areas.filter((a) => a.id !== "zentrum" || cntA.zentrum).forEach(({ id: a }) => {
      const c = chip(areaName(a), areaColor(a), isWolke(a) ? D.inbox : cntA[a] || 0, S.areas.has(a), (b) => toggleSet(S.areas, a, b), true);
      if (!isWolke(a)) {
        c.addEventListener("pointerenter", () => { bereichHover = a; setzeBereichsLicht(); });
        c.addEventListener("pointerleave", () => { if (bereichHover === a) { bereichHover = null; setzeBereichsLicht(); } });
      }
      fa.appendChild(c);
    });
    const ft = $("#fType"); ft.textContent = "";
    ["thema", "entitaet", "quelle", "synthese", "notiz"].concat(cntT.mcp ? ["mcp"] : []).forEach((ty) => ft.appendChild(chip(typName(ty), null, cntT[ty] || 0, S.types.has(ty), (b) => toggleSet(S.types, ty, b), false, formSymbol(ty))));
    const fs = $("#fStatus"); fs.textContent = "";
    [["konflikt", "statusKonflikt", "--konflikt"], ["pruef", "statusPruef", "--pruef"], ["ok", "statusOk", "--fg-3"]].forEach(([k, l, v]) => fs.appendChild(chip(t(l), css(v), cntS[k] || 0, S.status.has(k), (b) => toggleSet(S.status, k, b), true)));
    const nAbg = D.nodes.filter((n) => n.gueltigkeit === "abgelaufen").length;
    if (nAbg) fs.appendChild(chip(t("statusAbgelaufen"), css("--abgelaufen"), nAbg, S.abgelaufen, (b) => { S.abgelaufen = !S.abgelaufen; b.setAttribute("aria-pressed", S.abgelaufen); recompute(); if (S.query) runSearch(qEl.value, { fly: false }); }, true));
  }
  $("#btnFilter").addEventListener("click", (e) => { const f = $("#filters"); f.classList.toggle("open"); e.currentTarget.setAttribute("aria-pressed", f.classList.contains("open")); });

  const careEl = $("#care");
  function buildCare() {
    const rang = (n) => (n.status === "konflikt" ? 0 : n.status === "pruef" ? 1 : 2);
    const items = D.nodes.map((n, i) => ({ n, i })).filter(({ n }) => brauchtPflege(n)).sort((a, b) => rang(a.n) - rang(b.n));
    const farbe = (n) => css(n.status === "konflikt" ? "--konflikt" : n.status === "pruef" ? "--pruef" : "--abgelaufen");
    const klein = (n) => (n.status === "konflikt" ? t("konfliktOffen") : n.status === "pruef" ? t("pruefKlein") : t("abgelaufenKlein") + (n.pruefenBis ? " · " + fmtDate(n.pruefenBis) : ""));
    $("#careList").innerHTML = items.length ? items.map(({ n, i }) => `<li data-i="${i}"><span class="ring" style="color:${farbe(n)}"></span><span>${esc(n.title)}<small>${esc(klein(n))}</small></span></li>`).join("") : `<li class="none">${esc(t("keineBefunde"))}</li>`;
    $("#careFresh").textContent = t("frischText", { n: D.nodes.filter((n) => n.fresh).length });
    const dot = $("#careDot"); dot.classList.toggle("on", items.length > 0); dot.classList.toggle("red", items.some(({ n }) => n.status === "konflikt"));
  }
  $("#careList").addEventListener("click", (e) => { const li = e.target.closest("li[data-i]"); if (li) select(Number(li.dataset.i)); });
  function setCare(on) {
    if (!D) return;
    S.care = on; careEl.hidden = !on; $("#btnCare").setAttribute("aria-pressed", on);
    if (on) { stopSearchTimers(); S.selected = -1; S.path = []; panel.hidden = true; S.hits = []; S.query = ""; qEl.value = ""; closeResults(); flyHome(); }
    recompute();
  }
  $("#btnCare").addEventListener("click", () => setCare(!S.care));

  const tl = $("#tl"), tlEl = $("#timeline");
  function drawHist() {
    if (!D) return;
    const c = $("#tlHist"); const w = c.clientWidth || 400, h = c.clientHeight || 22; c.width = w * DPR; c.height = h * DPR;
    const g = c.getContext("2d"); g.scale(DPR, DPR); g.clearRect(0, 0, w, h);
    const per = new Array(days + 1).fill(0); D.nodes.forEach((n) => per[Math.min(days, Math.max(0, n.day))]++);
    let mx = 1; for (const v of per) if (v > mx) mx = v;
    const bw = w / (days + 1);
    per.forEach((v, d) => { if (!v) return; const bh = Math.max(2, (v / mx) * (h - 2)); g.fillStyle = d <= S.day ? css("--fg-2") : css("--line-2"); g.globalAlpha = d <= S.day ? 0.75 : 1; g.fillRect(d * bw + bw * 0.2, h - bh, Math.max(1.5, bw * 0.6), bh); });
  }
  function setDay(d) {
    S.day = d; tl.value = d; tl.style.setProperty("--p", (d / days) * 100 + "%");
    $("#tlDate").textContent = fmtDate(new Date(tFirst + d * DAY).toISOString().slice(0, 10));
    let bis = 0; for (const n of D.nodes) if (n.day <= d) bis++;
    $("#tlCount").textContent = t("vonSeiten", { n: bis, gesamt: N });
    recompute(); drawHist();
  }
  tl.addEventListener("input", () => { if (!D) return; stopPlay(); setDay(Number(tl.value)); });
  let playing = null;
  function stopPlay() { if (playing) { clearInterval(playing); playing = null; tlEl.classList.remove("playing"); } }
  $("#tlPlay").addEventListener("click", () => {
    if (!D) return;
    if (playing) return stopPlay();
    if (S.day >= days) setDay(0);
    tlEl.classList.add("playing");
    playing = setInterval(() => { if (S.day >= days) return stopPlay(); setDay(S.day + 1); }, 140);
  });

  // ================================================================== misc ui
  function updateStats() {
    let seiten = 0, verb = 0; for (let i = 0; i < N; i++) seiten += nodeOn[i];
    for (const e of D.edges) if (nodeOn[e.a] && nodeOn[e.b]) verb++;
    $("#stats").textContent = t("statistik", { seiten, verbindungen: verb });
  }
  let hintTimer = setTimeout(hideHint, 9000);
  function hideHint() { $("#hint").classList.add("gone"); clearTimeout(hintTimer); }
  $("#btnReset").addEventListener("click", () => resetAll());
  function resetAll() { if (!D) return; stopPlay(); S.hits = []; S.query = ""; qEl.value = ""; closeResults(); S.selected = -1; S.path = []; S.pathA = -1; panel.hidden = true; setHash(null); if (S.care) setCare(false); setDay(days); flyHome(); }
  $("#btnTheme").addEventListener("click", () => { root.dataset.theme = light ? "dark" : "light"; try { localStorage.setItem("brain3d-theme", root.dataset.theme); } catch {} applyTheme(); if (D) { buildFilters(); buildCare(); renderPanel(); renderResults(); } });
  document.addEventListener("keydown", (e) => {
    touch();
    if (!D) return;
    const typing = document.activeElement === qEl;
    // Eingaben in fremden Feldern (z. B. die Steuerzentrale) lösen keine Kürzel der Ansicht aus
    if (!typing && e.target && e.target.closest && e.target.closest("input, textarea, select, [contenteditable='true']")) return;
    if (e.key === "/" && !typing) { e.preventDefault(); qEl.focus(); qEl.select(); return; }
    if (e.key === "Escape") {
      if (typing) { if (qEl.value) { qEl.value = ""; runSearch(""); } else qEl.blur(); return; }
      if (S.path.length || S.pathA >= 0) { S.path = []; S.pathA = -1; panel.hidden = true; recompute(); return; }
      if (S.selected >= 0) { clearSelection(); if (S.query) { qEl.value = S.query; runSearch(S.query); } return; }
      if (S.care) { setCare(false); return; }
      if (S.query) { qEl.value = ""; runSearch(""); return; }
      flyHome(); return;
    }
    if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === "r" || e.key === "R") resetAll();
    if (e.key === "t" || e.key === "T") $("#btnTheme").click();
    if (e.key === "p" || e.key === "P") setCare(!S.care);
    if ((e.key === "f" || e.key === "F") && S.selected >= 0) frameNode(S.selected);
  });
  function fromHash() {
    if (!D) return;
    const m = location.hash.match(/seite=([^&]+)/); if (!m) return;
    let id; try { id = decodeURIComponent(m[1]); } catch { return; } // kaputter Hash (z. B. %E0%A4) legt den Start nicht lahm
    const i = idx.get(id); if (i !== undefined && i !== S.selected) select(i);
  }
  window.addEventListener("hashchange", fromHash);
  // Sprache gewechselt (texte.js) → statische und gerade sichtbare Texte neu setzen
  document.addEventListener("brain:sprache", () => { uebersetzeDom(); if (D) { buildRegionLabels(); buildFilters(); buildCare(); setDay(S.day); renderPanel(); renderResults(); labelPool.forEach((el) => (el._w = 0)); } });

  // ================================================================== Dienst: Aufleuchten, Lebenszeichen, Ablauf
  let aufleuchtenAn = false, abgelaufen = false, gelesenSeit = Date.now(), gelesenLaeuft = false;
  const gesehen = new Set();
  const banner = $("#banner");
  document.addEventListener("brain:neu-oeffnen", () => {
    abgelaufen = true;
    if (banner) { banner.textContent = t("neuOeffnen"); banner.hidden = false; }
  });
  async function leseEinstellungen() {
    const a = api(); if (!a) { aufleuchtenAn = false; return; }
    try { const r = await a.holeJson("/api/einstellungen"); aufleuchtenAn = !(r && r.werte && r.werte.liveAufleuchten === false); }
    catch { aufleuchtenAn = false; }
  }
  async function frageGelesen() {
    const a = api();
    if (!a || !D || !aufleuchtenAn || abgelaufen || gelesenLaeuft || document.visibilityState !== "visible") return;
    gelesenLaeuft = true;
    try {
      const r = await a.holeJson("/api/gelesen?seit=" + gelesenSeit);
      const { ids, seit } = neueGelesene(r, gesehen, gelesenSeit);
      gelesenSeit = seit;
      for (const id of ids) { const i = idx.get(id); if (i !== undefined) leuchte(i); }
    } catch {} finally { gelesenLaeuft = false; }
  }
  function lebenszeichen() {
    const a = api();
    if (!a || abgelaufen || document.visibilityState !== "visible") return;
    a.holeJson("/api/ping").catch(() => {});
  }
  function starteDienstTakt() {
    if (!api()) return;
    setInterval(frageGelesen, 3000);
    setInterval(lebenszeichen, 60000);
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") { lebenszeichen(); frageGelesen(); } });
  }
  async function neuLaden() {
    if (!bereit) return;
    const raw = await holeRohdaten(true);
    if (!raw || !Array.isArray(raw.nodes)) return;
    wendeSpracheAn(raw);
    ladeDaten(raw);
    await leseEinstellungen();
  }

  // ================================================================== resize + loop
  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false); composer.setSize(w, h); bloom.resolution.set(w / 2, h / 2);
    buendelMat.uniforms.uRes.value.set((w * DPR) / 2, (h * DPR) / 2);
    camera.aspect = w / h; camera.fov = w / h < 0.8 ? 46 : 32; camera.updateProjectionMatrix();
    U.uScale.value = Math.min(1.25, Math.max(0.7, h / 1000));
    drawHist(); regionEls.forEach((r) => (r.el._w = 0));
  }
  window.addEventListener("resize", resize);
  mqMobile.addEventListener?.("change", resize);

  let viewOff = 0, viewOffY = 0, frames = 0, fpsT = 0;
  const clock = new T.Clock();
  function tick() {
    const dt = Math.min(0.05, clock.getDelta());
    U.uTime.value += dt;
    if (fly) {
      fly.t += dt / fly.dur; const k = fly.t >= 1 ? 1 : 1 - Math.pow(1 - fly.t, 3);
      camera.position.lerpVectors(fly.p0, fly.p1, k); controls.target.lerpVectors(fly.t0, fly.t1, k);
      if (fly.t >= 1) fly = null;
    }
    // Leerlauf: langsam drehen, sobald 8 s nichts passiert (nicht bei reduzierter Bewegung)
    if (!SHOT && !RM && !fly && !controls.autoRotate && performance.now() - lastInput > 8000 && document.activeElement !== qEl) controls.autoRotate = true;
    controls.update();
    const open = !panel.hidden, mob = isMobile();
    const wantX = open && !mob ? (panel.offsetWidth + 22) / 2 : 0, wantY = open && mob ? panel.offsetHeight / 2 - 40 : 0;
    const kk = snap || RM ? 1 : Math.min(1, dt * 6);
    viewOff += (wantX - viewOff) * kk; viewOffY += (wantY - viewOffY) * kk;
    if (Math.abs(viewOff) > 0.5 || Math.abs(viewOffY) > 0.5) { const w = canvas.clientWidth, h = canvas.clientHeight; camera.setViewOffset(w + viewOff * 2, h + viewOffY * 2, viewOff * 2, viewOffY * 2, w, h); } else camera.clearViewOffset();
    if (D) { animateState(dt); zoomTakt(dt); mcpFolgtKamera(); mcpKantenNachziehen(); aktualisiereMcp(); placeLabels(); }
    if (!RM) { const br = 1 + Math.sin(U.uTime.value * 0.6) * 0.003; brain.scale.setScalar(br); ghost.scale.setScalar(br); }
    if (light) renderer.render(scene, camera); else composer.render();
    frames++; fpsT += dt; if (fpsT > 1) { window.__fps = frames / fpsT; frames = 0; fpsT = 0; }
    requestAnimationFrame(tick);
  }

  // ================================================================== boot
  resize(); applyTheme();
  requestAnimationFrame(tick);
  window.__brain = {
    get S() { return S; }, get D() { return D; }, get bereit() { return bereit; }, get quelle() { return quelle; }, ladezeit: null,
    select: (i) => select(i), runSearch: (q, o) => runSearch(q, o), setPath: (a, b) => setPath(a, b), setCare: (on) => setCare(on), setDay: (d) => setDay(d),
    search: (q) => search(q, 10).map((h) => D.nodes[h.i].title),
    sichtbar: (i) => !!nodeOn[i], leuchten: (id) => { const i = idx.get(id); return i === undefined ? 0 : leuchtstaerke(i); },
    kanten: () => slots.length,
    buendel: () => buendelListe.map((b) => ({ a: b.a, b: b.b, n: b.n, sichtbar: b.sichtbar })), buendelAlpha: () => buendelMat.uniforms.uAlpha.value,
    buendelPunkt: (m) => { const p = buendelPunkte[m] && buendelPunkte[m][Math.round(BSEG / 2)]; if (!p) return null; const r = canvas.getBoundingClientRect(), q = toScreen(p, r.width, r.height); return [q.x + r.left, q.y + r.top]; },
    zoom: () => ({ ...zoomZ, abstand: camera.position.distanceTo(controls.target) }), ambient: () => ambient.map((i) => D.nodes[i].title),
  };
  (async () => {
    let raw = await datenVersprechen;
    if (raw && raw.__fehler) { fail(t("datenFehler"), true); return; }
    if (!raw || !Array.isArray(raw.nodes)) {
      // http ohne gültigen Zugang (Seite neu geladen in einem neuen Tab o. Ä.) → Hinweis zum Neu-Öffnen
      if (location.protocol === "http:") { fail(t("neuOeffnen"), true); return; }
      fail(t("keineDaten"), true); return;
    }
    wendeSpracheAn(raw);
    ladeDaten(raw);
    bereit = true;
    window.__brain.ladezeit = performance.now();
    if (SHOT) applyShot(); else fromHash();
    if (wartendeWahl !== null) { const id = wartendeWahl; wartendeWahl = null; waehleId(id); }
    requestAnimationFrame(() => { $("#loading").classList.add("done"); snap = !!SHOT; });
    await leseEinstellungen();
    starteDienstTakt();
  })();

  function applyShot() {
    hideHint();
    const id = (s) => D.nodes.findIndex((n) => n.id.includes(s));
    const q = params.get("q");
    if (q) { qEl.value = q; runSearch(qEl.value); }
    if (["select", "mobile-select", "light", "read"].includes(SHOT) && params.get("node")) { const i = id(params.get("node")); if (i >= 0) select(i); }
    if (SHOT === "links") { tab = "links"; renderPanel(); }
    if (SHOT === "path" && params.get("von") && params.get("nach")) setPath(id(params.get("von")), id(params.get("nach")));
    if (SHOT === "conflict") setCare(true);
    if (SHOT === "timeline") setDay(Math.round(days * 0.62));
    if (SHOT === "focus" && params.get("node")) { const i = id(params.get("node")); if (i >= 0) { select(i); frameNode(i); } }
    const az = params.get("az"), el = params.get("el");
    if (az || el) {
      const a = (Number(az || 22) * Math.PI) / 180, b = (Number(el || 14) * Math.PI) / 180, d = camera.position.distanceTo(controls.target) / Number(params.get("zoom") || 1);
      camera.position.set(controls.target.x + Math.sin(a) * Math.cos(b) * d, controls.target.y + Math.sin(b) * d, controls.target.z + Math.cos(a) * Math.cos(b) * d); controls.update();
    }
  }

  function addSynthetic(n) {
    const areas = D.areas.filter((x) => !FIXED[x.id] && x.id !== "werkzeuge").map((x) => x.id), base = D.nodes.length;
    if (!areas.length) areas.push("zentrum");
    for (let i = 0; i < n; i++) {
      const a = areas[i % areas.length], g = a + "/s" + ((i >> 2) % 17);
      D.nodes.push({ id: `synth/${a}/${i}.md`, name: `test-${i}`, title: `Testseite ${i}`, area: a, group: g, wiki: i % 3 === 0, type: i % 3 === 0 ? "thema" : "notiz", desc: "", body: "", size: 2000, quellen: [], usedIn: [], added: D.first, changed: D.first, status: "ok" });
    }
    let r = 99; const rr = () => { r = (r * 16807) % 2147483647; return r / 2147483647; };
    for (let i = 0; i < n * 1.5; i++) {
      const x = base + Math.floor(rr() * n), nx = D.nodes[x];
      let y;
      if (rr() < 0.85) { do { y = base + Math.floor(rr() * n); } while (D.nodes[y].group !== nx.group); }
      else y = base + Math.floor(rr() * n);
      if (x !== y) D.edges.push({ s: nx.id, t: D.nodes[y].id, kind: "link" });
    }
  }

  // ================================================================== Texte im Grundgerüst (index.html: data-t, data-t-title, data-t-aria, data-t-placeholder)
  function uebersetzeDom() {
    document.querySelectorAll("[data-t]").forEach((el) => { el.textContent = t(el.dataset.t); });
    document.querySelectorAll("[data-t-title]").forEach((el) => { el.title = t(el.dataset.tTitle); });
    document.querySelectorAll("[data-t-aria]").forEach((el) => { el.setAttribute("aria-label", t(el.dataset.tAria)); });
    document.querySelectorAll("[data-t-placeholder]").forEach((el) => { el.placeholder = t(el.dataset.tPlaceholder); });
    const bt = window.BrainTexte; if (bt && (bt.sprache === "de" || bt.sprache === "en")) document.documentElement.lang = bt.sprache;
  }
  function fail(msg, plain) {
    const l = document.getElementById("loading"); if (!l) return;
    const p = document.createElement("p"); p.className = "load-fail";
    p.textContent = plain ? msg : t("startFehler", { grund: msg });
    l.textContent = ""; l.appendChild(p);
  }
})();
