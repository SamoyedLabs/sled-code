import { expect, it } from "@effect/vitest";
import {
  EventId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  RunId,
  ThreadId,
  type OpenbotCodingTask,
  type OrchestrationV2AppThread,
  type OrchestrationV2Run,
} from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as TestClock from "effect/testing/TestClock";
import * as TeamClient from "./TeamClient.ts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";
import * as Stream from "effect/Stream";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as Events from "../persistence/OrchestrationEventStore.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as CodingBridge from "./CodingBridge.ts";
import * as CodingDelivery from "./CodingDelivery.ts";
import * as Integration from "./Integration.ts";

const threadId = ThreadId.make("coding-thread");
const runId = RunId.make("coding-run");
const projectId = ProjectId.make("project");
const now = DateTime.makeUnsafe("2026-11-03T12:00:00Z");
const modelSelection = { instanceId: ProviderInstanceId.make("codex"), model: "fixture" };
const thread: OrchestrationV2AppThread = {
  id: threadId,
  projectId,
  title: "Fix issue",
  providerInstanceId: modelSelection.instanceId,
  modelSelection,
  createdBy: "agent",
  creationSource: "server",
  runtimeMode: "approval-required",
  interactionMode: "default",
  branch: null,
  worktreePath: null,
  activeProviderThreadId: null,
  lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: threadId },
  forkedFrom: null,
  createdAt: now,
  updatedAt: now,
  archivedAt: null,
  settledOverride: null,
  settledAt: null,
  lastVisitedAt: null,
  deletedAt: null,
};
const run: OrchestrationV2Run = {
  id: runId,
  threadId,
  ordinal: 1,
  providerInstanceId: modelSelection.instanceId,
  modelSelection,
  providerThreadId: null,
  userMessageId: MessageId.make("prompt"),
  rootNodeId: null,
  activeAttemptId: null,
  status: "completed",
  requestedAt: now,
  startedAt: now,
  completedAt: now,
  checkpointId: null,
  contextHandoffId: null,
};
const task: OpenbotCodingTask = {
  origin: { hostId: "host", agentId: "bot", taskId: "task" },
  operationId: "operation",
  projectId,
  threadId,
  state: "completed",
  runId,
  cancelRequested: false,
  pendingRequestIds: [],
  result: "Fixed the issue.",
};
const seed = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`INSERT INTO openbot_coding_tasks (host_id, agent_id, task_id, operation_id, project_id, thread_id, command_id, input_json, created_at)
    VALUES ('host', 'bot', 'task', 'operation', 'project', 'coding-thread', 'launch', '{}', '2026-11-03T12:00:00Z')`;
});

