// .tools/tests/test-messlatte.mjs — messlatte(): Fragen aus Kit-Datei + eigener <wiki>/_messlatte.json, Holdout,
// Ergebniszeile im gewohnten hint-eval-Format an .logs/hint-eval.log, Ziel/Rückschritt-Regel, keine Fragen → 400.
// Statt des echten Hinweis-Hooks (braucht QMD) läuft ein erfundener Hook aus einem Temp-Ordner. Nur mkdtemp.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { messlatte, ladeFragen } from "../messlatte.mjs";
import { analyse } from "../analyse.mjs";

const TEST_HOME = mkdtempSync(join(tmpdir(), "brain messlatte home "));
Object.assign(process.env, { HOME: TEST_HOME, USERPROFILE: TEST_HOME });

const ORT = mkdtempSync(join(tmpdir(), "brain mess, latte 'x' "));
// Erfundener Hook: „alpha“ → Treffer thema_alpha, „beta“ → falscher Treffer, „laut“ → Fehlalarm, sonst still.
// Prüft nebenbei, dass BRAIN_VAULT gesetzt und die Sitzungs-ID eine eval-ID ist.
const HOOK = join(ORT, "fake-hook.mjs");
writeFileSync(HOOK, `
let roh = ""; process.stdin.on("data", d => roh += d); process.stdin.on("end", () => {
  const { prompt, session_id } = JSON.parse(roh);
  if (!process.env.BRAIN_VAULT || !String(session_id).startsWith("eval-")) process.exit(1);
  if (prompt.includes("alpha")) console.log("Brain:\\n- 09_wiki/thema_alpha.md — Alpha");
  else if (prompt.includes("beta")) console.log("Brain:\\n- 09_wiki/thema_falsch.md — Falsch");
  else if (prompt.includes("laut")) console.log("Brain:\\n- 09_wiki/thema_x.md — X");
});
`);
const KIT = join(ORT, "hint-eval.json");
writeFileSync(KIT, JSON.stringify({
  ziel: { positiv: 1, still: 1, p95ms: 60000, kontrolle_still: 0 },
  positiv: [{ prompt: "was ist alpha", erwartet: ["thema_alpha.md"] }, { prompt: "was ist beta", erwartet: ["thema_beta.md"] }, { prompt: 42 }],
  negativ: ["wie spät ist es", "sag mal laut hallo"],
  kontrolle_negativ: ["mach einen commit"],
}));
const HOLD = join(ORT, "holdout.json");
writeFileSync(HOLD, JSON.stringify({ positiv: [{ prompt: "alpha nochmal", erwartet: ["thema_alpha.md"] }], negativ: ["laut"] }));

function neuerVault(eigene) {
  const v = join(mkdtempSync(join(tmpdir(), "brain messlatte ")), "Mein Brain ü");
  mkdirSync(join(v, "09_wiki"), { recursive: true });
  if (eigene) writeFileSync(join(v, "09_wiki", "_messlatte.json"), JSON.stringify(eigene));
  return v;
}
const lauf = (v, o = {}) => messlatte(v, { hook: HOOK, fragenDatei: KIT, holdoutDatei: HOLD, jetzt: new Date(Date.UTC(2026, 9, 3, 12)), ...o });

test("ladeFragen: Kit + eigene Fragen zusammengeführt, ungültige verworfen, eigenes Ziel überlagert", () => {
  const v = neuerVault({ positiv: [{ prompt: "alpha eigen", erwartet: ["thema_alpha.md"] }, { prompt: "", erwartet: ["x.md"] }], negativ: ["still eigen", 7], ziel: { still: 3 } });
  const f = ladeFragen(v, { fragenDatei: KIT, holdoutDatei: HOLD });
  assert.deepEqual(f.positiv.map(c => c.prompt), ["was ist alpha", "was ist beta", "alpha eigen"]);
  assert.deepEqual(f.negativ, ["wie spät ist es", "sag mal laut hallo", "still eigen"]);
  assert.deepEqual(f.kontrolle, ["mach einen commit"]);
  assert.equal(f.ziel.still, 3);
  assert.equal(f.ziel.positiv, 1);
});

test("messlatte: zählt Treffer/still/Kontrolle/Holdout, hängt die Zeile an hint-eval.log an, Analyse liest sie", () => {
  const v = neuerVault();
  const e = lauf(v);
  assert.equal(e.positiv, "1/2");
  assert.equal(e.still, "1/2");
  assert.equal(e.kontrolle, "1/1");
  assert.equal(e.holdout, "1/2");
  assert.equal(e.datum, "2026-10-03");
  assert.equal(e.ok, true);
  assert.match(e.zeile, /^hint-eval 2026-10-03 positiv=1\/2 still=1\/2 kontrolle=1\/1 holdout=1\/2 p95ms=\d+ ok=1$/);
  const log = readFileSync(join(v, ".logs", "hint-eval.log"), "utf8");
  assert.equal(log, e.zeile + "\n");
  const verlauf = analyse(v).messlatte.verlauf;
  assert.equal(verlauf.length, 1);
  assert.equal(verlauf[0].positiv, "1/2");
  // zweiter Lauf: angehängt, nicht überschrieben (auch wenn die Datei ohne Zeilenende endete)
  writeFileSync(join(v, ".logs", "hint-eval.log"), log.trimEnd());
  lauf(v);
  assert.equal(readFileSync(join(v, ".logs", "hint-eval.log"), "utf8").split("\n").filter(Boolean).length, 2);
});

test("messlatte: Ziel verfehlt → ok=false (still unter Ziel aus eigener _messlatte.json)", () => {
  const v = neuerVault({ negativ: ["noch was lautes"], ziel: { still: 3 } });
  const e = lauf(v);
  assert.equal(e.still, "1/3");
  assert.equal(e.ok, false);
  assert.match(readFileSync(join(v, ".logs", "hint-eval.log"), "utf8"), / ok=0\n$/);
});

test("messlatte: keine Fragen → Fehler 400, nichts geschrieben", () => {
  const v = neuerVault();
  const leer = join(ORT, "leer.json");
  writeFileSync(leer, "{}");
  assert.throws(() => lauf(v, { fragenDatei: leer, holdoutDatei: join(ORT, "fehlt.json") }), (e) => e.code === 400 && /_messlatte\.json/.test(e.message));
  assert.throws(() => readFileSync(join(v, ".logs", "hint-eval.log")));
});

test("messlatte: Hook stürzt ab → zählt als still/verfehlt, kein Absturz", () => {
  const v = neuerVault();
  const kaputt = join(ORT, "kaputt.mjs");
  writeFileSync(kaputt, "process.exit(3);\n");
  const e = lauf(v, { hook: kaputt });
  assert.equal(e.positiv, "0/2");
  assert.equal(e.still, "2/2");
});
