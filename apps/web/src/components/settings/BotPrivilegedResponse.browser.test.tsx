import { StrictMode } from "react";
import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import { render } from "../../../test/render";
import { BotPrivilegedResponse } from "./BotPrivilegedResponse";
import type { PrivilegedResponseScope } from "@t3tools/client-runtime/openbot/privileged-response";

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

describe("secure form mounted controller lifetime", () => {
  it.each([false, true])("opens the original context with StrictMode=%s", async (strict) => {
    const execute = vi
      .fn<Parameters<typeof BotPrivilegedResponse>[0]["execute"]>()
      .mockResolvedValue({ status: "pending", nonce: "original-nonce" });
    const form = (
      <BotPrivilegedResponse
        scope={scope}
        spec={{
          type: "form",
          title: "Synthetic key",
          fields: [{ id: "key", kind: "text", label: "Key", secret: true, required: true }],
        }}
        available
        current={() => scope}
        execute={execute}
      />
    );
    await using _screen = await render(strict ? <StrictMode>{form}</StrictMode> : form, {
      router: false,
    });
    await expect.element(page.getByLabelText("Key")).toBeVisible();
    await userEvent.fill(page.getByLabelText("Key"), "synthetic-form-fixture");
    await userEvent.click(page.getByRole("button", { name: "Save securely" }));
    expect(execute).toHaveBeenCalledWith({
      operation: "privilegedResponse.context",
      target: scope.target,
    });
  });

  it("keeps login fields separate, preserves supplied identity and submits only once", async () => {
    const execute = vi
      .fn<Parameters<typeof BotPrivilegedResponse>[0]["execute"]>()
      .mockResolvedValueOnce({ status: "pending", nonce: "login-nonce" })
      .mockResolvedValueOnce({ status: "answered", nonce: "login-nonce" });
    await using _screen = await render(
      <BotPrivilegedResponse
        scope={scope}
        spec={{
          type: "form",
          title: "Test login",
          fields: [
            {
              id: "username",
              kind: "text",
              label: "Username or email",
              value: "person@example.invalid",
              required: true,
            },
            { id: "password", kind: "text", label: "Password", secret: true, required: true },
          ],
        }}
        available
        current={() => scope}
        execute={execute}
      />,
      { router: false },
    );
    await expect
      .element(page.getByLabelText("Username or email"))
      .toHaveValue("person@example.invalid");
    await userEvent.fill(page.getByLabelText("Password"), "synthetic-private-password");
    await userEvent.click(page.getByRole("button", { name: "Save securely" }));
    await expect.element(page.getByRole("status")).toHaveTextContent("Response delivered.");
    expect(execute).toHaveBeenNthCalledWith(2, {
      operation: "privilegedResponse.respond",
      target: scope.target,
      nonce: "login-nonce",
      consent: true,
      response: {
        actionId: "submit",
        values: { username: "person@example.invalid", password: "synthetic-private-password" },
      },
    });
    await expect.element(page.getByLabelText("Password")).toHaveValue("");
    await expect.element(page.getByRole("button", { name: "Save securely" })).toBeDisabled();
    expect(execute).toHaveBeenCalledTimes(2);
  });
});
