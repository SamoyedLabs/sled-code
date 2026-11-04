import * as NodeAssert from "node:assert/strict";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { Effect } from "effect";
import { ChannelService } from "../src/backend/channel-service.ts";
import { OpenBotDatabase } from "../src/backend/openbot-database.ts";

const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "openbot-channel-origin-"));
let database = new OpenBotDatabase(root);
await Effect.runPromise(database.initialize());
const hooks = {
  agents: () => [],
  generate: () => Effect.die("Unexpected model call"),
  schedule: () => {},
  interrupt: () => Effect.die("Unexpected provider interruption"),
  busy: () => true,
  changed: () => {},
  error: () => {},
};
let service = new ChannelService(database, {}, {}, hooks);
const command = {
  type: "send",
  channelId: "channel",
  operationId: "operation",
  text: "request",
  recipientAgentId: null,
  replyToMessageId: null,
  attachmentDraftIds: [],
};
const actor = { id: "owner", name: "Owner" };
const ref = "a".repeat(64);
const run = (effect) => Effect.runPromise(effect);
try {
  service.store.update(
    service.store.create("channel", {
      name: "Channel",
      title: "Channel",
      instructions: "",
      members: [],
      leadAgentId: null,
    }),
    {},
  );
  const receipt = await run(service.sendAttributed(command, actor, ref));
  NodeAssert.equal(receipt.messageId, `sled-origin-${ref}`);
  NodeAssert.equal(
    service.store.messages("channel").filter((m) => m.id === receipt.messageId).length,
    1,
  );
  NodeAssert.equal(service.store.tasks("channel")[0].requestMessageId, receipt.messageId);
  NodeAssert.deepEqual(await run(service.sendAttributed(command, actor, ref)), receipt);
  NodeAssert.equal(
    service.store.messages("channel").filter((m) => m.id === receipt.messageId).length,
    1,
  );
  await NodeAssert.rejects(
    run(service.sendAttributed({ ...command, text: "changed" }, actor, ref)),
  );
  await NodeAssert.rejects(
    run(service.sendAttributed(command, { id: "other", name: "Other" }, ref)),
  );
  await NodeAssert.rejects(run(service.sendAttributed(command, actor, "b".repeat(64))));
  service.store.rebuild("channel");
  NodeAssert.deepEqual(await run(service.sendAttributed(command, actor, ref)), receipt);
  await run(service.stop());
  database.close();
  database = new OpenBotDatabase(root);
  await run(database.initialize());
  service = new ChannelService(database, {}, {}, hooks);
  NodeAssert.deepEqual(await run(service.sendAttributed(command, actor, ref)), receipt);
  const second = await run(
    service.sendAttributed(
      { ...command, operationId: "second", text: "continue" },
      actor,
      "c".repeat(64),
    ),
  );
  NodeAssert.notEqual(second.messageId, receipt.messageId);
  NodeAssert.deepEqual(await run(service.sendAttributed(command, actor, ref)), receipt);
  const update = service.store.update.bind(service.store);
  service.store.update = () => {
    throw new Error("Injected failure before atomic commit");
  };
  await NodeAssert.rejects(
    run(service.sendAttributed({ ...command, operationId: "third" }, actor, "d".repeat(64))),
  );
  service.store.update = update;
  NodeAssert.equal(service.store.message("channel", `sled-origin-${"d".repeat(64)}`), null);
  const recovered = await run(
    service.sendAttributed({ ...command, operationId: "third" }, actor, "d".repeat(64)),
  );
  NodeAssert.equal(
    service.store.messages("channel").filter((m) => m.id === recovered.messageId).length,
    1,
  );
  process.stdout.write(
    "PASS actual ChannelService attributable send, immutable retries, continuation, SQLite restart and event replay\n",
  );
} finally {
  await run(service.stop());
  database.close();
  NodeFS.rmSync(root, { recursive: true, force: true });
}
