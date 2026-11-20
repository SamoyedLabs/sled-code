import "~/index.css";
import { EnvironmentId } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";
import { render } from "../../../../../test/render";
import { WorkflowWebhookSettings } from "./WorkflowWebhookSettings";

const host = vi.hoisted(() => ({ connection: { id: "original" }, command: vi.fn() }));
vi.mock("../../../../state/session", async () => {
  const Option = await import("effect/Option");
  return {
    usePreparedConnection: () => Option.some(host.connection),
    readPreparedConnection: () => host.connection,
  };
});
vi.mock("../../../../state/use-atom-command", () => ({ useAtomCommand: () => host.command }));
const props = {
  environmentId: EnvironmentId.make("environment"),
  hostId: "host",
  workflowId: "workflow",
  nodeId: "trigger",
  disabled: false,
  savedGraph: true,
};
it("distinguishes an unlinked configured route, creates a secret once and reloads its guarded address", async () => {
  let rotated = false;
  host.command.mockReset().mockImplementation(async ({ input }) => {
    if (input.request.operation === "workflow.rotateWebhookSecret") {
      rotated = true;
      return { _tag: "Success", value: { secret: "owned-secret" } };
    }
    return {
      _tag: "Success",
      value: {
        workflowId: "workflow",
        nodeId: "trigger",
        configured: true,
        webhookUrl: rotated ? "https://relay.example/owned" : null,
      },
    };
  });
  const changed = vi.fn();
  await using view = await render(<WorkflowWebhookSettings {...props} onChanged={changed} />);
  await expect
    .element(view.getByRole("status"))
    .toHaveTextContent(
      "Link this computer through Sled Connect to make its webhook address available.",
    );
  await view.getByRole("button", { name: "Regenerate signing secret" }).click();
  await expect.element(view.getByText("owned-secret", { exact: true })).toBeVisible();
  await expect.element(view.getByRole("button", { name: "Copy webhook address" })).toBeVisible();
  expect(changed).toHaveBeenCalledOnce();
  expect(
    host.command.mock.calls.filter(
      ([arg]) => arg.input.request.operation === "workflow.rotateWebhookSecret",
    ),
  ).toHaveLength(1);
  await view.getByRole("button", { name: "Dismiss signing secret" }).click();
  await expect.element(page.getByText("owned-secret", { exact: true })).not.toBeInTheDocument();
});
it("does not publish a secret or invoke a new view's refresh after its authenticated connection is replaced", async () => {
  let complete: (value: unknown) => void = () => {};
  host.command.mockReset().mockImplementation(({ input }) =>
    input.request.operation === "workflow.rotateWebhookSecret"
      ? new Promise((resolve) => {
          complete = resolve;
        })
      : Promise.resolve({
          _tag: "Success",
          value: { workflowId: "workflow", nodeId: "trigger", configured: false, webhookUrl: null },
        }),
  );
  const changed = vi.fn();
  await using view = await render(<WorkflowWebhookSettings {...props} onChanged={changed} />);
  await expect.poll(() => host.command.mock.calls.length).toBe(1);
  await view.getByRole("button", { name: "Create webhook", exact: true }).click();
  host.connection = { id: "replacement" };
  complete({ _tag: "Success", value: { secret: "stale-secret" } });
  await view.rerender(<WorkflowWebhookSettings {...props} onChanged={changed} />);
  await expect.poll(() => host.command.mock.calls.length).toBe(3);
  expect(changed).not.toHaveBeenCalled();
  await expect.element(page.getByText("stale-secret", { exact: true })).not.toBeInTheDocument();
});
