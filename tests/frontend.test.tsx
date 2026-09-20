/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/web/App.js";

if (!("ResizeObserver" in globalThis)) {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as typeof ResizeObserver;
}

function response(value: unknown) {
  return Promise.resolve(
    new Response(JSON.stringify(value), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  );
}

describe("management shell", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

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
        screen.getByRole("heading", { name: "How can I help?" }),
      ).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: /Skills/ }));
    expect(
      screen.getByRole("heading", { name: "Skills registry" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Add skill" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add skill" }));
    expect(screen.getByRole("dialog", { name: "Add skill" })).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close Add skill" }));
    expect(screen.queryByRole("dialog", { name: "Add skill" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Settings/ }));
    expect(
      screen.getByRole("heading", { name: "Registry transfer" }),
    ).toBeInTheDocument();
  });

  it("keeps guest navigation focused on permitted agents", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = String(input);
      if (url.includes("/api/auth/me"))
        return response({ role: "guest", capabilities: ["chat"] });
      if (url.includes("/api/agents"))
        return response([
          {
            id: "guest-agent",
            name: "Guest helper",
            description: "Safe guest agent",
            modelRef: "model",
            accessLevel: "guest",
            enabled: true,
          },
        ]);
      if (url.includes("/api/sessions") || url.includes("/api/runs"))
        return response({ items: [], offset: 0, limit: 100 });
      return response([]);
    });
    render(<App />);
    await waitFor(() =>
      expect(
        screen.getByRole("option", { name: "Guest helper" }),
      ).toBeInTheDocument(),
    );
    expect(screen.getByText("Guest")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Chat with Guest helper" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Settings/ })).not.toBeInTheDocument();
  });

  it("adds filtering to long agent option lists", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = String(input);
      if (url.includes("/api/auth/me"))
        return response({ authenticated: true, username: "admin", role: "admin" });
      if (url.includes("/api/agents"))
        return response(
          Array.from({ length: 6 }, (_, index) => ({
            id: `agent-${index + 1}`,
            name: `Agent ${index + 1}`,
            description: "Available agent",
            modelRef: "model",
            accessLevel: "user",
            enabled: true,
          })),
        );
      if (url.includes("/api/sessions") || url.includes("/api/runs"))
        return response({ items: [], offset: 0, limit: 100 });
      return response([]);
    });
    render(<App />);
    await waitFor(() =>
      expect(document.getElementById("home-agent")).toBeInTheDocument(),
    );
    fireEvent.click(document.getElementById("home-agent") as HTMLButtonElement);
    fireEvent.change(
      screen.getByRole("textbox", { name: "Search agents" }),
      { target: { value: "Agent 6" } },
    );
    expect(screen.getByRole("option", { name: "Agent 6" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Agent 1" })).not.toBeInTheDocument();
  });

  it("sends chat messages with Enter while preserving Shift+Enter", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = String(input);
      if (url.includes("/api/auth/me"))
        return response({ role: "guest", capabilities: ["chat"] });
      if (url.includes("/api/agents/guest-agent/chat"))
        return Promise.resolve(
          new Response(
            [
              `data: ${JSON.stringify({ version: 1, type: "session", sessionId: "session-1" })}`,
              "",
              `data: ${JSON.stringify({ version: 1, type: "token", text: "Hello" })}`,
              "",
            ].join("\n"),
            { status: 200, headers: { "Content-Type": "text/event-stream" } },
          ),
        );
      if (url.includes("/api/agents"))
        return response([
          {
            id: "guest-agent",
            name: "Guest helper",
            description: "Safe guest agent",
            modelRef: "model",
            accessLevel: "guest",
            enabled: true,
          },
        ]);
      if (url.includes("/api/sessions") || url.includes("/api/runs"))
        return response({ items: [], offset: 0, limit: 100 });
      return response([]);
    });
    render(<App />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Chat with Guest helper" })).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Chat with Guest helper" }));
    const textarea = screen.getByRole("textbox", { name: "Message the agent" });
    fireEvent.change(textarea, { target: { value: "line one" } });
    fireEvent.keyDown(textarea, { key: "Enter", code: "Enter", shiftKey: true });
    expect(
      fetchSpy.mock.calls.some(([input]) => String(input).includes("/api/agents/guest-agent/chat")),
    ).toBe(false);
    fireEvent.change(textarea, { target: { value: "Hello" } });
    fireEvent.keyDown(textarea, { key: "Enter", code: "Enter" });
    await waitFor(() =>
      expect(
        fetchSpy.mock.calls.some(([input]) => String(input).includes("/api/agents/guest-agent/chat")),
      ).toBe(true),
    );
  });

  it("signs in with the environment-backed account flow", async () => {
    let signedIn = false;
    vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = String(input);
      if (url.includes("/api/auth/login")) {
        signedIn = true;
        return response({ authenticated: true, username: "demo", role: "user" });
      }
      if (url.includes("/api/auth/me")) {
        return response(
          signedIn
            ? { authenticated: true, username: "demo", role: "user" }
            : { authenticated: false },
        );
      }
      if (url.includes("/api/sessions") || url.includes("/api/runs"))
        return response({ items: [], offset: 0, limit: 100 });
      return response([]);
    });
    render(<App />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Sign in" })).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(screen.getByRole("dialog", { name: "Sign in to your runtime." })).toBeInTheDocument();
    const password = screen.getByLabelText("Password");
    expect(password).toHaveAttribute("type", "password");
    fireEvent.click(screen.getByRole("button", { name: "Show password" }));
    expect(password).toHaveAttribute("type", "text");
    expect(screen.getByRole("button", { name: "Hide password" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Hide password" }));
    expect(password).toHaveAttribute("type", "password");
    fireEvent.change(screen.getByLabelText("Username"), { target: { value: "demo" } });
    fireEvent.change(password, { target: { value: "demo" } });
    fireEvent.click(
      screen.getByRole("dialog", { name: "Sign in to your runtime." }).querySelector(
        'button[type="submit"]',
      ) as HTMLButtonElement,
    );
    await waitFor(() => expect(screen.getByText("demo")).toBeInTheDocument());
    expect(screen.getByText("User")).toBeInTheDocument();
  });
});
