import * as NodeAssert from "node:assert/strict";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { Effect } from "effect";
import { ChannelService } from "../src/backend/channel-service.ts";
import { ChannelCodingRuntime } from "../src/backend/channel-coding-runtime.ts";
import { OpenBotDatabase } from "../src/backend/openbot-database.ts";

// Actual maintained runtime, service, store and SQLite. Only the outbound HTTP peer is replaced.
const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "openbot-coding-refusal-"));
let database = new OpenBotDatabase(root);
await Effect.runPromise(database.initialize());
const hooks = {
  agents: () => [],
  generate: () => Effect.die("Unexpected model call"),
  schedule: () => {},
  interrupt: () => Effect.die("Unexpected interruption"),
  busy: () => true,
  changed: () => {},
  error: () => {},
};
let service = new ChannelService(database, {}, {}, hooks);
let runtime = new ChannelCodingRuntime(service);
const run = (effect) => Effect.runPromise(effect);
const servers = [
  { id: "sled", enabled: true, transport: "http", url: "http://127.0.0.1:1/mcp", headers: [] },
];
const intent = { title: "Owned coding", prompt: "Owned request" };
const actors = new Map();
function seed(id) {
  const channel = service.store.create(id, {
    name: id,
    title: id,
    instructions: "",
    members: [{ agentId: id }],
    leadAgentId: null,
  });
  service.store.update(channel, {
    messages: [
      {
        id,
        channelId: id,
        sequence: 0,
        author: { kind: "member", id: "routine:owned", name: "Owned" },
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
        resources: [],
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
        pendingRevision: null,
        pendingOutcome: null,
        awaitedTaskIds: [],
        resources: [],
      },
    ],
  });
  const actor = { agentId: id, turnId: id, threadId: service.store.context(id, id).threadId };
  actors.set(id, actor);
  return actor;
}
const assignment = (id) => service.store.assignments(id)[0];
const refused = () =>
  new Response(null, { status: 403, headers: { "x-sled-coding-outcome": "refused" } });
const realFetch = globalThis.fetch;
try {
  runtime.configure("sled");
  globalThis.fetch = async () => refused();
  await NodeAssert.rejects(run(runtime.launch(seed("refused"), intent, servers)), /refused/);
  await run(service.complete("refused", "refused", "completed"));
  NodeAssert.equal(
    assignment("refused").state,
    "completed",
    "definite refusal must not leave an active reservation until deadline",
  );
  NodeAssert.equal(
    assignment("refused").coding.result,
    null,
    "refusal must not fabricate a coding result",
  );
  service.store.rebuild("refused");
  NodeAssert.equal(assignment("refused").coding.attestation.refused, true);

  for (const id of ["lost", "unmarked-403", "server-500", "bad-json"]) {
    globalThis.fetch = async () => {
      if (id === "lost") throw new TypeError("Lost response after possible acceptance");
      return id === "bad-json"
        ? new Response("invalid", { status: 200 })
        : new Response(null, { status: id === "server-500" ? 500 : 403 });
    };
    await NodeAssert.rejects(run(runtime.launch(seed(id), intent, servers)));
    await run(service.complete(id, id, "completed"));
    NodeAssert.equal(assignment(id).state, "running", `${id} must retain uncertain acceptance`);
  }
  await run(service.stop());
  database.close();
  database = new OpenBotDatabase(root);
  await run(database.initialize());
  service = new ChannelService(database, {}, {}, hooks);
  runtime = new ChannelCodingRuntime(service);
  globalThis.fetch = async () => refused();
  for (const id of ["lost", "unmarked-403", "server-500", "bad-json"]) {
    await NodeAssert.rejects(run(runtime.launch(actors.get(id), intent, servers)), /refused/);
    NodeAssert.equal(
      assignment(id).state,
      "running",
      "later refusal must not erase earlier ambiguous acceptance after restart",
    );
    NodeAssert.notEqual(assignment(id).coding.attestation.refused, true);
  }
  console.log(
    "PASS actual ChannelCodingRuntime + ChannelService + SQLite: definitive refusal releases; unmarked/transport/5xx/malformed receipt preserve uncertainty across restart",
  );
} finally {
  globalThis.fetch = realFetch;
  await run(service.stop());
  database.close();
  NodeFS.rmSync(root, { recursive: true, force: true });
}
