import { CommandId, MessageId, ProjectId, ThreadId } from "@t3tools/contracts";
import {
  type OpenbotCodingLaunchInput,
  type OpenbotCodingReference,
  type OpenbotCodingListInput,
  type OpenbotCodingSendInput,
  type OpenbotCodingCancelInput,
  type OpenbotCodingTask,
  OpenbotCodingLaunchInput as LaunchSchema,
  OpenbotCodingDeliveryStatus,
} from "@t3tools/contracts";
import {
  delegatedTaskProgress,
  subagentResultForRun,
} from "@t3tools/provider-core/server/subagentProjection";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as PubSub from "effect/PubSub";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/sql/SqlClient";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as ThreadLaunch from "../orchestration-v2/ThreadLaunchService.ts";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";

export class CodingBridgeError extends Schema.TaggedError<CodingBridgeError>()(
  "OpenbotCodingBridgeError",
  {
    operation: Schema.Literals(["launch", "read", "list", "send", "cancel"]),
    reason: Schema.Literals(["storage", "not-found", "conflict", "cancelled", "execution"]),
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return `Openbot coding ${this.operation} failed (${this.reason}).`;
  }
}

export class CodingBridge extends Context.Service<
  CodingBridge,
  {
    readonly changes: Stream.Stream<ThreadId>;
    readonly launch: (
      input: OpenbotCodingLaunchInput,
    ) => Effect.Effect<OpenbotCodingTask, CodingBridgeError>;
    readonly get: (
      input: OpenbotCodingReference,
    ) => Effect.Effect<OpenbotCodingTask, CodingBridgeError>;
    readonly list: (
      input: OpenbotCodingListInput,
    ) => Effect.Effect<ReadonlyArray<OpenbotCodingTask>, CodingBridgeError>;
    readonly send: (
      input: OpenbotCodingSendInput,
    ) => Effect.Effect<OpenbotCodingTask, CodingBridgeError>;
    readonly cancel: (
      input: OpenbotCodingCancelInput,
    ) => Effect.Effect<OpenbotCodingTask, CodingBridgeError>;
  }
>()("t3/openbot/CodingBridge") {}

