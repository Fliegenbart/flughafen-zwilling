import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import AirportEnergyCheck from "./AirportEnergyCheck";
import { boardFromApi, exchangeFromApi, situationFromApi } from "./api";
import {
  bottleneckAnswer,
  exchangeAnswer,
  nextStatus,
  situationAnswer,
  situationKpis,
  variantsAnswer,
  whoseTurn,
} from "./analysis";
import { legacyRedirect, parseRoute, toSearch } from "./routes";
import { SAMPLE_PROJECT, sampleExchange, sampleSituation, sampleVariants } from "./sample";
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
    const r = { page: "projekt", projekt: "p1", frage: "engpass", werkstatt: "betrieb" } as const;
    expect(toSearch(r)).toBe("?projekt=p1&frage=engpass&werkstatt=betrieb&schritt=betrieb");
    expect(parseRoute(toSearch(r))).toEqual(r);
    expect(parseRoute("?projekt=p1&frage=quatsch")).toEqual({
      page: "projekt",
      projekt: "p1",
      frage: "lage",
    });
    expect(parseRoute("")).toEqual({ page: "start" });
  });

  it("leitet alle alten Arbeitsbereiche auf neue Orte um", () => {
    expect(legacyRedirect("")).toBeNull();
    expect(legacyRedirect("?workspace=airport")).toBe("?seite=bibliothek&werkstatt=simulation");
    expect(legacyRedirect("?workspace=flexlab")).toContain("frage=abgleich&werkstatt=flexlab");
    expect(legacyRedirect("?workspace=munich")).toContain("frage=lage&werkstatt=system");
    expect(legacyRedirect("?workspace=munich&schritt=pilot")).toContain(
      "frage=abgleich&werkstatt=pilot",
    );
    expect(legacyRedirect("?workspace=munich&schritt=nachweise")).toContain("frage=nachweis");
  });
});

describe("Antwortsätze", () => {
  const s = sampleSituation();
  it("nennt das Engpassfenster und die fehlende Leistung aus den Daten", () => {
    const w = situationKpis(s).worst!;
    expect(w.deficitKw).toBeGreaterThan(0);
    expect(bottleneckAnswer(s)).toMatch(/^Zwischen 06:\d\d und 07:\d\d fehlen bis zu \d+\skW\./);
    expect(situationAnswer(s)).toMatch(/bis auf ein Fenster/);
  });
  it("sagt ehrlich, wenn nichts eng wird", () => {
    const calm = { ...s, gridLimitKw: 10000 };
    expect(bottleneckAnswer(calm)).toMatch(/nirgends eng/);
    expect(situationAnswer(calm)).toMatch(/trägt den ganzen Tag/);
  });
  it("benennt die beste Variante und die wirkungslosen", () => {
    const a = variantsAnswer(sampleVariants());
    expect(a).toMatch(/Pünktlichkeit: „\+5 Schlepper“ hilft am meisten \(\+18,0 Pp\.\)/);
    expect(a).toMatch(/Zielkonflikt: belastet das Netz stärker \(\+19 Minuten am Limit\)/);
    expect(a).toMatch(/Netz entlastet am stärksten: „Speicher 2 MWh“ \(−52 Minuten am Limit\)/);
  });
  it("sagt ausdrücklich, wenn keine Variante die Pünktlichkeit verbessert", () => {
    const vs = sampleVariants().map((v) => (v.kind === "basis" ? v : { ...v, onTimePct: 78.2 }));
    expect(variantsAnswer(vs)).toMatch(
      /^Keine Variante verbessert die Pünktlichkeit; Netz entlastet am stärksten: „Speicher 2 MWh“ \(−52 Minuten am Limit\)\./,
    );
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
    expect(exchangeAnswer(items)).toBe("2 offen: 2 Punkte beim Lab.");
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
    expect(bottleneckAnswer(s)).toBe("Zwischen 06:00 und 06:30 liegt der Anschluss am Limit.");
    expect(situationFromApi(SAMPLE_PROJECT, { available: false, series: [] })).toBeNull();
  });
});

