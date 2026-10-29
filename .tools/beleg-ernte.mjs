// .tools/beleg-ernte.mjs — alles, was die Ernte rund um beleg.mjs braucht (B1, §4.1): die Selbstbestätigungs-Sperre
// (Werkzeug-Ergebnisse aus dem eigenen Brain — Vault oder ernteNichtIn — zählen nie als Beleg), Fehler und unbekannte
// Aufrufe als „ki“, die Web-Adresse eines web-Belegs und die Fundstelle. Die Regeln „Zitat finden / Herkunft je Rolle“
// stehen nur in beleg.mjs; markiereEigenes formt den Verlauf so um, dass beleg.mjs Eigenes als Assistenten-Text (ki) sieht.
// Rein (liest nur realpath für Pfadformen), wirft nie. Nur Node-Standardbibliothek.
import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join, isAbsolute, win32 } from "node:path";

export const HERKUNFT_WERTE = ["du", "tool", "web", "ki"];
export const MAX_ZITAT = 300;
export const FUNDSTELLE_MUSTER = /^[\w?-]{1,64}#[\w?-]{1,80} (?:\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z|\?)$/;

// ---------- Eingespielter Kontext ----------

const EINGESPIELT = /<(system-reminder|command-[a-z-]+|local-command-[a-z-]+|task-notification|agent-message|user-prompt-submit-hook|bash-[a-z-]+)(?:\s[^>]*)?>[\s\S]*?(?:<\/\1>|$)/g;
export function ohneEingespieltes(text) {
  return String(text ?? "").replace(EINGESPIELT, "\n").trim();
}
export function ergebnisText(inhalt) {
  if (typeof inhalt === "string") return inhalt;
  if (!Array.isArray(inhalt)) return "";
  return inhalt.filter((x) => x?.type === "text" && typeof x.text === "string").map((x) => x.text).join("\n");
}

// ---------- Pfade ----------

const fwd = (p) => String(p ?? "").replace(/\\/g, "/");
const ohneSchluss = (p) => p.replace(/\/+$/, "");
const faltet = (plattform) => plattform === "darwin" || plattform === "win32";
const vergleich = (p, plattform) => { const f = fwd(p).normalize("NFC"); return faltet(plattform) ? f.toLowerCase() : f; };
const VOR_GRENZE = /[\p{L}\p{N}_.~\/-]/u;   // davor kein Pfadzeichen
const NACH_GRENZE = /[\p{L}\p{N}_.~-]/u;    // danach kein Namenszeichen („/“, Ende, Anführung, Leerraum sind ok)

// Schreibweisen eines absoluten Ordners: wie angegeben, echt (realpath), mit ~ fürs Home — immer mit „/“.
// Relative oder leere Angaben und die Wurzel liefern nichts (nicht sicher prüfbar).
export function pfadFormen(pfad, { home = homedir() } = {}) {
  let p = typeof pfad === "string" ? pfad.trim() : "";
  if (!p) return [];
  if (p === "~" || p.startsWith("~/") || p.startsWith("~\\")) p = join(home, p.slice(1));
  if (!isAbsolute(p) && !win32.isAbsolute(p)) return [];
  const formen = new Set();
  const dazu = (x) => { const f = ohneSchluss(fwd(x).normalize("NFC")); if (f) formen.add(f); };
  dazu(p);
  try { dazu(realpathSync(p)); } catch {}
  const h = ohneSchluss(fwd(home).normalize("NFC"));
  for (const f of [...formen]) if (h && f.startsWith(h + "/")) formen.add("~" + f.slice(h.length));
  return [...formen];
}

// Nennt `text` einen der Pfade an Ordnergrenzen? (`~/brain-kit` nennt `~/brain` nicht.) darwin/win32 ohne Groß/Klein.
export function nenntPfad(text, formen, { plattform = process.platform } = {}) {
  if (!Array.isArray(formen) || !formen.length) return false;
  const s = vergleich(text, plattform);
  for (const f0 of formen) {
    const f = vergleich(f0, plattform);
    if (!f) continue;
    for (let i = s.indexOf(f); i !== -1; i = s.indexOf(f, i + 1)) {
      const vor = i > 0 ? s[i - 1] : "", nach = s[i + f.length] ?? "";
      if ((!vor || !VOR_GRENZE.test(vor)) && (!nach || !NACH_GRENZE.test(nach))) return true;
    }
  }
  return false;
}

export function sperrPfade(vault, ernteNichtIn = [], { home = homedir() } = {}) {
  const alle = new Set();
  for (const p of [vault, ...(Array.isArray(ernteNichtIn) ? ernteNichtIn : [])]) for (const f of pfadFormen(p, { home })) alle.add(f);
  return [...alle];
}

