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
        question="Engpass · Wo wird es eng?"
        answer={bottleneckAnswer(situation)}
        lead={
          k.windows.length
            ? `Der Anschluss liegt ${int(k.minutesAtLimit)} Minuten am Limit. ${
                situation.delayedDepartures === 0
                  ? "Kein Abflug wird dadurch verspätet abgefertigt; die Reserve ist aber aufgebraucht."
                  : vehicle >= 50
                    ? `Nur ${energy} % der Verspätungen sind energiebedingt; der eigentliche Engpass sind freie Fahrzeuge in der Flugwelle.`
                    : `${energy} % der Verspätungen sind energiebedingt.`
              }`
            : undefined
        }
        evidence={situation.evidence}
        source={situation.source}
        kpis={[
          {
            value: int(k.minutesAtLimit),
            unit: "min",
            label: `am Anschlusslimit (${powerText(situation.gridLimitKw)})`,
            tone: k.minutesAtLimit ? "signal" : undefined,
          },
          {
            value: deficit.value,
            unit: deficit.unit,
            label:
              situation.kind === "bedarf" && k.worst
                ? "fehlen in der Spitze"
                : "Spitzenlast Laden + Grundlast",
          },
          { value: int(situation.delayedDepartures), label: "Abflüge mit verspäteter Abfertigung" },
          situation.delayedDepartures
            ? { value: `${vehicle}`, unit: "%", label: "davon Ursache Fahrzeugverfügbarkeit" }
            : { value: int(affected), label: "Abflüge im Engpassfenster" },
        ]}
      />
      <div className="aec-stage">
        <DayLandscape
          situation={situation}
          size="panel"
          label="Engpass im Tagesverlauf, Tageszeit wählen"
        />
      </div>

      <Section title="Strom oder Fahrzeuge?" kicker="Ursache der Verspätungen" id="engpass-cause">
        {situation.delayedDepartures === 0 ? (
          <p className="aec-muted">
            Keine verspätete Abfertigung im gerechneten Tag – weder Strom noch Fahrzeuge bremsen.
          </p>
        ) : (
          <div
            className="aec-split"
            role="img"
            aria-label={`Ursachen: ${energy} Prozent Energie, ${vehicle} Prozent Fahrzeugverfügbarkeit`}
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

      <Section title="Engpassfenster" kicker={`${k.windows.length} am Tag`} id="engpass-windows">
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
                    ? `bis ${powerText(w.deficitKw)} fehlen`
                    : `Spitze ${powerText(w.peakKw)}`}
                </span>
                <span>{departuresInWindows(situation, [w])} Abflüge betroffen</span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="aec-muted">Kein Fenster: der Bedarf bleibt unter der Anschlussgrenze.</p>
        )}
        <p className="aec-muted">Im Engpass liegen {int(affected)} Abflüge.</p>
        <Link
          to={{ page: "projekt", projekt: route.projekt, frage: "varianten" }}
          className="aec-button"
        >
          Varianten dagegen rechnen
        </Link>
      </Section>

      <Details summary="Werkstatt: gekoppeltes Modell und Regelvergleich">
        <WerkstattLinks items={["betrieb"]} base={route} />
      </Details>
    </>
  );
}
