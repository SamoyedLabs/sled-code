import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/sql/SqlClient";
import * as TestClock from "effect/testing/TestClock";
import * as Sqlite from "../persistence/Sqlite.ts";
import * as Config from "../config.ts";
import * as ManagedHost from "./ManagedHost.ts";
import * as Recovery from "./HostRecovery.ts";

const ready: ManagedHost.HostReady = {
  serverId: "host",
  serverName: "Bots",
  apiUrl: "http://127.0.0.1:8080",
  fingerprint: "fp",
  publicKey: "key",
  ownerMemberId: "owner",
};
const harness = Effect.gen(function* () {
  let state: ManagedHost.HostStatus = { status: "stopped" };
  let count = 0;
  let fails = false;
  let block: Deferred.Deferred<void> | null = null;
  const starts = yield* Queue.unbounded<number>();
  const updates = yield* PubSub.unbounded<ManagedHost.HostStatus>();
  const set = (next: ManagedHost.HostStatus) =>
    Effect.sync(() => {
      state = next;
      PubSub.publishUnsafe(updates, next);
    });
  const stop = set({ status: "stopped" });
  const port: typeof ManagedHost.ManagedHost.Service = {
    getStatus: Effect.sync(() => state),
    changes: Stream.unwrap(
      Effect.gen(function* () {
        const sub = yield* PubSub.subscribe(updates);
        return Stream.concat(
          Stream.fromEffect(Effect.sync(() => state)),
          Stream.fromSubscription(sub),
        );
      }),
    ),
    start: Effect.gen(function* () {
      yield* set({ status: "starting" });
      yield* Queue.offer(starts, ++count);
      if (block) yield* Deferred.await(block);
      if (fails) {
        yield* set({ status: "failed", reason: "exited" });
        return yield* new ManagedHost.ManagedHostError({ reason: "exited" });
      }
      yield* set({ status: "ready", ready });
      return ready;
    }).pipe(Effect.onInterrupt(() => stop)),
    stop,
    switchExecutable: () => Effect.die("unused runtime adapter"),
  };
  return {
    port,
    starts,
    crash: set({ status: "failed", reason: "exited" }),
    count: () => count,
    fail: (value: boolean) => {
      fails = value;
    },
    block: (value: Deferred.Deferred<void>) => {
      block = value;
    },
  };
});
const application = Layer.mergeAll(
  Sqlite.layerMemory,
  Config.layerTest(process.cwd(), { prefix: "bot-recovery-" }),
).pipe(Layer.provideMerge(NodeServices.layer));
const waitFor = (
  service: typeof Recovery.HostRecovery.Service,
  state: Recovery.RecoveryState["recovery"]["state"],
) =>
  service.changes.pipe(
    Stream.filter((value) => value.recovery.state === state),
    Stream.runHead,
  );
const use = <A, E, R>(
  port: typeof ManagedHost.ManagedHost.Service,
  effect: Effect.Effect<A, E, R | Recovery.HostRecovery>,
) =>
  Effect.scoped(
    effect.pipe(
      Effect.provide(Recovery.layer),
      Effect.provideService(ManagedHost.ManagedHost, port),
    ),
  );

it.effect(
  "persists opt-in across service shutdown and keeps absent or explicitly stopped preferences manual",
  () =>
    Effect.gen(function* () {
      const h = yield* harness;
      yield* use(
        h.port,
        Effect.gen(function* () {
          const service = yield* Recovery.HostRecovery;
          expect((yield* service.getState).desiredRunning).toBe(false);
          expect(h.count()).toBe(0);
          expect(yield* service.start).toEqual(ready);
          expect((yield* service.getState).desiredRunning).toBe(true);
        }),
      );
      yield* use(
        h.port,
        Effect.gen(function* () {
          const service = yield* Recovery.HostRecovery;
          expect((yield* service.getState).desiredRunning).toBe(true);
          expect(yield* Queue.take(h.starts)).toBe(1);
          expect(yield* Queue.take(h.starts)).toBe(2);
          yield* waitFor(service, "running");
          yield* service.stop;
        }),
      );
      yield* use(
        h.port,
        Effect.gen(function* () {
          const service = yield* Recovery.HostRecovery;
          expect((yield* service.getState).desiredRunning).toBe(false);
          yield* TestClock.adjust("10 minutes");
          expect(h.count()).toBe(2);
        }),
      );
    }).pipe(Effect.provide(application)),
);

it.effect("explicit stop interrupts pending readiness and cancels future attempts", () =>
  Effect.gen(function* () {
    const h = yield* harness;
    h.block(yield* Deferred.make<void>());
    yield* use(
      h.port,
      Effect.gen(function* () {
        const service = yield* Recovery.HostRecovery;
        const pending = yield* service.start.pipe(Effect.forkChild);
        expect(yield* Queue.take(h.starts)).toBe(1);
        yield* service.stop;
        expect(Exit.isFailure(yield* Fiber.await(pending))).toBe(true);
        expect((yield* service.getState).desiredRunning).toBe(false);
        expect(yield* h.port.getStatus).toEqual({ status: "stopped" });
        yield* TestClock.adjust("10 minutes");
        expect(h.count()).toBe(1);
      }),
    );
  }).pipe(Effect.provide(application)),
);

