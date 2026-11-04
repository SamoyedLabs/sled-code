import * as NodeAssert from "node:assert/strict";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { Effect } from "effect";
import { TestClock } from "effect/testing";
import { ChannelService } from "../src/backend/channel-service.ts";
import { OpenBotDatabase } from "../src/backend/openbot-database.ts";

// Runs in patched upstream scripts/, against its actual class, store and SQLite event log.
const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "openbot-coding-idle-"));
const start = Date.now();
const errors = [];
const scheduled = [];
let database = new OpenBotDatabase(root);
await Effect.runPromise(database.initialize());
const hooks = {
  agents: () => [],
  generate: () => Effect.die("Unexpected model call"),
  schedule: (id) => scheduled.push(id),
  interrupt: () => Effect.die("Unexpected provider interruption"),
  busy: () => true,
  changed: () => {},
  error: (error) => errors.push(error),
};
const makeService = () => new ChannelService(database, {}, {}, hooks);
let service = makeService();
const state = (id) => service.store.assignments(id)[0].state;
const taskState = (id) => service.store.tasks(id)[0].state;
function seed(id, expiresAt, completed = true, pendingRevision = null) {
  const channel = service.store.create(id, {
    name: id,
    title: id,
    instructions: "",
    members: [{ agentId: id }],
    leadAgentId: null,
  });
  const binding = {
    channelId: id,
    taskId: id,
    taskRevision: 1,
    assignmentId: id,
    agentId: id,
    turnId: id,
    requestMessageId: id,
    requesterId: "person",
    operationId: id,
  };
  service.store.update(channel, {
    messages: [
      {
        id,
        channelId: id,
        sequence: 0,
        author: { kind: "member", id: "person", name: "Person" },
        taskId: id,
        superseded: false,
        message: {
          id,
          author: "user",
          text: "Request",
          createdAt: new Date().toISOString(),
          status: "completed",
        },
      },
    ],
    tasks: [
      {
        id,
        channelId: id,
        rootTaskId: id,
        parentTaskId: null,
        ownerAgentId: id,
        requestMessageId: id,
        instruction: "Work",
        attachmentDraftIds: [],
        expectedResult: "Result",
        sourceMessageIds: [],
        dependencies: [],
        resources: ["host"],
        state: "running",
        revision: 1,
        assignmentCount: 1,
        error: null,
      },
    ],
    assignments: [
      {
        id,
        channelId: id,
        taskId: id,
        taskRevision: 1,
        agentId: id,
        turnId: id,
        requestMessageId: id,
        state: "running",
        deliveryId: null,
        throughSequence: 0,
        summaryVersion: 0,
        pendingRevision,
        pendingOutcome: null,
        awaitedTaskIds: [],
        resources: ["host"],
        coding: {
          binding,
          result: null,
          lease: { reservedAt: start, expiresAt: start + expiresAt, providerCompleted: completed },
        },
      },
    ],
  });
  return binding;
}
function change(id, update) {
  service.store.update(service.store.get(id), {
    assignments: [{ ...service.store.assignments(id)[0], ...update }],
  });
  service.publish(id);
}
const program = Effect.gen(function* () {
  yield* TestClock.setTime(start);
  seed("later", 2000);
  yield* service.wake();
  yield* TestClock.adjust(0);
  seed("earlier", 1000, true, 2);
  service.publish("earlier");
  yield* TestClock.adjust(999);
  NodeAssert.equal(state("earlier"), "running");
  yield* TestClock.adjust(1);
  NodeAssert.equal(
    state("earlier"),
    "interrupted",
    "idle expiry must release an ended provider, including pending steer",
  );
  NodeAssert.equal(taskState("earlier"), "paused");
  NodeAssert.equal(state("later"), "running");
  yield* TestClock.adjust(1000);
  NodeAssert.equal(state("later"), "interrupted", "must continue after expiry -> release -> wake");
  NodeAssert.deepEqual(scheduled.sort(), ["earlier", "later"]);

  seed("cancelled", 3000);
  seed("reassigned", 3500);
  seed("future", 4000);
  yield* service.wake();
  change("cancelled", { state: "interrupted" });
  change("reassigned", { state: "interrupted", agentId: "replacement" });
  yield* TestClock.adjust(1500);
  NodeAssert.equal(state("future"), "running");
  NodeAssert.equal(scheduled.length, 2, "removed leases must not release twice");
  yield* TestClock.adjust(500);
  NodeAssert.equal(state("future"), "interrupted");

  seed("stopped", 5000);
  yield* service.wake();
  yield* service.stop();
  yield* TestClock.adjust(2000);
  NodeAssert.equal(state("stopped"), "running", "scope stop must cancel the deadline");
  database.close();
  database = new OpenBotDatabase(root);
  yield* database.initialize();
  service = makeService();
  seed("pending", 8000);
  yield* service.recover();
  NodeAssert.equal(state("stopped"), "interrupted", "restart must settle expired persisted holds");
  NodeAssert.equal(state("pending"), "running", "restart must preserve a pending persisted hold");
  yield* TestClock.adjust(2000);
  NodeAssert.equal(state("pending"), "interrupted", "restart must reconstruct its deadline");

  const binding = seed("live", 9000, false);
  yield* service.wake();
  yield* TestClock.adjust(1000);
  NodeAssert.equal(state("live"), "running", "expiry does not claim to interrupt a live provider");
  const refusal = yield* Effect.result(
    service.coding(
      { agentId: "live", turnId: "live", requesterId: "person" },
      binding,
      "submit",
      "Late",
    ),
  );
  NodeAssert.equal(refusal._tag, "Failure");
  yield* service.complete("live", "live", "completed");
  NodeAssert.equal(state("live"), "interrupted");
  NodeAssert.equal(taskState("live"), "paused");
  yield* TestClock.adjust(10000);
  NodeAssert.equal(
    scheduled.filter((id) => id === "live").length,
    1,
    "expired live provider must not repeat",
  );
  NodeAssert.deepEqual(errors, []);

  seed("transient-expiry", 20000);
  yield* service.wake();
  service.publish("transient-expiry");
  const realUpdate = service.store.update.bind(service.store);
  let expiryFailures = 0;
  service.store.update = (channel, changes, ...rest) => {
    if (
      channel.id === "transient-expiry" &&
      changes?.assignments?.some((item) => item.state === "interrupted") &&
      expiryFailures === 0
    ) {
      expiryFailures++;
      throw new Error("Injected expiry transaction failure");
    }
    return realUpdate(channel, changes, ...rest);
  };
  yield* TestClock.adjust(1000);
  NodeAssert.equal(expiryFailures, 1);
  yield* TestClock.adjust(100);
  service.store.update = realUpdate;
  NodeAssert.equal(
    state("transient-expiry"),
    "interrupted",
    "transient expiry failure must retry while idle",
  );
  NodeAssert.equal(taskState("transient-expiry"), "paused");

  seed("exhausted-owner", 22000);
  const realIds = service.store.ids.bind(service.store);
  let scanFailures = 0;
  service.store.ids = () => {
    scanFailures++;
    throw new Error("Injected deadline scan failure");
  };
  service.publish("exhausted-owner");
  yield* TestClock.adjust(0);
  yield* TestClock.adjust(100);
  yield* TestClock.adjust(200);
  yield* TestClock.adjust(400);
  yield* TestClock.adjust(800);
  NodeAssert.equal(scanFailures, 4, "failure retry budget must be bounded");
  service.store.ids = realIds;
  seed("restarted-owner", 30000);
  yield* service.wake();
  yield* TestClock.adjust(8400);
  NodeAssert.equal(
    state("restarted-owner"),
    "interrupted",
    "wake must restart an exhausted deadline owner",
  );
  NodeAssert.equal(errors.length, 1, "exhausted failure must remain visible");
  yield* service.stop();
});
try {
  await Effect.runPromise(program.pipe(Effect.provide(TestClock.layer())));
  process.stdout.write(
    `${JSON.stringify({ passed: true, proof: "actual patched ChannelService + ChannelStore + SQLite + TestClock", scheduled })}\n`,
  );
} finally {
  await Effect.runPromise(service.stop());
  database.close();
  NodeFS.rmSync(root, { recursive: true, force: true });
}
