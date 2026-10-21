/**
 * Echte Flughaefen: Auswahl im Kopf, Steckbrief mit oeffentlichen Quellen und die Annahmen,
 * mit denen das Modell den Flughafen abbildet. Neutral formuliert; nichts davon ist mit dem
 * Flughafen abgestimmt, und das steht auch so da.
 */
import type { AirportProfile, Basis } from "../api/electrification";
import { useNav } from "../context";
import { int } from "../model/format";
import { kw } from "./stufen";

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

/** Flughafen waehlen; ein Wechsel startet mit den Werten dieses Flughafens. */
export function AirportPicker({
  airports,
  current,
  page,
}: {
  airports: AirportProfile[];
  current: string | null;
  page: "start" | "fachleute";
}) {
  const { navigate } = useNav();
  if (!airports.length) return <span className="oe-brand__sub">Beispielflughafen, erfunden</span>;
  const sorted = [...airports].sort((a, b) => b.departures_per_day - a.departures_per_day);
  return (
    <label className="oe-picker">
      <span className="oe-picker__label">Flughafen</span>
      <select
        value={current ?? ""}
        onChange={(e) =>
          navigate({ page, ...(e.target.value ? { flughafen: e.target.value } : {}) })
        }
      >
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

function Sources({ urls }: { urls: string[] }) {
  if (!urls.length) return null;
  return (
    <span className="oe-sources">
      {urls.map((url) => (
        <a key={url} href={url} target="_blank" rel="noreferrer">
          {host(url)}
        </a>
      ))}
    </span>
  );
}

/** Kurzer Steckbrief fuer die Startseite: Zahlen mit Quelle. */
export function AirportFacts({ profile }: { profile: AirportProfile }) {
  return (
    <section className="oe-facts" aria-labelledby="oe-facts-title">
      <h2 id="oe-facts-title">{profile.full_name} in Zahlen</h2>
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
        Aus öffentlichen Quellen, Stand {profile.as_of.slice(5)}/{profile.as_of.slice(0, 4)}. Nicht
        mit dem Flughafen abgestimmt.
      </p>
    </section>
  );
}

function Item({ title, basis, children }: { title: string; basis: Basis; children?: string }) {
  return (
    <li>
      <strong>{title}</strong>
      {children ? `: ${children}` : ""}
      {basis.assumption ? <span className="oe-tag">Annahme</span> : null}
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
      <Item title="Flotte" basis={profile.fleet.basis}>
        {fleet}
      </Item>
      <Item title="Elektroanteil heute" basis={profile.electric_share_basis}>
        {profile.electric_share_now_pct == null
          ? "nicht veröffentlicht"
          : `rund ${int(profile.electric_share_now_pct)} %`}
      </Item>
      <Item title="Parkhaus" basis={profile.parking_basis}>
        {`${int(profile.parking_sessions_per_day)} Ladevorgänge am Tag`}
      </Item>
      {profile.reserve_basis && profile.reserve_kw_public ? (
        <Item title="Veröffentlichte Reserve" basis={profile.reserve_basis}>
          {kw(profile.reserve_kw_public)}
        </Item>
      ) : null}
    </ul>
  );
}
