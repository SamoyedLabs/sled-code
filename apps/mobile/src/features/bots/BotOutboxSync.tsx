import { useAtomValue } from "@effect/atom-react";
import { settingsCapabilities } from "@t3tools/client-runtime/openbot/settings";
import { botConversationSnapshot, channelPage } from "@t3tools/client-runtime/openbot/presentation";
import {
  OPENBOT_CHANNEL_UPLOAD_RECOVERY_CAPABILITY,
  type EnvironmentId,
  type OpenbotAdminRequest,
  type OpenbotWriteRequest,
} from "@t3tools/contracts";
import { useEffect, useEffectEvent, useLayoutEffect, useRef } from "react";
import { useAppForeground } from "../../lib/appState";
import { useEnvironments } from "../../state/environments";
import { openbot } from "../../state/openbot";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { useBotOfflineScope } from "./botOfflineCache";
import { useBotOutbox, type BotOutboxEntry } from "./botOutbox";
import { deliverBotOutboxFiles } from "./deliverBotOutboxFiles";

export function BotOutboxSync() {
  const foreground = useAppForeground();
  const { environments } = useEnvironments();
  return environments.map((environment) => (
    <EnvironmentOutbox
      key={environment.environmentId}
      environmentId={environment.environmentId}
      connected={environment.connection.phase === "connected"}
      foreground={foreground}
    />
  ));
}

function agentRequest(entry: BotOutboxEntry): OpenbotWriteRequest | undefined {
  if (entry.chat.kind !== "agent") return;
  const payload = { agentId: entry.chat.id, text: entry.text, clientMessageId: entry.id };
  if (!entry.chat.taskId)
    return { operation: "conversation.send", ...payload, replyToMessageId: entry.replyToMessageId };
  if (entry.replyToMessageId)
    return {
      operation: "thread.reply",
      ...payload,
      taskId: entry.chat.taskId,
      replyToMessageId: entry.replyToMessageId,
      attachmentDraftIds: [],
    };
  return { operation: "task.send", ...payload, taskId: entry.chat.taskId };
}
function groupRequest(entry: BotOutboxEntry): OpenbotAdminRequest | undefined {
  if (entry.chat.kind !== "group") return;
  return {
    operation: "channel.send",
    channelId: entry.chat.id,
    operationId: entry.id,
    text: entry.text,
    recipientAgentId: null,
    replyToMessageId: entry.replyToMessageId,
    attachmentDraftIds: [],
  };
}

