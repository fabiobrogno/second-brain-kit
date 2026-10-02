import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { vaultPfad, ordner, renderVorlage, istQuellVault, nodeBefehl, nodePfad, gitAnzeige, ladeConfig, configFehler, liesConfigRoh, entferneBom } from "../pfade.mjs";
import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { isAbsolute } from "node:path";

const neu = () => { const v = join(mkdtempSync(join(tmpdir(), "brain pfad ")), "Mein Brain"); mkdirSync(v); return v; };

test("Defaults = heutige Ordnernamen", () => {
  const v = neu(); writeFileSync(join(v, "brain.config.json"), "{}");
  assert.deepEqual(ordner(v), { inbox: "00_inbox", wiki: "09_wiki", archiv: "90_archiv" });
});
test("Config überschreibt Ordnernamen, alter Schlüssel wiki.ordner gilt weiter", () => {
  const v = neu();
  writeFileSync(join(v, "brain.config.json"), JSON.stringify({ ordner: { inbox: "inbox", archiv: "archiv" }, wiki: { ordner: "wiki" } }));
  assert.deepEqual(ordner(v), { inbox: "inbox", wiki: "wiki", archiv: "archiv" });
});
test("Vault: Argument vor BRAIN_VAULT vor dem Vault, in dem .tools liegt (nie fest ~/brain)", () => {
  process.env.BRAIN_VAULT = "/x/env";
  assert.equal(vaultPfad(["node", "s", "/x/arg"]), "/x/arg");
  assert.equal(vaultPfad(["node", "s", "--flag"]), "/x/env");
  delete process.env.BRAIN_VAULT;
  assert.equal(vaultPfad(["node", "s"]), fileURLToPath(new URL("../..", import.meta.url)).replace(/[\\/]$/, ""));
});
test("renderVorlage: absoluter, gequoteter Node-Pfad, Ordnernamen inkl. ARCHIV, keine Platzhalter übrig", () => {
  const v = neu(); writeFileSync(join(v, "brain.config.json"), JSON.stringify({ ordner: { archiv: "ablage" } }));
  const r = renderVorlage("{{NODE}} \"{{VAULT}}/.tools/brain.mjs\" · {{ARCHIV}} · {{GIT}} · {{INBOX}} · {{WIKI}}", v);
  assert.ok(r.startsWith(`${nodeBefehl()} `), r);
  assert.equal(realpathSync(nodePfad()), realpathSync(process.execPath));
  assert.ok(isAbsolute(nodePfad()));
  assert.match(r, / · ablage · /);
  assert.doesNotMatch(r, /\{\{/);
});
test("renderVorlage: {{GIT}} bevorzugt werkzeuge.git aus der Vault-Config vor dem PATH-Rückfall (Fix round 1)", () => {
  const v = neu();
  writeFileSync(join(v, "brain.config.json"), JSON.stringify({ werkzeuge: { git: "/ein/privater/git" } }));
  const r = renderVorlage("{{GIT}}", v);
  assert.equal(r, `"/ein/privater/git"`);
});
test("gitAnzeige: ohne Config fällt auf den bisherigen Rückfall zurück (win32-MinGit-Ort bzw. nacktes 'git')", () => {
  const home = mkdtempSync(join(tmpdir(), "pfad-git-"));
  assert.equal(gitAnzeige({ cfg: {}, plattform: "darwin", home }), "git");
  mkdirSync(join(home, ".brain-kit", "git", "cmd"), { recursive: true });
  writeFileSync(join(home, ".brain-kit", "git", "cmd", "git.exe"), "");
  // Anzeige-Strings tragen immer "/" (auch unter Windows), darum hier ebenso
  assert.equal(gitAnzeige({ cfg: {}, plattform: "win32", home }), `"${join(home, ".brain-kit", "git", "cmd", "git.exe").split("\\").join("/")}"`);
  // Config geht auch hier vor
  assert.equal(gitAnzeige({ cfg: { werkzeuge: { git: "/x/git" } }, plattform: "win32", home }), `"/x/git"`);
});
test("istQuellVault: nur mit .tools/kit/export.mjs", () => {
  const v = neu(); assert.equal(istQuellVault(v), false);
  mkdirSync(join(v, ".tools", "kit"), { recursive: true }); writeFileSync(join(v, ".tools", "kit", "export.mjs"), "");
  assert.equal(istQuellVault(v), true);
});

test("Review-Fund 7 (BOM in brain.config.json): ladeConfig/configFehler tolerieren ein UTF-8-BOM", () => {
  const v = neu();
  writeFileSync(join(v, "brain.config.json"), "﻿" + JSON.stringify({ zebra: 1 }));
  assert.deepEqual(ladeConfig(v), { zebra: 1 });
  assert.equal(configFehler(v), null);
});

test("liesConfigRoh: fehlende Datei → stand '0', text null, cfg {}, kein Fehler", () => {
  const v = neu();
  assert.deepEqual(liesConfigRoh(v), { stand: "0", text: null, cfg: {}, fehler: null });
});

test("liesConfigRoh: stand ist SHA-256 der rohen Bytes (BOM inklusive, vor der Bereinigung), text/cfg sind BOM-frei", () => {
  const v = neu();
  const roh = "﻿" + JSON.stringify({ zebra: 1 }, null, 2) + "\n";
  writeFileSync(join(v, "brain.config.json"), roh);
  const r = liesConfigRoh(v);
  assert.equal(r.stand, createHash("sha256").update(Buffer.from(roh, "utf8")).digest("hex"));
  assert.equal(r.text, entferneBom(roh));
  assert.deepEqual(r.cfg, { zebra: 1 });
  assert.equal(r.fehler, null);
});

test("liesConfigRoh: kaputtes JSON → fehler gesetzt, cfg null, stand trotzdem berechnet (optimistisches Sperren bleibt möglich)", () => {
  const v = neu();
  writeFileSync(join(v, "brain.config.json"), "{ kaputt");
  const r = liesConfigRoh(v);
  assert.ok(r.fehler);
  assert.equal(r.cfg, null);
  assert.match(r.stand, /^[0-9a-f]{64}$/);
});
