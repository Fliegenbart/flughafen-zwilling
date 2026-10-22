import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AirportEnergyCheck from "../AirportEnergyCheck";
import { bodies, serve } from "./__fixtures__/server";
import { forgetShared } from "./useOekosystem";

const open = (search = "?seite=fachleute") => {
  window.history.replaceState(null, "", `/${search}`);
  return render(<AirportEnergyCheck basePath="/" />);
};
const slider = (name: string) => screen.getByRole("slider", { name });

beforeEach(() => {
  bodies.length = 0;
  forgetShared();
});
afterEach(() => {
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
});

describe("Seite für Fachleute", () => {
  it("nimmt die Einstellung von der Übersicht mit und zurück", async () => {
    serve();
    open("");
    await screen.findByText(/überlasten/);
    fireEvent.change(slider("Netzanschluss heute"), { target: { value: "650" } });
    await waitFor(() => expect(window.location.search).toBe("?anschluss=650"));
    fireEvent.click(screen.getByRole("link", { name: "Ausführlicher Vergleich für Fachleute" }));
    await waitFor(() => expect(window.location.search).toBe("?seite=fachleute&anschluss=650"));
    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: "Wie viel Anschluss braucht das Vorfeld, und warum?",
      }),
    ).toBeVisible();
    expect(await screen.findByText(/^Ihr Anschluss muss um 25\skW wachsen/)).toBeVisible();
    expect(screen.getByRole("columnheader", { name: /Bei Ihren 650\skW/ })).toBeVisible();
    fireEvent.click(screen.getByRole("link", { name: "Zur Übersicht" }));
    await waitFor(() => expect(window.location.search).toBe("?anschluss=650"));
    expect(slider("Netzanschluss heute")).toHaveValue("650");
  });

  it("stellt vier Rechnungen mit Bedarf und Urteil nebeneinander", async () => {
    serve();
    open();
    const table = (await screen.findByText("Vier Rechnungen mit derselben Flotte"))
      .closest("section")!
      .querySelector("table")!;
    await waitFor(() => expect(table).not.toHaveTextContent("wird gerechnet"));
    const lines = within(table)
      .getAllByRole("row")
      .slice(1)
      .map((r) => r.textContent);
    expect(lines).toEqual([
      expect.stringMatching(
        /^1Ohne Steuerung.*sobald ein Ladepunkt frei ist.*Benötigt 1.625\skW.*Überlast, Spitze 1.614\skW$/,
      ),
      expect.stringMatching(/^Einfache Leistungsbegrenzung.*Benötigt 875\skW.*reicht$/),
      expect.stringMatching(
        /^2Lademanagement.*Diesen Wert zeigt die Übersicht\.Benötigt 800\skW.*reicht$/,
      ),
      expect.stringMatching(
        /^3\+\sSpeicher.*2,0 MWh Speicher und 1.000\skW.*Benötigt 675\skW.*reicht$/,
      ),
    ]);
  });

  it("zeigt Kurve und Kennzahlen der gewählten Rechnung", async () => {
    serve();
    open();
    expect(
      await screen.findByRole("heading", {
        name: /So laufen drei Tage ohne Steuerung, bei Ihren 1.500\skW/,
      }),
    ).toBeVisible();
    expect(screen.getByText("Über Ihrem Anschluss").nextSibling).toHaveTextContent(
      /bis zu 114\skW/,
    );
    fireEvent.click(screen.getByRole("button", { name: /^Lademanagement/ }));
    expect(
      screen.getByRole("heading", { name: "Netzlast über drei Tage mit Lademanagement" }),
    ).toBeVisible();
    expect(
      screen.getByText("Abflüge mit allen Fahrzeugen rechtzeitig bereit").nextSibling,
    ).toHaveTextContent("540 von 540");
    expect(screen.getByText(/grau zum Vergleich ohne Steuerung/)).toBeVisible();
  });

  it("begründet den Bedarf mit Flotte, Flugplan und Annahmen der Regler", async () => {
    serve();
    open("?seite=fachleute&pv=2000&parkhaus=100");
    const fleet = (await screen.findByText("Vorfeldflotte des Beispielflughafens")).closest(
      "table",
    )!;
    expect(within(fleet).getByRole("row", { name: /Gepäckschlepper/ })).toHaveTextContent(
      /^Gepäckschlepper351850 kWh7,7 kWh12 × 22\skW$/,
    );
    const basis = within(
      screen.getByRole("heading", { name: "Woraus der Bedarf entsteht" }).closest("section")!,
    );
    expect(basis.getByText(/Photovoltaik: 2.000 kWp/)).toHaveTextContent(
      /höchstens 20 % der Nennleistung/,
    );
    expect(basis.getByText(/Parkhaus: 100 Ladevorgänge am Tag/)).toHaveTextContent(
      /je Auto bis zu 11\skW.*Reisende kommen zwei bis drei Stunden vor ihrem Abflug.*wenn Leistung frei ist/,
    );
    expect(screen.getByText(/Der mittlere der drei Tage trägt sich selbst/)).toBeVisible();
    expect(basis.getByText(/je 60 Abflüge zwischen 6 und 9/)).toHaveTextContent(/180 am Tag/);
    expect(screen.getByRole("heading", { name: "Wann ein Anschluss reicht" })).toBeVisible();
    expect(screen.getByText(/bis zu seiner Frist erledigt/)).toBeVisible();
    expect(screen.getByRole("link", { name: "He et al. (2026)" })).toHaveAttribute(
      "href",
      "https://doi.org/10.1038/x",
    );
    expect(bodies[bodies.length - 1]).toMatchObject({ pv_kwp: 2000, parking_sessions: 100 });
  });

  it("setzt eine Stellung aus der Adresse auf die gerechneten Werte", async () => {
    serve();
    open("?seite=fachleute&anteil=47&anschluss=1490&pv=abc");
    await screen.findByText(/überlasten/);
    expect(slider("Elektrische Fahrzeuge im Vorfeld")).toHaveAttribute(
      "aria-valuetext",
      "50\u00a0%",
    );
    expect(slider("Netzanschluss heute")).toHaveValue("1500");
    await waitFor(() => expect(window.location.search).toBe("?seite=fachleute"));
  });

  it("fragt den Server erst nach dem Einrasten und bietet nach einem Fehler einen neuen Versuch", async () => {
    let fail = true;
    serve({ failCompare: () => fail });
    open("?seite=fachleute&anteil=47&speicher=2100");
    expect(await screen.findByRole("alert")).toHaveTextContent("Rechnung fehlgeschlagen");
    expect(bodies.map((b) => [b.electric_share_pct, b.storage_kwh])).toEqual([[50, 2000]]);
    expect(screen.getAllByText("nicht gerechnet")).toHaveLength(4);
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Erneut rechnen" }));
    expect(screen.queryByText("nicht gerechnet")).toBeNull();
    expect(await screen.findAllByText("reicht")).toHaveLength(3);
    expect(bodies).toHaveLength(2);
  });

  it("rechnet beim Wechsel zwischen den Seiten nicht neu und behält die Stufe", async () => {
    serve();
    open("");
    await screen.findByRole("img", { name: /Überlast/ });
    fireEvent.click(screen.getByRole("button", { name: /\+\sSpeicher/ }));
    const atlasCalls = () =>
      (fetch as unknown as { mock: { calls: [string][] } }).mock.calls.filter(([u]) =>
        u.endsWith("/atlas"),
      ).length;
    expect(atlasCalls()).toBe(1);
    fireEvent.click(screen.getByRole("link", { name: "Ausführlicher Vergleich für Fachleute" }));
    expect(
      await screen.findByRole("heading", {
        name: "Netzlast über drei Tage mit Lademanagement und Speicher",
      }),
    ).toBeVisible();
    expect(atlasCalls()).toBe(1);
    expect(bodies).toHaveLength(1);
  });

  it("nennt den Speicher ohne Vorteil, statt eine höhere Zahl zu zeigen", async () => {
    serve();
    open("?seite=fachleute&parkhaus=200");
    const row = (await screen.findByText(/MWh Speicher senken hier den Bedarf nicht/)).closest(
      "tr",
    )!;
    expect(within(row).getByRole("button")).toBeDisabled();
    expect(row).not.toHaveTextContent("1.400");
  });

  it("zeigt keine Messdaten-Werkzeuge, Läufe oder Altprojekte", async () => {
    serve();
    open();
    await screen.findByText(/überlasten/);
    const text = document.body.textContent ?? "";
    for (const word of ["SIL", "Messdatei", "Lauf", "Eigene Projekte", "Lastprofil & Messdaten"])
      expect(text).not.toContain(word);
  });
});
