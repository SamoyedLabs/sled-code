import * as ConnectWebhookRouting from "./ConnectWebhookRouting.ts";
import * as ChangeJournal from "./ChangeJournal.ts";
import * as RetainedManagedHost from "./RetainedManagedHost.ts";
import { resolveRuntimeExecutable } from "./RuntimeExecutable.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import type { ComputerSession } from "./ComputerViewSession.ts";
import {
  type OpenbotAgentList,
  type OpenbotHostStatus,
  type OpenbotReadRequest,
  type OpenbotWriteRequest,
  type OpenbotAdminRequest,
  type OpenbotApiResponse,
  type OpenbotAttentionSnapshot,
  type OpenbotChange,
  OpenbotContextState,
  type OpenbotUpstreamInstallInput,
  type OpenbotInstalledRuntime,
  type OpenbotLibraryPreviewRequest,
  type OpenbotLiveVoiceCommand,
  type OpenbotLiveVoiceResult,
  OPENBOT_LIVE_VOICE_CAPABILITY,
  OPENBOT_LIBRARY_PREVIEW_LIMIT,
  OpenbotLibraryPictureMime,
} from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Context from "effect/Context";
import * as Clock from "effect/Clock";
import * as Base64 from "effect/encoding/Base64";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as PubSub from "effect/PubSub";
import * as Stream from "effect/Stream";
import * as Schedule from "effect/Schedule";
import * as Option from "effect/Option";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as ServerConfig from "../config.ts";
import * as ManagedHost from "./ManagedHost.ts";
import * as TeamClient from "./TeamClient.ts";
import * as RuntimeInstallation from "./RuntimeInstallation.ts";
import * as HostRecovery from "./HostRecovery.ts";

const sameContext = Schema.toEquivalence(OpenbotContextState);
const decodeWorkflowWebhookRoute = Schema.decodeUnknownEffect(
  Schema.Struct({
    routeId: Schema.NullOr(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(512))),
  }),
);

export class IntegrationError extends Schema.TaggedError<IntegrationError>()(
  "OpenbotIntegrationError",
  {
    message: Schema.String,
    cause: Schema.Defect(),
  },
) {}

export class Integration extends Context.Service<
  Integration,
  {
    readonly receiveConnectWebhook: (input: {
      hookId: string;
      token: string;
      deliveryId: string;
      timestamp: string;
      signature: string;
      body: Uint8Array;
    }) => Effect.Effect<{ status: number }, IntegrationError>;
    readonly status: Effect.Effect<OpenbotHostStatus>;
    readonly readyHostId: Effect.Effect<string | null>;
    readonly readyChanges: Stream.Stream<string | null>;
    readonly subscribeChanges: Stream.Stream<OpenbotChange>;
    readonly attentionSnapshot: Effect.Effect<OpenbotAttentionSnapshot>;
    readonly start: Effect.Effect<OpenbotHostStatus, IntegrationError>;
    readonly stop: Effect.Effect<OpenbotHostStatus, IntegrationError>;
    readonly activateRuntime: (
      input: OpenbotUpstreamInstallInput,
    ) => Effect.Effect<OpenbotHostStatus, IntegrationError>;
    readonly rollbackRuntime: Effect.Effect<OpenbotHostStatus, IntegrationError>;
    readonly listAgents: Effect.Effect<typeof OpenbotAgentList.Type, IntegrationError>;
    readonly withInstanceTransferToHost: <A>(
      hostId: string,
      action: (
        transfer: NonNullable<TeamClient.Session["instanceTransfer"]>,
      ) => Effect.Effect<A, TeamClient.TeamClientError>,
    ) => Effect.Effect<A, IntegrationError>;
    readonly withImportToHost: <A>(
      hostId: string,
      action: (
        imports: NonNullable<TeamClient.Session["agentImport"]>,
      ) => Effect.Effect<A, TeamClient.TeamClientError>,
    ) => Effect.Effect<A, IntegrationError>;
    readonly withPrivilegedToHost: <A>(
      hostId: string,
      action: (
        transport: NonNullable<TeamClient.Session["privileged"]>,
      ) => Effect.Effect<A, TeamClient.TeamClientError>,
    ) => Effect.Effect<A, IntegrationError>;
    readonly withFilesToHost: <A>(
      hostId: string,
      action: (files: TeamClient.Session["files"]) => Effect.Effect<A, TeamClient.TeamClientError>,
    ) => Effect.Effect<A, IntegrationError>;
    readonly withChannelToHost: <A>(
      hostId: string,
      action: (
        channel: NonNullable<TeamClient.Session["channel"]>,
        identity: { readonly hostId: string; readonly fingerprint: string },
      ) => Effect.Effect<A, TeamClient.TeamClientError>,
    ) => Effect.Effect<A, IntegrationError>;
    readonly withComputerToHost: (
      hostId: string,
    ) => Effect.Effect<ComputerSession, IntegrationError>;
    readonly withBrowserToHost: <A>(
      hostId: string,
      action: (
        browser: NonNullable<TeamClient.Session["browser"]>,
      ) => Effect.Effect<A, TeamClient.TeamClientError>,
    ) => Effect.Effect<A, IntegrationError>;
    readonly liveVoiceCommand?: (
      principal: string,
      command: OpenbotLiveVoiceCommand,
    ) => Effect.Effect<OpenbotLiveVoiceResult, IntegrationError>;
    readonly apiRead: (
      input: OpenbotReadRequest,
    ) => Effect.Effect<typeof OpenbotApiResponse.Type, IntegrationError>;
    readonly apiReadToHost: (
      hostId: string,
      input: OpenbotReadRequest,
    ) => Effect.Effect<typeof OpenbotApiResponse.Type, IntegrationError>;
    readonly apiWrite: (
      input: OpenbotWriteRequest,
    ) => Effect.Effect<typeof OpenbotApiResponse.Type, IntegrationError>;
    readonly apiWriteToHost: (
      hostId: string,
      input: OpenbotWriteRequest,
    ) => Effect.Effect<typeof OpenbotApiResponse.Type, IntegrationError>;
    readonly apiAdminToHost: (
      hostId: string,
      input: OpenbotAdminRequest,
    ) => Effect.Effect<typeof OpenbotApiResponse.Type, IntegrationError>;
    readonly apiAdmin: (
      input: OpenbotAdminRequest,
    ) => Effect.Effect<typeof OpenbotApiResponse.Type, IntegrationError>;
  }
