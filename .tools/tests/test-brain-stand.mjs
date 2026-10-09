// .tools/tests/test-brain-stand.mjs — gemeinsame Zählweise des Brain-Stands (Statusleiste + Brain-Band der
// brain-mods): Inbox ohne System-Ordner, Konflikte, prüfbedürftig, Vorschläge, Frische, letzte Hinweis-Seiten,
// CLI --json. Temp-Vaults, Zahlen exakt nachrechenbar.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { brainStand, statusZeile, letzteHinweise } from "../brain-stand.mjs";

const HIER = dirname(fileURLToPath(import.meta.url));
const ohneAnsi = (s) => s.replace(/\x1b\[\d+m/g, "");

function vault() {
  const v = join(mkdtempSync(join(tmpdir(), "brain stand ")), "Mein Brain");
  const datei = (rel, inhalt = "x\n") => { mkdirSync(dirname(join(v, rel)), { recursive: true }); writeFileSync(join(v, rel), inhalt); };
  datei("brain.config.json", "{}\n");
  datei("00_inbox/a.md");
  datei("00_inbox/unter/b.txt");
  datei("00_inbox/_import/c.md"); // System-Ordner oben: zählt nicht
  datei("00_inbox/.versteckt.md"); // versteckt: zählt nicht
  datei("00_inbox/_vorschlaege/v1.md");
  datei("00_inbox/_vorschlaege/v2.md");
  datei("09_wiki/seite.md", "> [!KONFLIKT] offen\n");
  datei("09_wiki/themen/zwei.md", "> [!KONFLIKT] offen\n");
  datei("09_wiki/_index.md", "> [!KONFLIKT] offen\n"); // _-Dateien zählen nicht
  datei("09_wiki/ruhig.md", "kein Konflikt\n");
  datei(".logs/lint-cache.txt", "- 09_wiki/x.md PRÜFBEDÜRFTIG\n- FRISCHE: alt\n- SUCHINDEX: veraltet\n");
  return { v, datei };
}

test("brainStand zählt wie die Statusleiste", () => {
  const { v } = vault();
  assert.deepEqual(brainStand(v, { mitIngest: false }), {
    wartend: 2, konflikte: 2, pruefbeduerftig: 1, vorschlaege: 2, ingest: "", frisch: 2,
  });
});

test("brainStand: leerer Vault → alles 0, ohne Fehler", () => {
  const v = mkdtempSync(join(tmpdir(), "brain leer "));
  assert.deepEqual(brainStand(v, { mitIngest: false }), { wartend: 0, konflikte: 0, pruefbeduerftig: 0, vorschlaege: 0, ingest: "", frisch: 0 });
});

test("statusZeile: Texte und Reihenfolge", () => {
  assert.equal(ohneAnsi(statusZeile({ wartend: 0, konflikte: 0, pruefbeduerftig: 0, vorschlaege: 0, ingest: "", frisch: 0 }, "Opus")), "🧠 Brain: aktuell · Opus");
  assert.equal(
    ohneAnsi(statusZeile({ wartend: 2, konflikte: 2, pruefbeduerftig: 1, vorschlaege: 1, ingest: "02.10.", frisch: 2 })),
    "🧠 Brain: 2 wartend · 2 Konflikt(e)! · 1 prüfbedürftig · 1 Vorschlag · Ingest 02.10. ⚠",
  );
  assert.equal(ohneAnsi(statusZeile({ wartend: 0, konflikte: 0, pruefbeduerftig: 3, vorschlaege: 2, ingest: "01.10.", frisch: 0 })),
    "🧠 Brain · 3 prüfbedürftig · 2 Vorschläge · Ingest 01.10.");
});

test("letzteHinweise: letzte Zeile der Sitzung (8er-sid), kodierte und alte hits-Felder", () => {
  const { v, datei } = vault();
  const seiten = encodeURIComponent(["09_wiki/a b.md", "09_wiki/c,d.md"].join("\t"));
  datei(".logs/hint.log", [
    "2026-10-03T10:00:00 sid=abcd1234 len=5 weg=dienst top=0.6 zeichen=10 hits=09_wiki/alt.md unterdrueckt=0 kalt=0 refresh=0 ms=5",
    "2026-10-03T10:05:00 sid=ffff0000 len=5 weg=dienst top=0.6 zeichen=10 hits=09_wiki/fremd.md unterdrueckt=0 kalt=0 refresh=0 ms=5",
    `2026-10-03T10:06:00 sid=abcd1234 len=5 weg=dienst top=0.7 zeichen=10 hits=${seiten} unterdrueckt=0 kalt=0 refresh=0 ms=5`,
    "",
  ].join("\n"));
  assert.deepEqual(letzteHinweise(v, "abcd1234-5678-90ab"), { zeit: "2026-10-03T10:06:00", seiten: ["09_wiki/a b.md", "09_wiki/c,d.md"] });
  assert.deepEqual(letzteHinweise(v, "ffff0000"), { zeit: "2026-10-03T10:05:00", seiten: ["09_wiki/fremd.md"] });
  assert.equal(letzteHinweise(v, "00000000"), null);
  assert.equal(letzteHinweise(v, ""), null);
  datei(".logs/hint.log", "2026-10-03T11:00:00 sid=abcd1234 len=5 weg=dienst top=0.1 zeichen=0 hits=- unterdrueckt=0 kalt=0 refresh=0 ms=5\n");
  assert.deepEqual(letzteHinweise(v, "abcd1234"), { zeit: "2026-10-03T11:00:00", seiten: [] });
});

test("CLI --json liefert { stand, hinweis } für BRAIN_VAULT", () => {
  const { v, datei } = vault();
  datei(".logs/hint.log", "2026-10-03T10:06:00 sid=abcd1234 len=5 weg=dienst top=0.7 zeichen=10 hits=09_wiki%2Fx.md unterdrueckt=0 kalt=0 refresh=0 ms=5\n");
  const aus = execFileSync(process.execPath, [join(HIER, "..", "brain-stand.mjs"), "--json", "--sid=abcd1234"], {
    encoding: "utf8", env: { ...process.env, BRAIN_VAULT: v },
  });
  const d = JSON.parse(aus);
  assert.equal(d.stand.wartend, 2);
  assert.equal(d.stand.konflikte, 2);
  assert.deepEqual(d.hinweis.seiten, ["09_wiki/x.md"]);
});
