#!/usr/bin/env node
// .tools/secrets-muster.mjs — Credential-Muster (Basis: Memory-Blueprint-Spec 2026-07-29). Einzige Quelle.
// Modul-Export für commit-pruefung.mjs UND CLI (ersetzt secrets-check.sh): node secrets-muster.mjs <datei> → Exit 0 sauber, Exit 3 Fund.
// Meldet NUR Fundstellen (Datei/Zeile), NIE den getroffenen Text.
import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const SECRET_MUSTER = /(authorization\s*:\s*\S+|bearer\s+\S+|(api[_-]?key|token|secret|passwo?r?d|pwd)\s*[=:]\s*\S+|--password[= ]\S+|(mongodb(\+srv)?|postgres(ql)?|mysql|redis|amqp):\/\/\S+|https?:\/\/[^\/\s:]+:[^@\s]+@\S*)/i;

export function findeSecrets(text) {
  const out = [];
  text.split("\n").forEach((z, i) => { if (out.length < 5 && SECRET_MUSTER.test(z)) out.push({ zeile: i + 1, text: z }); });
  return out;
}

const selbst = fileURLToPath(import.meta.url);
let aufruf = "";
try { aufruf = realpathSync(process.argv[1] || ""); } catch {}
if (aufruf === realpathSync(selbst)) {
  const f = findeSecrets(readFileSync(process.argv[2], "utf8"));
  if (f.length) { console.log("SECRETS GEFUNDEN:"); f.forEach(t => console.log(`Zeile ${t.zeile}`)); process.exit(3); }
}
