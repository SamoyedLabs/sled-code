import { userEvent } from "vite-plus/test/browser";
import { expect, it, vi } from "vite-plus/test";
import { EnvironmentId, type OpenbotRoutineFlowCanvas } from "@t3tools/contracts";
import { render } from "../../../../../test/render";
import { RoutineFlowWorkspace } from "./RoutineFlowWorkspace";
import "~/index.css";
const initialCanvas: typeof OpenbotRoutineFlowCanvas.Type = {
  agentId: "writer",
  placedAgentIds: ["scout"],
  links: [],
  positions: [],
  routines: [
    {
      routine: {
        id: "morning",
        agentId: "writer",
        name: "Morning brief",
        instruction: "Summarize the results.",
        active: true,
        timezone: "America/Chicago",
        trigger: { kind: "schedule", schedule: { kind: "daily", time: "07:00" } },
        createdAt: "2026-11-15T00:00:00Z",
        updatedAt: "2026-11-15T00:00:00Z",
      },
      recentRuns: [],
      upcomingRuns: [],
      steps: [],
    },
  ],
};
let canvas = structuredClone(initialCanvas);
function fixture() {
  canvas = structuredClone(initialCanvas);
  state.write.mockClear();
  return {
    [Symbol.dispose]() {
      canvas = structuredClone(initialCanvas);
      state.write.mockClear();
    },
  };
}
const state = vi.hoisted(() => ({ write: vi.fn(async () => true) }));
vi.mock("../../useBotRoutines", () => ({
  useBotRoutineDiscovery: () => ({
    agents: [
      { id: "writer", name: "Writer", provider: "codex" },
      { id: "scout", name: "Scout", provider: "codex" },
    ],
    error: null,
  }),
  useBotRoutineFlows: () => ({
    canvas,
    error: null,
    loading: false,
    busy: false,
    canWrite: true,
    act: state.write,
    refresh: () => {},
  }),
}));
vi.mock("../settings/useSourceSettingsAdmin", () => ({
  useSourceSettingsAdmin: () => ({ can: () => false }),
}));
it("connects the selected routine by keyboard and saves keyboard movement using host node identities", async () => {
  using _fixture = fixture();
  const container = document.createElement("div");
  container.className = "openbot-react";
  container.style.cssText = "height:800px;width:1200px;display:flex";
  await using screen = await render(
    <RoutineFlowWorkspace
      environmentId={EnvironmentId.make("remote")}
      hostId="host"
      agentId="writer"
      onCreateRoutine={() => {}}
      onEditRoutine={() => {}}
    />,
    { container },
  );
  await screen.getByRole("button", { name: "Select Morning brief", exact: true }).click();
  await expect
    .element(screen.getByRole("heading", { name: "Morning brief", exact: true }))
    .toBeVisible();
  await screen.getByRole("button", { name: "Connect output of Writer", exact: true }).click();
  await screen.getByRole("button", { name: "Connect input of Scout", exact: true }).click();
  expect(state.write).toHaveBeenCalledWith({
    operation: "routineFlow.connect",
    routineId: "morning",
    fromAgentId: "writer",
    toAgentId: "scout",
  });
  const card = screen.getByRole("button", { name: "Select Scout", exact: true });
  await card.click();
  await userEvent.keyboard("{ArrowRight}");
  expect(state.write).toHaveBeenLastCalledWith({
    operation: "routineFlow.savePosition",
    agentId: "writer",
    nodeKey: "agent:scout",
    x: 408,
    y: 304,
  });
});

function workspace() {
  return (
    <RoutineFlowWorkspace
      environmentId={EnvironmentId.make("remote")}
      hostId="host"
      agentId="writer"
      onCreateRoutine={() => {}}
      onEditRoutine={() => {}}
    />
  );
}
function sized() {
  const container = document.createElement("div");
  container.className = "openbot-react";
  container.style.cssText = "height:800px;width:1200px;display:flex";
  return container;
}
it("allows the same agent connection in different routines without mixing their graphs", async () => {
  using _fixture = fixture();
  const morning = canvas.routines[0]!;
  canvas = {
    ...canvas,
    routines: [
      ...canvas.routines,
      { ...morning, routine: { ...morning.routine, id: "evening", name: "Evening brief" } },
    ],
  };
  canvas = {
    ...canvas,
    links: [
      {
        id: "morning-link",
        routineId: "morning",
        fromAgentId: "writer",
        toAgentId: "scout",
        instruction: "Morning only",
        createdAt: "2026-11-15T00:00:00Z",
      },
    ],
  };
  await using screen = await render(workspace(), { container: sized() });
  await screen.getByRole("button", { name: "Select Evening brief", exact: true }).click();
  await screen.getByRole("button", { name: "Connect output of Writer", exact: true }).click();
  await screen.getByRole("button", { name: "Connect input of Scout", exact: true }).click();
  expect(state.write).toHaveBeenCalledWith({
    operation: "routineFlow.connect",
    routineId: "evening",
    fromAgentId: "writer",
    toAgentId: "scout",
  });
});
it("disconnects a focused edge exactly once when Delete bubbles through the canvas", async () => {
  using _fixture = fixture();
  canvas = {
    ...canvas,
    links: [
      {
        id: "morning-link",
        routineId: "morning",
        fromAgentId: "writer",
        toAgentId: "scout",
        instruction: "Morning only",
        createdAt: "2026-11-15T00:00:00Z",
      },
    ],
  };
  await using screen = await render(workspace(), { container: sized() });
  const edge = screen.container.querySelector<SVGElement>(".diagram-edge-hit")!;
  edge.focus();
  await userEvent.keyboard("{Enter}");
  await expect
    .element(screen.getByRole("button", { name: "Disconnect connection", exact: true }))
    .toBeVisible();
  state.write.mockClear();
  await userEvent.keyboard("{Delete}");
  expect(state.write).toHaveBeenCalledExactlyOnceWith({
    operation: "routineFlow.disconnect",
    linkId: "morning-link",
  });
});
it("falls back to the remaining routine when a selected routine is removed externally", async () => {
  using _fixture = fixture();
  const morning = canvas.routines[0]!;
  const evening = {
    ...morning,
    routine: { ...morning.routine, id: "evening", name: "Evening brief" },
  };
  canvas = { ...canvas, routines: [...canvas.routines, evening] };
  await using screen = await render(workspace(), { container: sized() });
  await screen.getByRole("button", { name: "Select Morning brief", exact: true }).click();
  canvas = { ...canvas, routines: [evening] };
  await screen.rerender(workspace());
  await expect
    .element(screen.getByRole("button", { name: "Connect output of Writer", exact: true }))
    .toBeDisabled();
});
