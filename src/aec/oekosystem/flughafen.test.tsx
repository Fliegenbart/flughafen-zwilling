import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AirportEnergyCheck from "../AirportEnergyCheck";
import { bodies, serve } from "./__fixtures__/server";
import { forgetShared } from "./useOekosystem";

const open = (search: string) => {
  window.history.replaceState(null, "", `/${search}`);
  return render(<AirportEnergyCheck basePath="/" />);
};

beforeEach(() => {
  bodies.length = 0;
  forgetShared();
});
afterEach(() => {
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
});

describe("Echter Flughafen", () => {
  it("zeigt bei offener Reserve nur den Bedarf und rechnet mit dem Bedarf mit Lademanagement", async () => {
    serve({ airports: true });
    open("?flughafen=TST");
    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: "Wie viel Reserve braucht das Vorfeld in Teststadt, wenn es elektrisch fährt?",
      }),
    ).toBeVisible();
    expect(
      screen.getByText(
        /^Ohne Steuerung bräuchte das Vorfeld in Teststadt 1.850\skW Reserve, mit Lademanagement 950\skW, mit Speicher 900\skW\.$/,
      ),
    ).toBeVisible();
    expect(screen.getByText(/Mit Lademanagement nötig 950\skW/)).toBeInTheDocument();
    expect(
      screen.getByText(/Gerechnet sind 137 Busse, Schlepper und Bodenstromgeräte im Modell/),
    ).toBeVisible();
    expect(screen.getByText("offen")).toBeVisible();
    expect(
      screen.getByRole("slider", { name: "Elektrische Fahrzeuge im Vorfeld" }),
    ).toHaveAttribute("aria-valuetext", "30 %");
    expect(
      screen.getByText(/41 von 137 Fahrzeugen im Modell fahren elektrisch, heute rund 32 %/),
    ).toBeVisible();
    expect(screen.queryByRole("slider", { name: "Photovoltaik" })).toBeNull();
    await waitFor(() => expect(bodies.length).toBeGreaterThan(0));
    expect(bodies[0]).toEqual({
      electric_share_pct: 30,
      grid_import_limit_kw: 950,
      storage_kwh: 4500,
      pv_kwp: 0,
      parking_sessions: 0,
      airport: "TST",
    });
    expect(
      await screen.findByRole("img", {
        name: "Ohne Steuerung liegen die Ladespitzen über dem Bedarf mit Lademanagement.",
      }),
    ).toBeInTheDocument();
  });

  it("trägt die Reserve ein und urteilt erst dann", async () => {
    serve({ airports: true });
    open("?flughafen=TST");
    fireEvent.click(await screen.findByRole("button", { name: /Reserve eintragen/ }));
    const reserve = screen.getByRole("slider", { name: "Reserve fürs Vorfeld" });
    expect(reserve).toHaveValue("950");
    expect(
      screen.getByText(
        /^Ungesteuertes Laden würde Ihre Reserve von 950\skW überlasten\. Mit Lademanagement reicht sie, ohne mehr Reserve\.$/,
      ),
    ).toBeVisible();
    await waitFor(() => expect(window.location.search).toBe("?flughafen=TST&anschluss=950"));
    fireEvent.change(reserve, { target: { value: "800" } });
    expect(screen.getByText(/^Ihre Reserve muss um 100\skW größer werden/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Reserve offen lassen" }));
    expect(screen.getByText(/^Ohne Steuerung bräuchte das Vorfeld in Teststadt/)).toBeVisible();
    await waitFor(() => expect(window.location.search).toBe("?flughafen=TST"));
  });

  it("wechselt über die Auswahl zwischen Beispiel und Flughafen", async () => {
    serve({ airports: true });
    open("");
    const picker = await screen.findByRole("combobox", { name: "Flughafen" });
    await screen.findByText(/überlasten/);
    fireEvent.change(picker, { target: { value: "TST" } });
    expect(
      await screen.findByText(/^Ohne Steuerung bräuchte das Vorfeld in Teststadt/),
    ).toBeVisible();
    expect(window.location.search).toBe("?flughafen=TST");
    fireEvent.change(screen.getByRole("combobox", { name: "Flughafen" }), {
      target: { value: "" },
    });
    expect(await screen.findByText(/Ihren Anschluss von 1.500\skW überlasten/)).toBeVisible();
  });

  it("zeigt den Steckbrief mit Quellen und sagt, dass nichts abgestimmt ist", async () => {
    serve({ airports: true });
    open("?flughafen=TST");
    const facts = (
      await screen.findByRole("heading", { name: "Flughafen Teststadt in Zahlen" })
    ).closest("section")!;
    expect(within(facts).getByText("Nachtruhe").nextSibling).toHaveTextContent("23 bis 6 Uhr");
    expect(within(facts).getAllByRole("link")[0]).toHaveAttribute(
      "href",
      "https://example.org/passagiere",
    );
    expect(
      screen.getByText(/Nicht mit dem Flughafen abgestimmt/, { selector: "footer p" }),
    ).toBeVisible();
  });

  it("begründet auf der Fachleute-Seite jede Modellgröße und markiert Annahmen", async () => {
    serve({ airports: true });
    open("?seite=fachleute&flughafen=TST");
    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: "Wie viel Reserve braucht das Vorfeld in Teststadt, und warum?",
      }),
    ).toBeVisible();
    expect(screen.getByRole("columnheader", { name: "Benötigte Reserve" })).toBeVisible();
    const model = (await screen.findByText(/Abflüge/, { selector: "strong" })).closest("ul")!;
    expect(model).toHaveTextContent("420 an einem typischen Tag im Spitzenmonat");
    expect(model).toHaveTextContent("37 Vorfeldbusse, 49 Gepäckschlepper");
    expect(within(model).getAllByText("Annahme").length).toBeGreaterThanOrEqual(3);
    expect(screen.getByText(/nicht aus dem echten\s+Flugplan von Teststadt/)).toBeVisible();
    expect(screen.getByRole("link", { name: "Zur Übersicht" })).toHaveAttribute(
      "href",
      "/?flughafen=TST",
    );
  });

  it("meldet einen unbekannten Flughafen", async () => {
    serve({ airports: true });
    open("?flughafen=XYZ");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /Diesen Flughafen gibt es hier noch nicht|vorab gerechneten Werte fehlen/,
    );
  });
});
