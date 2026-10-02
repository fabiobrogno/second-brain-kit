// Ansicht: sicherer Markdown-Renderer (markdown.js) und Suche wie brain search (suche.js).
// Beide sind klassische Browser-Skripte; hier per vm in einen Kontext mit `window` geladen.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { minisuche } from "../minisuche.mjs";
import { walk } from "../vault-dateien.mjs";

const HIER = dirname(fileURLToPath(import.meta.url));
const ANSICHT = join(HIER, "..", "ansicht");
const FIXTURE = join(HIER, "fixture");

function lade(datei) {
  const ctx = vm.createContext({ window: {} });
  vm.runInContext(readFileSync(join(ANSICHT, datei), "utf8"), ctx, { filename: datei });
  return ctx.window;
}
const { BrainMarkdown } = lade("markdown.js");
const { BrainSuche } = lade("suche.js");
// Ergebnisse stammen aus dem vm-Realm (eigenes Array.prototype) — für deepStrictEqual in diesen Realm holen.
const suche = (...a) => JSON.parse(JSON.stringify(BrainSuche.suche(...a)));

const ziel = (name) => (name === "seite" || name === "a\"b'c" ? name : null);
// Kein ausführbares Tag: kein <script, kein <img, kein Tag mit on…=-Attribut; Links nur #seite= oder http(s).
// Escapter Text wie &lt;img … onerror=…&gt; ist erlaubt (sichtbar, nicht ausführbar).
const ohneGefahr = (html) => {
  assert.ok(!/<script/i.test(html), "kein <script: " + html);
  assert.ok(!/<img/i.test(html), "kein <img: " + html);
  assert.ok(!/<[a-z][^>]*\son\w+\s*=/i.test(html), "kein Event-Handler-Attribut: " + html);
  for (const m of html.matchAll(/href="([^"]*)"/g)) assert.match(m[1], /^(#seite=|https?:\/\/)/i, "nur #seite=/http(s): " + html);
  for (const m of html.matchAll(/<[a-z][^>]*>/gi)) assert.ok(!/javascript:|data:|vbscript:|file:/i.test(m[0]), "kein gefährliches Schema im Tag: " + m[0]);
};

