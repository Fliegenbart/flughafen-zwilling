import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import AirportEnergyCheck from "./AirportEnergyCheck";
import { exchangeFromApi } from "./api/exchange";
import { situationFromApi } from "./api/situation";
import { boardFromApi } from "./api/variants";
import { exchangeAnswer, nextStatus, whoseTurn } from "./model/exchange";
import { bottleneckAnswer, situationKpis } from "./model/situation";
import { legacyRedirect, parseRoute, toSearch } from "./routes";
import { SAMPLE_PROJECT, sampleExchange, sampleSituation } from "./sample";
import DayLandscape from "./DayLandscape";
import { SCENARIO_CASES } from "./scenarios";

afterEach(() => {
  window.history.replaceState(null, "", "/");
  sessionStorage.clear();
});

function openApp(search = "") {
  window.history.replaceState(null, "", `/${search}`);
  return render(<AirportEnergyCheck basePath="/" />);
}

describe("Adressen und Weiterleitungen", () => {
  it("liest und schreibt Projekt, Frage und Werkstatt", () => {
    const r = { page: "projekt", projekt: "p1", frage: "nachweis", werkstatt: "betrieb" } as const;
    expect(toSearch(r)).toBe("?projekt=p1&frage=nachweis&werkstatt=betrieb&schritt=betrieb");
    expect(parseRoute(toSearch(r))).toEqual(r);
    // Durchrechnen ist die Hauptseite des Projekts; Unbekanntes landet dort.
    expect(parseRoute("?projekt=p1&frage=quatsch")).toEqual({
      page: "arbeitsplatz",
      projekt: "p1",
    });
    expect(parseRoute("")).toEqual({ page: "start" });
  });

  it("leitet alle alten Arbeitsbereiche auf neue Orte um", () => {
    expect(legacyRedirect("")).toBeNull();
    expect(legacyRedirect("?workspace=airport")).toBe("?seite=bibliothek&werkstatt=simulation");
    expect(legacyRedirect("?workspace=flexlab")).toContain("seite=lab&projekt=");
    expect(legacyRedirect("?workspace=flexlab")).toContain("werkstatt=flexlab");
    expect(legacyRedirect("?workspace=munich")).toContain("frage=daten&werkstatt=system");
    expect(legacyRedirect("?workspace=munich&schritt=pilot")).toContain("seite=lab");
    expect(legacyRedirect("?workspace=munich&schritt=nachweise")).toContain("frage=nachweis");
  });

  it("führt die Adressen der früheren Seiten Tag, Engpass und Lösungen zu Durchrechnen", () => {
    expect(legacyRedirect("?projekt=p1&frage=lage")).toBe("?projekt=p1");
    expect(legacyRedirect("?projekt=p1&ansicht=neu")).toBe("?projekt=p1");
    expect(legacyRedirect("?projekt=p1&frage=varianten&krise=enteisung")).toBe(
      "?projekt=p1&krise=enteisung",
    );
    // Detailwerkzeuge ziehen auf die Seite um, zu der sie jetzt gehören.
    expect(legacyRedirect("?projekt=p1&frage=engpass&werkstatt=betrieb&schritt=betrieb")).toBe(
      "?projekt=p1&frage=nachweis&werkstatt=betrieb&schritt=betrieb",
    );
    expect(
      legacyRedirect("?projekt=p1&frage=varianten&werkstatt=robustheit&schritt=robustheit"),
    ).toBe("?projekt=p1&frage=nachweis&werkstatt=robustheit&schritt=robustheit");
    // Aktuelle Adressen bleiben unberührt.
    expect(legacyRedirect("?projekt=p1")).toBeNull();
    expect(legacyRedirect("?projekt=p1&frage=daten")).toBeNull();
    expect(legacyRedirect("?projekt=p1&frage=nachweis")).toBeNull();
  });
});

describe("Antwortsatz zur knappsten Phase", () => {
  const s = sampleSituation();
  it("nennt das Engpassfenster und die fehlende Leistung aus den Daten", () => {
    const w = situationKpis(s).worst!;
    expect(w.deficitKw).toBeGreaterThan(0);
    expect(bottleneckAnswer(s)).toMatch(
      /^Von \d\d:\d\d bis \d\d:\d\d Uhr fehlen bis zu [\d,]+\sMW\./,
    );
  });
  it("sagt ehrlich, wenn nichts eng wird", () => {
    const calm = { ...s, gridLimitKw: 10000 };
    expect(bottleneckAnswer(calm)).toBe("Es wird an keinem Punkt des Tages eng.");
  });
});

