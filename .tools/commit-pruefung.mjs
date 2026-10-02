#!/usr/bin/env node
// Commit-Prüfung (pre-commit): prüft den GESTAGTEN Stand, nicht den Arbeitsbaum (halbfertige Arbeit anderer Sessions),
// und blockiert nur NEUE Befunde gegenüber HEAD. Dazu: REV (Inhalt/Quellen geändert ohne rev+1) und _log-Reihenfolge
// nach Position (append-only). Unit-Tests nur, wenn Werkzeug-Code gestagt ist. Exit 0 ok · 2 blockiert.
// Secrets-Prüfung läuft ZUERST und schließt bei eigenem Defekt (fail closed): lieber ein blockierter Commit
// als ein durchgerutschtes Credential. Die übrigen Prüfungen bleiben bei eigenem Defekt durchlässig.
// Nutzung: node commit-pruefung.mjs [vault]
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, existsSync, rmSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { istWikiSeite } from "./wiki-pfade.mjs";
import { ladeConfig, ordner, entferneBom } from "./pfade.mjs";
import { gitBefehl } from "./werkzeug.mjs";
import { findeSecrets } from "./secrets-muster.mjs";

// Vault noch unbekannt → noch keine Config zum Laden; gitBefehl() fällt ohne cfg auf den MinGit-Ort bzw. "git" zurück.
const vault = process.argv[2] || execFileSync(gitBefehl(), ["rev-parse", "--show-toplevel"], { encoding: "utf8", windowsHide: true }).trim();
const cfg = ladeConfig(vault);
const GIT = gitBefehl({ cfg });
const git = (...a) => execFileSync(GIT, ["-C", vault, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], windowsHide: true, maxBuffer: 256 * 1024 * 1024 });
const { wiki, archiv } = ordner(vault, cfg);
const blockiert = [], hinweise = [];

