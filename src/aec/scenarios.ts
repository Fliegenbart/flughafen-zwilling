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
  /**
   * Energie-Abbild fuer den Stresstest in C (Annahme, nicht abgeleitet). Wortgleich mit
   * `backend/app/exchange/crisis.py`; ein Backend-Test prueft die Gleichheit.
   */
  energyStress: string;
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
    energyStress:
      "Von 06 bis 09 Uhr fallen je Flotte 2 Ladepunkte aus, weil Positionen blockiert sind.",
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
    energyStress:
      "Von 07 bis 11 Uhr liefert der Anschluss 30 % weniger, und ein Viertel der Ladepunkte fällt aus.",
  },
  {
    id: 3,
    slug: "wetter",
    scenarioId: "airport_case_03_wetter_kompression_v1",
    name: "Wetter",
    claim: "Wetter drückt die Bahnkapazität und verlängert die Abfertigung.",
    energy: "Längere Standzeiten heißen längere Bodenstromversorgung und kürzere Ladefenster.",
    stress: "−18 % Slots, 20 % Wetterrestriktion, +4 min Enteisung",
    energyStress:
      "Den ganzen Tag liefert die Photovoltaik 60 % weniger und der Anschluss 10 % weniger.",
  },
  {
    id: 4,
    slug: "gepaeckstau",
    scenarioId: "airport_case_04_gepaeckstau_v1",
    name: "Gepäckstau",
    claim: "Die Gepäckanlage stockt, zugleich wächst die Ankunftswelle.",
    energy: "Gepäckschlepper fahren mehr Leerwege, Akkus leeren sich schneller als geplant.",
    stress: "33 % Gepäckstau, +5 min Sicherheit, +2 Ankünfte/h",
    energyStress:
      "Von 08 bis 14 Uhr fallen 30 % der Ladepunkte für Gepäckschlepper aus, weil die Schlepper im Stau stehen.",
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
    energyStress: "Weil niemand umsteckt, bleiben den ganzen Tag 20 % der Ladepunkte ungenutzt.",
  },
  {
    id: 6,
    slug: "sicherheit",
    scenarioId: "airport_case_06_sicherheitswelle_v1",
    name: "Sicherheit",
    claim: "Lange Kontrollen verzögern Boarding und Abfertigung.",
    energy: "Busse warten mit laufender Klimatisierung, Ladefenster verschieben sich nach hinten.",
    stress: "+10 min Sicherheitskontrolle, −12 % Personal",
    energyStress:
      "Von 10 bis 16 Uhr fällt ein Viertel der Bus-Ladepunkte aus, weil Busse an den Positionen warten.",
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
    energyStress:
      "Kälte nimmt allen Akkus 20 % Kapazität, die Photovoltaik liefert 70 % weniger und der Anschluss von 05 bis 09 Uhr 15 % weniger.",
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
    energyStress:
      "Beim Wiederanlauf liefert der Anschluss bis 02 Uhr 60 % weniger, bis 04 Uhr 30 % und bis 06 Uhr 10 % weniger.",
  },
];

export const caseBySlug = (slug: string | null | undefined) =>
  SCENARIO_CASES.find((c) => c.slug === slug) ?? null;
