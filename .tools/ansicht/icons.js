// .tools/ansicht/icons.js — MCP-Logos im Browser (klassisches Skript, kein ESM; Grund: index.html lädt alle
// Ansichts-Skripte per <script src>, keine type="module"-Tags, siehe CSP-Hinweis dort). Setzt
// window.BrainIcons = { iconFuer, woerter, normalisiere, monogramm, rasterLayout, ladeAtlas }.
//
// iconFuer/normalisiere sind eine ABSICHTLICHE Kopie aus icons-zuordnung.mjs (Node-ESM lässt sich hier nicht
// importieren) — test-icons.mjs prüft beide Kopien gegeneinander auf Übereinstimmung, bei einer Änderung
// also IMMER beide Dateien anfassen.
//
// ladeAtlas() zeichnet die mitgelieferten SVGs (vendor/icons/*.svg, Simple Icons CC0) als <img> VOM EIGENEN
// URSPRUNG (relative Pfade — nie ein fremder Host, nie blob:, CSP erlaubt `img-src 'self' data:`) in eine gemeinsame
// Textur-Atlas-Leinwand. Fehlt ein Slug (Netzwerk, 404, kein <canvas>/<document> vorhanden — z. B. unter
// Node/vm in Tests), zählt er zu `fehlend`; der Aufrufer zeigt für diese Server dann ein Monogramm
// (monogramm()). Reine Hilfsfunktionen (normalisiere, iconFuer, monogramm, rasterLayout) laufen auch ohne
// DOM, genau wie bei app.js/BrainAppHilfen — nur ladeAtlas() braucht einen echten Browser.
(function (root) {
  "use strict";

  // Ziffern-Mitten (z. B. "n8n", "k8s") bleiben erhalten — nur eine Ziffernfolge ohne Buchstaben auf BEIDEN
  // Seiten (Versions-/Zähler-Suffixe wie "github2", die Jahreszahl in "microsoft_365") gilt als Trennrauschen
  // und wird entfernt. Identische Kopie in icons-zuordnung.mjs — bei Änderung IMMER beide Dateien anfassen.
  function entferneZiffernRauschen(s) {
    return s.replace(/[0-9]+/g, function (treffer, pos) {
      const vor = s[pos - 1];
      const nach = s[pos + treffer.length];
      const vorBuchstabe = vor != null && /[a-z]/.test(vor);
      const nachBuchstabe = nach != null && /[a-z]/.test(nach);
      return vorBuchstabe && nachBuchstabe ? treffer : "";
    });
  }

  function normalisiere(name) {
    if (typeof name !== "string") return "";
    let s = name.toLowerCase();
    if (s.startsWith("claude_ai_")) s = s.slice("claude_ai_".length);
    if (s.startsWith("mcp-")) s = s.slice(4);
    if (s.endsWith("-mcp")) s = s.slice(0, -4);
    s = entferneZiffernRauschen(s);
    return s.replace(/[^a-z0-9]/g, "");
  }

  // Wörter des Originalnamens (Trenner + CamelCase), Kopie aus icons-zuordnung.mjs#woerter.
  function woerter(name) {
    if (typeof name !== "string") return [];
    let s = name.replace(/^claude_ai_/i, "").replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
    s = entferneZiffernRauschen(s);
    const w = s.split(/[^a-z0-9]+/).filter(Boolean);
    if (w.length > 1 && w[0] === "mcp") w.shift();
    if (w.length > 1 && w[w.length - 1] === "mcp") w.pop();
    return w;
  }

  // Treffer nur an Wortgrenzen (Folge ganzer Wörter), nie als Wortteil — Kopie aus icons-zuordnung.mjs.
  function iconFuer(name, zuordnung) {
    const w = woerter(name);
    if (!w.length || !zuordnung || typeof zuordnung !== "object") return null;
    const folgen = {};
    for (let i = 0; i < w.length; i++) {
      let f = "";
      for (let j = i; j < w.length; j++) { f += w[j]; folgen[f] = true; }
    }
    let bester = null;
    let besteLaenge = 0;
    for (const schluessel of Object.keys(zuordnung)) {
      const slug = zuordnung[schluessel];
      if (typeof slug !== "string" || !slug) continue;
      const k = normalisiere(schluessel);
      if (!k) continue;
      if (Object.prototype.hasOwnProperty.call(folgen, k) && k.length > besteLaenge) { bester = slug; besteLaenge = k.length; }
    }
    return bester;
  }

  // Monogramm-Rückfall: 1–2 Buchstaben aus den Wortanfängen des (unnormalisierten, lesbaren) Namens,
  // Farbe deterministisch aus einem Namens-Hash. `farbe`: entweder eine Theme-Palette (Array Hex-/CSS-Farben,
  // Index per Hash — „Palette des Themes“ aus der Spec) oder eine feste CSS-Farbe (einfach durchgereicht)
  // oder leer (dann ein HSL-Ton aus dem Hash). Reine Funktion, deterministisch — dieselbe Eingabe liefert
  // immer dieselbe Ausgabe (wichtig fürs Erkennen desselben Servers über Sitzungen hinweg).
  function hash32(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) >>> 0;
    return h;
  }
  function buchstabenAus(name) {
    const woerter = String(name || "").match(/[A-Za-zÀ-ÖØ-öø-ÿ0-9]+/g) || [];
    const b = woerter.slice(0, 2).map((w) => w.charAt(0).toUpperCase()).join("");
    return b || "?";
  }
  function monogramm(name, farbe) {
    const n = String(name || "");
    const h = hash32(n);
    let farbeAus;
    if (Array.isArray(farbe) && farbe.length) farbeAus = farbe[h % farbe.length];
    else if (typeof farbe === "string" && farbe) farbeAus = farbe;
    else farbeAus = "hsl(" + (h % 360) + ", 55%, 55%)";
    return { text: buchstabenAus(n), farbe: farbeAus };
  }

  // Quadratisches Raster, so schmal wie möglich (Spalten = aufgerundete Wurzel aus n). Reine Geometrie,
  // ohne Canvas — deshalb ohne DOM testbar. `zelle(i)` liefert Pixel-Position UND normierte UV-Koordinaten
  // (0..1) der i-ten Kachel im fertigen Atlas, in derselben Reihenfolge wie die übergebene Slug-Liste.
  function rasterLayout(n, groesse) {
    const anzahl = Math.max(0, n | 0);
    const g = Math.max(1, groesse | 0);
    const spalten = Math.max(1, Math.ceil(Math.sqrt(anzahl || 1)));
    const zeilen = Math.max(1, Math.ceil((anzahl || 1) / spalten));
    const breite = spalten * g;
    const hoehe = zeilen * g;
    function zelle(i) {
      const spalte = i % spalten;
      const zeile = Math.floor(i / spalten);
      const x = spalte * g;
      const y = zeile * g;
      return { x: x, y: y, groesse: g, u0: x / breite, v0: y / hoehe, u1: (x + g) / breite, v1: (y + g) / hoehe };
    }
    return { spalten: spalten, zeilen: zeilen, breite: breite, hoehe: hoehe, groesse: g, zelle: zelle };
  }

  function hatBrowserUmgebung() {
    return typeof root.document !== "undefined" && typeof root.document.createElement === "function" && typeof root.Image === "function";
  }

  // Lädt `slugs` (Reihenfolge = Reihenfolge im Atlas) aus vendor/icons/<slug>.svg als Bild vom eigenen
  // Ursprung (relativer Pfad — kein fremder Host möglich) und zeichnet sie nebeneinander in eine
  // <canvas>-Leinwand (Größe `groesse` je Kachel, Standard 64). `farbe`, falls gesetzt, ist eine Plaketten-
  // Hintergrundfarbe hinter jedem Logo (die Logos selbst bleiben ihr eigenes Schwarz-auf-Transparent, wie von
  // Simple Icons geliefert — Wiedererkennbarkeit der Marke bleibt so erhalten). Ohne echten Browser (Tests,
  // Node/vm ohne document/Image) oder bei einzelnen fehlenden/kaputten SVGs
  // wird NIE geworfen — stattdessen landet der Slug in `fehlend`, der Aufrufer zeigt dafür ein Monogramm.
  function ladeAtlas(slugs, optionen) {
    const liste = Array.isArray(slugs) ? slugs.slice() : [];
    const opt = optionen || {};
    const groesse = opt.groesse || 64;
    const farbe = opt.farbe || null;
    const layout = rasterLayout(liste.length, groesse);

    if (!hatBrowserUmgebung()) {
      return Promise.reject(new Error("ladeAtlas() braucht einen echten Browser (document + Image + canvas)"));
    }

    const canvas = root.document.createElement("canvas");
    canvas.width = layout.breite;
    canvas.height = layout.hoehe;
    const ctx = canvas.getContext("2d");
    const uv = {};
    const fehlend = [];

    // Direkt vom eigenen Ursprung als <img> (same-origin, von `img-src 'self'` gedeckt) — keine blob:-URL (die
    // CSP gibt blob: bewusst nicht frei; ein blob-Bild würde still abgewiesen und jedes Logo fiele aufs Monogramm).
    function ladeEinzelbild(slug) {
      return root.fetch("vendor/icons/" + encodeURIComponent(slug) + ".svg")
        .then(function (res) { if (!res.ok) throw new Error("HTTP " + res.status); return res.text(); })
        .then(function (svgText) {
          // data:-URL statt blob: — die CSP des Dienstes erlaubt nur `img-src 'self' data:`. Feste Größe, weil
          // Simple-Icons-SVGs nur eine viewBox haben (sonst zeichnet das Bild in 150×150 bzw. gar nicht).
          return new Promise(function (resolve, reject) {
            const bild = new root.Image(groesse, groesse);
            bild.onload = function () { resolve(bild); };
            bild.onerror = function () { reject(new Error("SVG unlesbar: " + slug)); };
            const mitGroesse = svgText.replace(/<svg\b(?![^>]*\swidth=)/, '<svg width="' + groesse + '" height="' + groesse + '"');
            bild.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(mitGroesse);
          });
        });
    }

    const arbeiten = liste.map(function (slug, i) {
      const zelle = layout.zelle(i);
      return ladeEinzelbild(slug).then(
        function (bild) {
          if (farbe) {
            ctx.fillStyle = farbe;
            ctx.fillRect(zelle.x, zelle.y, zelle.groesse, zelle.groesse);
          }
          const pad = Math.round(zelle.groesse * 0.12);
          ctx.drawImage(bild, zelle.x + pad, zelle.y + pad, zelle.groesse - pad * 2, zelle.groesse - pad * 2);
          uv[slug] = [zelle.u0, zelle.v0, zelle.u1, zelle.v1];
        },
        function () { fehlend.push(slug); }
      );
    });

    return Promise.all(arbeiten).then(function () {
      return { canvas: canvas, uv: uv, fehlend: fehlend };
    });
  }

  root.BrainIcons = {
    iconFuer: iconFuer,
    woerter: woerter,
    normalisiere: normalisiere,
    monogramm: monogramm,
    rasterLayout: rasterLayout,
    ladeAtlas: ladeAtlas,
  };
})(typeof window !== "undefined" ? window : globalThis);
