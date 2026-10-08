import { act, screen, waitFor, within } from "@testing-library/react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-dom/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-dom/client")>();
  return { ...actual, createRoot: vi.fn(actual.createRoot) };
});
vi.mock("./App", () => ({ default: () => <h1>Airport Twin Core</h1> }));
vi.mock("./lab/Workbench", () => ({ default: () => <h1>FlexLab Workbench</h1> }));
vi.mock("./munich/MunichPilot", () => ({ default: () => <h1>Flughafen München</h1> }));

describe("Workspace entry point", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.mocked(createRoot).mockClear();
    const element = document.createElement("div");
    element.id = "root";
    document.body.append(element);
  });

  afterEach(async () => {
    const root = vi.mocked(createRoot).mock.results[0]?.value;
    if (root) await act(() => root.unmount());
    document.getElementById("root")?.remove();
    window.history.replaceState(null, "", "/");
    vi.unstubAllEnvs();
  });

  async function open(search = "") {
    window.history.replaceState(null, "", `/${search}`);
    await act(async () => {
      await import("./main");
    });
  }

  it("opens the Airport Energy Check start page by default", async () => {
    await open();
    expect(await screen.findByRole("heading", { level: 1, name: /Reicht der Anschluss/ })).toBeVisible();
    expect(screen.queryByRole("heading", { name: "FlexLab Workbench" })).toBeNull();
    await waitFor(() => expect(document.title).toBe("Airport Energy Check"));
  });

  it("redirects the old airport link to the scenario library with the full simulation", async () => {
    await open("?workspace=airport");
    expect(await screen.findByRole("heading", { name: "Airport Twin Core" })).toBeVisible();
    expect(window.location.search).toBe("?seite=bibliothek&werkstatt=simulation");
    expect(screen.getByRole("link", { name: "Szenario-Bibliothek" })).toHaveAttribute("aria-current", "page");
  });

  it("offers a skip link to the main area", async () => {
    await open("?workspace=airport");
    await screen.findByRole("heading", { name: "Airport Twin Core" });
    expect(screen.getByRole("link", { name: "Zum Inhalt" })).toHaveAttribute("href", "#aec-main");
    expect(document.getElementById("aec-main")).toHaveAttribute("tabindex", "-1");
    // Bestandswerkzeuge behalten ihre Studio-Tokens.
    expect(document.querySelector("[data-studio]")).not.toBeNull();
  });

  it("redirects FlexLab into the Testing-Lab space and keeps the full workbench", async () => {
    await open("?workspace=flexlab");
    expect(await screen.findByRole("heading", { name: "FlexLab Workbench" })).toBeVisible();
    expect(window.location.search).toContain("seite=lab");
    expect(window.location.search).toContain("werkstatt=flexlab");
    expect(screen.getByRole("link", { name: "Testing-Lab" })).toHaveAttribute("aria-current", "page");
    expect(screen.queryByRole("navigation", { name: "Drei Schritte des Projekts" })).toBeNull();
  });

  it("defaults unknown workspace IDs to the airport simulation, not FlexLab", async () => {
    await open("?workspace=unknown");
    expect(await screen.findByRole("heading", { name: "Airport Twin Core" })).toBeVisible();
    expect(screen.queryByRole("heading", { name: "FlexLab Workbench" })).toBeNull();
  });

  it("redirects Munich steps to the matching project step", async () => {
    await open("?workspace=munich&schritt=robustheit");
    expect(await screen.findByRole("heading", { name: "Flughafen München" })).toBeVisible();
    expect(window.location.search).toContain("frage=nachweis");
    expect(window.location.search).toContain("schritt=robustheit");
  });

  it("opens Munich without a step in Daten with the system map", async () => {
    await open("?workspace=munich");
    expect(await screen.findByRole("heading", { name: "Flughafen München" })).toBeVisible();
    expect(window.location.search).toContain("frage=daten");
    expect(document.querySelector("[data-studio]")).not.toBeNull();
  });

  it("does not apply studio tokens to FlexLab", async () => {
    await open("?workspace=flexlab");
    await screen.findByRole("heading", { name: "FlexLab Workbench" });
    expect(document.querySelector("[data-studio]")).toBeNull();
  });

  it("keeps all links inside the hosted base path", async () => {
    vi.stubEnv("BASE_URL", "/airport/");
    await open("?workspace=munich");
    expect(await screen.findByRole("heading", { name: "Flughafen München" })).toBeVisible();
    expect(window.location.pathname).toBe("/airport/");
    expect(screen.getByRole("link", { name: "Szenario-Bibliothek" })).toHaveAttribute(
      "href",
      "/airport/?seite=bibliothek",
    );
    expect(
      within(screen.getByRole("navigation", { name: "Drei Schritte des Projekts" })).getByRole("link", {
        name: /Zusage/,
      }),
    ).toHaveAttribute(
      "href",
      "/airport/?projekt=beispiel-muc-sued&frage=nachweis",
    );
  });
});
