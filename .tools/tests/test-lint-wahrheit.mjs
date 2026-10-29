// .tools/tests/test-lint-wahrheit.mjs — Lint für B1 (Wahrheit): Seitenfelder (hier), später Fakt-Belege und Aliasse.
// Temp-Vaults mit Leerzeichen/Umlaut/Apostroph, HOME auf Temp; --struktur = pre-commit-Modus (nur Blockierendes, Exit 2).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const KIT = fileURLToPath(new URL("..", import.meta.url));
const LINT = join(KIT, "brain-lint.mjs");
const TEMP_HOME = mkdtempSync(join(tmpdir(), "brain lint wahrheit home "));
const OHNE_GIT = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_") && !k.startsWith("BRAIN_")));

export function vaultMit(dateien, { cfg = {} } = {}) {
  const v = join(mkdtempSync(join(tmpdir(), "brain lint wahrheit ")), "Brän, Jo's Vault");
  mkdirSync(v, { recursive: true });
  writeFileSync(join(v, "brain.config.json"), JSON.stringify(cfg));
  for (const [rel, inhalt] of Object.entries(dateien)) {
    const f = join(v, ...rel.split("/"));
    mkdirSync(dirname(f), { recursive: true });
    writeFileSync(f, inhalt);
  }
  return v;
}
export function lint(v, struktur = false) {
  const r = spawnSync(process.execPath, [LINT, v, ...(struktur ? ["--struktur"] : [])],
    { encoding: "utf8", env: { ...OHNE_GIT, HOME: TEMP_HOME, USERPROFILE: TEMP_HOME }, timeout: 30000, windowsHide: true });
  return { status: r.status, zeilen: (r.stdout || "").split("\n").filter((z) => z.startsWith("- ")).map((z) => z.slice(2)), stderr: r.stderr };
}
export const seite = (name, { fm = "", body = "Text." } = {}) => `---\nname: ${name}\ndescription: ${name} Beschreibung\ntyp: thema\n${fm}---\n\n# ${name}\n\n${body}\n`;
const mit = (zeilen, start) => zeilen.filter((z) => z.startsWith(start));

test("Lint Seitenfelder (--struktur): KRITISCH, GILT_SEIT und ERSETZT blockieren", () => {
  const v = vaultMit({
    "09_wiki/garten/thema_a.md": seite("thema_a", { fm: "kritisch: ja\n" }),
    "09_wiki/garten/thema_b.md": seite("thema_b", { fm: "gilt_seit: 2026-02-30\n" }),
    "09_wiki/garten/thema_c.md": seite("thema_c", { fm: "ersetzt_durch: \"[[thema_gibt_es_nicht]]\"\n" }),
    "09_wiki/garten/thema_d.md": seite("thema_d", { fm: "ersetzt_durch: \"[[thema_d]]\"\n" }),
    "09_wiki/garten/thema_e.md": seite("thema_e", { fm: "ersetzt_durch: thema_a\n" }),
  });
  const { status, zeilen } = lint(v, true);
  assert.equal(status, 2);
  assert.deepEqual(mit(zeilen, "KRITISCH:"), ["KRITISCH: garten/thema_a.md — kritisch muss true oder false sein (ohne Anführungszeichen) — bis dahin gilt die Seite als kritisch"]);
  assert.deepEqual(mit(zeilen, "GILT_SEIT:"), ["GILT_SEIT: garten/thema_b.md — gilt_seit ist kein gültiges Datum JJJJ-MM-TT"]);
  assert.deepEqual(mit(zeilen, "ERSETZT:").sort(), [
    "ERSETZT: garten/thema_c.md — Nachfolger [[thema_gibt_es_nicht]] existiert nicht",
    "ERSETZT: garten/thema_d.md — Nachfolger ist die Seite selbst",
    "ERSETZT: garten/thema_e.md — ersetzt_durch ist kein Wikilink — Format: ersetzt_durch: \"[[nachfolger]]\"",
  ]);
});

test("Lint Seitenfelder: Kette und Zweifel blockieren nicht; noch verlinkte alte Seite nur im Normalmodus, Nachfolger darf verlinken", () => {
  const v = vaultMit({
    "09_wiki/garten/thema_alt.md": seite("thema_alt", { fm: "ersetzt_durch: \"[[thema_mitte]]\"\n" }),
    "09_wiki/garten/thema_mitte.md": seite("thema_mitte", { fm: "ersetzt_durch: \"[[thema_neu]]\"\n", body: "Früher: [[thema_alt]]" }),
    "09_wiki/garten/thema_neu.md": seite("thema_neu", { fm: "kritisch: false\nzweifel: \"2026-10-22: Nutzer sagt, abends gießen\"\n" }),
    "09_wiki/garten/thema_leser.md": seite("thema_leser", { body: "Siehe [[thema_alt]]." }),
  });
  const s = lint(v, true);
  assert.equal(s.status, 0, s.zeilen.join("\n"));
  const n = lint(v).zeilen;
  assert.deepEqual(mit(n, "ERSETZT-HINWEIS:").sort(), [
    "ERSETZT-HINWEIS: garten/thema_alt.md — Nachfolger garten/thema_mitte.md ist selbst ersetzt (Kette) — direkt auf den letzten Nachfolger zeigen",
    "ERSETZT-HINWEIS: garten/thema_alt.md — wird noch verlinkt von garten/thema_leser.md (Link auf garten/thema_mitte.md umstellen)",
  ]);
  assert.deepEqual(mit(n, "PRÜFBEDÜRFTIG (ZWEIFEL):"), ["PRÜFBEDÜRFTIG (ZWEIFEL): garten/thema_neu.md — 2026-10-22: Nutzer sagt, abends gießen"]);
  const r = n.find((z) => z.startsWith("PRÜFBEDÜRFTIG (ZWEIFEL)")).match(/^PRÜFBEDÜRFTIG[^:]*:\s*(.+?)(?: — |$)/);
  assert.equal(r[1], "garten/thema_neu.md", "analyse.mjs/ansicht lesen die Seite mit diesem Muster");
});

