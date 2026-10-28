// Beleg-Regeln der Ernte (B1, Spec §4.1): „Zitat finden“ und „Herkunft je Rolle“ — nur hier, sonst nirgends.
//   du   = Text des Nutzers                      tool = Ergebnis von Read/Bash/Grep/Glob/mcp__*
//   web  = Ergebnis von WebFetch/WebSearch       ki   = alles andere (Assistent, eingespielter Kontext, Fehler, Unbekanntes)
// Rang bei Mehrfachfund: tool > du > web > ki. Leitsatz: lieber eine Lücke als ein Fehler — im Zweifel ki.
// Reine Funktionen auf geparsten Verlaufszeilen (Objekte); ladeTranskript liest tolerant, wirft nie, ruft keine KI.
import { openSync, readSync, fstatSync, closeSync } from "node:fs";

export const HERKUNFT_RANG = { tool: 3, du: 2, web: 1, ki: 0 };
export const ZITAT_MIN = 12;
export const ZITAT_MAX = 300;
const MAX_BYTES = 16 * 1024 * 1024;

const TOOL_NAMEN = new Set(["Read", "Bash", "Grep", "Glob"]);
const WEB_NAMEN = new Set(["WebFetch", "WebSearch"]);

// Eingespielter Kontext im Nutzer-/Ergebnis-Text: geschlossene Blöcke, ein offener Block gilt bis zum Ende.
const TAG = "system-reminder|(?:local-)?command-[\\w-]+|task-notification|agent-message|user-prompt-submit-hook|bash-[\\w-]+";
const BLOCK = new RegExp(`<(${TAG})(?:\\s[^>]*)?>([\\s\\S]*?)</\\1\\s*>`, "g");
const OFFEN = new RegExp(`<(?:${TAG})(?:\\s[^>]*)?>([\\s\\S]*)$`);
const KONTEXT_ANFANG = /^\s*(?:Base directory for this skill:|Brain-Treffer\b|Brain-Hinweis\b)/;

// Verlauf lesen: JSONL → Array geparster Objekte. Kaputte/halbe Zeilen fallen weg; fehlende Datei → [].
// Über 16 MB zählt nur das Ende (die erste, abgeschnittene Zeile wird verworfen).
export function ladeTranskript(pfad) {
  let fd;
  try {
    fd = openSync(pfad, "r");
    const groesse = fstatSync(fd).size, start = Math.max(0, groesse - MAX_BYTES);
    const buf = Buffer.alloc(groesse - start);
    readSync(fd, buf, 0, buf.length, start);
    const zeilen = buf.toString("utf8").split("\n");
    if (start > 0) zeilen.shift();
    const aus = [];
    for (const z of zeilen) {
      if (!z.trim()) continue;
      try { const o = JSON.parse(z); if (o && typeof o === "object" && !Array.isArray(o)) aus.push(o); } catch { /* halbe Zeile */ }
    }
    return aus;
  } catch { return []; } finally { if (fd !== undefined) try { closeSync(fd); } catch { /* egal */ } }
}

