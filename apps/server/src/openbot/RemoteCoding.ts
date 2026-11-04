import {
  AuthSessionId,
  AuthOrchestrationOperateScope,
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  ProviderInteractionMode,
  RuntimeMode,
  IsoDateTime,
  ThreadId,
  RunId,
  OpenbotCodingTask,
  OpenbotCodingLaunchInput,
  OrchestratorMcpThreadReadResult,
  OrchestratorMcpThreadWaitResult,
  OrchestratorMcpThreadSendResult,
  OrchestratorMcpThreadInterruptResult,
  sessionGrantsScope,
  type OpenbotCodingSendInput,
  type OpenbotCodingCancelInput,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Digest from "effect/crypto/Digest";
import * as Hex from "effect/encoding/Hex";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import * as SqlClient from "effect/sql/SqlClient";
import * as Stream from "effect/Stream";
import * as EnvironmentAuth from "../auth/EnvironmentAuth.ts";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import * as ManagedPolicy from "../policy/ManagedPolicy.ts";
import * as PeerLinks from "../peer/PeerLinks.ts";
import * as PeerMcpClient from "../peer/PeerMcpClient.ts";
import { isLiveCallerShell } from "../mcp/threadAccess.ts";
import { runtimeModeRank, interactionModeRank } from "../mcp/delegatedTaskModes.ts";
import type { CodingRow } from "./RemoteCodingLedger.ts";

const Limits = Schema.Struct({
  runtimeMode: RuntimeMode,
  interactionMode: ProviderInteractionMode,
});
export const Authority = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("session"),
    sessionId: AuthSessionId,
    limits: Limits,
    linked: Schema.optional(Schema.Boolean),
  }),
  Schema.Struct({
    kind: Schema.Literal("thread"),
    threadId: ThreadId,
    providerInstanceId: ProviderInstanceId,
    limits: Limits,
  }),
]);
export type Authority = typeof Authority.Type;
/** Only authenticated transports supply this. Openbot attribution IDs never confer authority. */
export const Caller = Context.Reference<Authority | undefined>("t3/openbot/RemoteCoding/Caller", {
  defaultValue: () => undefined,
});

