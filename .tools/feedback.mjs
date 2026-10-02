#!/usr/bin/env node
// /brain-feedback: Hinweis war falsch oder fehlte → eine Zeile ins lokale Log (speist Holdout-Kandidaten und /brain-review).
// Nutzung: node feedback.mjs <falsch|fehlte> [seite] [notiz...]
import { mkdirSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { vaultPfad } from "./pfade.mjs";

// Kein Vault-Positionsargument hier (anders als bei den Vault-Werkzeugen) — alle argv sind Feedback-Parameter.
const V = vaultPfad([]);
const argv = process.argv.slice(2);
const art = argv[0] || "";
if (!["falsch", "fehlte"].includes(art)) {
  process.stderr.write("Nutzung: feedback.mjs <falsch|fehlte> [seite] [notiz]\n");
  process.exit(1);
}
let seite = (argv[1] ?? "-").replace(/[^A-Za-z0-9_.-]/g, "");
seite = seite || "-";
const notiz = argv.slice(2).join(" ").replace(/[\n\r\t]/g, " ").slice(0, 200);

mkdirSync(join(V, ".logs"), { recursive: true });
const d = new Date();
const pad = (n) => String(n).padStart(2, "0");
const stempel = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
appendFileSync(join(V, ".logs", "feedback.log"), `${stempel} art=${art} seite=${seite} notiz=${notiz}\n`);
console.log("Feedback notiert.");