// 0) Secrets (zuerst, eigener try, fail closed): JEDE gestagte Datei außerhalb .tools/tests/ — egal welche
// Endung (.env, .csv, ohne Endung …), nur echte Binärdateien (NUL in den ersten 8000 Bytes) nicht. Gelesen
// wird der gestagte Blob (:pfad), nie der Arbeitsbaum. Gemeldet wird nur die Fundstelle, nie der Inhalt.
try {
  const namen = git("diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z").split("\0").filter(Boolean);
  for (const f of namen) {
    if (/^\.tools\/tests\//.test(f)) continue;
    const blob = execFileSync(GIT, ["-C", vault, "cat-file", "blob", `:${f}`], { stdio: ["ignore", "pipe", "ignore"], windowsHide: true, maxBuffer: 256 * 1024 * 1024 });
    if (blob.subarray(0, 8000).includes(0)) continue;
    for (const t of findeSecrets(blob.toString("utf8"))) blockiert.push(`SECRETS: ${f} Zeile ${t.zeile} — Credential-Muster; Wert entfernen, nur den Speicherort nennen. Falls das kein echtes Secret ist: umformulieren, z. B. ‚Token liegt im Passwort-Manager‘ statt den Wert auszuschreiben.`);
  }
} catch (e) {
  console.log("Brain-Commit blockiert: Die Sicherheitsprüfung auf Passwörter und Schlüssel konnte nicht laufen — bitte erneut versuchen oder deiner KI Bescheid sagen.");
  process.exit(2);
}
const tmp = mkdtempSync(join(tmpdir(), "brain-commit-"));
const S = join(tmp, "s"), H = join(tmp, "h");

try {
  // Schnappschüsse: gestagt (Index) und HEAD — ohne Shell-String (execFileSync mit Argument-Array, kein mkdir/tar)
  execFileSync(GIT, ["-C", vault, "checkout-index", "-a", `--prefix=${S.split("\\").join("/")}/`], { windowsHide: true });
  let hatHead = true;
  try { git("rev-parse", "--verify", "HEAD"); } catch { hatHead = false; }
  if (hatHead) {
    mkdirSync(H, { recursive: true });
    const env = { ...process.env, GIT_INDEX_FILE: join(tmp, "head.index") };
    execFileSync(GIT, ["-C", vault, "read-tree", "HEAD"], { env, windowsHide: true });
    execFileSync(GIT, ["-C", vault, "checkout-index", "-a", `--prefix=${H.split("\\").join("/")}/`], { env, windowsHide: true });
  }

  // 1) Struktur-Lint: nur Befunde, die HEAD noch nicht hatte (Altlasten blockieren fremde Commits nicht)
  // Gestagte Änderungen (-z: Pfade mit Umlauten/Leerzeichen kommen ungequotet; R/C tragen zwei Pfade)
  const roh = git("diff", "--cached", "--name-status", "-M", "-z").split("\0").filter(Boolean);
  const status = [];
  for (let i = 0; i < roh.length;) { const art = roh[i++]; const n = /^[RC]/.test(art) ? 2 : 1; status.push([art, ...roh.slice(i, i + n)]); i += n; }
  const gestagt = status.map(s => s[s.length - 1]);

  const lint = (dir) => { if (!existsSync(join(dir, "brain.config.json"))) return [];
    const l = join(S, ".tools", "brain-lint.mjs");
    try { execFileSync(process.execPath, [l, dir, "--struktur"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], windowsHide: true }); return []; }
    catch (e) { if (e.status !== 2) { hinweise.push(`Struktur-Lint abgestürzt (${e.status ?? e.code}) — ungeprüft`); return []; }
      return String(e.stdout || "").split("\n").filter(Boolean); } };
  // Altlasten: HEAD-Befunde mit auf neue Pfade umgeschriebenen Seitennamen (reine Umbenennung bringt nichts Neues)
  const umbenannt = status.filter(s => s[0][0] === "R").map(s => [s[1].slice(wiki.length + 1), s[2].slice(wiki.length + 1)]);
  const alt = new Set((hatHead ? lint(H) : []).map(z => umbenannt.reduce((x, [von, nach]) => x.split(von).join(nach), z)));
  for (const z of lint(S)) if (!alt.has(z)) blockiert.push(z.replace(/^- /, ""));

  // 2) REV: Body oder quellen/quellen_sha geändert, rev nicht erhöht (Umbenennung/auch/name/description frei)
  const teile = (roh) => { const raw = entferneBom(String(roh)).replace(/\r\n/g, "\n"); const m = raw.match(/^---\n([\s\S]*?)\n---\n?/); const fm = m ? m[1] : "";
    const feld = (k) => (fm.match(new RegExp(`^${k}:\\s*(.*)$`, "m")) || [, ""])[1].trim();
    return { body: (m ? raw.slice(m[0].length) : raw).trim(), quellen: feld("quellen"), sha: feld("quellen_sha"), rev: Number(feld("rev")) || 0 }; };
  for (const s of status) {
    const art = s[0][0], neu = s[s.length - 1], altPfad = art === "R" ? s[1] : neu;
    if (!["M", "R"].includes(art) || !istWikiSeite(neu, wiki)) continue;
    let a; try { a = teile(git("show", `HEAD:${altPfad}`)); } catch { continue; }
    const n = teile(readFileSync(join(S, neu), "utf8"));
    const geaendert = a.body !== n.body || a.quellen !== n.quellen || a.sha !== n.sha;
    if (geaendert && n.rev <= a.rev) blockiert.push(`REV: ${neu.slice(wiki.length + 1)} — Inhalt oder Quellen geändert, rev nicht erhöht (${a.rev} → ${n.rev}; Schema: Beweisbindung)`);
  }

  // 3) _log.md nach Position: Bestand unverändert und in gleicher Reihenfolge, neue Einträge zusammenhängend oben
  const logPfad = `${wiki}/_log.md`;
  if (gestagt.includes(logPfad) && hatHead && existsSync(join(H, logPfad))) {
    const eintraege = (raw) => { const bl = String(raw).replace(/\r\n/g, "\n").split(/\n(?=## \d{4}-\d{2}-\d{2})/); bl.shift(); return bl.map(b => b.trim()); };
    const a = eintraege(readFileSync(join(H, logPfad), "utf8")), n = eintraege(readFileSync(join(S, logPfad), "utf8"));
    const altSet = new Set(a);
    const neuIdx = n.map((b, i) => altSet.has(b) ? -1 : i).filter(i => i >= 0);
    const bestand = n.filter(b => altSet.has(b));
    // Archivieren (LOG-LANG): älteste Einträge fallen am Ende weg und stehen in einem gestagten <archiv>/ingest-log-*.md
    const archivRegex = new RegExp(`^${archiv.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\/ingest-log-.*\\.md$`);
    const archivInhalt = gestagt.filter(f => archivRegex.test(f)).map(f => { try { return readFileSync(join(S, f), "utf8").replace(/\r\n/g, "\n"); } catch { return ""; } }).join("\n");
    const archiviert = bestand.length < a.length && bestand.every((b, i) => b === a[i]) && a.slice(bestand.length).every(b => archivInhalt.includes(b));
    if (!archiviert && (bestand.length !== a.length || bestand.some((b, i) => b !== a[i]))) blockiert.push("LOG-BESTAND: bestehende _log-Einträge verändert, gelöscht oder umsortiert — _log.md ist append-only");
    else if (neuIdx.some((idx, k) => idx !== k)) blockiert.push(`LOG-REIHENFOLGE: neuer Eintrag „${n[neuIdx.find((idx, k) => idx !== k)].split("\n")[0]}" steht nicht oben — direkt unter die Formatvorlage (neuester oben)`);
    for (const i of neuIdx) { const m = n[i].match(/^## (\d{4}-\d{2}-\d{2})(?: (\d{2}:\d{2}))?/);
      if (m) { const t = new Date(`${m[1]}T${m[2] || "00:00"}:00`).getTime(); if (Math.abs(Date.now() - t) > 30 * 60000) hinweise.push(`LOG-ZEIT: „${n[i].split("\n")[0]}" weicht > 30 min von jetzt ab — Zeit per \`brain jetzt\``); } }
  }

  // 4) Unit-Tests nur, wenn Werkzeug-Code gestagt ist (fremder .tools-Code blockiert keinen Ingest). 45 s: seit v0.3
  //    warten einige Tests auf losgelöste Prozesse (~8 s gesamt); ein Ingest-Commit ohne .tools-Code wartet nie.
  if (gestagt.some(f => /^\.tools\/.*\.mjs$/.test(f)) && existsSync(join(S, ".tools", "tests"))) {
    const unit = readdirSync(join(S, ".tools", "tests")).filter(f => /^test-.*\.mjs$/.test(f)).map(f => join(S, ".tools", "tests", f));
    // Ohne GIT_*: im Hook setzt git GIT_DIR/GIT_INDEX_FILE — ein Test mit eigenem Temp-Repo träfe sonst dieses Repo.
    const testEnv = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^GIT_/i.test(k)));
    try { execFileSync(process.execPath, ["--test", ...unit], { stdio: "ignore", timeout: 45000, windowsHide: true, env: testEnv }); }
    catch (e) { if (e.signal || e.code === "ETIMEDOUT") hinweise.push("Unit-Tests nicht in 45 s fertig — ungeprüft"); else blockiert.push("UNIT-TESTS: node --test .tools/tests/test-*.mjs schlägt fehl"); }
  }

  hinweise.forEach(h => console.log("Hinweis: " + h));
  if (blockiert.length) {
    console.log("Brain-Commit blockiert (pre-commit, gestagter Stand):");
    blockiert.forEach(b => console.log("- " + b));
    const wikiPrefix = new RegExp(`^${wiki.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/`);
    const betroffen = gestagt.filter(f => blockiert.some(b => b.includes(f.replace(wikiPrefix, "")) || (f.endsWith("_log.md") && b.startsWith("LOG"))));
    const liste = betroffen.length ? betroffen : gestagt;
    console.log(`Betroffene gestagte Dateien: ${liste.slice(0, 15).join(", ")}${liste.length > 15 ? ` … (+${liste.length - 15})` : ""}`);
    console.log(`→ Befund beheben (siehe ${wiki}/_schema.md) und erneut committen — Umgehen nur durch den User.`);
  }
} catch (e) {
  // Die Struktur-Prüfung selbst ist kaputt → nur deren Befunde nicht blockieren (lieber ein ungeprüfter Commit
  // als ein festgefahrener Ingest); Secrets-Befunde aus Schritt 0 bleiben bestehen.
  const secrets = blockiert.filter(b => b.startsWith("SECRETS:"));
  blockiert.length = 0; blockiert.push(...secrets);
  console.log(`Hinweis: Commit-Prüfung übersprungen (${e.code || e.message.split("\n")[0]})`);
  if (secrets.length) { console.log("Brain-Commit blockiert (pre-commit, gestagter Stand):"); secrets.forEach(b => console.log("- " + b)); }
} finally { rmSync(tmp, { recursive: true, force: true }); }
process.exit(blockiert.length ? 2 : 0);
