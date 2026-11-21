import { expect, it } from "vite-plus/test";
import { workspaceRoute, workspaceResult } from "./routes";

it("routes browser actions through scoped services without exposing viewer session URLs", () => {
  expect(workspaceRoute("GET", "/v1/browser/tabs", {})).toEqual({
    kind: "admin",
    request: { operation: "browser.tabs" },
  });
  expect(
    workspaceRoute("POST", "/v1/browser/user-control/take", {
      tabId: "owned",
      operation: "browser.close",
    }),
  ).toEqual({ kind: "admin", request: { operation: "browser.take", tabId: "owned" } });
  expect(
    workspaceRoute("POST", "/v1/browser/stop", { tabId: "owned", operation: "browser.close" }),
  ).toEqual({
    kind: "admin",
    request: { operation: "browser.stop", tabId: "owned" },
  });
  const history = workspaceRoute("POST", "/v1/browser/page-state", {});
  expect(history).toEqual({
    kind: "admin",
    request: { operation: "browser.display" },
    projection: "browser-page-state",
  });
  expect(
    workspaceResult(history, {
      activeTabId: "owned",
      tabs: [
        {
          id: "owned",
          title: "Fixture",
          url: "https://owned.invalid",
          loading: false,
          ownerThreadId: null,
          ownerAgentId: null,
          canGoBack: true,
          canGoForward: false,
        },
      ],
    }),
  ).toEqual({ tabs: [{ tabId: "owned", canGoBack: true, canGoForward: false }] });
  expect(() => workspaceResult(history, { tabs: [{ id: "owned", canGoBack: "yes" }] })).toThrow();
  expect(() => workspaceRoute("POST", "/v1/browser/stop", {})).toThrow();
  expect(() =>
    workspaceRoute("POST", "/v1/browser/page-state", { tabId: "unrequested" }),
  ).toThrow();
  expect(() => workspaceRoute("POST", "/v1/browser/view/sessions", { tabId: "owned" })).toThrow();
  expect(() =>
    workspaceRoute("POST", "/v1/browser/load", { url: "http://owned.invalid" }),
  ).toThrow();
});

it("translates upstream paths into bounded host-bound operations", () => {
  expect(
    workspaceRoute("GET", "/v1/agents/bot%2Fone/conversation-page?before=opaque&limit=20", {}),
  ).toEqual({
    kind: "read",
    request: {
      operation: "conversation.page",
      agentId: "bot/one",
      limit: 20,
      anchor: { type: "before", cursor: "opaque" },
    },
  });
  expect(
    workspaceRoute("POST", "/v1/agent-tasks/read", {
      agentId: "agent",
      taskId: "task",
      operation: "task.delete",
    }),
  ).toEqual({
    kind: "read",
    request: { operation: "task.read", agentId: "agent", taskId: "task" },
  });
  expect(() => workspaceRoute("POST", "/v1/agent-tasks/send", { agentId: "agent" })).toThrow();
  expect(
    workspaceRoute("POST", "/v1/agent-threads/branch", {
      agentId: "agent",
      taskId: null,
      messageId: "finished-message",
      requestId: "original-branch",
      operation: "thread.delete",
    }),
  ).toEqual({
    kind: "write",
    request: {
      operation: "thread.branch",
      agentId: "agent",
      taskId: null,
      messageId: "finished-message",
      requestId: "original-branch",
    },
  });
  expect(() =>
    workspaceRoute("POST", "/v1/agent-threads/branch", {
      agentId: "agent",
      taskId: null,
      messageId: "finished-message",
    }),
  ).toThrow();
});
it("routes task replies without bypassing guarded original uploads", () => {
  const reply = {
    agentId: "agent",
    taskId: "task",
    text: "Reply",
    attachmentDraftIds: [],
    replyToMessageId: "original",
    clientMessageId: "once",
  };
  expect(
    workspaceRoute("POST", "/v1/agent-threads/send-reply", {
      ...reply,
      operation: "thread.delete",
    }),
  ).toEqual({ kind: "write", request: { ...reply, operation: "thread.reply" } });
  expect(() =>
    workspaceRoute("POST", "/v1/agent-threads/send-reply", {
      ...reply,
      attachmentDraftIds: ["unowned"],
    }),
  ).toThrow();
  expect(() =>
    workspaceRoute("POST", "/v1/agent-threads/send-reply", {
      ...reply,
      clientMessageId: undefined,
    }),
  ).toThrow();
});
it("binds upstream queue controls to the selected agent and keeps file edits guarded", () => {
  for (const [path, body, expected] of [
    ["queue/cancel", { deliveryId: "queued" }, { operation: "queue.cancel", deliveryId: "queued" }],
    [
      "queue/reorder",
      { deliveryIds: ["second", "first"] },
      { operation: "queue.reorder", deliveryIds: ["second", "first"] },
    ],
    [
      "queue/steer",
      { deliveryId: "queued", expectedTurnId: "running" },
      { operation: "queue.steer", deliveryId: "queued", expectedTurnId: "running" },
    ],
    [
      "failures/acknowledge",
      { turnId: "failed" },
      { operation: "queue.acknowledgeFailure", turnId: "failed" },
    ],
  ] as const) {
    expect(
      workspaceRoute("POST", `/v1/agents/bot%2Fone/${path}`, {
        ...body,
        agentId: "other",
        operation: "agent.delete",
      }),
    ).toEqual({ kind: "write", request: { ...expected, agentId: "bot/one" } });
  }
  expect(() =>
    workspaceRoute("POST", "/v1/agents/bot/queue/reorder", { deliveryIds: ["same", "same"] }),
  ).toThrow();
  expect(() =>
    workspaceRoute("POST", "/v1/agents/bot/queue/steer", { deliveryId: "queued" }),
  ).toThrow();
  expect(
    workspaceRoute("POST", "/v1/agents/bot/queue/edit", {
      action: "begin",
      deliveryId: "queued",
      editId: "edit",
    }),
  ).toEqual({
    kind: "write",
    request: {
      operation: "queue.edit",
      agentId: "bot",
      action: "begin",
      deliveryId: "queued",
      editId: "edit",
    },
  });
  expect(
    workspaceRoute("POST", "/v1/agents/bot/queue/edit", {
      action: "save",
      deliveryId: "queued",
      editId: "edit",
      text: "Updated",
      keepAttachmentIds: ["existing"],
      attachmentDraftIds: [],
    }),
  ).toMatchObject({
    kind: "write",
    request: {
      operation: "queue.edit",
      text: "Updated",
      keepAttachmentIds: ["existing"],
      attachmentDraftIds: [],
    },
  });
  for (const action of ["save", "retain-attachments"])
    expect(() =>
      workspaceRoute("POST", "/v1/agents/bot/queue/edit", {
        action,
        deliveryId: "queued",
        editId: "edit",
        text: "Updated",
        keepAttachmentIds: [],
        attachmentDraftIds: ["new-original-draft"],
      }),
    ).toThrow();
});

