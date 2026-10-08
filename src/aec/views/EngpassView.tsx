import { useMemo } from "react";
import { clock, int, power, powerText } from "../model/format";
import { bottleneckAnswer, departuresInWindows, situationKpis } from "../model/situation";
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
            ? `Der Anschluss ist ${int(k.minutesAtLimit)} Minuten lang voll ausgelastet. ${
                situation.delayedDepartures === 0
                  ? "Alle Abflüge werden trotzdem rechtzeitig fertig, Reserve bleibt dabei keine."
                  : vehicle >= 50
                    ? `Von den Verspätungen gehen ${energy} % auf fehlenden Strom zurück, der Rest auf fehlende freie Fahrzeuge in der Abflugwelle.`
                    : `${energy} % der Verspätungen gehen auf fehlenden Strom zurück.`
              }`
            : undefined
        }
        evidence={situation.evidence}
        source={situation.source}
        kpis={[
          {
            value: int(k.minutesAtLimit),
            unit: "min",
            label: `Minuten voll ausgelastet (Anschluss ${powerText(situation.gridLimitKw)})`,
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

      <Section title="Warum Abflüge warten" kicker="Ursachen" id="engpass-cause">
        {situation.delayedDepartures === 0 ? (
          <p className="aec-muted">An diesem Tag wartet kein Abflug auf Strom oder Fahrzeug.</p>
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
          <p className="aec-muted">Der Anschluss reicht den ganzen Tag.</p>
        )}
        <p className="aec-muted">In knappen Phasen starten {int(affected)} Abflüge.</p>
        <Link
          to={{ page: "projekt", projekt: route.projekt, frage: "varianten" }}
          className="aec-button"
        >
          Lösungen durchrechnen
        </Link>
      </Section>

      <Details summary="Flugplan, Fahrzeuge und Laden im Zusammenspiel (für Fachleute)">
        <WerkstattLinks items={["betrieb"]} base={route} />
      </Details>
    </>
  );
}
