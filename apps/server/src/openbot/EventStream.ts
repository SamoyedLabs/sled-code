import * as NodeWS from "@effect/platform-node/NodeWS";
import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import * as Cause from "effect/Cause";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import {
  OpenbotApprovalContext,
  OpenbotBrowserSecretContext,
  type OpenbotAttentionRequest,
  type OpenbotChange,
} from "@t3tools/contracts";

export class EventStreamError extends Schema.TaggedError<EventStreamError>()(
  "OpenbotEventStreamError",
  {
    reason: Schema.Literals(["transport", "decode", "overflow", "closed"]),
  },
) {}

const Identifier = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(512));
const Text = Schema.String.check(Schema.isMaxLength(4096));
const Identity = {
  requestId: Schema.Union([Identifier, Schema.Int]),
  botId: Identifier,
  threadId: Identifier,
  turnId: Identifier,
};
const Question = Schema.Struct({
  id: Identifier,
  isSecret: Schema.Boolean,
  header: Text,
  question: Text,
  options: Schema.NullOr(
    Schema.Array(Schema.Struct({ label: Text, description: Text })).check(Schema.isMaxLength(64)),
  ),
  multiSelect: Schema.optional(Schema.Boolean),
});
const Snapshot = Schema.Struct({
  attentionComplete: Schema.Boolean,
  pendingPrompts: Schema.Array(
    Schema.Struct({ ...Identity, questions: Schema.Array(Question).check(Schema.isMaxLength(32)) }),
  ).check(Schema.isMaxLength(4)),
  pendingApprovals: Schema.Array(
    Schema.Struct({
      ...Identity,
      kind: Schema.Literals(["command", "file-change", "permissions"]),
      ...OpenbotApprovalContext.fields,
    }),
  ).check(Schema.isMaxLength(4)),
  pendingBrowserTakeovers: Schema.Array(
    Schema.Struct({
      ...Identity,
      tabId: Identifier,
      reason: Schema.optional(Schema.Literal("sign-in-blocked")),
      secret: Schema.optional(OpenbotBrowserSecretContext),
    }),
  ).check(Schema.isMaxLength(4)),
});
const Envelope = Schema.Struct({ type: Identifier });
const decodeEnvelope = Schema.decodeUnknownSync(Envelope);
const decodeSnapshot = Schema.decodeUnknownSync(Schema.Struct({ snapshot: Snapshot }));

export type Frame =
  | {
      readonly type: "snapshot";
      readonly complete: boolean;
      readonly requests: ReadonlyArray<OpenbotAttentionRequest>;
    }
  | { readonly type: "change"; readonly resource: OpenbotChange["resource"] };

const resources: Readonly<Record<string, OpenbotChange["resource"]>> = {
  status: "configuration",
  "bots-changed": "agents",
  "agents-changed": "agents",
  "agent-access-changed": "agents",
  "conversation-invalidated": "conversation",
  "conversation-changed": "conversation",
  "agent-tasks-changed": "tasks",
  "agent-task-conversation": "tasks",
  "memories-changed": "memory",
  "routines-changed": "routines",
  "routine-flows-changed": "routines",
  "queue-invalidated": "queue",
  "queue-changed": "queue",
  "turn-started": "all",
  "turn-completed": "all",
  "quiet-turn-completed": "all",
  "browser-changed": "browser",
  "browser-control-changed": "browser",
  "browser-user-control-changed": "browser",
  "browser-page-state-changed": "browser",
  "skills-changed": "configuration",
  "mcp-servers-changed": "configuration",
  "channels-changed": "all",
  "workflows-changed": "all",
};
const attentionEvents = new Set([
  "prompt",
  "approval",
  "agent-input-resolved",
  "browser-takeover-requested",
  "browser-takeover-resolved",
]);
const capabilities = [
  // Protocol 9's HTTP header does not opt the event stream into open-provider visibility.
  "open-providers-v1",
  "agent-runtime-snapshots",
  "agent-tasks-v1",
  "agent-memories-v1",
  "skills-events-v1",
  "routine-event-markers",
  "routine-run-event-markers",
  "channel-chats-v1",
  "browser-user-control",
  "browser-page-state",
  "prompt-multi-select-v1",
  "workflows-v1",
];

