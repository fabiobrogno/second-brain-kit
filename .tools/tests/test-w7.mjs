// .tools/tests/test-w7.mjs — Fehler-Signal W7 (B1, §4.4): Brain-Hinweis → Antwort → Korrektur → .logs/w7.jsonl, genau einmal.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { nutzer, assistent, hinweis, schreibeVerlauf, tempVault, tempOrdner, TEMP_HOME, KIT } from "./verlauf-fixture.mjs";
import { istKorrektur, hinweisSeiten, erkenneW7, schreibeW7, leseW7, w7Lauf } from "../w7.mjs";

const KOPF = "Brain-Treffer (lokal, ungelesen — nur öffnen, wenn für die Aufgabe relevant):";
const V = "/vault/garten brän";
const H = (seiten, vault = V) => hinweis(`${KOPF}\n${seiten.map((s) => `- ${vault}/${s} — Beschreibung`).join("\n")}`);
const z = (n) => `2026-10-21T08:0${n}:00.000Z`;
const BEET = ["09_wiki/garten/thema_beet.md"];

test("istKorrektur: Muster aus lektionen.mjs + „stimmt nicht / veraltet / überholt“; Zustimmung und Fragen nicht", () => {
  for (const t of ["Nein, das ist falsch.", "Das stimmt so nicht mehr.", "Die Seite ist veraltet.", "das war falsch", "Das ist nicht mehr aktuell.", "Das ist überholt."]) assert.ok(istKorrektur(t), t);
  for (const t of ["Danke, passt.", "Wie spät ist es?", "Stimmt, so machen wir es.", ""]) assert.ok(!istKorrektur(t), t);
});

test("hinweisSeiten: ~ und Vault mit Leerzeichen/Umlaut, Zusätze, W6-Zeile; Überblick, fremder Vault, Import, _-Dateien nie", () => {
  const text = [KOPF,
    "- ~/Mein Brän/09_wiki/garten/thema_beet.md (abgelaufen seit 3 Tagen) — Beet",
    "- ~/Mein Brän/09_wiki/garten/thema_alt.md — ersetzt → [[thema_beet]], nicht mehr aktuell",
    "- /heim/jo/mein brän/09_wiki/garten/thema_rasen.md (PRÜFBEDÜRFTIG: Zweifel) — Rasen",
    "- ~/Mein Brän/00_inbox/_import/alt/notiz.md — Import",
    "- ~/Anderes/09_wiki/garten/thema_x.md — fremd",
    "- ~/Mein Brän/09_wiki/garten/_garten.md — generiert",
    "- Überblick: ~/Mein Brän/09_wiki/garten/_garten.md",
  ].join("\n");
  assert.deepEqual(hinweisSeiten(text, { vault: "/heim/jo/Mein Brän", home: "/heim/jo", plattform: "darwin" }),
    ["09_wiki/garten/thema_beet.md", "09_wiki/garten/thema_alt.md", "09_wiki/garten/thema_rasen.md"]);
  assert.deepEqual(hinweisSeiten("Kein Hinweis\n- ~/Mein Brän/09_wiki/a.md — x", { vault: "/heim/jo/Mein Brän", home: "/heim/jo" }), []);
});

test("erkenneW7: Hinweis → Antwort → Korrektur = ein Fund je gezeigter Seite; Hinweis am Sitzungsstart zählt für den ersten Prompt", () => {
  const e = [
    nutzer("Wann gieße ich das Hochbeet?", { uuid: "p1", zeit: z(0) }),
    H(["09_wiki/garten/thema_beet.md", "09_wiki/garten/thema_wasser.md"]),
    assistent("Laut Brain um 7 Uhr."),
    nutzer("Nein, das stimmt nicht, wir gießen abends.", { uuid: "p2", zeit: z(1) }),
    assistent("Korrigiert."),
  ];
  const zitat = "Nein, das stimmt nicht, wir gießen abends.";
  assert.deepEqual(erkenneW7(e, { vault: V, sitzung: "s1" }), [
    { seite: "09_wiki/garten/thema_beet.md", sitzung: "s1", uuid: "p2", zeit: z(1), zitat },
    { seite: "09_wiki/garten/thema_wasser.md", sitzung: "s1", uuid: "p2", zeit: z(1), zitat },
  ]);
  const start = [H(BEET), nutzer("Plan?", { uuid: "p1", zeit: z(0) }), assistent("7 Uhr."), nutzer("Das ist veraltet.", { uuid: "p2", zeit: z(1) })];
  assert.equal(erkenneW7(start, { vault: V, sitzung: "s1" }).length, 1);
});

test("erkenneW7: ohne Antwort, Korrektur erst später, ohne Korrektur, anderer Hook, fremder Vault, Nebenzweig → kein Fund; Zugangsdaten → Fund ohne Zitat", () => {
  const faelle = [
    [nutzer("Plan?"), H(BEET), nutzer("Nein, falsch!")],
    [nutzer("Plan?"), H(BEET), assistent("7 Uhr."), nutzer("Danke."), assistent("Gern."), nutzer("Nein, das ist falsch.")],
    [nutzer("Plan?"), H(BEET), assistent("7 Uhr."), nutzer("Danke, passt.")],
    [nutzer("Plan?"), hinweis(`${KOPF}\n- ${V}/09_wiki/garten/thema_beet.md — x`, "SessionStart"), assistent("7 Uhr."), nutzer("Nein, falsch.")],
    [nutzer("Plan?"), H(BEET, "/vault/anders"), assistent("7 Uhr."), nutzer("Nein, falsch.")],
    [nutzer("Plan?"), H(BEET), assistent("7 Uhr."), nutzer("Nein, falsch.", { isSidechain: true })],
  ];
  for (const [i, e] of faelle.entries()) assert.deepEqual(erkenneW7(e, { vault: V, sitzung: "s" }), [], `Fall ${i}`);
  const koeder = ["pass", "word"].join("") + "=Koeder123";
  const [f] = erkenneW7([nutzer("Plan?"), H(BEET), assistent("7 Uhr."), nutzer(`Nein, falsch: ${koeder}`, { uuid: "p2" })], { vault: V, sitzung: "s" });
  assert.equal(f.seite, BEET[0]);
  assert.equal(f.zitat, "");
});

