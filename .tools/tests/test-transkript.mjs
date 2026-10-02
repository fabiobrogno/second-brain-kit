import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { vorigeFrage } from "../transkript.mjs";

const d = mkdtempSync(join(tmpdir(), "tr-"));
const z = (o) => JSON.stringify(o);
test("vorigeFrage: letzte echte User-Nachricht vor der aktuellen, Tool-Results und halbe Zeile ignoriert", () => {
  const f = join(d, "a.jsonl");
  writeFileSync(f, [z({ type: "user", message: { content: "welche join fallen gibt es zwischen asin und sku" } }),
    z({ type: "assistant", message: { content: [{ type: "text", text: "..." }] } }),
    z({ type: "user", message: { content: [{ type: "tool_result", content: "x" }] } }),
    z({ type: "user", message: { content: "<command-name>/x</command-name>" } }),
    z({ type: "user", message: { content: "und beim zweiten?" } }), '{"type":"us'].join("\n"));
  assert.equal(vorigeFrage(f, "und beim zweiten?"), "welche join fallen gibt es zwischen asin und sku");
});
test("vorigeFrage: fehlende Datei / nur Tool-Results → null", () => {
  assert.equal(vorigeFrage(join(d, "gibtsnicht.jsonl"), "x"), null);
  const f = join(d, "b.jsonl"); writeFileSync(f, z({ type: "user", message: { content: [{ type: "tool_result" }] } }));
  assert.equal(vorigeFrage(f, "x"), null);
});
test("vorigeFrage: 1 MB Datei schnell (liest nur das Ende)", () => {
  const f = join(d, "c.jsonl");
  writeFileSync(f, (z({ type: "assistant", message: { content: "x".repeat(900) } }) + "\n").repeat(1100) + z({ type: "user", message: { content: "vorige frage hier" } }) + "\n" + z({ type: "user", message: { content: "und jetzt?" } }));
  const t = Date.now(); assert.equal(vorigeFrage(f, "und jetzt?"), "vorige frage hier"); assert.ok(Date.now() - t < 50);
});

test("vorigeFrage: Meta- und Zusammenfassungs-Einträge zählen nicht", async () => {
  const f = join(d, "m.jsonl");
  writeFileSync(f, [z({ type: "user", message: { content: "echte frage zu asin" } }), z({ type: "user", isMeta: true, message: { content: "Base directory for this skill ..." } }),
    z({ type: "user", isCompactSummary: true, message: { content: "This session is being continued ..." } }), z({ type: "user", message: { content: "und dann?" } })].join("\n"));
  assert.equal(vorigeFrage(f, "und dann?"), "echte frage zu asin");
});
