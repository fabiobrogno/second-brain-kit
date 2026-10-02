// .tools/ansicht/steuer.js — Steuerzentrale der Ansicht: Zahnrad oben rechts → Seitenleiste mit drei Reitern
// Einstellungen · Vorschläge · Analyse (klassisches Skript, kein ESM). Setzt window.BrainSteuer = { init, oeffne,
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
  const FELDER = [
    { schluessel: "staendeIntervallStunden", gruppe: "gruppeHintergrund", art: "stufen", werte: [0, 1, 2, 4], kosten: "kostenStand", nurClaude: true, brauchtClaude: true },
    { schluessel: "ernteSitzungsende", gruppe: "gruppeHintergrund", art: "schalter", kosten: "kostenErnte", nurClaude: true, brauchtClaude: true },
    { schluessel: "ernteNichtIn", gruppe: "gruppeHintergrund", art: "liste", kosten: "kosten0" },
    { schluessel: "hinweise", gruppe: "gruppeSitzung", art: "stufen", werte: ["aus", "niedrig", "mittel", "hoch"], kosten: "kostenHinweis", nurClaude: true },
    { schluessel: "ichKarte", gruppe: "gruppeSitzung", art: "schalter", kosten: "kostenIch" },
    { schluessel: "projektAutomatik", gruppe: "gruppeSitzung", art: "schalter", kosten: "kostenProjekt", nurClaude: true },
    { schluessel: "liveAufleuchten", gruppe: "gruppeAnsicht", art: "schalter", kosten: "kosten0", nurClaude: true },
    { schluessel: "luecken", gruppe: "gruppeAnsicht", art: "schalter", kosten: "kosten0" },
    { schluessel: "updateHinweis", gruppe: "gruppeAnsicht", art: "schalter", kosten: "kostenUpdate" },
    { schluessel: "sicherungTaeglich", gruppe: "gruppeAnsicht", art: "schalter", kosten: "kosten0" },
  ];
  const GRUPPEN = ["gruppeHintergrund", "gruppeSitzung", "gruppeAnsicht"];
  // Was „Alles aus (wie v0.2)“ abschaltet: alles, was v0.3 neu automatisch tut. Hinweise, Update-Hinweis und
  // tägliche Sicherung gab es schon in v0.2 — die bleiben, wie sie sind.
  const NEU_IN_V03 = { staendeIntervallStunden: 0, ernteSitzungsende: false, ichKarte: false, projektAutomatik: false, liveAufleuchten: false, luecken: false };
  // Textschlüssel, die steuer.js zusammengesetzt benutzt (für den Vollständigkeitstest).
  const TEXTSCHLUESSEL = GRUPPEN.concat([
    "hinweis_aus", "hinweis_niedrig", "hinweis_mittel", "hinweis_hoch", "art_fakt", "art_stand", "quelle_search", "quelle_hint",
    "reiterEinstellungen", "reiterVorschlaege", "reiterAnalyse", "listeMeist", "listeMeistText", "listeNie", "listeNieText",
    "listeVerwaist", "listeVerwaistText", "listePruef", "listePruefText", "listeKonflikt", "listeKonfliktText",
    "ordnerLeer", "ordnerDoppelt", "ordnerZuLang", "ordnerZuViele",
  ]);
  const MAX_ORDNER = 20, MAX_PFAD = 300;

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
    return w;
  }
  function neuerOrdner(liste, eingabe) {
    const pfad = String(eingabe == null ? "" : eingabe).trim();
    if (!pfad) return { ok: false, fehler: "ordnerLeer" };
    if (pfad.length > MAX_PFAD) return { ok: false, fehler: "ordnerZuLang" };
    if ((liste || []).indexOf(pfad) >= 0) return { ok: false, fehler: "ordnerDoppelt" };
    if ((liste || []).length >= MAX_ORDNER) return { ok: false, fehler: "ordnerZuViele" };
    return { ok: true, pfad: pfad };
  }

  const hilfen = { FELDER: FELDER, TEXTSCHLUESSEL: TEXTSCHLUESSEL, aenderungen: aenderungen, allesAus: allesAus, neuerOrdner: neuerOrdner };

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
    if (reiter && ["einstellungen", "vorschlaege", "analyse"].indexOf(reiter) >= 0) Z.reiter = reiter;
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

    reiterLeiste.replaceChildren(...[["einstellungen", "reiterEinstellungen"], ["vorschlaege", "reiterVorschlaege"], ["analyse", "reiterAnalyse"]].map(([id, k]) => {
      const an = Z.reiter === id;
      return h("button", {
        type: "button", role: "tab", id: "steuerReiter-" + id, "aria-selected": String(an), "aria-controls": "steuerInhalt",
        tabindex: an ? "0" : "-1",
        onclick: () => { Z.reiter = id; ladeReiter(); zeichne(); },
        onkeydown: (e) => {
          const reihe = ["einstellungen", "vorschlaege", "analyse"];
          const i = reihe.indexOf(id);
          const n = e.key === "ArrowRight" ? reihe[(i + 1) % 3] : e.key === "ArrowLeft" ? reihe[(i + 2) % 3] : null;
          if (!n) return;
          e.preventDefault(); Z.reiter = n; ladeReiter(); zeichne();
          const neu = reiterLeiste.querySelector("#steuerReiter-" + n); if (neu) neu.focus();
        },
      }, t(k), id === "vorschlaege" && Z.anzahl > 0 ? h("span", { class: "st-zahl", text: zahl(Z.anzahl) }) : null);
    }));
    inhalt.setAttribute("aria-labelledby", "steuerReiter-" + Z.reiter);

    let koerper;
    if (!api().verfuegbar) koerper = hinweisKarte(ICON_SCHLOSS(), t("nurMitDienstTitel"), t("nurMitDienst"));
    else if (Z.abgelaufen) koerper = hinweisKarte(ICON_NEU(), t("neuOeffnenTitel"), t("neuOeffnen"));
    else if (Z.reiter === "einstellungen") koerper = zeichneEinstellungen();
    else if (Z.reiter === "vorschlaege") koerper = zeichneVorschlaege();
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

    for (const g of GRUPPEN) {
      const sek = h("section", { class: "st-gruppe" }, h("h3", { text: t(g) }));
      if (g === "gruppeHintergrund" && !claude) sek.appendChild(h("p", { class: "st-info", text: t("claudeFehlt") }));
      for (const f of FELDER.filter((x) => x.gruppe === g)) sek.appendChild(zeile(f, w, kaputt || (f.brauchtClaude && !claude)));
      wrap.appendChild(sek);
    }
    return wrap;
  }

  function setze(k, v) {
    Z.ein.entwurf[k] = v;
    if (Z.ein.meldung && Z.ein.meldung.art !== "konflikt") Z.ein.meldung = null;
    zeichne();
  }

  function zeile(f, w, gesperrt) {
    const k = f.schluessel, id = "st-f-" + k;
    const etiketten = h("div", { class: "st-etiketten" },
      h("span", { class: "st-kosten " + (f.kosten === "kosten0" ? "gruen" : "bernstein"), text: t(f.kosten) }),
      f.nurClaude ? h("span", { class: "st-badge", text: t("nurClaudeCode") }) : null);
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
        const name = k === "hinweise" ? t("hinweis_" + v) : v === 0 ? t("aus") : t("stunden", { n: v });
        gruppe.appendChild(h("button", { type: "button", "aria-pressed": String(w[k] === v), "data-fokus": "stufe-" + k + "-" + v, disabled: gesperrt, onclick: () => setze(k, v) }, name));
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
        offen ? h("button", { type: "button", class: "st-btn st-ghost", disabled: E.speichert, onclick: () => { E.entwurf = kopie(E.daten.werte); E.meldung = null; zeichne(); } }, t("zuruecksetzen")) : null,
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
      wrap.appendChild(h("article", { class: "st-vorschlag" + (beschaeftigt ? " beschaeftigt" : "") },
        h("div", { class: "st-v-kopf" },
          h("span", { class: "st-art " + (v.art === "stand" ? "stand" : "fakt"), text: t(v.art === "stand" ? "art_stand" : "art_fakt") }),
          v.erstellt ? h("time", { datetime: String(v.erstellt), title: String(v.erstellt), text: wannRelativ(v.erstellt) }) : null),
        h("h4", { text: v.titel || id }),
        h("p", { class: "st-v-text" + (lang && !auf ? " gekuerzt" : ""), text: v.text || "" }),
        lang ? h("button", { type: "button", class: "st-link", onclick: () => { V.aufgeklappt[id] = !auf; zeichne(); } }, auf ? t("wenigerLesen") : t("mehrLesen")) : null,
        h("div", { class: "st-v-fuss" },
          v.quelleOrdner ? h("span", { class: "st-v-ordner", title: String(v.quelleOrdner), text: t("ausOrdner", { ordner: v.quelleOrdner }) }) : h("span"),
          h("div", { class: "st-v-knoepfe" },
            h("button", { type: "button", class: "st-btn st-ghost", disabled: beschaeftigt, onclick: () => entscheide(id, "verwerfen") }, t("verwerfen")),
            h("button", { type: "button", class: "st-btn st-primaer", disabled: beschaeftigt, onclick: () => entscheide(id, "uebernehmen") }, t("uebernehmen"))))));
    }
    return wrap;
  }

  async function entscheide(id, aktion) {
    const V = Z.vor;
    V.beschaeftigt[id] = true; V.meldung = null; zeichne();
    try {
      const r = await api().sende("POST", "/api/vorschlaege/" + encodeURIComponent(id) + "/" + aktion, {});
      const ziel = r && r.ziel ? String(r.ziel) : "";
      V.meldung = { art: "ok", text: t(aktion === "uebernehmen" ? "uebernommen" : "verworfen", { ziel: ziel }) };
      const a = app();
      if (a && typeof a.neuLaden === "function") { try { a.neuLaden(); } catch (e) { /* Ansicht lädt beim nächsten Mal */ } }
    } catch (e) {
      if (e.status !== 403) V.meldung = { art: "fehler", text: t("aktionFehler", { fehler: e.message || "?" }) };
    }
    delete V.beschaeftigt[id];
    await ladeVorschlaege();
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

    wrap.appendChild(seitenListe("konflikt", "listeKonflikt", "listeKonfliktText", seiten.konflikt, "rot"));
    wrap.appendChild(seitenListe("pruef", "listePruef", "listePruefText", seiten.pruefbeduerftig, "gelb"));
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
