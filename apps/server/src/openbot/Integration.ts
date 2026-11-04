import {
  type OpenbotAgentList,
  type OpenbotHostStatus,
  type OpenbotReadRequest,
  type OpenbotWriteRequest,
  type OpenbotAdminRequest,
  type OpenbotApiResponse,
  type OpenbotAttentionSnapshot,
  type OpenbotChange,
  type OpenbotUpstreamInstallInput,
  type OpenbotInstalledRuntime,
} from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Context from "effect/Context";
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
    readonly withFilesToHost: <A>(
      hostId: string,
      action: (files: TeamClient.Session["files"]) => Effect.Effect<A, TeamClient.TeamClientError>,
    ) => Effect.Effect<A, IntegrationError>;
    readonly withBrowserToHost: <A>(
      hostId: string,
      action: (
        browser: NonNullable<TeamClient.Session["browser"]>,
      ) => Effect.Effect<A, TeamClient.TeamClientError>,
    ) => Effect.Effect<A, IntegrationError>;
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

const make = Effect.fn("OpenbotIntegration.make")(function* (ownerSecret: string | undefined) {
  const host = yield* ManagedHost.ManagedHost;
  const client = yield* TeamClient.TeamClient;
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
  const eventChanges = yield* PubSub.sliding<OpenbotChange>(1);
  let attention: OpenbotAttentionSnapshot = {
    hostId: null,
    state: "disconnected",
    complete: false,
    requests: [],
  };
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
  const clearConnection = Effect.fn("OpenbotIntegration.clearConnection")(function* () {
    const previous = connection;
    connection = undefined;
    attention = { hostId: null, state: "disconnected", complete: false, requests: [] };
    yield* PubSub.publish(eventChanges, { hostId: null, resource: "all" });
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
    action: (session: TeamClient.Session) => Effect.Effect<A, TeamClient.TeamClientError>,
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
            yield* PubSub.publish(eventChanges, {
              hostId: current.ready.serverId,
              resource: "all",
            });
            const session = yield* client.connect({ apiUrl: current.ready.apiUrl, ownerSecret });
            connection = { key, session };
          }
          const active = connection;
          if (!active) return yield* Effect.die("Openbot session was not established");
          return yield* readyAction(active.session, action, initializes).pipe(
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
                yield* PubSub.publish(eventChanges, {
                  hostId: current.ready.serverId,
                  resource: "all",
                });
                const session = yield* client.connect({
                  apiUrl: current.ready.apiUrl,
                  ownerSecret,
                });
                connection = { key, session };
                return yield* readyAction(session, action, initializes);
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
                message,
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
                    if (frame.type === "snapshot")
                      attention = {
                        hostId,
                        state: "ready",
                        complete: frame.complete,
                        requests: frame.requests,
                      };
                    // A sliding notification may replace another resource, so invalidate the whole Openbot cache.
                    yield* PubSub.publish(eventChanges, { hostId, resource: "all" });
                  }),
                ),
              ),
              Stream.tapError(() =>
                gate.withPermit(
                  Effect.gen(function* () {
                    if (connection?.session !== session) return;
                    attention = { hostId, state: "connecting", complete: false, requests: [] };
                    yield* PubSub.publish(eventChanges, { hostId, resource: "all" });
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
  const attentionSnapshot = ensureEventsStarted().pipe(
    Effect.andThen(Effect.sync(() => attention)),
  );
  const subscribeChanges = Stream.unwrap(
    Effect.gen(function* () {
      const subscription = yield* PubSub.subscribe(eventChanges);
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
  const apiRead = (input: OpenbotReadRequest) =>
    withSession((session) => session.apiRead(input), "Unable to read Openbot data.");
  const apiReadToHost = (hostId: string, input: OpenbotReadRequest) =>
    withSession(
      (session) => session.apiRead(input),
      "Unable to read the expected Openbot host.",
      hostId,
    );
  const apiWrite = (input: OpenbotWriteRequest) =>
    withSession((session) => session.apiWrite(input), "Unable to update Openbot work.");
  const apiWriteToHost = (hostId: string, input: OpenbotWriteRequest) =>
    withSession(
      (session) => session.apiWrite(input),
      "Unable to update the expected Openbot host.",
      hostId,
    );
  const apiAdminToHost = (hostId: string, input: OpenbotAdminRequest) =>
    withSession(
      (session) => session.apiAdmin(input),
      "Unable to configure the expected Openbot host.",
      hostId,
    );
  const apiAdmin = (input: OpenbotAdminRequest) =>
    withSession((session) => session.apiAdmin(input), "Unable to configure Openbot.");
  const switchRuntime = Effect.fn("OpenbotIntegration.switchRuntime")(
    function* (runtime: OpenbotInstalledRuntime) {
      if (!installation || !ownerSecret || environment.T3CODE_OPENBOT_EXECUTABLE?.trim())
        return yield* new IntegrationError({
          message: "Runtime activation is unavailable while an executable override is configured.",
          cause: new Error("runtime-override"),
        });
      if (runtime.compatibility !== "pinned-baseline" || runtime.platform !== platform)
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
          .switchExecutable(previous?.executablePath ?? null, { start: desired })
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
        yield* PubSub.publish(eventChanges, { hostId, resource: "all" });
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
    apiRead,
    apiReadToHost,
    withFilesToHost: Effect.fn("OpenbotIntegration.withFilesToHost")(
      <A>(
        hostId: string,
        action: (
          files: TeamClient.Session["files"],
        ) => Effect.Effect<A, TeamClient.TeamClientError>,
      ) => withSession((session) => action(session.files), "Unable to transfer bot files.", hostId),
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
    const executablePath = override ?? selected?.executablePath;
    const config = yield* ServerConfig.ServerConfig;
    const path = yield* Path.Path;
    const secrets = yield* ServerSecretStore.ServerSecretStore;
    const ownerSecret = Base64.encode(yield* secrets.getOrCreateRandom("openbot-owner", 32));
    const hostConfig: ManagedHost.ManagedHostConfig = {
      ...(executablePath === undefined ? {} : { executablePath }),
      allowExecutableSwitch: !override,
      userDataDirectory: path.join(config.stateDir, "openbot", "profile"),
      agentRoot: path.join(config.stateDir, "openbot", "agents"),
      serverName: "Sled bots",
      ownerSecret,
    };
    const managed = ManagedHost.layer(hostConfig);
    return layerWithHost(ownerSecret).pipe(
      Layer.provide(Layer.succeed(RuntimeInstallation.RuntimeInstallation, installation)),
      Layer.provide(HostRecovery.layer.pipe(Layer.provide(managed))),
      Layer.provide(managed),
      Layer.provide(TeamClient.layer),
    );
  }),
);