it.effect.each(["conversation", "queued", "unconfirmed", "legacy"] as const)(
  "reconciles an uncertain result after reconstruction without replaying beyond the receipt horizon (%s)",
  (evidence) => {
    const acceptedIds = new Set<string>();
    const attempts: string[] = [];
    let acceptedText = "";
    let returnedTask = task;
    const projection = {
      ...ProjectionStore.emptyProjection({
        type: "thread.created",
        id: EventId.make("created"),
        threadId,
        occurredAt: now,
        payload: thread,
      }),
      runs: [run],
    };
    const dependencies = Layer.mergeAll(
      SqlitePersistence.layerMemory,
      Layer.mock(CodingBridge.CodingBridge)({
        get: () => Effect.sync(() => returnedTask),
        changes: Stream.empty,
      }),
      Layer.mock(ProjectionStore.ProjectionStoreV2)({
        getThreadProjection: () => Effect.succeed(projection),
      }),
      Layer.mock(Events.OrchestrationEventStore)({}),
      Layer.mock(Integration.Integration)({
        readyHostId: Effect.succeed("host"),
        readyChanges: Stream.empty,
        apiReadToHost: (hostId, input) =>
          Effect.sync(() => {
            expect(hostId).toBe("host");
            if (input.operation === "task.read")
              return {
                agentId: "bot",
                messages: [
                  {
                    id: "accepted-message",
                    author: evidence === "conversation" ? "user" : "assistant",
                    text: acceptedText,
                  },
                ],
              };
            if (input.operation === "task.list")
              return {
                agentId: "bot",
                tasks: [
                  {
                    id: evidence === "queued" ? "task" : "other-task",
                    queuedMessages: [{ deliveryId: "upstream-delivery" }],
                  },
                ],
              };
            expect(input.operation).toBe("queue.read");
            return {
              agentId: "bot",
              deliveries: [
                {
                  id: "upstream-delivery",
                  recipientAgentId: "bot",
                  sender: { kind: "user" },
                  text: acceptedText,
                },
              ],
            };
          }),
        apiWriteToHost: (hostId, input) =>
          Effect.gen(function* () {
            expect(hostId).toBe("host");
            if (input.operation !== "task.send") return yield* Effect.die("Unexpected operation");
            attempts.push(input.clientMessageId);
            acceptedText = input.text;
            acceptedIds.add(input.clientMessageId);
            if (attempts.length === 1)
              return yield* new Integration.IntegrationError({
                message: "Response lost",
                cause: new Error("response lost after acceptance"),
              });
            return { messageId: input.clientMessageId, deliveries: [{ recipientAgentId: "bot" }] };
          }),
      }),
    );
    return Effect.gen(function* () {
      yield* seed;
      yield* Effect.gen(function* () {
        const delivery = yield* CodingDelivery.CodingDelivery;
        expect((yield* Effect.flip(delivery.reconcile(threadId))).stage).toBe("send");
      }).pipe(Effect.provide(CodingDelivery.layer));
      if (evidence === "legacy") {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`UPDATE openbot_coding_deliveries SET first_attempt_at = NULL, payload_text = NULL`;
      } else yield* TestClock.adjust("25 hours");
      returnedTask = { ...task, result: "A later edited result." };
      yield* Effect.gen(function* () {
        const delivery = yield* CodingDelivery.CodingDelivery;
        const accepted = evidence === "conversation" || evidence === "queued";
        const notice = yield* delivery.changes.pipe(
          Stream.mapEffect((change) =>
            Effect.gen(function* () {
              const sql = yield* SqlClient.SqlClient;
              const rows = yield* sql<{
                readonly accepted_at: string | null;
                readonly reconciliation_required: number;
              }>`SELECT accepted_at, reconciliation_required FROM openbot_coding_deliveries`;
              return { change, receipt: rows[0] };
            }),
          ),
          Stream.filter(
            ({ receipt }) =>
              receipt !== undefined &&
              (accepted ? receipt.accepted_at !== null : receipt.reconciliation_required === 1),
          ),
          Stream.take(1),
          Stream.runCollect,
          Effect.forkChild({ startImmediately: true }),
        );
        if (accepted) {
          yield* delivery.reconcile(threadId);
          yield* delivery.reconcile(threadId);
        } else
          expect((yield* Effect.flip(delivery.reconcile(threadId))).stage).toBe("reconciliation");
        expect((yield* Fiber.join(notice)).map(({ change }) => change)).toEqual([
          { hostId: "host", resource: "all" },
        ]);
      }).pipe(Effect.provide(CodingDelivery.layer));
      expect(attempts).toHaveLength(1);
      expect(acceptedIds.size).toBe(1);
      const sql = yield* SqlClient.SqlClient;
      const rows = yield* sql<{
        readonly accepted_at: string | null;
        readonly reconciliation_required: number;
      }>`SELECT accepted_at, reconciliation_required FROM openbot_coding_deliveries`;
      if (evidence === "conversation" || evidence === "queued") {
        expect(rows[0]?.accepted_at).not.toBeNull();
        expect(rows[0]?.reconciliation_required).toBe(0);
      } else {
        expect(rows[0]?.accepted_at).toBeNull();
        expect(rows[0]?.reconciliation_required).toBe(1);
      }
    }).pipe(Effect.provide(dependencies));
  },
);

