import { ThreadId, type OpenbotCodingOrigin, type OpenbotChange } from "@t3tools/contracts";
import { delegatedTaskProgress } from "@t3tools/provider-core/server/subagentProjection";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Schedule from "effect/Schedule";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import * as SqlClient from "effect/sql/SqlClient";
import * as Stream from "effect/Stream";
import * as OrchestrationEvents from "../persistence/OrchestrationEventStore.ts";
import * as CodingBridge from "./CodingBridge.ts";
import * as Integration from "./Integration.ts";
import * as TeamClient from "./TeamClient.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";

export class CodingDeliveryError extends Schema.TaggedError<CodingDeliveryError>()(
  "OpenbotCodingDeliveryError",
  {
    stage: Schema.Literals([
      "storage",
      "read",
      "recovery",
      "reconciliation",
      "send",
      "acknowledgement",
    ]),
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Openbot coding result delivery failed (${this.stage}).`;
  }
}

export class CodingDelivery extends Context.Service<
  CodingDelivery,
  {
    readonly changes: Stream.Stream<OpenbotChange>;
    readonly reconcile: (threadId?: ThreadId) => Effect.Effect<void, CodingDeliveryError>;
    readonly start: Effect.Effect<void, never, Scope.Scope>;
  }
>()("t3/openbot/CodingDelivery") {}

interface TaskRow {
  readonly host_id: string;
  readonly agent_id: string;
  readonly task_id: string;
  readonly operation_id: string;
  readonly thread_id: string;
}
const Ack = Schema.Struct({
  messageId: Schema.String.check(Schema.isMinLength(1)),
  deliveries: Schema.Array(Schema.Struct({ recipientAgentId: Schema.String })),
});
const decodeAck = Schema.decodeUnknownEffect(Ack);
const decodeTaskSnapshot = Schema.decodeUnknownEffect(
  Schema.Struct({
    agentId: Schema.String,
    messages: Schema.Array(
      Schema.Struct({ id: Schema.String, author: Schema.String, text: Schema.String }),
    ),
  }),
);
const decodeTaskList = Schema.decodeUnknownEffect(
  Schema.Struct({
    agentId: Schema.String,
    tasks: Schema.Array(
      Schema.Struct({
        id: Schema.String,
        queuedMessages: Schema.Array(Schema.Struct({ deliveryId: Schema.String })),
      }),
    ),
  }),
);
const decodeQueue = Schema.decodeUnknownEffect(
  Schema.Struct({
    agentId: Schema.String,
    deliveries: Schema.Array(
      Schema.Struct({
        id: Schema.String,
        recipientAgentId: Schema.String,
        text: Schema.String,
        sender: Schema.Struct({ kind: Schema.String }),
      }),
    ),
  }),
);
// Openbot v0.60 retains user-send receipts for 24 hours; leave a margin for a request in flight.
const RETRY_WINDOW_MS = 23 * 60 * 60 * 1000;
const isIntegrationError = Schema.is(Integration.IntegrationError);
const isTeamClientError = Schema.is(TeamClient.TeamClientError);
const retryable = (error: CodingDeliveryError) => {
  if (error.stage === "storage" || error.stage === "read") return true;
  const cause = isIntegrationError(error.cause) ? error.cause.cause : error.cause;
  return (
    isTeamClientError(cause) &&
    (cause.reason === "transport" ||
      (cause.reason === "http" && (cause.status === 429 || (cause.status ?? 0) >= 500)))
  );
};
const terminal = new Set(["completed", "failed", "cancelled", "interrupted", "rolled_back"]);

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const bridge = yield* CodingBridge.CodingBridge;
  const integration = yield* Integration.Integration;
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const events = yield* OrchestrationEvents.OrchestrationEventStore;
  const gate = yield* Semaphore.make(1);
  const changes = yield* PubSub.sliding<OpenbotChange>(1);
  let started = false;

  const recover = Effect.fn("CodingDelivery.recover")(
    function* (row: TaskRow, text: string) {
      const snapshot = yield* integration
        .apiReadToHost(row.host_id, {
          operation: "task.read",
          agentId: row.agent_id,
          taskId: row.task_id,
        })
        .pipe(Effect.flatMap(decodeTaskSnapshot));
      if (snapshot.agentId !== row.agent_id) return false;
      if (snapshot.messages.some((message) => message.author === "user" && message.text === text))
        return true;
      const tasks = yield* integration
        .apiReadToHost(row.host_id, { operation: "task.list", agentId: row.agent_id })
        .pipe(Effect.flatMap(decodeTaskList));
      if (tasks.agentId !== row.agent_id) return false;
      const queuedIds = new Set(
        tasks.tasks
          .find((task) => task.id === row.task_id)
          ?.queuedMessages.map((message) => message.deliveryId),
      );
      if (queuedIds.size === 0) return false;
      const queue = yield* integration
        .apiReadToHost(row.host_id, { operation: "queue.read", agentId: row.agent_id })
        .pipe(Effect.flatMap(decodeQueue));
      return (
        queue.agentId === row.agent_id &&
        queue.deliveries.some(
          (delivery) =>
            queuedIds.has(delivery.id) &&
            delivery.recipientAgentId === row.agent_id &&
            delivery.sender.kind === "user" &&
            delivery.text === text,
        )
      );
    },
    Effect.mapError((cause) => new CodingDeliveryError({ stage: "recovery", cause })),
  );

  const deliver = Effect.fn("CodingDelivery.deliver")(function* (row: TaskRow) {
    if ((yield* integration.readyHostId) !== row.host_id) return;
    const origin: OpenbotCodingOrigin = {
      hostId: row.host_id,
      agentId: row.agent_id,
      taskId: row.task_id,
    };
    const task = yield* bridge
      .get({ origin, operationId: row.operation_id })
      .pipe(Effect.mapError((cause) => new CodingDeliveryError({ stage: "read", cause })));
    if (!terminal.has(task.state)) return;
    // A result belongs to the final settled work, not merely the first provider turn to end.
    if (task.runId !== null) {
      const projection = yield* projections
        .getThreadProjection(task.threadId)
        .pipe(Effect.mapError((cause) => new CodingDeliveryError({ stage: "read", cause })));
      if (delegatedTaskProgress(projection).state !== "result_available") return;
    }
    const runId = task.runId ?? "cancelled-before-launch";
    const clientMessageId = `sled-coding:${task.threadId}:${runId}`;
    const result =
      task.result ??
      (task.cancelRequested
        ? "The coding assignment was cancelled before execution."
        : "The coding assignment ended without an assistant result.");
    const text = `Sled coding result\nThread: ${task.threadId}\nRun: ${runId}\nStatus: ${task.state}\n\n${result}`;
    const now = yield* DateTime.now;
    const inserted = yield* sql`INSERT INTO openbot_coding_deliveries
      (thread_id, run_id, client_message_id, first_attempt_at, payload_text)
      VALUES (${task.threadId}, ${runId}, ${clientMessageId}, ${DateTime.formatIso(now)}, ${text})
      ON CONFLICT (thread_id, run_id) DO NOTHING RETURNING thread_id`.pipe(
      Effect.mapError((cause) => new CodingDeliveryError({ stage: "storage", cause })),
    );
    const rows = yield* sql<{
      readonly accepted_at: string | null;
      readonly first_attempt_at: string | null;
      readonly payload_text: string | null;
    }>`SELECT accepted_at, first_attempt_at, payload_text FROM openbot_coding_deliveries
      WHERE thread_id = ${task.threadId} AND run_id = ${runId}`.pipe(
      Effect.mapError((cause) => new CodingDeliveryError({ stage: "storage", cause })),
    );
    const receipt = rows[0];
    if (!receipt || receipt.accepted_at != null) return;
    const payload = receipt.payload_text ?? text;
    let recovered = false;
    if (inserted.length === 0) {
      const firstAttempt = Date.parse(receipt.first_attempt_at ?? "");
      const elapsed = now.epochMilliseconds - firstAttempt;
      const mayRetry =
        receipt.payload_text !== null &&
        Number.isFinite(elapsed) &&
        elapsed >= 0 &&
        elapsed < RETRY_WINDOW_MS;
      if (!mayRetry) {
        const updated = yield* sql`UPDATE openbot_coding_deliveries SET reconciliation_required = 1
          WHERE thread_id = ${task.threadId} AND run_id = ${runId} AND reconciliation_required = 0
          RETURNING thread_id`.pipe(
          Effect.mapError((cause) => new CodingDeliveryError({ stage: "storage", cause })),
        );
        if (updated.length > 0)
          yield* PubSub.publish(changes, { hostId: row.host_id, resource: "all" });
      }
      recovered = yield* recover(row, payload);
      // Upstream snapshots retain recent messages, so absence cannot establish that the send was rejected.
      if (!recovered && !mayRetry)
        return yield* new CodingDeliveryError({
          stage: "reconciliation",
          cause: new Error(
            "The upstream receipt horizon expired without positive delivery evidence",
          ),
        });
    }
    if (!recovered) {
      const response = yield* integration
        .apiWriteToHost(row.host_id, {
          operation: "task.send",
          agentId: row.agent_id,
          taskId: row.task_id,
          text: payload,
          clientMessageId,
        })
        .pipe(Effect.mapError((cause) => new CodingDeliveryError({ stage: "send", cause })));
      const acknowledgement = yield* decodeAck(response).pipe(
        Effect.mapError((cause) => new CodingDeliveryError({ stage: "acknowledgement", cause })),
      );
      if (
        !acknowledgement.deliveries.some((delivery) => delivery.recipientAgentId === row.agent_id)
      ) {
        return yield* new CodingDeliveryError({
          stage: "acknowledgement",
          cause: new Error("The receipt did not name the originating agent"),
        });
      }
    }
    const acceptedAt = yield* DateTime.now;
    yield* sql`UPDATE openbot_coding_deliveries SET accepted_at = ${DateTime.formatIso(acceptedAt)}, reconciliation_required = 0
      WHERE thread_id = ${task.threadId} AND run_id = ${runId}`.pipe(
      Effect.mapError((cause) => new CodingDeliveryError({ stage: "storage", cause })),
    );
    yield* PubSub.publish(changes, { hostId: row.host_id, resource: "all" });
  });

  const reconcile = Effect.fn("CodingDelivery.reconcile")(
    function* (threadId?: ThreadId) {
      const hostId = yield* integration.readyHostId;
      if (hostId === null) return;
      const rows = yield* (
        threadId === undefined
          ? sql<TaskRow>`SELECT host_id, agent_id, task_id, operation_id, thread_id FROM openbot_coding_tasks WHERE host_id = ${hostId}`
          : sql<TaskRow>`SELECT host_id, agent_id, task_id, operation_id, thread_id FROM openbot_coding_tasks WHERE host_id = ${hostId} AND thread_id = ${threadId}`
      ).pipe(Effect.mapError((cause) => new CodingDeliveryError({ stage: "storage", cause })));
      let failure: CodingDeliveryError | undefined;
      for (const row of rows) {
        const outcome = yield* deliver(row).pipe(Effect.result);
        if (Result.isFailure(outcome)) failure ??= outcome.failure;
      }
      if (failure) return yield* failure;
    },
    (effect: Effect.Effect<void, CodingDeliveryError>, _threadId?: ThreadId) =>
      gate.withPermit(effect),
  );

  const pending = new Set<string>();
  const dirty = new Set<string>();
  const enqueue = Effect.fn("CodingDelivery.enqueue")(function* (threadId?: ThreadId) {
    const key = threadId ?? "all";
    dirty.add(key);
    if (pending.has(key)) return;
    pending.add(key);
    const drain = Effect.gen(function* () {
      do {
        dirty.delete(key);
        yield* reconcile(threadId).pipe(
          Effect.tapError((error) =>
            Effect.logWarning("openbot.coding-delivery-pending", { stage: error.stage }),
          ),
          Effect.retry({ schedule: Schedule.spaced("10 seconds"), while: retryable }),
          Effect.ignore,
        );
      } while (dirty.has(key));
    });
    yield* drain.pipe(
      Effect.onExit(() =>
        Effect.sync(() => {
          pending.delete(key);
          dirty.delete(key);
        }),
      ),
      Effect.forkScoped,
    );
  });
  const start = Effect.gen(function* () {
    if (started) return;
    started = true;
    const sequence = yield* events.latestApplicationSequence.pipe(Effect.orElseSucceed(() => 0));
    yield* Stream.runForEach(integration.readyChanges, (hostId) =>
      hostId === null ? Effect.void : enqueue(),
    ).pipe(Effect.forkScoped);
    yield* Stream.runForEach(bridge.changes, (threadId) => enqueue(threadId)).pipe(
      Effect.forkScoped,
    );
    yield* events.streamApplicationEvents({ afterSequence: sequence }).pipe(
      Stream.runForEach((stored) => {
        if (!("event" in stored)) return Effect.void;
        const event = stored.event;
        if (
          event.type === "run.updated" ||
          event.type === "subagent.updated" ||
          event.type === "provider-thread.updated" ||
          (event.type === "message.updated" && !event.payload.streaming)
        ) {
          return enqueue(event.threadId);
        }
        return Effect.void;
      }),
      Effect.tapError(() => Effect.logWarning("openbot.coding-delivery-stream-reconnecting")),
      Effect.retry({ schedule: Schedule.spaced("10 seconds") }),
      Effect.forkScoped,
    );
  });
  return CodingDelivery.of({ changes: Stream.fromPubSub(changes), reconcile, start });
});

export const layer = Layer.effect(CodingDelivery, make);
