import { PINNED_SETTINGS } from "@t3tools/contracts/openbot-settings";
import {
  OpenbotChannelPage,
  OpenbotBrowserDisplay,
  OpenbotReadRequest,
  OpenbotWriteRequest,
  OpenbotAdminRequest,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";

const decodeRead = Schema.decodeUnknownSync(OpenbotReadRequest);
const decodeWrite = Schema.decodeUnknownSync(OpenbotWriteRequest);
const decodeAdmin = Schema.decodeUnknownSync(OpenbotAdminRequest);
const decodeChannelPage = Schema.decodeUnknownSync(OpenbotChannelPage);
const decodeBrowserDisplay = Schema.decodeUnknownSync(OpenbotBrowserDisplay);

const reads: Record<string, string> = {
  "/v1/identity": "workspace.identity",
  "/v1/me": "workspace.member",
  "/v1/compatibility": "compatibility.read",
  "/v1/agents": "agent.list",
  "/v1/channels": "channel.list",
  "/v1/agents/usage": "workspace.usage",
  "/v1/agents/models": "agent.models",
  "/v1/agents/status": "agent.status",
  "/v1/agents/conversation-reads": "workspace.reads",
  "/v1/sidebar-layout": "workspace.sidebar",
  "/v1/team/presence": "workspace.presence",
};
/** This is a closed translation into the existing authenticated RPC contracts, never a URL proxy. */
export function workspaceRoute(method: string, path: string, body: unknown) {
  const url = new URL(path, "https://sled.invalid");
  if (!path.startsWith("/v1/") || url.origin !== "https://sled.invalid" || url.hash)
    throw new Error("Unsupported workspace route");
  const data = typeof body === "object" && body !== null && !Array.isArray(body) ? body : {};
  const setting = PINNED_SETTINGS.find(
    (entry) =>
      entry.path === url.pathname && ("method" in entry ? entry.method : "POST") === method,
  );
  if (setting) {
    const input = { operation: setting.operation, parameters: data };
    return setting.kind === "read"
      ? { kind: "read" as const, request: decodeRead(input) }
      : { kind: "admin" as const, request: decodeAdmin(input) };
  }
  if (method === "POST" && url.pathname === "/v1/browser/page-state") {
    if (Object.keys(data).length) throw new Error("Invalid browser page state request");
    return {
      kind: "admin" as const,
      request: decodeAdmin({ operation: "browser.display" }),
      projection: "browser-page-state" as const,
    };
  }
  const eventRoutes: Record<string, string> = {
    "/v1/admin/events/status": "events.status",
    "/v1/admin/events/routines/list": "events.list",
    "/v1/admin/events/routines/save": "events.save",
    "/v1/admin/routine-recovery/routines/list": "events.list",
    "/v1/admin/routine-recovery/routines/save": "events.save",
    "/v1/admin/events/routines/delete": "events.delete",
    "/v1/admin/events/routines/test": "events.test",
    "/v1/admin/events/routines/rotate-secret": "events.rotateSecret",
    "/v1/admin/events/activity": "events.activity",
    "/v1/admin/routine-recovery/runs": "events.runs",
    "/v1/admin/webhook-tests/send": "events.sendTest",
  };
  if (method === "POST" && Object.hasOwn(eventRoutes, url.pathname))
    return {
      kind: "admin" as const,
      request: decodeAdmin({ ...data, operation: eventRoutes[url.pathname] }),
    };
  let read: unknown;
  let write: unknown;
  let admin: unknown;
  const browserRoutes: Record<string, string> = {
    "GET /v1/browser/display": "browser.display",
    "GET /v1/browser/tabs": "browser.tabs",
    "GET /v1/browser/control": "browser.control",
    "POST /v1/browser/open": "browser.open",
    "POST /v1/browser/activate": "browser.activate",
    "POST /v1/browser/navigate": "browser.navigate",
    "POST /v1/browser/load": "browser.load",
    "POST /v1/browser/reload": "browser.reload",
    "POST /v1/browser/stop": "browser.stop",
    "POST /v1/browser/close": "browser.close",
    "POST /v1/browser/preview": "browser.preview",
    "POST /v1/browser/user-control": "browser.held",
    "POST /v1/browser/user-control/take": "browser.take",
    "POST /v1/browser/user-control/release": "browser.release",
  };
  const browserOperation = browserRoutes[`${method} ${url.pathname}`];
  if (browserOperation) admin = { ...data, operation: browserOperation };
  const analytics = /^\/v1\/agents\/([^/]+)\/(analytics|usage)$/.exec(url.pathname);
  if (method === "GET" && (url.pathname === "/v1/analytics" || analytics?.[2] === "analytics")) {
    const agentId = analytics ? decodeURIComponent(analytics[1]!) : url.searchParams.get("agentId");
    read = {
      operation: analytics ? "agent.analytics" : "workspace.analytics",
      startDate: url.searchParams.get("startDate"),
      endDate: url.searchParams.get("endDate"),
      timeZone: url.searchParams.get("timeZone"),
      ...(agentId ? { agentId } : {}),
    };
  }
  if (method === "GET" && analytics?.[2] === "usage")
    read = { operation: "agent.usage", agentId: decodeURIComponent(analytics[1]!) };
  const channelPaths: Record<string, string> = {
    "/v1/channels/read": "channel.read",
    "/v1/channels/delete": "channel.delete",
    "/v1/channels/memories": "channel.memories",
    "/v1/channels/memories/create": "channel.memory.create",
    "/v1/channels/memories/update": "channel.memory.update",
    "/v1/channels/memories/delete": "channel.memory.delete",
    "/v1/channels/memories/clear": "channel.memory.clear",
    "/v1/channels/routines": "channel.routines",
    "/v1/channels/routines/create": "channel.routine.create",
    "/v1/channels/routines/update": "channel.routine.update",
    "/v1/channels/routines/delete": "channel.routine.delete",
    "/v1/channels/routines/test": "channel.routine.test",
    "/v1/channels/routines/runs": "channel.routine.runs",
  };
  if (method === "POST" && channelPaths[url.pathname]) {
    const operation = channelPaths[url.pathname]!;
    const input = { ...data, operation };
    if (
      ["channel.read", "channel.memories", "channel.routines", "channel.routine.runs"].includes(
        operation,
      )
    )
      read = input;
    else admin = input;
  }
  if (
    method === "POST" &&
    url.pathname === "/v1/channels/commands" &&
    "type" in data &&
    typeof data.type === "string"
  ) {
    const operations: Record<string, string> = {
      save: "channel.save",
      archive: "channel.archive",
      restore: "channel.restore",
      read: "channel.markRead",
      send: "channel.send",
      stop: "channel.stop",
      resume: "channel.resume",
      reassign: "channel.reassign",
      cancel: "channel.cancel",
    };
    const operation = operations[data.type];
    if (operation)
      admin = { ...(operation === "channel.save" ? { update: false } : {}), ...data, operation };
  }

  const agentSettings: Record<string, string> = {
    "/v1/admin/agents/settings": "agent.permissions.read",
    "/v1/admin/agents/settings/update": "agent.permissions.update",
    "/v1/admin/agents/instructions": "agent.instructions.read",
    "/v1/admin/agents/instructions/save": "agent.instructions.save",
  };
  if (method === "POST" && agentSettings[url.pathname])
    admin = { ...data, operation: agentSettings[url.pathname] };
  if (method === "POST" && url.pathname === "/v1/agents")
    admin = { operation: "agent.create", input: data };
  const profile = /^\/v1\/agents\/([^/]+)$/.exec(url.pathname);
  if (profile && method === "PATCH")
    admin = { operation: "agent.update", agentId: decodeURIComponent(profile[1]!), input: data };
  if (profile && method === "DELETE")
    admin = { operation: "agent.delete", agentId: decodeURIComponent(profile[1]!) };
  const resource =
    /^\/v1\/agents\/([^/]+)\/(memories|routines)(?:\/([^/]+)(?:\/(runs|test))?)?$/.exec(
      url.pathname,
    );
  if (resource) {
    const agentId = decodeURIComponent(resource[1]!);
    const id = resource[3] ? decodeURIComponent(resource[3]) : undefined;
    const memory = resource[2] === "memories";
    const domain = memory ? "memory" : "routine";
    const ids = { agentId, ...(id ? { [memory ? "memoryId" : "routineId"]: id } : {}) };
    if (!resource[4]) {
      if (method === "POST" && !id)
        admin = {
          ...data,
          ...ids,
          operation: `${domain}.create`,
          ...(memory ? {} : { input: data }),
        };
      if (method === "PATCH" && id)
        admin = {
          ...data,
          ...ids,
          operation: `${domain}.update`,
          ...(memory ? {} : { input: data }),
        };
      if (method === "DELETE" && id) admin = { ...ids, operation: `${domain}.delete` };
    } else if (!memory && id) {
      if (method === "GET" && resource[4] === "runs") read = { ...ids, operation: "routine.runs" };
      if (method === "POST" && resource[4] === "test")
        write = { ...ids, operation: "routine.test" };
    }
  }
  if (method === "GET" && reads[url.pathname]) read = { operation: reads[url.pathname] };
  const agent =
    /^\/v1\/agents\/([^/]+)\/(conversation|conversation-page|queue|memories|routines|messages|interrupt|conversation\/read|reactions)$/.exec(
      url.pathname,
    );
  if (agent) {
    const agentId = decodeURIComponent(agent[1]!);
    const operation = agent[2]!;
    if (method === "GET") {
      const operations: Record<string, string> = {
        conversation: "conversation.read",
        queue: "queue.read",
        memories: "memory.list",
        routines: "routine.list",
      };
      if (operations[operation]) read = { operation: operations[operation], agentId };
      if (operation === "conversation-page")
        read = {
          operation: "conversation.page",
          agentId,
          limit: Number(url.searchParams.get("limit") ?? 50),
          anchor: url.searchParams.has("before")
            ? { type: "before", cursor: url.searchParams.get("before") }
            : url.searchParams.has("around")
              ? { type: "around", messageId: url.searchParams.get("around") }
              : { type: "latest" },
        };
    }
    if (method === "POST") {
      const operations: Record<string, string> = {
        messages: "conversation.send",
        interrupt: "conversation.stop",
        "conversation/read": "conversation.markRead",
        reactions: "conversation.react",
      };
      if (operations[operation]) write = { ...data, operation: operations[operation], agentId };
    }
  }
  const queue =
    /^\/v1\/agents\/([^/]+)\/(queue\/(cancel|reorder|steer)|failures\/acknowledge)$/.exec(
      url.pathname,
    );
  if (method === "POST" && queue)
    write = {
      ...data,
      agentId: decodeURIComponent(queue[1]!),
      operation:
        queue[2] === "failures/acknowledge" ? "queue.acknowledgeFailure" : `queue.${queue[3]}`,
    };
  const queueEdit = /^\/v1\/agents\/([^/]+)\/queue\/edit$/.exec(url.pathname);
  if (method === "POST" && queueEdit) {
    const request = decodeWrite({
      ...data,
      agentId: decodeURIComponent(queueEdit[1]!),
      operation: "queue.edit",
    });
    if (
      request.operation !== "queue.edit" ||
      request.action === "retain-attachments" ||
      (request.action === "save" && request.attachmentDraftIds.length > 0)
    )
      throw new Error("Use Edit queued files to add files with durable upload recovery.");
    write = request;
  }
  const task = /^\/v1\/agent-tasks\/(list|read|start|send|stop|close|reopen)$/.exec(url.pathname);
  if (method === "POST" && task) {
    const input = { ...data, operation: `task.${task[1]}` };
    if (task[1] === "list" || task[1] === "read") read = input;
    else write = input;
  }
  const thread =
    /^\/v1\/agent-threads\/(reads|branches|branch|read|rename|delete|send-reply)$/.exec(
      url.pathname,
    );
  if (method === "POST" && thread) {
    const operations: Record<string, string> = {
      reads: "thread.reads",
      branches: "thread.branches",
      branch: "thread.branch",
      "send-reply": "thread.reply",
      read: "thread.markRead",
      rename: "thread.rename",
      delete: "thread.delete",
    };
    const input = { ...data, operation: operations[thread[1]!] };
    if (thread[1] === "send-reply") {
      const reply = decodeWrite(input);
      if (reply.operation !== "thread.reply" || reply.attachmentDraftIds.length > 0)
        throw new Error("Use the conversation file picker for guarded original uploads.");
    }
    if (thread[1] === "reads" || thread[1] === "branches") read = input;
    else write = input;
  }
  if (admin) return { kind: "admin" as const, request: decodeAdmin(admin) };
  if (read) return { kind: "read" as const, request: decodeRead(read) };
  if (write)
    return {
      kind: "write" as const,
      request: decodeWrite(write),
    };
  throw new Error(`This upstream action is not connected to Sled yet: ${method} ${url.pathname}`);
}

export function workspaceResult(route: ReturnType<typeof workspaceRoute>, value: unknown) {
  if ("projection" in route && route.projection === "browser-page-state") {
    const display = decodeBrowserDisplay(value);
    return {
      tabs: display.tabs.map((tab) => ({
        tabId: tab.id,
        canGoBack: tab.canGoBack ?? false,
        canGoForward: tab.canGoForward ?? false,
      })),
    };
  }
  if (route.kind === "admin" && route.request.operation === "channel.send") {
    // Sled returns the durable send's page; the upstream command decoder expects its channel.
    const page = decodeChannelPage(value);
    if (page.channel.id !== route.request.channelId)
      throw new Error("The accepted channel send belongs to another destination.");
    return page.channel;
  }
  return value;
}
