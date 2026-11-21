import {
  AuthSessionId,
  EnvironmentId,
  ThreadLaunchReceipt,
  OrchestratorMcpThreadReadResult,
  OrchestratorMcpThreadWaitResult,
  CommandId,
  MessageId,
  OpenbotCodingLaunchInput,
  ThreadId,
  IsoDateTime,
  type OpenbotChannelAdminRequest,
} from "@t3tools/contracts";
import {
  delegatedTaskProgress,
  subagentResultForRun,
} from "@t3tools/provider-core/server/subagentProjection";
import * as DateTime from "effect/DateTime";
import { runtimeModeRank, interactionModeRank } from "../mcp/delegatedTaskModes.ts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Schedule from "effect/Schedule";
import * as Semaphore from "effect/Semaphore";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/sql/SqlClient";
import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import * as ThreadLaunch from "../orchestration-v2/ThreadLaunchService.ts";
import * as CommandReceipts from "../orchestration-v2/CommandReceiptStore.ts";
import * as OrchestrationEvents from "../persistence/OrchestrationEventStore.ts";
import * as Integration from "./Integration.ts";
import * as Origins from "./ChannelCodingOrigins.ts";
import * as Ledger from "./ChannelCodingLedger.ts";
import * as Events from "./ChannelCodingEvents.ts";
import * as SledTools from "./SledTools.ts";
import * as RemoteCoding from "./RemoteCoding.ts";
import * as PeerLinks from "../peer/PeerLinks.ts";
import * as PeerMcpClient from "../peer/PeerMcpClient.ts";
import * as Grants from "./ChannelCodingGrants.ts";
import * as CodingPolicy from "./CodingPolicy.ts";
import * as ChannelProtocol from "./ChannelProtocol.ts";
import { TeamClientError } from "./TeamClient.ts";
export class ChannelCodingError extends Schema.TaggedError<ChannelCodingError>()(
  "ChannelCodingError",
  {
    reason: Schema.Literals(["authority", "conflict", "execution", "storage", "upstream"]),
    cause: Schema.optional(Schema.Defect()),
    definitiveRefusal: Schema.optional(Schema.Boolean),
  },
) {}
export class ChannelCoding extends Context.Service<
  ChannelCoding,
  {
    readonly send: (
      hostId: string,
      request: Extract<OpenbotChannelAdminRequest, { operation: "channel.send" }>,
    ) => Effect.Effect<Schema.Json, ChannelCodingError>;
    readonly launch: (
      sessionId: string,
      credential: string,
      intent: unknown,
    ) => Effect.Effect<{ threadId: string }, ChannelCodingError>;
    readonly reconcile: Effect.Effect<void, ChannelCodingError>;
    readonly start: Effect.Effect<void, never, Scope.Scope>;
  }
