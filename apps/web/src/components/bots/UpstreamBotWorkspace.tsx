import { selectWorkspaceEnvironment } from "./upstream/environment";
import { useWorkspaceFiles } from "./upstream/useWorkspaceFiles";
import { useWorkspaceBrowser } from "./upstream/useWorkspaceBrowser";
import { useWorkspaceComputer } from "./upstream/useWorkspaceComputer";
import { WorkspaceGuardedDialog, WorkspaceGuardedRequest } from "./upstream/WorkspaceGuardedDialog";
import { OpenbotFileMaterializeInput, OpenbotWorkspaceListInput } from "@t3tools/contracts";
import { resolveAssetUrl } from "@t3tools/client-runtime/state/assets";
import { assetEnvironment } from "../../state/assets";
import { readPreparedConnection } from "../../state/session";
import { useAtomQueryRunner } from "../../state/use-atom-query-runner";
import { fetchMediaBlob } from "../media/mediaContent";
import { useTheme } from "../../hooks/useTheme";
import { randomUUID } from "../../lib/utils";
import { Link } from "@tanstack/react-router";
import { useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/reactivity";
import { PINNED_SETTINGS } from "@t3tools/contracts/openbot-settings";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import * as Schema from "effect/Schema";
import { OpenbotReadRequest, type EnvironmentId } from "@t3tools/contracts";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { useSettingsScope } from "../settings/SettingsScopeContext";
import { useNavigateToMainApp } from "../sidebar/mainAppLocation";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { useEnvironmentSessionState } from "../../state/session";
import { openbot } from "../../state/openbot";
import { workspaceRoute, workspaceResult } from "./upstream/routes";

const decodeDirectory = Schema.decodeUnknownSync(OpenbotWorkspaceListInput);
const decodeMaterialize = Schema.decodeUnknownSync(OpenbotFileMaterializeInput);
const decodeRead = Schema.decodeUnknownSync(OpenbotReadRequest);
const decodeGuarded = Schema.decodeUnknownSync(WorkspaceGuardedRequest);
const decodeIdentity = Schema.decodeUnknownSync(
  Schema.Struct({ serverId: Schema.String, publicKey: Schema.String }),
);
const decodeCompatibility = Schema.decodeUnknownSync(
  Schema.Struct({
    appVersion: Schema.String,
    protocol: Schema.Json,
    capabilities: Schema.Array(Schema.String),
  }),
);

export function UpstreamBotWorkspace({ active = true }: { active?: boolean }) {
  const { environments } = useSettingsScope();
  const [selected, setSelected] = useState<EnvironmentId | null>(null);
  const environment = selectWorkspaceEnvironment(environments, selected);
  if (environments.length === 0)
    return (
      <p role="status" className="p-6">
        Connect an environment to open its Bots workspace.
      </p>
    );
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {(environments.length > 1 || !environment) && (
        <label className="flex items-center gap-2 border-b px-4 py-2 text-sm">
          Environment
          <select
            value={environment?.environmentId ?? ""}
            onChange={(event) => setSelected(event.target.value as EnvironmentId)}
          >
            {!environment && (
              <option value="" disabled>
                Select an environment
              </option>
            )}
            {environments.map((item) => (
              <option key={item.environmentId} value={item.environmentId}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
      )}
      {environment ? (
        <ConnectedWorkspace
          key={environment.environmentId}
          environmentId={environment.environmentId}
          label={environment.label}
          active={active}
        />
      ) : (
        <p role="status" className="p-6">
          The selected environment was removed. Choose another environment.
        </p>
      )}
    </div>
  );
}

function ConnectedWorkspace({
  environmentId,
  label,
  active,
}: {
  environmentId: EnvironmentId;
  label: string;
  active: boolean;
}) {
  const session = useEnvironmentSessionState(environmentId);
  const { resolvedTheme, appearanceMode, setAppearanceMode } = useTheme();
  const [instanceId] = useState(() => randomUUID());
  const accountId = `sled:${environmentId}:${instanceId}:${session.data?.expiresAt?.epochMilliseconds ?? "pending"}`;
  const host = useEnvironmentQuery(openbot.status({ environmentId, input: {} }));
  const read = useAtomCommand(openbot.dataRead, { reportFailure: false });
  const write = useAtomCommand(openbot.writeToHost, { reportFailure: false });
  const admin = useAtomCommand(openbot.adminToHost, { reportFailure: false });
  const materialize = useAtomCommand(openbot.fileMaterialize, { reportFailure: false });
  const directory = useAtomQueryRunner(openbot.fileWorkspace, {
    reportFailure: false,
    refresh: true,
  });
  const asset = useAtomQueryRunner(assetEnvironment.createUrl, { reportFailure: false });
  const canAdmin = useAtomValue(openbot.admin.permissionAtom(environmentId));
  const changes = useAtomValue(openbot.changes({ environmentId, input: {} }));
  const activePort = useRef<MessagePort | null>(null);
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [guarded, setGuarded] = useState<typeof WorkspaceGuardedRequest.Type | null>(null);
  const code = useNavigateToMainApp();
  const iframe = useRef<HTMLIFrameElement>(null);
  const [error, setError] = useState<string | null>(null);
  const hostId = host.data?.state === "ready" ? host.data.hostId : null;
  const originalFiles = useWorkspaceFiles(environmentId, hostId ?? null);
  const { handle: browserRequest, close: closeBrowser } = useWorkspaceBrowser(
    environmentId,
    hostId ?? "",
  );
  const {
    handle: computerRequest,
    close: closeComputer,
    available: computerAvailable,
  } = useWorkspaceComputer(environmentId, hostId ?? "");
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Release interactive remote sessions when their workspace is hidden, while retaining conversation state.
  useEffect(() => {
    if (!active) {
      closeBrowser();
      void closeComputer().catch(() => undefined);
    }
  }, [active, closeBrowser, closeComputer]);
  const coding = useEnvironmentQuery(
    hostId && selectedAgent
      ? openbot.codingTasks({ environmentId, input: { hostId, agentId: selectedAgent } })
      : null,
  );
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Forward the live environment subscription to the mounted Solid workspace port.
  useEffect(() => {
    const change = AsyncResult.getOrElse(changes, () => null);
    if (change) activePort.current?.postMessage({ event: "change", value: change });
  }, [changes]);
  const handleRequest = useEffectEvent(async (method: string, args: Record<string, unknown>) => {
    if (method === "selected" && (typeof args.agentId === "string" || args.agentId === null)) {
      setSelectedAgent(args.agentId);
      return null;
    }
    if (method === "theme") {
      if (args.appearance !== "light" && args.appearance !== "dark" && args.appearance !== "system")
        throw new Error("Invalid appearance");
      if (!setAppearanceMode(args.appearance)) throw new Error("Could not save appearance");
      return null;
    }
    if (method === "code") {
      await code();
      return null;
    }
    if (!hostId) throw new Error("The selected bot engine is not ready");
    async function readOperation(operation: string) {
      const result = await read({
        environmentId,
        input: {
          hostId: hostId!,
          request: decodeRead({ operation }),
        },
      });
      if (result._tag === "Failure") throw squashAtomCommandFailure(result);
      return result.value;
    }
    if (method === "hosts") {
      const identity = decodeIdentity(await readOperation("workspace.identity"));
      if (identity.serverId !== hostId)
        throw new Error("The engine identity does not match this environment");
      // This UI represents a Sled session, not the engine's owner login. Server-side RPC scopes remain authoritative.
      return [
        {
          hostId,
          name: label,
          logoKey: null,
          devicePublicKey: identity.publicKey,
          membershipId: environmentId,
          role: canAdmin ? "admin" : "member",
        },
      ];
    }
    if (args.hostId !== hostId) throw new Error("The selected engine has changed");
    if (method.startsWith("computer-")) return computerRequest(method, args);
    if (["browser-open", "browser-close", "browser-input"].includes(method)) {
      const port = activePort.current;
      return browserRequest(method, args, (value) =>
        port?.postMessage({ event: "browser", value }),
      );
    }
    if (method === "guarded-dialog") {
      const request = decodeGuarded(args.request, { onExcessProperty: "error" });
      setGuarded((current) => current ?? request);
      return null;
    }
    if (method.startsWith("original-")) return originalFiles(method, args);
    if (method === "directory") {
      const result = await directory({
        environmentId,
        input: decodeDirectory({ ...args, hostId }),
      });
      if (result._tag === "Failure") throw squashAtomCommandFailure(result);
      return result.value;
    }
    if (method === "file") {
      const input = decodeMaterialize({
        ...(typeof args.input === "object" && args.input !== null ? args.input : {}),
        hostId,
      });
      if (input.source.kind === "local-skill")
        throw new Error("Use the skill export action for this file");
      const file = await materialize({ environmentId, input });
      if (file._tag === "Failure") throw squashAtomCommandFailure(file);
      if (file.value.size > 10 * 1024 * 1024)
        throw new Error("Use Legacy workspace for files larger than 10 MB");
      const minted = await asset({
        environmentId,
        input: {
          resource: {
            _tag: "attachment",
            attachmentId: file.value.attachmentId,
            fileName: file.value.name,
            mimeType: file.value.mimeType,
            disposition: "attachment",
          },
        },
      });
      if (minted._tag === "Failure") throw squashAtomCommandFailure(minted);
      const connection = readPreparedConnection(environmentId);
      const url = connection && resolveAssetUrl(connection.httpBaseUrl, minted.value.relativeUrl);
      if (!url) throw new Error("Reconnect to this environment and try again");
      const bytes = new Uint8Array(await (await fetchMediaBlob(url)).arrayBuffer());
      const sha256 = Array.from(
        new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
        (byte) => byte.toString(16).padStart(2, "0"),
      ).join("");
      if (bytes.length !== file.value.size || sha256 !== file.value.sha256)
        throw new Error("The materialized file does not match its receipt");
      let binary = "";
      for (let offset = 0; offset < bytes.length; offset += 32768)
        binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
      return { name: file.value.name, mimeType: file.value.mimeType, base64: btoa(binary) };
    }
    if (method === "connect") {
      await readOperation("compatibility.read");
      return null;
    }
    if (
      method !== "request" ||
      typeof args.method !== "string" ||
      typeof args.path !== "string" ||
      args.upload
    )
      throw new Error("This workspace transport operation is not connected");
    const route = workspaceRoute(args.method, args.path, args.body);
    const result =
      route.kind === "read"
        ? await read({ environmentId, input: { hostId, request: route.request } })
        : route.kind === "admin"
          ? await admin({ environmentId, input: { hostId, request: route.request } })
          : await write({ environmentId, input: { hostId, request: route.request } });
    if (result._tag === "Failure") throw squashAtomCommandFailure(result);
    if (args.path === "/v1/compatibility") {
      const support = decodeCompatibility(result.value);
      const supported = new Set([
        "conversation-pagination",
        "host-analytics",
        "agent-analytics",
        "agent-tasks-v1",
        "agent-threads-v1",
        "agent-thread-reads-v1",
        "agent-thread-branches-v1",
        "agent-thread-replies-v1",
        "queue-edit-v1",
        "agent-thread-files-v1",
        "channel-chats-v1",
        "events-v1",
        "routine-recovery-v1",
        "webhook-tests-v1",
        "workspace-directory-v1",
        "channel-delete-v1",
        "channel-task-cancel-v1",
        "message-client-id-v1",
        "conversation-unread",
        "sidebar-layout",
        "browser-control",
        "browser-view",
        "browser-navigation",
        "browser-page-state",
        "browser-user-control",
        "browser-view-frame-point",
        "browser-view-clipboard",
        ...PINNED_SETTINGS.map((entry) => entry.capability),
      ]);
      return {
        ...support,
        capabilities: support.capabilities.filter(
          (name) => supported.has(name) && (canAdmin || !name.startsWith("browser-")),
        ),
      };
    }
    return workspaceResult(route, result.value);
  });
  const readTheme = useEffectEvent((theme = resolvedTheme, appearance = appearanceMode) => ({
    theme,
    appearance,
    tokens: Object.fromEntries(
      [
        "background",
        "foreground",
        "sidebar",
        "card",
        "muted",
        "muted-foreground",
        "border",
        "primary",
      ].map((name) => [
        name,
        getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim(),
      ]),
    ),
  }));
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Mirror the Sled theme into the isolated workspace document when preferences change.
  useEffect(() => {
    activePort.current?.postMessage({
      event: "theme",
      value: readTheme(resolvedTheme, appearanceMode),
    });
  }, [resolvedTheme, appearanceMode]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Own the iframe handshake and MessageChannel until this authenticated workspace unmounts.
  useEffect(() => {
    let port: MessagePort | null = null;
    const handshakeTimeout = hostId
      ? setTimeout(
          () =>
            setError(
              "The Bots workspace did not connect. Reload this page or use the legacy workspace.",
            ),
          15_000,
        )
      : undefined;
    const receive = (event: MessageEvent) => {
      if (
        event.origin !== location.origin ||
        event.source !== iframe.current?.contentWindow ||
        event.data?.type !== "sled:bots:ready"
      )
        return;
      clearTimeout(handshakeTimeout);
      setError(null);
      const channel = new MessageChannel();
      closeBrowser();
      void closeComputer().catch(() => undefined);
      port?.close();
      port = channel.port1;
      activePort.current = port;
      port.onmessage = async ({ data }) => {
        if (!Number.isSafeInteger(data?.id) || typeof data.method !== "string") return;
        const replyPort = channel.port1;
        try {
          // oxlint-disable unicorn/require-post-message-target-origin -- MessagePort is already bound to the origin-checked iframe, not a Window.
          replyPort.postMessage({
            id: data.id,
            value: await handleRequest(data.method, data.args ?? {}),
          });
          // oxlint-enable unicorn/require-post-message-target-origin
        } catch (cause) {
          // oxlint-disable unicorn/require-post-message-target-origin -- MessagePort is already bound to the origin-checked iframe, not a Window.
          replyPort.postMessage({
            id: data.id,
            error: cause instanceof Error ? cause.message : "Sled refused this workspace request",
          });
          // oxlint-enable unicorn/require-post-message-target-origin
        }
      };
      iframe.current!.contentWindow!.postMessage(
        {
          type: "sled:bots:connect",
          accountId,
          computerAvailable,
          ...readTheme(),
        },
        { targetOrigin: location.origin, transfer: [channel.port2] },
      );
    };
    window.addEventListener("message", receive);
    return () => {
      clearTimeout(handshakeTimeout);
      window.removeEventListener("message", receive);
      closeBrowser();
      void closeComputer().catch(() => undefined);
      port?.close();
      activePort.current = null;
    };
  }, [accountId, hostId, closeBrowser, closeComputer, computerAvailable]);
  if (!session.data?.authenticated || session.hasError)
    return (
      <p role="status" className="p-6">
        Reconnect this environment to open Bots.
      </p>
    );
  if (!hostId)
    return (
      <p role="status" className="p-6">
        {host.data?.state === "failed"
          ? "The bot engine needs attention in Engine settings."
          : "Waiting for the selected bot engine…"}
      </p>
    );
  return (
    <>
      {guarded && (
        <WorkspaceGuardedDialog
          key={`${accountId}:${hostId}:${JSON.stringify(guarded)}`}
          environmentId={environmentId}
          hostId={hostId}
          request={guarded}
          close={() => setGuarded(null)}
        />
      )}
      {coding.data && coding.data.length > 0 && (
        <nav
          aria-label="Delegated coding threads"
          className="flex shrink-0 gap-3 border-b px-4 py-2 text-xs"
        >
          {coding.data.map((task) => (
            <Link
              key={task.operationId}
              to="/$environmentId/$threadId"
              params={{
                environmentId: task.environmentId ?? environmentId,
                threadId: task.threadId,
              }}
            >
              Open coding thread · {task.state}
            </Link>
          ))}
        </nav>
      )}
      {error && <p role="alert">{error}</p>}
      <iframe
        key={`${accountId}:${hostId}`}
        ref={iframe}
        title="OpenBot workspace"
        // oxlint-disable-next-line react/iframe-missing-sandbox -- Trusted same-origin bundle; isolation is for Solid and CSS, not an untrusted-content boundary.
        sandbox="allow-scripts allow-same-origin allow-forms allow-downloads allow-popups"
        src="/openbot-workspace/index.html"
        className="min-h-0 w-full flex-1 border-0"
        onError={() =>
          setError(
            "The OpenBot workspace bundle is unavailable. Build the workspace assets or use the legacy workspace.",
          )
        }
      />
    </>
  );
}
