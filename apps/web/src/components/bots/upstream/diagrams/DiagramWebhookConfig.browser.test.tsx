import { expect, it, vi } from "vite-plus/test";
import { EnvironmentId, type OpenbotRoutineFlowCanvas } from "@t3tools/contracts";
import { render } from "../../../../../test/render";
import { DiagramWebhookConfig } from "./DiagramWebhookConfig";
const state = vi.hoisted(() => ({ execute: vi.fn(), setting: vi.fn(), foreign: false }));
vi.mock("../settings/useSourceSettingsAdmin", () => ({
  useSourceSettingsAdmin: () => ({
    can: () => true,
    execute: state.execute,
    canSetting: () => true,
    setting: state.setting,
  }),
}));
vi.mock("../../../settings/BotConnectionControls", () => ({ confirmed: async () => true }));
const routine: (typeof OpenbotRoutineFlowCanvas.Type)["routines"][number]["routine"] = {
  id: "webhook",
  agentId: "writer",
  name: "Webhook",
  instruction: "Review event",
  active: false,
  timezone: "America/Chicago",
  trigger: { kind: "webhook", eventType: null, filters: [] },
  createdAt: "2026-11-15T00:00:00Z",
  updatedAt: "2026-11-15T00:00:00Z",
};
function setup(foreign: boolean) {
  state.execute.mockReset();
  state.setting.mockReset();
  state.setting.mockResolvedValue({ state: { status: "signed_out" }, flow: null });
  state.execute.mockImplementation(async (request) => {
    if (request.operation === "events.configuration")
      return {
        id: "webhook",
        owner: { kind: "agent", id: foreign ? "foreign" : "writer" },
        webhookUrl: null,
        relayService: "sled-connect",
      };
    if (request.operation === "events.status") return { supported: true, connected: false };
    if (request.operation === "events.rotateSecret") return { secret: "test-only-secret" };
    return {};
  });
}
it("saves owned webhook filters, reports relay state and dismisses a one-time rotated secret", async () => {
  setup(false);
  await using screen = await render(
    <DiagramWebhookConfig
      environmentId={EnvironmentId.make("test")}
      hostId="host"
      routine={routine}
      onRefresh={() => {}}
    />,
  );
  await expect
    .element(
      screen.getByText(
        "Connect this hosting computer to Sled Connect to receive external webhooks.",
      ),
    )
    .toBeVisible();
  await expect
    .element(screen.getByRole("link", { name: "Open Sled Connect settings" }))
    .toBeVisible();
  await expect
    .element(screen.getByRole("button", { name: "Save webhook" }))
    .not.toBeInTheDocument();
  await screen.getByRole("textbox", { name: "Event type", exact: true }).fill("invoice.paid");
  await screen.getByRole("button", { name: "Save webhook" }).click();
  expect(state.execute).toHaveBeenCalledWith({
    operation: "events.save",
    owner: { kind: "agent", id: "writer" },
    id: "webhook",
    name: "Webhook",
    instruction: "Review event",
    active: false,
    timezone: "America/Chicago",
    trigger: { kind: "webhook", eventType: "invoice.paid", filters: [] },
  });
  await screen.getByRole("button", { name: "Regenerate secret" }).click();
  await expect.element(screen.getByText("test-only-secret", { exact: true })).toBeVisible();
  await screen.getByRole("button", { name: "Dismiss secret" }).click();
  await expect
    .element(screen.getByText("test-only-secret", { exact: true }))
    .not.toBeInTheDocument();
});
it("refuses to display another routine owner's endpoint", async () => {
  setup(true);
  await using screen = await render(
    <DiagramWebhookConfig
      environmentId={EnvironmentId.make("test")}
      hostId="host"
      routine={routine}
      onRefresh={() => {}}
    />,
  );
  await expect
    .element(screen.getByRole("alert"))
    .toHaveTextContent("The endpoint belongs to another routine.");
  await expect
    .element(screen.getByRole("button", { name: "Copy webhook URL" }))
    .not.toBeInTheDocument();
});

it("rechecks Sled Connect configuration without resending or changing the routine", async () => {
  setup(false);
  await using screen = await render(
    <DiagramWebhookConfig
      environmentId={EnvironmentId.make("test")}
      hostId="host"
      routine={routine}
      onRefresh={() => {}}
    />,
  );
  await expect
    .element(screen.getByRole("link", { name: "Open Sled Connect settings" }))
    .toBeVisible();
  state.execute.mockImplementation(async (request) =>
    request.operation === "events.configuration"
      ? {
          id: "webhook",
          owner: { kind: "agent", id: "writer" },
          webhookUrl: "https://example.invalid/owned",
          relayService: "sled-connect",
        }
      : { supported: true, connected: true },
  );
  state.execute.mockClear();
  await screen.getByRole("button", { name: "Check webhook connection" }).click();
  await expect
    .element(screen.getByText("Public webhook URL provided by Sled Connect.", { exact: true }))
    .toBeVisible();
  await expect
    .element(screen.getByRole("link", { name: "Open Sled Connect settings" }))
    .not.toBeInTheDocument();
  expect(state.setting).not.toHaveBeenCalled();
  expect(state.execute.mock.calls.map(([request]) => request.operation)).toEqual([
    "events.configuration",
  ]);
});