>()("t3/openbot/ChannelCoding") {}
const decodeAuthority = Schema.decodeUnknownEffect(Schema.fromJsonString(RemoteCoding.Authority));
const decodeLaunch = Schema.decodeUnknownEffect(OpenbotCodingLaunchInput);
const json = Schema.decodeUnknownEffect(Schema.Json);
const decodeJsonText = Schema.decodeEffect(Schema.fromJsonString(Schema.Json));
const wrap = (cause: unknown) => new ChannelCodingError({ reason: "execution", cause });
const portError = (cause: unknown) => new TeamClientError({ reason: "transport", cause });
export const layer = Layer.effect(
  ChannelCoding,
  Effect.gen(function* () {
    const integration = yield* Integration.Integration;
    const origins = yield* Origins.ChannelCodingOrigins;
    const ledger = yield* Ledger.ChannelCodingLedger;
    const tools = yield* SledTools.SledTools;
    const grants = yield* Grants.ChannelCodingGrants;
    const codingPolicy = yield* CodingPolicy.CodingPolicy;
    const launchService = yield* ThreadLaunch.ThreadLaunchService;
    const threads = yield* ThreadManagement.ThreadManagementService;
    const projections = yield* ProjectionStore.ProjectionStoreV2;
    const receipts = yield* CommandReceipts.CommandReceiptStoreV2;
    const secrets = yield* ServerSecretStore.ServerSecretStore;
    const events = yield* Events.ChannelCodingEvents;
    const applicationEvents = yield* OrchestrationEvents.OrchestrationEventStore;
    const sql = yield* SqlClient.SqlClient;
    const peers = yield* PeerMcpClient.PeerMcpClient;
    const links = yield* PeerLinks.PeerLinks;
    const gate = yield* Semaphore.make(1);
    const authorityContext = yield* Effect.context<
      | import("../auth/EnvironmentAuth.ts").EnvironmentAuth
      | import("../orchestration-v2/ThreadManagementService.ts").ThreadManagementService
      | import("../policy/ManagedPolicy.ts").ManagedPolicy
    >();
    const remoteCall = Effect.fn("ChannelCoding.remoteCall")(function* <
      S extends Schema.Decoder<unknown>,
    >(
      row: Ledger.ChannelRow,
      owner: RemoteCoding.Authority,
      tool: string,
      args: Record<string, unknown>,
      success: S,
    ) {
      if (!row.environment_id || !row.remote_linked_at)
        return yield* new ChannelCodingError({ reason: "authority" });
      const limits = yield* RemoteCoding.validateOriginalAuthority(owner).pipe(
        Effect.provide(authorityContext),
      );
      yield* tools.connectorSession(row.host_id);
      return yield* peers.call({
        environmentId: EnvironmentId.make(row.environment_id),
        expectedLinkedAt: row.remote_linked_at,
        tool,
        arguments: args,
        limits,
        success,
      });
    });
    const remoteRecover = Effect.fn("ChannelCoding.remoteRecover")(function* (
      row: Ledger.ChannelRow,
      owner: RemoteCoding.Authority,
    ) {
      const receipt = yield* remoteCall(
        row,
        owner,
        "t3_thread_launch_receipt",
        { action: "get", clientRequestId: `openbot-channel:${row.command_id}` },
        ThreadLaunchReceipt,
      );
      if (receipt.state !== "accepted" || !receipt.threadId) return null;
      if (receipt.projectId !== row.project_id)
        return yield* new ChannelCodingError({ reason: "conflict" });
      yield* sql`UPDATE openbot_channel_coding_tasks SET remote_thread_id=${receipt.threadId} WHERE binding_key=${row.binding_key}`;
      return receipt.threadId;
    });
    const stopOwned = Effect.fn("ChannelCoding.stopOwned")(function* (row: Ledger.ChannelRow) {
      if (row.environment_id && row.remote_linked_at) {
        // This can only cancel the immutable receipt owned by this connector's peer grant.
        // Revoking a human's launch permission must not prevent stopping that exact old launch.
        yield* tools.connectorSession(row.host_id);
        yield* peers.call({
          environmentId: EnvironmentId.make(row.environment_id),
          expectedLinkedAt: row.remote_linked_at,
          tool: "t3_thread_launch_receipt",
          arguments: { action: "cancel", clientRequestId: `openbot-channel:${row.command_id}` },
          limits: { runtimeMode: "approval-required", interactionMode: "plan" },
          success: ThreadLaunchReceipt,
        });
      } else {
        const receipt = yield* receipts.getByCommandId(CommandId.make(row.command_id));
        if (
          Option.isSome(receipt) &&
          receipt.value.status === "accepted" &&
          receipt.value.threadId === row.thread_id
        ) {
          const commandId = CommandId.make(`openbot-channel-stop:${row.command_id}`);
          yield* threads.dispatch({
            type: "thread.stop",
            threadId: ThreadId.make(row.thread_id),
            commandId,
          });
          yield* threads.stopDelegatedTasks({ threadId: ThreadId.make(row.thread_id), commandId });
        }
      }
      yield* ledger.transition(row.binding_key, "stale");
    });
    const send = Effect.fn("ChannelCoding.send")(function* (
      hostId: string,
      request: Extract<OpenbotChannelAdminRequest, { operation: "channel.send" }>,
    ) {
      const { includeReceipt, ...channelRequest } = request;
      const command = yield* json(ChannelProtocol.route(channelRequest).body);
      const acceptedMessageId = yield* integration.withChannelToHost(hostId, (port, identity) =>
        Effect.gen(function* () {
          if (!(yield* port.available))
            return yield* new TeamClientError({ reason: "invalid-configuration" });
          const origin = yield* origins.prepare({
            hostId,
            fingerprint: identity.fingerprint,
            channelId: request.channelId,
            operationId: request.operationId,
            payload: command,
          });
          const accepted = yield* port.recover(
            origin.origin_ref,
            request.channelId,
            request.operationId,
          );
          const receipt =
            accepted ??
            (yield* port
              .send(origin.origin_ref, command)
              .pipe(
                Effect.tapError(() => origins.uncertain(origin.origin_ref).pipe(Effect.ignore)),
              ));
          if (
            receipt.payloadHash !== origin.payload_hash ||
            receipt.originRef !== origin.origin_ref ||
            receipt.channelId !== request.channelId ||
            receipt.operationId !== request.operationId
          )
            return yield* new TeamClientError({ reason: "decode" });
          yield* origins.accept(origin.origin_ref, receipt.messageId, receipt.receiptId);
          return receipt.messageId;
        }).pipe(Effect.mapError(portError)),
      );
      if (includeReceipt) return { acceptedMessageId, acceptedOperationId: request.operationId };
      return yield* integration.apiReadToHost(hostId, {
        operation: "channel.read",
        channelId: request.channelId,
      });
    }, Effect.mapError(wrap));
    const launch = Effect.fn("ChannelCoding.launch")(function* (
      sessionId: string,
      credential: string,
      intent: unknown,
    ) {
      let dispatched = false;
      return yield* Effect.gen(function* () {
        const hostId = yield* integration.readyHostId;
        if (!hostId) return yield* new ChannelCodingError({ reason: "authority" });
        yield* tools.assertConnector(sessionId, hostId);
        return yield* integration.withChannelToHost(hostId, (port, identity) =>
          Effect.gen(function* () {
            const verified = yield* port.verify(credential, "launch");
            if (Origins.channelPayloadHash(yield* json(intent)) !== verified.payloadHash)
              return yield* new ChannelCodingError({ reason: "conflict" });
            const grant =
              verified.requesterKind !== "session"
                ? yield* grants.resolve({
                    hostId,
                    fingerprint: identity.fingerprint,
                    agentId: verified.binding.agentId,
                    channelId: verified.binding.channelId,
                    requesterKind: verified.requesterKind,
                    requesterId: verified.binding.requesterId,
                  })
                : null;
            if (!grant && !verified.originRef)
              return yield* new ChannelCodingError({ reason: "authority" });
            const owner =
              grant?.authority ??
              (yield* origins.owner(
                verified.originRef!,
                hostId,
                identity.fingerprint,
                verified.binding.channelId,
                verified.binding.requestMessageId,
              ));
            const defaults =
              grant?.defaults ??
              (yield* codingPolicy.executionDefaults({
                hostId,
                agentId: verified.binding.agentId,
              }));
            const limits = yield* RemoteCoding.validateOriginalAuthority(owner).pipe(
              Effect.provide(authorityContext),
            );
            const input = yield* decodeLaunch({
              ...defaults,
              ...(typeof intent === "object" && intent !== null ? intent : {}),
              origin: {
                hostId,
                agentId: verified.binding.agentId,
                channelId: verified.binding.channelId,
                taskId: verified.binding.taskId,
              },
              operationId: verified.binding.operationId,
            });
            if (
              grant &&
              Origins.channelPayloadHash(
                yield* json({
                  environmentId: input.environmentId ?? null,
                  projectId: input.projectId,
                  modelSelection: input.modelSelection,
                  workspaceStrategy: input.workspaceStrategy,
                }),
              ) !==
                Origins.channelPayloadHash(
                  yield* json({
                    environmentId: grant.defaults.environmentId ?? null,
                    projectId: grant.defaults.projectId,
                    modelSelection: grant.defaults.modelSelection,
                    workspaceStrategy: grant.defaults.workspaceStrategy,
                  }),
                )
            )
              return yield* new ChannelCodingError({ reason: "authority" });
            const narrowed = {
              ...input,
              runtimeMode: [
                input.runtimeMode,
                limits.runtimeMode,
                ...(grant ? [grant.defaults.runtimeMode] : []),
              ].toSorted((a, b) => runtimeModeRank(a) - runtimeModeRank(b))[0]!,
              interactionMode: [
                input.interactionMode,
                limits.interactionMode,
                ...(grant ? [grant.defaults.interactionMode] : []),
              ].toSorted((a, b) => interactionModeRank(a) - interactionModeRank(b))[0]!,
            };
            let row = yield* ledger.reserve({
              hostId,
              fingerprint: identity.fingerprint,
              originRef: verified.originRef,
              ...(grant ? { grantId: grant.grantId, standingAuthority: grant.authority } : {}),
              binding: verified.binding,
              launch: yield* json(narrowed),
              projectId: input.projectId,
              ...(input.environmentId ? { environmentId: input.environmentId } : {}),
            });
            dispatched = row.state !== "reserved";
            yield* secrets.set(
              `openbot-channel-${row.binding_key}`,
              new TextEncoder().encode(credential),
            );
            if (input.environmentId) {
              if (!row.remote_linked_at) {
                const link = yield* links.get(input.environmentId);
                if (!(yield* links.enabled) || Option.isNone(link))
                  return yield* new ChannelCodingError({ reason: "authority" });
                const linkedAt = DateTime.formatIso(link.value.linkedAt);
                yield* sql`UPDATE openbot_channel_coding_tasks SET remote_linked_at=${linkedAt} WHERE binding_key=${row.binding_key}`;
                row = yield* ledger.read(row.binding_key);
              }
              let threadId = row.remote_thread_id ?? (yield* remoteRecover(row, owner));
              if (!threadId && row.state === "reserved") {
                yield* tools.assertConnector(sessionId, hostId);
                yield* port.verify(credential, "launch");
                dispatched = true;
                yield* ledger.transition(row.binding_key, "uncertain");
                const launched = yield* remoteCall(
                  row,
                  owner,
                  "t3_thread_launch",
                  {
                    projectId: input.projectId,
                    title: input.title,
                    modelSelection: input.modelSelection,
                    runtimeMode: narrowed.runtimeMode,
                    interactionMode: narrowed.interactionMode,
                    workspaceStrategy: input.workspaceStrategy,
                    message: input.prompt,
                    clientRequestId: `openbot-channel:${row.command_id}`,
                  },
                  Schema.Struct({ threadId: ThreadId, runId: Schema.NullOr(Schema.String) }),
                );
                threadId = launched.threadId;
                yield* sql`UPDATE openbot_channel_coding_tasks SET remote_thread_id=${threadId} WHERE binding_key=${row.binding_key}`;
              }
              if (!threadId) return yield* new ChannelCodingError({ reason: "execution" });
              yield* ledger.transition(row.binding_key, "accepted");
              return { threadId };
            }
            if (row.state === "reserved") {
              yield* tools.assertConnector(sessionId, hostId);
              yield* port.verify(credential, "launch");
              yield* RemoteCoding.validateOriginalAuthority(owner).pipe(
                Effect.provide(authorityContext),
              );
              dispatched = true;
              yield* ledger.transition(row.binding_key, "uncertain");
              yield* launchService.launch({
                commandId: CommandId.make(row.command_id),
                threadId: ThreadId.make(row.thread_id),
                projectId: input.projectId,
                title: input.title,
                modelSelection: input.modelSelection,
                runtimeMode: narrowed.runtimeMode,
                interactionMode: narrowed.interactionMode,
                workspaceStrategy: input.workspaceStrategy,
                initialMessage: {
                  messageId: MessageId.make(row.command_id),
                  text: input.prompt,
                  attachments: [],
                },
                createdBy: "agent",
                creationSource: "server",
              });
            }
            const receipt = yield* receipts.getByCommandId(CommandId.make(row.command_id));
            if (
              Option.isNone(receipt) ||
              receipt.value.status !== "accepted" ||
              receipt.value.threadId !== row.thread_id
            )
              return yield* new ChannelCodingError({ reason: "execution" });
            yield* ledger.transition(row.binding_key, "accepted");
            return { threadId: row.thread_id };
          }).pipe(Effect.mapError(portError)),
        );
      }).pipe(
        Effect.mapError(
          (cause) =>
            new ChannelCodingError({ reason: "execution", cause, definitiveRefusal: !dispatched }),
        ),
      );
    });
    const reconcile = Effect.gen(function* () {
      const hostId = yield* integration.readyHostId;
      if (!hostId) return;
      const rows =
        yield* sql<Ledger.ChannelRow>`SELECT t.* FROM openbot_channel_coding_tasks t WHERE t.host_id=${hostId} AND t.state IN ('uncertain','accepted','terminal')`;
      for (const row of rows)
        yield* Effect.gen(function* () {
          const secret = yield* secrets.get(`openbot-channel-${row.binding_key}`);
          if (Option.isNone(secret)) return;
          const credential = new TextDecoder().decode(secret.value);
          const owner = yield* decodeAuthority(row.authority_json);
          const authorization = yield* RemoteCoding.validateOriginalAuthority(owner).pipe(
            Effect.provide(authorityContext),
            Effect.result,
          );
          if (authorization._tag === "Failure") {
            yield* stopOwned(row);
            return;
          }
          yield* integration.withChannelToHost(hostId, (port, identity) =>
            Effect.gen(function* () {
              if (identity.fingerprint !== row.fingerprint)
                return yield* new ChannelCodingError({ reason: "authority" });
              const verification = yield* port.verify(credential, "reconcile").pipe(Effect.result);
              if (verification._tag === "Failure") {
                if (
                  verification.failure.reason === "http" &&
                  [403, 409, 410].includes(verification.failure.status ?? 0)
                ) {
                  yield* stopOwned(row);
                  return;
                }
                return yield* verification.failure;
              }
              const verified = verification.success;
              if (
                Origins.channelPayloadHash(yield* json(verified.binding)) !==
                Origins.channelPayloadHash(yield* decodeJsonText(row.binding_json))
              )
                return yield* new ChannelCodingError({ reason: "conflict" });
              if (row.origin_ref)
                yield* origins.owner(
                  row.origin_ref,
                  hostId,
                  identity.fingerprint,
                  verified.binding.channelId,
                  verified.binding.requestMessageId,
                );
              if (row.grant_id) {
                const permitted =
                  owner.kind === "session" &&
                  (yield* grants.authorizeDelivery({
                    sessionId: owner.sessionId,
                    grantId: row.grant_id,
                    hostId,
                    agentId: verified.binding.agentId,
                    channelId: verified.binding.channelId,
                    taskId: verified.binding.taskId,
                    threadId: ThreadId.make(row.thread_id),
                  }));
                if (!permitted) {
                  yield* stopOwned(row);
                  return;
                }
              }
              let threadId = ThreadId.make(row.remote_thread_id ?? row.thread_id);
              let terminal = false;
              let status: Events.ChannelCodingEvent["status"] = "executing";
              let text = "";
              let revision = "";
              let updatedAt: string;
              if (row.environment_id) {
                const actual = row.remote_thread_id ?? (yield* remoteRecover(row, owner));
                if (!actual) return;
                threadId = ThreadId.make(actual);
                if (row.state === "uncertain")
                  yield* ledger.transition(row.binding_key, "accepted");
                const remoteRow = { ...row, remote_thread_id: actual };
                const read = yield* remoteCall(
                  remoteRow,
                  owner,
                  "t3_thread_read",
                  { threadId: actual, view: "messages", limit: 100 },
                  OrchestratorMcpThreadReadResult,
                );
                if (read.thread.threadId !== actual || read.thread.projectId !== row.project_id)
                  return yield* new ChannelCodingError({ reason: "conflict" });
                updatedAt = read.thread.updatedAt;
                revision = `${read.thread.updatedAt}:${(read.thread.pendingRequestIds ?? []).toSorted().join(",")}`;
                status = read.thread.pendingRequestCount ? "needs_input" : "executing";
                if (
                  read.thread.pendingRequestKinds?.some((request) =>
                    [
                      "command",
                      "file-read",
                      "file-change",
                      "mcp-elicitation",
                      "permission",
                    ].includes(request.kind),
                  )
                )
                  status = "needs_approval";
                const waited = yield* remoteCall(
                  remoteRow,
                  owner,
                  "t3_thread_wait",
                  { threadId: actual, timeoutMs: 1000, untilDelegatedWorkSettled: true },
                  OrchestratorMcpThreadWaitResult,
                );
                terminal = !waited.timedOut && waited.resultRun !== undefined;
                if (terminal && waited.resultRun) {
                  status =
                    waited.resultRun.status === "completed"
                      ? "completed"
                      : waited.resultRun.status === "cancelled"
                        ? "cancelled"
                        : "failed";
                  let page = read;
                  let result: (typeof read.items)[number] | undefined;
                  for (let n = 0; n < 100; n++) {
                    result =
                      page.items.findLast(
                        (item) =>
                          item.runId === waited.resultRun!.runId &&
                          (item.type === "assistant_message" ||
                            (status !== "completed" && item.type === "error")),
                      ) ?? result;
                    if (!page.hasMore || page.nextPosition === null) break;
                    const after = page.nextPosition;
                    page = yield* remoteCall(
                      remoteRow,
                      owner,
                      "t3_thread_read",
                      { threadId: actual, view: "messages", limit: 100, afterPosition: after },
                      OrchestratorMcpThreadReadResult,
                    );
                    if (page.nextPosition !== null && page.nextPosition <= after)
                      return yield* new ChannelCodingError({ reason: "conflict" });
                  }
                  text = result?.text ?? `Coding ${waited.resultRun.status}.`;
                  let offset = result?.textTruncated ? result.nextTextOffset : null;
                  const resultItemId = result?.itemId;
                  if (resultItemId !== undefined)
                    while (offset != null && text.length < 100000) {
                      const part = yield* remoteCall(
                        remoteRow,
                        owner,
                        "t3_thread_read",
                        {
                          threadId: actual,
                          itemId: resultItemId,
                          textOffset: offset,
                          maxCharsPerItem: 32768,
                        },
                        OrchestratorMcpThreadReadResult,
                      );
                      const item = part.items[0];
                      if (!item) return yield* new ChannelCodingError({ reason: "execution" });
                      text += item.text ?? "";
                      const next = item.textTruncated ? item.nextTextOffset : null;
                      if (next != null && next <= offset)
                        return yield* new ChannelCodingError({ reason: "conflict" });
                      offset = next;
                    }
                  text = text.slice(0, 100000);
                }
              } else {
                const projection = yield* projections.getThreadProjection(threadId);
                if (row.state === "uncertain") {
                  const receipt = yield* receipts.getByCommandId(CommandId.make(row.command_id));
                  if (
                    Option.isNone(receipt) ||
                    receipt.value.status !== "accepted" ||
                    receipt.value.threadId !== row.thread_id
                  )
                    return;
                  yield* ledger.transition(row.binding_key, "accepted");
                }
                const progress = delegatedTaskProgress(projection);
                const run =
                  progress.state === "result_available"
                    ? progress.resultRun
                    : projection.runs.toSorted((a, b) => b.ordinal - a.ordinal)[0];
                terminal = progress.state === "result_available";
                status = terminal
                  ? run?.status === "completed"
                    ? "completed"
                    : run?.status === "cancelled"
                      ? "cancelled"
                      : "failed"
                  : projection.runtimeRequests.some(
                        (r) => r.status === "pending" && r.kind === "user_input",
                      )
                    ? "needs_input"
                    : projection.runtimeRequests.some((r) => r.status === "pending")
                      ? "needs_approval"
                      : "executing";
                updatedAt = DateTime.formatIso(projection.updatedAt);
                revision = String(DateTime.toEpochMillis(projection.updatedAt));
                if (terminal && run)
                  text =
                    subagentResultForRun(projection, run).text.slice(0, 100000) ||
                    `Coding ${run.status}.`;
              }
              if (!terminal) {
                const currentReceipt = yield* port.receipt(credential);
                const now = yield* DateTime.now;
                if (
                  currentReceipt?.lease &&
                  currentReceipt.lease.expiresAt - now.epochMilliseconds < 5 * 60_000
                ) {
                  yield* tools.connectorSession(hostId);
                  yield* RemoteCoding.validateOriginalAuthority(owner).pipe(
                    Effect.provide(authorityContext),
                  );
                  if (row.origin_ref)
                    yield* origins.owner(
                      row.origin_ref,
                      hostId,
                      identity.fingerprint,
                      verified.binding.channelId,
                      verified.binding.requestMessageId,
                    );
                  if (
                    row.grant_id &&
                    owner.kind === "session" &&
                    !(yield* grants.authorizeDelivery({
                      sessionId: owner.sessionId,
                      grantId: row.grant_id,
                      hostId,
                      agentId: verified.binding.agentId,
                      channelId: verified.binding.channelId,
                      taskId: verified.binding.taskId,
                      threadId,
                    }))
                  ) {
                    yield* stopOwned(row);
                    return;
                  }
                  yield* port.renew(credential);
                }
              }
              if (owner.kind === "session")
                yield* events.publish({
                  eventId: `${row.binding_key}:${revision}:${status}`,
                  hostId,
                  agentId: verified.binding.agentId,
                  channelId: verified.binding.channelId,
                  taskId: verified.binding.taskId,
                  threadId,
                  status,
                  ...(row.environment_id
                    ? { environmentId: EnvironmentId.make(row.environment_id) }
                    : {}),
                  updatedAt: IsoDateTime.make(updatedAt),
                  recipient: {
                    sessionId: AuthSessionId.make(owner.sessionId),
                    ...(row.grant_id ? { grantId: row.grant_id } : {}),
                  },
                });
              if (!terminal) {
                if (!(yield* port.progressAvailable)) return;
                yield* RemoteCoding.validateOriginalAuthority(owner).pipe(
                  Effect.provide(authorityContext),
                );
                yield* tools.connectorSession(hostId);
                // Revalidate origin/grant after remote reads and immediately before the external effect.
                if (row.origin_ref)
                  yield* origins.owner(
                    row.origin_ref,
                    hostId,
                    identity.fingerprint,
                    verified.binding.channelId,
                    verified.binding.requestMessageId,
                  );
                if (
                  row.grant_id &&
                  (owner.kind !== "session" ||
                    !(yield* grants.authorizeDelivery({
                      sessionId: owner.sessionId,
                      grantId: row.grant_id,
                      hostId,
                      agentId: verified.binding.agentId,
                      channelId: verified.binding.channelId,
                      taskId: verified.binding.taskId,
                      threadId: ThreadId.make(row.thread_id),
                    })))
                )
                  return;
                if (
                  status !== "executing" &&
                  status !== "needs_input" &&
                  status !== "needs_approval"
                )
                  return yield* new ChannelCodingError({ reason: "conflict" });
                const event = {
                  eventId: Origins.channelPayloadHash({
                    binding: row.binding_key,
                    revision,
                    status,
                  }),
                  status,
                  updatedAt,
                };
                const receipt = yield* port.progress(credential, event);
                if (
                  receipt.eventId !== event.eventId ||
                  receipt.status !== event.status ||
                  receipt.updatedAt !== event.updatedAt
                )
                  return yield* new ChannelCodingError({ reason: "conflict" });
                return;
              }
              const outcome = { text };
              if (row.state !== "terminal") yield* ledger.terminal(row.binding_key, outcome);
              yield* RemoteCoding.validateOriginalAuthority(owner).pipe(
                Effect.provide(authorityContext),
              );
              yield* tools.connectorSession(hostId);
              let receipt = yield* port.receipt(credential);
              if (!receipt?.result) receipt = yield* port.submit(credential, text);
              if (
                receipt?.result?.text !== text ||
                receipt.binding.assignmentId !== verified.binding.assignmentId
              )
                return yield* new ChannelCodingError({ reason: "conflict" });
              yield* ledger.delivered(row.binding_key, outcome, yield* json(receipt));
            }).pipe(Effect.mapError(portError)),
          );
        }).pipe(
          Effect.tapError((cause) => Effect.logWarning("openbot.channel-coding-reconcile", cause)),
          Effect.ignore,
        );
    }).pipe(Effect.mapError(wrap));
    const serialized = gate.withPermit(reconcile);
    const start = Effect.gen(function* () {
      yield* serialized.pipe(Effect.ignore);
      yield* serialized.pipe(
        Effect.ignore,
        Effect.repeat(Schedule.spaced("5 seconds")),
        Effect.forkScoped,
      );
      yield* grants.changes.pipe(
        Stream.runForEach(() => serialized.pipe(Effect.ignore)),
        Effect.forkScoped,
      );
      yield* applicationEvents.streamApplicationEvents({ afterSequence: 0 }).pipe(
        Stream.runForEach(() => serialized.pipe(Effect.ignore)),
        Effect.retry({ schedule: Schedule.spaced("10 seconds") }),
        Effect.forkScoped,
      );
    });
    return ChannelCoding.of({
      send,
      launch: Effect.fn("ChannelCoding.launchSerialized")((...args: Parameters<typeof launch>) =>
        gate.withPermit(launch(...args)),
      ),
      reconcile: serialized,
      start,
    });
  }),
);
