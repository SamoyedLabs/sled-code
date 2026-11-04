import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { expect, it } from "@effect/vitest";
import {
  CommandId,
  EventId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  RunId,
  ThreadId,
  type OrchestrationV2ThreadProjection,
  type OrchestrationV2Run,
} from "@t3tools/contracts";
import { type OpenbotCodingLaunchInput } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as ThreadLaunch from "../orchestration-v2/ThreadLaunchService.ts";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import * as CodingBridge from "./CodingBridge.ts";

const now = DateTime.makeUnsafe("2026-11-03T12:00:00Z");
const isJson = Schema.is(Schema.Json);
const projectId = ProjectId.make("project-bots");
const modelSelection = { instanceId: ProviderInstanceId.make("codex"), model: "fixture" };
const input: OpenbotCodingLaunchInput = {
  origin: { hostId: "host", agentId: "repo-bot", taskId: "fix-issue" },
  operationId: "coding-1",
  projectId,
  title: "Fix issue",
  prompt: "Fix the issue",
  modelSelection,
  runtimeMode: "approval-required",
  interactionMode: "default",
  workspaceStrategy: { type: "root" },
};

function projection(threadId: ThreadId): OrchestrationV2ThreadProjection {
  return ProjectionStore.emptyProjection({
    type: "thread.created",
    id: EventId.make("created"),
    threadId,
    occurredAt: now,
    payload: {
      id: threadId,
      projectId,
      title: "Fix issue",
      providerInstanceId: modelSelection.instanceId,
      modelSelection,
      runtimeMode: "approval-required",
      interactionMode: "default",
      branch: null,
      worktreePath: null,
      activeProviderThreadId: null,
      lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: threadId },
      forkedFrom: null,
      createdBy: "agent",
      creationSource: "server",
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
      settledOverride: null,
      settledAt: null,
      lastVisitedAt: null,
      deletedAt: null,
    },
  });
}

function run(threadId: ThreadId, status: OrchestrationV2Run["status"]): OrchestrationV2Run {
  return {
    id: RunId.make("work"),
    threadId,
    ordinal: 1,
    providerInstanceId: modelSelection.instanceId,
    modelSelection,
    providerThreadId: null,
    userMessageId: MessageId.make("prompt"),
    rootNodeId: null,
    activeAttemptId: null,
    status,
    requestedAt: now,
    startedAt: now,
    completedAt: status === "completed" ? now : null,
    checkpointId: null,
    contextHandoffId: null,
  };
}

function harness(uncertainFirstLaunch = false) {
  const projections = new Map<ThreadId, OrchestrationV2ThreadProjection>();
  const commands: Array<string> = [];
  let interrupts = 0;
  const layer = Layer.mergeAll(
    Layer.mock(ThreadLaunch.ThreadLaunchService)({
      launch: (launchInput) =>
        Effect.gen(function* () {
          commands.push(launchInput.commandId);
          const threadId = launchInput.threadId!;
          if (!projections.has(threadId))
            projections.set(threadId, {
              ...projection(threadId),
              runs: [run(threadId, "running")],
            });
          if (uncertainFirstLaunch && commands.length === 1) {
            return yield* new ThreadLaunch.ThreadLaunchError({
              operation: "dispatch-message",
              commandId: launchInput.commandId,
              projectId,
              threadId,
              cause: new Error("response lost after execution accepted"),
            });
          }
          return { threadId, projection: projections.get(threadId)!, resumed: commands.length > 1 };
        }),
    }),
    Layer.mock(ProjectionStore.ProjectionStoreV2)({
      getThreadProjection: (threadId) => {
        const value = projections.get(threadId);
        return value
          ? Effect.succeed(value)
          : Effect.fail(new ProjectionStore.ProjectionStoreThreadNotFoundError({ threadId }));
      },
    }),
    Layer.mock(ThreadManagement.ThreadManagementService)({
      dispatch: (command) =>
        Effect.sync(() => {
          if (command.type === "thread.stop") {
            interrupts++;
            const current = projections.get(command.threadId)!;
            projections.set(command.threadId, {
              ...current,
              runs: current.runs.map((value) =>
                value.status === "queued"
                  ? { ...value, queueHeld: true }
                  : { ...value, status: "interrupted" as const },
              ),
            });
          } else if (command.type === "queued-run.cancel") {
            const current = projections.get(command.threadId)!;
            projections.set(command.threadId, {
              ...current,
              runs: current.runs.map((value) =>
                value.id === command.runId ? { ...value, status: "cancelled" as const } : value,
              ),
            });
          }
          return { sequence: 1, storedEvents: [] };
        }),
      stopDelegatedTasks: () => Effect.void,
    }),
  );
  return { layer, projections, commands, interrupted: () => interrupts };
}

