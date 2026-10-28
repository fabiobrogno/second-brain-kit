// .tools/heikel.mjs — „Heikel“-Prüfung (Spec Lernkreislauf §4.3): Regeln, 0 Tokens. istHeikel(text) →
// { heikel, gruende } mit Gründen geld | recht | person | zugang. Ein heikler Fakt wird nie automatisch
// übernommen, sondern zur Rückfrage. Im Zweifel heikel („lieber eine Lücke als ein Fehler“).
// Zugang und Person nutzen die vorhandenen Muster (secrets-muster.mjs, pii-muster.mjs) — keine Kopien.
import { hatSecretsImKontext } from "./secrets-muster.mjs";
import { hatPii } from "./pii-muster.mjs";

export const GRUENDE = ["geld", "recht", "person", "zugang"];

// Wortstämme dürfen mitten im Wort stehen (Mietvertrag, Stromkosten); „Preiselbeere“ ist kein Preis.
const GELD = new RegExp([
  "[€$£]|\\b(?:eur|usd|chf)\\b|\\d\\s?(?:euro|dollar|cent)\\b|\\beuro\\b",
  "(?:preis(?!el)|kosten|kostet|gebühr|rechnung|budget|gehalt|honorar|umsatz|gewinn|rabatt|zahlung|bezahl|überweis|steuer|miete|lohn|abo\\b|abonnement|tarif|rendite|schulden|kredit|darlehen|invoice|billing|salary|\\bcosts?\\b|\\bprice)",
].join("|"), "iu");

const RECHT = new RegExp(
  "(?:vertrag|verträge|dsgvo|gdpr|datenschutz|recht(?:lich|s(?!ch))|\\brecht\\b|kündig|haftung|haftet|lizenz|abmahn|\\bagb\\b|klage|anwalt|gericht|urheber|impressum|einwillig|auftragsverarbeit|\\bavv\\b|schadensersatz|gesetz|verordnung|\\bnda\\b|contract|lawsuit|legal\\b|liability|compliance)",
  "iu");

// Anrede + Name („Frau Muster“) ergänzt den PII-Filter, der nur E-Mail/Telefon/IBAN/Adresse kennt.
const PERSON_ANREDE = /(?<![\p{L}\p{N}])(?:Herr|Herrn|Frau|Dr\.|Prof\.|Mr\.|Mrs\.|Ms\.)\s+\p{Lu}\p{L}+/u;

const ZUGANG = new RegExp(
  "(?:\\bserver|produktion|\\bprod\\b|production|\\bssh\\b|\\bvpn\\b|zugang|zugriff|zugangsdaten|login|anmeldedaten|\\broot\\b|credential|\\bdeploy|datenbank|database|firewall|\\bapi[- ]?schlüssel|\\bschlüssel\\b)",
  "iu");

export function istHeikel(text) {
  const t = typeof text === "string" ? text : "";
  if (!t.trim()) return { heikel: false, gruende: [] };
  const gruende = [];
  if (GELD.test(t)) gruende.push("geld");
  if (RECHT.test(t)) gruende.push("recht");
  if (hatPii(t) || PERSON_ANREDE.test(t)) gruende.push("person");
  if (hatSecretsImKontext(t) || ZUGANG.test(t)) gruende.push("zugang");
  return { heikel: gruende.length > 0, gruende };
}
