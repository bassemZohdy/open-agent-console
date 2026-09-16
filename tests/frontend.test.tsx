/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/web/App.js";

function response(value: unknown) {
  return Promise.resolve(
    new Response(JSON.stringify(value), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  );
}

describe("management shell", () => {
  afterEach(() => vi.restoreAllMocks());

  it("loads the registry and navigates to the skills and settings surfaces", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = String(input);
      if (url.includes("/api/sessions") || url.includes("/api/runs"))
        return response({ items: [], offset: 0, limit: 100 });
      return response([]);
    });
    render(<App />);
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: "Assemble small agent crews." }),
      ).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: /Skills/ }));
    expect(
      screen.getByRole("heading", { name: "Skills registry" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Settings/ }));
    expect(
      screen.getByRole("heading", { name: "Registry transfer" }),
    ).toBeInTheDocument();
  });
});