test("Lint FAKT-BELEG (--struktur): fehlender Beleg blockiert; vorhandener ok; Hand-Stichpunkte wie auf der Live-Seite nie", () => {
  const cfg = { clusters: [{ id: "20_garten", name: "Garten" }] };
  const ok = "- Möhren ab April · Stand 21.10.2026 · [[20_garten/belege/2026-10/b-1]]";
  const hand = "## Fakten\n- Umsatz läuft gut (Stand 19.10.)\n- Stand: Markenbuch v1 fertig\n- Shop live, Stand 21.10.2026";
  const beleg = { "20_garten/belege/2026-10/b-1.md": "# Beleg b-1\n" };
  const r1 = lint(vaultMit({ "09_wiki/garten/thema_beet.md": seite("thema_beet", { body: `${hand}\n${ok}` }), ...beleg }, { cfg }), true);
  assert.equal(r1.status, 0, r1.zeilen.join("\n"));
  const r2 = lint(vaultMit({ "09_wiki/garten/thema_beet.md": seite("thema_beet", { body: `${hand}\n${ok}\n- Kompost · Stand 21.10.2026` }), ...beleg }, { cfg }), true);
  assert.equal(r2.status, 2);
  assert.deepEqual(mit(r2.zeilen, "FAKT-BELEG:"), ["FAKT-BELEG: garten/thema_beet.md — „Kompost“ ohne Beleg-Link — Format: - <Aussage> · Stand TT.MM.JJJJ · [[<cluster>/belege/<JJJJ-MM>/<id>]]"]);
});

test("brain-index: .logs/aliasse.json und Kartenzeile „Auch genannt“; Seite ohne Feld behält ihre Karte", () => {
  const v = vaultMit({
    "09_wiki/technik/entitaet_nucleus.md": seite("nucleus", { fm: "auch_genannt: [\"Nucleus Base\", \"nucleus-core\"]\n" }),
    "09_wiki/technik/thema_beet.md": seite("thema_beet"),
  });
  const r = spawnSync(process.execPath, [join(KIT, "brain-index.mjs"), v], { encoding: "utf8", env: { ...OHNE_GIT, HOME: TEMP_HOME, USERPROFILE: TEMP_HOME }, windowsHide: true });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(readFileSync(join(v, ".logs", "aliasse.json"), "utf8")), { version: 1,
    seiten: { "09_wiki/technik/entitaet_nucleus.md": ["nucleus-base", "nucleus-core"] },
    namen: { beet: ["09_wiki/technik/thema_beet.md"], nucleus: ["09_wiki/technik/entitaet_nucleus.md"],
      "nucleus-base": ["09_wiki/technik/entitaet_nucleus.md"], "nucleus-core": ["09_wiki/technik/entitaet_nucleus.md"] } });
  assert.match(readFileSync(join(v, ".logs", "hint-karten", "entitaet_nucleus.md"), "utf8"), /\n\nAuch genannt: Nucleus Base · nucleus-core\n\nAbschnitte: /);
  assert.ok(!readFileSync(join(v, ".logs", "hint-karten", "thema_beet.md"), "utf8").includes("Auch genannt"));
});

test("Lint ALIAS (--struktur) blockiert Formatfehler; Alias-Dublette nur im Normalmodus als DOPPELTER NAME, nie blockierend", () => {
  const k = lint(vaultMit({ "09_wiki/technik/entitaet_nucleus.md": seite("nucleus", { fm: "auch_genannt: nucleus-base\n" }) }), true);
  assert.equal(k.status, 2);
  assert.deepEqual(mit(k.zeilen, "ALIAS:"), ["ALIAS: technik/entitaet_nucleus.md — kein gültiges JSON — Format: auch_genannt: [\"…\", \"…\"]"]);
  const doppelt = vaultMit({
    "09_wiki/technik/entitaet_nucleus.md": seite("nucleus", { fm: "auch_genannt: [\"Kern\"]\n" }),
    "09_wiki/technik/entitaet_kern.md": seite("kern"),
  });
  assert.equal(lint(doppelt, true).status, 0);
  assert.deepEqual(mit(lint(doppelt).zeilen, "DOPPELTER NAME:"),
    ["DOPPELTER NAME: technik/entitaet_kern.md · technik/entitaet_nucleus.md — Name „kern“ (auch_genannt) zeigt auf mehrere Seiten — Alias eindeutig machen"]);
});
