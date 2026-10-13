import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import AirportEnergyCheck from "./AirportEnergyCheck";
import { advanceExchange, exchangeFromApi, listExchange, proposeTest } from "./api/exchange";
import { situationFromApi } from "./api/situation";
import { boardFromApi } from "./api/variants";
import { exchangeAnswer, nextStatus, whoseTurn } from "./model/exchange";
import { bottleneckAnswer, situationAnswer, situationKpis } from "./model/situation";
import { variantsAnswer } from "./model/variants";
import { QUESTIONS, legacyRedirect, parseRoute, toSearch } from "./routes";
import { SAMPLE_PROJECT, sampleExchange, sampleSituation, sampleVariants } from "./sample";
import DayLandscape from "./DayLandscape";
import { SCENARIO_CASES } from "./scenarios";
import { claimsFor } from "./views/NachweisView";
import { pruefState } from "./views/Pruefstatus";
import type { ExchangeItem, Project } from "./types";

afterEach(() => {
  window.history.replaceState(null, "", "/");
  sessionStorage.clear();
});

function openApp(search = "") {
  window.history.replaceState(null, "", `/${search}`);
  return render(<AirportEnergyCheck basePath="/" />);
}

describe("Adressen und Weiterleitungen", () => {
  it("benennt die Fragen neutral fuer die Flughafen-Simulation", () => {
    expect(QUESTIONS.map((question) => question.label)).toEqual([
      "Flughafentag",
      "Engpass",
      "Varianten",
      "Nachweise & Prüfplan",
    ]);
  });

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
    expect(legacyRedirect("?workspace=flexlab")).toContain("seite=lab&projekt=");
    expect(legacyRedirect("?workspace=flexlab")).toContain("werkstatt=flexlab");
    expect(legacyRedirect("?workspace=munich")).toContain("frage=lage&werkstatt=system");
    expect(legacyRedirect("?workspace=munich&schritt=pilot")).toContain("seite=lab");
    expect(legacyRedirect("?workspace=munich&schritt=nachweise")).toContain("frage=nachweis");
  });
});

describe("Antwortsätze", () => {
  const s = sampleSituation();
  it("nennt das Engpassfenster und die fehlende Leistung aus den Daten", () => {
    const w = situationKpis(s).worst!;
    expect(w.deficitKw).toBeGreaterThan(0);
    expect(bottleneckAnswer(s)).toMatch(/^Von 06:\d\d bis 07:\d\d Uhr fehlen bis zu \d+\skW\./);
    expect(situationAnswer(s)).toMatch(/^Von 06:\d\d bis 07:\d\d Uhr reicht der Anschluss nicht\./);
  });
  it("sagt ehrlich, wenn nichts eng wird", () => {
    const calm = { ...s, gridLimitKw: 10000 };
    expect(bottleneckAnswer(calm)).toBe("Es wird an keinem Punkt des Tages eng.");
    expect(situationAnswer(calm)).toMatch(/reicht den ganzen Tag/);
  });
  it("ordnet Varianten als Ergebnisse dieser Simulation ein", () => {
    const a = variantsAnswer(sampleVariants());
    expect(a).toMatch(
      /^In dieser Simulation erreicht „5 Schlepper mehr“ die höchste Einsatzbereitschaft, 18,0 Prozentpunkte über der Ausgangslage\./,
    );
    expect(a).toMatch(/Dafür liegt der Anschluss in dieser Simulation 21 Minuten länger am Limit\./);
    expect(a).toMatch(
      /„Batteriespeicher 2 MWh“ verkürzt in dieser Simulation die Zeit am Anschlusslimit am stärksten, um 50 Minuten\./,
    );
  });
  it("sagt ausdrücklich, wenn keine Variante die Einsatzbereitschaft verbessert", () => {
    const vs = sampleVariants().map((v) => (v.kind === "basis" ? v : { ...v, onTimePct: 78.2 }));
    expect(variantsAnswer(vs)).toMatch(
      /^Keine Variante steigert in dieser Simulation die Einsatzbereitschaft um mehr als einen halben Prozentpunkt\. „Batteriespeicher 2 MWh“ verkürzt in dieser Simulation die Zeit am Anschlusslimit am stärksten, um 50 Minuten\./,
    );
  });
});

