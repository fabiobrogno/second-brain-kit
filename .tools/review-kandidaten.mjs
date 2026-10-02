#!/usr/bin/env node
// /brain-review-Helfer (deterministisch, 0 Tokens): welche Wiki-Seiten hat sich das LLM anzusehen?
// Geänderte Seiten seit letztem Review (Marker .logs/letzter-review, sonst 30 Tage) + verlinkte Nachbarn (max 10),
// Rückmeldungen aus feedback.log und die Zahl der Hinweis-Anfragen ohne Treffer (hint.log hat keinen Prompt-Text).
import { readFileSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { istWikiSeite } from "./wiki-pfade.mjs";
import { vaultPfad, ladeConfig, ordner } from "./pfade.mjs";
import { gitBefehl } from "./werkzeug.mjs";

const vault = vaultPfad();
const cfg = ladeConfig(vault);
const marker = join(vault, ".logs", "letzter-review");
const seitMs = existsSync(marker) ? statSync(marker).mtimeMs : Date.now() - 30 * 86400000;
// hint.log schreibt UTC (toISOString), feedback.log Ortszeit (date "+%FT%T") → je Quelle eigener Vergleich
const seit = new Date(seitMs).toISOString().slice(0, 19);
const d = new Date(seitMs), zz = (n) => String(n).padStart(2, "0");
const seitLokal = `${d.getFullYear()}-${zz(d.getMonth() + 1)}-${zz(d.getDate())}T${zz(d.getHours())}:${zz(d.getMinutes())}:${zz(d.getSeconds())}`;
const wiki = ordner(vault, cfg).wiki;
let geaendert = [];
try {
  geaendert = execFileSync(gitBefehl({ cfg }), ["-C", vault, "log", `--since=@${Math.floor(seitMs / 1000)}`, "--name-only", "--format=", "--", wiki], { encoding: "utf8", windowsHide: true })
    .split("\n").filter(p => p && istWikiSeite(p, wiki) && existsSync(join(vault, p)));
} catch {}
const seiten = [...new Set(geaendert)].sort();
let nachbarn = [];
try {
  const g = JSON.parse(readFileSync(join(vault, "graph.json"), "utf8"));
  const set = new Set(seiten), n = new Set();
  for (const e of g.edges) { const s = e.source.split("\\").join("/"), t = e.target.split("\\").join("/");
    if (set.has(s) && istWikiSeite(t, wiki) && !set.has(t)) n.add(t);
    if (set.has(t) && istWikiSeite(s, wiki) && !set.has(s)) n.add(s); }
  nachbarn = [...n].sort().slice(0, 10);
} catch {}
const zeilenSeit = (f, ab) => { try { return readFileSync(join(vault, ".logs", f), "utf8").split("\n").filter(z => z && z.slice(0, 19) > ab); } catch { return []; } };
const feedback = zeilenSeit("feedback.log", seitLokal);
const hinweisOhneTreffer = zeilenSeit("hint.log", seit).filter(z => / hits=- /.test(z)).length;
console.log(JSON.stringify({ seit, seiten, nachbarn, feedback, hinweisOhneTreffer }, null, 2));
