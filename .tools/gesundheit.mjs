// .tools/gesundheit.mjs — Gesundheitswert 0–100 fürs wöchentliche Aufräumen (rein rechnend, 0 Tokens).
// Der Wert entsteht aus Befunden, die es schon gibt (Pflegebericht/Lint) — hier wird nur gewichtet.
// Formel: wert = 100 − Σ min(deckel, gewicht × anzahl), nie unter 0. Die Deckel summieren sich auf 100;
// ein einzelner Mangel-Typ kann den Wert also nie allein auf 0 ziehen, und jeder Abzug ist einzeln nachrechenbar.
//   kaputte Links   2 je Link,   höchstens 25     (TOTER LINK im Lint)
//   Widersprüche    5 je Kasten, höchstens 25     (offene + unvollständige [!KONFLIKT]-Kästen)
//   Doppelte        3 je Gruppe, höchstens 20     (Dubletten + doppelte Seitennamen)
//   verwaiste       1 je Seite,  höchstens 15     (ohne eingehenden Link)
//   zu lange        1 je Seite,  höchstens 15     (> 150 Zeilen)
export const REGELN = [
  { schluessel: "toteLinks", label: "kaputte Links", gewicht: 2, deckel: 25 },
  { schluessel: "widersprueche", label: "Widersprüche", gewicht: 5, deckel: 25 },
  { schluessel: "doppelte", label: "Doppelte", gewicht: 3, deckel: 20 },
  { schluessel: "verwaist", label: "verwaiste Seiten", gewicht: 1, deckel: 15 },
  { schluessel: "zuLang", label: "zu lange Seiten", gewicht: 1, deckel: 15 },
];

// zaehler: { toteLinks, widersprueche, doppelte, verwaist, zuLang } (fehlend = 0)
export function gesundheitswert(zaehler = {}) {
  const teile = REGELN.map(r => {
    const anzahl = Math.max(0, Math.floor(Number(zaehler[r.schluessel]) || 0));
    return { schluessel: r.schluessel, label: r.label, anzahl, abzug: Math.min(r.deckel, r.gewicht * anzahl) };
  });
  const wert = Math.max(0, 100 - teile.reduce((s, t) => s + t.abzug, 0));
  return { wert, teile };
}

export function gesundheitText(g) {
  const z = [`Gesundheit: ${g.wert}/100`];
  for (const t of g.teile) if (t.anzahl) z.push(`  − ${t.abzug} ${t.label} (${t.anzahl})`);
  return z.join("\n");
}
