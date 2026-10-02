// .tools/ansicht/markdown.js — sicherer Markdown-Renderer der 3D-Ansicht (klassisches Skript, kein ESM).
// Setzt window.BrainMarkdown = { render, escape }. In Node per vm mit { window: {} } testbar.
//
// Sicherheitsmodell: Eingabe gilt als fremd. Aller Text wird escaped (Roh-HTML wie `List<String>` oder
// `<img onerror=…>` erscheint als sichtbarer Text); HTML entsteht ausschließlich aus eigenen, festen Tags.
// Links: Wiki-Links als <a href="#seite=…">, Markdown-Links nur mit http:/https: (neuer Tab, noopener);
// jedes andere Schema (javascript:, data:, vbscript:, file:, Entities, relative Pfade …) wird reiner Text.
(function (root) {
  "use strict";

  const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  const escape = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ESC[c]);

  // Erlaubte externe URL: beginnt (ohne Vorlauf) mit http:// oder https://, ohne Leerraum/Steuerzeichen.
  const EXTERN = /^https?:\/\/[^\s\u0000-\u001f"<>]+$/i;
  const KLASSE = /^[a-z0-9_-]{1,64}$/i; // Länge begrenzt wie die übrigen Felder
  // Längengrenzen gegen quadratische Laufzeit bei nicht geschlossenen Klammern ([[ … / [a]( … ×20 000).
  // URL: eine Ebene balancierter Klammern erlaubt (z. B. https://de.wikipedia.org/wiki/A_(B)).
  const URL_TEIL = "((?:[^()\\n]|\\([^()\\n]{0,2000}\\)){0,2000})";
  const WIKI = /\[\[([^\]|#\n]{1,300})(?:#[^\]|\n]{0,300})?(?:\|([^\]\n]{1,300}))?\]\]/g;
  const BILD = new RegExp("!\\[([^\\]\\n]{0,300})\\]\\(" + URL_TEIL + "\\)", "g");
  const LINK = new RegExp("\\[([^\\]\\n]{1,300})\\]\\(" + URL_TEIL + "\\)", "g");
  const extern = (url, inhalt) => '<a href="' + escape(url) + '" target="_blank" rel="noopener noreferrer">' + inhalt + "</a>";
  const PLATZ = /\u0000(\d+)\u0000/g;

  // Hervorhebungen (*, **, ***, _, __, ~~) mit einem Stapel statt Regex-Paaren: jeder Schluss-Tag schließt den
  // zuletzt geöffneten, darum entsteht nie falsch verschachteltes HTML (z. B. „**a *b** c*“ →
  // <strong>a <em>b</em></strong> c*). Was sich nicht schließen lässt, bleibt als sichtbares Zeichen stehen.
  // `_` öffnet/schließt nicht mitten im Wort (snake_case bleibt Text), `*` schon (a**b**c).
  const TAG = { "*1": "em", "*2": "strong", "_1": "em", "_2": "strong", "~2": "del" };
  const leer = (c) => !c || /\s/.test(c);
  const wort = (c) => !!c && /[\p{L}\p{N}_]/u.test(c);
  function hervorheben(s) {
    const aus = [], stapel = [];
    const lauf = /\*+|_+|~+/g;
    let letzt = 0, m;
    while ((m = lauf.exec(s))) {
      if (m.index > letzt) aus.push(s.slice(letzt, m.index));
      letzt = lauf.lastIndex;
      const ch = m[0][0];
      let k = m[0].length;
      if (ch === "~" ? k !== 2 : k > 3) { aus.push(m[0]); continue; }
      const p = s[m.index - 1] || "", q = s[lauf.lastIndex] || "";
      const kannAuf = !leer(q) && (ch !== "_" || !wort(p));
      const kannZu = !leer(p) && (ch !== "_" || !wort(q));
      let geschlossen = false;
      while (kannZu && k > 0) {
        let i = stapel.length - 1;
        while (i >= 0 && stapel[i].ch !== ch) i--;
        if (i < 0) break;
        while (stapel.length - 1 > i) { const x = stapel.pop(); x.slot.text = x.ch.repeat(x.len); }
        const o = stapel.pop();
        let tag, vor = "";
        if (o.len <= k || geschlossen) { tag = TAG[ch + o.len]; k -= Math.min(o.len, k); }
        else { tag = TAG[ch + 1]; vor = ch; k -= 1; } // „**a*“: ein Zeichen bleibt Text, Rest wird <em>
        o.slot.text = vor + "<" + tag + ">";
        aus.push("</" + tag + ">");
        geschlossen = true;
      }
      if (k > 0 && kannAuf) {
        for (const len of (k === 3 ? [2, 1] : [k])) { const slot = { text: "" }; aus.push(slot); stapel.push({ ch, len, slot }); }
      } else if (k > 0) aus.push(ch.repeat(k));
    }
    if (letzt < s.length) aus.push(s.slice(letzt));
    for (const x of stapel) x.slot.text = x.ch.repeat(x.len);
    return aus.map((x) => (typeof x === "string" ? x : x.text)).join("");
  }

  function inline(src, linkZiel) {
    const teile = [];
    const halte = (html) => "\u0000" + (teile.push(html) - 1) + "\u0000";
    let s = String(src == null ? "" : src).replace(/\u0000/g, "");
    // 1) Code-Spans zuerst: Inhalt bleibt wörtlich (escaped), wird nicht weiter interpretiert.
    s = s.replace(/`([^`]+)`/g, (_, c) => halte("<code>" + escape(c) + "</code>"));
    // 2) Wiki-Links [[ziel]], [[ziel#anker]], [[ziel|alias]]. linkZiel liefert ID (string) oder {id, text?, klasse?}.
    s = s.replace(WIKI, (_, ziel, alias) => {
      const name = ziel.trim();
      let z = null;
      try { z = typeof linkZiel === "function" ? linkZiel(name) : null; } catch (e) { z = null; }
      let id = null, text = "", klasse = "";
      if (typeof z === "string") id = z;
      else if (z && typeof z === "object" && typeof z.id === "string") {
        id = z.id;
        if (z.text != null && String(z.text).trim()) text = String(z.text).trim();
        if (typeof z.klasse === "string" && KLASSE.test(z.klasse)) klasse = " " + z.klasse;
      }
      const label = escape(alias && alias.trim() ? alias.trim() : (id && text) || name);
      return halte(id
        ? '<a class="wl' + klasse + '" href="#seite=' + escape(encodeURIComponent(id)) + '">' + label + "</a>"
        : '<span class="wl dead">' + label + "</span>");
    });
    // 3) Bilder ![alt](url): nie <img>. http(s) → Link mit Alt-Text (leer: „Bild“), sonst nur der Alt-Text.
    s = s.replace(BILD, (_, alt, url) => {
      const u = url.trim(), a = alt.trim();
      return halte(EXTERN.test(u) ? extern(u, escape(a || "Bild")) : escape(a));
    });
    // 4) Markdown-Links: http(s) wird echter Link (neuer Tab), alles andere nur Text.
    s = s.replace(LINK, (_, t, url) => {
      const u = url.trim();
      return halte(EXTERN.test(u) ? extern(u, escape(t)) : escape(t));
    });
    // 5) Rest escapen (Roh-HTML wird sichtbarer Text), dann Hervorhebungen auf den escapten Text (enthält keine Tags mehr).
    s = escape(s);
    s = hervorheben(s);
    // 6) Platzhalter zurück (verschachtelt möglich, z. B. Code im Link-Text).
    for (let k = 0; k < 8 && /\u0000\d+\u0000/.test(s); k++) s = s.replace(PLATZ, (_, n) => teile[n] || "");
    return s.replace(/\u0000/g, "");
  }

  // render(md, linkZiel, opts?) → HTML-String.
  //   linkZiel(name) → Seiten-ID (string) | {id, text?, klasse?} | null; null ⇒ <span class="wl dead">.
  //     text ersetzt den Anzeigetext (wenn kein Alias), klasse (nur /^[a-z0-9_-]{1,64}$/i) kommt zu class="wl …".
  //   opts.titel: überspringt eine führende H1, die mit dem Titel beginnt (Titel steht schon im Panel).
  function render(md, linkZiel, opts) {
    const titel = opts && opts.titel ? String(opts.titel) : "";
    const L = String(md == null ? "" : md).replace(/\r/g, "").split("\n");
    const o = [];
    const il = (t) => inline(t, linkZiel);
    let i = 0, para = [];
    const flush = () => { if (para.length) { o.push("<p>" + il(para.join(" ")) + "</p>"); para = []; } };
    while (i < L.length) {
      const line = L[i], t = line.trim();
      if (/^```/.test(t)) {
        flush(); const buf = []; i++;
        while (i < L.length && !/^```/.test(L[i].trim())) buf.push(L[i++]);
        i++; o.push("<pre><code>" + escape(buf.join("\n")) + "</code></pre>"); continue;
      }
      if (!t) { flush(); i++; continue; }
      const hm = t.match(/^(#{1,6})\s+(.*)$/);
      if (hm) {
        flush(); const lvl = hm[1].length, h = Math.min(6, lvl + 2);
        const istTitel = lvl === 1 && o.length === 0 && titel
          && hm[2].trim().toLowerCase().startsWith(titel.toLowerCase().slice(0, 12));
        if (!istTitel) o.push("<h" + h + ">" + il(hm[2]) + "</h" + h + ">");
        i++; continue;
      }
      if (/^(-{3,}|\*{3,})$/.test(t)) { flush(); o.push("<hr>"); i++; continue; }
      if (/^>/.test(t)) {
        flush(); const buf = [];
        while (i < L.length && /^>/.test(L[i].trim())) buf.push(L[i++].trim().replace(/^>\s?/, ""));
        const cm = buf[0] && buf[0].match(/^\[!([A-ZÄÖÜa-zäöü]+)\]\s*(.*)$/);
        if (cm) {
          const kind = cm[1].toLowerCase();
          o.push('<div class="callout' + (kind === "konflikt" ? " konflikt" : "") + '"><b>' + escape(cm[1]) + "</b> " + il(cm[2])
            + (buf.length > 1 ? "<br>" + buf.slice(1).map(il).join("<br>") : "") + "</div>");
        } else o.push("<blockquote>" + buf.map(il).join("<br>") + "</blockquote>");
        continue;
      }
      if (/^\|/.test(t) && i + 1 < L.length && /^\|?\s*:?-{2,}/.test(L[i + 1].trim())) {
        flush();
        const row = (r) => r.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
        const head = row(t); i += 2; const rows = [];
        while (i < L.length && /^\|/.test(L[i].trim())) rows.push(row(L[i++]));
        o.push('<div class="tbl"><table><thead><tr>' + head.map((c) => "<th>" + il(c) + "</th>").join("")
          + "</tr></thead><tbody>" + rows.map((r) => "<tr>" + r.map((c) => "<td>" + il(c) + "</td>").join("") + "</tr>").join("")
          + "</tbody></table></div>");
        continue;
      }
      const lm = line.match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
      if (lm) {
        flush(); const ordered = /\d/.test(lm[2]); const items = [];
        while (i < L.length) {
          const m = L[i].match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
          if (m) { items.push({ lvl: Math.min(3, Math.floor(m[1].replace(/\t/g, "  ").length / 2)), text: m[3] }); i++; }
          else if (L[i].trim() && /^\s{2,}/.test(L[i]) && items.length) { items[items.length - 1].text += " " + L[i].trim(); i++; }
          else break;
        }
        const tag = ordered ? "ol" : "ul";
        o.push("<" + tag + ">" + items.map((it) => '<li class="l' + it.lvl + '">'
          + il(it.text.replace(/^\[( |x)\]\s*/i, (m0, x) => (x.trim() ? "☑ " : "☐ "))) + "</li>").join("") + "</" + tag + ">");
        continue;
      }
      para.push(t); i++;
    }
    flush();
    return o.join("");
  }

  root.BrainMarkdown = { render: render, escape: escape };
})(typeof window !== "undefined" ? window : globalThis);
