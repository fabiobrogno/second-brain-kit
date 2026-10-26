// .tools/update-check.mjs — Update-Hinweis (Spec §3.9): höchstens 1x/24h gegen die öffentliche
// Release-API prüfen, Ergebnis in .logs/update-check zwischenspeichern, offline/Fehler → still (nie werfen).
// BRAIN_UPDATE_QUELLE (ENV) überschreibt die Quelle für Tests: beginnt der Wert mit "http", wird er wie
// die echte API per fetch gelesen (z. B. ein lokaler Mock-Server); sonst gilt er als Pfad zu einer lokalen
// JSON-Datei mit demselben Feld "tag_name" wie die GitHub-Releases-API.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ladeConfig } from "./pfade.mjs";

const STANDARD_API = "https://api.github.com/repos/fabiobrogno/second-brain-kit/releases/latest";
const TAG_MS = 24 * 60 * 60 * 1000;

function semver(v) {
  return String(v || "").replace(/^v/, "").split(".").map(n => Number(n) || 0);
}
// true, wenn a echt größer ist als b (SemVer, nur die drei Zahlenteile — reicht für Kit-Releases).
export function istNeuer(a, b) {
  const pa = semver(a), pb = semver(b);
  for (let i = 0; i < 3; i++) { if (pa[i] !== pb[i]) return pa[i] > pb[i]; }
  return false;
}

function cachePfad(vault) { return join(vault, ".logs", "update-check"); }

export function leseCache(vault) {
  try { return JSON.parse(readFileSync(cachePfad(vault), "utf8")); } catch { return null; }
}

function schreibeCache(vault, daten) {
  try {
    mkdirSync(join(vault, ".logs"), { recursive: true });
    writeFileSync(cachePfad(vault), JSON.stringify(daten));
  } catch { /* .logs nicht schreibbar — Hinweis fällt für diese Sitzung aus, kein Fehler */ }
}

// Exportiert (nicht nur intern): hinweisZeile() liest hiermit die LIVE-Version, nie die im Cache
// eingefrorene — sonst würde ein frisch abgeschlossenes Update (systemVersion schon hochgesetzt) den
// Hinweis auf sich selbst zeigen, bis die 24h-Drosselung irgendwann von selbst neu prüft.
export function aktuelleVersion(vault) {
  try { return readFileSync(join(vault, ".tools", "VERSION"), "utf8").trim(); } catch { return null; }
}

// Holt den neuesten Tag-Namen — Datei-Quelle (Tests) oder echte URL (fetch, 3s Timeout). Nie werfend:
// jeder Fehler (offline, Timeout, kaputtes JSON, 404) liefert null.
async function holeNeuesteVersion(quelle) {
  try {
    if (!/^https?:\/\//.test(quelle)) {
      const j = JSON.parse(readFileSync(quelle, "utf8"));
      return String(j.tag_name || "").replace(/^v/, "") || null;
    }
    const r = await fetch(quelle, { signal: AbortSignal.timeout(3000), headers: { "User-Agent": "second-brain-kit" } });
    if (!r.ok) return null;
    const j = await r.json();
    return String(j.tag_name || "").replace(/^v/, "") || null;
  } catch { return null; }
}

// Höchstens 1x/24h ein echtes Netz/Datei-Lesen — sonst Cache. `jetzt`/`quelle` sind für Tests injizierbar.
// Opt-out: "update": { "pruefen": false } in brain.config.json → nie ins Netz, kein Hinweis.
export async function pruefeUpdate(vault, { quelle = process.env.BRAIN_UPDATE_QUELLE || STANDARD_API, jetzt = Date.now() } = {}) {
  if (ladeConfig(vault).update?.pruefen === false) return { zeit: jetzt, aus: true, aktuelle: aktuelleVersion(vault), neueste: null, neuer: false };
  const cache = leseCache(vault);
  if (cache && typeof cache.zeit === "number" && (jetzt - cache.zeit) < TAG_MS) return cache;
  const aktuelle = aktuelleVersion(vault);
  const neueste = await holeNeuesteVersion(quelle);
  const ergebnis = { zeit: jetzt, aktuelle, neueste, neuer: !!(neueste && aktuelle && istNeuer(neueste, aktuelle)) };
  schreibeCache(vault, ergebnis);
  return ergebnis;
}

// `vault` ist optional (Rückwärtskompatibilität), aber ohne ihn verlässt sich die Prüfung allein auf
// das zum Cache-Zeitpunkt eingefrorene `ergebnis.neuer` — mit `vault` wird IMMER live gegen die
// aktuelle .tools/VERSION nachgeprüft (s. Kommentar bei aktuelleVersion()).
export function hinweisZeile(ergebnis, vault) {
  if (!ergebnis?.neueste) return null;
  const aktuelle = vault ? aktuelleVersion(vault) : ergebnis.aktuelle;
  if (!aktuelle || !istNeuer(ergebnis.neueste, aktuelle)) return null;
  return `Es gibt eine neue Version deines Brains (v${ergebnis.neueste}). Sag „update mein Brain“, dann spiele ich sie ein.`;
}

export function bereitMarkePfad(vault) { return join(vault, ".logs", "update-bereit"); }
export function leseBereitMarke(vault) {
  const p = bereitMarkePfad(vault);
  if (!existsSync(p)) return null;
  try { return readFileSync(p, "utf8").trim() || null; } catch { return null; }
}
export function schreibeBereitMarke(vault, version) {
  try { mkdirSync(join(vault, ".logs"), { recursive: true }); writeFileSync(bereitMarkePfad(vault), String(version)); } catch {}
}
