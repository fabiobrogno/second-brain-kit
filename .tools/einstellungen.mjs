// .tools/einstellungen.mjs — Schema + Lesen/Schreiben von brain.config.json#automatik (Steuerzentrale,
// v0.3). Optimistisches Sperren über `stand` (= SHA-256-Hex der rohen Config-Bytes, aus liesConfigRoh in
// pfade.mjs — robuster als mtime, siehe dort): gleichzeitige Änderung durch Maske und KI → 409 statt
// stillem Überschreiben. Übrige Config-Abschnitte bleiben byte-genau erhalten (nur die Neuserialisierung
// ändert Formatierung). Nur Node-Standardbibliothek, keine Abhängigkeiten.
import { writeFileSync, renameSync, unlinkSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { liesConfigRoh } from "./pfade.mjs";

export const SCHEMA = {
  staendeIntervallStunden: { werte: [0, 1, 2, 4], standard: 0 },
  ernteSitzungsende:       { typ: "boolean", standard: false },
  ernteNichtIn:            { typ: "pfadliste", standard: [] },
  ichKarte:                { typ: "boolean", standard: false },
  projektAutomatik:        { typ: "boolean", standard: true },
  hinweise:                { werte: ["aus", "niedrig", "mittel", "hoch"], standard: "mittel" },
  liveAufleuchten:         { typ: "boolean", standard: true },
  updateHinweis:           { typ: "boolean", standard: true },
  sicherungTaeglich:       { typ: "boolean", standard: true },
  luecken:                 { typ: "boolean", standard: false },
  // v0.4 „Selbstpflege": Wochen-Zeile beim Sitzungsstart, Pflege-Lauf mit KI, Session-Auswerter (Lektionen).
  wochenbericht:           { typ: "boolean", standard: true },
  pflegeLauf:              { werte: ["aus", "woechentlich"], standard: "aus" },
  lektionen:               { werte: ["aus", "lokal", "mit-ki"], standard: "lokal" },
};
export const STANDARD = Object.fromEntries(Object.entries(SCHEMA).map(([k, s]) => [k, s.standard]));

// Deltas, NICHT absolute Schwellen (Ruling nach W1-Review: absolute Werte konnten je nach Config unter
// den Standard von "mittel" fallen und so "niedrig" MEHR statt weniger Hinweise zeigen lassen). Der
// Aufrufer addiert den Delta auf cfg.schwelle/cfg.rerankSchwelle (bzw. deren Standardwert, falls die
// Config nichts setzt): "niedrig" erhöht die Schwelle (strenger → nie mehr Hinweise als "mittel"), "hoch"
// senkt sie (lockerer → mehr Hinweise). "mittel" lässt die bestehenden Config-Werte unverändert; "aus"
// unterdrückt den Brain-Hinweis komplett (ausgewertet von den jeweiligen Aufrufern, nicht hier).
export const HINWEIS_SCHWELLEN = {
  niedrig: { schwelle: 0.08, rerankSchwelle: 0.08 },
  mittel: null,
  hoch: { schwelle: -0.06, rerankSchwelle: -0.07 },
};

const dateiPfad = (vault) => join(vault, "brain.config.json");
const fehlerMit = (code, meldung) => Object.assign(new Error(meldung), { code });
const standVon = (text) => createHash("sha256").update(Buffer.from(text, "utf8")).digest("hex");

function istGueltig(schema, wert) {
  if (schema.werte) return schema.werte.includes(wert);
  if (schema.typ === "boolean") return typeof wert === "boolean";
  if (schema.typ === "pfadliste") {
    return Array.isArray(wert) && wert.length <= 20 && wert.every(p => typeof p === "string" && p.length <= 300);
  }
  return false;
}

// STANDARD, überlagert von Altschlüsseln — nur `hinweis` (alter flacher String, Vorgänger von
// `automatik.hinweise`) wird übernommen, und nur solange `automatik.hinweise` fehlt; `update.auto` hat
// keine neue Entsprechung mehr und wird hier ignoriert —, überlagert von `cfg.automatik` (nur gültige
// Schema-Werte zählen, alles andere wird stillschweigend verworfen statt zu werfen: lesend nie crashen).
export function leseAutomatik(vault) {
  // GENAU EINMAL lesen (liesConfigRoh) statt Inhalt und Fehlerstatus getrennt neu einzulesen — vermeidet
  // das Zeitfenster aus Review-Fund 1 (dreifaches Lesen, dazwischen kann ein nicht-atomarer Schreiber die
  // Datei kurz kaputt/leer hinterlassen).
  const { cfg: geladen, stand, fehler } = liesConfigRoh(vault);
  const cfg = geladen || {};
  const werte = { ...STANDARD };
  const hatNeuenHinweisSchluessel = cfg.automatik && typeof cfg.automatik === "object" && "hinweise" in cfg.automatik;
  if (typeof cfg.hinweis === "string" && !hatNeuenHinweisSchluessel && istGueltig(SCHEMA.hinweise, cfg.hinweis)) {
    werte.hinweise = cfg.hinweis;
  }
  if (cfg.automatik && typeof cfg.automatik === "object" && !Array.isArray(cfg.automatik)) {
    for (const [k, schema] of Object.entries(SCHEMA)) {
      if (!(k in cfg.automatik)) continue;
      if (istGueltig(schema, cfg.automatik[k])) werte[k] = cfg.automatik[k];
    }
  }
  return { werte, stand, fehler };
}

// Prüft `neu` gegen SCHEMA (unbekannter Schlüssel/falscher Typ/Wert außerhalb der Liste → 400; ein Wert
// `null` ist immer erlaubt und bedeutet „Schlüssel entfernen, Rückfall auf Standard") — das kostet keinen
// Dateizugriff und läuft darum zuerst. Danach wird die Config GENAU EINMAL gelesen (liesConfigRoh: Bytes,
// `stand` als SHA-256 der Bytes und die geparste Config stammen aus demselben Snapshot — kein Zeitfenster
// mehr, in dem ein zweiter, nicht-atomarer Schreiber unbemerkt dazwischenfunken könnte, siehe Review-Fund
// 1): kaputtes JSON → 500 (ohne gültiges JSON kann nichts sicher geschrieben werden), veralteter `stand`
// → 409. Geschrieben wird ein ZUSAMMENGEFÜHRTER automatik-Abschnitt — `brain einstellungen k=v` (Task 12)
// schickt immer nur einzelne Schlüssel, ein voller Ersatz würde die übrigen stillschweigend auf STANDARD
// zurückwerfen: 1) den vorhandenen cfg.automatik auf gültige Schema-Schlüssel filtern (ungültige Altwerte
// verwerfen), 2) die geprüften neuen Werte darüberlegen (null entfernt den Schlüssel), 3) schreiben.
// Übrige Abschnitte bleiben byte-identisch bis auf die Neuserialisierung. Die Kopie nach
// .logs/config-vorher.json kommt aus genau demselben gelesenen Text (kein erneutes Lesen der Datei).
export function schreibeAutomatik(vault, neu, stand) {
  const datei = dateiPfad(vault);
  if (neu === null || typeof neu !== "object" || Array.isArray(neu)) {
    throw fehlerMit(400, "Einstellungen müssen ein Objekt sein.");
  }
  const geprueft = {};
  for (const [k, wert] of Object.entries(neu)) {
    const schema = Object.hasOwn(SCHEMA, k) ? SCHEMA[k] : undefined;
    if (!schema) throw fehlerMit(400, `Unbekannter Einstellungs-Schlüssel „${k}".`);
    if (wert === null) { geprueft[k] = null; continue; } // Löschen — keine Typprüfung nötig
    if (!istGueltig(schema, wert)) throw fehlerMit(400, `Ungültiger Wert für „${k}".`);
    geprueft[k] = wert;
  }
  const { stand: aktuellerStand, text, cfg: geladen, fehler } = liesConfigRoh(vault);
  if (fehler) throw fehlerMit(500, `Config beschädigt, nicht geschrieben: ${fehler}`);
  if (aktuellerStand !== String(stand)) {
    throw fehlerMit(409, "Die Einstellungen wurden zwischenzeitlich geändert — bitte neu laden.");
  }
  const cfg = geladen || {};
  const vorhanden = {};
  if (cfg.automatik && typeof cfg.automatik === "object" && !Array.isArray(cfg.automatik)) {
    for (const [k, schema] of Object.entries(SCHEMA)) {
      if (k in cfg.automatik && istGueltig(schema, cfg.automatik[k])) vorhanden[k] = cfg.automatik[k];
    }
  }
  const zusammengefuehrt = { ...vorhanden };
  for (const [k, wert] of Object.entries(geprueft)) {
    if (wert === null) delete zusammengefuehrt[k]; else zusammengefuehrt[k] = wert;
  }
  cfg.automatik = zusammengefuehrt;
  const inhalt = JSON.stringify(cfg, null, 2) + "\n";
  mkdirSync(join(vault, ".logs"), { recursive: true });
  if (text != null) { try { writeFileSync(join(vault, ".logs", "config-vorher.json"), text); } catch {} }
  schreibeAtomar(datei, inhalt);
  return { ok: true, stand: standVon(inhalt) };
}

// Final-Review #1: Nicht-Claude-KIs (Codex, Gemini, Cursor) erfahren von der Ich-Karte nur über den Satz in
// AGENTS.md ({{WENN:ichKarte}}). Ändert sich ichKarte, rendert der Aufrufer (Dienst-PUT, `brain einstellungen`)
// die AGENTS.md im Vault neu — nur diese Datei, nie etwas unter ~/.claude. Fehlertolerant: → true/false.
export function rendereAgentsDatei(vault) {
  const skript = join(dirname(fileURLToPath(import.meta.url)), "skills-build.mjs");
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_")));
  return new Promise((fertig) => {
    try {
      execFile(process.execPath, [skript, vault, "--ziel", "agents", join(vault, "AGENTS.md")],
        { windowsHide: true, timeout: 15000, env }, (err) => fertig(!err));
    } catch { fertig(false); }
  });
}

// Kurzform für Hooks: einzelnen Wert lesen, ohne sich um STANDARD/Altschlüssel/Fehlerfall zu kümmern.
export function wert(vault, schluessel) {
  return leseAutomatik(vault).werte[schluessel];
}

const kurzWarten = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

// tmp + rename; unter Windows kann ein paralleler Leser/Virenscanner kurz EPERM/EBUSY/EACCES auslösen —
// bis zu 5× mit 50 ms Pause erneut versuchen, danach als 500 melden (nie stillschweigend aufgeben).
function schreibeAtomar(datei, inhalt) {
  const tmp = `${datei}.${process.pid}.tmp`;
  writeFileSync(tmp, inhalt);
  const konkurrenz = new Set(process.platform === "win32" ? ["EPERM", "EBUSY", "EACCES"] : []);
  for (let versuch = 0; ; versuch++) {
    try { renameSync(tmp, datei); return; }
    catch (e) {
      if (!konkurrenz.has(e.code) || versuch >= 4) {
        try { unlinkSync(tmp); } catch {}
        throw fehlerMit(500, `Schreiben fehlgeschlagen: ${e.message}`);
      }
      kurzWarten(50);
    }
  }
}
