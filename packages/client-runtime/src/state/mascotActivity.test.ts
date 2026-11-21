import { EnvironmentId, ProviderInstanceId, RunId, ThreadId } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult, Atom, AtomRegistry } from "effect/reactivity";
import { describe, expect, it } from "vite-plus/test";

import {
  AVAILABLE_CONNECTION_STATE,
  PrimaryConnectionTarget,
  type SupervisorConnectionState,
} from "../connection/model.ts";
import type { EnvironmentCatalogState } from "./connections.ts";
import { createMascotActivityAtom } from "./mascotActivity.ts";
import {
  presentThreadShell,
  type EnvironmentThreadShell,
  type ThreadRuntimeSummary,
} from "./models.ts";
import { v2ThreadShell } from "./orchestrationV2TestFixtures.ts";

const FIRST = EnvironmentId.make("first");
const SECOND = EnvironmentId.make("second");
const FINISHED_AT = "2026-06-20T00:00:01.000Z";

function thread(
  status: ThreadRuntimeSummary["status"] = "running",
  overrides: Partial<EnvironmentThreadShell> = {},
): EnvironmentThreadShell {
  const runId = RunId.make("run-1");
  return {
    ...presentThreadShell(FIRST, v2ThreadShell),
    id: ThreadId.make("thread"),
    runtime: {
      status,
      activeRunId: status === "running" || status === "waiting" ? runId : null,
      providerInstanceId: ProviderInstanceId.make("codex"),
      providerName: "Codex",
      lastError: status === "failed" ? "Failed" : null,
      updatedAt: FINISHED_AT,
    },
    latestRun:
      status === "idle"
        ? null
        : {
            runId,
            status,
            requestedAt: "2026-06-20T00:00:00.000Z",
            startedAt: "2026-06-20T00:00:00.000Z",
            completedAt: status === "completed" || status === "failed" ? FINISHED_AT : null,
            assistantMessageId: null,
          },
    ...overrides,
  };
}

function entry(environmentId: EnvironmentId) {
  return {
    target: new PrimaryConnectionTarget({
      environmentId,
      label: environmentId,
      httpBaseUrl: "https://example.test",
      wsBaseUrl: "wss://example.test",
    }),
    enabled: true,
    profile: Option.none(),
  };
}

function harness(initialThreads: ReadonlyArray<EnvironmentThreadShell> = []) {
  const registry = AtomRegistry.make();
  const catalog = Atom.make<EnvironmentCatalogState>({
    isReady: true,
    entries: new Map([
      [FIRST, entry(FIRST)],
      [SECOND, entry(SECOND)],
    ]),
  });
  const connections = Atom.family((_id: EnvironmentId) =>
    Atom.make(
      AsyncResult.success<SupervisorConnectionState>({
        ...AVAILABLE_CONNECTION_STATE,
        desired: true,
        phase: "connected",
      }),
    ),
  );
  const threads = Atom.make(initialThreads);
  const activity = createMascotActivityAtom({
    catalogValueAtom: catalog,
    connectionStateAtom: connections,
    threadShellsAtom: threads,
  });
  const release = registry.mount(activity);
  return {
    registry,
    catalog,
    connections,
    threads,
    activity,
    [Symbol.dispose]() {
      release();
      registry.dispose();
    },
  };
}

describe("mascot activity", () => {
  it("prioritizes a request across environments over work, and work over unread failure", () => {
    using h = harness([thread("failed"), thread("running", { environmentId: SECOND })]);
    expect(h.registry.get(h.activity).state).toBe("working");
    h.registry.set(h.threads, [
      thread("failed"),
      thread("running", { environmentId: SECOND, pendingSubagentRequest: "approval" }),
    ]);
    expect(h.registry.get(h.activity).state).toBe("attention");
    h.registry.set(h.threads, [
      thread("failed"),
      thread("waiting", { environmentId: SECOND, hasPendingUserInput: true }),
    ]);
    expect(h.registry.get(h.activity).state).toBe("attention");
    h.registry.set(h.threads, [thread("failed")]);
    expect(h.registry.get(h.activity).state).toBe("error");
  });

  it("ignores archived, deleted, visited, and settled historical failures", () => {
    using h = harness([
      thread("failed", { archivedAt: FINISHED_AT }),
      thread("failed", { deletedAt: FINISHED_AT }),
      thread("failed", { lastVisitedAt: FINISHED_AT }),
      thread("failed", { settledOverride: "settled" }),
      thread("failed", { settledAt: FINISHED_AT }),
    ]);
    expect(h.registry.get(h.activity).state).toBe("sleeping");
    h.registry.set(h.threads, []);
    expect(h.registry.get(h.activity).state).toBe("sleeping");
  });

  it("ignores stale disconnected requests without hiding other environments' work", () => {
    using h = harness([
      thread("running", { hasPendingApprovals: true }),
      thread("running", { environmentId: SECOND }),
    ]);
    h.registry.set(
      h.connections(FIRST),
      AsyncResult.success({ ...AVAILABLE_CONNECTION_STATE, desired: true, phase: "backoff" }),
    );
    expect(h.registry.get(h.activity).state).toBe("working");
    h.registry.set(
      h.connections(SECOND),
      AsyncResult.success({ ...AVAILABLE_CONNECTION_STATE, desired: true, phase: "offline" }),
    );
    expect(h.registry.get(h.activity).state).toBe("offline");
    h.registry.set(h.catalog, { isReady: true, entries: new Map() });
    expect(h.registry.get(h.activity).state).toBe("sleeping");
  });

  it("does not count disabled environments, but keeps request-free waiting runs working", () => {
    using h = harness([
      thread("running", { hasPendingUserInput: true }),
      thread("waiting", { environmentId: SECOND }),
    ]);
    h.registry.set(h.catalog, {
      isReady: true,
      entries: new Map([
        [FIRST, { ...entry(FIRST), enabled: false }],
        [SECOND, entry(SECOND)],
      ]),
    });
    expect(h.registry.get(h.activity).state).toBe("working");
  });

  it("celebrates an observed completion once, retaining the activity object through unrelated ticks", () => {
    using h = harness([thread("completed")]);
    expect(h.registry.get(h.activity).completionKey).toBeNull();
    h.registry.set(h.threads, [thread("running")]);
    expect(h.registry.get(h.activity).state).toBe("working");
    h.registry.set(h.threads, [thread("completed")]);
    const completed = h.registry.get(h.activity);
    expect(completed).toEqual({
      state: "sleeping",
      completionKey: JSON.stringify([FIRST, "thread", "run-1"]),
    });
    h.registry.set(h.threads, [thread("completed", { updatedAt: "2026-06-20T00:00:02.000Z" })]);
    expect(h.registry.get(h.activity)).toBe(completed);
  });

  it("does not replay success after a disconnect or celebrate a failed run", () => {
    using h = harness([thread("running")]);
    h.registry.get(h.activity);
    h.registry.set(
      h.connections(FIRST),
      AsyncResult.success({ ...AVAILABLE_CONNECTION_STATE, phase: "offline" }),
    );
    h.registry.get(h.activity);
    h.registry.set(h.threads, [thread("completed")]);
    h.registry.set(
      h.connections(FIRST),
      AsyncResult.success({ ...AVAILABLE_CONNECTION_STATE, phase: "connected" }),
    );
    expect(h.registry.get(h.activity).completionKey).toBeNull();
    h.registry.set(h.threads, [thread("running")]);
    h.registry.get(h.activity);
    h.registry.set(h.threads, [thread("failed")]);
    expect(h.registry.get(h.activity)).toEqual({ state: "error", completionKey: null });
  });
});
