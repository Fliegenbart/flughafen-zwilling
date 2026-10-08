import { useEffect } from "react";
import { dec1, int, powerText } from "../model/format";
import { bestVariant, variantsAnswer } from "../model/variants";
import { sampleVariants } from "../sample";
import { AnswerHead, Details, Section, SourceTag } from "../parts";
import type { ViewProps } from "../ProjectPage";
import Editor from "./loesungen/Editor";
import Runway from "./loesungen/Runway";
import VariantCards from "./loesungen/VariantCards";
import { WerkstattLinks } from "../Werkstatt";

export default function VariantenView({ project, board, reloadBoard, route }: ViewProps) {
  const running = board.run?.status === "queued" || board.run?.status === "running";
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => void reloadBoard(), 1500);
    return () => clearInterval(timer);
  }, [running, reloadBoard]);

  const api = board.source === "api";
  // Beispieldaten nur ohne gerechnete Projektvarianten, dann ueberall markiert.
  const computed = api && board.variants.length > 0;
  const variants = computed ? board.variants : api ? sampleVariants() : board.variants;
  const sample = !computed;
  const base = variants.find((v) => v.kind === "basis") ?? variants[0];
  const showResults = Boolean(base) && !running;
  const bestId = computed ? (board.answer?.bestId ?? null) : (bestVariant(variants)?.id ?? null);
  const best = variants.find((v) => v.id === bestId) ?? base;

  // Antwortsatz: aus der API (Backend entscheidet inkl. Epsilon), sonst Beispiel.
  let answer: string;
  let lead: string;
  if (computed && board.answer && !running) {
    answer = board.answer.headline;
    lead = board.answer.details.join(" ");
  } else if (api && running) {
    answer = "Die Lösungen werden gerade gerechnet.";
    lead = `${board.run!.done} von ${board.run!.total} Berechnungen fertig.`;
  } else if (api) {
    answer = board.definitions.length
      ? "Ausgewählt, aber noch nicht gerechnet."
      : "Noch ist keine Lösung ausgewählt.";
    lead = "Vorschläge antippen oder eine eigene Lösung zusammenstellen, dann durchrechnen.";
  } else {
    const full = variantsAnswer(variants);
    const cut = full.indexOf(". ") >= 0 ? full.indexOf(". ") + 1 : full.length;
    answer = full.slice(0, cut);
    lead = full.slice(cut).trim();
  }
  if (computed)
    lead = `${lead} Alle Lösungen wurden am selben Tag mit denselben Annahmen gerechnet.`;
  lead = lead.trim();

  const delta = best && base ? best.onTimePct - base.onTimePct : 0;
  const kpis =
    showResults && best && base && !(api && sample)
      ? [
          {
            value: dec1(best.onTimePct),
            unit: "%",
            label:
              best.id === base.id
                ? "der Abflüge pünktlich, heute"
                : `der Abflüge pünktlich mit „${best.name}“`,
            tone: "signal" as const,
          },
          {
            value: `${delta >= 0 ? "+" : "−"}${dec1(Math.abs(delta))}`,
            label: "Prozentpunkte gegenüber heute",
          },
          { value: int(best.minutesAtLimit), unit: "min", label: "Anschluss voll ausgelastet" },
          computed && best.missingKw != null
            ? {
                value: powerText(best.missingKw).split(" ")[0]!,
                unit: powerText(best.missingKw).split(" ")[1],
                label: "fehlen zum Laden in der Spitze",
              }
            : { value: dec1(best.gridEnergyMwh), unit: "MWh", label: "Strom aus dem Netz am Tag" },
        ]
      : [];

  return (
    <>
      <AnswerHead
        id="aec-view-title"
        question="Lösungen · Was hilft am meisten?"
        answer={answer}
        lead={lead}
        evidence={
          computed || running
            ? (best?.evidence ?? "assumption")
            : sample && !api
              ? "synthetic"
              : "assumption"
        }
        source={api ? "api" : "beispiel"}
        kpis={kpis}
      />

      {api ? (
        <Section title="Lösungen auswählen" kicker="Auswahl" id="var-edit">
          <Editor board={board} project={project} reload={reloadBoard} krise={route.krise} />
        </Section>
      ) : null}

      {showResults && base ? (
        <Section
          title={
            sample
              ? "So sieht das Ergebnis aus (Beispiel)"
              : "Wie viele Abflüge pünktlich fertig werden"
          }
          kicker="Im Vergleich"
          id="var-chart"
        >
          {sample ? (
            <p className="aec-muted aec-sample-note">
              <SourceTag source="beispiel" />
              {api ? " Ihre eigenen Zahlen erscheinen nach dem ersten Durchrechnen." : ""}
            </p>
          ) : null}
          <Runway variants={variants} base={base} bestId={bestId} />
        </Section>
      ) : null}

      {showResults && base && !(api && sample) ? (
        <VariantCards variants={variants} bestId={bestId} board={board} computed={computed} />
      ) : null}

      <Details summary="Belastungsproben und Abfertigung im Detail (für Fachleute)">
        <WerkstattLinks items={["robustheit", "simulation"]} base={route} />
      </Details>
    </>
  );
}
