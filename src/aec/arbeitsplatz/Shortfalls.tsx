/** Die knappen Phasen des Tages als Liste: wann, wie viel, zusammen wie viel Energie. */
import { clock, int, powerText } from "../model/format";
import { shortfallPhases } from "../model/headline";
import type { LiveResult } from "../model/livePower";

const SHOWN = 6;

export default function Shortfalls({ result }: { result: LiveResult }) {
  const list = shortfallPhases(result);
  if (!list.length) return null;
  return (
    <section className="ap-shortfalls" aria-labelledby="ap-shortfalls-title">
      <h2 id="ap-shortfalls-title" className="ap-outcome__title">
        Wann es knapp wird
      </h2>
      <ul>
        {list.slice(0, SHOWN).map((s) => (
          <li key={s.start}>
            <b>
              {clock(s.start)}–{clock(s.end)} Uhr
            </b>{" "}
            bis zu {powerText(s.maxMissingKw)} fehlen, zusammen {int(s.missingKwh)} kWh
          </li>
        ))}
        {list.length > SHOWN ? <li>und {list.length - SHOWN} weitere kurze Phasen</li> : null}
      </ul>
    </section>
  );
}