it("refuses arbitrary owner routes, origins, and unbound private responses", () => {
  for (const path of [
    "https://other.invalid/v1/agents",
    "//other.invalid/v1/agents",
    "/v1/auth/login",
    "/v1/prompts/respond",
    "/v1/sled-privileged-responses/respond",
    "/v1/attachments",
  ])
    expect(() => workspaceRoute("POST", path, {})).toThrow();
  expect(() => workspaceRoute("DELETE", "/v1/agents", {})).toThrow();
});
it("keeps released settings reads and mutations in their separate scoped RPC families", () => {
  expect(workspaceRoute("POST", "/v1/sidebar-folders", {}).kind).toBe("read");
  expect(() => workspaceRoute("POST", "/v1/agent-access/set", {})).toThrow();
});

it("binds agent settings, memory and routine controls to their existing scoped contracts", () => {
  expect(workspaceRoute("POST", "/v1/admin/agents/instructions", { agentId: "agent" })).toEqual({
    kind: "admin",
    request: { operation: "agent.instructions.read", agentId: "agent" },
  });
  expect(workspaceRoute("PATCH", "/v1/agents/agent", { name: "Renamed" })).toEqual({
    kind: "admin",
    request: { operation: "agent.update", agentId: "agent", input: { name: "Renamed" } },
  });
  expect(
    workspaceRoute("PATCH", "/v1/agents/agent/memories/memory", {
      text: "Remember this",
      agentId: "other",
    }),
  ).toEqual({
    kind: "admin",
    request: {
      operation: "memory.update",
      agentId: "agent",
      memoryId: "memory",
      text: "Remember this",
    },
  });
  expect(workspaceRoute("GET", "/v1/agents/agent/routines/routine/runs", {})).toEqual({
    kind: "read",
    request: { operation: "routine.runs", agentId: "agent", routineId: "routine" },
  });
  expect(workspaceRoute("POST", "/v1/agents/agent/routines/routine/test", {})).toEqual({
    kind: "write",
    request: { operation: "routine.test", agentId: "agent", routineId: "routine" },
  });
  expect(() =>
    workspaceRoute("PATCH", "/v1/agents/agent/memories/memory", { text: "x".repeat(501) }),
  ).toThrow();
});
it("projects accepted channel sends without replaying their mutation", () => {
  const route = workspaceRoute("POST", "/v1/channels/commands", {
    type: "send",
    channelId: "group",
    operationId: "original-send",
    text: "Owned group message",
    recipientAgentId: null,
    replyToMessageId: null,
    attachmentDraftIds: [],
  });
  const page = {
    channel: {
      id: "group",
      name: "Owned group",
      title: "",
      instructions: "",
      members: [{ agentId: "bot" }],
      leadAgentId: "bot",
      archived: false,
      revision: 12,
      createdAt: "2026-11-05T05:40:20.800Z",
    },
    messages: [],
    tasks: [],
    olderCursor: null,
    throughSequence: 1,
  };
  expect(workspaceResult(route, page)).toEqual(page.channel);
  expect(() =>
    workspaceResult(route, { ...page, channel: { ...page.channel, id: "other" } }),
  ).toThrow();
  expect(() => workspaceResult(route, { accepted: true })).toThrow();
  expect(
    workspaceResult(workspaceRoute("POST", "/v1/channels/read", { channelId: "group" }), page),
  ).toEqual(page);
});
it("keeps upstream group navigation and commands inside the existing channel contracts", () => {
  expect(workspaceRoute("GET", "/v1/channels", {})).toEqual({
    kind: "read",
    request: { operation: "channel.list" },
  });
  expect(
    workspaceRoute("POST", "/v1/channels/read", { channelId: "group", beforeSequence: 7 }),
  ).toEqual({
    kind: "read",
    request: { operation: "channel.read", channelId: "group", beforeSequence: 7 },
  });
  expect(
    workspaceRoute("POST", "/v1/channels/commands", {
      type: "read",
      channelId: "group",
      operationId: "read-one",
      throughSequence: 7,
    }),
  ).toEqual({
    kind: "admin",
    request: {
      operation: "channel.markRead",
      channelId: "group",
      operationId: "read-one",
      throughSequence: 7,
    },
  });
  expect(() =>
    workspaceRoute("POST", "/v1/channels/commands", { type: "grants", command: {} }),
  ).toThrow();
});