it.effect.each(["fix-issue", null])(
  "retries an uncertain launch with the same durable thread and receipt after service reconstruction (%s)",
  (taskId) => {
    const launchInput = { ...input, origin: { ...input.origin, taskId } };
    const h = harness(true);
    return Effect.gen(function* () {
      yield* Effect.gen(function* () {
        const bridge = yield* CodingBridge.CodingBridge;
        expect((yield* Effect.flip(bridge.launch(launchInput))).reason).toBe("execution");
      }).pipe(Effect.provide(CodingBridge.layer));
      yield* Effect.gen(function* () {
        const bridge = yield* CodingBridge.CodingBridge;
        const resumed = yield* bridge.launch(launchInput);
        expect(resumed.origin).toEqual(launchInput.origin);
        expect(resumed.state).toBe("running");
        expect(isJson(resumed)).toBe(true);
        expect(h.commands.length).toBe(2);
        expect(new Set(h.commands).size).toBe(1);
        expect(h.projections.size).toBe(1);
        expect(yield* bridge.get(launchInput)).toEqual(resumed);
        expect(yield* bridge.list({ ...launchInput.origin })).toEqual([resumed]);
        expect(
          (yield* Effect.flip(bridge.launch({ ...launchInput, prompt: "Different assignment" })))
            .reason,
        ).toBe("conflict");
      }).pipe(Effect.provide(CodingBridge.layer));
    }).pipe(
      Effect.provide(Layer.mergeAll(h.layer, SqlitePersistence.layerMemory, NodeCrypto.layer)),
    );
  },
);

it.effect(
  "reports execution completion rather than launch acceptance and keeps cancellation after restart",
  () => {
    const h = harness();
    return Effect.gen(function* () {
      yield* Effect.gen(function* () {
        const bridge = yield* CodingBridge.CodingBridge;
        const launched = yield* bridge.launch(input);
        expect(launched.state).toBe("running");
        h.projections.set(launched.threadId, {
          ...h.projections.get(launched.threadId)!,
          runs: [run(launched.threadId, "completed")],
        });
        expect((yield* bridge.get(input)).state).toBe("completed");
        const completed = h.projections.get(launched.threadId)!;
        h.projections.set(launched.threadId, {
          ...completed,
          runs: [
            ...completed.runs,
            { ...run(launched.threadId, "queued"), id: RunId.make("queued"), ordinal: 2 },
          ],
        });
        yield* bridge.cancel({ ...input, commandId: CommandId.make("cancel") });
        expect(h.interrupted()).toBe(1);
        expect(
          h.projections.get(launched.threadId)!.runs.find((value) => value.id === "queued")?.status,
        ).toBe("cancelled");
      }).pipe(Effect.provide(CodingBridge.layer));
      yield* Effect.gen(function* () {
        const bridge = yield* CodingBridge.CodingBridge;
        expect((yield* bridge.launch(input)).cancelRequested).toBe(true);
        expect(h.commands).toHaveLength(1);
        expect(
          (yield* Effect.flip(
            bridge.send({ ...input, commandId: CommandId.make("followup"), text: "continue" }),
          )).reason,
        ).toBe("cancelled");
        expect(yield* bridge.list({ hostId: "other", agentId: "repo-bot" })).toEqual([]);
        expect(
          (yield* Effect.flip(
            bridge.get({ ...input, origin: { ...input.origin, agentId: "other" } }),
          )).reason,
        ).toBe("not-found");
      }).pipe(Effect.provide(CodingBridge.layer));
    }).pipe(
      Effect.provide(Layer.mergeAll(h.layer, SqlitePersistence.layerMemory, NodeCrypto.layer)),
    );
  },
);

it.effect("refuses a channel origin before persisting or launching side-task work", () => {
  const h = harness();
  return Effect.gen(function* () {
    const bridge = yield* CodingBridge.CodingBridge;
    const channelInput = { ...input, origin: { ...input.origin, channelId: "channel-1" } };
    expect((yield* Effect.flip(bridge.launch(channelInput))).reason).toBe("unsupported-channel");
    expect(h.commands).toEqual([]);
    expect(
      yield* bridge.list({ hostId: input.origin.hostId, agentId: input.origin.agentId }),
    ).toEqual([]);
  }).pipe(
    Effect.provide(
      CodingBridge.layer.pipe(
        Layer.provide(Layer.mergeAll(h.layer, SqlitePersistence.layerMemory, NodeCrypto.layer)),
      ),
    ),
  );
});
