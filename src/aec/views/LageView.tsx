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
              ? "Anschluss am Limit"
              : `Bedarf über der Anschlussgrenze, bis zu ${powerText(k.worst.deficitKw)} fehlen`,
          tone: "signal",
        }
      : null,
    {
      at: `${clock(busiest.minute)}–${clock(busiest.minute + 30)}`,
      text: `stärkste Flugwelle, ${busiest.count} Abflüge in 30 Minuten`,
      tone: "edge",
    },
    pvPeak && pvPeak.pvKw > 0
      ? {
          at: clock(pvPeak.minute),
          text: `PV liefert bis zu ${powerText(pvPeak.pvKw)}`,
          tone: "muted",
        }
      : null,
  ].filter(Boolean) as { at: string; text: string; tone: string }[];

  return (
    <>
      <AnswerHead
        id="aec-view-title"
        question="Lage · Wie sieht der Tag aus?"
        answer={situationAnswer(situation)}
        lead={`${int(k.departures)} Abflüge, ${project.fleetSize ? `${project.fleetSize} E-Fahrzeuge, ` : ""}ein Netzabgang mit ${powerText(situation.gridLimitKw)}.`}
        evidence={situation.evidence}
        source={situation.source}
        kpis={[
          { value: int(k.departures), label: "Abflüge am Tag" },
          {
            value: peak.value,
            unit: peak.unit,
            label: situation.kind === "bezug" ? "höchster Netzbezug" : "höchster Bedarf",
          },
          {
            value: limit.value,
            unit: limit.unit,
            label: "Anschlussgrenze",
            evidence: "assumption",
          },
          k.minReserve < 0
            ? {
                value: power(-k.minReserve).value,
                unit: power(-k.minReserve).unit,
                label: "Bedarf über Anschlussgrenze (Spitze)",
                tone: "signal",
              }
            : {
                value: power(k.minReserve).value,
                unit: power(k.minReserve).unit,
                label: "knappste Reserve",
              },
        ]}
      />
      <div className="aec-stage">
        <DayLandscape situation={situation} size="hero" />
      </div>
      <Section title="Der Tag in drei Momenten" kicker="Lesehilfe" id="lage-moments">
        <ol className="aec-moments">
          {moments.map((m) => (
            <li key={m.at} data-tone={m.tone}>
              <span className="aec-moments__at">{m.at}</span>
              <span>{m.text}</span>
            </li>
          ))}
        </ol>
      </Section>
      <Details summary="Annahmen und Datenlage">
        <ul className="aec-facts">
          <li>
            <span>Lastgang</span>
            {situation.source === "api"
              ? `Netzbezug je ${situation.stepMinutes} min aus dem neuesten gekoppelten Lauf`
              : "Beispieldaten, nicht gemessen und nicht simuliert"}
          </li>
          <li>
            <span>Anschlussgrenze</span>
            {powerText(situation.gridLimitKw)} (Annahme)
          </li>
          <li>
            <span>Flugplan</span>
            {situation.source === "api"
              ? "veröffentlichter Plan, keine Ist-Daten"
              : "Beispiel-Flugwellen"}
          </li>
        </ul>
      </Details>
      <Details summary="Werkstatt: Systemlandkarte und Flugplan">
        <WerkstattLinks items={["system"]} base={route} />
      </Details>
    </>
  );
}