it("maps analytics to fixed reads and refuses unbounded query fields", () => {
  expect(
    workspaceRoute(
      "GET",
      "/v1/analytics?startDate=2026-11-01&endDate=2026-11-04&timeZone=America%2FChicago&agentId=agent&url=https%3A%2F%2Fother.invalid",
      {},
    ),
  ).toEqual({
    kind: "read",
    request: {
      operation: "workspace.analytics",
      startDate: "2026-11-01",
      endDate: "2026-11-04",
      timeZone: "America/Chicago",
      agentId: "agent",
    },
  });
  expect(
    workspaceRoute(
      "GET",
      "/v1/agents/agent/analytics?startDate=2026-11-01&endDate=2026-11-04&timeZone=UTC",
      {},
    ).request,
  ).toMatchObject({ operation: "agent.analytics", agentId: "agent" });
  expect(() => workspaceRoute("GET", "/v1/analytics?startDate=invalid", {})).toThrow();
  expect(() => workspaceRoute("POST", "/v1/analytics", {})).toThrow();
});

it("binds event activity and recovery actions to validated routine owners", () => {
  const owner = { kind: "agent", id: "owned-agent" };
  expect(
    workspaceRoute("POST", "/v1/admin/events/activity", {
      owner,
      routineId: "owned-routine",
      limit: 20,
      operation: "agent.delete",
    }),
  ).toEqual({
    kind: "admin",
    request: { operation: "events.activity", owner, routineId: "owned-routine", limit: 20 },
  });
  expect(
    workspaceRoute("POST", "/v1/admin/routine-recovery/routines/save", {
      owner,
      name: "Owned disabled fixture",
      instruction: "Never run",
      active: false,
      timezone: "UTC",
      trigger: { kind: "webhook", eventType: "owned.test", filters: [] },
      missedPolicy: "skip",
    }),
  ).toMatchObject({
    kind: "admin",
    request: { operation: "events.save", active: false, missedPolicy: "skip", owner },
  });
  expect(
    workspaceRoute("POST", "/v1/admin/webhook-tests/send", { owner, id: "owned-routine" }),
  ).toEqual({
    kind: "admin",
    request: { operation: "events.sendTest", owner, id: "owned-routine" },
  });
  for (const data of [
    { routineId: "owned" },
    { owner: { kind: "host", id: "owned" }, routineId: "owned" },
    { owner, routineId: "owned", limit: 101 },
  ])
    expect(() => workspaceRoute("POST", "/v1/admin/events/activity", data)).toThrow();
  expect(() =>
    workspaceRoute("GET", "/v1/admin/events/activity", { owner, routineId: "owned" }),
  ).toThrow();
  expect(() => workspaceRoute("POST", "/v1/admin/events/arbitrary", { owner })).toThrow();
});
