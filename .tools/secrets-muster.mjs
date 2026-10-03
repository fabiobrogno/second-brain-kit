#!/usr/bin/env node
// .tools/secrets-muster.mjs — Credential-Muster (Basis: Memory-Blueprint-Spec 2026-07-29). Einzige Quelle.
// Modul-Export für commit-pruefung.mjs, publish-check, Ernte, Vorschläge, Lücken, Import UND CLI (ersetzt
// secrets-check.sh): node secrets-muster.mjs <datei> → Exit 0 sauber, Exit 3 Fund.
// Meldet NUR Fundstellen (Datei/Zeile), NIE den getroffenen Text.
import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Füllwörter, die nach „Passwort ist …“ KEIN Wert sind („das Passwort ist leer/zu kurz/im Tresor“).
const KEIN_WERT = "leer|falsch|richtig|korrekt|gesetzt|geändert|abgelaufen|ungültig|unbekannt|vergeben|gespeichert|hinterlegt|"
  + "sicher|neu|alt|zu|nicht|noch|nur|im|in|bei|beim|der|die|das|dem|den|des|ein|eine|einer|einem|kein|keine|mein|dein|sein|"
  + "jetzt|wieder|schon|auch|so|sehr|optional|erforderlich|pflicht|empty|wrong|correct|set|not|too|the|a|an|invalid|required|"
  + "expired|stored|missing";
// Einzelne Teilmuster — jedes für sich getestet (test-secrets-muster.mjs).
export const SECRET_TEILMUSTER = [
  // Schlüssel = Wert (alt, unverändert)
  /authorization\s*:\s*\S+/,
  /bearer\s+\S+/,
  /(api[_-]?key|token|secret|passwo?r?d|pwd)\s*[=:]\s*\S+/,
  /--password[= ]\S+/,
  // Verbindungsadressen mit Nutzer und Passwort vor dem @ (beliebiges Schema)
  /(mongodb(\+srv)?|postgres(ql)?|mysql|redis|amqp):\/\/\S+/,
  /\b[a-z][a-z0-9+.-]*:\/\/[^\s:\/@]+:[^\s\/@]+@/,
  // Passwort/Kennwort in Alltagssprache (lautet / ist / is / Doppelpunkt, gefolgt von einem Wert)
  new RegExp(`(passw(?:or)?[td]|kennwort)\\s*(?:[=:]|\\blautet\\b\\s*:?|\\b(?:ist|is)\\b\\s*:?)\\s*(?!(?:${KEIN_WERT})(?![\\p{L}\\p{N}]))[^\\s.,;]{3,}`, "u"),
  /\bpin\s*[=:]\s*\d{4,}/,
  // Nutzer und Passwort auf der Befehlszeile (curl mit -u oder --user) und Schlüssel-Header (-H mit Key im Namen)
  /(?:^|\s)(?:-u\s*|--user[ =])[^\s:'"]+:\S+/,
  /-H\s+['"]?[\w-]*(?:key|token|auth)[\w-]*\s*:/,
  // Bekannte Schlüssel-Präfixe (auch nackt, ohne key=)
  /\bsk-ant-[A-Za-z0-9_-]{8,}/,
  /\bsk-(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9_-]{20,}/,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/,
  /\bAIza[0-9A-Za-z_-]{35}/,
  /\bglpat-[A-Za-z0-9_-]{20,}/,
  /\bshp(at|ss|ca|pa)_[a-fA-F0-9]{32}/,
  /\bPMAK-[a-fA-F0-9]{24}-[a-fA-F0-9]{34}/,
  // JWT (Kopf.Nutzlast.Signatur)
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/,
  // Kopfzeile eines privaten Schlüssels (der ganze Block wird in zeilenMitSecrets erfasst)
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY( BLOCK)?-----/,
];
const PEM_ANFANG = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY( BLOCK)?-----/;
const PEM_ENDE = /-----END [A-Z0-9 ]*PRIVATE KEY( BLOCK)?-----/;

// Eine Regex aus allen Teilmustern (zeilenweise; publish-check und Altnutzer verwenden sie direkt).
export const SECRET_MUSTER = new RegExp(SECRET_TEILMUSTER.map(r => `(?:${r.source})`).join("|"), "iu");

// Indizes (0-basiert) aller Zeilen mit Zugangsdaten — ein privater Schlüssel zählt als GANZER Block
// (BEGIN bis END; fehlt END, bis zum Textende), nicht nur seine Kopfzeile.
export function zeilenMitSecrets(text) {
  const zeilen = String(text ?? "").split(/\r?\n/);
  const treffer = new Set();
  let imBlock = false;
  zeilen.forEach((z, i) => {
    if (imBlock) { treffer.add(i); if (PEM_ENDE.test(z)) imBlock = false; return; }
    if (PEM_ANFANG.test(z)) { treffer.add(i); imBlock = !PEM_ENDE.test(z); return; }
    if (SECRET_MUSTER.test(z)) treffer.add(i);
  });
  return { zeilen, treffer };
}

// Höchstens 5 Fundstellen { zeile (1-basiert), text } — ein PEM-Block zählt einmal (Kopfzeile).
export function findeSecrets(text) {
  const out = [];
  const s = String(text ?? "");
  let imBlock = false;
  s.split(/\r?\n/).forEach((z, i) => {
    if (imBlock) { if (PEM_ENDE.test(z)) imBlock = false; return; }
    if (PEM_ANFANG.test(z)) { imBlock = !PEM_ENDE.test(z); if (out.length < 5) out.push({ zeile: i + 1, text: z }); return; }
    if (out.length < 5 && SECRET_MUSTER.test(z)) out.push({ zeile: i + 1, text: z });
  });
  return out;
}

// Zugangsdaten auch über Zeilengrenzen hinweg (Schlüsselwort am Zeilenende, Wert in der Folgezeile): roh
// zeilenweise UND mit zusammengezogenem Leerraum geprüft (wie entscheidungen.mjs bei der Notiz). → true, wenn irgendwo etwas anschlägt.
export function hatSecretsImKontext(text) {
  const s = String(text ?? "");
  return findeSecrets(s).length > 0 || findeSecrets(s.replace(/\s+/g, " ")).length > 0;
}

// Text ohne jede Zeile mit Zugangsdaten (ganze PEM-Blöcke fallen weg). Zeilenenden → "\n".
export function ohneSecrets(text) {
  const { zeilen, treffer } = zeilenMitSecrets(text);
  return zeilen.filter((_, i) => !treffer.has(i)).join("\n");
}

const selbst = fileURLToPath(import.meta.url);
let aufruf = "";
try { aufruf = realpathSync(process.argv[1] || ""); } catch {}
if (aufruf === realpathSync(selbst)) {
  const f = findeSecrets(readFileSync(process.argv[2], "utf8"));
  if (f.length) { console.log("SECRETS GEFUNDEN:"); f.forEach(t => console.log(`Zeile ${t.zeile}`)); process.exit(3); }
}