describe("Nachweise", () => {
  it("grenzt einen empirischen Nachweis auf den einzelnen Prüffall ein", () => {
    const claims = claimsFor(
      { project: SAMPLE_PROJECT },
      {
        source: "api",
        locked: true,
        sha256: "abc",
        elements: [],
        summary: { empirical_passed: 1 },
      },
    );

    expect(claims[claims.length - 1]).toMatchObject({
      level: "empirical_passed",
      title: "Was Messdaten belegen",
      text: expect.stringMatching(/abgegrenzten Prüffall.*nicht die gesamte Simulation/),
    });
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
  const item = (status: ExchangeItem["status"], from: ExchangeItem["from"] = "flughafen") =>
    ({
      id: `x-${status}`,
      kind: "testanfrage",
      title: "Lastgang am Vorfeld vergleichen",
      summary: "Messgrenze: Abgang Ladepark",
      from,
      status,
      evidence: "empirical_open",
      history: [],
      source: "api",
    }) as ExchangeItem;

  it("liefert für Beispielprojekte keine Demo-Aufträge", () => {
    expect(sampleExchange(SAMPLE_PROJECT.id)).toEqual([]);
  });

  it("lehnt lokale Austauschaktionen für das Beispielprojekt ab", async () => {
    await expect(proposeTest(SAMPLE_PROJECT, "Lastgang vergleichen", "Abgang Ladepark")).rejects.toThrow(
      "Für das Beispielprojekt kann kein Messdaten-Abgleich beauftragt werden.",
    );
    await expect(advanceExchange(SAMPLE_PROJECT, item("vorgeschlagen"), "angenommen", "lab")).rejects.toThrow(
      "Für das Beispielprojekt kann kein Messdaten-Abgleich fortgeschrieben werden.",
    );
  });

  it("gibt Austausch-API-Fehler weiter statt Beispielaufträge zu erfinden", async () => {
    const project: Project = { ...SAMPLE_PROJECT, id: "live-p1", source: "api" };
    const fetchMock = vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("offline"));

    await expect(listExchange(project)).rejects.toThrow("offline");

    fetchMock.mockRestore();
  });

  it("leitet sichtbare Prüfzustände direkt aus dem realen Status ab", () => {
    expect(pruefState(item("vorgeschlagen"))).toBe("angefragt");
    expect(pruefState(item("angenommen"))).toBe("angenommen");
    expect(pruefState(item("geplant"))).toBe("Messung geplant");
    expect(pruefState(item("erledigt"))).toBe("Messdaten ausgewertet");
  });

  const items = [item("geplant"), item("vorgeschlagen"), item("erledigt")];
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
    expect(exchangeAnswer(items)).toBe("2 Punkte warten auf den Messdaten-Abgleich.");
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
  it("navigiert über die vier Fragen und beginnt jede mit dem Antwortsatz", async () => {
    openApp(`?projekt=${SAMPLE_PROJECT.id}&frage=lage`);
    expect(
      await screen.findByRole("heading", { level: 1, name: /reicht der Anschluss nicht/ }),
    ).toBeVisible();
    const nav = screen.getByRole("navigation", { name: "Vier Fragen des Projekts" });
    expect(within(nav).getAllByRole("link")).toHaveLength(4);
    // Kein Schritt "Abgleich" mehr in der Kundensicht.
    expect(within(nav).queryByRole("link", { name: /Abgleich/ })).toBeNull();
    fireEvent.click(within(nav).getByRole("link", { name: /Engpass/ }));
    expect(await screen.findByRole("heading", { level: 1, name: /fehlen bis zu/ })).toBeVisible();
    expect(window.location.search).toContain("frage=engpass");
    expect(within(nav).getByRole("link", { name: /Engpass/ })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getAllByText("Illustrative Beispielwerte").length).toBeGreaterThan(0);
    fireEvent.click(within(nav).getByRole("link", { name: /Varianten/ }));
    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: "Mehr Fahrzeuge oder weniger Netzbelastung? Ein illustrativer Zielkonflikt.",
      }),
    ).toBeVisible();
    fireEvent.click(within(nav).getByRole("link", { name: /Nachweise & Prüfplan/ }));
    expect(
      await screen.findByRole("heading", { level: 1, name: /Messdaten für den Abgleich stehen noch aus/ }),
    ).toBeVisible();
    await waitFor(() => expect(document.title).toBe("Nachweise & Prüfplan · Airport Energy Check"));
    expect(screen.getByText(/Beispielwerte und Simulationen sind keine Messdaten/)).toBeVisible();
    // Beispielprojekte enthalten keine erfundenen Auftraege oder Aktionen.
    expect(
      await screen.findByText(
        "Für das Beispielprojekt ist kein Messdaten-Abgleich beauftragt.",
        {
          exact: false,
        },
      ),
    ).toBeVisible();
    const status = screen.getByRole("heading", {
      level: 2,
      name: "Messdaten-Abgleich",
    }).parentElement!.parentElement!;
    expect(within(status).queryByRole("button", { name: /erledigt|Annehmen/ })).toBeNull();
    expect(within(status).queryByRole("button", { name: "Messdaten-Abgleich anfragen" })).toBeNull();
  });

  it("leitet den alten Schritt Abgleich in den Lab-Raum um", () => {
    expect(parseRoute(`?projekt=p1&frage=abgleich`)).toEqual({ page: "lab", projekt: "p1" });
    expect(parseRoute(`?projekt=p1&frage=lage&werkstatt=pilot`)).toEqual({
      page: "lab",
      projekt: "p1",
      werkstatt: "pilot",
    });
    expect(toSearch({ page: "lab", projekt: "p1", werkstatt: "flexlab" })).toBe(
      "?seite=lab&projekt=p1&werkstatt=flexlab",
    );
  });

  it("zeigt den Messdaten-Abgleich ohne Beispielaufträge oder Rollenschalter", async () => {
    openApp(`?seite=lab&projekt=${SAMPLE_PROJECT.id}`);
    expect(
      await screen.findByRole("heading", { level: 1, name: "Simulation mit Messdaten überprüfen" }),
    ).toBeVisible();
    await waitFor(() => expect(document.title).toBe("Messdaten-Abgleich · Airport Energy Check"));
    expect(screen.getByRole("link", { name: "Messdaten-Abgleich" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.queryByRole("article")).toBeNull();
    expect(screen.queryByText(/Am Zug:/)).toBeNull();
    expect(screen.queryAllByRole("radio")).toHaveLength(0);
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
    await waitFor(() => expect(window.location.search).toMatch(/frage=varianten&krise=enteisung/));
  });

  it("liest den Krisenfall aus der Adresse und verwirft unbekannte", () => {
    const route = parseRoute("?projekt=p1&frage=varianten&krise=schwarzstart");
    expect(route).toMatchObject({ page: "projekt", frage: "varianten", krise: "schwarzstart" });
    expect(toSearch(route)).toBe("?projekt=p1&frage=varianten&krise=schwarzstart");
    expect(parseRoute("?projekt=p1&frage=varianten&krise=gibtsnicht")).not.toHaveProperty("krise");
  });

  it("lässt sich auf der Startseite ein Projekt anlegen", async () => {
    openApp();
    fireEvent.click(screen.getByText("Eigene Projekte und weitere Untersuchungen"));
    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "Flughafenbetrieb simulieren. Elektrifizierung gezielt testen.",
      }),
    ).toBeVisible();
    fireEvent.change(screen.getByLabelText("Projektname"), {
      target: { value: "HAM · Vorfeld Nord" },
    });
    fireEvent.change(screen.getByLabelText("Flughafen und Anschlusspunkt"), {
      target: { value: "Hamburg" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Untersuchung anlegen" }));
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
