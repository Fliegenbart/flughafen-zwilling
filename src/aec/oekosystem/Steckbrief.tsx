/**
 * Echte Flughaefen: Auswahl im Kopf, Steckbrief mit oeffentlichen Quellen und die Annahmen,
 * mit denen das Modell den Flughafen abbildet. Neutral formuliert; nichts davon ist mit dem
 * Flughafen abgestimmt, und das steht auch so da (einmal, in der Fusszeile).
 */
import { useEffect, useRef } from "react";
import type { AirportProfile, Basis } from "../api/electrification";
import { useNav } from "../context";
import { int } from "../model/format";
import { kw } from "./stufen";
import { keepPresentationAcrossSwitch } from "./usePresentation";

const FLEET_NAMES: Record<string, string> = {
  bus: "Vorfeldbusse",
  baggage_tractor: "Gepäckschlepper",
  pushback_tug: "Flugzeugschlepper",
  gpu: "Bodenstromgeräte",
};

const host = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "Quelle";
  }
};

/** Fahrzeuge, die das Modell fuer den Flughafen rechnet (vier Klassen). */
export const modelFleet = (profile: AirportProfile) =>
  Object.values(profile.fleet.vehicles).reduce((a, b) => a + b, 0);

// Nach einem Wechsel bekommt die neu aufgebaute Auswahl den Fokus zurueck (Tastatur).
let focusAfterSwitch = false;

/** Flughafen waehlen; ein Wechsel startet mit den Werten dieses Flughafens. */
export function AirportPicker({
  airports,
  current,
  loading,
  page,
}: {
  airports: AirportProfile[];
  current: string | null;
  loading: boolean;
  page: "start" | "fachleute";
}) {
  const { navigate } = useNav();
  const select = useRef<HTMLSelectElement>(null);
  useEffect(() => {
    if (focusAfterSwitch && select.current) {
      focusAfterSwitch = false;
      select.current.focus();
    }
  });
  if (!airports.length && !current)
    return <span className="oe-brand__sub">Beispielflughafen, erfunden</span>;
  if (!airports.length && loading)
    return <span className="oe-brand__sub">Flughafen wird geladen …</span>;
  const sorted = [...airports].sort((a, b) => b.departures_per_day - a.departures_per_day);
  const known = !current || sorted.some((a) => a.id === current);
  return (
    <label className="oe-picker">
      <span className="oe-picker__label">Flughafen</span>
      <select
        ref={select}
        value={current ?? ""}
        onChange={(e) => {
          focusAfterSwitch = true;
          keepPresentationAcrossSwitch();
          navigate({ page, ...(e.target.value ? { flughafen: e.target.value } : {}) });
        }}
      >
        {known ? null : (
          <option value={current!} disabled>
            {current} (nicht verfügbar)
          </option>
        )}
        <option value="">Beispielflughafen (erfunden)</option>
        {sorted.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name} ({a.id})
          </option>
        ))}
      </select>
    </label>
  );
}

/** Quellen als Links; gleiche Adressen werden durchnummeriert, damit man sie unterscheidet. */
function Sources({ urls }: { urls: string[] }) {
  if (!urls.length) return null;
  const hosts = urls.map(host);
  return (
    <span className="oe-sources">
      {urls.map((url, i) => {
        const same = hosts.filter((h) => h === hosts[i]).length > 1;
        const nth = hosts.slice(0, i + 1).filter((h) => h === hosts[i]).length;
        return (
          <a key={url} href={url} target="_blank" rel="noreferrer">
            {same ? `${hosts[i]} (${nth})` : hosts[i]}
            <span className="oe-sr"> (öffnet neues Fenster)</span>
          </a>
        );
      })}
    </span>
  );
}

/** Kurzer Steckbrief fuer die Startseite: Zahlen mit Quelle. */
export function AirportFacts({ profile }: { profile: AirportProfile }) {
  return (
    <section className="oe-facts" aria-labelledby="oe-facts-title">
      <h2 id="oe-facts-title">Das berichten öffentliche Quellen über {profile.name}</h2>
      <dl>
        {profile.facts.map((fact) => (
          <div key={fact.label}>
            <dt>{fact.label}</dt>
            <dd>
              {fact.value} <Sources urls={[fact.source]} />
            </dd>
          </div>
        ))}
      </dl>
      <p className="oe-note">
        Stand {profile.as_of.slice(5)}/{profile.as_of.slice(0, 4)}.
      </p>
    </section>
  );
}

function Item({ title, basis, children }: { title: string; basis: Basis; children?: string }) {
  return (
    <li>
      <strong>{title}</strong>
      {children ? `: ${children}` : ""}
      {basis.assumption ? (
        <>
          {" "}
          <span className="oe-tag">
            <span className="oe-sr">(</span>Annahme<span className="oe-sr">)</span>
          </span>
        </>
      ) : null}
      <span className="oe-basis">
        {basis.text} <Sources urls={basis.sources} />
      </span>
    </li>
  );
}

/** Fuer Fachleute: wie das Modell den Flughafen abbildet, jede Groesse mit Begruendung. */
export function AirportModel({ profile }: { profile: AirportProfile }) {
  const fleet = Object.entries(profile.fleet.vehicles)
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `${int(n)} ${FLEET_NAMES[k] ?? k}`)
    .join(", ");
  const coverage = [
    `Busse bei ${int(profile.coverage_pct.bus ?? 0)} %`,
    `mobile Bodenstromgeräte bei ${int(profile.coverage_pct.gpu ?? 0)} %`,
  ].join(", ");
  return (
    <ul className="oe-list oe-model">
      <Item title="Abflüge" basis={profile.departures_basis}>
        {`${int(profile.departures_per_day)} an einem typischen Tag im Spitzenmonat`}
      </Item>
      <Item title="Tagesprofil" basis={profile.profile_basis} />
      <Item title="Einsätze je Flug" basis={profile.coverage_basis}>
        {`${coverage} der Flüge`}
      </Item>
      <Item title="Flotte im Modell" basis={profile.fleet.basis}>
        {`${fleet}. Aus dem Modell bemessen, nicht der echte Bestand. Wo veröffentlicht, ist der echte Bestand größer, auch innerhalb dieser Klassen`}
      </Item>
      <Item title="Veröffentlichter Elektroanteil" basis={profile.electric_share_basis}>
        {profile.electric_share_now_pct == null
          ? "nicht veröffentlicht"
          : `rund ${int(profile.electric_share_now_pct)} %, anders abgegrenzt als die Modellflotte`}
      </Item>
      <Item title="Parkhaus" basis={profile.parking_basis}>
        {`${int(profile.parking_sessions_per_day)} Ladevorgänge am Tag, wenn zugeschaltet`}
      </Item>
      {profile.reserve_basis && profile.reserve_kw_public ? (
        <Item title="Veröffentlichte Reserve" basis={profile.reserve_basis}>
          {kw(profile.reserve_kw_public)}
        </Item>
      ) : null}
    </ul>
  );
}