export class RemoteCodingError extends Schema.TaggedError<RemoteCodingError>()(
  "OpenbotRemoteCodingError",
  {
    reason: Schema.Literals(["storage", "authorization", "destination", "execution", "conflict"]),
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message() {
    return `Remote coding failed (${this.reason}).`;
  }
}

export class RemoteCoding extends Context.Service<
  RemoteCoding,
  {
    readonly changes: Stream.Stream<ThreadId>;
    readonly authorize: (
      input: OpenbotCodingLaunchInput,
    ) => Effect.Effect<string, RemoteCodingError>;
    readonly launch: (
      row: CodingRow,
      input: OpenbotCodingLaunchInput,
    ) => Effect.Effect<OpenbotCodingTask, RemoteCodingError>;
    readonly snapshot: (row: CodingRow) => Effect.Effect<OpenbotCodingTask, RemoteCodingError>;
    readonly send: (
      row: CodingRow,
      input: OpenbotCodingSendInput,
    ) => Effect.Effect<OpenbotCodingTask, RemoteCodingError>;
    readonly cancel: (
      row: CodingRow,
      input: OpenbotCodingCancelInput,
    ) => Effect.Effect<OpenbotCodingTask, RemoteCodingError>;
    readonly reconcile: (receiptId?: ThreadId) => Effect.Effect<void, RemoteCodingError>;
    readonly start: Effect.Effect<void, never, Scope.Scope>;
  }
>()("t3/openbot/RemoteCoding") {}

const terminal = new Set(["completed", "failed", "cancelled", "interrupted", "rolled_back"]);
const StoredAuthority = Schema.Struct({ caller: Authority, linkedAt: IsoDateTime });
const decodeCaller = Schema.decodeUnknownEffect(Schema.fromJsonString(Authority));
const encodeCaller = Schema.encodeEffect(Schema.fromJsonString(Authority));
const decodeAuthority = Schema.decodeUnknownEffect(Schema.fromJsonString(StoredAuthority));
const encodeAuthority = Schema.encodeEffect(Schema.fromJsonString(StoredAuthority));
const decodeTask = Schema.decodeUnknownEffect(Schema.fromJsonString(OpenbotCodingTask));
const encodeTask = Schema.encodeEffect(Schema.fromJsonString(OpenbotCodingTask));
const encodeCommandKey = Schema.encodeEffect(
  Schema.fromJsonString(Schema.Tuple([Schema.String, Schema.String])),
);
const decodeLaunch = Schema.decodeUnknownEffect(Schema.fromJsonString(OpenbotCodingLaunchInput));
const LaunchResult = Schema.Struct({
  threadId: ThreadId,
  runId: Schema.NullOr(RunId),
  link: Schema.optional(Schema.String),
});
const storageError = (cause: unknown) => new RemoteCodingError({ reason: "storage", cause });
const authorityError = () => new RemoteCodingError({ reason: "authorization" });

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const peers = yield* PeerMcpClient.PeerMcpClient;
  const links = yield* PeerLinks.PeerLinks;
  const auth = yield* EnvironmentAuth.EnvironmentAuth;
  const threads = yield* ThreadManagement.ThreadManagementService;
  const policy = yield* ManagedPolicy.ManagedPolicy;
  const digest = yield* Digest.Digest;
  const changes = yield* PubSub.unbounded<ThreadId>();
  const gate = yield* Semaphore.make(1);
  let started = false;

  const load = Effect.fn("RemoteCoding.load")(function* (receiptId: string) {
    const rows =
      yield* sql<CodingRow>`SELECT * FROM openbot_coding_tasks WHERE thread_id = ${receiptId}`.pipe(
        Effect.mapError(storageError),
      );
    if (!rows[0]) return yield* new RemoteCodingError({ reason: "storage" });
    return rows[0];
  });
  const limits = Effect.fn("RemoteCoding.limits")(function* (authority: Authority) {
    let current = authority.limits;
    if (authority.kind === "session") {
      if (authority.linked) return yield* authorityError();
      const sessions = yield* auth.listSessions().pipe(Effect.mapError(() => authorityError()));
      const session = sessions.find((item) => item.sessionId === authority.sessionId);
      const now = yield* DateTime.now;
      if (
        !session ||
        session.expiresAt.epochMilliseconds <= now.epochMilliseconds ||
        !sessionGrantsScope({ authenticated: true, ...session }, AuthOrchestrationOperateScope)
      )
        return yield* authorityError();
    } else {
      const shell = yield* threads
        .getThreadShell(authority.threadId)
        .pipe(Effect.mapError(() => authorityError()));
      if (
        !shell ||
        shell.deletedAt !== null ||
        !isLiveCallerShell(shell, authority.providerInstanceId)
      )
        return yield* authorityError();
      current = { runtimeMode: shell.runtimeMode, interactionMode: shell.interactionMode };
    }
    const ceiling = policy.document?.limits?.maxRuntimeMode;
    return {
      runtimeMode: [
        authority.limits.runtimeMode,
        current.runtimeMode,
        ...(ceiling === undefined ? [] : [ceiling]),
      ].toSorted((a, b) => runtimeModeRank(a) - runtimeModeRank(b))[0]!,
      interactionMode:
        interactionModeRank(current.interactionMode) <
        interactionModeRank(authority.limits.interactionMode)
          ? current.interactionMode
          : authority.limits.interactionMode,
    };
  });
  const authorityFor = Effect.fn("RemoteCoding.authorityFor")(function* (row: CodingRow) {
    if (!row.remote_authority_json) return yield* authorityError();
    return yield* decodeAuthority(row.remote_authority_json).pipe(
      Effect.mapError(() => authorityError()),
    );
  });
  const assertCaller = Effect.fn("RemoteCoding.assertCaller")(function* (
    row: CodingRow,
    action: "launch" | "send" | "cancel",
  ) {
    const caller = yield* Caller;
    const original = (yield* authorityFor(row)).caller;
    if (!caller) return yield* authorityError();
    yield* limits(caller);
    if (action !== "launch" && caller.kind === "session" && !caller.linked) return caller;
    if (
      caller.kind !== original.kind ||
      (caller.kind === "session" && original.kind === "session"
        ? caller.sessionId !== original.sessionId
        : caller.kind === "thread" && original.kind === "thread"
          ? caller.threadId !== original.threadId ||
            caller.providerInstanceId !== original.providerInstanceId
          : true)
    )
      return yield* authorityError();
    return caller;
  });
  const call = Effect.fn("RemoteCoding.call")(function* <S extends Schema.Decoder<unknown>>(
    row: CodingRow,
    tool: string,
    args: Record<string, unknown>,
    success: S,
    actor?: Authority,
  ) {
    const authority = yield* authorityFor(row);
    const stopCaller =
      row.cancel_requested &&
      row.remote_stop_authority_json !== null &&
      ["t3_thread_interrupt", "t3_thread_read", "t3_thread_wait"].includes(tool)
        ? yield* decodeCaller(row.remote_stop_authority_json).pipe(
            Effect.mapError(() => authorityError()),
          )
        : undefined;
    let cap = yield* limits(stopCaller ?? authority.caller);
    if (actor !== undefined) {
      const current = yield* limits(actor);
      cap = {
        runtimeMode:
          runtimeModeRank(current.runtimeMode) < runtimeModeRank(cap.runtimeMode)
            ? current.runtimeMode
            : cap.runtimeMode,
        interactionMode:
          interactionModeRank(current.interactionMode) < interactionModeRank(cap.interactionMode)
            ? current.interactionMode
            : cap.interactionMode,
      };
    }
    if (!row.destination_environment_id || !(yield* links.enabled))
      return yield* new RemoteCodingError({ reason: "destination" });
    const environmentId = EnvironmentId.make(row.destination_environment_id);
    const link = yield* links
      .get(environmentId)
      .pipe(Effect.mapError(() => new RemoteCodingError({ reason: "destination" })));
    if (Option.isNone(link) || DateTime.formatIso(link.value.linkedAt) !== authority.linkedAt)
      return yield* new RemoteCodingError({ reason: "destination" });
    return yield* peers
      .call({
        environmentId,
        expectedLinkedAt: authority.linkedAt,
        tool,
        arguments: args,
        limits: cap,
        success,
      })
      .pipe(Effect.mapError((cause) => new RemoteCodingError({ reason: "execution", cause })));
  });
  const snapshot = Effect.fn("RemoteCoding.snapshot")(function* (row: CodingRow) {
    const cached =
      row.remote_snapshot_json === null
        ? undefined
        : yield* decodeTask(row.remote_snapshot_json).pipe(Effect.mapError(storageError));
    return {
      origin: { hostId: row.host_id, agentId: row.agent_id, taskId: row.task_id },
      operationId: row.operation_id,
      projectId: ProjectId.make(row.project_id),
      threadId: ThreadId.make(row.remote_thread_id ?? row.thread_id),
      state:
        row.cancel_requested && !row.remote_launch_attempted
          ? ("cancelled" as const)
          : ("launch_pending" as const),
      runId: null,
      pendingRequestIds: [],
      result: null,
      environmentId: EnvironmentId.make(row.destination_environment_id!),
      remoteState: "following" as const,
      ...cached,
      cancelRequested: row.cancel_requested === 1,
    } satisfies OpenbotCodingTask;
  });
  const save = Effect.fn("RemoteCoding.save")(function* (
    row: CodingRow,
    task: OpenbotCodingTask,
    settled = row.remote_settled === 1,
  ) {
    const json = yield* encodeTask(task).pipe(Effect.mapError(storageError));
    yield* sql`UPDATE openbot_coding_tasks SET remote_snapshot_json = ${json}, remote_settled = ${settled ? 1 : 0} WHERE thread_id = ${row.thread_id}`.pipe(
      Effect.mapError(storageError),
    );
    yield* PubSub.publish(changes, ThreadId.make(row.thread_id));
    return task;
  });
  const authorize = Effect.fn("RemoteCoding.authorize")(function* (
    input: OpenbotCodingLaunchInput,
  ) {
    const caller = yield* Caller;
    if (!caller) return yield* authorityError();
    const cap = yield* limits(caller);
    if (
      runtimeModeRank(input.runtimeMode) > runtimeModeRank(cap.runtimeMode) ||
      interactionModeRank(input.interactionMode) > interactionModeRank(cap.interactionMode)
    )
      return yield* authorityError();
    if (!input.environmentId || input.prompt.length > 120_000)
      return yield* new RemoteCodingError({ reason: "conflict" });
    const link = yield* links
      .get(input.environmentId)
      .pipe(Effect.mapError(() => new RemoteCodingError({ reason: "destination" })));
    if (!(yield* links.enabled) || Option.isNone(link))
      return yield* new RemoteCodingError({ reason: "destination" });
    return yield* encodeAuthority({
      caller,
      linkedAt: DateTime.formatIso(link.value.linkedAt),
    }).pipe(Effect.mapError(storageError));
  });
  const launchRemote = Effect.fn("RemoteCoding.launchRemote")(function* (
    row: CodingRow,
    input: OpenbotCodingLaunchInput,
  ) {
    if (row.remote_thread_id !== null || row.cancel_requested) return;
    yield* sql`UPDATE openbot_coding_tasks SET remote_launch_attempted = 1 WHERE thread_id = ${row.thread_id}`.pipe(
      Effect.mapError(storageError),
    );
    const launched = yield* call(
      row,
      "t3_thread_launch",
      {
        projectId: input.projectId,
        title: input.title,
        modelSelection: input.modelSelection,
        runtimeMode: input.runtimeMode,
        interactionMode: input.interactionMode,
        workspaceStrategy: input.workspaceStrategy,
        message: input.prompt,
        clientRequestId: `openbot:${row.command_id}`,
      },
      LaunchResult,
    );
    yield* sql`UPDATE openbot_coding_tasks SET remote_thread_id = ${launched.threadId} WHERE thread_id = ${row.thread_id}`.pipe(
      Effect.mapError(storageError),
    );
    yield* save(
      { ...row, remote_thread_id: launched.threadId },
      {
        ...(yield* snapshot(row)),
        threadId: launched.threadId,
        runId: launched.runId,
        ...(launched.link === undefined ? {} : { link: launched.link }),
      },
    );
  });
  const resultText = Effect.fn("RemoteCoding.resultText")(function* (
    row: CodingRow,
    runId: RunId,
    failed: boolean,
  ) {
    let afterPosition: number | undefined;
    let reply: OrchestratorMcpThreadReadResult["items"][number] | undefined;
    for (let page = 0; page < 1000; page++) {
      const read = yield* call(
        row,
        "t3_thread_read",
        {
          threadId: row.remote_thread_id,
          view: failed ? "activity" : "messages",
          limit: 100,
          ...(afterPosition === undefined ? {} : { afterPosition }),
        },
        OrchestratorMcpThreadReadResult,
      );
      reply =
        read.items.findLast(
          (item) =>
            item.runId === runId &&
            (item.type === "assistant_message" || (failed && item.type === "error")),
        ) ?? reply;
      if (!read.hasMore || read.nextPosition === null) {
        if (!reply) return null;
        let text = reply.text ?? "";
        let offset = reply.textTruncated ? reply.nextTextOffset : null;
        while (offset != null && text.length < 32_768) {
          const part = yield* call(
            row,
            "t3_thread_read",
            {
              threadId: row.remote_thread_id,
              itemId: reply.itemId,
              textOffset: offset,
              maxCharsPerItem: 32_768,
            },
            OrchestratorMcpThreadReadResult,
          );
          const item = part.items[0];
          if (!item) return yield* new RemoteCodingError({ reason: "execution" });
          text += item.text ?? "";
          const next = item.textTruncated ? item.nextTextOffset : null;
          if (next != null && next <= offset)
            return yield* new RemoteCodingError({ reason: "execution" });
          offset = next;
        }
        return text.slice(0, 32_768);
      }
      if (afterPosition !== undefined && read.nextPosition <= afterPosition)
        return yield* new RemoteCodingError({ reason: "execution" });
      afterPosition = read.nextPosition;
    }
    return yield* new RemoteCodingError({ reason: "execution" });
  });
  interface SendRow {
    readonly receipt_id: string;
    readonly command_id: string;
    readonly text: string;
    readonly authority_json: string;
    readonly accepted: number;
  }
  const sendCommand = Effect.fn("RemoteCoding.sendCommand")(function* (
    row: CodingRow,
    command: SendRow,
  ) {
    const actor = yield* decodeCaller(command.authority_json).pipe(
      Effect.mapError(() => authorityError()),
    );
    const sent = yield* call(
      row,
      "t3_thread_send",
      {
        threadId: row.remote_thread_id,
        message: command.text,
        mode: "auto",
        clientRequestId: yield* commandKey(row, command.command_id),
      },
      OrchestratorMcpThreadSendResult,
      actor,
    );
    // Persist acknowledgement and resumed following together, including recovery from a settled turn.
    yield* sql
      .withTransaction(
        Effect.gen(function* () {
          yield* sql`UPDATE openbot_remote_coding_sends SET accepted = 1 WHERE receipt_id = ${row.thread_id} AND command_id = ${command.command_id}`;
          yield* sql`UPDATE openbot_coding_tasks SET remote_settled = 0 WHERE thread_id = ${row.thread_id}`;
        }),
      )
      .pipe(Effect.mapError(storageError));
    yield* save(
      row,
      {
        ...(yield* snapshot(row)),
        state: sent.status,
        runId: sent.runId,
        result: null,
        remoteState: "following",
      },
      false,
    );
  });
  const step = Effect.fn("RemoteCoding.step")(function* (initial: CodingRow) {
    let row = initial;
    if (row.remote_thread_id === null) {
      if (row.cancel_requested) {
        const task = yield* snapshot(row);
        yield* save(
          row,
          {
            ...task,
            remoteState: row.remote_launch_attempted ? "reconciliation-required" : "settled",
          },
          !row.remote_launch_attempted,
        );
        return;
      }
      yield* launchRemote(
        row,
        yield* decodeLaunch(row.input_json).pipe(Effect.mapError(storageError)),
      );
      row = yield* load(row.thread_id);
    }
    if (!row.cancel_requested) {
      const pending =
        yield* sql<SendRow>`SELECT * FROM openbot_remote_coding_sends WHERE receipt_id = ${row.thread_id} AND accepted = 0`.pipe(
          Effect.mapError(storageError),
        );
      for (const command of pending) yield* sendCommand(row, command);
      row = yield* load(row.thread_id);
    }
    if (row.remote_stop_pending) {
      yield* call(
        row,
        "t3_thread_interrupt",
        {
          threadId: row.remote_thread_id,
          stop: true,
          clientRequestId: `openbot-stop:${row.command_id}`,
        },
        OrchestratorMcpThreadInterruptResult,
      );
      yield* sql`UPDATE openbot_coding_tasks SET remote_stop_pending = 0 WHERE thread_id = ${row.thread_id}`.pipe(
        Effect.mapError(storageError),
      );
    }
    if (row.remote_settled) return;
    const read = yield* call(
      row,
      "t3_thread_read",
      { threadId: row.remote_thread_id, view: "messages", limit: 1 },
      OrchestratorMcpThreadReadResult,
    );
    const task = yield* snapshot(row);
    yield* save(row, {
      ...task,
      state: terminal.has(read.thread.status) ? "waiting" : read.thread.status,
      runId: read.thread.activeRunId ?? read.thread.latestRunId,
      pendingRequestCount: read.thread.pendingRequestCount,
      result: null,
      remoteState: "following",
      ...(read.thread.link === undefined ? {} : { link: read.thread.link }),
    });
    const waited = yield* call(
      row,
      "t3_thread_wait",
      { threadId: row.remote_thread_id, timeoutMs: 1_000, untilDelegatedWorkSettled: true },
      OrchestratorMcpThreadWaitResult,
    );
    if (waited.timedOut || !terminal.has(waited.status)) return;
    // resultRun is the positive evidence that this peer implements settled delegated work.
    if (!waited.resultRun) return yield* new RemoteCodingError({ reason: "execution" });
    const result = yield* resultText(
      row,
      waited.resultRun.runId,
      waited.resultRun.status === "failed",
    );
    const current = yield* load(row.thread_id);
    yield* save(
      current,
      {
        ...(yield* snapshot(current)),
        state: waited.resultRun.status,
        runId: waited.resultRun.runId,
        result,
        pendingRequestCount: 0,
        remoteState: "settled",
      },
      true,
    );
  });
  const reconcile = Effect.fn("RemoteCoding.reconcile")(
    function* (receiptId?: ThreadId) {
      const rows = yield* (
        receiptId === undefined
          ? sql<CodingRow>`SELECT * FROM openbot_coding_tasks WHERE destination_environment_id IS NOT NULL AND (remote_settled = 0 OR remote_stop_pending = 1 OR EXISTS (SELECT 1 FROM openbot_remote_coding_sends WHERE receipt_id = openbot_coding_tasks.thread_id AND accepted = 0 AND cancel_requested = 0))`
          : sql<CodingRow>`SELECT * FROM openbot_coding_tasks WHERE thread_id = ${receiptId} AND destination_environment_id IS NOT NULL`
      ).pipe(Effect.mapError(storageError));
      for (const row of rows)
        yield* step(row).pipe(
          Effect.catch((error) =>
            Effect.gen(function* () {
              const current = yield* load(row.thread_id);
              yield* save(current, {
                ...(yield* snapshot(current)),
                remoteState:
                  error.reason === "authorization"
                    ? "authorization-required"
                    : current.remote_thread_id === null && current.remote_launch_attempted
                      ? "reconciliation-required"
                      : "unavailable",
              });
            }),
          ),
        );
    },
    (effect: Effect.Effect<void, RemoteCodingError>, _receiptId?: ThreadId) =>
      gate.withPermit(effect),
  );
  const commandKey = Effect.fn("RemoteCoding.commandKey")(function* (
    row: CodingRow,
    commandId: string,
  ) {
    return `openbot-send:${Hex.encode(yield* digest.digest(Digest.sha256, new TextEncoder().encode(yield* encodeCommandKey([row.command_id, commandId]).pipe(Effect.mapError(storageError)))))}`;
  });
  return RemoteCoding.of({
    changes: Stream.fromPubSub(changes),
    authorize,
    snapshot,
    reconcile,
    launch: Effect.fn("RemoteCoding.launch")(
      function* (initial: CodingRow, input: OpenbotCodingLaunchInput) {
        const row = yield* load(initial.thread_id);
        yield* assertCaller(row, "launch");
        yield* launchRemote(row, input).pipe(
          Effect.tapError(() =>
            Effect.gen(function* () {
              const current = yield* load(row.thread_id);
              yield* save(current, {
                ...(yield* snapshot(current)),
                remoteState: "reconciliation-required",
              });
            }),
          ),
        );
        return yield* snapshot(yield* load(row.thread_id));
      },
      (effect: Effect.Effect<OpenbotCodingTask, RemoteCodingError>) => gate.withPermit(effect),
    ),
    send: Effect.fn("RemoteCoding.send")(
      function* (initial: CodingRow, input: OpenbotCodingSendInput) {
        const row = yield* load(initial.thread_id);
        const actor = yield* assertCaller(row, "send");
        if (row.cancel_requested || !row.remote_thread_id || input.text.length > 120_000)
          return yield* new RemoteCodingError({ reason: "conflict" });
        const authority = yield* encodeCaller(actor).pipe(Effect.mapError(storageError));
        yield* sql`INSERT INTO openbot_remote_coding_sends (receipt_id,command_id,text,authority_json) VALUES (${row.thread_id},${input.commandId},${input.text},${authority}) ON CONFLICT DO NOTHING`.pipe(
          Effect.mapError(storageError),
        );
        const commands =
          yield* sql<SendRow>`SELECT * FROM openbot_remote_coding_sends WHERE receipt_id = ${row.thread_id} AND command_id = ${input.commandId}`.pipe(
            Effect.mapError(storageError),
          );
        const command = commands[0]!;
        if (command.text !== input.text)
          return yield* new RemoteCodingError({ reason: "conflict" });
        if (!command.accepted) {
          yield* save(
            row,
            { ...(yield* snapshot(row)), state: "waiting", result: null, remoteState: "following" },
            false,
          );
          yield* sendCommand(row, command);
        }
        return yield* snapshot(yield* load(row.thread_id));
      },
      (effect: Effect.Effect<OpenbotCodingTask, RemoteCodingError>) => gate.withPermit(effect),
    ),
    cancel: Effect.fn("RemoteCoding.cancel")(
      function* (initial: CodingRow, _input: OpenbotCodingCancelInput) {
        const row = yield* load(initial.thread_id);
        const actor = yield* assertCaller(row, "cancel");
        const stopAuthority = yield* encodeCaller(actor).pipe(Effect.mapError(storageError));
        yield* sql`UPDATE openbot_coding_tasks SET remote_stop_authority_json = ${stopAuthority}, cancel_requested = 1, remote_stop_pending = ${row.remote_thread_id === null ? 0 : 1} WHERE thread_id = ${row.thread_id}`.pipe(
          Effect.mapError(storageError),
        );
        yield* step(yield* load(row.thread_id)).pipe(
          Effect.catch((error) =>
            Effect.gen(function* () {
              const current = yield* load(row.thread_id);
              yield* save(current, {
                ...(yield* snapshot(current)),
                remoteState:
                  error.reason === "authorization" ? "authorization-required" : "unavailable",
              });
            }),
          ),
        );
        return yield* snapshot(yield* load(row.thread_id));
      },
      (effect: Effect.Effect<OpenbotCodingTask, RemoteCodingError>) => gate.withPermit(effect),
    ),
    start: Effect.gen(function* () {
      if (started) return;
      started = true;
      yield* reconcile().pipe(
        Effect.ignore,
        Effect.repeat(Schedule.spaced("2 seconds")),
        Effect.forkScoped,
      );
    }),
  });
});

export const layer = Layer.effect(RemoteCoding, make);
