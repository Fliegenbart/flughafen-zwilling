import AirportEnergyCheck from "./aec/AirportEnergyCheck";
import { legacyRedirect } from "./aec/routes";
import "./WorkspaceApp.css";

/**
 * Ein Produkt: Airport Energy Check. Alte Arbeitsbereiche (`?workspace=airport|munich|flexlab`)
 * werden vor dem ersten Rendern auf ihre neuen Orte umgeleitet; die Werkzeuge selbst
 * bleiben als "Werkstatt" vollstaendig erreichbar.
 */
export default function WorkspaceApp() {
  const basePath = import.meta.env.BASE_URL;
  const target = legacyRedirect(window.location.search);
  if (target !== null) {
    try {
      window.history.replaceState(null, "", `${basePath}${target}${window.location.hash}`);
    } catch {
      /* ohne Verlauf: Route wird trotzdem aus `target` gelesen */
    }
  }
  return <AirportEnergyCheck basePath={basePath} />;
}
