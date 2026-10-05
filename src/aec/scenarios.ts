/**
 * Szenario-Bibliothek: die acht Krisenfaelle der Abfertigungssimulation
 * (Bestand `src/App.tsx`, CASE_DEFINITIONS) in Kaeufersprache.
 * Alle Faelle sind synthetisch; sie dienen als Stresstests fuer Varianten.
 */
export type ScenarioCase = {
  id: number;
  slug: string;
  scenarioId: string;
  name: string;
  claim: string;
  energy: string;
  stress: string;
};

export const SCENARIO_CASES: ScenarioCase[] = [
  {
    id: 1,
    slug: "spitzenwelle",
    scenarioId: "airport_case_01_spitzenwelle_v1",
    name: "Spitzenwelle",
    claim: "Mehr Ankünfte und Abflüge in derselben Stunde, Positionen werden knapp.",
    energy:
      "Alle Schlepper und Busse laden danach gleichzeitig nach – die Ladespitze wandert in die nächste Welle.",
    stress: "+3,5 Ankünfte/h, +2,5 Abflüge/h, 12 % Positionen blockiert",
  },
  {
    id: 2,
    slug: "guillotine",
    scenarioId: "airport_case_02_guillotine_v1",
    name: "Guillotine",
    claim: "Positionen, Bahnkapazität und Personal brechen gleichzeitig ein.",
    energy:
      "Fahrzeuge stehen bereit, aber Aufträge stauen sich – der Ladebedarf kommt verzögert und gebündelt.",
    stress: "−34 % Positionen, −32 % Slots, −30 % Personal, 18 min",
  },
  {
    id: 3,
    slug: "wetter",
    scenarioId: "airport_case_03_wetter_kompression_v1",
    name: "Wetter",
    claim: "Wetter drückt die Bahnkapazität und verlängert die Abfertigung.",
    energy: "Längere Standzeiten heißen längere Bodenstromversorgung und kürzere Ladefenster.",
    stress: "−18 % Slots, 20 % Wetterrestriktion, +4 min Enteisung",
  },
  {
    id: 4,
    slug: "gepaeckstau",
    scenarioId: "airport_case_04_gepaeckstau_v1",
    name: "Gepäckstau",
    claim: "Die Gepäckanlage stockt, zugleich wächst die Ankunftswelle.",
    energy: "Gepäckschlepper fahren mehr Leerwege, Akkus leeren sich schneller als geplant.",
    stress: "33 % Gepäckstau, +5 min Sicherheit, +2 Ankünfte/h",
  },
  {
    id: 5,
    slug: "personal",
    scenarioId: "airport_case_05_personalengpass_v1",
    name: "Personal",
    claim: "Ein Drittel des Bodenpersonals fehlt.",
    energy:
      "Nicht der Strom bremst, sondern die Fahrerinnen und Fahrer – Laden verschiebt sich in Lücken.",
    stress: "−34 % Personal, 8 % Positionen blockiert",
  },
  {
    id: 6,
    slug: "sicherheit",
    scenarioId: "airport_case_06_sicherheitswelle_v1",
    name: "Sicherheit",
    claim: "Lange Kontrollen verzögern Boarding und Abfertigung.",
    energy: "Busse warten mit laufender Klimatisierung, Ladefenster verschieben sich nach hinten.",
    stress: "+10 min Sicherheitskontrolle, −12 % Personal",
  },
  {
    id: 7,
    slug: "enteisung",
    scenarioId: "airport_case_07_enteisungsfenster_v1",
    name: "Enteisung",
    claim: "Enteisung und Wetter verengen das Abflugfenster am Morgen.",
    energy:
      "Kälte senkt die nutzbare Akkukapazität, gleichzeitig wächst der Ladebedarf in der ersten Welle.",
    stress: "+12 min Enteisung, 16 % Wetter, −18 % Slots",
  },
  {
    id: 8,
    slug: "schwarzstart",
    scenarioId: "airport_case_08_schwarzstart_v1",
    name: "Schwarzstart",
    claim: "Der Betrieb startet aus einem schweren Ausfall und fährt stufenweise hoch.",
    energy:
      "Wenn alles gleichzeitig wieder anläuft, entscheidet die Reihenfolge des Ladens über die Netzspitze.",
    stress: "44 % Positionen gesperrt, −40 % Personal, Wiederanlauf nach 28 s Modellzeit",
  },
];