>()("t3/openbot/Integration") {}

const isIntegrationError = Schema.is(IntegrationError);
const isTeamClientError = Schema.is(TeamClient.TeamClientError);

const make = Effect.fn("OpenbotIntegration.make")(function* (ownerSecret: string | undefined) {
  const host = yield* ManagedHost.ManagedHost;
  const client = yield* TeamClient.TeamClient;
  const webhookRouting = yield* ConnectWebhookRouting.ConnectWebhookRouting;
  const recovery = Option.getOrUndefined(yield* Effect.serviceOption(HostRecovery.HostRecovery));
  const installation = Option.getOrUndefined(
    yield* Effect.serviceOption(RuntimeInstallation.RuntimeInstallation),
  );
  const environment = yield* HostProcess.Environment;
  const platform = `${yield* HostProcess.Platform}-${yield* HostProcess.Architecture}`;
  const status = Effect.gen(function* () {
    const value = yield* host.getStatus;
    return {
      state: value.status,
      ...(value.status === "ready" ? { hostId: value.ready.serverId } : {}),
      ...(value.status === "failed" ? { reason: value.reason } : {}),
      ...(recovery ? yield* recovery.getState : {}),
    };
  });
  const scope = yield* Effect.scope;
  const gate = yield* Semaphore.make(1);
  const eventChanges = yield* ChangeJournal.make();
  let attention: OpenbotAttentionSnapshot = {
    hostId: null,
    state: "disconnected",
    complete: false,
    requests: [],
  };
  let contexts = new Map<string, OpenbotContextState>();
  const contextKey = (agentId: string, threadId: string) =>
    `${agentId.length}:${agentId}${threadId}`;
  const changes = yield* PubSub.unbounded<string | null>();
  const readyHostId = host.getStatus.pipe(
    Effect.map((value) => (value.status === "ready" ? value.ready.serverId : null)),
  );
  const readyChanges = Stream.unwrap(
    Effect.gen(function* () {
      const subscription = yield* PubSub.subscribe(changes);
      const current = yield* readyHostId;
      return Stream.concat(Stream.make(current), Stream.fromSubscription(subscription));
    }),
  ).pipe(Stream.changes);
  let connection: { readonly key: string; readonly session: TeamClient.Session } | undefined;
  type ActiveVoice = {
    principal: string;
    hostId: string;
    session: TeamClient.Session;
    sessionId: string;
    expiresAt: number;
    ended: boolean;
    failed: boolean;
    user: string;
    assistant: string;
  };
  let voice: ActiveVoice | null = null;
  const VOICE_LEASE_MS = 15_000;
  const stopVoice = Effect.fn("OpenbotIntegration.stopVoice")(function* (owned: ActiveVoice) {
    if (voice !== owned) return;
    if (!owned.ended) yield* owned.session.liveVoice?.stop(owned.sessionId) ?? Effect.void;
    voice = null;
  }, Effect.withTracerEnabled(false));
  const clearConnection = Effect.fn("OpenbotIntegration.clearConnection")(function* () {
    const previous = connection;
    const activeVoice = voice;
    if (activeVoice) yield* stopVoice(activeVoice).pipe(Effect.ignore);
    voice = null;
    const changed = previous !== undefined || attention.state !== "disconnected";
    connection = undefined;
    attention = { hostId: null, state: "disconnected", complete: false, requests: [] };
    contexts.clear();
    // Refused reads against an already stopped host must not invalidate themselves.
    if (changed) yield* eventChanges.publish({ hostId: null, resource: "all" });
    if (previous) yield* previous.session.close.pipe(Effect.ignore);
  });
  yield* Effect.addFinalizer(() => gate.withPermit(clearConnection()));
  const start = Effect.gen(function* () {
    yield* gate.withPermit(
      Effect.gen(function* () {
        if ((yield* host.getStatus).status !== "ready") yield* clearConnection();
      }),
    );
    const started = yield* recovery ? recovery.start : host.start;
    yield* PubSub.publish(changes, started.serverId);
    return yield* status;
  }).pipe(
    Effect.mapError(
      (cause) =>
        new IntegrationError({
          message: "Unable to start the configured Openbot host.",
          cause,
        }),
    ),
  );
  const stop = Effect.gen(function* () {
    if (recovery) yield* recovery.stopWithCleanup(gate.withPermit(clearConnection()));
    else yield* gate.withPermit(clearConnection().pipe(Effect.andThen(host.stop)));
    yield* PubSub.publish(changes, null);
    return yield* status;
  }).pipe(
    Effect.mapError(
      (cause) =>
        new IntegrationError({
          message: "Unable to finish stopping the bot engine; check its saved startup preference.",
          cause,
        }),
    ),
  );
  const initializedSessions = new WeakSet<TeamClient.Session>();
  const readyAction = Effect.fn("OpenbotIntegration.readyAction")(function* <A>(
    session: TeamClient.Session,
    action: (session: TeamClient.Session) => Effect.Effect<A, TeamClient.TeamClientError>,
    initializes: boolean,
  ) {
    if (!initializedSessions.has(session) && !initializes) {
      // In v0.60 only the roster endpoint waits for provider initialization.
      yield* session.listAgents;
      initializedSessions.add(session);
    }
    const result = yield* action(session);
    if (initializes) initializedSessions.add(session);
    return result;
  });
  const withSession = <A>(
    action: (
      session: TeamClient.Session,
      identity: { readonly hostId: string; readonly fingerprint: string },
    ) => Effect.Effect<A, TeamClient.TeamClientError>,
    message: string,
    expectedHostId?: string,
    initializes = false,
  ) =>
    gate
      .withPermit(
        Effect.gen(function* () {
          const current = yield* host.getStatus;
          if (
            current.status !== "ready" ||
            ownerSecret === undefined ||
            (expectedHostId !== undefined && current.ready.serverId !== expectedHostId)
          ) {
            yield* clearConnection();
            return yield* new IntegrationError({
              message: "The Openbot host is not ready.",
              cause: new Error("not-ready"),
            });
          }
          const key = `${current.ready.serverId}:${current.ready.fingerprint}:${current.ready.apiUrl}`;
          if (connection?.key !== key) {
            yield* clearConnection();
            attention = {
              hostId: current.ready.serverId,
              state: "connecting",
              complete: false,
              requests: [],
            };
            yield* eventChanges.publish({
              hostId: current.ready.serverId,
              resource: "all",
            });
            const session = yield* client.connect({ apiUrl: current.ready.apiUrl, ownerSecret });
            connection = { key, session };
          }
          const active = connection;
          if (!active) return yield* Effect.die("Openbot session was not established");
          const runAction = (session: TeamClient.Session) =>
            action(session, {
              hostId: current.ready.serverId,
              fingerprint: current.ready.fingerprint,
            });
          return yield* readyAction(active.session, runAction, initializes).pipe(
            Effect.catch((error) =>
              Effect.gen(function* () {
                // Expiry/revocation needs a new login; normal reads reuse the session to respect upstream limits.
                if (error.reason !== "http" || error.status !== 401) return yield* error;
                yield* clearConnection();
                attention = {
                  hostId: current.ready.serverId,
                  state: "connecting",
                  complete: false,
                  requests: [],
                };
                yield* eventChanges.publish({
                  hostId: current.ready.serverId,
                  resource: "all",
                });
                const session = yield* client.connect({
                  apiUrl: current.ready.apiUrl,
                  ownerSecret,
                });
                connection = { key, session };
                return yield* readyAction(session, runAction, initializes);
              }),
            ),
          );
        }),
      )
      .pipe(
        Effect.mapError((cause) =>
          isIntegrationError(cause)
            ? cause
            : new IntegrationError({
                message:
                  isTeamClientError(cause) && cause.publicCode === "host_account_required"
                    ? "Sign in to OpenBot on this host to browse the Marketplace."
                    : message,
                cause,
              }),
        ),
      );
  let watching = false;
  const watch = readyChanges.pipe(
    Stream.switchMap((hostId) => {
      if (hostId === null) return Stream.empty;
      return Stream.unwrap(
        withSession(
          (session) => session.listAgents.pipe(Effect.as(session)),
          "Unable to connect Openbot events.",
          hostId,
          true,
        ).pipe(
          Effect.map((session) =>
            session.events.pipe(
              Stream.tap((frame) =>
                gate.withPermit(
                  Effect.gen(function* () {
                    // A closed/replaced session may still have queued frames from its previous host.
                    if (connection?.session !== session) return;
                    const current = yield* readyHostId;
                    if (current !== hostId) return;
                    if (frame.type === "live-voice") {
                      if (
                        !voice ||
                        voice.session !== session ||
                        voice.sessionId !== frame.event.sessionId
                      )
                        return;
                      if (frame.event._tag === "transcript")
                        voice[frame.event.role] = frame.event.text;
                      else {
                        voice.ended = true;
                        voice.failed = frame.event.error !== null;
                      }
                      return;
                    }
                    if (frame.type === "snapshot") {
                      attention = {
                        hostId,
                        state: "ready",
                        complete: frame.complete,
                        requests: frame.requests,
                      };
                      const next = new Map(
                        (frame.contexts ?? []).map((state) => [
                          contextKey(state.botId, state.threadId),
                          state,
                        ]),
                      );
                      const changed = new Set<string>();
                      for (const [key, state] of contexts) {
                        if (!next.has(key)) changed.add(state.botId);
                      }
                      for (const [key, state] of next) {
                        const previous = contexts.get(key);
                        if (!previous || !sameContext(previous, state)) changed.add(state.botId);
                      }
                      contexts = next;
                      for (const agentId of changed)
                        yield* eventChanges.publish({ hostId, resource: "activity", agentId });
                    }
                    yield* eventChanges.publish(
                      frame.type === "snapshot"
                        ? { hostId, resource: "attention" }
                        : {
                            hostId,
                            resource: frame.resource,
                            ...(frame.agentId ? { agentId: frame.agentId } : {}),
                            ...(frame.taskId ? { taskId: frame.taskId } : {}),
                          },
                    );
                  }),
                ),
              ),
              Stream.tapError(() =>
                gate.withPermit(
                  Effect.gen(function* () {
                    if (connection?.session !== session) return;
                    if (voice?.session === session) {
                      voice.ended = true;
                      voice.failed = true;
                    }
                    attention = { hostId, state: "connecting", complete: false, requests: [] };
                    contexts.clear();
                    yield* eventChanges.publish({ hostId, resource: "all" });
                  }),
                ),
              ),
            ),
          ),
        ),
      ).pipe(Stream.retry(Schedule.spaced("1 second")));
    }),
    Stream.runDrain,
  );
  const ensureEventsStarted = Effect.fn("OpenbotIntegration.ensureEventsStarted")(function* () {
    if (watching) return;
    watching = true;
    const hostId = yield* readyHostId;
    attention = {
      hostId,
      state: hostId === null ? "disconnected" : "connecting",
      complete: false,
      requests: [],
    };
    yield* Effect.forkIn(watch, scope);
  }, Effect.uninterruptible);
  const voiceUnavailable = () =>
    new IntegrationError({
      message: "The voice session is unavailable. Reconnect to the bot computer and try again.",
      cause: new Error("live-voice-unavailable"),
    });
  const liveVoiceCommand = Effect.fn("OpenbotIntegration.liveVoiceCommand")(function* (
    principal: string,
    command: OpenbotLiveVoiceCommand,
  ): Effect.fn.Return<OpenbotLiveVoiceResult, IntegrationError> {
    if (command.action === "start") {
      if ((yield* readyHostId) !== command.hostId) return yield* voiceUnavailable();
      yield* ensureEventsStarted();
      const owned = yield* withSession(
        (session) =>
          Effect.gen(function* () {
            if (voice?.ended) voice = null;
            if (voice || !session.liveVoice || attention.state !== "ready")
              return yield* new TeamClient.TeamClientError({ reason: "invalid-configuration" });
            const compatibility = yield* session.apiRead({ operation: "compatibility.read" });
            if (
              typeof compatibility !== "object" ||
              compatibility === null ||
              !("capabilities" in compatibility) ||
              !Array.isArray(compatibility.capabilities) ||
              !compatibility.capabilities.includes(OPENBOT_LIVE_VOICE_CAPABILITY)
            )
              return yield* new TeamClient.TeamClientError({ reason: "invalid-configuration" });
            const answer = yield* session.liveVoice.start(command.offer);
            const active: ActiveVoice = {
              principal,
              hostId: command.hostId,
              session,
              sessionId: answer.sessionId,
              expiresAt: (yield* Clock.currentTimeMillis) + VOICE_LEASE_MS,
              ended: false,
              failed: false,
              user: "",
              assistant: "",
            };
            voice = active;
            return { active, answer };
          }),
        "Could not start a live voice call on this bot computer.",
        command.hostId,
      );
      yield* Effect.forkIn(
        Effect.gen(function* () {
          while (voice === owned.active) {
            yield* Effect.sleep("3 seconds");
            yield* gate.withPermit(
              Effect.gen(function* () {
                if (
                  voice !== owned.active ||
                  (yield* Clock.currentTimeMillis) <= owned.active.expiresAt
                )
                  return;
                yield* stopVoice(owned.active).pipe(Effect.ignore);
              }),
            );
          }
        }),
        scope,
      );
      return { _tag: "started", answer: owned.answer };
    }
    return yield* gate.withPermit(
      Effect.gen(function* (): Effect.fn.Return<OpenbotLiveVoiceResult, IntegrationError> {
        const active = voice;
        if (
          !active ||
          active.principal !== principal ||
          active.hostId !== command.hostId ||
          active.sessionId !== command.sessionId ||
          connection?.session !== active.session
        )
          return yield* voiceUnavailable();
        if (command.action === "stop") {
          yield* stopVoice(active).pipe(Effect.mapError(() => voiceUnavailable()));
          return { _tag: "stopped" };
        }
        active.expiresAt = (yield* Clock.currentTimeMillis) + VOICE_LEASE_MS;
        return {
          _tag: "state",
          user: active.user,
          assistant: active.assistant,
          ended: active.ended,
          failed: active.failed,
        };
      }),
    );
  }, Effect.withTracerEnabled(false));
  const attentionSnapshot = ensureEventsStarted().pipe(
    Effect.andThen(Effect.sync(() => attention)),
  );
  const subscribeChanges = Stream.unwrap(
    Effect.gen(function* () {
      const subscription = yield* PubSub.subscribe(eventChanges.events);
      yield* ensureEventsStarted();
      const hostId = yield* readyHostId;
      return Stream.concat(
        Stream.make({ hostId, resource: "all" as const }),
        Stream.fromSubscription(subscription),
      );
    }),
  );
  const listAgents = withSession(
    (session) => session.listAgents,
    "Unable to read the Openbot agent roster.",
    undefined,
    true,
  );
  const readContext = (
    input: Extract<OpenbotReadRequest, { operation: "context.read" }>,
    expectedHost?: string,
  ) =>
    gate.withPermit(
      Effect.gen(function* () {
        const current = yield* host.getStatus;
        const ready = current.status === "ready" ? current.ready : null;
        if (expectedHost && expectedHost !== ready?.serverId)
          return yield* new IntegrationError({
            message: "Unable to read the expected Openbot host.",
            cause: new Error("host-mismatch"),
          });
        if (!ready || connection?.key !== `${ready.serverId}:${ready.fingerprint}:${ready.apiUrl}`)
          return null;
        return contexts.get(contextKey(input.agentId, input.threadId)) ?? null;
      }),
    );
  const isLibraryPictureMime = Schema.is(OpenbotLibraryPictureMime);
  const libraryPicture = Effect.fn("OpenbotIntegration.libraryPicture")(function* (
    session: TeamClient.Session,
    input: OpenbotLibraryPreviewRequest,
  ) {
    const source = {
      kind: "library" as const,
      fileId: input.fileId,
      ...(input.conversationId ? { conversationId: input.conversationId } : {}),
    };
    const metadata = yield* session.files.attachment(null, source);
    const { mimeType, size } = metadata;
    if (!isLibraryPictureMime(mimeType) || size <= 0 || size > OPENBOT_LIBRARY_PREVIEW_LIMIT)
      return null;
    const result = yield* session.files.download(null, source);
    if (
      result.size !== size ||
      (result.mimeType !== mimeType && result.mimeType !== "application/octet-stream")
    )
      return yield* new TeamClient.TeamClientError({ reason: "decode" });
    const bytes = new Uint8Array(size);
    let offset = 0;
    yield* result.body.pipe(
      Stream.runForEach((chunk) => {
        if (offset + chunk.length > size)
          return Effect.fail(new TeamClient.TeamClientError({ reason: "decode" }));
        bytes.set(chunk, offset);
        offset += chunk.length;
        return Effect.void;
      }),
    );
    if (offset !== size) return yield* new TeamClient.TeamClientError({ reason: "decode" });
    return { mimeType, base64: Base64.encode(bytes) };
  });
  const apiRead = (input: OpenbotReadRequest, expectedHostId?: string) =>
    input.operation === "context.read"
      ? readContext(input, expectedHostId)
      : withSession(
          (session) =>
            input.operation === "library.files.preview"
              ? libraryPicture(session, input)
              : session.apiRead(input),
          "Unable to read Openbot data.",
          expectedHostId,
        );
  const apiReadToHost = (hostId: string, input: OpenbotReadRequest) => apiRead(input, hostId);
  const apiWrite = (input: OpenbotWriteRequest) =>
    withSession((session) => session.apiWrite(input), "Unable to update Openbot work.");
  const apiWriteToHost = (hostId: string, input: OpenbotWriteRequest) =>
    withSession(
      (session) => session.apiWrite(input),
      "Unable to update the expected Openbot host.",
      hostId,
    );
  const isBrowserNavigation = (input: OpenbotAdminRequest) =>
    input.operation === "browser.open" ||
    input.operation === "browser.load" ||
    input.operation === "browser.navigate" ||
    input.operation === "browser.reload";
  const browserNavigation = Effect.fn("OpenbotIntegration.browserNavigation")(function* (
    input: OpenbotAdminRequest,
    expectedHostId?: string,
  ) {
    const message = "Unable to navigate the expected bot browser.";
    const captured = yield* withSession(
      (session) => Effect.succeed({ session, key: connection?.key }),
      message,
      expectedHostId,
    );
    // Loading may wait on the page; Stop and loading events must still acquire the session gate.
    const result = yield* captured.session
      .apiAdmin(input)
      .pipe(Effect.mapError((cause) => new IntegrationError({ message, cause })));
    return yield* gate.withPermit(
      Effect.gen(function* () {
        const current = yield* host.getStatus;
        if (
          connection?.session !== captured.session ||
          current.status !== "ready" ||
          captured.key !==
            `${current.ready.serverId}:${current.ready.fingerprint}:${current.ready.apiUrl}`
        )
          return yield* new IntegrationError({
            message: "The bot browser connection changed while navigating.",
            cause: new Error("session-replaced"),
          });
        return result;
      }),
    );
  });
  const admin = Effect.fn("Integration.admin")(function* (
    session: TeamClient.Session,
    hostId: string,
    input: OpenbotAdminRequest,
  ) {
    if (input.operation === "workflow.webhookConfiguration") {
      const compatibility = yield* session.apiRead({ operation: "compatibility.read" });
      const capabilities =
        compatibility && typeof compatibility === "object" && "capabilities" in compatibility
          ? compatibility.capabilities
          : null;
      if (
        !webhookRouting ||
        !Array.isArray(capabilities) ||
        !capabilities.includes("sled-connect-workflow-webhooks-v1")
      )
        return yield* new TeamClient.TeamClientError({ reason: "invalid-configuration" });
      const result = yield* session.apiAdmin(input);
      const { routeId } = yield* decodeWorkflowWebhookRoute(result).pipe(
        Effect.mapError((cause) => new TeamClient.TeamClientError({ reason: "decode", cause })),
      );
      return {
        workflowId: input.workflowId,
        nodeId: input.nodeId,
        configured: routeId !== null,
        webhookUrl: routeId === null ? null : yield* webhookRouting.address(hostId, routeId),
        relayService: "sled-connect",
      };
    }
    if (
      input.operation === "events.configuration" &&
      input.owner.kind === "agent" &&
      webhookRouting &&
      session.connectWebhooks
    ) {
      const compatibility = yield* session.apiRead({ operation: "compatibility.read" });
      const capabilities =
        compatibility !== null &&
        typeof compatibility === "object" &&
        "capabilities" in compatibility
          ? compatibility.capabilities
          : null;
      if (Array.isArray(capabilities) && capabilities.includes("sled-connect-webhooks-v1")) {
        const { routeId } = yield* session.connectWebhooks.configuration({
          owner: { kind: "agent", id: input.owner.id },
          id: input.id,
        });
        const webhookUrl = yield* webhookRouting.address(hostId, routeId);
        return { owner: input.owner, id: input.id, webhookUrl, relayService: "sled-connect" };
      }
    }
    return yield* session.apiAdmin(input);
  });
  const apiAdminToHost = (hostId: string, input: OpenbotAdminRequest) =>
    isBrowserNavigation(input)
      ? browserNavigation(input, hostId)
      : withSession(
          (session, identity) => admin(session, identity.hostId, input),
          "Unable to configure the expected Openbot host.",
          hostId,
        );
  const apiAdmin = (input: OpenbotAdminRequest) =>
    isBrowserNavigation(input)
      ? browserNavigation(input)
      : withSession(
          (session, identity) => admin(session, identity.hostId, input),
          "Unable to configure Openbot.",
        );
  const switchRuntime = Effect.fn("OpenbotIntegration.switchRuntime")(
    function* (runtime: OpenbotInstalledRuntime) {
      if (!installation || !ownerSecret || environment.T3CODE_OPENBOT_EXECUTABLE?.trim())
        return yield* new IntegrationError({
          message: "Runtime activation is unavailable while an executable override is configured.",
          cause: new Error("runtime-override"),
        });
      if (
        (runtime.compatibility !== "pinned-baseline" && runtime.compatibility !== "validated") ||
        runtime.platform !== platform
      )
        return yield* new IntegrationError({
          message: "This runtime requires compatibility validation on this host before activation.",
          cause: new Error("runtime-compatibility"),
        });
      const previous = (yield* installation.getStatus).active;
      let committed = false;
      const restorePrevious = Effect.gen(function* () {
        yield* clearConnection();
        const desired = recovery ? (yield* recovery.getState).desiredRunning : true;
        yield* host
          .switchExecutable(
            resolveRuntimeExecutable({
              installed: previous?.executablePath,
              bundled: environment.T3CODE_BUNDLED_OPENBOT_EXECUTABLE,
            }).executablePath ?? null,
            { start: desired },
          )
          .pipe(Effect.ignore);
        yield* PubSub.publish(changes, yield* readyHostId);
      });
      return yield* Effect.uninterruptibleMask((restore) =>
        restore(
          Effect.gen(function* () {
            yield* clearConnection();
            yield* PubSub.publish(changes, null);
            const started = yield* host.switchExecutable(runtime.executablePath);
            if (!started) return yield* new ManagedHost.ManagedHostError({ reason: "readiness" });
            const session = yield* client.connect({ apiUrl: started.apiUrl, ownerSecret });
            connection = {
              key: `${started.serverId}:${started.fingerprint}:${started.apiUrl}`,
              session,
            };
            yield* session.listAgents;
            initializedSessions.add(session);
          }),
        ).pipe(
          Effect.andThen(installation.select(runtime)),
          Effect.tap(() =>
            Effect.sync(() => {
              committed = true;
            }),
          ),
          Effect.andThen(Effect.flatMap(readyHostId, (hostId) => PubSub.publish(changes, hostId))),
          Effect.andThen(status),
          Effect.onExit((exit) =>
            Exit.isSuccess(exit) || committed ? Effect.void : restorePrevious,
          ),
        ),
      );
    },
    Effect.mapError((cause) =>
      isIntegrationError(cause)
        ? cause
        : new IntegrationError({
            message:
              "Unable to activate the installed bot runtime; the prior selection was retained.",
            cause,
          }),
    ),
  );
  const activateRuntime = Effect.fn("OpenbotIntegration.activateRuntime")(
    function* (input: OpenbotUpstreamInstallInput) {
      if (!installation)
        return yield* new IntegrationError({
          message: "Bot runtime installation is unavailable.",
          cause: new Error("runtime-unavailable"),
        });
      return yield* switchRuntime(yield* installation.resolve(input));
    },
    Effect.mapError((cause) =>
      isIntegrationError(cause)
        ? cause
        : new IntegrationError({ message: "Unable to resolve the installed bot runtime.", cause }),
    ),
    gate.withPermits(1),
  );
  const rollbackRuntime = gate
    .withPermit(
      Effect.gen(function* () {
        if (!installation)
          return yield* new IntegrationError({
            message: "Bot runtime installation is unavailable.",
            cause: new Error("runtime-unavailable"),
          });
        const previous = (yield* installation.getStatus).previous;
        if (!previous)
          return yield* new IntegrationError({
            message: "No previous bot runtime is available.",
            cause: new Error("runtime-no-previous"),
          });
        return yield* switchRuntime(yield* installation.resolve(previous));
      }),
    )
    .pipe(
      Effect.mapError((cause) =>
        isIntegrationError(cause)
          ? cause
          : new IntegrationError({ message: "Unable to restore the previous bot runtime.", cause }),
      ),
    );
  const lifecycle = recovery
    ? Stream.merge(
        host.changes.pipe(Stream.map(() => undefined)),
        recovery.changes.pipe(Stream.map(() => undefined)),
      )
    : host.changes.pipe(Stream.map(() => undefined));
  yield* lifecycle.pipe(
    Stream.runForEach(() =>
      Effect.gen(function* () {
        const hostId = yield* readyHostId;
        yield* PubSub.publish(changes, hostId);
        yield* eventChanges.publish({ hostId, resource: "all" });
        if (hostId === null)
          yield* gate.withPermit(
            Effect.gen(function* () {
              if ((yield* readyHostId) === null) yield* clearConnection();
            }),
          );
      }),
    ),
    Effect.forkIn(scope),
  );
  return Integration.of({
    receiveConnectWebhook: Effect.fn("Integration.receiveConnectWebhook")(function* (input) {
      const target = webhookRouting?.target(input.hookId, input.token);
      if (!target) return { status: 404 };
      const { hookId: _hookId, token: _token, ...delivery } = input;
      return yield* withSession(
        (session) =>
          session.connectWebhooks
            ? session.connectWebhooks.receive({ ...delivery, routeId: target.routeId })
            : Effect.succeed({ status: 503 }),
        "Sled Connect could not reach this bot host.",
        target.hostId,
      );
    }),
    status,
    readyHostId,
    readyChanges,
    subscribeChanges,
    attentionSnapshot,
    start,
    stop,
    activateRuntime: Effect.fn("OpenbotIntegration.activateRuntimeSupervised")((input) =>
      recovery
        ? recovery
            .withRuntimeSwitch(activateRuntime(input))
            .pipe(
              Effect.mapError((cause) =>
                isIntegrationError(cause)
                  ? cause
                  : new IntegrationError({ message: "Bot runtime switching was stopped.", cause }),
              ),
            )
        : activateRuntime(input),
    ),
    rollbackRuntime: recovery
      ? recovery
          .withRuntimeSwitch(rollbackRuntime)
          .pipe(
            Effect.mapError((cause) =>
              isIntegrationError(cause)
                ? cause
                : new IntegrationError({ message: "Bot runtime rollback was stopped.", cause }),
            ),
          )
      : rollbackRuntime,
    listAgents,
    liveVoiceCommand,
    apiRead,
    apiReadToHost,
    withInstanceTransferToHost: Effect.fn("Integration.withInstanceTransferToHost")(
      (hostId, action) =>
        withSession(
          (session) =>
            session.instanceTransfer
              ? action(session.instanceTransfer)
              : Effect.fail(new TeamClient.TeamClientError({ reason: "invalid-configuration" })),
          "Server transfer is unavailable on this host.",
          hostId,
        ),
    ),
    withImportToHost: Effect.fn("Integration.withImportToHost")((hostId, action) =>
      withSession(
        (session) =>
          session.agentImport
            ? action(session.agentImport)
            : Effect.fail(new TeamClient.TeamClientError({ reason: "invalid-configuration" })),
        "This bot host does not support durable import.",
        hostId,
      ),
    ),
    withPrivilegedToHost: Effect.fn("OpenbotIntegration.withPrivilegedToHost")(
      (hostId, action) =>
        withSession(
          (session) =>
            session.privileged
              ? action(session.privileged)
              : Effect.fail(new TeamClient.TeamClientError({ reason: "invalid-configuration" })),
          "Secure response unavailable.",
          hostId,
        ),
      Effect.withTracerEnabled(false),
    ),
    withFilesToHost: Effect.fn("OpenbotIntegration.withFilesToHost")(
      <A>(
        hostId: string,
        action: (
          files: TeamClient.Session["files"],
        ) => Effect.Effect<A, TeamClient.TeamClientError>,
      ) => withSession((session) => action(session.files), "Unable to transfer bot files.", hostId),
    ),
    withChannelToHost: Effect.fn("OpenbotIntegration.withChannelToHost")(
      <A>(
        hostId: string,
        action: (
          channel: NonNullable<TeamClient.Session["channel"]>,
          identity: { readonly hostId: string; readonly fingerprint: string },
        ) => Effect.Effect<A, TeamClient.TeamClientError>,
      ) =>
        withSession(
          (session, identity) =>
            session.channel
              ? action(session.channel, identity)
              : Effect.fail(new TeamClient.TeamClientError({ reason: "invalid-configuration" })),
          "The expected bot host does not support channel coding.",
          hostId,
        ),
    ),
    withComputerToHost: Effect.fn("OpenbotIntegration.withComputerToHost")((hostId: string) =>
      withSession(
        (session) =>
          session.computer
            ? Effect.tryPromise({
                try: session.computer,
                catch: (cause) =>
                  isTeamClientError(cause)
                    ? cause
                    : new TeamClient.TeamClientError({ reason: "transport", cause }),
              })
            : Effect.fail(new TeamClient.TeamClientError({ reason: "closed" })),
        "Unable to open computer viewer.",
        hostId,
      ),
    ),
    withBrowserToHost: Effect.fn("OpenbotIntegration.withBrowserToHost")(
      <A>(
        hostId: string,
        action: (
          browser: NonNullable<TeamClient.Session["browser"]>,
        ) => Effect.Effect<A, TeamClient.TeamClientError>,
      ) =>
        withSession(
          (session) =>
            session.browser
              ? action(session.browser)
              : Effect.fail(new TeamClient.TeamClientError({ reason: "closed" })),
          "Unable to open bot browser.",
          hostId,
        ),
    ),
    apiWrite,
    apiWriteToHost,
    apiAdminToHost,
    apiAdmin,
  });
});

