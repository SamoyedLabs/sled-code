import * as NodeAssert from "node:assert/strict";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { Effect } from "effect";
import { ChannelService } from "../src/backend/channel-service.ts";
import { OpenBotDatabase } from "../src/backend/openbot-database.ts";

// Actual maintained runtime, service, store and SQLite. Only the outbound HTTP peer is replaced.
const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "openbot-coding-refusal-"));
let database = new OpenBotDatabase(root);
await Effect.runPromise(database.initialize());
const delivered = [];
const hooks = {
  steer: (agentId, threadId, turnId, messageId, text) => Effect.sync(() => { delivered.push({agentId, threadId, turnId, messageId, text}); return "accepted"; }),
  agents: () => [], generate: () => Effect.die("Unexpected model call"),
  schedule: () => {}, interrupt: () => Effect.die("Unexpected interruption"),
  busy: () => true, changed: () => {}, error: () => {},
};
let service = new ChannelService(database, {}, {}, hooks);
const run = effect => Effect.runPromise(effect);
const actors = new Map();
function seed(id) {
  const channel = service.store.create(id, { name: id, title: id, instructions: "", members: [{ agentId: id }], leadAgentId: null });
  service.store.update(channel, {
    messages: [{ id, channelId: id, sequence: 0, author: { kind: "member", id: "routine:owned", name: "Owned" }, taskId: id, superseded: false,
      message: { id, author: "user", text: "Request", createdAt: new Date().toISOString(), status: "completed" } }],
    tasks: [{ id, channelId: id, rootTaskId: id, parentTaskId: null, ownerAgentId: id, requestMessageId: id, instruction: "Work", attachmentDraftIds: [], expectedResult: "Result", sourceMessageIds: [], dependencies: [], resources: [], state: "running", revision: 1, assignmentCount: 1, error: null }],
    assignments: [{ id, channelId: id, taskId: id, taskRevision: 1, agentId: id, turnId: id, requestMessageId: id, state: "running", deliveryId: null, throughSequence: 0, summaryVersion: 0, pendingRevision: null, pendingOutcome: null, awaitedTaskIds: [], resources: [] }],
  });
  const actor = { agentId: id, turnId: id, threadId: service.store.context(id, id).threadId };
  actors.set(id, actor);
  return actor;
}
const assignment = id => service.store.assignments(id)[0];

const binding = id => ({channelId:id, taskId:id, taskRevision:1, assignmentId:id, agentId:id, turnId:id, requestMessageId:id, requesterId:"routine:owned", operationId:"operation"});
const actor = id => ({agentId:id,turnId:id,requesterId:"routine:owned"});
const event = {eventId:"a".repeat(64),status:"needs_approval",updatedAt:"2026-11-04T19:30:00.000Z"};
try {
  seed("one"); seed("other");
  await run(service.coding(actor("one"), binding("one"), "bind"));
  const receipt = await run(service.codingProgress(actor("one"), binding("one"), event));
  NodeAssert.equal(receipt.delivery,"accepted");
  NodeAssert.equal(delivered.length,1);
  NodeAssert.equal(delivered[0].agentId,"one"); NodeAssert.equal(delivered[0].turnId,"one");
  NodeAssert.equal(delivered[0].threadId,service.store.context("one","one").threadId);
  NodeAssert.equal(assignment("one").state,"running"); NodeAssert.equal(assignment("one").coding.result,null);
  NodeAssert.equal(service.store.messages("one").filter(m => m.message.author === "assistant").length,0);
  await NodeAssert.rejects(run(service.codingProgress(actor("other"),binding("one"),event)),e => /authority/.test(String(e.cause)));
  await NodeAssert.rejects(run(service.codingProgress(actor("one"),binding("one"),{...event,status:"needs_input"})),e => /conflict/.test(String(e.cause)));
  hooks.steer = (...args) => Effect.sync(() => { delivered.push(args); throw new Error("response lost"); });
  const uncertain = {...event,eventId:"b".repeat(64),status:"needs_input"};
  NodeAssert.equal((await run(service.codingProgress(actor("one"),binding("one"),uncertain))).delivery,"uncertain");
  await run(service.stop()); database.close();
  database = new OpenBotDatabase(root); await run(database.initialize());
  service = new ChannelService(database, {}, {}, hooks);
  NodeAssert.deepEqual(await run(service.codingProgress(actor("one"),binding("one"),event)),receipt);
  NodeAssert.equal((await run(service.codingProgress(actor("one"),binding("one"),uncertain))).delivery,"uncertain");
  NodeAssert.equal(delivered.length,2,"no duplicate after SQLite reopen and ambiguous response");
  service.store.rebuild("one");
  NodeAssert.equal(assignment("one").coding.progress.length,2,"event journal replay preserves dedupe");
  const channel=service.store.get("one");
  service.store.update(channel,{tasks:service.store.tasks("one").map(t=>({...t,revision:2}))});
  await NodeAssert.rejects(run(service.codingProgress(actor("one"),binding("one"),event)),e => /stale/.test(String(e.cause)));
  NodeAssert.equal(delivered.length,2);
  console.log("PASS actual ChannelService + SQLite reopen: exact bot, nonterminal, stable receipt, ambiguous dedupe, conflict and stale refusal");
} finally { await run(service.stop()); database.close(); NodeFS.rmSync(root,{recursive:true,force:true}); }
