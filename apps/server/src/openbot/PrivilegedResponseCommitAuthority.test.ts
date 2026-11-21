import * as NodeSqlite from "node:sqlite";
import { validateUpstreamCommitOwnership } from "./PrivilegedUpstreamOwnership.ts";
import { describe, expect, it } from "@effect/vitest";
import { PrivilegedResponseCommitAuthority } from "./PrivilegedResponseCommitAuthority.ts";
const identity = {
  principal: "p",
  environmentId: "e",
  hostId: "h",
  engineIncarnation: "child-1",
  nonce: "n",
  target: {
    agentId: "a",
    threadId: "t",
    turnId: "u",
    messageId: "m",
    blockId: "b",
    requestId: "r",
  },
};
describe("privileged commit revocation ordering", () => {
  it("checks live authority and serializes revocation completion after a granted commit", async () => {
    let visible = true;
    const authority = new PrivilegedResponseCommitAuthority(() => {
      if (!visible) throw new Error("Unavailable");
    });
    visible = false;
    expect(() => authority.acquire(identity)).toThrow();
    visible = true;
    const permit = authority.acquire(identity);
    let revoked = false;
    const drain = authority.revoke(identity.principal).then(() => {
      revoked = true;
    });
    await Promise.resolve();
    expect(revoked).toBe(false);
    expect(() => authority.acquire({ ...identity, nonce: "other" })).toThrow();
    expect(() => authority.finish(permit, { ...identity, principal: "other" })).toThrow();
    authority.finish(permit, identity);
    await drain;
    expect(revoked).toBe(true);
    expect(() => authority.acquire(identity)).toThrow();
  });
  it("never releases an unknown effect by timeout, and only drains the exact exited child", async () => {
    const authority = new PrivilegedResponseCommitAuthority(() => {});
    authority.acquire(identity);
    let drained = false;
    const done = authority.revoke("p").then(() => {
      drained = true;
    });
    authority.engineExited("different-child");
    await Promise.resolve();
    expect(drained).toBe(false);
    authority.engineExited(identity.engineIncarnation);
    await done;
    expect(drained).toBe(true);
    expect(() =>
      authority.acquire({ ...identity, principal: "new-session", nonce: "new-request" }),
    ).toThrow();
  });
});

it("retained supervisor accepts current group ownership and rejects stale attempts or removed members", () => {
  using db = new NodeSqlite.DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE privileged_response_ownership(nonce TEXT, incarnation TEXT, state TEXT, agent_id TEXT, thread_id TEXT);
    CREATE TABLE projection_threads(thread_id TEXT, agent_id TEXT);
    CREATE TABLE projection_agents(agent_id TEXT, thread_id TEXT);
    CREATE TABLE projection_agent_threads(thread_id TEXT, agent_id TEXT);
    CREATE TABLE projection_channel_contexts(channel_id TEXT, agent_id TEXT, thread_id TEXT);
    CREATE TABLE projection_channels(channel_id TEXT, channel_json TEXT);
    INSERT INTO projection_agents VALUES ('a','main');
    INSERT INTO projection_threads VALUES ('main','a'),('task','a'),('group','a'),('foreign','b');
    INSERT INTO projection_agent_threads VALUES ('task','a');
    INSERT INTO projection_channel_contexts VALUES ('c','a','group');
    INSERT INTO projection_channels VALUES ('c','{"archived":false,"members":[{"agentId":"a"}]}');
    INSERT INTO privileged_response_ownership VALUES ('n','child','outstanding','a','group');
  `);
  const valid = () => validateUpstreamCommitOwnership(db, "a", "group", "n", "child");
  expect(valid()).toBe(true);
  for (const [agent, thread, nonce, incarnation] of [
    ["b", "group", "n", "child"],
    ["a", "foreign", "n", "child"],
    ["a", "group", "other", "child"],
    ["a", "group", "n", "other"],
  ])
    expect(validateUpstreamCommitOwnership(db, agent!, thread!, nonce!, incarnation!)).toBe(false);
  db.exec(`UPDATE projection_channels SET channel_json='{"archived":false,"members":[]}'`);
  expect(valid()).toBe(false);
  db.exec(
    `UPDATE projection_channels SET channel_json='{"archived":true,"members":[{"agentId":"a"}]}'`,
  );
  expect(valid()).toBe(false);
  db.exec(
    `UPDATE projection_channels SET channel_json='{"archived":false,"members":[{"agentId":"a"}]}'`,
  );
  db.exec("UPDATE privileged_response_ownership SET state='finished'");
  expect(valid()).toBe(false);
  for (const thread of ["main", "task"]) {
    db.prepare("UPDATE privileged_response_ownership SET state='outstanding', thread_id=?").run(
      thread,
    );
    expect(validateUpstreamCommitOwnership(db, "a", thread, "n", "child")).toBe(true);
  }
});