// Schreibvarianten angleichen: Leerraum (auch geschütztes Leerzeichen, Zeilenumbruch) zusammenfassen, typografische
// Anführungszeichen/Striche/Auslassungspunkte vereinheitlichen, **fett**-/`code`-Zeichen weg. Groß/Klein zählt.
export function normalisiere(text) {
  return String(text ?? "")
    .normalize("NFC")
    .replace(/[​-‍⁠﻿­]/g, "")
    .replace(/[„“”‟«»〝〞＂]/g, '"')
    .replace(/[‚‘’‛′`´]/g, (c) => (c === "`" ? "" : "'"))
    .replace(/[‐‑‒–—―−]/g, "-")
    .replace(/…/g, "...")
    .replace(/\*\*/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Text ohne eingespielte Blöcke + die Blöcke selbst (deren Inhalt zählt höchstens als ki).
export function trenneEingespieltes(text) {
  const eingespielt = [];
  let rest = String(text ?? "").replace(BLOCK, (_, _t, inner) => { eingespielt.push(inner); return "\n"; });
  rest = rest.replace(OFFEN, (_, inner) => { eingespielt.push(inner); return "\n"; });
  return { rein: rest.trim(), eingespielt: eingespielt.map((e) => e.trim()).filter(Boolean) };
}

function ergebnisText(inhalt) {
  if (typeof inhalt === "string") return inhalt;
  if (!Array.isArray(inhalt)) return "";
  return inhalt.filter((b) => b && b.type === "text" && typeof b.text === "string").map((b) => b.text).join("\n");
}

function herkunftWerkzeug(name) {
  if (typeof name !== "string") return "ki";
  if (TOOL_NAMEN.has(name) || name.startsWith("mcp__")) return "tool";
  if (WEB_NAMEN.has(name)) return "web";
  return "ki";
}

function attachmentTexte(a) {
  const aus = [];
  for (const k of ["content", "prompt", "text", "stdout"]) if (typeof a?.[k] === "string") aus.push(a[k]);
  return aus;
}

// Alle Textstellen des Verlaufs mit ihrer Herkunft: [{ herkunft, uuid, zeit, werkzeug, text }].
export function fundstellen(zeilen) {
  const aus = [];
  const aufrufe = new Map();                               // tool_use id → Werkzeugname
  for (const o of Array.isArray(zeilen) ? zeilen : []) {
    if (!o || typeof o !== "object") continue;
    const uuid = typeof o.uuid === "string" ? o.uuid : "", zeit = typeof o.timestamp === "string" ? o.timestamp : "";
    const fremd = !!(o.isMeta || o.isSidechain || o.isCompactSummary || o.isVisibleInTranscriptOnly);
    const setze = (herkunft, text, werkzeug = "") => {
      if (typeof text !== "string" || !text.trim()) return;
      aus.push({ herkunft, uuid, zeit, werkzeug, text });
    };
    // Text mit eingespieltem Kontext: der Rest zählt als `herkunft`, Eingespieltes und Kontext-Kopf immer als ki.
    const mitKontext = (herkunft, text, werkzeug = "") => {
      const { rein, eingespielt } = trenneEingespieltes(text);
      setze(fremd || KONTEXT_ANFANG.test(rein) ? "ki" : herkunft, rein, werkzeug);
      for (const e of eingespielt) setze("ki", e);
    };
    const inhalt = o.message?.content;
    if (o.type === "attachment") {
      for (const t of attachmentTexte(o.attachment)) setze("ki", t);
    } else if (o.type === "assistant") {
      if (typeof inhalt === "string") setze("ki", inhalt);
      else for (const b of Array.isArray(inhalt) ? inhalt : []) {
        if (b?.type === "text") setze("ki", b.text);
        else if (b?.type === "tool_use" && typeof b.id === "string") aufrufe.set(b.id, b.name);
      }
    } else if (o.type === "user") {
      if (typeof inhalt === "string") mitKontext("du", inhalt);
      else for (const b of Array.isArray(inhalt) ? inhalt : []) {
        if (b?.type === "text") mitKontext("du", b.text);
        else if (b?.type === "tool_result") {
          const name = aufrufe.get(b.tool_use_id);
          const h = b.is_error ? "ki" : herkunftWerkzeug(name);
          mitKontext(h, ergebnisText(b.content), h === "ki" ? "" : name);
        }
      }
    }
  }
  return aus;
}

const WORT = /[\p{L}\p{N}]/u;
// Stärkere Herkunft gewinnt; bei Gleichstand die frühere Zeit (leere Zeit zählt als spät), sonst bleibt der erste Fund.
function staerker(f, best) {
  if (!best) return true;
  const d = HERKUNFT_RANG[f.herkunft] - HERKUNFT_RANG[best.herkunft];
  if (d !== 0) return d > 0;
  return !!f.zeit && (!best.zeit || f.zeit < best.zeit);
}

// Kommt `zitat` wörtlich (normalisiert, an Wortgrenzen) in genau einer Fundstelle vor?
// → { herkunft, uuid, zeit, werkzeug } der stärksten Fundstelle (bei Gleichstand die früheste), sonst null.
// Zitat nach Normalisierung < 12 oder > 300 Zeichen → null. Nie über zwei Fundstellen hinweg.
export function findeZitat(zeilen, zitat) {
  const z = normalisiere(zitat);
  if (z.length < ZITAT_MIN || z.length > ZITAT_MAX) return null;
  const vorn = WORT.test(z[0]), hinten = WORT.test(z[z.length - 1]);
  let best = null;
  for (const f of fundstellen(zeilen)) {
    const norm = normalisiere(f.text);
    let i = norm.indexOf(z);
    while (i !== -1) {
      const davor = norm[i - 1], danach = norm[i + z.length];
      if (!(vorn && davor && WORT.test(davor)) && !(hinten && danach && WORT.test(danach))) { if (staerker(f, best)) best = f; break; }
      i = norm.indexOf(z, i + 1);
    }
  }
  return best ? { herkunft: best.herkunft, uuid: best.uuid, zeit: best.zeit, werkzeug: best.werkzeug } : null;
}
