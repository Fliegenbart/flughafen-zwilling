import { useMemo } from "react";
import {
  bottleneckAnswer,
  clock,
  departuresInWindows,
  int,
  power,
  powerText,
  situationKpis,
} from "../analysis";
import DayLandscape from "../DayLandscape";
import Link from "../Link";
import { AnswerHead, Details, Section } from "../parts";
import type { ViewProps } from "../ProjectPage";
import { WerkstattLinks } from "../Werkstatt";

export default function EngpassView({ situation, route }: ViewProps) {
  const k = useMemo(() => situationKpis(situation), [situation]);
  const affected = departuresInWindows(situation, k.windows);
  const vehicle = Math.round(situation.vehicleShare * 100);
  const energy = 100 - vehicle;
  const deficit = k.worst && situation.kind === "bedarf" ? power(k.worst.deficitKw) : power(k.peak);

  return (
    <>
      <AnswerHead
        id="aec-view-title"
        question="Engpass · Wann reicht der Anschluss nicht?"
        answer={bottleneckAnswer(situation)}
        lead={
          k.windows.length
            ? `Insgesamt ${int(k.minutesAtLimit)} Minuten lang ist der Anschluss ausgereizt. ${
                situation.delayedDepartures === 0
                  ? "Noch wird jeder Abflug rechtzeitig fertig, aber Luft ist keine mehr."
                  : vehicle >= 50
                    ? `Nur ${energy} % der Verspätungen liegen am Strom. Meist fehlt in der Abflugwelle schlicht ein freies Fahrzeug.`
                    : `${energy} % der Verspätungen liegen am Strom.`
              }`
            : undefined
        }
        evidence={situation.evidence}
        source={situation.source}
        kpis={[
          {
            value: int(k.minutesAtLimit),
            unit: "min",
            label: `Minuten ist der Anschluss (${powerText(situation.gridLimitKw)}) ausgereizt`,
            tone: k.minutesAtLimit ? "signal" : undefined,
          },
          {
            value: deficit.value,
            unit: deficit.unit,
            label:
              situation.kind === "bedarf" && k.worst
                ? "fehlen in der Spitze"
                : "höchster Strombedarf",
          },
          { value: int(situation.delayedDepartures), label: "Abflüge nicht rechtzeitig fertig" },
          situation.delayedDepartures
            ? { value: `${vehicle}`, unit: "%", label: "davon, weil kein Fahrzeug frei war" }
            : { value: int(affected), label: "Abflüge in knappen Phasen" },
        ]}
      />
      <div className="aec-stage">
        <DayLandscape
          situation={situation}
          size="panel"
          label="Knappe Phasen im Tagesverlauf, Uhrzeit wählen"
        />
      </div>

      <Section
        title="Fehlt Strom oder fehlen Fahrzeuge?"
        kicker="Warum Abflüge warten"
        id="engpass-cause"
      >
        {situation.delayedDepartures === 0 ? (
          <p className="aec-muted">
            An diesem Tag wartet kein Abflug. Weder Strom noch Fahrzeuge werden knapp.
          </p>
        ) : (
          <div
            className="aec-split"
            role="img"
            aria-label={`Warum Abflüge warten: ${energy} Prozent wegen Strom, ${vehicle} Prozent wegen fehlender Fahrzeuge`}
          >
            <span className="aec-split__energy" style={{ flexGrow: Math.max(energy, 2) }}>
              <b>{energy} %</b> Strom
            </span>
            <span className="aec-split__vehicle" style={{ flexGrow: Math.max(vehicle, 2) }}>
              <b>{vehicle} %</b> Fahrzeuge
            </span>
          </div>
        )}
      </Section>

      <Section
        title={k.windows.length === 1 ? "Die knappe Phase" : "Die knappen Phasen"}
        kicker={`${k.windows.length} an diesem Tag`}
        id="engpass-windows"
      >
        {k.windows.length ? (
          <ol className="aec-windows">
            {k.windows.map((w) => (
              <li key={w.start}>
                <span className="aec-windows__time">
                  {clock(w.start)}–{clock(w.end)}
                </span>
                <span>{int(w.end - w.start)} min</span>
                <span>
                  {situation.kind === "bedarf"
                    ? `bis zu ${powerText(w.deficitKw)} fehlen`
                    : `Spitze ${powerText(w.peakKw)}`}
                </span>
                <span>{departuresInWindows(situation, [w])} Abflüge in dieser Zeit</span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="aec-muted">Keine. Der Anschluss reicht den ganzen Tag.</p>
        )}
        <p className="aec-muted">In knappen Phasen starten {int(affected)} Abflüge.</p>
        <Link
          to={{ page: "projekt", projekt: route.projekt, frage: "varianten" }}
          className="aec-button"
        >
          Lösungen durchrechnen
        </Link>
      </Section>

      <Details summary="Für Fachleute: Flugplan, Fahrzeuge und Laden im Zusammenspiel">
        <WerkstattLinks items={["betrieb"]} base={route} />
      </Details>
    </>
  );
}
