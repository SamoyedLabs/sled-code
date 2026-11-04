import {
  CommandId,
  ThreadId,
  type OrchestrationV2ThreadShell,
  type ThreadLaunchReceipt,
} from "@t3tools/contracts";
import * as KeyedLock from "@t3tools/shared/KeyedLock";
import * as Context from "effect/Context";
import * as Digest from "effect/crypto/Digest";
import * as Effect from "effect/Effect";
import * as Hex from "effect/encoding/Hex";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import * as ThreadManagement from "./ThreadManagementService.ts";

export interface LaunchKey {
  readonly requestNamespace: string;
  readonly clientRequestId: string;
}
interface LaunchIdentity {
  readonly commandId: CommandId;
  readonly threadId: ThreadId;
}
const encodeKey = Schema.encodeEffect(
  Schema.fromJsonString(Schema.Tuple([Schema.String, Schema.String])),
);

export class ThreadLaunchReceiptError extends Schema.TaggedError<ThreadLaunchReceiptError>()(
  "ThreadLaunchReceiptError",
  { operation: Schema.Literals(["identity", "read", "write", "stop"]), cause: Schema.Defect() },
) {
  override get message(): string {
    return `Thread launch receipt ${this.operation} failed.`;
  }
}
export class ThreadLaunchCancelledError extends Schema.TaggedError<ThreadLaunchCancelledError>()(
  "ThreadLaunchCancelledError",
  {},
) {
  override get message(): string {
    return "This launch was cancelled. Start new work with a new clientRequestId.";
  }
}

export class ThreadLaunchReceipts extends Context.Service<
  ThreadLaunchReceipts,
  {
    readonly withLaunch: <A, E, R>(
      key: LaunchKey,
      execute: (identity: LaunchIdentity) => Effect.Effect<A, E, R>,
    ) => Effect.Effect<A, E | ThreadLaunchReceiptError | ThreadLaunchCancelledError, R>;
    readonly get: <E, R>(
      key: LaunchKey,
      authorize: (target: OrchestrationV2ThreadShell | null) => Effect.Effect<void, E, R>,
    ) => Effect.Effect<ThreadLaunchReceipt, E | ThreadLaunchReceiptError, R>;
    readonly cancel: <E, R>(
      key: LaunchKey,
      authorize: (target: OrchestrationV2ThreadShell | null) => Effect.Effect<void, E, R>,
    ) => Effect.Effect<ThreadLaunchReceipt, E | ThreadLaunchReceiptError, R>;
  }
