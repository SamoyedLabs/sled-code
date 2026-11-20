import { createAttachmentSources } from "./file-sources";
import { createWorkspaceTaskRefresh } from "./task-refresh";
import { createSledBrowser } from "./browser";
import {
  createWebWorkspaceRuntime,
  decodeWebBrowserTab,
} from "../src/renderer/src/features/web-client/web-runtime";
import { acquireWebHostLock } from "../src/renderer/src/features/web-client/web-host-lock";
import type { WebRuntimeFactory } from "../src/renderer/src/features/web-client/web-client-context";
import type { createRemoteTeamPeer } from "@openbot/team-client/remote-peer";

import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import {
  decodeWorkspaceDirectory,
  isConversationSnapshot,
  isAgentTasksSnapshot,
  isAttachmentSummary,
} from "@openbot/contracts/ipc";
import {
  decodeTeamProtocolV2Json,
  decodeTeamProtocolV9WebRtcHttpResponse,
} from "@openbot/contracts/team-protocol";
import { decodeBrowserPageStateSnapshot } from "@openbot/contracts/team-protocol/browser-page-state-v1";
import type { RemoteTeamHost } from "@openbot/team-client/remote-directory";

type WorkspaceChange = { hostId: string; resource: string };
function decodeHosts(value: unknown): RemoteTeamHost[] {
  if (!Array.isArray(value)) throw new Error("Invalid Sled host list");
  return value.map((host) => {
    if (
      !isDynamicRecord(host) ||
      typeof host.hostId !== "string" ||
      typeof host.name !== "string" ||
      typeof host.devicePublicKey !== "string" ||
      typeof host.membershipId !== "string" ||
      (host.role !== "admin" && host.role !== "member")
    )
      throw new Error("Invalid Sled host identity");
    return {
      hostId: host.hostId,
      name: host.name,
      devicePublicKey: host.devicePublicKey,
      membershipId: host.membershipId,
      role: host.role,
      logoKey: null,
    };
  });
}

