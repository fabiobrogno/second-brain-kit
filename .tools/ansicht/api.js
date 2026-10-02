// .tools/ansicht/api.js — Verbindung der Ansicht zum lokalen Ansicht-Dienst (klassisches Skript, kein ESM).
// Setzt window.BrainApi = { verfuegbar, token, holeJson(pfad), sende(methode, pfad, daten) }. In Node per vm testbar.
//
// Der Zugang (zufällig je Dienststart) kommt nur über das URL-Fragment (#t=…), das nie an einen Server geht.
// Er wird sofort aus der Adresse entfernt (history.replaceState) und nur in sessionStorage gehalten — also je Tab,
// nie dauerhaft. Jede Anfrage schickt ihn als Header X-Brain-Token. verfuegbar ist nur über http:// mit Zugang
// wahr; unter file:// (Rückfall) gibt es keinen Dienst. Antwortet der Dienst mit 403 (z. B. neu gestartet,
// altes Lesezeichen), meldet die Seite das Ereignis „brain:neu-oeffnen“ auf document.
(function (root) {
  "use strict";

  const ABLAGE = "brain-zugang";
  const MUSTER = /^[A-Za-z0-9_-]{16,256}$/;

  function lies() { try { return root.sessionStorage ? root.sessionStorage.getItem(ABLAGE) : null; } catch (e) { return null; } }
  function merke(z) { try { if (root.sessionStorage) root.sessionStorage.setItem(ABLAGE, z); } catch (e) { /* gesperrt: nur im Speicher */ } }

  // Zugang aus dem Fragment holen; andere Fragment-Teile (z. B. seite=…) bleiben stehen.
  function ausFragment() {
    const loc = root.location;
    const hash = loc && typeof loc.hash === "string" ? loc.hash.replace(/^#/, "") : "";
    if (!hash) return null;
    const teile = hash.split("&");
    let gefunden = null;
    const rest = [];
    for (const teil of teile) {
      if (teil.slice(0, 2) === "t=") { if (gefunden === null) gefunden = teil.slice(2); }
      else if (teil) rest.push(teil);
    }
    if (gefunden === null) return null;
    try {
      if (root.history && typeof root.history.replaceState === "function") {
        root.history.replaceState(null, "", (loc.pathname || "") + (loc.search || "") + (rest.length ? "#" + rest.join("&") : ""));
      }
    } catch (e) { /* ohne history bleibt das Fragment eben stehen */ }
    return MUSTER.test(gefunden) ? gefunden : null;
  }

  let zugang = ausFragment();
  if (zugang) merke(zugang);
  else {
    const alt = lies();
    zugang = alt && MUSTER.test(alt) ? alt : null;
  }

  const verfuegbar = !!(root.location && root.location.protocol === "http:" && zugang);

  function fehler(meldung, status, daten) {
    const e = new Error(meldung);
    e.status = status;
    e.daten = daten || null;
    return e;
  }

  function meldeNeuOeffnen() {
    const doc = root.document;
    try {
      if (doc && typeof doc.dispatchEvent === "function" && typeof root.CustomEvent === "function") {
        doc.dispatchEvent(new root.CustomEvent("brain:neu-oeffnen"));
      }
    } catch (e) { /* nur Hinweis */ }
  }

  async function auswerten(antwort) {
    let daten = null;
    try { daten = await antwort.json(); } catch (e) { daten = null; }
    if (antwort.status === 403) meldeNeuOeffnen();
    if (!antwort.ok) {
      const meldung = daten && typeof daten.fehler === "string" ? daten.fehler : "HTTP " + antwort.status;
      throw fehler(meldung, antwort.status, daten);
    }
    if (daten === null) throw fehler("Antwort ist kein JSON", antwort.status);
    return daten;
  }

  function kopf(mitKoerper) {
    const h = { "X-Brain-Token": zugang, Accept: "application/json" };
    if (mitKoerper) h["Content-Type"] = "application/json";
    return h;
  }

  async function holeJson(pfad) {
    if (!verfuegbar) throw fehler("Dienst nicht verfügbar", 0);
    let antwort;
    try { antwort = await root.fetch(pfad, { method: "GET", headers: kopf(false), cache: "no-store", credentials: "same-origin" }); }
    catch (e) { throw fehler("Dienst nicht erreichbar", 0); }
    return auswerten(antwort);
  }

  async function sende(methode, pfad, daten) {
    if (!verfuegbar) throw fehler("Dienst nicht verfügbar", 0);
    let antwort;
    try {
      antwort = await root.fetch(pfad, {
        method: String(methode || "POST").toUpperCase(),
        headers: kopf(true),
        body: JSON.stringify(daten === undefined ? {} : daten),
        cache: "no-store",
        credentials: "same-origin",
      });
    } catch (e) { throw fehler("Dienst nicht erreichbar", 0); }
    return auswerten(antwort);
  }

  const api = { verfuegbar: verfuegbar, holeJson: holeJson, sende: sende };
  api["token"] = zugang;
  root.BrainApi = Object.freeze(api);
})(typeof window !== "undefined" ? window : globalThis);
