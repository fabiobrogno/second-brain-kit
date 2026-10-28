// .tools/ansicht/steuer.js — Steuerzentrale der Ansicht: Zahnrad oben rechts → Seitenleiste mit vier Reitern
// Einstellungen · Vorschläge · Pflege · Analyse (klassisches Skript, kein ESM). Setzt window.BrainSteuer = { init, oeffne,
// schliesse, hilfen }.
//
// Braucht: texte.js (BrainTexte) und api.js (BrainApi) — vorher laden. app.js ist optional: neuLaden()/waehle(id)
// werden nur aufgerufen, wenn window.BrainApp (oder init({ app })) existiert. Startet sich selbst, sobald das
// Dokument bereit ist; ein zweites init({ app }) setzt nur die App. Erzeugt alle Elemente selbst: Zahnrad in
// `.top .tools` (vor #btnTheme), sonst als eigener Knopf oben rechts; Seitenleiste als <section id="steuer"> am
// Ende von #app bzw. <body>.
//
// Sicherheit: alle Daten nur über textContent bzw. Attribute — nie HTML aus Zeichenketten. Ereignisse nur per
// addEventListener (strenge CSP, keine Inline-Handler). Ohne Dienst (file://) zeigt die Leiste nur den Hinweis
// „Zum Ändern sag deiner KI: zeig mir mein Brain“.
//
// Ereignisse: hört auf document „brain:neu-oeffnen“ (api.js, 403) und „brain:sprache“ (texte.js); meldet nach
// erfolgreichem Speichern „brain:einstellungen“ (detail: { werte }).
(function (root) {
  "use strict";

  // ------------------------------------------------------------------------------------------ reine Hilfen
  // Reihenfolge = Reihenfolge in der Maske. kosten: Textschlüssel des Etiketts (kosten0 → grün, sonst bernstein).
  // standard: nur für Felder, die ein älterer Dienst noch nicht kennt (dann gesperrt mit diesem Wert gezeigt).
  // stufenText: Beschriftung der Stufen aus „stufe_<schluessel>_<wert>“ (Bindestrich → Unterstrich).
  // brauchtClaudeWert: nur diese eine Stufe braucht den Befehl „claude“.
  const FELDER = [
    { schluessel: "staendeIntervallStunden", gruppe: "gruppeHintergrund", art: "stufen", werte: [0, 1, 2, 4], kosten: "kostenStand", nurClaude: true, brauchtClaude: true },
    { schluessel: "ernteSitzungsende", gruppe: "gruppeHintergrund", art: "schalter", kosten: "kostenErnte", nurClaude: true, brauchtClaude: true },
    { schluessel: "lektionen", gruppe: "gruppeHintergrund", art: "stufen", werte: ["aus", "lokal", "mit-ki"], stufenText: true, standard: "lokal", kosten: "kostenLektionen", nurClaude: true, brauchtClaudeWert: "mit-ki" },
    { schluessel: "pflegeLauf", gruppe: "gruppeHintergrund", art: "stufen", werte: ["aus", "woechentlich"], stufenText: true, standard: "aus", kosten: "kostenLauf", nurClaude: true, brauchtClaude: true },
    { schluessel: "antwortMesslatte", gruppe: "gruppeHintergrund", art: "stufen", werte: ["aus", "monatlich"], stufenText: true, standard: "aus", kosten: "kostenAntwort", nurClaude: true, brauchtClaude: true },
    { schluessel: "ernteNichtIn", gruppe: "gruppeHintergrund", art: "liste", kosten: "kosten0" },
    { schluessel: "hinweise", gruppe: "gruppeSitzung", art: "stufen", werte: ["aus", "niedrig", "mittel", "hoch"], kosten: "kostenHinweis", nurClaude: true },
    { schluessel: "ichKarte", gruppe: "gruppeSitzung", art: "schalter", kosten: "kostenIch" },
    { schluessel: "projektAutomatik", gruppe: "gruppeSitzung", art: "schalter", standard: true, kosten: "kostenProjekt", nurClaude: true },
    { schluessel: "wochenbericht", gruppe: "gruppeSitzung", art: "schalter", standard: true, kosten: "kostenWoche", nurClaude: true },
    { schluessel: "liveAufleuchten", gruppe: "gruppeAnsicht", art: "schalter", standard: true, kosten: "kosten0", nurClaude: true },
    { schluessel: "luecken", gruppe: "gruppeAnsicht", art: "schalter", kosten: "kosten0" },
    { schluessel: "updateHinweis", gruppe: "gruppeAnsicht", art: "schalter", standard: true, kosten: "kostenUpdate" },
    { schluessel: "sicherungTaeglich", gruppe: "gruppeAnsicht", art: "schalter", standard: true, kosten: "kosten0" },
  ];
  const GRUPPEN = ["gruppeHintergrund", "gruppeSitzung", "gruppeAnsicht"];
  // Was „Alles aus (wie v0.2)“ abschaltet: alles, was v0.3/v0.4 neu automatisch tut. Hinweise, Update-Hinweis
  // und tägliche Sicherung gab es schon in v0.2 — die bleiben, wie sie sind. Die v0.4-Schlüssel nur, wenn der
  // Dienst sie kennt (sonst wiese er das Speichern mit 400 ab).
  // Bewusst false (auch projektAutomatik): „Alles aus“ schaltet ab — das ist nicht der Schema-Standard (einstellungen.mjs).
  const NEU_IN_V03 = { staendeIntervallStunden: 0, ernteSitzungsende: false, ichKarte: false, projektAutomatik: false, liveAufleuchten: false, luecken: false };
  const NEU_IN_V04 = { wochenbericht: false, pflegeLauf: "aus", lektionen: "aus", antwortMesslatte: "aus" };
  const REITER = [["einstellungen", "reiterEinstellungen"], ["vorschlaege", "reiterVorschlaege"], ["pflege", "reiterPflege"], ["analyse", "reiterAnalyse"]];
  const REIHE = REITER.map((r) => r[0]);
  const WAHLEN = ["a", "b", "beide"];
  const MAX_NOTIZ = 300;
  // Posten des Pflegeberichts (pflege.mjs) — Titel „posten_<k>“, nächster Schritt „schritt_<k>“.
  const POSTEN = ["abgelaufen", "bald", "konflikte", "konflikteKaputt", "entscheidungen", "vorschlaege", "lektionen", "pflegeAuftraege", "verwaist",
    "nieGelesen", "luecken", "dubletten", "zuLang", "importe", "zufuehrungen", "messlatte"];
  const NUR_HINWEIS = ["bald", "nieGelesen", "luecken"];
  const BEFUNDE = ["zusammenlegen", "aufteilen", "veraltet", "widerspruch", "luecke", "frage", "sonstiges"];
  // Schwellen-Prüfung (analyse.mjs#empfehlung): Text „empf_<art>“.
  const EMPFEHLUNGEN = ["aus", "zuWenig", "passt", "lockerer", "strenger", "karten"];
  // Textschlüssel, die steuer.js zusammengesetzt benutzt (für den Vollständigkeitstest).
  const TEXTSCHLUESSEL = GRUPPEN.concat([
    "hinweis_aus", "hinweis_niedrig", "hinweis_mittel", "hinweis_hoch", "art_fakt", "art_stand", "quelle_search", "quelle_hint",
    "reiterEinstellungen", "reiterVorschlaege", "reiterAnalyse", "listeMeist", "listeMeistText", "listeNie", "listeNieText",
    "listeVerwaist", "listeVerwaistText", "listePruef", "listePruefText", "listeKonflikt", "listeKonfliktText",
    "listeAbgelaufen", "listeAbgelaufenText",
    "ordnerLeer", "ordnerDoppelt", "ordnerZuLang", "ordnerZuViele",
    "reiterPflege", "art_lektion", "art_pflege", "ziel_memory", "ziel_skill", "wahl_a", "wahl_b", "wahl_beide", "wahl_spaeter",
    "seiteGeaendert", "eintragAbgelaufen", "eintragAbgelaufen1", "eintragVerfall", "eintragVerfall1", "eintragKaputt", "uebernommenPflege", "eintragBald", "eintragKonflikte", "eintragEntscheidung",
    "eintragGleicherTitel", "eintragAehnlich", "eintragZeilen", "eintragImport", "eintragImport1", "eintragMesslatte",
    "eintragMesslatteUnter",
    "schwelleStreng", "schwelleLocker", "schwelleSeit", "schwelleNurEmpfehlung",
  ], EMPFEHLUNGEN.map((k) => "empf_" + k), POSTEN.map((k) => "posten_" + k), POSTEN.map((k) => "schritt_" + k), POSTEN.map((k) => "thema_" + k), BEFUNDE.map((k) => "befund_" + k),
  FELDER.filter((f) => f.stufenText).reduce((a, f) => a.concat(f.werte.map((v) => stufenSchluessel(f.schluessel, v))), []));
  const MAX_ORDNER = 20, MAX_PFAD = 300;

  function stufenSchluessel(k, v) { return "stufe_" + k + "_" + String(v).replace(/-/g, "_"); }
  const kopie = (x) => JSON.parse(JSON.stringify(x));
  const gleich = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  function aenderungen(alt, neu) {
    const aus = {};
    for (const k of Object.keys(neu || {})) if (!gleich(neu[k], alt ? alt[k] : undefined)) aus[k] = neu[k];
    return aus;
  }
  function allesAus(werte) {
    const w = kopie(werte || {});
    for (const k of Object.keys(NEU_IN_V03)) w[k] = NEU_IN_V03[k];
    for (const k of Object.keys(NEU_IN_V04)) if (k in w) w[k] = NEU_IN_V04[k];
    return w;
  }
  // Konflikt-Schlüssel für Zustände in der Oberfläche: Seite + Fingerabdruck der Aussagen (fp, vom Dienst), sonst
  // die Nummer — so bleibt „später“ am richtigen Kasten, auch wenn ein anderer Kasten wegfällt.
  const konfliktSchluessel = (k) => String(k && k.seite) + "#" + String(k && (k.fp || k.nr));
  // Körper für POST /api/konflikte/…: Wahl, Notiz und (falls bekannt) der Fingerabdruck — passt er nicht mehr zur
  // Nummer, antwortet der Dienst 409 statt die Wahl an einen fremden Kasten zu hängen.
  function entscheidungsKoerper(k, wahl, notiz) {
    const koerper = { wahl: wahl, notiz: notizText(notiz) };
    if (k && typeof k.fp === "string" && /^[0-9a-f]{12}$/.test(k.fp)) koerper.fingerabdruck = k.fp;
    return koerper;
  }
  // URL der Entscheidungs-Route: Seiten-ID als EIN Pfadsegment (Schrägstriche als %2F).
  function konfliktPfad(k) { return "/api/konflikte/" + encodeURIComponent(String(k.seite)) + "/" + encodeURIComponent(String(k.nr)); }
  // Offene zuerst (in Berichtsreihenfolge), dann entschiedene; „später“ zurückgestellte ans Ende und getrennt.
  function ordneKonflikte(liste, spaeter) {
    const alle = Array.isArray(liste) ? liste.filter((k) => k && typeof k === "object" && k.seite && k.a && k.b) : [];
    const sp = spaeter || {};
    const offen = alle.filter((k) => !k.entschieden && !sp[konfliktSchluessel(k)]);
    const entschieden = alle.filter((k) => !!k.entschieden);
    const zurueck = alle.filter((k) => !k.entschieden && !!sp[konfliktSchluessel(k)]);
    return { sichtbar: offen.concat(entschieden), zurueck: zurueck };
  }
  // Wandelt einen Konflikt-Link ([[ziel]]) in mögliche Knoten-IDs der Ansicht.
  function quellKandidaten(quelle, seite) {
    const q = String(quelle || "").trim().replace(/^\/+/, "");
    if (!q) return [];
    const mitMd = /\.md$/i.test(q) ? q : q + ".md";
    const ordner = String(seite || "").split("/").slice(0, -1).join("/");
    const aus = [q, mitMd];
    if (ordner) aus.push(ordner + "/" + mitMd);
    const wiki = String(seite || "").split("/")[0];
    if (wiki && wiki !== q.split("/")[0]) aus.push(wiki + "/" + mitMd);
    return aus.filter((x, i) => aus.indexOf(x) === i);
  }
  // Notiz für die Entscheidung: getrimmt, höchstens 300 Zeichen (der Dienst prüft das noch einmal).
  const notizText = (s) => String(s == null ? "" : s).trim().slice(0, MAX_NOTIZ);
  // Vorschlags-Art: unbekannte Arten wie „fakt“ zeigen.
  const vorschlagArt = (v) => (v && ["fakt", "stand", "lektion", "pflege"].indexOf(v.art) >= 0 ? v.art : "fakt");
  function neuerOrdner(liste, eingabe) {
    const pfad = String(eingabe == null ? "" : eingabe).trim();
    if (!pfad) return { ok: false, fehler: "ordnerLeer" };
    if (pfad.length > MAX_PFAD) return { ok: false, fehler: "ordnerZuLang" };
    if ((liste || []).indexOf(pfad) >= 0) return { ok: false, fehler: "ordnerDoppelt" };
    if ((liste || []).length >= MAX_ORDNER) return { ok: false, fehler: "ordnerZuViele" };
    return { ok: true, pfad: pfad };
  }

  // Texte der Schwellen-Prüfung (rein, testbar): s = analyse().schwelle, tt = Übersetzer, f = Formatierer.
  function schwellenTexte(s, tt, f) {
    const fmt = Object.assign({ zahl: String, prozent: (q) => Math.round((q || 0) * 100) + " %", datum: String }, f || {});
    const em = (s && s.empfehlung) || {};
    const art = EMPFEHLUNGEN.indexOf(em.art) >= 0 ? em.art : "zuWenig";
    const werte = art === "aus" ? [] : [
      tt("schwelleStreng", { a: fmt.zahl(s.stillGelesen || 0), b: fmt.zahl(s.still || 0), p: fmt.prozent(s.zuStreng) }),
      tt("schwelleLocker", { a: fmt.zahl(s.nieGelesen || 0), b: fmt.zahl(s.gezeigt || 0), p: fmt.prozent(s.zuLocker) }),
    ];
    const stufe = em.stufe ? tt("hinweis_" + em.stufe) : "";
    return {
      art: art, werte: werte,
      empfehlung: tt("empf_" + art, { stufe: stufe, n: fmt.zahl(s.min || 20) }),
      seit: s.seit ? tt("schwelleSeit", { datum: fmt.datum(String(s.seit).slice(0, 10)) }) + " " + tt("schwelleNurEmpfehlung") : "",
    };
  }

  const hilfen = {
    FELDER: FELDER, TEXTSCHLUESSEL: TEXTSCHLUESSEL, REITER: REIHE, POSTEN: POSTEN, aenderungen: aenderungen, allesAus: allesAus,
    neuerOrdner: neuerOrdner, konfliktPfad: konfliktPfad, ordneKonflikte: ordneKonflikte, quellKandidaten: quellKandidaten,
    notizText: notizText, vorschlagArt: vorschlagArt, entscheidungsKoerper: entscheidungsKoerper, postenEintrag: postenEintrag, stufenSchluessel: stufenSchluessel,
    schwellenTexte: schwellenTexte,
  };

  // ---------------------------------------------------------------------------------------- Oberfläche
  const t = (k, w) => (root.BrainTexte ? root.BrainTexte.t(k, w) : k);
  const sprache = () => (root.BrainTexte ? root.BrainTexte.sprache : "de");
  const gebiet = () => (sprache() === "en" ? "en-US" : "de-DE");
  const api = () => root.BrainApi || { verfuegbar: false };

  let appRef = null;
  const app = () => appRef || root.BrainApp || null;

  let doc = null, gestartet = false;
  let knopf = null, leiste = null, inhalt = null, fuss = null, reiterLeiste = null, titelEl = null, spracheEl = null, zuKnopf = null;

  const Z = {
    offen: false,
    reiter: "einstellungen",
    abgelaufen: false,
    anzahl: 0,
    ein: { laden: false, fehler: null, daten: null, entwurf: null, meldung: null, speichert: false, ordnerFehler: null, ordnerEingabe: "" },
    tokens: null,
    vor: { laden: false, fehler: null, liste: null, meldung: null, beschaeftigt: {}, aufgeklappt: {} },
    pfl: { laden: false, fehler: null, daten: null, meldung: null, beschaeftigt: {}, aendern: {}, notiz: {}, notizOffen: {}, spaeter: {}, zeigeSpaeter: false, offen: {}, lauf: { sendet: false, meldung: null } },
    ana: { laden: false, fehler: null, daten: null, alle: {} },
  };

  // h("div", { class: "x", text: "…", onclick: fn, "aria-label": "…" }, kind, "Text", …) — Texte werden Textknoten.
  function h(tag, attr) {
    const el = doc.createElement(tag);
    if (attr) {
      for (const k of Object.keys(attr)) {
        const v = attr[k];
        if (v === undefined || v === null || v === false) continue;
        if (k === "text") el.textContent = String(v);
        else if (k === "class") el.className = v;
        else if (k.slice(0, 2) === "on") { if (typeof v === "function") el.addEventListener(k.slice(2), v); }
        else if (k === "hidden") el.hidden = true;
        else if (k === "disabled") el.disabled = true;
        else el.setAttribute(k, v === true ? "" : String(v));
      }
    }
    for (let i = 2; i < arguments.length; i++) haenge(el, arguments[i]);
    return el;
  }
  function haenge(el, kind) {
    if (kind === null || kind === undefined || kind === false) return;
    if (Array.isArray(kind)) { for (const k of kind) haenge(el, k); return; }
    el.appendChild(typeof kind === "object" ? kind : doc.createTextNode(String(kind)));
  }
  const SVG = "http://www.w3.org/2000/svg";
  function svg(pfade, klasse) {
    const s = doc.createElementNS(SVG, "svg");
    s.setAttribute("viewBox", "0 0 24 24");
    s.setAttribute("aria-hidden", "true");
    if (klasse) s.setAttribute("class", klasse);
    for (const p of pfade) {
      const e = doc.createElementNS(SVG, p.circle ? "circle" : "path");
      if (p.circle) { e.setAttribute("cx", p.circle[0]); e.setAttribute("cy", p.circle[1]); e.setAttribute("r", p.circle[2]); }
      else e.setAttribute("d", p);
      s.appendChild(e);
    }
    return s;
  }
  // Zahnrad: 8 Zähne, als Pfad berechnet (eigene Zeichnung, keine fremde Icon-Bibliothek).
  function zahnradPfad() {
    const zaehne = 8, ra = 9.2, ri = 7.1, cx = 12, cy = 12, punkte = [];
    for (let i = 0; i < zaehne; i++) {
      const a = (i / zaehne) * Math.PI * 2, b = Math.PI / zaehne;
      const w = [a - b * 0.95, a - b * 0.45, a + b * 0.45, a + b * 0.95];
      punkte.push([ri, w[0]], [ra, w[1]], [ra, w[2]], [ri, w[3]]);
    }
    return punkte.map((p, i) => (i ? "L" : "M") + (cx + p[0] * Math.cos(p[1])).toFixed(2) + " " + (cy + p[0] * Math.sin(p[1])).toFixed(2)).join("") + "Z";
  }
  const ICON_ZAHNRAD = () => svg([zahnradPfad(), { circle: [12, 12, 2.8] }]);
  const ICON_ZU = () => svg(["M6 6l12 12M18 6 6 18"]);
  const ICON_SCHLOSS = () => svg(["M7 11V8a5 5 0 0 1 10 0v3", "M5.5 11h13v9h-13z"]);
  const ICON_NEU = () => svg(["M20 12a8 8 0 1 1-2.3-5.6", "M20 4v4.5h-4.5"]);
  const ICON_POST = () => svg(["M4 13l2.5-7h11L20 13v5H4z", "M4 13h4.5l1 2h5l1-2H20"]);
  const ICON_HAKEN = () => svg(["M5 12.5l4.5 4.5L19 7.5"]);
  const ICON_FUNKE = () => svg(["M12 3.5l1.7 5.1 5.3 1.9-5.3 1.9L12 17.5l-1.7-5.1L5 10.5l5.3-1.9z", "M18.5 15.5l.7 2 2 .8-2 .7-.7 2-.7-2-2-.7 2-.8z"]);

  const zahl = (n) => { try { return new Intl.NumberFormat(gebiet()).format(Math.round(n)); } catch (e) { return String(Math.round(n)); } };
  const prozent = (q) => { try { return new Intl.NumberFormat(gebiet(), { style: "percent", maximumFractionDigits: 0 }).format(q || 0); } catch (e) { return Math.round((q || 0) * 100) + " %"; } };
  function datum(iso) {
    const d = new Date(String(iso).length === 10 ? iso + "T12:00:00Z" : iso);
    if (isNaN(d)) return String(iso || "");
    try { return new Intl.DateTimeFormat(gebiet(), { day: "numeric", month: "short" }).format(d); } catch (e) { return String(iso); }
  }
  function wannRelativ(iso) {
    const d = new Date(iso);
    if (isNaN(d)) return "";
    const s = (d.getTime() - Date.now()) / 1000;
    const stufen = [[60, "second"], [3600, "minute"], [86400, "hour"], [604800, "day"], [2629800, "week"], [31557600, "month"], [Infinity, "year"]];
    const teiler = { second: 1, minute: 60, hour: 3600, day: 86400, week: 604800, month: 2629800, year: 31557600 };
    for (const [grenze, einheit] of stufen) {
      if (Math.abs(s) < grenze) {
        try { return new Intl.RelativeTimeFormat(gebiet(), { numeric: "auto" }).format(Math.round(s / teiler[einheit]), einheit); }
        catch (e) { return datum(iso); }
      }
    }
    return datum(iso);
  }
  const seitenName = (p) => String(p).split("/").pop().replace(/\.md$/i, "");
  const seitenOrt = (p) => { const t2 = String(p).split("/"); t2.pop(); return t2.join("/"); };

  // ---------------------------------------------------------------------------------------- Aufbau
  function baue() {
    const tools = doc.querySelector(".top .tools");
    knopf = h("button", {
      class: "icon-btn st-zahnrad" + (tools ? "" : " st-frei"), type: "button", id: "btnSteuer",
      "aria-controls": "steuer", "aria-expanded": "false", onclick: () => (Z.offen ? schliesse() : oeffne()),
    }, ICON_ZAHNRAD(), h("i", { class: "dot", id: "steuerDot" }));
    if (tools) tools.insertBefore(knopf, doc.getElementById("btnTheme") || null);
    else doc.body.appendChild(knopf);

    titelEl = h("h2", { class: "st-titel", id: "steuerTitel" });
    spracheEl = h("div", { class: "st-sprache", role: "group" });
    zuKnopf = h("button", { class: "icon-btn st-zu", type: "button", onclick: () => schliesse() }, ICON_ZU());
    reiterLeiste = h("div", { class: "st-reiter", role: "tablist" });
    inhalt = h("div", { class: "st-inhalt", role: "tabpanel", id: "steuerInhalt", tabindex: "-1" });
    fuss = h("div", { class: "st-fuss", hidden: true });
    leiste = h("section", { class: "steuer glass", id: "steuer", hidden: true, role: "dialog", "aria-labelledby": "steuerTitel" },
      h("header", { class: "st-kopf" }, titelEl, spracheEl, zuKnopf), reiterLeiste, inhalt, fuss);
    (doc.getElementById("app") || doc.body).appendChild(leiste);

    doc.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && Z.offen) { e.stopPropagation(); schliesse(); }
    }, true);
    doc.addEventListener("brain:neu-oeffnen", () => { Z.abgelaufen = true; zeichne(); });
    doc.addEventListener("brain:sprache", () => zeichne());
    doc.addEventListener("visibilitychange", () => { if (doc.visibilityState === "visible") ladeAnzahl(); });
    zeichne();
    ladeAnzahl();
  }

  function oeffne(reiter) {
    if (!gestartet) return;
    if (reiter && REIHE.indexOf(reiter) >= 0) Z.reiter = reiter;
    Z.offen = true;
    leiste.hidden = false;
    knopf.setAttribute("aria-expanded", "true");
    knopf.setAttribute("aria-pressed", "true");
    ladeReiter();
    zeichne();
    const aktiv = reiterLeiste.querySelector('[aria-selected="true"]');
    if (aktiv) aktiv.focus();
  }
  function schliesse() {
    if (!gestartet || !Z.offen) return;
    Z.offen = false;
    leiste.hidden = true;
    knopf.setAttribute("aria-expanded", "false");
    knopf.setAttribute("aria-pressed", "false");
    knopf.focus();
  }

  function zeichne() {
    if (!gestartet) return;
    knopf.title = t("zahnrad");
    knopf.setAttribute("aria-label", t("zahnrad"));
    const dot = knopf.querySelector(".dot");
    if (dot) dot.classList.toggle("on", Z.anzahl > 0);
    titelEl.textContent = t("steuerTitel");
    zuKnopf.setAttribute("aria-label", t("schliessen"));
    zuKnopf.title = t("schliessen");

    spracheEl.setAttribute("aria-label", t("sprache"));
    spracheEl.replaceChildren(...["de", "en"].map((s) => h("button", {
      type: "button", "aria-pressed": String(sprache() === s), lang: s,
      onclick: () => { if (root.BrainTexte) root.BrainTexte.setzeSprache(s); },
    }, s.toUpperCase())));

    const pflegeZahl = Z.pfl.daten && typeof Z.pfl.daten.zuTun === "number" ? Z.pfl.daten.zuTun : 0;
    reiterLeiste.replaceChildren(...REITER.map(([id, k]) => {
      const an = Z.reiter === id;
      return h("button", {
        type: "button", role: "tab", id: "steuerReiter-" + id, "aria-selected": String(an), "aria-controls": "steuerInhalt",
        tabindex: an ? "0" : "-1",
        onclick: () => { Z.reiter = id; ladeReiter(); zeichne(); },
        onkeydown: (e) => {
          const i = REIHE.indexOf(id), m = REIHE.length;
          const n = e.key === "ArrowRight" ? REIHE[(i + 1) % m] : e.key === "ArrowLeft" ? REIHE[(i + m - 1) % m] : null;
          if (!n) return;
          e.preventDefault(); Z.reiter = n; ladeReiter(); zeichne();
          const neu = reiterLeiste.querySelector("#steuerReiter-" + n); if (neu) neu.focus();
        },
      }, t(k), id === "vorschlaege" && Z.anzahl > 0 ? h("span", { class: "st-zahl", text: zahl(Z.anzahl) })
        : id === "pflege" && pflegeZahl > 0 ? h("span", { class: "st-zahl", text: zahl(pflegeZahl) }) : null);
    }));
    inhalt.setAttribute("aria-labelledby", "steuerReiter-" + Z.reiter);

    let koerper;
    if (!api().verfuegbar) koerper = hinweisKarte(ICON_SCHLOSS(), t("nurMitDienstTitel"), t("nurMitDienst"));
    else if (Z.abgelaufen) koerper = hinweisKarte(ICON_NEU(), t("neuOeffnenTitel"), t("neuOeffnen"));
    else if (Z.reiter === "einstellungen") koerper = zeichneEinstellungen();
    else if (Z.reiter === "vorschlaege") koerper = zeichneVorschlaege();
    else if (Z.reiter === "pflege") koerper = zeichnePflege();
    else koerper = zeichneAnalyse();
    // Neu zeichnen ohne den Platz zu verlieren: Scrollstand und Fokus (Elemente mit data-fokus) bleiben.
    const aktiv = doc.activeElement;
    const fokus = aktiv && inhalt.contains(aktiv) ? aktiv.getAttribute("data-fokus") : null;
    const scroll = inhalt.scrollTop;
    inhalt.replaceChildren(koerper);
    inhalt.scrollTop = scroll;
    if (fokus) {
      const ziel = Array.prototype.find.call(inhalt.querySelectorAll("[data-fokus]"), (el) => el.getAttribute("data-fokus") === fokus);
      if (ziel && !ziel.disabled) ziel.focus();
    }

    const fussZeigen = api().verfuegbar && !Z.abgelaufen && Z.reiter === "einstellungen" && !!Z.ein.entwurf;
    fuss.hidden = !fussZeigen;
    fuss.replaceChildren(fussZeigen ? zeichneFuss() : "");
  }

  function hinweisKarte(icon, titel, text, knopfText, aktion) {
    return h("div", { class: "st-leer" },
      h("div", { class: "st-leer-icon" }, icon),
      h("p", { class: "st-leer-titel", text: titel }),
      h("p", { class: "st-leer-text", text: text }),
      knopfText ? h("button", { class: "st-btn", type: "button", onclick: aktion }, knopfText) : null);
  }
  const laedt = () => h("div", { class: "st-laedt", role: "status" }, h("span", { class: "st-puls" }), t("laden"));
  const fehlerKarte = (aktion) => hinweisKarte(ICON_NEU(), t("fehlerLaden"), "", t("nochmal"), aktion);

  // --------------------------------------------------------------------------------------- Laden
  function ladeReiter() {
    if (!api().verfuegbar || Z.abgelaufen) return;
    if (Z.reiter === "einstellungen") { if (!Z.ein.daten) ladeEinstellungen(); ladeTokens(); }
    else if (Z.reiter === "vorschlaege") ladeVorschlaege();
    else if (Z.reiter === "pflege") { ladePflege(); if (!Z.ein.daten) ladeEinstellungen(); }
    else ladeAnalyse();
  }

  async function ladeEinstellungen(behalteEntwurf) {
    const vorher = behalteEntwurf && Z.ein.daten && Z.ein.entwurf ? aenderungen(Z.ein.daten.werte, Z.ein.entwurf) : null;
    Z.ein.laden = true; Z.ein.fehler = null; zeichne();
    try {
      const d = await api().holeJson("/api/einstellungen");
      Z.ein.daten = d;
      Z.ein.entwurf = kopie(d.werte || {});
      if (vorher) for (const k of Object.keys(vorher)) Z.ein.entwurf[k] = vorher[k];
    } catch (e) { Z.ein.fehler = e; }
    Z.ein.laden = false; zeichne();
  }
  async function ladeTokens() {
    try { const a = await api().holeJson("/api/analyse"); Z.tokens = a && a.tokens ? a.tokens : null; Z.ana.daten = a; }
    catch (e) { /* Kopfzeile bleibt dann ohne Zahl */ }
    zeichne();
  }
  async function ladeVorschlaege() {
    Z.vor.laden = true; Z.vor.fehler = null; zeichne();
    try {
      const l = await api().holeJson("/api/vorschlaege");
      Z.vor.liste = Array.isArray(l) ? l : Array.isArray(l && l.vorschlaege) ? l.vorschlaege : [];
      Z.anzahl = Z.vor.liste.length;
    } catch (e) { Z.vor.fehler = e; }
    Z.vor.laden = false; zeichne();
  }
  let letzteAnzahl = 0;
  async function ladeAnzahl() {
    if (!api().verfuegbar || Z.abgelaufen || Date.now() - letzteAnzahl < 20000) return;
    letzteAnzahl = Date.now();
    try {
      const l = await api().holeJson("/api/vorschlaege");
      const liste = Array.isArray(l) ? l : [];
      Z.anzahl = liste.length;
      if (!Z.vor.laden) Z.vor.liste = liste;
      zeichne();
    } catch (e) { /* Punkt bleibt aus */ }
  }
  async function ladePflege() {
    const P = Z.pfl;
    P.laden = true; P.fehler = null; zeichne();
    try {
      const d = await api().holeJson("/api/pflege");
      P.daten = d && typeof d === "object" ? d : { posten: [], konflikte: [], zuTun: 0 };
    } catch (e) { P.fehler = e; }
    P.laden = false; zeichne();
  }
  async function ladeAnalyse() {
    Z.ana.laden = true; Z.ana.fehler = null; zeichne();
    try { const a = await api().holeJson("/api/analyse"); Z.ana.daten = a; Z.tokens = a && a.tokens ? a.tokens : Z.tokens; }
    catch (e) { Z.ana.fehler = e; }
    Z.ana.laden = false; zeichne();
  }

  // --------------------------------------------------------------------------------- Einstellungen
  function zeichneEinstellungen() {
    const E = Z.ein;
    if (!E.daten) return E.fehler ? fehlerKarte(() => ladeEinstellungen()) : laedt();
    const kaputt = !!E.daten.fehler;
    const claude = E.daten.claudeGefunden !== false;
    const w = E.entwurf || E.daten.werte || {};
    const wrap = h("div", { class: "st-einstellungen" });

    const heute = Z.tokens && typeof Z.tokens.heute === "number" ? Z.tokens.heute : null;
    wrap.appendChild(heute === null
      ? h("div", { class: "st-tokens st-tokens-leer" }, t("tokensUnbekannt"))
      : h("div", { class: "st-tokens" },
        h("span", { class: "st-tokens-text" }, t("tokensHeute", { n: zahl(heute) })),
        h("span", { class: "st-geschaetzt", text: t("geschaetzt") })));

    if (kaputt) wrap.appendChild(h("div", { class: "st-warnung", role: "alert", text: t("configKaputt") }));
    wrap.appendChild(h("p", { class: "st-muted", text: t("wirkungHinweis") }));

    for (const g of GRUPPEN) {
      const sek = h("section", { class: "st-gruppe" }, h("h3", { text: t(g) }));
      if (g === "gruppeHintergrund" && !claude) sek.appendChild(h("p", { class: "st-info", text: t("claudeFehlt") }));
      for (const f of FELDER.filter((x) => x.gruppe === g)) {
        const bekannt = !E.daten.werte || f.schluessel in E.daten.werte;
        sek.appendChild(zeile(f, bekannt ? w : Object.assign({}, w, { [f.schluessel]: f.standard }), kaputt || !bekannt || (f.brauchtClaude && !claude), bekannt, claude));
      }
      wrap.appendChild(sek);
    }
    return wrap;
  }

  function setze(k, v) {
    Z.ein.entwurf[k] = v;
    if (Z.ein.meldung && Z.ein.meldung.art !== "konflikt") Z.ein.meldung = null;
    zeichne();
  }

  function zeile(f, w, gesperrt, bekannt, claude) {
    const k = f.schluessel, id = "st-f-" + k;
    const etiketten = h("div", { class: "st-etiketten" },
      h("span", { class: "st-kosten " + (f.kosten === "kosten0" ? "gruen" : "bernstein"), text: t(f.kosten) }),
      f.nurClaude ? h("span", { class: "st-badge", text: t("nurClaudeCode") }) : null,
      bekannt === false ? h("span", { class: "st-badge", text: t("kommtNoch") }) : null);
    const text = h("div", { class: "st-text" },
      h("div", { class: "st-name", id: id, text: t("titel_" + k) }),
      h("p", { class: "st-satz", text: t("satz_" + k) }),
      etiketten);
    const geaendert = Z.ein.daten && !gleich(w[k], Z.ein.daten.werte[k]);
    const z = h("div", { class: "st-zeile" + (gesperrt ? " gesperrt" : "") + (geaendert ? " geaendert" : "") + (f.art !== "schalter" ? " breit" : "") }, text);

    if (f.art === "schalter") {
      const an = w[k] === true;
      z.appendChild(h("button", {
        class: "st-schalter", type: "button", role: "switch", "aria-checked": String(an), "aria-labelledby": id, "data-fokus": "sw-" + k,
        disabled: gesperrt, onclick: () => setze(k, !an),
      }, h("span", { class: "st-knopf" })));
    } else if (f.art === "stufen") {
      const gruppe = h("div", { class: "st-stufen", role: "group", "aria-labelledby": id });
      for (const v of f.werte) {
        const name = f.stufenText ? t(stufenSchluessel(k, v)) : k === "hinweise" ? t("hinweis_" + v) : v === 0 ? t("aus") : t("stunden", { n: v });
        const aus = gesperrt || (f.brauchtClaudeWert === v && claude === false && w[k] !== v);
        gruppe.appendChild(h("button", { type: "button", "aria-pressed": String(w[k] === v), "data-fokus": "stufe-" + k + "-" + v, disabled: aus, title: aus && !gesperrt ? t("laufOhneClaude") : null, onclick: () => setze(k, v) }, name));
      }
      z.appendChild(gruppe);
    } else {
      z.appendChild(ordnerListe(k, Array.isArray(w[k]) ? w[k] : [], gesperrt, id));
    }
    return z;
  }

  function ordnerListe(k, liste, gesperrt, id) {
    const E = Z.ein;
    const eingabe = h("input", {
      type: "text", class: "st-eingabe", placeholder: t("ordnerPlatzhalter"), "aria-labelledby": id, "data-fokus": "eingabe-" + k,
      spellcheck: "false", autocomplete: "off", maxlength: String(MAX_PFAD), disabled: gesperrt,
      oninput: (e) => { E.ordnerEingabe = e.target.value; if (E.ordnerFehler) { E.ordnerFehler = null; fehlerEl.textContent = ""; } },
      onkeydown: (e) => { if (e.key === "Enter") { e.preventDefault(); dazu(); } },
    });
    eingabe.value = E.ordnerEingabe || "";
    const fehlerEl = h("p", { class: "st-feldfehler", role: "status", text: E.ordnerFehler ? t(E.ordnerFehler) : "" });
    function dazu() {
      const r = neuerOrdner(liste, eingabe.value);
      if (!r.ok) { E.ordnerFehler = r.fehler; fehlerEl.textContent = t(r.fehler); eingabe.focus(); return; }
      E.ordnerEingabe = ""; E.ordnerFehler = null;
      setze(k, liste.concat([r.pfad]));
      const neu = inhalt.querySelector(".st-eingabe"); if (neu) neu.focus();
    }
    const ul = h("ul", { class: "st-ordner" });
    if (!liste.length) ul.appendChild(h("li", { class: "st-ordner-leer", text: t("keineOrdner") }));
    liste.forEach((p, i) => ul.appendChild(h("li", null,
      h("span", { class: "st-pfad", text: p, title: p }),
      h("button", {
        type: "button", class: "st-weg", "aria-label": t("entfernen", { pfad: p }), title: t("entfernen", { pfad: p }), disabled: gesperrt,
        onclick: () => { setze(k, liste.filter((_, j) => j !== i)); const e = inhalt.querySelector(".st-eingabe"); if (e) e.focus(); },
      }, ICON_ZU()))));
    return h("div", { class: "st-liste-feld" }, ul,
      h("div", { class: "st-ordner-neu" }, eingabe, h("button", { type: "button", class: "st-btn", disabled: gesperrt, onclick: dazu }, t("hinzufuegen"))),
      fehlerEl);
  }

  function zeichneFuss() {
    const E = Z.ein;
    const offen = Object.keys(aenderungen(E.daten.werte, E.entwurf)).length;
    const kaputt = !!E.daten.fehler;
    let status;
    if (E.meldung && E.meldung.art === "konflikt") {
      status = h("div", { class: "st-status konflikt", role: "alert" }, h("span", { text: t("konflikt") }),
        h("button", { type: "button", class: "st-link", onclick: () => { E.meldung = null; ladeEinstellungen(true); } }, t("neuLaden")));
    } else if (E.meldung) status = h("div", { class: "st-status " + E.meldung.art, role: E.meldung.art === "fehler" ? "alert" : "status", text: E.meldung.text });
    else if (offen) status = h("div", { class: "st-status offen", role: "status", text: offen === 1 ? t("aenderung1") : t("aenderungN", { n: offen }) });
    else status = h("div", { class: "st-status", role: "status" });

    return h("div", { class: "st-fuss-innen" }, status,
      h("div", { class: "st-fuss-knoepfe" },
        h("button", { type: "button", class: "st-btn st-ghost", disabled: kaputt || E.speichert, onclick: allesAusKlick }, t("allesAus")),
        h("span", { class: "st-luecke" }),
        offen ? h("button", { type: "button", class: "st-btn st-ghost", disabled: E.speichert, onclick: () => { E.entwurf = kopie(E.daten.werte); E.meldung = null; zeichne(); } }, t("aenderungenVerwerfen")) : null,
        h("button", { type: "button", class: "st-btn st-primaer", disabled: !offen || kaputt || E.speichert, onclick: () => speichere() },
          E.speichert ? t("speichert") : t("speichern"))));
  }

  async function allesAusKlick() {
    Z.ein.entwurf = allesAus(Z.ein.entwurf);
    const ok = await speichere();
    if (ok) { Z.ein.meldung = { art: "ok", text: t("allesAusFertig") }; zeichne(); }
  }

  async function speichere() {
    const E = Z.ein;
    const neu = aenderungen(E.daten.werte, E.entwurf);
    if (!Object.keys(neu).length) { E.meldung = { art: "ok", text: t("gespeichert") }; zeichne(); return true; }
    E.speichert = true; E.meldung = null; zeichne();
    let ok = false;
    try {
      const r = await api().sende("PUT", "/api/einstellungen", { werte: neu, stand: E.daten.stand });
      E.daten.werte = kopie(E.entwurf);
      if (r && r.stand !== undefined) E.daten.stand = r.stand;
      E.meldung = { art: "ok", text: t("gespeichert") };
      ok = true;
      try { doc.dispatchEvent(new root.CustomEvent("brain:einstellungen", { detail: { werte: kopie(E.daten.werte) } })); } catch (e) { /* nur Info */ }
      const a = app();
      if (a && typeof a.neuLaden === "function") { try { a.neuLaden(); } catch (e) { /* Ansicht lädt beim nächsten Mal */ } }
      ladeTokens();
    } catch (e) {
      if (e.status === 409) E.meldung = { art: "konflikt" };
      else if (e.status !== 403) E.meldung = { art: "fehler", text: t("speichernFehler", { fehler: e.message || "?" }) };
    }
    E.speichert = false; zeichne();
    return ok;
  }

  // ------------------------------------------------------------------------------------- Vorschläge
  function zeichneVorschlaege() {
    const V = Z.vor;
    if (!V.liste) return V.fehler ? fehlerKarte(() => ladeVorschlaege()) : laedt();
    const wrap = h("div", { class: "st-vorschlaege" });
    if (V.meldung) wrap.appendChild(h("div", { class: "st-toast " + V.meldung.art, role: "status", text: V.meldung.text }));
    if (!V.liste.length) {
      wrap.appendChild(hinweisKarte(ICON_POST(), t("vorschlaegeLeer"), t("vorschlaegeLeerText")));
      return wrap;
    }
    wrap.appendChild(h("p", { class: "st-intro", text: t("vorschlaegeIntro") }));
    for (const v of V.liste) {
      const id = String(v.id || "");
      const beschaeftigt = !!V.beschaeftigt[id];
      const lang = String(v.text || "").length > 320 || String(v.text || "").split("\n").length > 7;
      const auf = !!V.aufgeklappt[id];
      const art = vorschlagArt(v);
      const lektion = art === "lektion";
      const regel = lektion ? lektionsFelder(v) : null;
      // Bei Lektionen mit Regel/Warum/Wie ist der Text nur der Auszug aus der Sitzung → zugeklappt hinter einem Link.
      const auszugVersteckt = lektion && regel && !auf;
      wrap.appendChild(h("article", { class: "st-vorschlag st-v-" + art + (beschaeftigt ? " beschaeftigt" : "") },
        h("div", { class: "st-v-kopf" },
          h("div", { class: "st-v-marken" },
            h("span", { class: "st-art " + art, text: t("art_" + art) }),
            lektion ? h("span", { class: "st-v-ziel", text: t(v.ziel === "skill" ? "ziel_skill" : "ziel_memory") }) : null,
            art === "pflege" ? h("span", { class: "st-v-ziel", text: t("befund_" + (BEFUNDE.indexOf(v.befund) >= 0 ? v.befund : "sonstiges")) }) : null),
          v.erstellt ? h("time", { datetime: String(v.erstellt), title: String(v.erstellt), text: wannRelativ(v.erstellt) }) : null),
        h("h4", { text: v.titel || id }),
        regel,
        regel && v.text ? h("p", { class: "st-v-auszug-titel", text: t("lektionAuszug") }) : null,
        auszugVersteckt ? null : h("p", { class: "st-v-text" + (regel ? " auszug" : "") + (lang && !auf ? " gekuerzt" : ""), text: v.text || "" }),
        (lang || (regel && v.text)) ? h("button", { type: "button", class: "st-link", onclick: () => { V.aufgeklappt[id] = !auf; zeichne(); } }, auf ? t("wenigerLesen") : t("mehrLesen")) : null,
        h("div", { class: "st-v-fuss" },
          v.quelleOrdner ? h("span", { class: "st-v-ordner", title: String(v.quelleOrdner), text: t("ausOrdner", { ordner: v.quelleOrdner }) }) : h("span"),
          h("div", { class: "st-v-knoepfe" },
            h("button", { type: "button", class: "st-btn st-ghost", disabled: beschaeftigt, onclick: () => entscheide(id, "verwerfen") }, t("verwerfen")),
            h("button", { type: "button", class: "st-btn st-primaer", disabled: beschaeftigt, onclick: () => entscheide(id, "uebernehmen") }, t("uebernehmen"))))));
    }
    return wrap;
  }

  // Regel / Warum / Wie anwenden einer Lektion als Definitionsliste — null, wenn keins der Felder gefüllt ist.
  function lektionsFelder(v) {
    const zeilen = [["lektionRegel", v.regel], ["lektionWarum", v.warum], ["lektionWie", v.wie]].filter((z) => typeof z[1] === "string" && z[1].trim());
    if (!zeilen.length) return null;
    const dl = h("dl", { class: "st-lektion" });
    for (const [k, wert] of zeilen) { dl.appendChild(h("dt", { text: t(k) })); dl.appendChild(h("dd", { text: wert.trim() })); }
    return dl;
  }

  async function entscheide(id, aktion) {
    const V = Z.vor;
    V.beschaeftigt[id] = true; V.meldung = null; zeichne();
    try {
      const r = await api().sende("POST", "/api/vorschlaege/" + encodeURIComponent(id) + "/" + aktion, {});
      const ziel = r && r.ziel ? String(r.ziel) : "";
      const war = (V.liste || []).find((x) => String(x.id) === id);
      const lektion = aktion === "uebernehmen" && war && war.art === "lektion";
      // Pflege-Vorschlag → Prüfauftrag in <inbox>/_pflege, mit nächstem Schritt statt bloßem Ablageort (Final-Review #1)
      const pflege = aktion === "uebernehmen" && war && war.art === "pflege";
      V.meldung = { art: "ok", text: lektion ? t("uebernommenLektion") : pflege ? t("uebernommenPflege") : t(aktion === "uebernehmen" ? "uebernommen" : "verworfen", { ziel: ziel }) };
      const a = app();
      if (a && typeof a.neuLaden === "function") { try { a.neuLaden(); } catch (e) { /* Ansicht lädt beim nächsten Mal */ } }
    } catch (e) {
      if (e.status !== 403) V.meldung = { art: "fehler", text: t("aktionFehler", { fehler: e.message || "?" }) };
    }
    delete V.beschaeftigt[id];
    await ladeVorschlaege();
  }

  // ----------------------------------------------------------------------------------------- Pflege
  function zeichnePflege() {
    const P = Z.pfl;
    if (!P.daten) return P.fehler ? fehlerKarte(() => ladePflege()) : laedt();
    const d = P.daten;
    const posten = Array.isArray(d.posten) ? d.posten.filter((p) => p && POSTEN.indexOf(p.schluessel) >= 0) : [];
    const zuTun = typeof d.zuTun === "number" ? d.zuTun : 0;
    const wrap = h("div", { class: "st-pflege" });

    // Kopf: wie viel zu tun ist + Aktualisieren
    wrap.appendChild(h("div", { class: "st-a-kopf" },
      h("span", { text: d.erstellt ? t("pflegeStand", { wann: wannRelativ(d.erstellt) }) : "" }),
      h("button", { type: "button", class: "st-link", disabled: P.laden, onclick: () => ladePflege() }, P.laden ? t("laden") : t("aktualisieren"))));
    wrap.appendChild(zuTun > 0
      ? h("div", { class: "st-p-summe" }, h("span", { class: "st-p-summe-zahl", text: zahl(zuTun) }), h("span", { text: zuTun === 1 ? t("pflegeSache1") : t("pflegeSachen") }))
      : h("div", { class: "st-p-summe ok" }, h("span", { class: "st-p-haken" }, ICON_HAKEN()), h("span", null, h("strong", { text: t("pflegeNichts") }), " ", t("pflegeNichtsText"))));
    const beauftragt = typeof d.beauftragt === "number" ? d.beauftragt : 0;
    if (beauftragt > 0) wrap.appendChild(h("div", { class: "st-p-beauftragt", text: t("pflegeBeauftragt", { n: zahl(beauftragt) }) }));
    if (P.meldung) wrap.appendChild(h("div", { class: "st-toast " + P.meldung.art, role: "status", text: P.meldung.text }));

    // Widersprüche
    const k = ordneKonflikte(d.konflikte, P.spaeter);
    const kAnzahl = k.sichtbar.filter((x) => !x.entschieden).length;
    const ks = h("section", { class: "st-a-block st-konflikte" },
      h("h3", null, kAnzahl ? h("i", { class: "st-ring rot" }) : null, t("konflikteTitel"), h("span", { class: "st-zahl", text: zahl(kAnzahl) })));
    if (!k.sichtbar.length && !k.zurueck.length) ks.appendChild(h("p", { class: "st-muted", text: t("konflikteLeer") }));
    else {
      if (k.sichtbar.some((x) => !x.entschieden)) ks.appendChild(h("p", { class: "st-muted", text: t("konflikteText") }));
      for (const x of k.sichtbar) ks.appendChild(konfliktKarte(x));
      if (k.zurueck.length) {
        if (P.zeigeSpaeter) for (const x of k.zurueck) ks.appendChild(konfliktKarte(x, true));
        ks.appendChild(h("button", { type: "button", class: "st-link st-p-mehr", onclick: () => { P.zeigeSpaeter = !P.zeigeSpaeter; zeichne(); } },
          P.zeigeSpaeter ? t("wenigerLesen") : t("spaeterZeigen", { n: zahl(k.zurueck.length) })));
      }
    }
    wrap.appendChild(ks);

    // Bericht: Posten mit Befund (Konflikte stehen schon oben), danach eine Zeile „ohne Befund“.
    const mit = posten.filter((p) => p.anzahl > 0 && p.schluessel !== "konflikte");
    const ohne = posten.filter((p) => !(p.anzahl > 0) && p.schluessel !== "konflikte");
    const bs = h("section", { class: "st-a-block st-bericht" }, h("h3", { text: t("berichtTitel") }));
    for (const p of mit) bs.appendChild(postenZeile(p));
    if (ohne.length) bs.appendChild(h("p", { class: "st-p-ohne", text: t("berichtOhne", { liste: ohne.map((p) => t("thema_" + p.schluessel)).join(" · ") }) }));
    wrap.appendChild(bs);

    wrap.appendChild(laufKarte(d.lauf));
    return wrap;
  }

  function seiteWaehlen(kandidaten) {
    const a = app();
    let ok = false;
    if (a && typeof a.waehle === "function") {
      for (const id of kandidaten) { try { if (a.waehle(id) !== false) { ok = true; break; } } catch (e) { /* nächster */ } }
    }
    if (!ok) { Z.pfl.meldung = { art: "fehler", text: t("seiteNichtGefunden") }; zeichne(); return; }
    if (root.matchMedia && root.matchMedia("(max-width: 720px)").matches) schliesse();
  }

  function konfliktKarte(k, zurueckgestellt) {
    const P = Z.pfl;
    const key = konfliktSchluessel(k);
    const beschaeftigt = !!P.beschaeftigt[key];
    const gewaehlt = WAHLEN.indexOf(k.entschieden) >= 0 ? k.entschieden : null;
    const fragen = !gewaehlt || !!P.aendern[key];
    const seite = String(k.seite);
    const karte = h("article", { class: "st-konflikt" + (gewaehlt && !fragen ? " entschieden" : "") + (beschaeftigt ? " beschaeftigt" : "") + (zurueckgestellt ? " zurueck" : ""), "data-wahl": gewaehlt || "" },
      h("div", { class: "st-ko-kopf" },
        h("button", { type: "button", class: "st-ko-seite", title: seite, onclick: () => seiteWaehlen([seite]) },
          h("span", { class: "st-s-name", text: seitenName(seite) }), h("span", { class: "st-s-ort", text: seitenOrt(seite) })),
        h("span", { class: "st-ko-nr", text: t("konfliktNr", { nr: k.nr }) })));

    const ab = h("div", { class: "st-ab" });
    for (const seiteAB of ["a", "b"]) {
      const aus = k[seiteAB] || {};
      const quelle = aus.quelle ? String(aus.quelle) : "";
      const klasse = "st-aussage" + (gewaehlt === seiteAB || gewaehlt === "beide" ? " gilt" : gewaehlt ? " gilt-nicht" : "");
      ab.appendChild(h("div", { class: klasse },
        h("span", { class: "st-ab-marke", "aria-hidden": "true", text: seiteAB.toUpperCase() }),
        h("p", { class: "st-ab-text", text: aus.text || "" }),
        quelle
          ? h("button", { type: "button", class: "st-quelle", title: quelle, onclick: () => seiteWaehlen(quellKandidaten(quelle, seite)) }, t("quelleOeffnen", { name: seitenName(quelle) }))
          : h("span", { class: "st-quelle leer", text: t("ohneQuelle") })));
    }
    karte.appendChild(ab);

    if (!fragen) {
      karte.appendChild(h("div", { class: "st-ko-stand" },
        h("span", { class: "st-ko-chip" }, ICON_HAKEN(), t("entschiedenAls", { wahl: t("wahl_" + gewaehlt) })),
        h("span", { class: "st-ko-stand-text", text: t("entschiedenText") }),
        h("button", { type: "button", class: "st-link", "data-fokus": "aendern-" + key, onclick: () => {
          // Gespeicherte Notiz vorbelegen — sonst überschriebe „Ändern“ sie nach einem Neuladen still mit leer.
          if (P.notiz[key] == null && k.notiz) { P.notiz[key] = notizText(k.notiz); P.notizOffen[key] = true; }
          P.aendern[key] = true; zeichne();
        } }, t("aendern"))));
      return karte;
    }

    const notizOffen = !!P.notizOffen[key];
    const knopf = (wahl, klasse) => h("button", {
      type: "button", class: "st-btn " + klasse + (gewaehlt === wahl ? " aktiv" : ""), disabled: beschaeftigt, "data-fokus": "wahl-" + wahl + "-" + key,
      "aria-pressed": gewaehlt ? String(gewaehlt === wahl) : null, onclick: () => entscheideKonflikt(k, wahl),
    }, t("wahl_" + wahl));
    const wahl = h("div", { class: "st-ko-wahl" },
      h("div", { class: "st-ko-ab" }, knopf("a", "st-ko-a"), knopf("b", "st-ko-b")),
      knopf("beide", "st-ghost st-ko-beide"));
    karte.appendChild(wahl);

    if (notizOffen) {
      const zaehler = h("span", { class: "st-ko-zaehler", text: t("notizZeichen", { n: String((P.notiz[key] || "").length) }) });
      const feld = h("textarea", {
        class: "st-notiz", rows: "2", maxlength: String(MAX_NOTIZ), placeholder: t("notizPlatzhalter"), "aria-label": t("notizDazu"),
        "data-fokus": "notiz-" + key, spellcheck: "true", disabled: beschaeftigt,
        oninput: (e) => { P.notiz[key] = String(e.target.value).slice(0, MAX_NOTIZ); zaehler.textContent = t("notizZeichen", { n: String(P.notiz[key].length) }); },
      });
      feld.value = P.notiz[key] || "";
      karte.appendChild(h("div", { class: "st-ko-notiz" }, feld, zaehler));
    }
    karte.appendChild(h("div", { class: "st-ko-fuss" },
      h("button", { type: "button", class: "st-link", "data-fokus": "notizknopf-" + key, onclick: () => {
        P.notizOffen[key] = !notizOffen; if (notizOffen) delete P.notiz[key]; zeichne();
        if (!notizOffen) { const f = Array.prototype.find.call(inhalt.querySelectorAll("textarea"), (el) => el.getAttribute("data-fokus") === "notiz-" + key); if (f) f.focus(); }
      } }, notizOffen ? t("notizWeg") : t("notizDazu")),
      h("span", { class: "st-luecke" }),
      gewaehlt ? h("button", { type: "button", class: "st-link st-ko-leise", onclick: () => { delete P.aendern[key]; zeichne(); } }, t("abbrechen"))
        : zurueckgestellt ? null
        : h("button", { type: "button", class: "st-link st-ko-leise", disabled: beschaeftigt, onclick: () => entscheideKonflikt(k, "spaeter") }, t("wahl_spaeter"))));
    return karte;
  }

  async function entscheideKonflikt(k, wahl) {
    const P = Z.pfl;
    const key = konfliktSchluessel(k);
    if (wahl === "spaeter") {
      // „Später“ schreibt nichts (der Dienst würde ohnehin nichts schreiben) — nur in dieser Sitzung zurückstellen.
      P.spaeter[key] = true; P.meldung = { art: "ok", text: t("spaeterGemerkt") }; zeichne();
      return;
    }
    P.beschaeftigt[key] = true; P.meldung = null; zeichne();
    try {
      // Eine schon getroffene Entscheidung ersetzt der Dienst, solange sie nicht eingearbeitet ist (Antwort: ersetzt).
      // Ohne neu getippte Notiz bleibt die gespeicherte (k.notiz) erhalten.
      const r = await api().sende("POST", konfliktPfad(k), entscheidungsKoerper(k, wahl, P.notiz[key] != null ? P.notiz[key] : k.notiz));
      P.meldung = { art: "ok", text: t(r && r.ersetzt ? "entscheidungGeaendert" : "entscheidungGespeichert") };
      // Notiz bleibt in der Oberfläche stehen: wer gleich „Ändern“ drückt, muss sie nicht neu tippen.
      delete P.aendern[key]; delete P.spaeter[key];
    } catch (e) {
      if (e.status === 409) P.meldung = { art: "fehler", text: t(/geändert/i.test(e.message || "") ? "seiteGeaendert" : "entscheidungSchonDa") };
      else if (e.status !== 403) P.meldung = { art: "fehler", text: t("aktionFehler", { fehler: e.message || "?" }) };
    }
    delete P.beschaeftigt[key];
    await ladePflege();
  }

  function postenZeile(p) {
    const P = Z.pfl;
    const k = p.schluessel;
    const hinweis = NUR_HINWEIS.indexOf(k) >= 0;
    const liste = Array.isArray(p.liste) ? p.liste.map((e) => postenEintrag(k, e)) : [];
    const offen = !!P.offen[k];
    const z = h("div", { class: "st-posten" + (hinweis ? " hinweis" : "") + (k === "abgelaufen" ? " bernstein" : "") },
      h("span", { class: "st-p-zahl", text: zahl(p.anzahl) }),
      h("div", { class: "st-p-text" },
        h("div", { class: "st-p-titel" }, t("posten_" + k), hinweis ? h("span", { class: "st-badge", text: t("nurHinweis") }) : null),
        h("p", { class: "st-p-schritt", text: t("schritt_" + k) }),
        h("div", { class: "st-p-aktionen" },
          liste.length ? h("button", { type: "button", class: "st-link", "aria-expanded": String(offen), onclick: () => { P.offen[k] = !offen; zeichne(); } }, offen ? t("wenigerLesen") : t("listeZeigen")) : null,
          k === "vorschlaege" ? h("button", { type: "button", class: "st-link", onclick: () => { Z.reiter = "vorschlaege"; ladeReiter(); zeichne(); } }, t("zuDenVorschlaegen")) : null)));
    if (offen && liste.length) {
      const ul = h("ul", { class: "st-seitenliste st-p-liste" });
      for (const e of liste) {
        // Mit Seite: anklickbar (Name + übersetzter Zusatz bzw. Ordner), sonst reiner Text.
        if (e.seite) {
          ul.appendChild(h("li", null, h("button", { type: "button", title: e.seite + (e.zusatz ? " — " + e.zusatz : ""), onclick: () => seiteWaehlen([e.seite]) },
            h("span", { class: "st-s-name", text: seitenName(e.seite) }), h("span", { class: "st-s-ort", text: e.zusatz || seitenOrt(e.seite) }))));
        } else ul.appendChild(h("li", { class: "st-p-eintrag", text: e.text }));
      }
      if (p.anzahl > liste.length) ul.appendChild(h("li", { class: "st-p-eintrag st-muted", text: t("weitere", { n: zahl(p.anzahl - liste.length) }) }));
      z.querySelector(".st-p-text").appendChild(ul);
    }
    return z;
  }

  // Ein Listeneintrag des Pflegeberichts → { seite?, zusatz?, text } in der gewählten Sprache. Der Dienst liefert
  // strukturierte Einträge (pflege.mjs: Felder je Posten); ältere Dienste liefern fertige deutsche Sätze — die
  // werden wie bisher gezeigt (Pfad vor „ — “ anklickbar).
  function postenEintrag(k, e) {
    if (typeof e === "string") {
      const pfad = e.split(" — ")[0];
      return /\.md$/i.test(pfad) ? { seite: pfad, zusatz: e.length > pfad.length ? e.slice(pfad.length + 3) : "", text: e } : { text: e };
    }
    if (!e || typeof e !== "object") return { text: String(e == null ? "" : e) };
    const n = (x) => zahl(Number(x) || 0);
    switch (k) {
      case "abgelaufen": {
        const verfall = e.grund === "verfall";
        const schl = (verfall ? "eintragVerfall" : "eintragAbgelaufen") + (Number(e.tage) === 1 ? "1" : "");
        return { seite: e.seite, zusatz: t(schl, { n: n(e.tage), datum: datum(e.frist) }) };
      }
      case "bald": return { seite: e.seite, zusatz: t("eintragBald", { datum: datum(e.frist) }) };
      case "konflikte": return { seite: e.seite, zusatz: Number(e.anzahl) > 1 ? t("eintragKonflikte", { n: n(e.anzahl) }) : "" };
      case "konflikteKaputt": return { seite: e.seite, zusatz: Number(e.anzahl) > 1 ? t("eintragKaputt", { n: n(e.anzahl) }) : "" };
      case "entscheidungen": return { seite: e.seite, zusatz: t("eintragEntscheidung", { nr: n(e.konflikt), wahl: WAHLEN.indexOf(e.wahl) >= 0 ? t("wahl_" + e.wahl) : String(e.wahl || "") }) };
      case "vorschlaege": return { text: String(e.titel || "") };
      case "lektionen": case "pflegeAuftraege": return { text: String(e.name || "") };
      case "luecken": return { text: String(e.frage || "") };
      case "dubletten": {
        const seiten = Array.isArray(e.seiten) ? e.seiten.map(String) : [];
        const grund = e.grund === "titel" ? t("eintragGleicherTitel") : t("eintragAehnlich", { wert: prozent(Number(e.aehnlichkeit) || 0) });
        return { seite: seiten[0], zusatz: (seiten.length > 1 ? "↔ " + seiten.slice(1).map(seitenName).join(", ") + " · " : "") + grund };
      }
      case "zuLang": return { seite: e.seite, zusatz: t("eintragZeilen", { n: n(e.zeilen) }) };
      case "importe": return { text: t(Number(e.notizen) === 1 ? "eintragImport1" : "eintragImport", { quelle: String(e.quelle || ""), n: n(e.notizen) }) };
      case "zufuehrungen": return { text: t("eintragZufuehrung_" + (e.status === "nicht-lesbar" ? "nichtlesbar" : ["fehlt", "config", "statusdatei"].indexOf(e.status) >= 0 ? e.status : "still"), { name: String(e.name || ""), n: n(e.tage) }) };
      case "messlatte": return { text: t(e.ok ? "eintragMesslatte" : "eintragMesslatteUnter", { datum: datum(e.datum), positiv: String(e.positiv || ""), still: String(e.still || "") }) };
      default: return e.seite ? { seite: String(e.seite), zusatz: "" } : { text: "" };
    }
  }

  // Karte „Gründlich prüfen lassen“: Knopf + Kosten. lauf (optional, vom Dienst): { claude, laeuft, letzter }.
  function laufKarte(lauf) {
    const L = Z.pfl.lauf;
    const info = lauf && typeof lauf === "object" ? lauf : {};
    const claude = typeof info.claude === "boolean" ? info.claude : Z.ein.daten ? Z.ein.daten.claudeGefunden !== false : true;
    const laeuft = !!info.laeuft || L.sendet;
    const letzter = info.letzter && typeof info.letzter === "object" ? info.letzter : null;
    let letzteZeile = null;
    if (letzter && letzter.zeit) {
      const tok = (Number(letzter.tokEin) || 0) + (Number(letzter.tokAus) || 0);
      letzteZeile = tok > 0 ? t("laufLetzterTokens", { wann: wannRelativ(letzter.zeit), n: zahl(letzter.vorschlaege || 0), tok: zahl(tok) })
        : t("laufLetzter", { wann: wannRelativ(letzter.zeit), n: zahl(letzter.vorschlaege || 0) });
    }
    return h("section", { class: "st-lauf" },
      h("div", { class: "st-lauf-kopf" },
        h("span", { class: "st-lauf-icon" }, ICON_FUNKE()),
        h("div", null, h("div", { class: "st-name", text: t("laufTitel") }), h("p", { class: "st-satz", text: t("laufText") }))),
      h("div", { class: "st-etiketten" },
        h("span", { class: "st-kosten bernstein", text: t("kostenLauf") }),
        h("span", { class: "st-badge", text: t("nurClaudeCode") })),
      !claude ? h("p", { class: "st-info", text: t("laufOhneClaude") }) : null,
      L.meldung ? h("div", { class: "st-toast " + L.meldung.art, role: "status", text: L.meldung.text }) : null,
      h("div", { class: "st-lauf-fuss" },
        h("span", { class: "st-lauf-letzter", text: letzteZeile || "" }),
        h("button", { type: "button", class: "st-btn st-primaer", "data-fokus": "lauf", disabled: !claude || laeuft, onclick: () => starteLauf() },
          laeuft ? t("laufLaeuft") : t("laufKnopf"))));
  }

  async function starteLauf() {
    const L = Z.pfl.lauf;
    L.sendet = true; L.meldung = null; zeichne();
    try {
      const r = await api().sende("POST", "/api/pflege/lauf", {});
      const grund = r && typeof r.grund === "string" ? r.grund : "";
      if (r && r.gestartet === false) {
        L.meldung = /schon/i.test(grund) ? { art: "ok", text: t("laufSchonDabei") }
          : /claude/i.test(grund) ? { art: "fehler", text: t("laufOhneClaude") }
          : { art: "fehler", text: t("laufFehler", { fehler: grund || "?" }) };
      } else L.meldung = { art: "ok", text: t("laufGestartet") };
    } catch (e) {
      // Dienst ab W1-Fix: nicht gestartet → 409 „läuft schon“ / 503 „claude fehlt“ (grund im Körper);
      // 503 ohne grund = Pflege-Lauf gibt es in dieser Version nicht.
      const grund = e.daten && typeof e.daten.grund === "string" ? e.daten.grund : "";
      if (e.status === 409) L.meldung = { art: "ok", text: t("laufSchonDabei") };
      else if (e.status === 503 && /claude/i.test(grund)) L.meldung = { art: "fehler", text: t("laufOhneClaude") };
      else if (e.status === 503) L.meldung = { art: "fehler", text: t("laufNichtDa") };
      else if (e.status !== 403) L.meldung = { art: "fehler", text: t("laufFehler", { fehler: grund || e.message || "?" }) };
    }
    L.sendet = false; zeichne();
    if (L.meldung && L.meldung.art === "ok") ladePflege();
  }

  // ---------------------------------------------------------------------------------------- Analyse
  function zeichneAnalyse() {
    const A = Z.ana;
    if (!A.daten) return A.fehler ? fehlerKarte(() => ladeAnalyse()) : laedt();
    const a = A.daten;
    const wrap = h("div", { class: "st-analyse" });
    const seiten = a.seiten || {};
    wrap.appendChild(h("div", { class: "st-a-kopf" },
      h("span", { text: t("zeitraum", { n: a.zeitraumTage || 30 }) + (typeof seiten.gesamt === "number" ? " · " + t("seitenGesamt", { n: zahl(seiten.gesamt) }) : "") }),
      h("button", { type: "button", class: "st-link", disabled: A.laden, onclick: () => ladeAnalyse() }, A.laden ? t("laden") : t("aktualisieren"))));

    if (!a.genugDaten) {
      wrap.appendChild(h("div", { class: "st-hinweis" }, h("strong", { text: t("zuWenigDaten") }), h("span", { text: t("zuWenigDatenText") })));
    } else {
      const hw = a.hinweise || {}, gl = a.gelesen || {}, ml = a.messlatte && a.messlatte.letzter, tk = a.tokens || {};
      wrap.appendChild(h("div", { class: "st-karten" },
        karte(t("karteTreffer"), prozent(hw.quote), t("karteTrefferText", { a: zahl(hw.mitHinweis || 0), b: zahl(hw.prompts || 0) }), hw.quote),
        karte(t("karteGelesen"), prozent(gl.quote), t("karteGelesenText", { a: zahl(gl.hinweiseMitLesen || 0) }), gl.quote),
        karte(t("karteMesslatte"), ml ? String(ml.positiv) : "–", ml ? t("karteMesslatteText", { datum: datum(ml.datum), positiv: ml.positiv, still: ml.still }) : t("messlatteKeine")),
        karte(t("karteTokens"), "~" + zahl(tk.heute || 0), t("karteTokensText", { n: zahl(tk.sieben || 0) }))));
      if (Array.isArray(hw.proTag) && hw.proTag.length) wrap.appendChild(verlauf(hw.proTag.slice(-30)));
    }
    if (a.schwelle && a.schwelle.empfehlung) wrap.appendChild(schwellenBlock(a.schwelle));
    if (a.antwortMesslatte) wrap.appendChild(antwortBlock(a.antwortMesslatte));

    wrap.appendChild(seitenListe("konflikt", "listeKonflikt", "listeKonfliktText", seiten.konflikt, "rot"));
    wrap.appendChild(seitenListe("pruef", "listePruef", "listePruefText", seiten.pruefbeduerftig, "gelb"));
    if (Array.isArray(seiten.abgelaufen)) wrap.appendChild(seitenListe("abgelaufen", "listeAbgelaufen", "listeAbgelaufenText", seiten.abgelaufen, "gelb"));
    wrap.appendChild(seitenListe("meist", "listeMeist", "listeMeistText", seiten.meistGelesen));
    wrap.appendChild(seitenListe("nie", "listeNie", "listeNieText", seiten.nieGelesen));
    wrap.appendChild(seitenListe("verwaist", "listeVerwaist", "listeVerwaistText", seiten.verwaist));

    const lk = h("section", { class: "st-a-block" }, h("h3", null, t("luecken"), Array.isArray(a.luecken) ? h("span", { class: "st-zahl", text: zahl(a.luecken.length) }) : null));
    if (!Array.isArray(a.luecken)) lk.appendChild(h("p", { class: "st-muted", text: t("lueckenAus") }));
    else if (!a.luecken.length) lk.appendChild(h("p", { class: "st-muted", text: t("lueckenLeer") }));
    else {
      lk.appendChild(h("p", { class: "st-muted", text: t("lueckenText") }));
      const ul = h("ul", { class: "st-luecken" });
      for (const l of a.luecken.slice(-30).reverse()) {
        const q = l.quelle === "hint" || l.quelle === "search" ? t("quelle_" + l.quelle) : String(l.quelle || "");
        ul.appendChild(h("li", null, h("span", { class: "st-l-text", text: l.text || "" }), h("span", { class: "st-l-meta", text: q + (l.zeit ? " · " + datum(String(l.zeit).slice(0, 10)) : "") })));
      }
      lk.appendChild(ul);
    }
    wrap.appendChild(lk);

    const im = h("section", { class: "st-a-block" }, h("h3", null, t("importe"), Array.isArray(a.importe) && a.importe.length ? h("span", { class: "st-zahl", text: zahl(a.importe.length) }) : null));
    if (Array.isArray(a.importe) && a.importe.length) {
      const ul = h("ul", { class: "st-importe" });
      for (const i of a.importe) ul.appendChild(h("li", null, h("span", { class: "st-i-name", text: i.quelle || "" }),
        h("span", { class: "st-i-zahlen", text: t("importZeile", { notizen: zahl(i.notizen || 0), duplikate: zahl(i.duplikate || 0), widersprueche: zahl(i.widersprueche || 0) }) })));
      im.appendChild(ul);
    }
    im.appendChild(h("p", { class: "st-muted", text: t("importHinweis") }));
    wrap.appendChild(im);
    return wrap;
  }

  // Schwellen-Prüfung: zu streng / zu locker + Empfehlung (nur Text — geändert wird nichts automatisch).
  function schwellenBlock(s) {
    const x = schwellenTexte(s, t, { zahl: zahl, prozent: prozent, datum: datum });
    const sek = h("section", { class: "st-a-block st-schwelle" }, h("h3", { text: t("schwelleTitel") }));
    if (x.werte.length) {
      const ul = h("ul", { class: "st-schwelle-werte" });
      for (const w of x.werte) ul.appendChild(h("li", { text: w }));
      sek.appendChild(ul);
    }
    sek.appendChild(h("p", { class: "st-schwelle-empf", text: x.empfehlung }));
    if (x.seit) sek.appendChild(h("p", { class: "st-muted", text: x.seit }));
    return sek;
  }

  // Antwort-Messlatte: letzter Lauf + Fragen mit fehlenden Kernfakten (opt-in, Schalter antwortMesslatte).
  function antwortBlock(am) {
    const l = am.letzter;
    const sek = h("section", { class: "st-a-block st-antwort" }, h("h3", null, t("antwortTitel"),
      l ? h("span", { class: "st-zahl", text: zahl(l.voll || 0) + "/" + zahl(l.fragen || 0) }) : null));
    if (!l) {
      sek.appendChild(h("p", { class: "st-muted", text: am.schalter === "monatlich" ? t("antwortNochKein") : t("antwortAus") }));
      return sek;
    }
    const tok = typeof l.tokEin === "number" || typeof l.tokAus === "number" ? zahl((l.tokEin || 0) + (l.tokAus || 0)) : "–";
    sek.appendChild(h("p", { class: "st-muted", text: t(l.status === "fehler" ? "antwortFehler" : "antwortLetzter",
      { datum: datum(String(l.zeit || "").slice(0, 10)), voll: zahl(l.voll || 0), fragen: zahl(l.fragen || 0), fakten: String(l.fakten || ""), tokens: tok, grund: String(l.grund || "?") }) }));
    const offen = (Array.isArray(am.faelle) ? am.faelle : []).filter((f) => f && Array.isArray(f.fehlend) && f.fehlend.length);
    if (offen.length) {
      const ul = h("ul", { class: "st-luecken" });
      for (const f of offen.slice(0, 20)) {
        ul.appendChild(h("li", null, h("span", { class: "st-l-text", text: String(f.frage || "") }),
          h("span", { class: "st-l-meta", text: seitenName(String(f.seite || "")) + " · " + t("antwortFehlend", { fakten: f.fehlend.join(", ") }) })));
      }
      sek.appendChild(ul);
    }
    return sek;
  }

  function karte(titel, wert, text, quote) {
    const k = h("div", { class: "st-karte" }, h("div", { class: "st-k-titel", text: titel }), h("div", { class: "st-k-wert", text: wert }));
    if (typeof quote === "number") {
      const balken = h("div", { class: "st-k-balken" }, h("span"));
      balken.firstChild.style.width = Math.max(0, Math.min(100, quote * 100)).toFixed(1) + "%";
      k.appendChild(balken);
    }
    k.appendChild(h("p", { class: "st-k-text", text: text }));
    return k;
  }

  function verlauf(tage) {
    const max = Math.max(1, ...tage.map((d) => d.prompts || 0));
    const reihe = h("div", { class: "st-verlauf-reihe", role: "img", "aria-label": t("verlauf") });
    for (const d of tage) {
      const titel = t("verlaufZeile", { tag: datum(d.tag), a: zahl(d.mitHinweis || 0), b: zahl(d.prompts || 0) });
      const saeule = h("div", { class: "st-saeule", title: titel });
      const alle = h("span", { class: "st-s-alle" }), mit = h("span", { class: "st-s-mit" });
      alle.style.height = ((d.prompts || 0) / max * 100).toFixed(1) + "%";
      mit.style.height = ((d.mitHinweis || 0) / max * 100).toFixed(1) + "%";
      saeule.appendChild(alle); saeule.appendChild(mit);
      reihe.appendChild(saeule);
    }
    return h("section", { class: "st-verlauf" }, h("h3", { text: t("verlauf") }), reihe,
      h("div", { class: "st-verlauf-achse" }, h("span", { text: datum(tage[0].tag) }), h("span", { text: datum(tage[tage.length - 1].tag) })));
  }

  function seitenListe(schl, titelK, textK, eintraege, farbe) {
    const liste = Array.isArray(eintraege) ? eintraege : [];
    const sek = h("section", { class: "st-a-block st-seiten" + (liste.length ? "" : " leer") },
      h("h3", null, farbe && liste.length ? h("i", { class: "st-ring " + farbe }) : null, t(titelK), h("span", { class: "st-zahl", text: zahl(liste.length) })));
    if (!liste.length) return sek;
    sek.appendChild(h("p", { class: "st-muted", text: t(textK) }));
    const alle = !!Z.ana.alle[schl];
    const zeigen = alle ? liste : liste.slice(0, 8);
    const ul = h("ul", { class: "st-seitenliste" });
    for (const e of zeigen) {
      const pfad = typeof e === "string" ? e : String(e.seite || "");
      const mal = typeof e === "object" && e && typeof e.mal === "number" ? e.mal : null;
      ul.appendChild(h("li", null, h("button", {
        type: "button", title: pfad,
        onclick: () => {
          const a = app();
          if (a && typeof a.waehle === "function") { try { a.waehle(pfad); } catch (err) { /* Seite gibt es nicht mehr */ } }
          if (root.matchMedia && root.matchMedia("(max-width: 720px)").matches) schliesse();
        },
      }, h("span", { class: "st-s-name", text: seitenName(pfad) }), h("span", { class: "st-s-ort", text: seitenOrt(pfad) }),
        mal !== null ? h("span", { class: "st-s-mal", text: t("malGelesen", { n: zahl(mal) }) }) : null)));
    }
    sek.appendChild(ul);
    if (liste.length > 8) {
      sek.appendChild(h("button", { type: "button", class: "st-link", onclick: () => { Z.ana.alle[schl] = !alle; zeichne(); } },
        alle ? t("wenigerLesen") : t("alleZeigen", { n: zahl(liste.length) })));
    }
    return sek;
  }

  // ------------------------------------------------------------------------------------------ Start
  function init(opts) {
    if (opts && opts.app) appRef = opts.app;
    if (gestartet) return oeffentlich;
    const d = root.document;
    if (!d || typeof d.createElement !== "function" || !d.body) return oeffentlich;
    doc = d;
    gestartet = true;
    baue();
    return oeffentlich;
  }

  const oeffentlich = { init: init, oeffne: oeffne, schliesse: schliesse, hilfen: hilfen };
  root.BrainSteuer = oeffentlich;

  const d0 = root.document;
  if (d0 && typeof d0.addEventListener === "function" && !root.BRAIN_STEUER_MANUELL) {
    if (d0.readyState === "loading") d0.addEventListener("DOMContentLoaded", () => init());
    else init();
  }
})(typeof window !== "undefined" ? window : globalThis);