// The released wire uses botId even though the current host's in-process events use agentId.
function attention(snapshot: typeof Snapshot.Type): ReadonlyArray<OpenbotAttentionRequest> {
  const requests: OpenbotAttentionRequest[] = [];
  for (const row of snapshot.pendingApprovals)
    requests.push({
      kind: "approval",
      requestId: row.requestId,
      agentId: row.botId,
      threadId: row.threadId,
      turnId: row.turnId,
      approvalKind: row.kind,
      approval: {
        command: row.command,
        cwd: row.cwd,
        reason: row.reason,
        grantRoot: row.grantRoot,
        permissions: row.permissions,
        truncated: row.truncated,
      },
    });
  for (const row of snapshot.pendingPrompts)
    requests.push({
      kind: "prompt",
      requestId: row.requestId,
      agentId: row.botId,
      threadId: row.threadId,
      turnId: row.turnId,
      questions: row.questions.map((question) => ({
        id: question.id,
        isSecret: question.isSecret,
        header: question.header,
        question: question.question,
        options: question.options,
        ...(question.multiSelect === undefined ? {} : { multiSelect: question.multiSelect }),
      })),
    });
  for (const row of snapshot.pendingBrowserTakeovers)
    requests.push({
      kind: "takeover",
      requestId: row.requestId,
      agentId: row.botId,
      threadId: row.threadId,
      turnId: row.turnId,
      tabId: row.tabId,
      ...(row.reason === undefined ? {} : { takeoverReason: row.reason }),
      ...(row.secret === undefined ? {} : { browserSecret: row.secret }),
    });
  if (requests.length > 4) throw new Error("Invalid attention count");
  return requests;
}

export const connect = (input: {
  readonly origin: string;
  readonly sessionToken: string;
  readonly isClosed: () => boolean;
  readonly peers: Set<() => void>;
}): Stream.Stream<Frame, EventStreamError> =>
  Stream.callback<Frame, EventStreamError>(
    (queue) =>
      Effect.gen(function* () {
        if (input.isClosed()) return yield* new EventStreamError({ reason: "closed" });
        const socket = yield* Effect.try({
          try: () =>
            new NodeWS.WebSocket(
              `${input.origin.replace("http:", "ws:")}/v1/events`,
              ["openbot-team-v1", `openbot-token.${input.sessionToken}`],
              {
                maxPayload: 262144,
                handshakeTimeout: 10000,
                perMessageDeflate: false,
                headers: { "OpenBot-Protocol-Version": "9", "OpenBot-App-Version": "0.60.0" },
              },
            ),
          catch: () => new EventStreamError({ reason: "transport" }),
        });
        let active = true;
        let initialized = false;
        let snapshotRequested = false;
        const stop = (reason: EventStreamError["reason"]) => {
          if (!active) return;
          active = false;
          Queue.failCauseUnsafe(queue, Cause.fail(new EventStreamError({ reason })));
          socket.terminate();
        };
        const close = () => stop("closed");
        input.peers.add(close);
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            active = false;
            input.peers.delete(close);
            socket.terminate();
          }),
        );
        const offer = (frame: Frame) => {
          if (!Queue.offerUnsafe(queue, frame)) stop("overflow");
        };
        socket.on("error", () => stop("transport"));
        socket.on("close", () => stop("transport"));
        socket.on("open", () => {
          if (!active) return;
          if (socket.protocol !== "openbot-team-v1") return stop("decode");
          socket.send(
            JSON.stringify({
              type: "agent-event-scope",
              includeConversations: false,
              capabilities,
            }),
          );
        });
        socket.on("message", (data, isBinary) => {
          if (!active) return;
          if (isBinary) return stop("decode");
          const text = Buffer.isBuffer(data)
            ? data.toString("utf8")
            : Array.isArray(data)
              ? Buffer.concat(data).toString("utf8")
              : Buffer.from(data).toString("utf8");
          if (Buffer.byteLength(text) > 262144) return stop("decode");
          try {
            const value: unknown = JSON.parse(text);
            const envelope = decodeEnvelope(value);
            if (envelope.type === "runtime-snapshot") {
              const { snapshot } = decodeSnapshot(value);
              initialized = true;
              snapshotRequested = false;
              offer({
                type: "snapshot",
                complete: snapshot.attentionComplete,
                requests: attention(snapshot),
              });
            } else if (attentionEvents.has(envelope.type)) {
              if (!snapshotRequested) {
                snapshotRequested = true;
                socket.send(JSON.stringify({ type: "runtime-snapshot-request" }));
              }
            } else {
              const resource = Object.hasOwn(resources, envelope.type)
                ? resources[envelope.type]
                : undefined;
              if (resource) offer({ type: "change", resource });
            }
          } catch {
            stop("decode");
          }
        });
        yield* Effect.sleep("10 seconds").pipe(
          Effect.andThen(
            Effect.sync(() => {
              if (!initialized) stop("transport");
            }),
          ),
          Effect.forkScoped,
        );
      }),
    { bufferSize: 64, strategy: "dropping" },
  );
