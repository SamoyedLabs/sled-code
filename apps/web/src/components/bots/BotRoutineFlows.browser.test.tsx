import { expect, it, vi } from "vite-plus/test";
import { EnvironmentId } from "@t3tools/contracts";
import { render } from "../../../test/render";
import { BotRoutineFlows } from "./BotRoutineFlows";
import "~/index.css";
const readCanvas = vi.hoisted(() =>
  vi.fn(() => ({ canvas: null, error: null, busy: false, canWrite: false, act: async () => {} })),
);
vi.mock("./useBotRoutines", async (original) => ({
  ...(await original<typeof import("./useBotRoutines")>()),
  useBotRoutineDiscovery: () => ({
    agents: [
      { id: "first", name: "First" },
      { id: "selected", name: "Selected" },
    ],
    refresh: () => {},
    error: null,
  }),
  useBotRoutineFlows: readCanvas,
}));
it("loads the routines of the sidebar-selected agent instead of silently choosing the first agent", async () => {
  await using screen = await render(
    <BotRoutineFlows
      environmentId={EnvironmentId.make("remote")}
      hostId="host"
      workspace
      agentId="selected"
    />,
  );
  expect(readCanvas).toHaveBeenLastCalledWith("remote", "host", "selected");
  await screen.rerender(
    <BotRoutineFlows
      environmentId={EnvironmentId.make("remote")}
      hostId="host"
      workspace
      agentId="first"
    />,
  );
  expect(readCanvas).toHaveBeenLastCalledWith("remote", "host", "first");
});
