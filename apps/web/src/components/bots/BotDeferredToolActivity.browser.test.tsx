import "~/index.css";
import { EnvironmentId } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";
import { render } from "../../../test/render";
import { BotDeferredToolActivity } from "./BotDeferredToolActivity";
const fake = vi.hoisted(() => ({ read: vi.fn(), connection: { id: "owned" } }));
vi.mock("../../state/use-atom-query-runner", () => ({ useAtomQueryRunner: () => fake.read }));
vi.mock("../../state/session", () => ({ readPreparedConnection: () => fake.connection }));
const scope = {
  environmentId: EnvironmentId.make("trace-proof"),
  hostId: "host",
  agentId: "agent",
  taskId: null,
  messageId: "message",
};
const trace = JSON.stringify({
  steps: [
    {
      id: "tool",
      kind: "tool",
      command: "date -u",
      startedAt: "2026-11-14T00:00:00Z",
      endedAt: "2026-11-14T00:00:01Z",
    },
  ],
});
const part = (
  offset: number,
  value: string,
  nextOffset: number | null,
  version = "a".repeat(64),
) => ({
  _tag: "Success",
  value: {
    messageId: scope.messageId,
    field: "trace",
    offset,
    value,
    nextOffset,
    version,
    totalLength: trace.length,
  },
});
it.each([
  {
    name: "main",
    target: scope,
    request: { operation: "conversation.detail", agentId: "agent", taskId: null, field: "trace" },
  },
  {
    name: "group",
    target: {
      environmentId: scope.environmentId,
      hostId: "host",
      channelId: "group",
      messageId: "message",
    },
    request: { operation: "channel.trace", channelId: "group" },
  },
])(
  "reads no $name trace while collapsed and opens one version-consistent trace from bounded parts",
  async ({ target, request }) => {
    fake.read.mockReset();
    fake.read
      .mockResolvedValueOnce(part(0, trace.slice(0, 32), 32))
      .mockResolvedValueOnce(part(32, trace.slice(32), null));
    await using screen = await render(<BotDeferredToolActivity scope={target} />);
    expect(fake.read).not.toHaveBeenCalled();
    await screen.getByRole("button", { name: "Activity", exact: true }).click();
    await expect.element(page.getByRole("dialog", { name: "Trace" })).toBeVisible();
    expect(fake.read).toHaveBeenCalledTimes(2);
    expect(fake.read.mock.calls[1]?.[0]).toMatchObject({
      environmentId: scope.environmentId,
      input: {
        hostId: "host",
        request: {
          ...request,
          messageId: "message",
          offset: 32,
          version: "a".repeat(64),
        },
      },
    });
  },
);
it("refuses a trace whose version changes between parts", async () => {
  fake.read.mockReset();
  fake.read
    .mockResolvedValueOnce(part(0, trace.slice(0, 32), 32))
    .mockResolvedValueOnce(part(32, trace.slice(32), null, "b".repeat(64)));
  await using screen = await render(<BotDeferredToolActivity scope={scope} />);
  await screen.getByRole("button", { name: "Activity", exact: true }).click();
  await expect.element(screen.getByRole("alert")).toBeVisible();
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(fake.read).toHaveBeenCalledTimes(2);
});
