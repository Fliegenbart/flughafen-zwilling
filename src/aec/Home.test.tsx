import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const projectsApi = vi.hoisted(() => ({
  createProject: vi.fn(),
  listProjects: vi.fn(),
}));

vi.mock("./api/projects", () => projectsApi);

import { NavContext } from "./context";
import { AdvancedHome as Home } from "./Home";
import { SAMPLE_PROJECT } from "./sample";

afterEach(() => {
  vi.clearAllMocks();
});

function renderHome() {
  return render(
    <NavContext.Provider
      value={{ basePath: "/", route: { page: "start" }, navigate: vi.fn() }}
    >
      <Home />
    </NavContext.Provider>,
  );
}

describe("Home", () => {
  it("fuehrt vom Hero in den interaktiven Beispiel-Arbeitsbereich", () => {
    projectsApi.listProjects.mockResolvedValue([SAMPLE_PROJECT]);
    renderHome();

    expect(
      screen.getByRole("link", { name: "Simulation selbst ausprobieren" }),
    ).toHaveAttribute("href", `/?projekt=${SAMPLE_PROJECT.id}&ansicht=neu`);
    expect(screen.getByText("Flughafentag")).toBeInTheDocument();
    expect(screen.getByText("Engpass")).toBeInTheDocument();
    expect(screen.getByText("Varianten")).toBeInTheDocument();
    expect(screen.getByText("Prüfplan")).toBeInTheDocument();
    expect(screen.getByText(/Grafik ist illustrativ/)).toBeInTheDocument();
    expect(screen.getByText(/Wenn Busse, Gepäckschlepper und Bodenstromgeräte elektrisch werden/)).toBeInTheDocument();
    expect(screen.getByText(/synthetisches Beispiel/)).toBeInTheDocument();
  });

  it("zeigt vorhandene Projekte erst nach dem Aufklappen", async () => {
    projectsApi.listProjects.mockResolvedValue([
      SAMPLE_PROJECT,
      {
        id: "bestehend-1",
        name: "HAM · Vorfeld Nord",
        airport: "Hamburg",
        dayLabel: "Entwurf",
        fleetSize: 12,
        gridLimitKw: 2000,
        source: "beispiel",
      },
    ]);
    renderHome();

    const summary = await screen.findByText("Weitere Projekte");
    const details = summary.closest("details");
    expect(details).not.toHaveAttribute("open");
    fireEvent.click(summary);
    expect(details).toHaveAttribute("open");
    expect(screen.getByText("HAM · Vorfeld Nord")).toBeVisible();
  });
});
