// .tools/tests/test-beleg.mjs — beleg.mjs (B1, Spec §4.1): Zitat finden + Herkunft je Rolle, Prüfset in fixture-belege/.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { ladeTranskript, findeZitat, fundstellen, normalisiere, trenneEingespieltes, HERKUNFT_RANG } from "../beleg.mjs";

const HIER = join(dirname(fileURLToPath(import.meta.url)), "fixture-belege");
const zeilen = ladeTranskript(join(HIER, "transkript.jsonl"));
const faelle = JSON.parse(await (await import("node:fs/promises")).readFile(join(HIER, "faelle.json"), "utf8"));

test("Schnittstelle: Rang tool > du > web > ki, Verlauf als Objekte", () => {
  assert.deepEqual(HERKUNFT_RANG, { tool: 3, du: 2, web: 1, ki: 0 });
  assert.ok(zeilen.length > 30 && typeof zeilen[0] === "object");
});

test("Prüfset: Herkunft je Rolle, 100 % der Treffer-Fälle", () => {
  const falsch = [];
  for (const f of faelle.treffer) {
    const r = findeZitat(zeilen, f.zitat);
    if (!r || r.herkunft !== f.herkunft || r.uuid !== f.uuid) falsch.push(`${f.uuid} „${f.zitat}“ → ${JSON.stringify(r)} (erwartet ${f.herkunft})`);
  }
  assert.deepEqual(falsch, []);
});

test("Prüfset: Schreibvarianten werden gefunden (Quotes, Striche, Umbruch, geschütztes Leerzeichen, fett/code)", () => {
  const falsch = [];
  for (const f of faelle.varianten) {
    const r = findeZitat(zeilen, f.zitat);
    if (!r || r.herkunft !== f.herkunft || r.uuid !== f.uuid) falsch.push(`${f.uuid} „${f.zitat}“ → ${JSON.stringify(r)}`);
  }
  assert.deepEqual(falsch, []);
});

test("Prüfset: inhaltliche Abweichungen werden nie gefunden", () => {
  const falsch = faelle.keinTreffer.filter((f) => findeZitat(zeilen, f.zitat) !== null).map((f) => `${f.grund}: „${f.zitat}“`);
  assert.deepEqual(falsch, []);
});

test("Fundstelle trägt Zeit, uuid und Werkzeug", () => {
  assert.deepEqual(findeZitat(zeilen, "Möhren säen ab Mitte April in Reihe 3."), { herkunft: "tool", uuid: "u06", zeit: "2026-10-21T08:06:00.000Z", werkzeug: "Bash" });
  assert.equal(findeZitat(zeilen, "Kompost braucht sechs Monate bis zur Reife.").werkzeug, "WebFetch");
  assert.equal(findeZitat(zeilen, "Die Tomaten stehen im Hochbeet Nord").werkzeug, "");
});

test("Mehrfachfund: stärkste Herkunft gewinnt, bei Gleichstand die früheste", () => {
  const z = [
    { type: "assistant", uuid: "a", timestamp: "2026-01-01T00:00:03Z", message: { content: [{ type: "text", text: "Das Beet liegt im Süden des Gartens." }] } },
    { type: "user", uuid: "b", timestamp: "2026-01-01T00:00:02Z", message: { content: "Das Beet liegt im Süden des Gartens." } },
    { type: "user", uuid: "c", timestamp: "2026-01-01T00:00:01Z", message: { content: "Das Beet liegt im Süden des Gartens." } },
  ];
  assert.equal(findeZitat(z, "Das Beet liegt im Süden des Gartens.").uuid, "c");
  z.push({ type: "assistant", uuid: "d", timestamp: "2026-01-01T00:00:00Z", message: { content: [{ type: "tool_use", id: "x", name: "Read", input: {} }] } },
    { type: "user", uuid: "e", timestamp: "2026-01-01T00:00:09Z", message: { content: [{ type: "tool_result", tool_use_id: "x", content: "Das Beet liegt im Süden des Gartens." }] } });
  assert.deepEqual([findeZitat(z, "Das Beet liegt im Süden des Gartens.").herkunft, findeZitat(z, "Das Beet liegt im Süden des Gartens.").uuid], ["tool", "e"]);
});

test("Länge: nach Normalisierung 12–300 Zeichen, sonst null", () => {
  const z = [{ type: "user", uuid: "a", message: { content: "wort ".repeat(100) } }];
  const q = (n) => ("wort ".repeat(n)).trim();                 // 5n-1 Zeichen
  assert.equal(q(60).length, 299);
  assert.equal(findeZitat(z, q(60))?.herkunft, "du");
  assert.equal(findeZitat(z, q(61)), null);
  assert.equal(findeZitat([{ type: "user", uuid: "a", message: { content: "Zwölf Zeichn" } }], "Zwölf Zeichn")?.herkunft, "du");
  assert.equal(findeZitat([{ type: "user", uuid: "a", message: { content: "Elf Zeichen" } }], "Elf Zeichen"), null);
  assert.equal(findeZitat([{ type: "user", uuid: "a", message: { content: "ab" } }], "  a   \n  "), null);
  assert.equal(findeZitat(null, "Irgendein Satz hier"), null);
});