describe("Varianten aus der API", () => {
  it("liest Kennzahlen, Antwortsatz und Fortschritt", () => {
    const board = boardFromApi({
      base: {
        source: "coupled_run",
        policy: "uncontrolled",
        grid_import_limit_kw: 3500,
        storage_kwh: 0,
        fleet: { total_vehicles: 100, by_kind: [], source: "coupled_run" },
      },
      variants: [
        { id: "v1", name: "+5 Schlepper", changes: { extra_vehicles: { pushback_tug: 5 } } },
      ],
      latest_run: {
        status: "completed",
        progress: { done: 2, total: 2 },
        stress: false,
        stale: false,
        entries: [
          {
            key: "base",
            name: "Basis",
            changes: {},
            evidence_level: "model_checked",
            kpis: {
              on_time_pct: 70,
              minutes_at_limit: 90,
              peak_kw: 3500,
              grid_energy_mwh_day: 10,
              delayed_departures: 30,
              departures_total: 100,
              missing_kw_peak: 400,
            },
          },
          {
            key: "v1",
            name: "+5 Schlepper",
            changes: { extra_vehicles: { pushback_tug: 5 } },
            evidence_level: "synthetic",
            delta_to_base: { on_time_pct: 12, minutes_at_limit: -3 },
            fleet: { total_vehicles: 105, by_kind: [] },
            kpis: { on_time_pct: 82, minutes_at_limit: 87, peak_kw: 3500, grid_energy_mwh_day: 10 },
          },
        ],
        answer: {
          status: "winner",
          best_variant_id: "v1",
          headline: "„+5 Schlepper“ hilft am meisten.",
          details: [],
        },
      },
    })!;
    expect(board.source).toBe("api");
    expect(board.base?.fleet.total).toBe(100);
    expect(board.variants.map((v) => v.kind)).toEqual(["basis", "fahrzeuge"]);
    expect(board.variants[1]!.deltaOnTimePct).toBe(12);
    expect(board.variants[1]!.fleetTotal).toBe(105);
    expect(board.answer?.bestId).toBe("v1");
    expect(board.run?.done).toBe(2);
  });
  it("lehnt Unbrauchbares ab", () => {
    expect(boardFromApi({})).toBeNull();
  });
});

describe("Austausch-Status", () => {
  const items = sampleExchange("p");
  it("folgt vorgeschlagen → angenommen → geplant → erledigt", () => {
    expect(nextStatus("vorgeschlagen")).toBe("angenommen");
    expect(nextStatus("geplant")).toBe("erledigt");
    expect(nextStatus("erledigt")).toBeNull();
    expect(nextStatus("uebergeben")).toBeNull();
  });
  it("zeigt, wer am Zug ist", () => {
    const [geplant, vorgeschlagen, erledigt] = items;
    expect(whoseTurn(geplant!)).toBe("lab");
    expect(whoseTurn(vorgeschlagen!)).toBe("lab");
    expect(whoseTurn({ ...vorgeschlagen!, from: "lab" })).toBe("flughafen");
    expect(whoseTurn(erledigt!)).toBeNull();
    expect(exchangeAnswer(items)).toBe("2 Punkte warten auf das Lab.");
  });
  it("übersetzt API-Items aus dem Vertrag", () => {
    const item = exchangeFromApi({
      id: "u1",
      type: "test_request",
      direction: "airport_to_lab",
      status: "scheduled",
      content: { question: "Hält der Ladepark?", component: "Bus-Ladepunkt 150 kW" },
      evidence_level: "assumption",
      created_at: "2026-10-05T08:00:00Z",
      updated_at: "2026-10-05T09:00:00Z",
    })!;
    expect(item).toMatchObject({
      kind: "testanfrage",
      status: "geplant",
      title: "Hält der Ladepark?",
      from: "flughafen",
    });
    expect(
      exchangeFromApi({
        id: "x",
        type: "lab_result",
        status: "done",
        evidence_level: "empirical_pass",
        content: {},
      }),
    ).toMatchObject({
      kind: "ergebnis",
      from: "lab",
      evidence: "empirical_passed",
    });
    expect(exchangeFromApi({ id: "y", type: "unknown" })).toBeNull();
  });
  it("übersetzt das Lagebild der API und markiert es als Netzbezug", () => {
    const s = situationFromApi(SAMPLE_PROJECT, {
      available: true,
      day_start_utc: "2026-10-03T22:00:00Z",
      interval_min: 15,
      series: [
        {
          start_utc: "2026-10-03T22:00:00Z",
          grid_import_kw: 800,
          grid_limit_kw: 3500,
          pv_kw: 0,
          charging_kw: 300,
        },
        {
          start_utc: "2026-10-04T04:00:00Z",
          grid_import_kw: 3500,
          grid_limit_kw: 3500,
          pv_kw: 0,
          charging_kw: 2500,
        },
      ],
      departures: [{ start_utc: "2026-10-04T04:00:00Z", count: 7 }],
      bottleneck_windows: [
        { start_utc: "2026-10-04T04:00:00Z", end_utc: "2026-10-04T04:30:00Z", peak_kw: 3500 },
      ],
      answer: { delayed_departures: 3, cause_shares_pct: { energy: 70, resource: 30 } },
      evidence_level: "model_checked",
    })!;
    expect(s.kind).toBe("bezug");
    expect(s.windows).toEqual([{ start: 360, end: 390, peakKw: 3500, deficitKw: 0 }]);
    expect(bottleneckAnswer(s)).toBe("Von 06:00 bis 06:30 Uhr ist der Anschluss voll ausgelastet.");
    expect(situationFromApi(SAMPLE_PROJECT, { available: false, series: [] })).toBeNull();
  });
});

