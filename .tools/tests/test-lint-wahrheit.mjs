// .tools/tests/test-lint-wahrheit.mjs — Lint für B1 (Wahrheit): Seitenfelder (hier), später Fakt-Belege und Aliasse.
// Temp-Vaults mit Leerzeichen/Umlaut/Apostroph, HOME auf Temp; --struktur = pre-commit-Modus (nur Blockierendes, Exit 2).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const LINT = join(fileURLToPath(new URL("..", import.meta.url)), "brain-lint.mjs");
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
