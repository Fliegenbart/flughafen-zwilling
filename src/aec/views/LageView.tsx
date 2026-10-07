import { useMemo } from "react";
import { clock, int, power, powerText, situationAnswer, situationKpis } from "../analysis";
import DayLandscape from "../DayLandscape";
import { AnswerHead, Details, Section } from "../parts";
import type { ViewProps } from "../ProjectPage";
import { WerkstattLinks } from "../Werkstatt";

export default function LageView({ project, situation, route }: ViewProps) {
  const k = useMemo(() => situationKpis(situation), [situation]);
  const peak = power(k.peak);
  const limit = power(situation.gridLimitKw);
  const busiest = situation.departures.reduce(
    (a, b) => (b.count > a.count ? b : a),
    situation.departures[0] ?? { minute: 0, count: 0 },
  );
  const pvPeak = situation.load.reduce((a, b) => (b.pvKw > a.pvKw ? b : a), situation.load[0]!);
  const moments = [
    k.worst
      ? {
          at: `${clock(k.worst.start)}–${clock(k.worst.end)}`,
          text:
            situation.kind === "bezug"
              ? "Anschluss voll ausgelastet"
              : `bis zu ${powerText(k.worst.deficitKw)} fehlen`,
          tone: "signal",
        }
      : null,
    {
      at: `${clock(busiest.minute)}–${clock(busiest.minute + 30)}`,
      text: `${busiest.count} Abflüge in einer halben Stunde, die dichteste Welle des Tages`,
      tone: "edge",
    },
    pvPeak && pvPeak.pvKw > 0
      ? {
          at: clock(pvPeak.minute),
          text: `Photovoltaik auf dem Höchststand, ${powerText(pvPeak.pvKw)}`,
          tone: "muted",
        }
      : null,
  ].filter(Boolean) as { at: string; text: string; tone: string }[];

  return (
    <>
      <AnswerHead
        id="aec-view-title"
        question="Der Tag · Wie viel Strom braucht er?"
        answer={situationAnswer(situation)}
        lead={`Gerechnet für ${int(k.departures)} Abflüge${project.fleetSize ? ` und ${project.fleetSize} Elektrofahrzeuge` : ""} an einem Netzanschluss mit ${powerText(situation.gridLimitKw)}.`}
        evidence={situation.evidence}
        source={situation.source}
        kpis={[
          { value: int(k.departures), label: "Abflüge an diesem Tag" },
          {
            value: peak.value,
            unit: peak.unit,
            label: situation.kind === "bezug" ? "am meisten aus dem Netz" : "höchster Strombedarf",
          },
          {
            value: limit.value,
            unit: limit.unit,
            label: "gibt der Anschluss her",
            evidence: "assumption",
          },
          k.minReserve < 0
            ? {
                value: power(-k.minReserve).value,
                unit: power(-k.minReserve).unit,
                label: "fehlen in der Spitze",
                tone: "signal",
              }
            : {
                value: power(k.minReserve).value,
                unit: power(k.minReserve).unit,
                label: "bleiben im knappsten Moment frei",
              },
        ]}
      />
      <div className="aec-stage">
        <DayLandscape situation={situation} size="hero" />
      </div>
      <Section title="Die drei Momente des Tages" kicker="Überblick" id="lage-moments">
        <ol className="aec-moments">
          {moments.map((m) => (
            <li key={m.at} data-tone={m.tone}>
              <span className="aec-moments__at">{m.at}</span>
              <span>{m.text}</span>
            </li>
          ))}
        </ol>
      </Section>
      <Details summary="Worauf diese Zahlen beruhen">
        <ul className="aec-facts">
          <li>
            <span>Strombedarf</span>
            {situation.source === "api"
              ? `gerechnet in ${situation.stepMinutes}-Minuten-Schritten, aus der letzten Berechnung Ihres Projekts`
              : "Beispielwerte"}
          </li>
          <li>
            <span>Netzanschluss</span>
            {powerText(situation.gridLimitKw)} (Annahme)
          </li>
          <li>
            <span>Flugplan</span>
            {situation.source === "api"
              ? "Planzeiten aus dem veröffentlichten Flugplan"
              : "erfundene Abflugwellen"}
          </li>
        </ul>
      </Details>
      <Details summary="Anlagenplan und Flugplan im Detail (für Fachleute)">
        <WerkstattLinks items={["system"]} base={route} />
      </Details>
    </>
  );
}