function liegtUnter(pfad, formen, plattform) {
  if (typeof pfad !== "string" || !pfad) return false;
  const p = ohneSchluss(vergleich(pfad, plattform));
  return formen.some((f0) => { const f = vergleich(f0, plattform); return f && !f.startsWith("~") && (p === f || p.startsWith(f + "/")); });
}
// Liegt ein gesperrter Ordner unter dem cwd, kann ein Befehl ihn relativ nennen („cat brain/09_wiki/a.md“ in ~).
function relativeFormen(formen, cwd, plattform) {
  if (typeof cwd !== "string" || !cwd) return [];
  const c = ohneSchluss(vergleich(cwd, plattform));
  const out = [];
  for (const f0 of formen) {
    const f = ohneSchluss(fwd(f0).normalize("NFC"));
    if (f.startsWith("~") || !vergleich(f, plattform).startsWith(c + "/")) continue;
    const rel = f.slice(c.length + 1);
    if (rel) out.push(rel, "./" + rel);
  }
  return out;
}
function werteText(x, tiefe = 0) {
  if (typeof x === "string") return [x];
  if (!x || typeof x !== "object" || tiefe > 5) return [];
  return Object.values(x).flatMap((w) => werteText(w, tiefe + 1));
}

// Werkzeug-Aufruf liest aus dem eigenen Brain: ein cwd liegt darin oder ein Eingabewert nennt einen gesperrten Pfad.
export function aufrufGesperrt(input, cwds, sperr, { plattform = process.platform } = {}) {
  if (!Array.isArray(sperr) || !sperr.length) return false;
  const orte = (Array.isArray(cwds) ? cwds : [cwds]).filter((c) => typeof c === "string" && c);
  if (orte.some((c) => liegtUnter(c, sperr, plattform))) return true;
  const formen = [...sperr, ...orte.flatMap((c) => relativeFormen(sperr, c, plattform))];
  return werteText(input).some((t) => nenntPfad(t, formen, { plattform }));
}

// ---------- Verlauf für beleg.mjs vorbereiten ----------

// Werkzeug-Ergebnisse aus dem eigenen Brain, Fehler-Ergebnisse und Ergebnisse ohne bekannten Aufruf → Assistenten-Zeile
// (gleiche uuid/timestamp): beleg.mjs zählt sie dann als „ki“. Alles andere bleibt unverändert (gleiche Objekte).
export function markiereEigenes(zeilen, { sperr = [], plattform = process.platform } = {}) {
  const aufrufe = new Map();   // tool_use id → gesperrt?
  const out = [];
  for (const o of Array.isArray(zeilen) ? zeilen : []) {
    const c = o && typeof o === "object" ? o.message?.content : null;
    if (o?.type === "assistant" && Array.isArray(c)) {
      for (const b of c) if (b?.type === "tool_use") aufrufe.set(String(b.id ?? ""), aufrufGesperrt(b.input, [o.cwd], sperr, { plattform }));
    }
    if (o?.type !== "user" || !Array.isArray(c) || !c.some((b) => b?.type === "tool_result")) { out.push(o); continue; }
    const cwdGesperrt = aufrufGesperrt({}, [o.cwd], sperr, { plattform });
    const bleibt = [], alsKi = [];
    for (const b of c) {
      const eigen = b?.type === "tool_result" && (b.is_error === true || aufrufe.get(String(b.tool_use_id ?? "")) !== false || cwdGesperrt);
      (eigen ? alsKi : bleibt).push(b);
    }
    if (!alsKi.length) { out.push(o); continue; }
    if (bleibt.length) out.push({ ...o, message: { ...o.message, content: bleibt } });
    for (const b of alsKi) {
      out.push({ type: "assistant", uuid: o.uuid, timestamp: o.timestamp, sessionId: o.sessionId, cwd: o.cwd,
        message: { role: "assistant", content: [{ type: "text", text: ergebnisText(b.content) }] } });
    }
  }
  return out;
}

// Adresse (Herkunft + Pfad, nie Query/Fragment) der WebFetch-Seite, deren Ergebnis in der Zeile `uuid` steht.
export function webAdresse(zeilen, uuid) {
  const urls = new Map();
  for (const o of Array.isArray(zeilen) ? zeilen : []) {
    const c = o?.message?.content;
    if (!Array.isArray(c)) continue;
    if (o.type === "assistant") for (const b of c) if (b?.type === "tool_use" && b.name === "WebFetch") urls.set(String(b.id ?? ""), b.input?.url);
    if (o.type !== "user" || !uuid || String(o.uuid ?? "") !== uuid) continue;
    for (const b of c) {
      if (b?.type !== "tool_result" || !urls.has(String(b.tool_use_id ?? ""))) continue;
      try {
        const u = new URL(String(urls.get(String(b.tool_use_id))));
        if (u.protocol === "http:" || u.protocol === "https:") return (u.origin + u.pathname).slice(0, MAX_ZITAT);
      } catch {}
    }
  }
  return "";
}

// ---------- Fundstelle ----------

const rein = (s, n) => String(s ?? "").replace(/[^\w-]/g, "").slice(0, n) || "?";
const ISO_ZEIT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
export function baueFundstelle({ sitzung, uuid, zeit } = {}) {
  return `${rein(sitzung, 64)}#${rein(uuid, 80)} ${ISO_ZEIT.test(String(zeit ?? "")) ? zeit : "?"}`;
}
export function leseFundstelle(s) {
  const t = String(s ?? "");
  if (!FUNDSTELLE_MUSTER.test(t)) return null;
  const [kopf, zeit] = t.split(" ");
  const [sitzung, uuid] = kopf.split("#");
  const ohne = (x) => (x === "?" ? "" : x);
  return { sitzung: ohne(sitzung), uuid: ohne(uuid), zeit: ohne(zeit) };
}
