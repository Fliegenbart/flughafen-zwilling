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
        /^Ohne Steuerung bräuchte das Vorfeld in Teststadt 2.400\skW Reserve, mit Lademanagement 1.200\skW, mit Speicher 1.100\skW\.$/,
      ),
    ).toBeVisible();
    expect(screen.getByText(/Mit Lademanagement nötig 1.200\skW/)).toBeInTheDocument();
    expect(
      screen.getByText(/Das Modell rechnet mit 137 Fahrzeugen in bis zu zehn Gerätearten/),
    ).toBeVisible();
    expect(screen.getByText("offen")).toBeVisible();
    expect(
      screen.getByRole("slider", { name: "Elektrische Fahrzeuge im Vorfeld" }),
    ).toHaveAttribute("aria-valuetext", "50\u00a0%");
    expect(
      screen.getByText(
        /69 von 137 Fahrzeugen im Modell fahren elektrisch; veröffentlicht: rund 32 % der Flughafenflotte/,
      ),
    ).toBeVisible();
    expect(screen.queryByRole("slider", { name: "Photovoltaik" })).toBeNull();
    await waitFor(() => expect(bodies.length).toBeGreaterThan(0));
    expect(bodies[0]).toEqual({
      electric_share_pct: 50,
      grid_import_limit_kw: 1200,
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
    // Ohne eingetragene Reserve ist das kein Mangel: grau statt rot, keine Ueberlast-Schraffur.
    expect(document.querySelector(".ap-chart__miss--neutral")).not.toBeNull();
    expect(document.querySelector(".oe-stage__over--neutral")).not.toBeNull();
    expect(document.querySelector(".oe-stage__value[data-over]")).toBeNull();
  });

  it("trägt die Reserve ein und urteilt erst dann", async () => {
    serve({ airports: true });
    open("?flughafen=TST");
    const enter = await screen.findByRole("button", { name: /Reserve eintragen/ });
    enter.focus();
    fireEvent.click(enter);
    const reserve = screen.getByRole("slider", { name: "Reserve fürs Vorfeld" });
    expect(reserve).toHaveValue("1200");
    expect(reserve).toHaveFocus();
    expect(
      screen.getByText(
        /^Ungesteuertes Laden bräuchte mehr als Ihre Reserve von 1.200\skW\. Mit Lademanagement reicht sie\.$/,
      ),
    ).toBeVisible();
    await waitFor(() => expect(window.location.search).toBe("?flughafen=TST&anschluss=1200"));
    fireEvent.change(reserve, { target: { value: "1000" } });
    expect(screen.getByText(/^Ihre Reserve muss um 100\skW größer werden/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Reserve offen lassen" }));
    expect(screen.getByRole("button", { name: /Reserve eintragen/ })).toHaveFocus();
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
      await screen.findByRole("heading", {
        name: "Das berichten öffentliche Quellen über Teststadt",
      })
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

  it("meldet einen unbekannten Flughafen und lässt zurück zum Beispiel wechseln", async () => {
    serve({ airports: true });
    open("?flughafen=XYZ");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /Diesen Flughafen gibt es hier noch nicht|vorab gerechneten Werte fehlen/,
    );
    const picker = await screen.findByRole("combobox", { name: "Flughafen" });
    expect(picker).toHaveValue("XYZ");
    fireEvent.change(picker, { target: { value: "" } });
    expect(await screen.findByText(/Ihren Anschluss von 1.500\skW überlasten/)).toBeVisible();
  });

  it("sagt ehrlich, wenn nur die Flughafenliste fehlt", async () => {
    serve({ airports: true });
    const stub = fetch as unknown as (url: string, init?: RequestInit) => Promise<Response>;
    vi.stubGlobal("fetch", (url: string, init?: RequestInit) =>
      url.endsWith("/demo/airports")
        ? Promise.resolve(new Response("", { status: 500 }))
        : stub(url, init),
    );
    open("?flughafen=TST");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Die Liste der Flughäfen ließ sich nicht laden.",
    );
    expect(screen.queryByText("Beispielflughafen, erfunden")).toBeNull();
  });
});