export function bridge(port: MessagePort, onTheme: (value: unknown) => void) {
  let sequence = 0;
  const listeners = new Set<(change: WorkspaceChange) => void>();
  const browserListeners = new Set<(value: unknown) => void>();
  const pending = new Map<
    number,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  port.onmessage = ({ data }) => {
    if (data?.event === "browser") {
      for (const listener of browserListeners) listener(data.value);
      return;
    }
    if (data?.event === "theme") {
      onTheme(data.value);
      return;
    }
    if (data?.event === "change") {
      if (
        !isDynamicRecord(data.value) ||
        typeof data.value.hostId !== "string" ||
        typeof data.value.resource !== "string"
      )
        return;
      const change = { hostId: data.value.hostId, resource: data.value.resource };
      for (const listener of listeners) listener(change);
      return;
    }
    const item = pending.get(data?.id);
    if (!item) return;
    clearTimeout(item.timer);
    pending.delete(data.id);
    if (data.error) item.reject(new Error(data.error));
    else item.resolve(data.value);
  };
  const call = (method: string, args: unknown = {}) =>
    new Promise<unknown>((resolve, reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error("Sled workspace request timed out"));
      }, 30_000);
      pending.set(id, { resolve, reject, timer });
      port.postMessage({ id, method, args });
    });
  const createRuntime: WebRuntimeFactory = (accountId, events, accountFetch) => {
    let disposed = false;
    let selectedAgent: string | null = null;
    let selectedChannel: string | null = null;
    let selectedHost: string | null = null;
    let lastChannel: { id: string; revision: number } | undefined;
    const files = createAttachmentSources();
    let refreshBrowser = async (_preferredTabId?: string) => {};
    const createPeer: typeof createRemoteTeamPeer = (actions) => {
      let hostId: string | null = null;
      return {
        async execute(command) {
          if (command.type === "connect") {
            await call("connect", { hostId: command.hostId });
            hostId = command.hostId;
            selectedHost = hostId;
            await actions.current.onConnectionUpdate({ hostId, state: "online", message: null });
            return { commandId: command.id, ok: true };
          }
          if (command.type === "disconnect") {
            selectedHost = null;
            selectedChannel = null;
            lastChannel = undefined;
            taskRefresh.clear();
            files.clear();
            hostId = null;
            return { commandId: command.id, ok: true };
          }
          if (!hostId) throw new Error("Select a connected Sled environment");
          const conversation = /^\/v1\/agents\/([^/]+)\/conversation(?:-page)?(?:\?|$)/.exec(
            command.path,
          );
          if (conversation) {
            selectedAgent = decodeURIComponent(conversation[1]!);
            selectedChannel = null;
            await call("selected", { agentId: selectedAgent });
          }
          if (command.path === "/v1/channels/read") {
            selectedAgent = null;
            selectedChannel =
              isDynamicRecord(command.body) && typeof command.body.channelId === "string"
                ? command.body.channelId
                : null;
            await call("selected", { agentId: null });
          }
          if (
            command.path === "/v1/agent-tasks/read" &&
            command.body &&
            typeof command.body === "object" &&
            !Array.isArray(command.body)
          ) {
            const data = command.body as Record<string, unknown>;
            if (typeof data.agentId === "string" && typeof data.taskId === "string") {
              taskRefresh.observeConversation(data.agentId, data.taskId);
              selectedAgent = data.agentId;
              selectedChannel = null;
              await call("selected", { agentId: data.agentId });
            }
          }
          if (
            command.path === "/v1/agent-tasks/list" &&
            isDynamicRecord(command.body) &&
            typeof command.body.agentId === "string"
          )
            taskRefresh.observeList(command.body.agentId);
          const body = await call("request", {
            hostId,
            method: command.method,
            path: command.path,
            body: command.body,
            upload: command.upload,
          });
          if (
            command.method === "POST" &&
            command.path.startsWith("/v1/browser/") &&
            !command.path.endsWith("/user-control")
          )
            void refreshBrowser(
              command.path === "/v1/browser/open" &&
                isDynamicRecord(body) &&
                typeof body.id === "string"
                ? body.id
                : undefined,
            ).catch(() => undefined);
          if (conversation) files.remember(body, decodeURIComponent(conversation[1]!));
          if (
            command.path === "/v1/agent-tasks/read" &&
            isDynamicRecord(command.body) &&
            typeof command.body.agentId === "string" &&
            typeof command.body.taskId === "string"
          )
            files.remember(body, command.body.agentId, command.body.taskId);
          return {
            commandId: command.id,
            ok: true,
            status: 200,
            body: ["/v1/browser/tabs", "/v1/browser/open", "/v1/team/presence"].includes(command.path)
              ? decodeTeamProtocolV9WebRtcHttpResponse(command.method, command.path, 200, body)
              : decodeTeamProtocolV2Json(body),
          };
        },
        async cancelUpload() {},
        async sendHostStreamData() {
          throw new Error("Live streams require the Sled viewer adapter");
        },
        setTyping() {},
        setWaitForHost() {},
        setActive() {},
        networkRestored() {
          if (hostId)
            void call("connect", { hostId })
              .then(() =>
                actions.current.onConnectionUpdate({
                  hostId: hostId!,
                  state: "online",
                  message: null,
                  resync: true,
                }),
              )
              .catch(() =>
                actions.current.onConnectionUpdate({
                  hostId: hostId!,
                  state: "offline",
                  message: "Reconnect the Sled environment",
                }),
              );
        },
        async dispose() {
          hostId = null;
        },
      };
    };
    const runtime = createWebWorkspaceRuntime(accountId, events, accountFetch, {
      createPeer,
      acquireHostLock: acquireWebHostLock,
    });
    const taskRefresh = createWorkspaceTaskRefresh({
      list: (agentId) =>
        runtime.admin!.request(
          "POST",
          "/v1/agent-tasks/list",
          (value) => {
            if (!isAgentTasksSnapshot(value)) throw new Error("Invalid task list");
            return value;
          },
          { agentId },
        ),
      read: (agentId, taskId) =>
        runtime.admin!.request(
          "POST",
          "/v1/agent-tasks/read",
          (value) => {
            if (!isConversationSnapshot(value)) throw new Error("Invalid task conversation");
            return value;
          },
          { agentId, taskId },
        ),
      listChanged: (hostId, snapshot) =>
        events.event(hostId, { type: "agent-tasks-changed", snapshot }),
      conversationChanged: (hostId, taskId, snapshot) =>
        events.event(hostId, { type: "agent-task-conversation", taskId, snapshot }),
    });
    if (runtime.channels) {
      const listChannels = runtime.channels.listChannels;
      runtime.channels.listChannels = async () => {
        const host = selectedHost;
        const channels = await listChannels();
        if (!disposed && host === selectedHost) lastChannel = channels[0] ?? lastChannel;
        return channels;
      };
    }
    const browser = createSledBrowser(call, () => selectedHost);
    runtime.browser = browser.browser;
    browserListeners.add(browser.receive);
    refreshBrowser = async (preferredTabId) => {
      const hostId = selectedHost;
      if (!hostId || disposed) return;
      const display = await call("request", { hostId, method: "GET", path: "/v1/browser/display" });
      if (
        !isDynamicRecord(display) ||
        !Array.isArray(display.tabs) ||
        (display.activeTabId !== null && typeof display.activeTabId !== "string")
      )
        throw new Error("Invalid browser display");
      if (selectedHost !== hostId || disposed) return;
      const tabs = display.tabs.map(decodeWebBrowserTab);
      const selectedTabId = preferredTabId ?? browser.activeTabId();
      const activeTabId = tabs.some((tab) => tab.id === selectedTabId)
        ? selectedTabId
        : display.activeTabId;
      const pages = decodeBrowserPageStateSnapshot({
        tabs: display.tabs.map((tab) => {
          if (!isDynamicRecord(tab)) throw new Error("Invalid browser history state");
          return { tabId: tab.id, canGoBack: tab.canGoBack, canGoForward: tab.canGoForward };
        }),
      });
      events.event(hostId, { type: "browser-changed", tabs, activeTabId });
      events.event(hostId, { type: "browser-page-state-changed", tabs: pages.tabs });
      const tabIds = display.tabs
        .filter((tab) => isDynamicRecord(tab) && tab.userControl === true)
        .map((tab) => decodeWebBrowserTab(tab).id);
      events.event(hostId, { type: "browser-user-control-changed", tabIds });
    };
    runtime.listHosts = async () => decodeHosts(await call("hosts"));
    const readFile = async (input: unknown) => {
      if (!selectedHost || disposed) throw new Error("Select a connected Sled environment");
      const value = await call("file", { hostId: selectedHost, input });
      if (
        !isDynamicRecord(value) ||
        typeof value.name !== "string" ||
        typeof value.mimeType !== "string" ||
        typeof value.base64 !== "string"
      )
        throw new Error("Invalid materialized file");
      return { name: value.name, mimeType: value.mimeType, base64: value.base64 };
    };
    runtime.openQueueAttachments = async (target) => {
      await call("guarded-dialog", { hostId: selectedHost, request: { kind: "queue", ...target } });
    };
    runtime.openSecureResponse = async (target) => {
      await call("guarded-dialog", {
        hostId: selectedHost,
        request: { kind: "response", ...target },
      });
    };
    runtime.upload = async (file, target) => {
      if (!target || !selectedHost || disposed)
        throw new Error("Choose an existing bot conversation or task before attaching a file.");
      const value = await call("original-upload", { hostId: selectedHost, file, target });
      if (!isAttachmentSummary(value)) throw new Error("Invalid original upload receipt");
      return value;
    };
    runtime.sendOriginalTaskFiles = async (input) => {
      const receipt = await call("original-send", {
        hostId: selectedHost,
        target: { agentId: input.agentId, taskId: input.taskId },
        text: input.text,
        attachmentIds: input.attachmentDraftIds,
        replyToMessageId: input.replyToMessageId,
      });
      if (
        !isDynamicRecord(receipt) ||
        receipt.state !== "sent" ||
        typeof receipt.messageId !== "string"
      )
        throw new Error("Original task delivery is not confirmed");
      return receipt;
    };
    runtime.discard = async (attachmentId) => {
      await call("original-discard", { hostId: selectedHost, attachmentId });
    };
    const sendText = runtime.send.bind(runtime);
    runtime.send = async (agentId, text, attachmentIds, replyToMessageId, clientMessageId) => {
      if (attachmentIds.length === 0)
        return sendText(agentId, text, attachmentIds, replyToMessageId, clientMessageId);
      const receipt = await call("original-send", {
        hostId: selectedHost,
        target: { agentId, taskId: null },
        text,
        attachmentIds,
        replyToMessageId,
      });
      if (
        !isDynamicRecord(receipt) ||
        receipt.state !== "sent" ||
        typeof receipt.messageId !== "string"
      )
        throw new Error("Original delivery is not confirmed");
      return typeof receipt.conversationMessageId === "string"
        ? receipt.conversationMessageId
        : receipt.messageId;
    };
    runtime.download = (attachmentId) => readFile(files.get(attachmentId));
    runtime.sharedFile = (path, agentId = selectedAgent ?? undefined) => {
      if (!agentId) throw new Error("Select the bot that shared this file");
      return readFile({ agentId, source: { kind: "shared", path } });
    };
    runtime.workspaceFile = (agentId, path) =>
      readFile({ agentId, source: { kind: "workspace", path } });
    runtime.workspaceDirectory = async (agentId, path) => {
      if (!selectedHost || disposed) throw new Error("Select a connected Sled environment");
      return decodeWorkspaceDirectory(
        await call("directory", { hostId: selectedHost, agentId, path }),
      );
    };

    let refreshing = false;
    let dirty = false;
    let channelsDirty = false;
    let agentsDirty = false;
    let detailsDirty = false;
    let presenceDirty = false;
    const refresh = async () => {
      if (refreshing) {
        dirty = true;
        return;
      }
      if (!selectedHost || disposed) return;
      refreshing = true;
      try {
        do {
          dirty = false;
          const host: string | null = selectedHost;
          if (!host || disposed) return;
          if (presenceDirty && runtime.admin) {
            presenceDirty = false;
            const snapshot = await runtime.admin.team.getPresence();
            if (disposed || selectedHost !== host) return;
            events.event(host, { type: "team-presence", snapshot });
          }
          if (detailsDirty) {
            detailsDirty = false;
            if (selectedChannel) {
              events.event(host, { type: "channel-memories-changed", channelId: selectedChannel });
              events.event(host, { type: "channel-routines-changed", channelId: selectedChannel });
            } else if (selectedAgent) {
              events.event(host, { type: "memories-changed", agentId: selectedAgent });
              events.event(host, { type: "routines-changed", agentId: selectedAgent });
            }
          }
          if (agentsDirty) {
            agentsDirty = false;
            const agents = await runtime.listAgents();
            if (disposed || selectedHost !== host) return;
            events.event(host, { type: "agents-changed", agents });
          }
          if (channelsDirty && runtime.channels) {
            channelsDirty = false;
            const channels = await runtime.channels.listChannels();
            if (disposed || selectedHost !== host) return;
            // Sled invalidations omit channel identity; the upstream controller rereads the list and selected page.
            const channel = channels[0] ?? lastChannel;
            lastChannel = channels[0];
            if (channel)
              events.event(host, {
                type: "channels-changed",
                channelId: channel.id,
                revision: channel.revision,
              });
          }
          if (selectedAgent) {
            const page = await runtime.conversation(selectedAgent);
            events.event(host, { type: "conversation-page", page });
            const snapshot = await runtime.queue(selectedAgent);
            events.event(host, { type: "queue-changed", snapshot });
          }
          await taskRefresh.refresh(host, selectedAgent, () => !disposed && selectedHost === host);
        } while (dirty && !disposed);
      } catch {
        /* The next scoped read shows the current refusal; never retry a mutation. */
      } finally {
        refreshing = false;
      }
    };
    const changed = (change: WorkspaceChange) => {
      // Integration coalesces upstream resources to all, so active detail panes also need invalidation.
      if (change.hostId === selectedHost && ["memory", "routines", "all"].includes(change.resource))
        detailsDirty = true;
      if (change.hostId === selectedHost && change.resource === "all") {
        channelsDirty = true;
        presenceDirty = true;
      }
      if (change.hostId === selectedHost && ["agents", "all"].includes(change.resource))
        agentsDirty = true;
      if (change.hostId === selectedHost && ["browser", "all"].includes(change.resource))
        void refreshBrowser().catch(() => undefined);
      if (
        change.hostId === selectedHost &&
        ["agents", "memory", "routines", "conversation", "tasks", "queue", "all"].includes(
          change.resource,
        )
      )
        void refresh();
    };
    listeners.add(changed);
    const dispose = runtime.dispose.bind(runtime);
    runtime.dispose = async (options) => {
      disposed = true;
      browserListeners.delete(browser.receive);
      await browser.stop().catch(() => undefined);
      listeners.delete(changed);
      selectedHost = null;
      await dispose(options);
    };
    return runtime;
  };
  return { call, createRuntime };
}
