#!/usr/bin/env node
// .tools/tests/messkorpus.mjs — erzeugt ein erfundenes Test-Vault für den Such-Vergleich BM25 ↔ Vektoren (FBL-91):
// 40 Wiki-Seiten (09_wiki) + _messlatte.json mit je einer Frage in den Worten der Seite („wort“) und einer Umschreibung
// ohne gemeinsame Schlüsselwörter („sinn“), dazu Fragen, die schweigen sollen. Keine echten Daten.
// Aufruf: node messkorpus.mjs <leerer-zielordner>
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// [datei, titel, beschreibung, text, frage-in-Worten-der-Seite, Umschreibung]
const T = [
  ["thema_faehre", "Fähre nach Föhr", "Abfahrtszeiten und Preise der Fähre nach Föhr ab Dagebüll", "Die Fähre legt werktags um neun Uhr in Dagebüll ab. Ein Autoplatz kostet 38 Euro, Fahrgäste zahlen 9 Euro.", "wann fährt die fähre nach föhr ab dagebüll", "wie komme ich mit dem auto auf die insel im wattenmeer"],
  ["thema_umsatzsteuer", "Umsatzsteuer-Voranmeldung", "Fristen und Ablauf der monatlichen Umsatzsteuer-Voranmeldung", "Die Voranmeldung geht bis zum zehnten des Folgemonats über Elster ans Finanzamt. Dauerfristverlängerung verschiebt den Termin um einen Monat.", "bis wann muss die umsatzsteuer voranmeldung abgegeben werden", "wann schulde ich dem finanzamt die monatliche meldung zur mehrwertsteuer"],
  ["thema_backup", "Backup-Strategie", "Wie und wann die Daten gesichert werden", "Nachts um drei läuft ein verschlüsseltes Backup auf die externe Platte. Wöchentlich wird eine Kopie in die Cloud geladen.", "wie läuft das backup der daten ab", "was passiert, wenn mein rechner morgen kaputtgeht und die dateien weg sind"],
  ["thema_sauerteig", "Sauerteigbrot", "Rezept für Sauerteigbrot mit Roggenmehl", "500 Gramm Roggenmehl, 350 Milliliter Wasser, 100 Gramm Anstellgut. Der Teig geht zwölf Stunden bei Zimmertemperatur.", "welches rezept gilt für das sauerteigbrot mit roggenmehl", "wie backe ich ein brot ohne hefe aus getreide"],
  ["thema_vpn", "VPN-Zugang", "Einrichtung des VPN für das Heimnetz", "Der Zugang läuft über WireGuard auf dem Router. Die Konfigurationsdatei liegt im Passwortmanager unter Heimnetz.", "wie richte ich den vpn zugang ein", "wie komme ich von unterwegs sicher an meine geräte zuhause"],
  ["thema_fahrrad", "Fahrradwartung", "Wartungsplan für das Alltagsrad", "Kette alle 500 Kilometer ölen, Reifendruck auf 4,5 bar, Bremsbeläge im Frühjahr prüfen.", "wie oft muss die fahrradkette geölt werden", "wann sollte ich mein zweirad zur inspektion bringen"],
  ["thema_mietvertrag", "Mietvertrag Wohnung", "Kündigungsfrist und Nebenkosten der Mietwohnung", "Die Kündigungsfrist beträgt drei Monate zum Monatsende. Nebenkosten: 180 Euro Vorauszahlung, Abrechnung jährlich im Herbst.", "welche kündigungsfrist hat der mietvertrag", "bis wann muss ich raus, wenn ich ausziehen will"],
  ["thema_versicherung", "Haftpflichtversicherung", "Private Haftpflicht, Deckung und Selbstbeteiligung", "Deckungssumme zehn Millionen Euro, Selbstbeteiligung 150 Euro, Beitrag 62 Euro im Jahr. Policennummer steht im Ordner Verträge.", "wie hoch ist die selbstbeteiligung der haftpflichtversicherung", "wer zahlt, wenn ich beim nachbarn versehentlich etwas kaputt mache"],
  ["thema_python_env", "Python-Umgebung", "Virtuelle Umgebung und Abhängigkeiten für das Auswertungsskript", "Mit python -m venv .venv anlegen, dann pip install -r requirements.txt. Python 3.12 wird vorausgesetzt.", "wie lege ich die python umgebung für das skript an", "wie installiere ich die benötigten bibliotheken für die auswertung"],
  ["thema_marathon", "Marathontraining", "Trainingsplan für den Herbstmarathon", "Vier Läufe pro Woche, langer Lauf am Sonntag bis 32 Kilometer, zwei Wochen Tapering vor dem Start.", "wie sieht der trainingsplan für den marathon aus", "wie bereite ich mich auf einen langen lauf im oktober vor"],
  ["thema_steuerid", "Steuer-Identifikationsnummer", "Wo die Steuer-ID gespeichert ist und wofür sie gebraucht wird", "Die elfstellige Nummer steht im Steuerbescheid und im Ordner Finanzen. Arbeitgeber und Bank fragen sie ab.", "wo finde ich meine steuer identifikationsnummer", "welche elfstellige zahl verlangt die bank für meine konten"],
  ["thema_drucker", "Netzwerkdrucker", "Einrichtung und Fehlerbehebung des Laserdruckers", "Der Drucker hat die feste Adresse 192.168.1.40. Bei Papierstau Tonerklappe öffnen und Walze prüfen.", "wie richte ich den netzwerkdrucker ein", "mein ausdruck bleibt hängen und das gerät piept"],
  ["thema_urlaub_italien", "Urlaub Italien", "Planung der Reise nach Ligurien im Sommer", "Ferienhaus in Camogli vom 12. bis 26. Juli, Anreise mit dem Zug über Mailand, Kaution 300 Euro.", "wo ist das ferienhaus in ligurien", "wo übernachten wir im juli am mittelmeer"],
  ["thema_passwoerter", "Passwortmanager", "Regeln für Passwörter und Zwei-Faktor-Anmeldung", "Alle Zugänge liegen im Passwortmanager, Hauptpasswort ist eine Satzphrase. Zwei-Faktor per Hardware-Schlüssel.", "welche regeln gelten für passwörter und zwei faktor", "wie schütze ich meine konten vor übernahme"],
  ["thema_solar", "Balkonkraftwerk", "Ertrag und Anmeldung der Steckersolaranlage", "Zwei Module mit zusammen 800 Watt. Anmeldung im Marktstammdatenregister, Jahresertrag etwa 700 Kilowattstunden.", "wie viel ertrag liefert das balkonkraftwerk", "wie viel strom erzeugen die paneele am geländer im jahr"],
  ["thema_kaffee", "Espressomaschine", "Reinigung und Entkalkung der Espressomaschine", "Alle sechs Wochen entkalken, Brühgruppe wöchentlich rückspülen. Mahlgrad 14 bei der Mühle.", "wie entkalke ich die espressomaschine", "mein heißgetränkeautomat schmeckt bitter und tropft langsam"],
  ["thema_steuererklaerung", "Einkommensteuererklärung", "Unterlagen und Fristen der Steuererklärung", "Abgabe bis 31. Juli des Folgejahres, mit Steuerberater bis Ende Februar des übernächsten Jahres. Belege im Ordner Steuer.", "bis wann ist die einkommensteuererklärung fällig", "wann muss ich dem fiskus meine jahresabrechnung schicken"],
  ["thema_git_regeln", "Git-Regeln", "Branch-Namen und Commit-Nachrichten im Projekt", "Branches heißen feature/kurzname, Commits beginnen mit einem Verb im Imperativ. Gemergt wird per Squash.", "welche regeln gelten für branch namen und commits", "wie benenne ich meine änderungen in der versionsverwaltung"],
  ["thema_garten", "Gemüsegarten", "Aussaatkalender für das Hochbeet", "Tomaten ab Mitte März vorziehen, Auspflanzen nach den Eisheiligen. Bohnen Anfang Mai direkt säen.", "wann pflanze ich tomaten im hochbeet", "ab wann kommt das gemüse nach draußen, damit kein frost schadet"],
  ["thema_krankenkasse", "Krankenkasse", "Tarif, Bonusprogramm und Erstattung", "Beitrag 14,6 Prozent plus Zusatzbeitrag. Bonusprogramm zahlt 150 Euro für Vorsorge, Belege per App hochladen.", "wie funktioniert das bonusprogramm der krankenkasse", "gibt es geld zurück, wenn ich zur vorsorge gehe"],
  ["thema_smarthome", "Smarthome-Zentrale", "Geräte und Automationen im Haus", "Zentrale ist ein Raspberry Pi mit Home Assistant. Heizung regelt per Zigbee-Thermostat, Licht per Bewegungsmelder.", "welche geräte hängen an der smarthome zentrale", "wie schaltet sich das licht im flur von selbst ein"],
  ["thema_vortrag", "Konferenzvortrag", "Gliederung und Zeitplan für den Vortrag im November", "Vierzig Minuten, drei Teile: Problem, Lösung, Messung. Folien in 16:9, Probelauf eine Woche vorher.", "wie ist der vortrag im november gegliedert", "wie lange darf ich auf der bühne sprechen und was zeige ich"],
  ["thema_auto_tuev", "Auto Hauptuntersuchung", "TÜV-Termin und Reifenwechsel", "Hauptuntersuchung fällig im März. Winterreifen von Oktober bis Ostern, Reifenhotel beim Händler.", "wann ist der tüv termin für das auto", "wann muss der wagen zur pflichtprüfung"],
  ["thema_ernaehrung", "Ernährungsplan", "Wochenplan mit Einkaufsliste", "Montag Linsensuppe, Mittwoch Ofengemüse, Freitag Fisch. Einkauf samstags auf dem Markt.", "was steht im wochenplan für mittwoch", "was koche ich in der mitte der woche"],
  ["thema_lizenz", "Software-Lizenzen", "Welche Lizenz für welches Projekt gilt", "Eigener Code steht unter MIT, Fremdbibliotheken unter Apache-2.0. Vor der Veröffentlichung Lizenzdateien prüfen.", "unter welcher lizenz steht der eigene code", "darf jeder meinen quelltext frei weiterverwenden"],
  ["thema_nas", "Heimserver", "Speicher und Freigaben im Heimserver", "Zwei Platten im Spiegel, vier Terabyte nutzbar. Freigaben Fotos und Dokumente, Zugriff nur im Heimnetz.", "wie viel speicher hat der heimserver", "wo liegen unsere familienbilder und wer kommt dran"],
  ["thema_zahnarzt", "Zahnarzt", "Kontrolltermine und Bonusheft", "Kontrolle halbjährlich, Zahnreinigung im Herbst. Das Bonusheft liegt in der Schublade im Flur.", "wann ist der nächste zahnarzt kontrolltermin", "wann muss ich wieder zur prüfung meiner beißer"],
  ["thema_projekt_atlas", "Projekt Atlas", "Ziele und Meilensteine des Atlas-Projekts", "Meilenstein eins: Datenimport bis Ende Mai. Meilenstein zwei: Kartenansicht im August. Verantwortlich ist das Kernteam.", "welche meilensteine hat das projekt atlas", "was soll bis zum sommer fertig sein und bis wann kommt die landkarte"],
  ["thema_spanisch", "Spanisch lernen", "Lernplan und Vokabelkarten", "Zwanzig Minuten täglich, Vokabeln mit Karteikarten-App, Tandem donnerstags per Video.", "wie ist der lernplan für spanisch", "wie übe ich eine fremdsprache jeden tag ein bisschen"],
  ["thema_kamera", "Kamera-Ausrüstung", "Objektive und Einstellungen für Landschaft", "Weitwinkel 16-35 Millimeter, Blende f/8, ISO 100, Stativ mit Fernauslöser für Dämmerung.", "welche objektive nutze ich für landschaftsfotos", "mit welchem glas und welchen werten fotografiere ich berge bei sonnenuntergang"],
  ["thema_rente", "Altersvorsorge", "Rentenansprüche und private Vorsorge", "Rentenauskunft jährlich im Januar prüfen. Sparplan mit 200 Euro monatlich in einen Indexfonds.", "wie hoch ist der sparplan für die altersvorsorge", "wie viel lege ich monatlich für später zurück"],
  ["thema_umzug", "Umzugs-Checkliste", "Aufgaben vor und nach dem Umzug", "Vier Wochen vorher Nachsendeauftrag, Strom ummelden, Halteverbot beantragen. Danach Ummeldung beim Bürgeramt.", "was steht auf der checkliste für den umzug", "woran denke ich, bevor die möbelpacker kommen"],
  ["thema_podcast", "Podcast-Idee", "Konzept für einen Wissenspodcast", "Zwanzig Minuten pro Folge, ein Thema, ein Gast. Aufnahme mit Mikrofon am Küchentisch, Schnitt in Audacity.", "wie ist das konzept für den podcast", "wie soll die audiosendung aufgebaut sein"],
  ["thema_wlan", "WLAN-Router", "Netzwerknamen, Kanäle und Gastzugang", "Zwei Netze: Haus und Gast. Kanal 36 im 5-Gigahertz-Band, Gastnetz schaltet sich nachts ab.", "wie heißen die wlan netze und welcher kanal ist eingestellt", "wie bekommen besucher internet, ohne in mein netz zu kommen"],
  ["thema_hund", "Hund Mika", "Impfungen, Futter und Tierarzt", "Impfung im April, 300 Gramm Trockenfutter morgens und abends. Tierarztpraxis am Markt, Chipnummer im Heimtierausweis.", "wann bekommt der hund seine impfung", "wann muss mika zur spritze und was kriegt sie zu fressen"],
  ["thema_buchhaltung", "Buchhaltung", "Belegablage und Kontenrahmen", "Belege monatlich scannen und ablegen. Kontenrahmen SKR03, Aufbewahrung zehn Jahre.", "wie lange müssen belege in der buchhaltung aufbewahrt werden", "wie lange darf ich rechnungen aus dem geschäft nicht wegwerfen"],
  ["thema_klavier", "Klavierüben", "Übungsplan und Stücke", "Dreißig Minuten täglich, Tonleitern zum Aufwärmen, aktuelles Stück ist eine Sonatine von Clementi.", "was steht im übungsplan fürs klavier", "was spiele ich gerade und wie lange sitze ich am instrument"],
  ["thema_notfall", "Notfallkontakte", "Wichtige Nummern und Notfallmappe", "Notfallmappe im Schrank im Flur. Hausarzt, Elternnummer und Versicherungshotline stehen auf der ersten Seite.", "wo liegt die notfallmappe", "wen rufe ich an, wenn zuhause etwas passiert"],
  ["thema_sprachmodell", "Lokales Sprachmodell", "Modell und Hardware für lokale Textgenerierung", "Ein quantisiertes Modell mit sieben Milliarden Parametern läuft auf der Grafikkarte mit zwölf Gigabyte Speicher.", "welches sprachmodell läuft lokal auf der grafikkarte", "welche künstliche intelligenz betreibe ich ohne cloud auf eigener hardware"],
];
// Fragen, die schweigen sollen: Smalltalk, Befehle, fremdes Wissen.
const STILL = [
  "mach mir bitte einen commit", "wie spät ist es gerade", "was ist siebzehn mal dreiundzwanzig", "schreib einen unit test für die login funktion",
  "erzähl mir einen witz über katzen", "wie wird das wetter morgen in hamburg", "übersetze guten morgen ins japanische", "wer hat die relativitätstheorie entwickelt",
  "was ist die hauptstadt von australien", "gib mir ein rezept für pizza hawaii", "erkläre mir wie ein verbrennungsmotor funktioniert", "wie viele einwohner hat tokio",
  "schlage einen namen für meine neue katze vor", "fasse den roman moby dick in drei sätzen zusammen", "was bedeutet das wort serendipität", "wie weit ist der mond von der erde entfernt",
  "schreibe ein gedicht über den herbst", "was ist der unterschied zwischen tcp und udp", "wie funktioniert eine wärmepumpe grundsätzlich", "nenne mir drei bekannte impressionistische maler",
];

