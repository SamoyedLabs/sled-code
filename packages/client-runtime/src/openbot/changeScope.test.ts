import { expect, it } from "@effect/vitest";
import { changeScopeForRead, changeToken } from "./changeScope.ts";
import type { OpenbotChange } from "@t3tools/contracts";

it("retains resource and target invalidations across replaced frames without refreshing unrelated readers", () => {
  const task = changeScopeForRead({ operation: "task.read", agentId: "a", taskId: "task-a" });
  const other = changeScopeForRead({ operation: "task.read", agentId: "b", taskId: "task-b" });
  const first: OpenbotChange = {
    hostId: "host",
    resource: "tasks",
    epoch: 0,
    versions: { '["tasks","a","task-a"]': 1 },
  };
  const replaced: OpenbotChange = {
    ...first,
    resource: "memory",
    versions: { ...first.versions, '["tasks","a","task-a"]': 2, '["memory","b",null]': 3 },
  };
  expect(changeToken(first, task)).not.toEqual(changeToken(replaced, task));
  expect(changeToken(first, other)).toEqual(changeToken(replaced, other));
  expect(changeToken(first, { resources: ["agents"] })).toEqual(
    changeToken(replaced, { resources: ["agents"] }),
  );
  expect(changeToken(first, { resources: ["attention"] })).toEqual(
    changeToken(replaced, { resources: ["attention"] }),
  );
  const reset = { ...replaced, epoch: 1, versions: {} };
  expect(changeToken(replaced, other)).not.toEqual(changeToken(reset, other));
  expect(changeToken({ ...first, hostId: "replacement" }, task)).not.toEqual(
    changeToken(first, task),
  );
  const global = { ...replaced, versions: { ...replaced.versions, '["all",null,null]': 4 } };
  expect(changeToken(replaced, other)).not.toEqual(changeToken(global, other));
});

it("refreshes a routine canvas when runs, flows, or agents change", () => {
  const scope = changeScopeForRead({ operation: "routineFlow.canvas", agentId: "owner" });
  for (const resource of ["routines", "activity", "agents"] as const) {
    const first: OpenbotChange = { hostId: "host", resource, epoch: 0, versions: {} };
    const updated = { ...first, versions: { [JSON.stringify([resource, "owner", null])]: 1 } };
    expect(changeToken(first, scope)).not.toEqual(changeToken(updated, scope));
  }
});

it("refreshes pending conversation forms on attention changes without reacting to unrelated resources or targets", () => {
  const main = changeScopeForRead({
    operation: "conversation.page",
    agentId: "a",
    taskId: null,
    deferDetails: true,
    anchor: { type: "latest" },
    limit: 50,
  });
  const task = changeScopeForRead({
    operation: "conversation.page",
    agentId: "a",
    taskId: "task-a",
    deferDetails: true,
    anchor: { type: "latest" },
    limit: 50,
  });
  const before: OpenbotChange = { hostId: "host", resource: "attention", epoch: 0, versions: {} };
  const resolved = { ...before, versions: { '["attention",null,null]': 1 } };
  for (const scope of [main, task]) {
    expect(changeToken(before, scope)).not.toEqual(changeToken(resolved, scope));
    const unrelated = {
      ...resolved,
      versions: {
        ...resolved.versions,
        '["conversation","b",null]': 2,
        '["tasks","a","task-b"]': 3,
        '["memory","a",null]': 4,
      },
    };
    expect(changeToken(resolved, scope)).toEqual(changeToken(unrelated, scope));
    expect(changeToken(resolved, scope)).toEqual(
      changeToken(
        { ...resolved, versions: { ...resolved.versions, '["memory","a",null]': 2 } },
        scope,
      ),
    );
  }
});