describe("Oberfläche", () => {
  it("navigiert über die fünf Fragen und beginnt jede mit dem Antwortsatz", async () => {
    openApp(`?projekt=${SAMPLE_PROJECT.id}&frage=lage`);
    expect(
      await screen.findByRole("heading", { level: 1, name: /tragfähig bis auf ein Fenster/ }),
    ).toBeVisible();
    const nav = screen.getByRole("navigation", { name: "Fünf Fragen des Projekts" });
    expect(within(nav).getAllByRole("link")).toHaveLength(5);
    fireEvent.click(within(nav).getByRole("link", { name: /Engpass/ }));
    expect(await screen.findByRole("heading", { level: 1, name: /fehlen bis zu/ })).toBeVisible();
    expect(window.location.search).toContain("frage=engpass");
    expect(within(nav).getByRole("link", { name: /Engpass/ })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getAllByText("Beispieldaten").length).toBeGreaterThan(0);
    fireEvent.click(within(nav).getByRole("link", { name: /Varianten/ }));
    expect(
      await screen.findByRole("heading", { level: 1, name: /hilft am meisten/ }),
    ).toBeVisible();
    fireEvent.click(within(nav).getByRole("link", { name: /Nachweis/ }));
    expect(
      await screen.findByRole("heading", { level: 1, name: /erst nach dem Datenpilot/ }),
    ).toBeVisible();
    await waitFor(() => expect(document.title).toBe("Nachweis · Airport Energy Check"));
  });

  it("zeigt im Abgleich den Gesprächsverlauf und schaltet den Status weiter", async () => {
    openApp(`?projekt=${SAMPLE_PROJECT.id}&frage=abgleich`);
    expect(
      await screen.findByRole("heading", { level: 1, name: "2 offen: 2 Punkte beim Lab." }),
    ).toBeVisible();
    const msg = screen.getByRole("article", { name: "Ladepunkt 150 kW unter Spitzenwelle prüfen" });
    expect(within(msg).getByText(/Am Zug:/)).toHaveTextContent("Am Zug: Testing-Lab");
    fireEvent.click(screen.getByRole("radio", { name: "Flughafen" }));
    expect(within(msg).queryByRole("button")).toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: "Testing-Lab" }));
    fireEvent.click(within(msg).getByRole("button", { name: "Als erledigt melden" }));
    expect(await within(msg).findByText("abgeschlossen")).toBeVisible();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "1 offen: ein Punkt beim Lab.",
    );
  });

  it("zeigt alle acht Fälle in der Bibliothek und übernimmt einen ins Projekt", async () => {
    openApp("?seite=bibliothek");
    const cases = await screen.findAllByRole("article");
    expect(cases).toHaveLength(8);
    for (const c of SCENARIO_CASES)
      expect(screen.getByRole("heading", { name: c.name })).toBeVisible();
    expect(document.querySelectorAll(".aec-sv[data-viz]")).toHaveLength(8);
    fireEvent.click(screen.getByRole("button", { name: "Enteisung in Projekt übernehmen" }));
    expect(
      await screen.findByText(/„Enteisung“ ist in MUC · Vorfeld Süd \(Beispiel\) übernommen/),
    ).toBeVisible();
  });

  it("lässt sich auf der Startseite ein Projekt anlegen", async () => {
    openApp();
    expect(screen.getByRole("heading", { level: 1, name: /Reicht der Anschluss/ })).toBeVisible();
    fireEvent.change(screen.getByLabelText("Projektname"), {
      target: { value: "HAM · Vorfeld Nord" },
    });
    fireEvent.change(screen.getByLabelText("Flughafen und Netzabgang"), {
      target: { value: "Hamburg" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Anlegen/ }));
    await waitFor(() => expect(window.location.search).toMatch(/projekt=lokal-.*frage=daten/));
  });
});

describe("Lagebild", () => {
  it("lässt sich mit der Tastatur durch den Tag bewegen", () => {
    render(<DayLandscape situation={sampleSituation()} />);
    const slider = screen.getByRole("slider", { name: "Tageszeit im Lagebild" });
    act(() => slider.focus());
    fireEvent.keyDown(slider, { key: "Home" });
    expect(slider).toHaveAttribute("aria-valuenow", "0");
    expect(slider.getAttribute("aria-valuetext")).toMatch(/^00:00 Uhr: Bedarf .* Reserve/);
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
    expect(slider.getAttribute("aria-valuetext")).toMatch(/es fehlen .*Engpassfenster/);
  });
});