export const layerWithHost = (ownerSecret: string | undefined) =>
  Layer.effect(Integration, make(ownerSecret));

// An override wins; otherwise this home uses only the runtime whose activation was committed.
export const layer = Layer.unwrap(
  Effect.gen(function* () {
    const environment = yield* HostProcess.Environment;
    const override = environment.T3CODE_OPENBOT_EXECUTABLE?.trim();
    const installation = yield* RuntimeInstallation.RuntimeInstallation;
    const selected = yield* installation.getStatus.pipe(
      Effect.flatMap((state) =>
        state.active ? installation.resolve(state.active) : Effect.succeed(null),
      ),
      Effect.orElseSucceed(() => null),
    );
    const executable = resolveRuntimeExecutable({
      override,
      installed: selected?.executablePath,
      bundled: environment.T3CODE_BUNDLED_OPENBOT_EXECUTABLE,
    });
    const config = yield* ServerConfig.ServerConfig;
    const path = yield* Path.Path;
    const secrets = yield* ServerSecretStore.ServerSecretStore;
    const ownerSecret = Base64.encode(yield* secrets.getOrCreateRandom("openbot-owner", 32));
    const hostConfig: ManagedHost.ManagedHostConfig = {
      ...(executable.executablePath === undefined
        ? {}
        : { executablePath: executable.executablePath }),
      allowExecutableSwitch: executable.allowExecutableSwitch,
      userDataDirectory: path.join(config.stateDir, "openbot", "profile"),
      agentRoot: path.join(config.stateDir, "openbot", "agents"),
      serverName: "Sled bots",
      sledEnvironmentId: yield* (yield* ServerEnvironment.ServerEnvironment).getEnvironmentId,
      ownerSecret,
    };
    const managed =
      environment.T3CODE_OPENBOT_PRIVILEGED_PROOF === "1" ||
      Boolean(environment.T3CODE_OPENBOT_PRIVILEGED_OWNER_CONFIG)
        ? RetainedManagedHost.layer({
            host: hostConfig,
            activationConfigPath: environment.T3CODE_OPENBOT_PRIVILEGED_OWNER_CONFIG,
            authDatabase: config.dbPath,
            ownerDirectory: path.join(config.stateDir, "openbot", "privileged-owner"),
            controllerKey: Base64.encode(
              yield* secrets.getOrCreateRandom("openbot-privileged-owner", 32),
            ),
          })
        : ManagedHost.layer(hostConfig);
    return layerWithHost(ownerSecret).pipe(
      Layer.provide(Layer.succeed(RuntimeInstallation.RuntimeInstallation, installation)),
      Layer.provide(HostRecovery.layer.pipe(Layer.provide(managed))),
      Layer.provide(managed),
      Layer.provide(TeamClient.layer),
    );
  }),
);
