// @vitest-environment jsdom
import * as React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vite-plus/test";
import type { PrivilegedResponseRequest } from "@t3tools/contracts/openbot-privileged-response";
import type { PrivilegedResponseScope } from "@t3tools/client-runtime/openbot/privileged-response";

vi.mock("react-native", () => ({
  AppState: { addEventListener: () => ({ remove: () => {} }) },
  View: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("../../components/ui/Button", () => ({
  Button: ({ label, onPress }: { label: string; onPress: () => void }) =>
    React.createElement("button", { onClick: onPress }, label),
}));
vi.mock("../../components/ui/AppText", () => ({
  AppText: ({ children }: { children: React.ReactNode }) =>
    React.createElement("span", null, children),
  AppTextInput: ({
    secureTextEntry,
    value,
    onChangeText,
  }: {
    secureTextEntry: boolean;
    value: string;
    onChangeText: (value: string) => void;
  }) =>
    React.createElement("input", {
      type: secureTextEntry ? "password" : "text",
      value,
      onInput: (event: React.FormEvent<HTMLInputElement>) =>
        onChangeText(event.currentTarget.value),
    }),
}));

import { BotPrivilegedResponse } from "./BotPrivilegedResponse";

it("submits a masked value only in the confirmed privileged request and clears the input", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("React", React);
  const messages = ["log", "info", "warn", "error", "debug"] as const;
  const consoleSpies = messages.map((method) => vi.spyOn(console, method));
  const container = document.createElement("div");
  const root = createRoot(container);
  const secret = "synthetic-parity-password";
  const scope: PrivilegedResponseScope = {
    principal: "principal",
    environmentId: "environment",
    hostId: "host",
    target: {
      agentId: "agent",
      threadId: "thread",
      turnId: "turn",
      messageId: "message",
      blockId: "block",
      requestId: "request",
    },
  };
  const execute = vi.fn(async (request: PrivilegedResponseRequest) => {
    if (request.operation === "privilegedResponse.respond") throw new Error(secret);
    return { nonce: "test-nonce", status: "pending" as const };
  });
  const press = async (label: string) => {
    const button = Array.from(container.querySelectorAll("button")).find(
      (candidate) => candidate.textContent === label,
    );
    expect(button).toBeDefined();
    await act(async () => button?.click());
  };
  try {
    act(() =>
      root.render(
        <BotPrivilegedResponse
          available
          scope={scope}
          current={() => scope}
          execute={execute}
          spec={{
            type: "form",
            title: "Test login",
            fields: [
              { id: "password", kind: "text", label: "Password", secret: true, required: true },
            ],
          }}
        />,
      ),
    );
    await press("Open secure response");
    const field = container.querySelector("input");
    expect(field?.type).toBe("password");
    if (!field) throw new Error("Missing password input");
    act(() => {
      field.value = secret;
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await press("Review submission");
    expect(execute.mock.calls).toEqual([
      [{ operation: "privilegedResponse.context", target: scope.target }],
    ]);
    await press("Confirm and submit");
    expect(execute.mock.calls[1]).toEqual([
      {
        operation: "privilegedResponse.respond",
        target: scope.target,
        nonce: "test-nonce",
        consent: true,
        response: { actionId: "submit", values: { password: secret } },
      },
    ]);
    expect(container.querySelector("input")).toBeNull();
    expect(container.textContent).toContain("Delivery is not confirmed");
    expect(container.innerHTML).not.toContain(secret);
    for (const spy of consoleSpies) {
      expect(spy.mock.calls.flat().map(String).join(" ")).not.toContain(secret);
    }
  } finally {
    act(() => root.unmount());
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
});