>()("t3/orchestration-v2/ThreadLaunchReceipts") {}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const digest = yield* Digest.Digest;
  const threads = yield* ThreadManagement.ThreadManagementService;
  const locks = yield* KeyedLock.make<CommandId>();
  const identity = Effect.fn("ThreadLaunchReceipts.identity")(
    function* (key: LaunchKey) {
      // Existing MCP launches hash this exact JSON pair; changing it duplicates uncertain launches.
      const encoded = new TextEncoder().encode(
        yield* encodeKey([key.requestNamespace, key.clientRequestId]),
      );
      const hash = yield* digest.digest(Digest.sha256, encoded);
      const commandId = CommandId.make(`mcp:launch:${Hex.encode(hash)}`);
      return { commandId, threadId: ThreadId.make(commandId) };
    },
    Effect.mapError((cause) => new ThreadLaunchReceiptError({ operation: "identity", cause })),
  );
  const target = Effect.fn("ThreadLaunchReceipts.target")(function* (id: LaunchIdentity) {
    return yield* threads
      .getThreadShell(id.threadId)
      .pipe(Effect.mapError((cause) => new ThreadLaunchReceiptError({ operation: "read", cause })));
  });
  const read = Effect.fn("ThreadLaunchReceipts.read")(function* <E = never, R = never>(
    id: LaunchIdentity,
    authorize?: (target: OrchestrationV2ThreadShell | null) => Effect.Effect<void, E, R>,
  ): Effect.fn.Return<ThreadLaunchReceipt, ThreadLaunchReceiptError | E, R> {
    const records = yield* sql<{
      cancel_requested: number;
      stop_requested: number;
    }>`SELECT cancel_requested, stop_requested FROM thread_launch_receipts WHERE command_id = ${id.commandId}`.pipe(
      Effect.mapError((cause) => new ThreadLaunchReceiptError({ operation: "read", cause })),
    );
    const row = records[0];
    const shell = yield* target(id);
    if (authorize !== undefined) yield* authorize(shell);
    const cancelled = row?.cancel_requested === 1;
    return {
      state: cancelled
        ? "cancelled"
        : shell !== null
          ? "accepted"
          : row === undefined
            ? "unknown"
            : "pending",
      threadId: shell?.id ?? null,
      projectId: shell?.projectId ?? null,
      cancelRequested: cancelled,
      stopState: !cancelled
        ? null
        : shell === null || shell.deletedAt !== null
          ? "not-needed"
          : row?.stop_requested === 1
            ? "requested"
            : "pending",
    };
  });
  return ThreadLaunchReceipts.of({
    withLaunch: Effect.fn("ThreadLaunchReceipts.withLaunch")(function* <A, E, R>(
      key: LaunchKey,
      execute: (identity: LaunchIdentity) => Effect.Effect<A, E, R>,
    ) {
      const id = yield* identity(key);
      return yield* locks.withLock(
        id.commandId,
        Effect.gen(function* () {
          yield* sql`INSERT INTO thread_launch_receipts (command_id) VALUES (${id.commandId}) ON CONFLICT DO NOTHING`.pipe(
            Effect.mapError((cause) => new ThreadLaunchReceiptError({ operation: "write", cause })),
          );
          if ((yield* read(id)).cancelRequested) return yield* new ThreadLaunchCancelledError();
          return yield* execute(id);
        }),
      );
    }),
    get: Effect.fn("ThreadLaunchReceipts.get")(function* <E, R>(
      key: LaunchKey,
      authorize: (target: OrchestrationV2ThreadShell | null) => Effect.Effect<void, E, R>,
    ) {
      return yield* read(yield* identity(key), authorize);
    }),
    cancel: Effect.fn("ThreadLaunchReceipts.cancel")(function* <E, R>(
      key: LaunchKey,
      authorize: (shell: OrchestrationV2ThreadShell | null) => Effect.Effect<void, E, R>,
    ) {
      const id = yield* identity(key);
      return yield* locks.withLock(
        id.commandId,
        Effect.gen(function* () {
          const shell = yield* target(id);
          yield* authorize(shell);
          yield* sql`INSERT INTO thread_launch_receipts (command_id,cancel_requested) VALUES (${id.commandId},1) ON CONFLICT (command_id) DO UPDATE SET cancel_requested = 1`.pipe(
            Effect.mapError((cause) => new ThreadLaunchReceiptError({ operation: "write", cause })),
          );
          if (shell !== null && shell.deletedAt === null) {
            const commandId = CommandId.make(`${id.commandId}:stop`);
            yield* threads
              .dispatch({ type: "thread.stop", commandId, threadId: shell.id })
              .pipe(
                Effect.mapError(
                  (cause) => new ThreadLaunchReceiptError({ operation: "stop", cause }),
                ),
              );
            yield* threads
              .stopDelegatedTasks({ threadId: shell.id, commandId })
              .pipe(
                Effect.mapError(
                  (cause) => new ThreadLaunchReceiptError({ operation: "stop", cause }),
                ),
              );
            yield* sql`UPDATE thread_launch_receipts SET stop_requested = 1 WHERE command_id = ${id.commandId}`.pipe(
              Effect.mapError(
                (cause) => new ThreadLaunchReceiptError({ operation: "write", cause }),
              ),
            );
          }
          return yield* read(id);
        }),
      );
    }),
  });
});
export const layer = Layer.effect(ThreadLaunchReceipts, make);