it.effect("bounds crash loops and requires explicit retry after exhaustion", () =>
  Effect.gen(function* () {
    const h = yield* harness;
    h.fail(true);
    yield* use(
      h.port,
      Effect.gen(function* () {
        const service = yield* Recovery.HostRecovery;
        yield* Effect.flip(service.start);
        expect(yield* Queue.take(h.starts)).toBe(1);
        yield* waitFor(service, "backoff");
        for (const [index, delay] of [1000, 2000, 5000, 10000, 30000].entries()) {
          yield* TestClock.adjust(delay);
          expect(yield* Queue.take(h.starts)).toBe(index + 2);
          yield* waitFor(service, index === 4 ? "exhausted" : "backoff");
        }
        yield* TestClock.adjust("1 hour");
        expect(h.count()).toBe(6);
        h.fail(false);
        expect(yield* service.start).toEqual(ready);
        expect(yield* Queue.take(h.starts)).toBe(7);
        yield* h.crash;
        yield* waitFor(service, "backoff");
        yield* service.stop;
        yield* TestClock.adjust("1 hour");
        expect(h.count()).toBe(7);
      }),
    );
  }).pipe(Effect.provide(application)),
);

it.effect("stop during runtime switching prevents recovery from reviving the engine", () =>
  Effect.gen(function* () {
    const h = yield* harness;
    yield* use(
      h.port,
      Effect.gen(function* () {
        const service = yield* Recovery.HostRecovery;
        yield* service.start;
        const entered = yield* Deferred.make<void>();
        const switching = yield* service
          .withRuntimeSwitch(
            Deferred.succeed(entered, undefined).pipe(Effect.andThen(Effect.never)),
          )
          .pipe(Effect.forkChild);
        yield* Deferred.await(entered);
        expect((yield* Effect.flip(service.start)).reason).toBe("stopped");
        yield* service.stop;
        expect(Exit.isFailure(yield* Fiber.await(switching))).toBe(true);
        expect((yield* service.getState).desiredRunning).toBe(false);
        yield* TestClock.adjust("1 hour");
        expect(h.count()).toBe(1);
      }),
    );
  }).pipe(Effect.provide(application)),
);

it.effect("reports durable preference failure without claiming the requested state was saved", () =>
  Effect.gen(function* () {
    const h = yield* harness;
    yield* use(
      h.port,
      Effect.gen(function* () {
        const service = yield* Recovery.HostRecovery;
        const sql = yield* SqlClient.SqlClient;
        yield* sql`CREATE TRIGGER refuse_host_preference BEFORE INSERT ON openbot_host_preference BEGIN SELECT RAISE(FAIL,'fixture'); END`;
        expect((yield* Effect.flip(service.start)).reason).toBe("preference");
        expect(h.count()).toBe(0);
        expect((yield* service.getState).recovery.state).toBe("preference-error");
      }),
    );
  }).pipe(Effect.provide(application)),
);

it.effect("a later explicit start returns current readiness after automatic recovery", () =>
  Effect.gen(function* () {
    const h = yield* harness;
    h.fail(true);
    yield* use(
      h.port,
      Effect.gen(function* () {
        const service = yield* Recovery.HostRecovery;
        yield* Effect.flip(service.start);
        yield* Queue.take(h.starts);
        yield* waitFor(service, "backoff");
        h.fail(false);
        yield* TestClock.adjust(1000);
        expect(yield* Queue.take(h.starts)).toBe(2);
        yield* waitFor(service, "running");
        expect(yield* service.start).toEqual(ready);
      }),
    );
  }).pipe(Effect.provide(application)),
);

it.effect("stops the owned child even when authenticated-session cleanup defects", () =>
  Effect.gen(function* () {
    const h = yield* harness;
    yield* use(
      h.port,
      Effect.gen(function* () {
        const service = yield* Recovery.HostRecovery;
        yield* service.start;
        expect(
          Exit.isFailure(
            yield* service.stopWithCleanup(Effect.die("fixture cleanup fault")).pipe(Effect.exit),
          ),
        ).toBe(true);
        expect(yield* h.port.getStatus).toEqual({ status: "stopped" });
        expect((yield* service.getState).desiredRunning).toBe(false);
      }),
    );
  }).pipe(Effect.provide(application)),
);

it.effect("resets its crash budget only after a stable ready interval", () =>
  Effect.gen(function* () {
    const h = yield* harness;
    h.fail(true);
    yield* use(
      h.port,
      Effect.gen(function* () {
        const service = yield* Recovery.HostRecovery;
        yield* Effect.flip(service.start);
        yield* Queue.take(h.starts);
        yield* waitFor(service, "backoff");
        h.fail(false);
        yield* TestClock.adjust(1000);
        expect(yield* Queue.take(h.starts)).toBe(2);
        yield* waitFor(service, "running");
        yield* TestClock.adjust(60000);
        yield* service.changes.pipe(
          Stream.filter(
            (value) => value.recovery.state === "running" && value.recovery.attempt === 0,
          ),
          Stream.runHead,
        );
        yield* h.crash;
        yield* waitFor(service, "backoff");
        yield* TestClock.adjust(1000);
        expect(yield* Queue.take(h.starts)).toBe(3);
        yield* service.stop;
      }),
    );
  }).pipe(Effect.provide(application)),
);