function EnvironmentOutbox({
  environmentId,
  connected,
  foreground,
}: {
  environmentId: EnvironmentId;
  connected: boolean;
  foreground: boolean;
}) {
  const scope = useBotOfflineScope(environmentId);
  const { outbox, snapshot } = useBotOutbox(scope);
  const entry = snapshot.entries[0];
  const includesFiles = Boolean(entry?.files?.length);
  const host = useEnvironmentQuery(
    entry && connected && foreground ? openbot.status({ environmentId, input: {} }) : null,
  );
  const message = entry ? agentRequest(entry) : undefined;
  const group = entry ? groupRequest(entry) : undefined;
  const compatibility = useEnvironmentQuery(
    entry && (message || includesFiles) && connected && foreground
      ? openbot.readFromHost({
          environmentId,
          input: { hostId: entry.hostId, request: { operation: "compatibility.read" } },
        })
      : null,
  );
  const destination = useEnvironmentQuery(
    entry?.expectedThreadId && connected && foreground
      ? openbot.readFromHost({
          environmentId,
          input: {
            hostId: entry.hostId,
            request:
              entry.chat.kind === "group"
                ? { operation: "channel.read", channelId: entry.chat.id }
                : entry.chat.taskId
                  ? { operation: "task.read", agentId: entry.chat.id, taskId: entry.chat.taskId }
                  : { operation: "conversation.read", agentId: entry.chat.id },
          },
        })
      : null,
  );
  const fileContext = useEnvironmentQuery(
    entry && includesFiles && connected && foreground
      ? openbot.fileContext({ environmentId, input: { hostId: entry.hostId } })
      : null,
  );
  const principal = fileContext.data?.principalId;
  const actor =
    connected && foreground && scope && principal ? JSON.stringify([scope, principal]) : null;
  const latestActor = useRef(actor);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Verify authority after each asynchronous file transfer step.
  useLayoutEffect(() => {
    latestActor.current = actor;
    return () => {
      latestActor.current = null;
    };
  }, [actor]);
  const priorConnection = useRef(connected);
  const canWrite = useAtomValue(
    openbot.writeToHost.permissionAtom(
      environmentId,
      entry && message ? { hostId: entry.hostId, request: message } : undefined,
    ),
  );
  const canSendGroup = useAtomValue(
    openbot.adminToHost.permissionAtom(
      environmentId,
      entry && group ? { hostId: entry.hostId, request: group } : undefined,
    ),
  );
  const canStage = useAtomValue(openbot.fileOriginalUpload.permissionAtom(environmentId));
  const canSendFiles = useAtomValue(openbot.fileSendDraft.permissionAtom(environmentId));
  const write = useAtomCommand(openbot.writeToHost, { reportFailure: false });
  const admin = useAtomCommand(openbot.adminToHost, { reportFailure: false });
  const capabilities = settingsCapabilities(compatibility.data);
  const hasAuthority = includesFiles
    ? scope &&
      principal &&
      fileContext.data?.hostId === entry?.hostId &&
      canStage &&
      canSendFiles &&
      capabilities.includes("sled-files-upload-recovery-v1") &&
      (entry?.chat.kind !== "group" ||
        (canSendGroup && capabilities.includes(OPENBOT_CHANNEL_UPLOAD_RECOVERY_CAPABILITY)))
    : message
      ? canWrite && capabilities.includes("message-client-id-v1")
      : group && canSendGroup;
  const ready = Boolean(
    entry &&
    connected &&
    foreground &&
    host.isSuccess &&
    host.data?.state === "ready" &&
    host.data.hostId === entry.hostId &&
    (!entry.expectedThreadId || destination.isSuccess) &&
    hasAuthority,
  );
  const flush = useEffectEvent(async () => {
    if (!outbox || !entry || !ready || !(await outbox.claim(entry))) return;
    let accepted = false;
    await (async () => {
      if (entry.expectedThreadId) {
        if (entry.chat.kind === "agent") {
          if (botConversationSnapshot(destination.data)?.threadId !== entry.expectedThreadId)
            return;
        } else {
          const channel = channelPage(destination.data)?.channel;
          if (
            channel?.id !== entry.expectedThreadId ||
            channel.archived ||
            !channel.members.some(({ agentId }) => agentId === entry.groupAttachmentAgentId)
          )
            return;
        }
      }
      if (includesFiles && scope && principal) {
        accepted = await deliverBotOutboxFiles({
          environmentId,
          scope,
          principalId: principal,
          entry,
          isCurrent: () => actor !== null && latestActor.current === actor,
        });
        return;
      }
      const result = message
        ? await write({ environmentId, input: { hostId: entry.hostId, request: message } })
        : group
          ? await admin({ environmentId, input: { hostId: entry.hostId, request: group } })
          : null;
      accepted = result?._tag === "Success";
    })().finally(() => outbox.settle(entry.id, accepted));
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Give a pending delivery one retry after the same environment reconnects.
  useEffect(() => {
    const wasConnected = priorConnection.current;
    priorConnection.current = connected;
    if (!wasConnected && connected && snapshot.failed) outbox?.retry();
  }, [connected, outbox, snapshot.failed]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- A foreground, authenticated reconnect releases exactly one durable message at a time.
  useEffect(() => {
    if (
      ready &&
      !snapshot.sending &&
      entry &&
      snapshot.failed !== entry.id &&
      snapshot.editing !== entry.id
    ) {
      void flush().catch(() => undefined);
    }
  }, [ready, entry, snapshot.sending, snapshot.failed, snapshot.editing]);
  return null;
}
