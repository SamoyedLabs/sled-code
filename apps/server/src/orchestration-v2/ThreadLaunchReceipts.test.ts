import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { expect, it } from "@effect/vitest";
import {
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationV2ThreadShell,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Sqlite from "../persistence/Sqlite.ts";
import * as ThreadManagement from "./ThreadManagementService.ts";
import * as Receipts from "./ThreadLaunchReceipts.ts";

const key = { requestNamespace: "client:owner", clientRequestId: "launch-1" };
const legacyThreadId = ThreadId.make(
  "mcp:launch:af2fad62e95b3f178a62b2d58f4851a2ed0c04bc05cd7f25429e36760aae376d",
);
const projectId = ProjectId.make("project:destination");
const now = DateTime.makeUnsafe("2026-11-04T12:00:00Z");
function shell(id: ThreadId): OrchestrationV2ThreadShell {
  return {
    id,
    projectId,
    title: "Destination assignment",
    createdBy: "agent",
    creationSource: "mcp",
    providerInstanceId: ProviderInstanceId.make("codex"),
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "fixture" },
    runtimeMode: "approval-required",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: id },
    forkedFrom: null,
    activeProviderThreadId: null,
    latestRunId: null,
    activeRunId: null,
    status: "idle",
    pendingRuntimeRequest: null,
    latestVisibleMessage: null,
    latestUserMessageAt: null,
    hasActionableProposedPlan: false,
    pendingBackgroundTasks: [],
    providerInstanceHistory: [],
    itemCount: 0,
    visibleItemCount: 0,
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    deletedAt: null,
  };
}
function harness() {
  const threads = new Map<ThreadId, OrchestrationV2ThreadShell>();
  const stopped = new Set<ThreadId>();
  const dependencies = Layer.mergeAll(
    Sqlite.layerMemory,
    NodeCrypto.layer,
    Layer.mock(ThreadManagement.ThreadManagementService)({
      getThreadShell: (id) => Effect.sync(() => threads.get(id) ?? null),
      dispatch: (command) =>
        Effect.sync(() => {
          if (command.type === "thread.stop") stopped.add(command.threadId);
          return { sequence: 1, storedEvents: [] };
        }),
      stopDelegatedTasks: () => Effect.void,
    }),
  );
  const execute = (id: ThreadId) =>
    Effect.sync(() => {
      threads.set(id, shell(id));
      return id;
    });
  return { threads, stopped, dependencies, execute };
}

it.effect(
  "remembers a cancel-before-launch across reconstruction and isolates caller namespaces",
  () => {
    const h = harness();
    return Effect.gen(function* () {
      yield* Effect.gen(function* () {
        const receipts = yield* Receipts.ThreadLaunchReceipts;
        expect(yield* receipts.get(key, () => Effect.void)).toEqual({
          state: "unknown",
          threadId: null,
          projectId: null,
          cancelRequested: false,
          stopState: null,
        });
        expect(yield* receipts.cancel(key, () => Effect.void)).toEqual({
          state: "cancelled",
          threadId: null,
          projectId: null,
          cancelRequested: true,
          stopState: "not-needed",
        });
      }).pipe(Effect.provide(Receipts.layer));
      yield* Effect.gen(function* () {
        const receipts = yield* Receipts.ThreadLaunchReceipts;
        const result = yield* Effect.flip(
          receipts.withLaunch(key, ({ threadId }) => h.execute(threadId)),
        );
        expect(result._tag).toBe("ThreadLaunchCancelledError");
        expect(h.threads.size).toBe(0);
        const other = { ...key, requestNamespace: "client:other" };
        expect((yield* receipts.get(other, () => Effect.void)).state).toBe("unknown");
        yield* receipts.withLaunch(other, ({ threadId }) => h.execute(threadId));
        expect((yield* receipts.get(other, () => Effect.void)).state).toBe("accepted");
        expect((yield* receipts.get(key, () => Effect.void)).state).toBe("cancelled");
      }).pipe(Effect.provide(Receipts.layer));
    }).pipe(Effect.provide(h.dependencies));
  },
);

it.effect(
  "serializes a racing cancel with acceptance and finds legacy accepted launches without replay",
  () => {
    const h = harness();
    return Effect.gen(function* () {
      const receipts = yield* Receipts.ThreadLaunchReceipts;
      const entered = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      const launch = yield* receipts
        .withLaunch(key, ({ threadId }) =>
          Effect.gen(function* () {
            yield* Deferred.succeed(entered, undefined);
            yield* Deferred.await(release);
            return yield* h.execute(threadId);
          }),
        )
        .pipe(Effect.forkChild({ startImmediately: true }));
      yield* Deferred.await(entered);
      const cancelled = yield* receipts
        .cancel(key, () => Effect.void)
        .pipe(Effect.forkChild({ startImmediately: true }));
      yield* Deferred.succeed(release, undefined);
      expect(yield* Fiber.join(launch)).toBe(legacyThreadId);
      expect(yield* Fiber.join(cancelled)).toEqual({
        state: "cancelled",
        threadId: legacyThreadId,
        projectId,
        cancelRequested: true,
        stopState: "requested",
      });
      expect(h.stopped.has(legacyThreadId)).toBe(true);
      const other = { ...key, requestNamespace: "client:other" };
      expect((yield* receipts.get(other, () => Effect.void)).state).toBe("unknown");
    }).pipe(Effect.provide(Receipts.layer.pipe(Layer.provide(h.dependencies))));
  },
);

it.effect(
  "discovers an accepted legacy launch without replay and refuses revoked stop authority before persisting cancellation",
  () => {
    const h = harness();
    h.threads.set(legacyThreadId, shell(legacyThreadId));
    return Effect.gen(function* () {
      const receipts = yield* Receipts.ThreadLaunchReceipts;
      expect(yield* receipts.get(key, () => Effect.void)).toEqual({
        state: "accepted",
        threadId: legacyThreadId,
        projectId,
        cancelRequested: false,
        stopState: null,
      });
      expect(yield* Effect.flip(receipts.cancel(key, () => Effect.fail("revoked")))).toBe(
        "revoked",
      );
      expect((yield* receipts.get(key, () => Effect.void)).cancelRequested).toBe(false);
      expect(h.stopped.size).toBe(0);
      const cancelled = yield* receipts.cancel(key, () => Effect.void);
      expect(cancelled.stopState).toBe("requested");
      expect(h.stopped.has(legacyThreadId)).toBe(true);
    }).pipe(Effect.provide(Receipts.layer.pipe(Layer.provide(h.dependencies))));
  },
);
