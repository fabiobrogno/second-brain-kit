// .tools/tests/fixture-garten.mjs — erfundener Garten-Verlauf für die Beleg-Integration (B1). KEIN Test.
// Zeilen im Format von Claude Code v2.1.30x (uuid, timestamp, sessionId, cwd je Zeile).
export const GARTEN_SITZUNG = "sitzung-beleg";
export const GARTEN_CWD = "/projekte/garten";
export const GARTEN_VAULT = "/vault/beispiel";

const zeit = (n) => `2026-10-21T08:${String(n).padStart(2, "0")}:00.000Z`;
const basis = (n, felder) => ({ uuid: `u${String(n).padStart(2, "0")}`, timestamp: zeit(n), sessionId: GARTEN_SITZUNG, cwd: GARTEN_CWD, ...felder });
const nutzer = (n, content, extra = {}) => basis(n, { type: "user", message: { role: "user", content }, ...extra });
const ki = (n, content, extra = {}) => basis(n, { type: "assistant", message: { role: "assistant", content }, ...extra });
const text = (t) => ({ type: "text", text: t });
const nutzung = (id, name, input) => ({ type: "tool_use", id, name, input });
const ergebnis = (id, content, extra = {}) => ({ type: "tool_result", tool_use_id: id, content, ...extra });

export function gartenEintraege({ vault = GARTEN_VAULT } = {}) {
  return [
    nutzer(1, "Die Tomaten stehen im Hochbeet Nord, gegossen wird um 7 Uhr."),
    ki(2, [text("Ich lege den Gießplan für das Hochbeet Nord an.")]),
    ki(3, [nutzung("t-read", "Read", { file_path: `${GARTEN_CWD}/plan.md` })]),
    nutzer(4, [ergebnis("t-read", "Bewässerung: Tropfschlauch mit 2 Litern pro Stunde.\n<system-reminder>Die Erdbeeren brauchen Stroh als Unterlage.</system-reminder>")]),
    ki(5, [nutzung("t-bash", "Bash", { command: `cat ${GARTEN_CWD}/saat.txt` })]),
    nutzer(6, [ergebnis("t-bash", "Möhren säen ab Mitte April in Reihe 3.")]),
    ki(7, [nutzung("t-web", "WebFetch", { url: "https://example.com/gartentipps?sitzung=abc", prompt: "Was gilt für Kompost?" })]),
    nutzer(8, [ergebnis("t-web", [text("Kompost braucht sechs Monate bis zur Reife.")])]),
    ki(9, [nutzung("t-wiki", "Read", { file_path: `${vault}/09_wiki/garten/thema_beet.md` })]),
    nutzer(10, [ergebnis("t-wiki", "Das Hochbeet Süd bekommt Schneckenkragen.")]),
    basis(11, { type: "attachment", attachment: { type: "hook_success", hookEvent: "UserPromptSubmit", hookName: "UserPromptSubmit",
      content: `Brain-Treffer (lokal, ungelesen — nur öffnen, wenn für die Aufgabe relevant):\n- ${vault}/09_wiki/garten/thema_kartoffel.md — Kartoffeln vertragen keinen Frost.` } }),
    nutzer(12, "Base directory for this skill: /skills/garten\n\nMulch hält die Feuchtigkeit im Boden.", { isMeta: true }),
    nutzer(13, "<system-reminder>Der Rasen wird nur samstags gemäht.</system-reminder>\nBitte merke dir: Der Rasenmäher steht im Schuppen links."),
    ki(14, [nutzung("t-agent", "Agent", { prompt: "Recherchiere den Apfelbaum." })]),
    nutzer(15, [ergebnis("t-agent", [text("Der Apfelbaum wurde 2019 gepflanzt.")])]),
    ki(16, [nutzung("t-mcp", "mcp__wetter__vorhersage", { ort: "Garten" })]),
    nutzer(17, [ergebnis("t-mcp", "Frostwarnung für die Nacht auf Dienstag.")]),
    nutzer(18, "Der Komposter steht hinter dem Schuppen."),
    ki(19, [text("Notiert: Der Komposter steht hinter dem Schuppen. Außerdem: Die Wasseruhr hängt im Keller.")]),
    ki(20, [nutzung("t-notiz", "Bash", { command: "cat notizen.txt" })]),
    nutzer(21, [ergebnis("t-notiz", "Notiz: Der Komposter steht hinter dem Schuppen.")]),
    ki(22, [nutzung("t-fehl", "Bash", { command: "cat gartenplan.csv" })]),
    nutzer(23, [ergebnis("t-fehl", "Fehler: Datei gartenplan.csv nicht gefunden", { is_error: true })]),
    nutzer(24, "Die Hecke ist 40 Meter lang.", { isSidechain: true }),
    nutzer(25, "Zusammenfassung: Beet A hat Lehmboden.", { isCompactSummary: true }),
    nutzer(26, "Der Gärtner sagt: „Bohnen nie vor den Eisheiligen“ – das gilt auch für Kürbis…"),
    nutzer(27, "Die Regentonne fasst\n   300 Liter."),
    nutzer(28, "Die **Gartenschere** liegt in der `Werkzeugkiste`."),
    nutzer(29, [ergebnis("t-unbekannt", "Die Laube hat ein Blechdach.")]),
    nutzer(30, "<local-command-stdout>Die Gießkanne ist leer.</local-command-stdout>"),
    ki(31, [nutzung("t-nachbar", "Read", { file_path: `${vault}-kit/notiz.md` })]),
    nutzer(32, [ergebnis("t-nachbar", "Der Zaun ist grün gestrichen.")]),
    ki(34, [nutzung("t-suche", "WebSearch", { query: "Lavendel Standort" })]),
    nutzer(35, [ergebnis("t-suche", "Lavendel mag sonnige Standorte.")]),
    ki(36, [nutzung("t-grep", "Grep", { pattern: "Kartoffel", path: GARTEN_CWD })]),
    nutzer(37, [ergebnis("t-grep", [text("vorrat.md: Die Kartoffeln liegen im Keller.")])]),
    ki(38, [nutzung("t-cwd", "Bash", { command: "cat notizen.md" })], { cwd: vault }),
    nutzer(39, [ergebnis("t-cwd", "Die Kräuterspirale liegt am Südhang.")], { cwd: vault }),
    ki(40, [nutzung("t-skill", "Skill", { skill: "garten" })]),
    nutzer(41, [ergebnis("t-skill", "Der Gartenkalender beginnt im Februar.")]),
    nutzer(42, "Die Wasseruhr hängt im Keller."),
    ki(43, [nutzung("t-web2", "WebFetch", { url: "https://example.com/rosen" })]),
    nutzer(44, [ergebnis("t-web2", "Rosen brauchen einen Rückschnitt im März.")]),
    ki(45, [text("Laut Quelle: Rosen brauchen einen Rückschnitt im März.")]),
    nutzer(46, "<task-notification>Der Holzstapel ist trocken.</task-notification>"),
    nutzer(47, "Die Tomaten bekommen Brennnesseljauche."),
  ];
}