test("schreibeW7/leseW7: jeder Fund genau einmal (sitzung|uuid|seite); kaputte Zeilen stören nicht", () => {
  const v = tempVault();
  const f = { seite: BEET[0], sitzung: "s1", uuid: "p2", zeit: z(1), zitat: "Nein." };
  assert.equal(schreibeW7(v, [f, f], { jetzt: Date.UTC(2026, 9, 21, 9) }), 1);
  writeFileSync(join(v, ".logs", "w7.jsonl"), readFileSync(join(v, ".logs", "w7.jsonl"), "utf8") + "{kaputt\n");
  assert.equal(schreibeW7(v, [f, { ...f, seite: "09_wiki/garten/thema_wasser.md" }]), 1);
  assert.deepEqual(leseW7(v).map((o) => [o.v, o.seite, o.erkannt.length]), [[1, BEET[0], 20], [1, "09_wiki/garten/thema_wasser.md", 20]]);
});

function verlaufMit(v) {
  const f = join(tempOrdner("W7 Verlauf"), "sitzung w7.jsonl");
  schreibeVerlauf(f, [
    nutzer("Wann gieße ich das Hochbeet?", { uuid: "p1", zeit: z(0), cwd: "/projekte/garten" }),
    H(BEET, v),
    assistent("Laut Brain um 7 Uhr."),
    nutzer("Nein, das stimmt nicht.", { uuid: "p2", zeit: z(1), cwd: "/projekte/garten" }),
    assistent("Korrigiert."),
  ]);
  return f;
}

test("w7Lauf: w7.jsonl + w7.log; zweiter Lauf ohne Neues und Folgelauf mit mehr Verlauf ergänzen nur Neues; ausgeschlossen, kaputte Config, BRAIN_ERNTE=1 → nichts", () => {
  const v = tempVault("W7 Brän, Jo's");
  const tr = verlaufMit(v);
  const opt = { transkript: tr, sid: "sitzung-w7", cwd: "/projekte/garten", home: TEMP_HOME };
  assert.deepEqual(w7Lauf(v, opt), { status: "ok", funde: 1, neu: 1 });
  assert.deepEqual(w7Lauf(v, opt), { status: "ok", funde: 1, neu: 0 });
  const mehr = [nutzer("Und das Beet?", { uuid: "p3", zeit: z(2) }), H(BEET, v), assistent("Süd."), nutzer("Das ist veraltet.", { uuid: "p4", zeit: z(3) })];
  writeFileSync(tr, readFileSync(tr, "utf8") + mehr.map((o) => JSON.stringify(o)).join("\n") + "\n");
  assert.deepEqual(w7Lauf(v, opt), { status: "ok", funde: 2, neu: 1 });
  assert.deepEqual(leseW7(v).map((o) => o.uuid), ["p2", "p4"]);
  assert.match(readFileSync(join(v, ".logs", "w7.log"), "utf8"), /status=ok funde=2 neu=1\n$/);
  const aus = tempVault();
  writeFileSync(join(aus, "brain.config.json"), JSON.stringify({ automatik: { ernteNichtIn: ["/projekte/garten"] } }));
  assert.equal(w7Lauf(aus, { ...opt, transkript: verlaufMit(aus) }).grund, "ausgeschlossener Ordner");
  const kaputt = tempVault();
  writeFileSync(join(kaputt, "brain.config.json"), "{ kaputt");
  assert.equal(w7Lauf(kaputt, { ...opt, transkript: verlaufMit(kaputt) }).grund, "Config nicht lesbar");
  process.env.BRAIN_ERNTE = "1";
  try { assert.equal(w7Lauf(v, opt).grund, "Selbstaufruf"); } finally { delete process.env.BRAIN_ERNTE; }
  for (const x of [aus, kaputt]) assert.ok(!existsSync(join(x, ".logs", "w7.jsonl")));
});

test("w7 CLI: zwei Prozesse gleichzeitig (SessionEnd + PreCompact) → jeder Fund genau einmal, keine Ausgabe", async () => {
  const v = tempVault("W7 parallel Brän");
  const tr = verlaufMit(v);
  const env = { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_") && !k.startsWith("BRAIN_"))), HOME: TEMP_HOME, USERPROFILE: TEMP_HOME };
  const lauf = () => new Promise((fertig) => {
    const k = spawn(process.execPath, [join(KIT, "w7.mjs"), "--transkript", tr, "--sid", "sitzung-w7", "--cwd", "/projekte/garten", v], { env, windowsHide: true });
    let aus = "";
    k.stdout.on("data", (d) => { aus += d; });
    k.stderr.on("data", (d) => { aus += d; });
    k.on("close", (code) => fertig({ code, aus }));
  });
  assert.deepEqual(await Promise.all([lauf(), lauf()]), [{ code: 0, aus: "" }, { code: 0, aus: "" }]);
  assert.equal(leseW7(v).length, 1);
  assert.equal(readFileSync(join(v, ".logs", "w7.log"), "utf8").trim().split("\n").length, 2);
});