it.effect("does not deliver a result into a different host or while coding remains active", () => {
  let hostId = "other-host";
  let completed = false;
  let sends = 0;
  const dependencies = Layer.mergeAll(
    SqlitePersistence.layerMemory,
    Layer.mock(CodingBridge.CodingBridge)({
      get: () => Effect.sync(() => ({ ...task, state: completed ? "completed" : "running" })),
      changes: Stream.empty,
    }),
    Layer.mock(ProjectionStore.ProjectionStoreV2)({
      getThreadProjection: () =>
        Effect.succeed({
          ...ProjectionStore.emptyProjection({
            type: "thread.created",
            id: EventId.make("created"),
            threadId,
            occurredAt: now,
            payload: thread,
          }),
          runs: [run],
        }),
    }),
    Layer.mock(Events.OrchestrationEventStore)({}),
    Layer.mock(Integration.Integration)({
      readyHostId: Effect.sync(() => hostId),
      readyChanges: Stream.empty,
      apiWriteToHost: () =>
        Effect.sync(() => {
          sends++;
          return { messageId: "ack", deliveries: [{ recipientAgentId: "bot" }] };
        }),
    }),
  );
  return Effect.gen(function* () {
    yield* seed;
    const delivery = yield* CodingDelivery.CodingDelivery;
    yield* delivery.reconcile(threadId);
    expect(sends).toBe(0);
    hostId = "host";
    yield* delivery.reconcile(threadId);
    expect(sends).toBe(0);
    completed = true;
    yield* delivery.reconcile(threadId);
    expect(sends).toBe(1);
  }).pipe(Effect.provide(CodingDelivery.layer.pipe(Layer.provideMerge(dependencies))));
});

it.effect(
  "reconciles on readiness and retries transient delivery without another application event",
  () =>
    Effect.gen(function* () {
      const failed = yield* Deferred.make<void>();
      const accepted = yield* Deferred.make<void>();
      let attempts = 0;
      const projection = {
        ...ProjectionStore.emptyProjection({
          type: "thread.created",
          id: EventId.make("created"),
          threadId,
          occurredAt: now,
          payload: thread,
        }),
        runs: [run],
      };
      yield* Effect.gen(function* () {
        yield* seed;
        const delivery = yield* CodingDelivery.CodingDelivery;
        yield* delivery.start;
        yield* Deferred.await(failed);
        yield* TestClock.adjust("10 seconds");
        yield* Deferred.await(accepted);
        expect(attempts).toBe(2);
      }).pipe(
        Effect.provide(
          CodingDelivery.layer.pipe(
            Layer.provideMerge(
              Layer.mergeAll(
                SqlitePersistence.layerMemory,
                Layer.mock(CodingBridge.CodingBridge)({
                  get: () => Effect.succeed(task),
                  changes: Stream.empty,
                }),
                Layer.mock(ProjectionStore.ProjectionStoreV2)({
                  getThreadProjection: () => Effect.succeed(projection),
                }),
                Layer.mock(Events.OrchestrationEventStore)({
                  latestApplicationSequence: Effect.succeed(0),
                  streamApplicationEvents: () => Stream.empty,
                }),
                Layer.mock(Integration.Integration)({
                  readyHostId: Effect.succeed("host"),
                  readyChanges: Stream.make("host"),
                  apiReadToHost: (_host, input) =>
                    Effect.succeed(
                      input.operation === "task.read"
                        ? { agentId: "bot", messages: [] }
                        : { agentId: "bot", tasks: [] },
                    ),
                  apiWriteToHost: (_host, _input) =>
                    Effect.gen(function* () {
                      attempts++;
                      if (attempts === 1) {
                        yield* Deferred.succeed(failed, undefined);
                        return yield* new Integration.IntegrationError({
                          message: "Temporary outage",
                          cause: new TeamClient.TeamClientError({ reason: "transport" }),
                        });
                      }
                      yield* Deferred.succeed(accepted, undefined);
                      return { messageId: "ack", deliveries: [{ recipientAgentId: "bot" }] };
                    }),
                }),
              ),
            ),
          ),
        ),
        Effect.scoped,
      );
    }),
);