// ---------------------------------------------------------------- Markdown
test("markdown: <script> wird sichtbarer Text, nicht ausgeführt", () => {
  const html = BrainMarkdown.render("Hallo <script>alert(1)</script> Welt", ziel);
  ohneGefahr(html);
  assert.match(html, /^<p>Hallo &lt;script&gt;alert\(1\)&lt;\/script&gt; Welt<\/p>$/);
});
test("markdown: <img onerror> bleibt escapter Text", () => {
  const html = BrainMarkdown.render("Bild <img src=x onerror=alert(1)> da", ziel);
  ohneGefahr(html);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
});
test("markdown: List<String> bleibt sichtbar", () => {
  assert.equal(BrainMarkdown.render("Typ List<String> und a < b > c", ziel), "<p>Typ List&lt;String&gt; und a &lt; b &gt; c</p>");
});
test("markdown: http(s)-Links werden echte Links mit neuem Tab", () => {
  const html = BrainMarkdown.render("[A](https://example.org/a?x=1&y='2') und [B](http://example.org) und [C]( HTTPS://example.org/c )", ziel);
  ohneGefahr(html);
  assert.match(html, /<a href="https:\/\/example\.org\/a\?x=1&amp;y=&#39;2&#39;" target="_blank" rel="noopener noreferrer">A<\/a>/);
  assert.match(html, /<a href="http:\/\/example\.org" target="_blank" rel="noopener noreferrer">B<\/a>/);
  const q = BrainMarkdown.render('[Q](https://example.org/"onmouseover="x)', ziel);
  ohneGefahr(q); assert.ok(!/<a\b/.test(q), "URL mit \" wird Text: " + q);
  assert.match(html, /<a href="HTTPS:\/\/example\.org\/c" target="_blank" rel="noopener noreferrer">C<\/a>/);
});
test("markdown: javascript:/data:/vbscript:/file: und Tarnungen werden Text", () => {
  const faelle = [
    "javascript:alert(1)", "JaVaScRiPt:alert(1)", " javascript:alert(1)", "&#106;avascript:alert(1)",
    "&#x6A;avascript:alert(1)", "java\tscript:alert(1)", "data:text/html;base64,PHNjcmlwdD4=", "DATA:text/html,x",
    "vbscript:msgbox(1)", "VBScript:x", "file:///etc/passwd", " FILE:///c:/x", "//example.org", "seite.md", "",
  ];
  for (const url of faelle) {
    const html = BrainMarkdown.render(`[x](${url})`, ziel);
    ohneGefahr(html);
    assert.ok(!/<a\b/.test(html), `kein Link für ${JSON.stringify(url)}: ${html}`);
    assert.match(html, /^<p>x/, `Text bleibt für ${JSON.stringify(url)}: ${html}`);
  }
});
test("markdown: URL mit einer Ebene Klammern", () => {
  const html = BrainMarkdown.render("[x](https://de.wikipedia.org/wiki/A_(B)) danach", ziel);
  assert.equal(html, '<p><a href="https://de.wikipedia.org/wiki/A_(B)" target="_blank" rel="noopener noreferrer">x</a> danach</p>');
});
test("markdown: Bilder nie als <img> — http(s) als Link mit Alt-Text, sonst nur Alt-Text", () => {
  const html = BrainMarkdown.render("![Logo](https://a.org/l.png) ![](https://a.org/b.png) ![alt](bild.png) ![x](javascript:1) ![d](data:image/png;base64,AAA)", ziel);
  ohneGefahr(html);
  assert.equal(html, '<p><a href="https://a.org/l.png" target="_blank" rel="noopener noreferrer">Logo</a> '
    + '<a href="https://a.org/b.png" target="_blank" rel="noopener noreferrer">Bild</a> alt x d</p>');
});
test("markdown: Regressionsfälle Platzhalter und verschachtelte Klammern", () => {
  const faelle = {
    "[x](https://a.com/`\" onmouseover=alert(1) x`)": null,
    "[[[seite]]](javascript:1)": null,
    "[a [b](javascript:x) c](https://ok)": null,
    "![x](javascript:1)": null,
    "```\n</code><script>alert(1)</script>\n```": null,
    "`</code><script>`": null,
  };
  for (const md of Object.keys(faelle)) {
    const html = BrainMarkdown.render(md, ziel);
    ohneGefahr(html);
    assert.ok(!/<a [^>]*href="(?!#seite=|https?:)/i.test(html), md + " → " + html);
    assert.ok(!/onmouseover="/i.test(html), md + " → " + html);
  }
  assert.equal(BrainMarkdown.render("x\u00000\u0000y", ziel), "<p>x0y</p>", "Platzhalter-Injektion wirkungslos");
  assert.match(BrainMarkdown.render("```\n</code><script>\n```", ziel), /^<pre><code>&lt;\/code&gt;&lt;script&gt;<\/code><\/pre>$/);
  assert.ok(!/<a\b/.test(BrainMarkdown.render("[x](https://a.com/`\" onmouseover=alert(1) x`)", ziel)), "Backtick-Platzhalter in URL → Text");
});
test("markdown: nicht geschlossene Klammern laufen linear", () => {
  for (const s of ["[[".repeat(20000), "[a](".repeat(20000), "[".repeat(20000), "![a](".repeat(20000), "[a](" + "(x".repeat(20000)]) {
    const t0 = Date.now(); BrainMarkdown.render(s, ziel); const ms = Date.now() - t0;
    assert.ok(ms < 500, `zu langsam (${ms} ms) für ${JSON.stringify(s.slice(0, 8))}…`);
  }
});
test("markdown: Wiki-Link wird <a href=\"#seite=…\">", () => {
  const html = BrainMarkdown.render("Siehe [[seite]].", ziel);
  assert.match(html, /<a class="wl" href="#seite=seite">seite<\/a>/);
  ohneGefahr(html);
});
test("markdown: [[seite|alias]] zeigt Alias, Ziel bleibt seite", () => {
  assert.match(BrainMarkdown.render("[[seite|Mein Alias]]", ziel), /<a class="wl" href="#seite=seite">Mein Alias<\/a>/);
});
test("markdown: linkZiel als Objekt {id, text, klasse}", () => {
  const obj = (name) => ({
    seite: { id: "09_wiki/seite.md", text: "Schöner <Titel>", klasse: "c-firma_2" },
    boese: { id: "b", text: "B", klasse: "x\" onclick=\"alert(1)" },
    ohne: { id: "o" },
    kaputt: { text: "keine id" },
  })[name] || null;
  const html = BrainMarkdown.render("[[seite]] [[seite|Alias]] [[boese]] [[ohne]] [[kaputt]]", obj);
  assert.match(html, /<a class="wl c-firma_2" href="#seite=09_wiki%2Fseite\.md">Schöner &lt;Titel&gt;<\/a>/);
  assert.match(html, /<a class="wl c-firma_2" href="#seite=09_wiki%2Fseite\.md">Alias<\/a>/, "Alias schlägt text");
  assert.match(html, /<a class="wl" href="#seite=b">B<\/a>/, "ungültige klasse wird verworfen");
  assert.match(html, /<a class="wl" href="#seite=o">ohne<\/a>/, "ohne text: Ziel als Text");
  assert.match(html, /<span class="wl dead">kaputt<\/span>/, "Objekt ohne id: tot");
  assert.ok(!/onclick/.test(html));
  ohneGefahr(html);
});

test("markdown: klasse höchstens 64 Zeichen", () => {
  const mit = (k) => BrainMarkdown.render("[[s]]", () => ({ id: "s", klasse: k }));
  assert.match(mit("a".repeat(64)), new RegExp('<a class="wl ' + "a".repeat(64) + '" href'));
  assert.match(mit("a".repeat(65)), /<a class="wl" href="#seite=s">/, "zu lang: Klasse verworfen, Link bleibt");
  assert.match(mit(""), /<a class="wl" href="#seite=s">/, "leer: keine Klasse");
});
test("markdown: unbekannte Seite (linkZiel → null) wird Text ohne Link", () => {
  const html = BrainMarkdown.render("[[gibts-nicht]] und [[gibts-nicht|<b>x</b>]]", ziel);
  assert.ok(!/<a\b/.test(html));
  assert.match(html, /<span class="wl dead">gibts-nicht<\/span>/);
  assert.match(html, /<span class="wl dead">&lt;b&gt;x&lt;\/b&gt;<\/span>/);
  assert.match(BrainMarkdown.render("[[x]]"), /<span class="wl dead">x<\/span>/, "ohne linkZiel");
});
test("markdown: \" und ' können kein Attribut aufbrechen", () => {
  const html = BrainMarkdown.render("[[a\"b'c|Zi\"tat 'x']] und \"frei\" 'text'", ziel);
  assert.match(html, /href="#seite=a%22b&#39;c">Zi&quot;tat &#39;x&#39;<\/a>/);
  assert.match(html, /&quot;frei&quot; &#39;text&#39;/);
  const hrefs = [...html.matchAll(/<a [^>]*>/g)].map((m) => m[0]);
  assert.deepEqual(hrefs, ['<a class="wl" href="#seite=a%22b&#39;c">']);
  ohneGefahr(html);
});
test("markdown: Code bleibt wörtlich und escaped, Struktur stimmt", () => {
  const html = BrainMarkdown.render("# Titel\n\n`<script>`\n\n```\n<img onerror=x>\n```\n- **fett** und *kursiv*\n\n> [!Konflikt] a vs b", ziel, { titel: "Titel" });
  assert.ok(!/<h3>Titel/.test(html), "führende H1 = Titel wird übersprungen");
  assert.match(html, /<code>&lt;script&gt;<\/code>/);
  assert.match(html, /<pre><code>&lt;img onerror=x&gt;<\/code><\/pre>/);
  assert.match(html, /<li class="l0"><strong>fett<\/strong> und <em>kursiv<\/em><\/li>/);
  assert.match(html, /<div class="callout konflikt"><b>Konflikt<\/b> a vs b<\/div>/);
  ohneGefahr(html);
});
// Tags müssen sauber verschachtelt sein: jeder Schluss-Tag schließt den zuletzt geöffneten.
const sauberVerschachtelt = (html) => {
  const stapel = [];
  for (const m of html.matchAll(/<(\/?)(strong|em|del)>/g)) {
    if (!m[1]) stapel.push(m[2]);
    else assert.equal(stapel.pop(), m[2], "falsch verschachtelt: " + html);
  }
  assert.equal(stapel.length, 0, "offener Tag: " + html);
};
test("markdown: **a *b** c* wird sauber verschachtelt", () => {
  const html = BrainMarkdown.render("**a *b** c*", ziel);
  sauberVerschachtelt(html);
  assert.equal(html, "<p><strong>a <em>b</em></strong> c*</p>");
});
test("markdown: Hervorhebungen — Grenzfälle bleiben gültiges HTML", () => {
  const faelle = {
    "**fett** und *kursiv*": "<p><strong>fett</strong> und <em>kursiv</em></p>",
    "***beides***": "<p><strong><em>beides</em></strong></p>",
    "*a **b** c*": "<p><em>a <strong>b</strong> c</em></p>",
    "**a *b* c**": "<p><strong>a <em>b</em> c</strong></p>",
    "2 * 3 * 4": "<p>2 * 3 * 4</p>",
    "**offen": "<p>**offen</p>",
    "*offen **auch": "<p>*offen **auch</p>",
    "a**b**c": "<p>a<strong>b</strong>c</p>",
    "* *": "<ul><li class=\"l0\">*</li></ul>",
    "****": "<hr>",
    "x ***** y": "<p>x ***** y</p>",
  };
  for (const [md, soll] of Object.entries(faelle)) {
    const html = BrainMarkdown.render(md, ziel);
    sauberVerschachtelt(html);
    assert.equal(html, soll, md);
  }
  for (const md of ["**a *b** c*", "*a **b* c**", "***a* b**", "**a* b*", "*a** b**", "_a *b_ c*", "**`*`**", "*[[seite]]*"]) {
    const html = BrainMarkdown.render(md, ziel);
    sauberVerschachtelt(html);
    ohneGefahr(html);
  }
});
test("markdown: leere/fehlende Eingabe → leerer String", () => {
  assert.equal(BrainMarkdown.render("", ziel), "");
  assert.equal(BrainMarkdown.render(undefined, ziel), "");
});

// ---------------------------------------------------------------- Suche
// Knoten aus der Fixture genauso zerlegen wie minisuche: Rumpf ohne Frontmatter + beschreibung (letzte
// description:-Zeile). `desc` bekommt — wie daten.mjs — ersatzweise den ersten Absatz; er darf NICHT zählen.
function fixtureKnoten() {
  return walk(FIXTURE).map((f) => {
    const raw = readFileSync(f.full, "utf8").replace(/\r\n/g, "\n");
    const m = raw.match(/^---\n([\s\S]*?)\n---\n?/);
    let beschreibung = "";
    if (m) for (const z of m[1].split("\n")) { const kv = z.match(/^description:\s*(.*)$/); if (kv) beschreibung = kv[1].trim().replace(/^["']|["']$/g, ""); }
    const body = m ? raw.slice(m[0].length) : raw;
    const ersterAbsatz = body.split("\n").filter((l) => l.trim() && !/^#/.test(l)).join(" ");
    return { id: f.rel.split(sep).join("/"), title: f.rel, beschreibung, desc: beschreibung || ersterAbsatz, body };
  });
}

for (const frage of ["thema alpha", "testthema beta amazon", "siehe gamma"]) {
  test(`suche: Top-3 wie minisuche für „${frage}“`, () => {
    const erwartet = minisuche(FIXTURE, frage, 3);
    assert.ok(erwartet.length >= 2, "Frage muss auf der Fixture treffen");
    const ist = suche(fixtureKnoten(), frage, 3);
    assert.deepEqual(ist.map((h) => h.id), erwartet.map((h) => h.pfad));
    ist.forEach((h, k) => assert.ok(Math.abs(h.score - erwartet[k].score) < 1e-9, "gleicher Score"));
  });
}

test("suche: Tippfehler „drosselng“ findet „Drosselung“", () => {
  const nodes = [
    ...fixtureKnoten(),
    { id: "09_wiki/thema_drossel.md", beschreibung: "Wann Amazon drosselt", desc: "Wann Amazon drosselt", body: "# Drossel\n\nDie Drosselung greift ab 100 Anfragen pro Minute." },
  ];
  const r = suche(nodes, "drosselng", 5);
  assert.equal(r[0].id, "09_wiki/thema_drossel.md");
  assert.deepEqual(r[0].begriffe, ["drosselung"]);
  assert.match(r[0].auszug, /Drosselung greift/);
  assert.match(BrainSuche.hervorheben(r[0].auszug, r[0].begriffe), /<mark>Drosselung<\/mark>/);
});

test("suche: Live-Tippen — letztes Token ab 3 Zeichen als Präfix („dros“ → „Drosselung“)", () => {
  const nodes = [
    ...fixtureKnoten(),
    { id: "09_wiki/thema_drossel.md", beschreibung: "Wann Amazon bremst", desc: "Wann Amazon bremst", body: "# Bremse\n\nDie Drosselung greift ab 100 Anfragen pro Minute." },
  ];
  const r = suche(nodes, "dros", 5);
  assert.equal(r[0].id, "09_wiki/thema_drossel.md");
  assert.deepEqual(r[0].begriffe, ["drosselung"]);
  assert.match(BrainSuche.hervorheben(r[0].auszug, r[0].begriffe), /<mark>Drosselung<\/mark>/);
  assert.equal(suche(nodes, "amazon dro", 5)[0].id, "09_wiki/thema_drossel.md", "Präfix nur fürs letzte Token");
  assert.deepEqual(suche(nodes, "dr", 5), [], "unter 3 Zeichen kein Präfix");
  assert.ok(!suche(nodes, "dros alpha", 5).some((h) => h.id === "09_wiki/thema_drossel.md"), "nicht-letztes Token ohne Präfix");
  // Vollständiges Wort bleibt exakt: „thema“ wird nicht auf „themen…“/„thema_…“ erweitert.
  const exakt = suche(nodes, "thema", 5), mini = minisuche(FIXTURE, "thema", 5);
  assert.deepEqual(exakt.filter((h) => h.score > 0).map((h) => h.id), mini.map((h) => h.pfad), "BM25-Teil wie minisuche (Titel-Nachrang kommt mit score 0 dahinter)");
});

test("suche: Ergebnisfelder und Auszug", () => {
  const r = suche(fixtureKnoten(), "siehe", 5);
  assert.ok(r.length >= 1);
  for (const h of r) {
    assert.deepEqual(Object.keys(h).sort(), ["auszug", "begriffe", "id", "score"]);
    assert.equal(typeof h.score, "number");
    assert.match(h.auszug, /Siehe/);
    assert.ok(!/\[\[|#/.test(h.auszug), "Auszug ohne Markdown: " + h.auszug);
  }
});

test("suche: opts.filter schließt vor dem Kürzen aus, Scores bleiben die des ganzen Bestands", () => {
  const nodes = fixtureKnoten();
  const alle = suche(nodes, "thema alpha", 10);
  assert.ok(alle.length >= 2);
  const weg = alle[0].id;
  const gefiltert = JSON.parse(JSON.stringify(BrainSuche.suche(nodes, "thema alpha", 1, { filter: (n, i) => n.id !== weg && nodes[i] === n })));
  assert.equal(gefiltert.length, 1);
  assert.equal(gefiltert[0].id, alle[1].id, "nächster Treffer rückt nach (Filter vor slice)");
  assert.ok(Math.abs(gefiltert[0].score - alle[1].score) < 1e-12, "Score unverändert");
  assert.deepEqual(suche(nodes, "thema alpha", 10, { filter: () => false }), []);
  assert.deepEqual(suche(nodes, "thema alpha", 10, { filter: "kein fn" }).map((h) => h.id), alle.map((h) => h.id), "kein Funktions-Filter: ignoriert");
});

test("suche: Titel-Nachrang — weniger als n BM25-Treffer → Titel-/Namenstreffer mit score 0 dahinter", () => {
  const nodes = [
    { id: "a.md", title: "Allgemein", name: "a", beschreibung: "", desc: "A", body: "Die Lieferkette ist lang." },
    { id: "inbox/lieferkette-ideen.md", title: "lieferkette-ideen", name: "lieferkette-ideen", beschreibung: "", desc: "Ideen-Notiz", body: "Nur Stichpunkte ohne das Wort." },
    { id: "z.md", title: "Zeug", name: "z", beschreibung: "", desc: "Z", body: "nichts" },
  ];
  const r = suche(nodes, "ideen", 5);
  assert.deepEqual(r.map((h) => h.id), ["inbox/lieferkette-ideen.md"]);
  assert.equal(r[0].score, 0);
  assert.equal(r[0].auszug, "Ideen-Notiz", "auszug aus desc");
  assert.deepEqual(r[0].begriffe, ["ideen"]);
  // BM25-Treffer vorne, Titeltreffer dahinter, kein Duplikat
  const m = suche(nodes, "lieferkette", 5);
  assert.deepEqual(m.map((h) => h.id), ["a.md", "inbox/lieferkette-ideen.md"]);
  assert.ok(m[0].score > 0 && m[1].score === 0);
  assert.deepEqual(suche(nodes, "lieferkette", 1).map((h) => h.id), ["a.md"], "volle n: kein Nachrang");
  // Präfix nur fürs letzte Token ab 3 Zeichen
  assert.deepEqual(suche(nodes, "zeu", 5).map((h) => h.id), ["z.md"]);
  assert.deepEqual(suche(nodes, "ze", 5), []);
  assert.deepEqual(suche(nodes, "zeu nichtda", 5), [], "nicht-letztes Token kein Präfix");
  // Filter gilt auch für den Nachrang
  assert.deepEqual(suche(nodes, "ideen", 5, { filter: (n) => n.id !== "inbox/lieferkette-ideen.md" }), []);
});

test("suche: leere Frage, nur Sonderzeichen, leere Knotenliste → []", () => {
  const nodes = fixtureKnoten();
  assert.deepEqual(suche(nodes, "", 5), []);
  assert.deepEqual(suche(nodes, "   ", 5), []);
  assert.deepEqual(suche(nodes, "?!#*()[]<>\"'", 5), []);
  assert.deepEqual(suche([], "alpha", 5), []);
  assert.deepEqual(suche(null, "alpha", 5), []);
  assert.deepEqual(suche([{ id: "x" }], "alpha", 5), [], "Knoten ohne body/desc");
});

test("suche: nur beschreibung zählt ×3, desc ist bloß Auszug-Fallback", () => {
  const nodes = [
    { id: "a", beschreibung: "", desc: "zebra zebra zebra", body: "zebra und viel anderer text hier drin" },
    { id: "b", beschreibung: "zebra", desc: "Anzeige", body: "zebra und viel anderer text hier drin" },
    { id: "c", beschreibung: "nur oben giraffe", desc: "Fallback-Text", body: "kein treffer im rumpf" },
  ];
  const r = suche(nodes, "zebra", 5);
  assert.deepEqual(r.map((h) => h.id), ["b", "a"], "b vor a: desc von a zählt nicht");
  const c = suche(nodes, "giraffe", 5);
  assert.equal(c[0].id, "c");
  assert.equal(c[0].auszug, "Fallback-Text", "Treffer nur in beschreibung → Auszug = desc");
  assert.deepEqual(suche([{ id: "x", desc: "giraffe" }], "giraffe", 5), [], "desc allein findet nichts");
});

test("suche: NFC — zerlegte Umlaute (NFD) und Astral-Zeichen", () => {
  const nfd = "Dru\u0308ckerei";
  const nodes = [{ id: "n", beschreibung: "", body: `Die ${nfd} liefert.` }, { id: "x", beschreibung: "", body: "anderes" }];
  assert.equal(suche(nodes, "drückerei", 5)[0].id, "n");
  assert.equal(suche(nodes, "druckerei", 5)[0].id, "n", "Tippfehler ü→u (1 Codepoint)");
  // Astral-Zeichen (𝐀 = 2 UTF-16-Einheiten) zählt als ein Zeichen: „ab𝐀cde“ vs. „abcde“ = Abstand 1.
  const astral = [{ id: "s", beschreibung: "", body: "abcdef" }];
  assert.equal(suche(astral, "ab\u{1D400}def", 5)[0].id, "s");
  assert.equal(BrainSuche.tokenisiere("Dru\u0308ck").length, 1);
  // minisuche normalisiert ebenso (Parität) — temporärer Mini-Vault.
  const v = mkdtempSync(join(tmpdir(), "ansicht-nfc-"));
  try {
    writeFileSync(join(v, "n.md"), `# N\nDie ${nfd} liefert.`);
    writeFileSync(join(v, "x.md"), "# X\nanderes");
    const mini = minisuche(v, "drückerei", 5);
    assert.deepEqual(mini.map((h) => h.pfad), ["n.md"]);
    const knoten = [{ id: "n.md", beschreibung: "", body: `# N\nDie ${nfd} liefert.` }, { id: "x.md", beschreibung: "", body: "# X\nanderes" }];
    assert.ok(Math.abs(suche(knoten, "drückerei", 5)[0].score - mini[0].score) < 1e-9);
  } finally { rmSync(v, { recursive: true, force: true }); }
});

test("suche: Präfix per Binärsuche, Levenshtein nur Länge ±1 — großes Vokabular bleibt schnell", () => {
  const nodes = [];
  for (let i = 0; i < 2000; i++) {
    const w = [];
    for (let k = 0; k < 50; k++) w.push("w" + ((i * 50 + k) * 7919 % 100000).toString(36) + "x");
    nodes.push({ id: "n" + i, beschreibung: "", body: w.join(" ") });
  }
  nodes.push({ id: "ziel", beschreibung: "", body: "Drosselung bei Last" });
  suche(nodes, "start", 5); // Index bauen
  const t0 = Date.now();
  for (let k = 0; k < 20; k++) { suche(nodes, "dros", 5); suche(nodes, "drosselng", 5); }
  const ms = (Date.now() - t0) / 40;
  assert.equal(suche(nodes, "dros", 5)[0].id, "ziel");
  assert.equal(suche(nodes, "drosselng", 5)[0].id, "ziel");
  assert.ok(ms < 30, `zu langsam: ${ms} ms je Suche`);
});

test("hervorheben: NFD-Text wird markiert, Original bleibt erhalten", () => {
  const nfd = "U\u0308bersicht";
  const r = suche([{ id: "n", title: nfd, beschreibung: "", body: `Die ${nfd} der Seite.` }], "übersicht", 5);
  assert.deepEqual(r[0].begriffe, ["übersicht"]);
  assert.equal(BrainSuche.hervorheben(nfd + " <b>", r[0].begriffe), "<mark>" + nfd + "</mark> &lt;b&gt;");
  assert.equal(BrainSuche.hervorheben("Übersicht", ["U\u0308bersicht"]), "<mark>Übersicht</mark>", "Begriff in NFD");
});

test("hervorheben: escaped alles, markiert nur ganze Begriffe", () => {
  assert.equal(BrainSuche.hervorheben("<b>Alpha</b> alphabet", ["alpha"]), "&lt;b&gt;<mark>Alpha</mark>&lt;/b&gt; alphabet");
});
