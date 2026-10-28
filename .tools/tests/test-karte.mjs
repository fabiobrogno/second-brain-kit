// Die Karte für KIs bleibt schlank (< 200 Zeilen), trägt die Grundregel „Wahrheit vor Zustimmung“,
// und jeder Wiki-Ordner mit Seiten bekommt vom Indexer eine Indexdatei (_<ordner>.md).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, statSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { kopiereBaum } from "./kopiere-baum.mjs";
const T = fileURLToPath(new URL("..", import.meta.url));
const lies = (p) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");

test("Karte-Vorlage: unter 200 Zeilen, mit „Wahrheit vor Zustimmung“ und Verweis auf Ordner-Indexe", () => {
  const karte = lies(join(T, "kit", "AGENTS.md"));
  assert.ok(karte.split("\n").length < 200, "Karte hat 200 Zeilen oder mehr");
  assert.match(karte, /Wahrheit vor Zustimmung.*Widerspricht eine Anfrage den Fakten im Brain, sag es klar/);
  assert.match(karte, /_<ordnername>\.md/);
});

test("gebaute Karte (agents) bleibt unter 200 Zeilen", () => {
  const v = mkdtempSync(join(tmpdir(), "karte-v-")); writeFileSync(join(v, "brain.config.json"), "{}");
  const ziel = join(v, "AGENTS.md");
  execFileSync(process.execPath, [join(T, "skills-build.mjs"), v, "--ziel", "agents", ziel]);
  const text = lies(ziel);
  assert.ok(text.split("\n").length < 200);
  assert.match(text, /Wahrheit vor Zustimmung/);
});

test("jeder Wiki-Ordner mit Seiten hat nach dem Indexer eine Indexdatei", () => {
  const v = mkdtempSync(join(tmpdir(), "karte-w-"));
  kopiereBaum(join(T, "tests", "fixture"), v);
  execFileSync(process.execPath, [join(T, "brain-index.mjs"), v], { stdio: "pipe" });
  const wiki = join(v, "09_wiki");
  assert.ok(existsSync(join(wiki, "_index.md")), "Wurzel-Index fehlt");
  const pruefe = (dir) => {
    const eintraege = readdirSync(dir, { withFileTypes: true });
    for (const e of eintraege) if (e.isDirectory() && !e.name.startsWith(".")) {
      const sub = join(dir, e.name);
      const hatSeiten = (d) => readdirSync(d, { withFileTypes: true }).some(x => x.isDirectory() ? hatSeiten(join(d, x.name)) : x.name.endsWith(".md") && !x.name.startsWith("_"));
      if (hatSeiten(sub) && readdirSync(sub).some(n => n.endsWith(".md") && !n.startsWith("_"))) {
        assert.ok(existsSync(join(sub, `_${e.name}.md`)), `Indexdatei fehlt in ${sub}`);
      }
      pruefe(sub);
    }
  };
  pruefe(wiki);
});