describe("Oberfläche", () => {
  it("führt in drei Schritten durch das Projekt, jeder beginnt mit dem Antwortsatz", async () => {
    openApp(`?projekt=${SAMPLE_PROJECT.id}&frage=daten`);
    expect(
      await screen.findByRole("heading", { level: 1, name: /Noch ist keine der 4 Datenquellen/ }),
    ).toBeVisible();
    const nav = screen.getByRole("navigation", { name: "Drei Schritte des Projekts" });
    expect(within(nav).getAllByRole("link")).toHaveLength(3);
    // Kein Schritt "Abgleich" mehr in der Kundensicht.
    expect(within(nav).queryByRole("link", { name: /Abgleich/ })).toBeNull();
    fireEvent.click(within(nav).getByRole("link", { name: /Durchrechnen/ }));
    expect(await screen.findByRole("table")).toBeVisible();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(SAMPLE_PROJECT.name);
    expect(window.location.search).toBe(`?projekt=${SAMPLE_PROJECT.id}`);
    expect(document.title).toBe("Durchrechnen · Airport Energy Check");
    const steps = screen.getByRole("navigation", { name: "Drei Schritte des Projekts" });
    expect(within(steps).getByRole("link", { name: /Durchrechnen/ })).toHaveAttribute(
      "aria-current",
      "page",
    );
    fireEvent.click(within(steps).getByRole("link", { name: /Zusage/ }));
    expect(
      await screen.findByRole("heading", { level: 1, name: /erst nach einer Messung/ }),
    ).toBeVisible();
    await waitFor(() => expect(document.title).toBe("Zusage · Airport Energy Check"));
    // Kunde sieht nur den Pruefstatus, ohne Lab-Aktionen.
    expect(
      await screen.findByText(
        "Das Testing-Lab prüft gerade 2 Punkte, einen hat es abgeschlossen.",
        {
          exact: false,
        },
      ),
    ).toBeVisible();
    const status = screen.getByRole("heading", {
      level: 2,
      name: "Was das Testing-Lab gerade prüft",
    }).parentElement!.parentElement!;
    expect(within(status).queryByRole("button", { name: /erledigt|Annehmen/ })).toBeNull();
    expect(within(status).getByRole("button", { name: "Anfrage senden" })).toBeVisible();
  });

  it("leitet den alten Schritt Abgleich in den Lab-Raum um", () => {
    expect(parseRoute(`?projekt=p1&frage=abgleich`)).toEqual({ page: "lab", projekt: "p1" });
    expect(parseRoute(`?projekt=p1&frage=nachweis&werkstatt=pilot`)).toEqual({
      page: "lab",
      projekt: "p1",
      werkstatt: "pilot",
    });
    expect(toSearch({ page: "lab", projekt: "p1", werkstatt: "flexlab" })).toBe(
      "?seite=lab&projekt=p1&werkstatt=flexlab",
    );
  });

  it("zeigt im Testing-Lab den Eingang und schaltet den Status weiter", async () => {
    openApp(`?seite=lab&projekt=${SAMPLE_PROJECT.id}`);
    expect(await screen.findByText("Testing-Lab · interner Prüfraum")).toBeVisible();
    await waitFor(() => expect(document.title).toBe("Testing-Lab · Airport Energy Check"));
    expect(
      await screen.findByRole("heading", { level: 1, name: "2 Punkte warten auf das Lab." }),
    ).toBeVisible();
    const msg = screen.getByRole("article", { name: "Ladepunkt 150 kW unter Spitzenwelle prüfen" });
    expect(within(msg).getByText(/Am Zug:/)).toHaveTextContent("Am Zug: Testing-Lab");
    expect(screen.getByRole("heading", { level: 2, name: "Offene Anfragen" })).toBeVisible();
    expect(screen.getByRole("heading", { level: 2, name: "Ergebnisse aus dem Lab" })).toBeVisible();
    expect(screen.getByRole("heading", { level: 2, name: "Modell gegen Messung" })).toBeVisible();
    expect(screen.getByText("Noch nicht geprüft.")).toBeVisible();
    // Rollenschalter nur eingeklappt unter „Vorführung“.
    const demo = screen.getByText("Ansicht für Vorführungen wechseln").closest("details")!;
    expect(demo).not.toHaveAttribute("open");
    fireEvent.click(within(demo).getByRole("radio", { name: "Flughafen" }));
    expect(within(msg).queryByRole("button")).toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: "Testing-Lab" }));
    fireEvent.click(within(msg).getByRole("button", { name: "Als erledigt melden" }));
    expect(await within(msg).findByText("abgeschlossen")).toBeVisible();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Ein Punkt wartet auf das Lab.",
    );
  });

  it("zeigt alle acht Fälle in der Bibliothek und übernimmt einen ins Projekt", async () => {
    openApp("?seite=bibliothek");
    const cases = await screen.findAllByRole("article");
    expect(cases).toHaveLength(8);
    for (const c of SCENARIO_CASES)
      expect(screen.getByRole("heading", { name: c.name })).toBeVisible();
    expect(document.querySelectorAll(".aec-sv[data-viz]")).toHaveLength(8);
    fireEvent.click(screen.getByRole("button", { name: "Enteisung ins Projekt holen" }));
    expect(
      await screen.findByText(/„Enteisung“ gehört jetzt zu MUC · Vorfeld Süd \(Beispiel\)/),
    ).toBeVisible();
    expect(screen.getByText(/Kälte nimmt allen Akkus 20 % Kapazität/)).toBeVisible();
    fireEvent.click(screen.getByRole("link", { name: "Jetzt durchrechnen" }));
    await waitFor(() =>
      expect(window.location.search).toBe(`?projekt=${SAMPLE_PROJECT.id}&krise=enteisung`),
    );
  });

  it("liest den Krisenfall aus der Adresse und verwirft unbekannte", () => {
    const route = parseRoute("?projekt=p1&krise=schwarzstart");
    expect(route).toEqual({
      page: "arbeitsplatz",
      projekt: "p1",
      krise: "schwarzstart",
      auto: true,
    });
    expect(toSearch(route)).toBe("?projekt=p1&krise=schwarzstart");
    // Die frühere Adresse der Lösungen-Seite meint dasselbe, nur ohne Flugplan-Prüfung.
    expect(parseRoute("?projekt=p1&frage=varianten&krise=schwarzstart")).toEqual({
      page: "arbeitsplatz",
      projekt: "p1",
      krise: "schwarzstart",
    });
    expect(parseRoute("?projekt=p1&krise=gibtsnicht")).not.toHaveProperty("krise");
  });

  it("lässt sich auf der Startseite ein Projekt anlegen", async () => {
    openApp();
    expect(screen.getByRole("heading", { level: 1, name: /Reicht der Anschluss/ })).toBeVisible();
    fireEvent.change(screen.getByLabelText("Projektname"), {
      target: { value: "HAM · Vorfeld Nord" },
    });
    fireEvent.change(screen.getByLabelText("Flughafen und Anschlusspunkt"), {
      target: { value: "Hamburg" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Projekt anlegen" }));
    await waitFor(() => expect(window.location.search).toMatch(/projekt=lokal-.*frage=daten/));
  });
});

describe("Lagebild", () => {
  it("lässt sich mit der Tastatur durch den Tag bewegen", () => {
    render(<DayLandscape situation={sampleSituation()} />);
    const slider = screen.getByRole("slider", { name: "Uhrzeit im Tagesverlauf" });
    act(() => slider.focus());
    fireEvent.keyDown(slider, { key: "Home" });
    expect(slider).toHaveAttribute("aria-valuenow", "0");
    expect(slider.getAttribute("aria-valuetext")).toMatch(
      /^00:00 Uhr: Strombedarf .* noch .* frei/,
    );
    fireEvent.keyDown(slider, { key: "PageUp" });
    fireEvent.keyDown(slider, { key: "ArrowRight" });
    expect(slider).toHaveAttribute("aria-valuenow", "65");
    fireEvent.keyDown(slider, { key: "ArrowRight", shiftKey: true });
    expect(slider).toHaveAttribute("aria-valuenow", "125");
    fireEvent.keyDown(slider, { key: "End" });
    expect(slider).toHaveAttribute("aria-valuenow", "1435");
  });
  it("meldet im Engpassfenster die fehlende Leistung", () => {
    render(<DayLandscape situation={sampleSituation()} />);
    const slider = screen.getByRole("slider");
    expect(slider.getAttribute("aria-valuetext")).toMatch(/es fehlen .*knappe Phase/);
  });
});