test("Herkunft: Fehler, Agent/Skill/Edit/Write, unbekannter Aufruf, Neben-Kette → ki; Sonderfälle", () => {
  const nutzung = (id, name) => ({ type: "assistant", uuid: "n" + id, message: { content: [{ type: "tool_use", id, name, input: {} }] } });
  const ergeb = (id, t, extra = {}) => ({ type: "user", uuid: "e" + id, message: { content: [{ type: "tool_result", tool_use_id: id, content: t, ...extra }] } });
  const z = [nutzung("1", "Edit"), ergeb("1", "Edit-Ergebnis steht hier drin."), nutzung("2", "Glob"), ergeb("2", "Glob-Ergebnis steht hier drin."),
    nutzung("3", "AskUserQuestion"), ergeb("3", "Auswahl-Antwort steht hier drin."), nutzung("4", "mcp__x__y"), ergeb("4", "MCP-Ergebnis steht hier drin."),
    nutzung("5", "WebSearch"), ergeb("5", "Such-Ergebnis steht hier drin.", { is_error: true }),
    { type: "user", uuid: "q", isSidechain: true, message: { content: "Neben-Kette Nutzertext steht hier." } },
    { type: "user", uuid: "r", message: { content: "Brain-Treffer (lokal): Hinweistext aus dem Brain steht hier." } },
    { type: "user", uuid: "s", message: { content: "Vor dem Block. <user-prompt-submit-hook>Hook-Ausgabe lang genug.</user-prompt-submit-hook> Danach." } },
    { type: "user", uuid: "t", message: { content: "Echter Text, <system-reminder>offener Block bis zum Ende ohne Schluss" } },
    { type: "system", uuid: "v", message: { content: "Systemzeile steht hier drin." } }];
  const h = (t) => findeZitat(z, t)?.herkunft ?? null;
  assert.equal(h("Edit-Ergebnis steht hier drin."), "ki");
  assert.equal(h("Glob-Ergebnis steht hier drin."), "tool");
  assert.equal(h("Auswahl-Antwort steht hier drin."), "ki");
  assert.equal(h("MCP-Ergebnis steht hier drin."), "tool");
  assert.equal(h("Such-Ergebnis steht hier drin."), "ki");
  assert.equal(h("Neben-Kette Nutzertext steht hier."), "ki");
  assert.equal(h("Hinweistext aus dem Brain steht hier."), "ki");
  assert.equal(h("Hook-Ausgabe lang genug."), "ki");
  assert.equal(h("Vor dem Block."), "du");                   // Rest außerhalb des Blocks bleibt Nutzertext
  assert.equal(h("Echter Text,"), "du");
  assert.equal(h("offener Block bis zum Ende ohne Schluss"), "ki");
  assert.equal(h("Systemzeile steht hier drin."), null);
});

test("fundstellen: Form { herkunft, uuid, zeit, werkzeug, text }; tolerant gegen Müll", () => {
  const f = fundstellen([null, 5, "x", [], { type: "user" }, { type: "user", uuid: "a", timestamp: "t", message: { content: [null, { type: "text", text: "Nutzer sagt etwas." }, { type: "tool_result" }] } }]);
  assert.deepEqual(f, [{ herkunft: "du", uuid: "a", zeit: "t", werkzeug: "", text: "Nutzer sagt etwas." }]);
  assert.deepEqual(fundstellen(undefined), []);
});

test("normalisiere + trenneEingespieltes", () => {
  assert.equal(normalisiere(" „A“ –\n ‚b‘ … **c** `d` "), `"A" - 'b' ... c d`);
  assert.equal(normalisiere(null), "");
  assert.deepEqual(trenneEingespieltes("A <system-reminder>x</system-reminder> B <task-notification>offen"), { rein: "A \n B", eingespielt: ["x", "offen"] });
  assert.deepEqual(trenneEingespieltes("<local-command-stdout>ok</local-command-stdout>"), { rein: "", eingespielt: ["ok"] });
});

test("ladeTranskript: kaputte Zeilen und halbe Zeile weg, fehlende Datei → [], Objekte nur", () => {
  const d = mkdtempSync(join(tmpdir(), "beleg-"));
  const f = join(d, "a.jsonl");
  writeFileSync(f, ['{"type":"user","uuid":"a"}', "kein json", "", "[1]", "5", '{"type":"us'].join("\n"));
  assert.deepEqual(ladeTranskript(f), [{ type: "user", uuid: "a" }]);
  assert.deepEqual(ladeTranskript(join(d, "gibtsnicht.jsonl")), []);
});
