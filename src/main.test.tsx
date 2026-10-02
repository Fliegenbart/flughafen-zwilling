import { act, screen, waitFor } from "@testing-library/react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-dom/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-dom/client")>();
  return { ...actual, createRoot: vi.fn(actual.createRoot) };
});
vi.mock("./App", () => ({ default: () => <h1>Airport Twin Core</h1> }));
vi.mock("./lab/Workbench", () => ({ default: () => <h1>FlexLab Workbench</h1> }));

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
  });

  async function open(search = "") {
    window.history.replaceState(null, "", `/${search}`);
    await act(async () => { await import("./main"); });
  }

  it("opens the airport by default, not the generic flex workspace", async () => {
    await open();
    expect(await screen.findByRole("heading", { name: "Airport Twin Core" })).toBeVisible();
    expect(screen.queryByRole("heading", { name: "FlexLab Workbench" })).toBeNull();
    await waitFor(() => expect(document.title).toBe("Airport Twin Core"));
  });

  it("keeps the explicit airport link working and shows both workspace links", async () => {
    await open("?workspace=airport");
    expect(await screen.findByRole("heading", { name: "Airport Twin Core" })).toBeVisible();
    const airport = screen.getByRole("link", { name: /Flughafen.*Airport Twin Core/i });
    expect(airport).toHaveAttribute("href", "/?workspace=airport");
    expect(airport).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: /Messdaten.*FlexLab Workbench/i }))
      .toHaveAttribute("href", "/?workspace=flexlab");
  });

  it("preserves FlexLab under an explicit link without replacing the airport", async () => {
    await open("?workspace=flexlab");
    expect(await screen.findByRole("heading", { name: "FlexLab Workbench" })).toBeVisible();
    expect(screen.getByRole("link", { name: /Messdaten.*FlexLab Workbench/i }))
      .toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: /Flughafen.*Airport Twin Core/i })).toBeVisible();
    await waitFor(() => expect(document.title).toBe("FlexLab Workbench"));
  });

  it("defaults unknown workspace IDs to airport instead of silently choosing FlexLab", async () => {
    await open("?workspace=unknown");
    expect(await screen.findByRole("heading", { name: "Airport Twin Core" })).toBeVisible();
  });
});
