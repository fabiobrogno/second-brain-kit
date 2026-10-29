// .tools/tests/test-fakten.mjs — Fakt-Zeilen (B1, §4.2): Format bauen/lesen, Beleg-Links prüfen, Hand-Stichpunkte nie.
import { test } from "node:test";
import assert from "node:assert/strict";
import { baueFaktZeile, baueErsetzteZeile, leseFaktZeilen, pruefeFaktBelege, belegZiel, datumDE } from "../fakten.mjs";

const D = new Date(2026, 9, 21, 12);

test("baueFaktZeile/baueErsetzteZeile: exakt das Spec-Format; Ungültiges wirft", () => {
  const beleg = belegZiel("20_garten", "b-123", D);
  assert.equal(beleg, "20_garten/belege/2026-10/b-123");
  assert.equal(baueFaktZeile({ aussage: "Möhren ab Mitte\nApril säen", datum: D, beleg }), "- Möhren ab Mitte April säen · Stand 21.10.2026 · [[20_garten/belege/2026-10/b-123]]");
  assert.equal(baueErsetzteZeile({ aussage: "Möhren ab März", datum: new Date(2026, 9, 23, 12) }), "- ~~Möhren ab März~~ · ersetzt am 23.10.2026 durch die Zeile darunter");
  assert.equal(datumDE(new Date(2026, 0, 5, 12)), "05.01.2026");
  for (const f of [{ aussage: "", beleg }, { aussage: "a · b", beleg }, { aussage: "~~x~~", beleg }, { aussage: "siehe [[x]]", beleg },
    { aussage: "x", beleg: "20_garten/x" }, { aussage: "x", beleg: "20_garten/belege/2026-13/a" }]) {
    assert.throws(() => baueFaktZeile({ ...f, datum: D }), JSON.stringify(f));
  }
  assert.throws(() => belegZiel("20 garten", "B!", D));
});

test("leseFaktZeilen: Rundweg; ersetzt; Frontmatter und Code-Zäune zählen nicht; BOM + CRLF", () => {
  const zeile = baueFaktZeile({ aussage: "Möhren ab April", datum: D, beleg: "20_garten/belege/2026-10/b-1" });
  const t = ("\uFEFF---\nname: x\nliste:\n- X · Stand 21.10.2026\n---\n\n## Fakten\n" + zeile + "\n```\n- Y · Stand 21.10.2026\n```\n"
    + "- ~~Möhren ab März~~ · ersetzt am 23.10.2026 durch die Zeile darunter\n").replace(/\n/g, "\r\n");
  assert.deepEqual(leseFaktZeilen(t).map(({ zeile: _z, ...r }) => r), [
    { art: "fakt", aussage: "Möhren ab April", datum: "21.10.2026", beleg: "20_garten/belege/2026-10/b-1" },
    { art: "ersetzt", aussage: "Möhren ab März", datum: "23.10.2026", beleg: "" },
  ]);
});

test("leseFaktZeilen: Hand-Stichpunkte wie auf der Live-Seite sind nie Fakt-Zeilen", () => {
  const t = "## Fakten\n- Umsatz läuft gut (Stand 19.10.)\n- Stand: Markenbuch v1 fertig\n- Stand 21.10.2026 · neu\n- Shop live, Stand 21.10.2026\n"
    + "Stand 21.10.2026 · im Fließtext\n- Preise · Stand 21.10.\n";
  assert.deepEqual(leseFaktZeilen(t), []);
  assert.deepEqual(pruefeFaktBelege(t), []);
});

test("pruefeFaktBelege: ohne Link, kein Beleg-Pfad, fremder Cluster, Beleg fehlt; vorhandener Beleg und ersetzte Zeile ok", () => {
  const t = [
    "- A ok · Stand 21.10.2026 · [[20_garten/belege/2026-10/b-1]]",
    "- B ohne Link · Stand 21.10.2026",
    "- C falscher Pfad · Stand 21.10.2026 · [[thema_beet]]",
    "- D fremder Cluster · Stand 21.10.2026 · [[99_fremd/belege/2026-10/b-2]]",
    "- E fehlt · Stand 21.10.2026 · [[20_garten/belege/2026-10/b-3]]",
    "- ~~F alt~~ · ersetzt am 23.10.2026 durch die Zeile darunter",
  ].join("\n");
  const da = new Set(["20_garten/belege/2026-10/b-1", "99_fremd/belege/2026-10/b-2"]);
  assert.deepEqual(pruefeFaktBelege(t, { existiert: (b) => da.has(b), cluster: ["20_garten"] }).map((b) => b.meldung), [
    "„B ohne Link“ ohne Beleg-Link — Format: - <Aussage> · Stand TT.MM.JJJJ · [[<cluster>/belege/<JJJJ-MM>/<id>]]",
    "„C falscher Pfad“ — [[thema_beet]] ist kein Beleg-Pfad (<cluster>/belege/<JJJJ-MM>/<id>)",
    "„D fremder Cluster“ — [[99_fremd/belege/2026-10/b-2]] ist kein Beleg-Pfad (<cluster>/belege/<JJJJ-MM>/<id>)",
    "„E fehlt“ — Beleg [[20_garten/belege/2026-10/b-3]] fehlt",
  ]);
});