export function erzeuge(ziel) {
  const wiki = join(ziel, "09_wiki");
  mkdirSync(wiki, { recursive: true });
  mkdirSync(join(ziel, "00_inbox"), { recursive: true });
  writeFileSync(join(ziel, "brain.config.json"), JSON.stringify({ hinweis: { collection: "brainkarten" } }, null, 2) + "\n");
  for (const [datei, titel, beschr, text] of T) {
    writeFileSync(join(wiki, datei + ".md"),
      `---\nname: ${datei}\ndescription: ${beschr}\ntyp: thema\n---\n# ${titel}\n\n${text}\n\n## Details\n\n${text}\n\n**${titel}** ist ein Thema im Brain.\n`);
  }
  const positiv = [];
  for (const [datei, , , , wort, sinn] of T) {
    positiv.push({ prompt: wort, erwartet: [datei + ".md"], art: "wort" }, { prompt: sinn, erwartet: [datei + ".md"], art: "sinn" });
  }
  writeFileSync(join(wiki, "_messlatte.json"), JSON.stringify({ positiv, negativ: STILL, kontrolle_negativ: [], ziel: {} }, null, 2) + "\n");
  return { seiten: T.length, positiv: positiv.length, negativ: STILL.length };
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], "file://").href) {
  if (!process.argv[2]) { console.error("Aufruf: node messkorpus.mjs <leerer-zielordner>"); process.exit(2); }
  console.log(JSON.stringify(erzeuge(process.argv[2])));
}
