// .tools/tests/test-plattform.mjs — Regeln, die auf allen drei Systemen gelten müssen
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, mkdtempSync, writeFileSync, mkdirSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { neuerAls } from "../neuer-als.mjs";
const T = fileURLToPath(new URL("..", import.meta.url));

function alleMjs(dir) {
  let out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules") continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) out = out.concat(alleMjs(full));
    else if (e.name.endsWith(".mjs")) out.push(full);
  }
  return out;
}

test("keine Laufzeit-Shell-Skripte mehr in .tools (außer Komfort-Wrapper search.sh)", () => {
  assert.deepEqual(readdirSync(T).filter(f => f.endsWith(".sh") && f !== "search.sh"), []);
});
test("kein Shell-String-Aufruf (execSync) und kein per process.env gelesenes HOME (os.homedir() nutzen) in .mjs — rekursiv, node_modules ausgenommen", () => {
  for (const f of alleMjs(T)) {
    const rel = f.slice(T.length);
    const c = readFileSync(f, "utf8");
    assert.doesNotMatch(c, /\bexecSync\(/, `${rel}: execFileSync mit Argument-Array nutzen`);
    assert.doesNotMatch(c, /process\.env\.HOME\b/, `${rel}: os.homedir() nutzen`);
  }
});
test("neuerAls findet geänderte Notiz, ignoriert .git, Pfad mit Leerzeichen und Umlaut", () => {
  const v = join(mkdtempSync(join(tmpdir(), "Jörg Müller ")), "Brain"); mkdirSync(join(v, ".git"), { recursive: true });
  const st = join(v, "stempel"); writeFileSync(st, ""); const alt = new Date(Date.now() - 60000); utimesSync(st, alt, alt);
  writeFileSync(join(v, ".git", "x.md"), "#"); assert.equal(neuerAls(v, st), false);
  writeFileSync(join(v, "notiz.md"), "#"); assert.equal(neuerAls(v, st), true);
});
test("jeder spawn/spawnSync/execFileSync-Aufruf in Laufzeit-.mjs setzt windowsHide (kein aufblitzendes Konsolenfenster unter Windows)", () => {
  const laufzeit = alleMjs(T).filter(f => !f.slice(T.length).split(/[\\/]/).includes("tests"));
  const fehlt = [];
  for (const f of laufzeit) {
    const c = readFileSync(f, "utf8");
    const re = /\b(spawn|spawnSync|execFileSync|execFile)\(/g; let m;
    while ((m = re.exec(c))) {
      let i = m.index + m[0].length, tiefe = 1;
      while (i < c.length && tiefe) { if (c[i] === "(") tiefe++; else if (c[i] === ")") tiefe--; i++; }
      const aufruf = c.slice(m.index, i);
      if (/windowsHide/.test(aufruf)) continue;
      // Optionen als benannte Konstante (z. B. GIT_OPTS): deren Definition muss windowsHide tragen
      const name = (aufruf.match(/,\s*([A-Za-z_]\w*)\s*\)$/) || [])[1];
      if (name && new RegExp(`const ${name} = \\{[^}]*windowsHide`).test(c)) continue;
      fehlt.push(`${f.slice(T.length)}:${c.slice(0, m.index).split("\n").length}`);
    }
  }
  assert.deepEqual(fehlt, []);
});
test("kein literales \"git\" als erstes Argument von execFileSync/spawnSync/spawn in Laufzeit-.mjs (gitBefehl() aus werkzeug.mjs nutzen)", () => {
  // Ausnahme kit/repo/lib/voraussetzungen.mjs: echtHabeGit() prüft bewusst das nackte PATH-git, BEVOR es
  // überhaupt einen bekannten Werkzeug-Ort/eine Config gibt (siehe Kommentar dort) — und die Datei liegt
  // in der Kit-Baustelle, die nach dem Export an einem anderen relativen Ort als ihre Quelle landet, ein
  // statischer Import von werkzeug.mjs könnte also nicht an beiden Orten stimmen.
  const AUSNAHME = new Set(["kit/repo/lib/voraussetzungen.mjs"]);
  const laufzeit = alleMjs(T).filter(f => !f.slice(T.length).split(/[\\/]/).includes("tests"));
  const fehlt = [];
  for (const f of laufzeit) {
    const rel = f.slice(T.length).replace(/^[\\/]/, "").split(/[\\/]/).join("/");
    if (AUSNAHME.has(rel)) continue;
    const c = readFileSync(f, "utf8");
    if (/\b(spawn|spawnSync|execFileSync|execFile)\(\s*"git"/.test(c)) fehlt.push(rel);
  }
  assert.deepEqual(fehlt, []);
});
