import { RegistryContext } from "@effect/atom-react";
import { Atom, AtomRegistry } from "effect/reactivity";
import { EnvironmentId } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";
import { render } from "../../../test/render";
import { openbot } from "../../state/openbot";
import { useBotRoutineIndex } from "./useBotRoutineIndex";

const transport = vi.hoisted(() => ({
  connection: { id: "original" },
  read: vi.fn(),
  command: vi.fn(),
}));
vi.mock("../../state/session", async () => {
  const Option = await import("effect/Option");
  return {
    usePreparedConnection: () => Option.some(transport.connection),
    readPreparedConnection: () => transport.connection,
  };
});
vi.mock("../../state/use-atom-query-runner", () => ({ useAtomQueryRunner: () => transport.read }));
vi.mock("../../state/use-atom-command", () => ({ useAtomCommand: () => transport.command }));
const agents = [{ id: "writer", name: "Writer" }];
const routine = (id: string, ownerId = "writer") => ({
  owner: { kind: "agent", id: ownerId },
  id,
  name: id,
  instruction: "Read the assigned source",
  active: false,
  timezone: "America/Chicago",
  trigger: { kind: "schedule", schedule: { kind: "once", date: "2026-12-01", time: "12:00" } },
  createdAt: "2026-11-15T12:00:00Z",
  updatedAt: "2026-11-15T12:00:00Z",
});
function Probe({
  enabled = true,
  hostId = "host",
  withGroup = false,
}: {
  enabled?: boolean;
  hostId?: string;
  withGroup?: boolean;
}) {
  const index = useBotRoutineIndex({
    enabled,
    environmentId: EnvironmentId.make("machine"),
    hostId,
    agents,
    channels: withGroup ? [{ id: "group", name: "Group" }] : [],
  });
  return (
    <>
      <output aria-label="Routines">{index.items.map((r) => r.name).join("|")}</output>
      <output aria-label="Pending">{index.pending ? "loading" : "ready"}</output>
      <output aria-label="Failed">{String(index.failed)}</output>
    </>
  );
}
function tree(enabled: boolean, hostId = "host") {
  return (
    <RegistryContext.Provider value={AtomRegistry.make()}>
      <Probe enabled={enabled} hostId={hostId} />
    </RegistryContext.Provider>
  );
}
it("indexes one-time routines under their actual owner without searching while closed", async () => {
  using _permission = vi
    .spyOn(openbot.adminToHost, "permissionAtom")
    .mockReturnValue(Atom.make(true));
  transport.read
    .mockReset()
    .mockResolvedValue({ _tag: "Success", value: { capabilities: ["sled-once-routines-v1"] } });
  transport.command.mockReset().mockResolvedValue({
    _tag: "Success",
    value: [routine("Coursework reminder"), routine("Foreign", "other")],
  });
  await using view = await render(tree(false), { router: false });
  expect(transport.read).not.toHaveBeenCalled();
  await view.rerender(tree(true));
  await expect.element(view.getByLabelText("Routines")).toHaveTextContent("Coursework reminder");
  await expect.element(view.getByLabelText("Routines")).not.toHaveTextContent("Foreign");
  expect(transport.command.mock.calls[0]?.[0]).toMatchObject({
    environmentId: "machine",
    input: {
      hostId: "host",
      request: {
        operation: "events.list",
        owner: { kind: "agent", id: "writer" },
        includeOneTime: true,
      },
    },
  });
});
it("searches group routines through the released group-capable endpoint when bots support one-time schedules", async () => {
  using _permission = vi
    .spyOn(openbot.adminToHost, "permissionAtom")
    .mockReturnValue(Atom.make(true));
  transport.read.mockReset().mockResolvedValue({
    _tag: "Success",
    value: { capabilities: ["sled-once-routines-v1", "routine-recovery-v1"] },
  });
  transport.command.mockReset().mockImplementation(async ({ input }) => {
    const request = input.request;
    if (request.owner.kind === "channel" && request.includeOneTime) return { _tag: "Failure" };
    return {
      _tag: "Success",
      value:
        request.owner.kind === "channel"
          ? [
              {
                ...routine("Group check"),
                owner: { kind: "channel", id: "group" },
                trigger: { kind: "schedule", schedule: { kind: "daily", time: "12:00" } },
              },
            ]
          : [routine("Bot once check")],
    };
  });
  await using view = await render(
    <RegistryContext.Provider value={AtomRegistry.make()}>
      <Probe withGroup />
    </RegistryContext.Provider>,
    { router: false },
  );
  await expect.element(view.getByLabelText("Pending")).toHaveTextContent("ready");
  await expect
    .element(view.getByLabelText("Routines"))
    .toHaveTextContent("Bot once check|Group check");
  await expect.element(view.getByLabelText("Failed")).toHaveTextContent("false");
});
it("discards delayed results when the search closes or its authenticated connection changes", async () => {
  using _permission = vi
    .spyOn(openbot.adminToHost, "permissionAtom")
    .mockReturnValue(Atom.make(true));
  transport.read
    .mockReset()
    .mockResolvedValue({ _tag: "Success", value: { capabilities: ["routine-recovery-v1"] } });
  let finish: (value: unknown) => void = () => {};
  transport.command.mockReset().mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await using view = await render(tree(true), { router: false });
  await expect.poll(() => transport.command.mock.calls.length).toBe(1);
  await view.rerender(tree(false));
  finish({ _tag: "Success", value: [routine("Old result")] });
  await expect.element(view.getByLabelText("Routines")).toHaveTextContent("");
  await view.rerender(tree(true));
  await expect.poll(() => transport.command.mock.calls.length).toBe(2);
  transport.connection = { id: "replacement" };
  finish({ _tag: "Success", value: [routine("Old principal result")] });
  await expect.element(view.getByLabelText("Routines")).toHaveTextContent("");
});