interface Row {
  readonly host_id: string;
  readonly agent_id: string;
  readonly task_id: string;
  readonly operation_id: string;
  readonly project_id: string;
  readonly thread_id: string;
  readonly command_id: string;
  readonly input_json: string;
  readonly cancel_requested: number;
}
const encodeLaunch = Schema.encodeEffect(Schema.fromJsonString(LaunchSchema));
const decodeDeliveryStatus = Schema.decodeUnknownEffect(OpenbotCodingDeliveryStatus);

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const launchService = yield* ThreadLaunch.ThreadLaunchService;
  const threads = yield* ThreadManagement.ThreadManagementService;
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const random = yield* SecureRandom.SecureRandom;
  const gate = yield* Semaphore.make(1);
  const changes = yield* PubSub.unbounded<ThreadId>();

  const deliveryStatus = Effect.fn("CodingBridge.deliveryStatus")(
    function* (threadId: ThreadId, runId: string | null) {
      const rows = yield* sql<{
        readonly first_attempt_at: string | null;
        readonly accepted_at: string | null;
        readonly reconciliation_required: number;
      }>`SELECT first_attempt_at, accepted_at, reconciliation_required FROM openbot_coding_deliveries
        WHERE thread_id = ${threadId} AND run_id = ${runId ?? "cancelled-before-launch"}`;
      const receipt = rows[0];
      if (!receipt) return undefined;
      return yield* decodeDeliveryStatus({
        state:
          receipt.accepted_at !== null
            ? "accepted"
            : receipt.reconciliation_required
              ? "reconciliation-required"
              : "pending",
        firstAttemptAt: receipt.first_attempt_at,
        acceptedAt: receipt.accepted_at,
      });
    },
    Effect.mapError(
      (cause) => new CodingBridgeError({ operation: "read", reason: "storage", cause }),
    ),
  );

  const find = Effect.fn("CodingBridge.find")(function* (input: OpenbotCodingReference) {
    const rows = yield* sql<Row>`SELECT * FROM openbot_coding_tasks
      WHERE host_id = ${input.origin.hostId} AND agent_id = ${input.origin.agentId}
      AND task_id = ${input.origin.taskId} AND operation_id = ${input.operationId}`.pipe(
      Effect.mapError(
        (cause) => new CodingBridgeError({ operation: "read", reason: "storage", cause }),
      ),
    );
    const row = rows[0];
    if (!row) return yield* new CodingBridgeError({ operation: "read", reason: "not-found" });
    return row;
  });

  const snapshot = Effect.fn("CodingBridge.snapshot")(function* (row: Row) {
    const threadId = ThreadId.make(row.thread_id);
    const base = {
      origin: { hostId: row.host_id, agentId: row.agent_id, taskId: row.task_id },
      operationId: row.operation_id,
      projectId: ProjectId.make(row.project_id),
      threadId,
      cancelRequested: row.cancel_requested === 1,
    };
    const projection = yield* projections.getThreadProjection(threadId).pipe(
      Effect.map((value) => value as typeof value | null),
      Effect.catchTags({ ProjectionStoreThreadNotFoundError: () => Effect.succeed(null) }),
      Effect.mapError(
        (cause) => new CodingBridgeError({ operation: "read", reason: "storage", cause }),
      ),
    );
    if (!projection) {
      const delivery = yield* deliveryStatus(base.threadId, null);
      return {
        ...base,
        state: row.cancel_requested ? ("cancelled" as const) : ("launch_pending" as const),
        runId: null,
        pendingRequestIds: [],
        result: null,
        ...(delivery === undefined ? {} : { delivery }),
      } satisfies OpenbotCodingTask;
    }
    const progress = delegatedTaskProgress(projection);
    const latest = projection.runs.toSorted((left, right) => right.ordinal - left.ordinal)[0];
    const run = progress.state === "result_available" ? progress.resultRun : latest;
    const state =
      progress.state === "waiting_for_children"
        ? ("waiting" as const)
        : (run?.status ?? ("idle" as const));
    const delivery = yield* deliveryStatus(base.threadId, run?.id ?? null);
    return {
      ...base,
      state,
      runId: run?.id ?? null,
      pendingRequestIds: projection.runtimeRequests
        .filter((request) => request.status === "pending")
        .map((request) => request.id),
      result:
        progress.state === "result_available" && run
          ? subagentResultForRun(projection, run).text.slice(0, 32_768)
          : null,
      ...(delivery === undefined ? {} : { delivery }),
    } satisfies OpenbotCodingTask;
  });

  const get = Effect.fn("CodingBridge.get")(function* (input: OpenbotCodingReference) {
    return yield* snapshot(yield* find(input));
  });

  const launch = Effect.fn("CodingBridge.launch")(function* (input: OpenbotCodingLaunchInput) {
    const inputJson = yield* encodeLaunch(input).pipe(
      Effect.mapError(
        (cause) => new CodingBridgeError({ operation: "launch", reason: "conflict", cause }),
      ),
    );
    const now = yield* DateTime.now;
    const [threadId, commandId] = yield* Effect.all([random.uuidV4(), random.uuidV4()]).pipe(
      Effect.mapError(
        (cause) => new CodingBridgeError({ operation: "launch", reason: "storage", cause }),
      ),
    );
    // Persist identity before calling execution: an uncertain launch response must retry the same receipt and thread.
    yield* sql`INSERT INTO openbot_coding_tasks
      (host_id, agent_id, task_id, operation_id, project_id, thread_id, command_id, input_json, created_at)
      VALUES (${input.origin.hostId}, ${input.origin.agentId}, ${input.origin.taskId}, ${input.operationId}, ${input.projectId},
      ${threadId}, ${commandId}, ${inputJson}, ${DateTime.formatIso(now)})
      ON CONFLICT (host_id, agent_id, task_id, operation_id) DO NOTHING`.pipe(
      Effect.mapError(
        (cause) => new CodingBridgeError({ operation: "launch", reason: "storage", cause }),
      ),
    );
    const row = yield* find(input);
    if (row.input_json !== inputJson)
      return yield* new CodingBridgeError({ operation: "launch", reason: "conflict" });
    if (row.cancel_requested) return yield* snapshot(row);
    yield* launchService
      .launch({
        commandId: CommandId.make(row.command_id),
        threadId: ThreadId.make(row.thread_id),
        projectId: input.projectId,
        title: input.title,
        modelSelection: input.modelSelection,
        runtimeMode: input.runtimeMode,
        interactionMode: input.interactionMode,
        workspaceStrategy: input.workspaceStrategy,
        initialMessage: {
          messageId: MessageId.make(row.command_id),
          text: input.prompt,
          attachments: [],
        },
        createdBy: "agent",
        creationSource: "server",
      })
      .pipe(
        Effect.mapError(
          (cause) => new CodingBridgeError({ operation: "launch", reason: "execution", cause }),
        ),
      );
    return yield* snapshot(row);
  }, gate.withPermit);

  const list = Effect.fn("CodingBridge.list")(function* (input: OpenbotCodingListInput) {
    const rows = yield* (
      input.taskId === undefined
        ? sql<Row>`SELECT * FROM openbot_coding_tasks WHERE host_id = ${input.hostId} AND agent_id = ${input.agentId} ORDER BY created_at DESC LIMIT 100`
        : sql<Row>`SELECT * FROM openbot_coding_tasks WHERE host_id = ${input.hostId} AND agent_id = ${input.agentId} AND task_id = ${input.taskId} ORDER BY created_at DESC LIMIT 100`
    ).pipe(
      Effect.mapError(
        (cause) => new CodingBridgeError({ operation: "list", reason: "storage", cause }),
      ),
    );
    return yield* Effect.forEach(rows, snapshot);
  });

  const send = Effect.fn("CodingBridge.send")(function* (input: OpenbotCodingSendInput) {
    const row = yield* find(input);
    if (row.cancel_requested)
      return yield* new CodingBridgeError({ operation: "send", reason: "cancelled" });
    yield* threads
      .sendToThread({
        projectId: ProjectId.make(row.project_id),
        threadId: ThreadId.make(row.thread_id),
        commandId: CommandId.make(`openbot:${row.thread_id}:send:${input.commandId}`),
        messageId: MessageId.make(`openbot:${row.thread_id}:send:${input.commandId}`),
        text: input.text,
        attachments: [],
        mode: "auto",
        createdBy: "agent",
        creationSource: "server",
      })
      .pipe(
        Effect.mapError(
          (cause) => new CodingBridgeError({ operation: "send", reason: "execution", cause }),
        ),
      );
    return yield* snapshot(row);
  }, gate.withPermit);

  const cancel = Effect.fn("CodingBridge.cancel")(function* (input: OpenbotCodingCancelInput) {
    const row = yield* find(input);
    yield* sql`UPDATE openbot_coding_tasks SET cancel_requested = 1 WHERE thread_id = ${row.thread_id}`.pipe(
      Effect.mapError(
        (cause) => new CodingBridgeError({ operation: "cancel", reason: "storage", cause }),
      ),
    );
    const current = yield* snapshot({ ...row, cancel_requested: 1 });
    if (current.state !== "launch_pending" && current.runId !== null) {
      const commandId = CommandId.make(`openbot:${row.thread_id}:cancel:${input.commandId}`);
      yield* threads
        .dispatch({ type: "thread.stop", threadId: current.threadId, commandId })
        .pipe(
          Effect.mapError(
            (cause) => new CodingBridgeError({ operation: "cancel", reason: "execution", cause }),
          ),
        );
      yield* threads
        .stopDelegatedTasks({ threadId: current.threadId, commandId })
        .pipe(
          Effect.mapError(
            (cause) => new CodingBridgeError({ operation: "cancel", reason: "execution", cause }),
          ),
        );
      const stopped = yield* projections
        .getThreadProjection(current.threadId)
        .pipe(
          Effect.mapError(
            (cause) => new CodingBridgeError({ operation: "cancel", reason: "storage", cause }),
          ),
        );
      for (const run of stopped.runs) {
        if (run.status !== "queued") continue;
        yield* threads
          .dispatch({
            type: "queued-run.cancel",
            threadId: current.threadId,
            runId: run.id,
            commandId: CommandId.make(`${commandId}:queued:${run.id}`),
          })
          .pipe(
            Effect.mapError(
              (cause) => new CodingBridgeError({ operation: "cancel", reason: "execution", cause }),
            ),
          );
      }
    }
    return yield* snapshot({ ...row, cancel_requested: 1 });
  }, gate.withPermit);

  return CodingBridge.of({
    changes: Stream.fromPubSub(changes),
    launch: Effect.fn("CodingBridge.launchAndPublish")(
      launch,
      Effect.tap((task) => PubSub.publish(changes, task.threadId)),
    ),
    get,
    list,
    send: Effect.fn("CodingBridge.sendAndPublish")(
      send,
      Effect.tap((task) => PubSub.publish(changes, task.threadId)),
    ),
    cancel: Effect.fn("CodingBridge.cancelAndPublish")(
      cancel,
      Effect.tap((task) => PubSub.publish(changes, task.threadId)),
    ),
  });
});

export const layer = Layer.effect(CodingBridge, make);
