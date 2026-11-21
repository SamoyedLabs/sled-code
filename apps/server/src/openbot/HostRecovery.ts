import type { OpenbotHostStatus } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as PubSub from "effect/PubSub";
import * as Deferred from "effect/Deferred";
import * as Fiber from "effect/Fiber";
import * as Exit from "effect/Exit";
import * as DateTime from "effect/DateTime";
import * as Semaphore from "effect/Semaphore";
import * as SqlClient from "effect/sql/SqlClient";
import * as ManagedHost from "./ManagedHost.ts";

export type RecoveryState = {
  readonly desiredRunning: boolean;
  readonly recovery: NonNullable<OpenbotHostStatus["recovery"]>;
};
export class HostRecoveryError extends Schema.TaggedError<HostRecoveryError>()(
  "HostRecoveryError",
  {
    reason: Schema.Literals(["preference", "startup", "stopped"]),
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message() {
    return `The bot engine recovery operation failed (${this.reason}).`;
  }
}
export class HostRecovery extends Context.Service<
  HostRecovery,
  {
    readonly getState: Effect.Effect<RecoveryState>;
    readonly changes: Stream.Stream<RecoveryState>;
    readonly start: Effect.Effect<ManagedHost.HostReady, HostRecoveryError>;
    readonly stop: Effect.Effect<void, HostRecoveryError>;
    readonly stopWithCleanup: <R>(
      cleanup: Effect.Effect<void, never, R>,
    ) => Effect.Effect<void, HostRecoveryError, R>;
    readonly withRuntimeSwitch: <A, E, R>(
      effect: Effect.Effect<A, E, R>,
    ) => Effect.Effect<A, E | HostRecoveryError, R>;
  }
>()("t3/openbot/HostRecovery") {}

const DELAYS = [1000, 2000, 5000, 10000, 30000] as const;
const STABLE_MS = 60000;
const make = Effect.gen(function* () {
  const host = yield* ManagedHost.ManagedHost;
  const sql = yield* SqlClient.SqlClient;
  const scope = yield* Effect.scope;
  const control = yield* Semaphore.make(1);
  const events = yield* PubSub.unbounded<RecoveryState>();
  let desired = false;
  let closing = false;
  let paused = false;
  let epoch = 0;
  let worker: Fiber.Fiber<void> | null = null;
  let switching: Fiber.Fiber<unknown, unknown> | null = null;
  let response: Deferred.Deferred<ManagedHost.HostReady, HostRecoveryError> | null = null;
  let recovery: RecoveryState["recovery"] = { state: "idle", attempt: 0, retryAt: null };
  const snapshot = (): RecoveryState => ({ desiredRunning: desired, recovery });
  const update = (next: RecoveryState["recovery"]) =>
    Effect.sync(() => {
      recovery = next;
      PubSub.publishUnsafe(events, snapshot());
    });
  const changes = Stream.unwrap(
    Effect.gen(function* () {
      const subscription = yield* PubSub.subscribe(events);
      return Stream.concat(
        Stream.fromEffect(Effect.sync(snapshot)),
        Stream.fromSubscription(subscription),
      );
    }),
  );
  const persist = Effect.fn("HostRecovery.persist")(
    function* (value: boolean) {
      yield* sql`INSERT INTO openbot_host_preference (id,desired_running) VALUES (1,${value ? 1 : 0}) ON CONFLICT(id) DO UPDATE SET desired_running=excluded.desired_running`;
    },
    Effect.mapError((cause) => new HostRecoveryError({ reason: "preference", cause })),
  );
  const exited = host.changes.pipe(
    Stream.filter((state) => state.status !== "ready"),
    Stream.runHead,
  );
  const run = Effect.fn("HostRecovery.run")(function* (generation: number) {
    let failures = 0;
    while (true) {
      if (!desired || closing || paused || generation !== epoch) return;
      yield* update({ state: "starting", attempt: failures + 1, retryAt: null });
      const started = yield* host.start.pipe(Effect.result);
      if (generation !== epoch || !desired || closing || paused) return;
      if (started._tag === "Success") {
        if (response) yield* Deferred.succeed(response, started.success);
        yield* update({ state: "running", attempt: failures + 1, retryAt: null });
        const outcome = yield* Effect.race(
          exited.pipe(Effect.as("exited" as const)),
          Effect.sleep(STABLE_MS).pipe(Effect.as("stable" as const)),
        );
        if (outcome === "stable") {
          failures = 0;
          yield* update({ state: "running", attempt: 0, retryAt: null });
          yield* exited;
        }
      } else if (response) {
        yield* Deferred.fail(
          response,
          new HostRecoveryError({ reason: "startup", cause: started.failure }),
        );
      }
      if (generation !== epoch || !desired || closing || paused) return;
      failures++;
      const delay = DELAYS[failures - 1];
      if (delay === undefined) {
        yield* update({ state: "exhausted", attempt: failures, retryAt: null });
        return;
      }
      const now = yield* DateTime.now;
      yield* update({
        state: "backoff",
        attempt: failures + 1,
        retryAt: DateTime.formatIso(DateTime.addDuration(now, delay)),
      });
      yield* Effect.sleep(delay);
    }
  });
  const launch = Effect.fn("HostRecovery.launch")(function* () {
    if (worker || !desired || paused || closing) return;
    const generation = ++epoch;
    worker = yield* run(generation).pipe(
      Effect.onExit((exit) =>
        Effect.gen(function* () {
          if (generation !== epoch) return;
          worker = null;
          if (Exit.isFailure(exit) && !Exit.hasInterrupts(exit)) {
            yield* update({ state: "exhausted", attempt: recovery.attempt, retryAt: null });
            if (response)
              yield* Deferred.fail(
                response,
                new HostRecoveryError({ reason: "startup", cause: exit.cause }),
              );
          }
        }),
      ),
      Effect.forkIn(scope),
    );
  });
  const cancelWorker = Effect.fn("HostRecovery.cancelWorker")(function* () {
    epoch++;
    const active = worker;
    worker = null;
    if (active) yield* Fiber.interrupt(active);
  });
  const start = Effect.uninterruptibleMask((restore) =>
    Effect.gen(function* () {
      const waiting = yield* control.withPermit(
        Effect.gen(function* () {
          if (closing || paused) return yield* new HostRecoveryError({ reason: "stopped" });
          const saved = yield* persist(true).pipe(Effect.result);
          if (saved._tag === "Failure") {
            yield* update({ state: "preference-error", attempt: 0, retryAt: null });
            return yield* saved.failure;
          }
          desired = true;
          const current = yield* host.getStatus;
          if (current.status === "ready") {
            if (response) yield* Deferred.succeed(response, current.ready);
            response = yield* Deferred.make<ManagedHost.HostReady, HostRecoveryError>();
            yield* Deferred.succeed(response, current.ready);
            yield* launch();
            return response;
          }
          if (worker && recovery.state === "starting") {
            if (!response || (yield* Deferred.isDone(response)))
              response = yield* Deferred.make<ManagedHost.HostReady, HostRecoveryError>();
            return response;
          }
          yield* cancelWorker();
          response = yield* Deferred.make<ManagedHost.HostReady, HostRecoveryError>();
          yield* launch();
          return response;
        }),
      );
      return yield* restore(Deferred.await(waiting));
    }),
  );
  const stopWithCleanup = Effect.fn("HostRecovery.stopWithCleanup")(function* <R>(
    cleanup: Effect.Effect<void, never, R>,
  ) {
    return yield* control.withPermit(
      Effect.uninterruptible(
        Effect.gen(function* () {
          const saved = yield* persist(false).pipe(Effect.result);
          desired = false;
          if (response)
            yield* Deferred.fail(response, new HostRecoveryError({ reason: "stopped" }));
          yield* cancelWorker();
          const active = switching;
          switching = null;
          if (active) yield* Fiber.interrupt(active);
          yield* cleanup.pipe(
            Effect.ensuring(
              host.stop.pipe(
                Effect.andThen(
                  update({
                    state: saved._tag === "Failure" ? "preference-error" : "idle",
                    attempt: 0,
                    retryAt: null,
                  }),
                ),
              ),
            ),
          );
          if (saved._tag === "Failure") return yield* saved.failure;
        }),
      ),
    );
  });
  const stop = stopWithCleanup(Effect.void);
  const withRuntimeSwitch = Effect.fn("HostRecovery.withRuntimeSwitch")(function* <A, E, R>(
    effect: Effect.Effect<A, E, R>,
  ) {
    return yield* Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        const task = yield* control.withPermit(
          Effect.gen(function* () {
            if (closing || paused) return yield* new HostRecoveryError({ reason: "stopped" });
            paused = true;
            if (response)
              yield* Deferred.fail(response, new HostRecoveryError({ reason: "stopped" }));
            yield* cancelWorker();
            yield* update({ state: "switching", attempt: 0, retryAt: null });
            const task = yield* Effect.forkIn(restore(effect), scope);
            switching = task;
            return task;
          }),
        );
        return yield* restore(Fiber.join(task)).pipe(
          Effect.onInterrupt(() => Fiber.interrupt(task)),
          Effect.onExit(() =>
            control.withPermit(
              Effect.gen(function* () {
                if (switching === task) switching = null;
                paused = false;
                yield* update({ state: "idle", attempt: 0, retryAt: null });
                if (desired && !closing) {
                  response = yield* Deferred.make<ManagedHost.HostReady, HostRecoveryError>();
                  yield* launch();
                }
              }),
            ),
          ),
        );
      }),
    );
  });
  yield* Effect.addFinalizer(() =>
    control.withPermit(
      Effect.gen(function* () {
        closing = true;
        desired = false;
        if (response) yield* Deferred.fail(response, new HostRecoveryError({ reason: "stopped" }));
        yield* cancelWorker();
        if (switching) yield* Fiber.interrupt(switching);
        yield* host.stop;
      }),
    ),
  );
  const preference = yield* sql<{
    readonly desired_running: number;
  }>`SELECT desired_running FROM openbot_host_preference WHERE id=1`.pipe(Effect.result);
  if (preference._tag === "Failure")
    yield* update({ state: "preference-error", attempt: 0, retryAt: null });
  else if (preference.success[0]?.desired_running === 1) {
    desired = true;
    response = yield* Deferred.make<ManagedHost.HostReady, HostRecoveryError>();
    yield* launch();
  }
  return HostRecovery.of({
    getState: Effect.sync(snapshot),
    changes,
    start,
    stop,
    stopWithCleanup,
    withRuntimeSwitch,
  });
});
export const layer = Layer.effect(HostRecovery, make);
