import { expect, it, vi } from "vite-plus/test";
import { EnvironmentId } from "@t3tools/contracts";
import { render } from "../../../test/render";
import { useBotRoutineFlows } from "./useBotRoutines";
const state = vi.hoisted(() => ({
  session: {},
  finish: () => {},
  write: vi.fn(),
  reads: vi.fn(async () => ({ _tag: "Success", value: {} })),
}));
vi.mock("../../state/query", () => ({
  useEnvironmentQuery: () => ({ data: null, isPending: false, error: null, refresh: () => {} }),
}));
vi.mock("../../state/use-atom-command", () => ({ useAtomCommand: () => state.write }));
vi.mock("../../state/use-atom-query-runner", () => ({ useAtomQueryRunner: () => state.reads }));
vi.mock("../../state/session", () => ({ readPreparedConnection: () => state.session }));
vi.mock("@effect/atom-react", async (original) => ({
  ...(await original<typeof import("@effect/atom-react")>()),
  useAtomValue: () => true,
}));
it("keeps both rapid position commits instead of dropping the second while the first is in flight", async () => {
  let first: Promise<boolean> | undefined, second: Promise<boolean> | undefined;
  let resolveFirst: (v: unknown) => void = () => {};
  state.write
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirst = resolve;
        }),
    )
    .mockResolvedValue({ _tag: "Success", value: {} });
  function Probe() {
    const c = useBotRoutineFlows(EnvironmentId.make("remote"), "host", "owner");
    return (
      <button
        onClick={() => {
          first = c.act({
            operation: "routineFlow.savePosition",
            agentId: "owner",
            nodeKey: "agent:worker",
            x: 8,
            y: 8,
          });
          second = c.act({
            operation: "routineFlow.savePosition",
            agentId: "owner",
            nodeKey: "agent:worker",
            x: 16,
            y: 24,
          });
        }}
      >
        Move twice
      </button>
    );
  }
  await using screen = await render(<Probe />);
  await screen.getByRole("button", { name: "Move twice" }).click();
  expect(state.write).toHaveBeenCalledTimes(1);
  resolveFirst({ _tag: "Success", value: {} });
  expect(await first).toBe(true);
  expect(await second).toBe(true);
  expect(state.write).toHaveBeenCalledTimes(2);
  expect(state.write.mock.calls[1]?.[0]).toMatchObject({
    input: { request: { nodeKey: "agent:worker", x: 16, y: 24 } },
  });
});
