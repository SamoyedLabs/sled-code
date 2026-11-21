import type { EnvironmentId, OpenbotOriginalUploadIdentity } from "@t3tools/contracts";
import {
  runAtomCommand,
  squashAtomCommandFailure,
  type AtomCommand,
} from "@t3tools/client-runtime/state/runtime";
import { appAtomRegistry } from "../../state/atom-registry";
import { openbot } from "../../state/openbot";
import { transferBotFile } from "../settings/useBotFileUpload";
import { openBotOutboxFile } from "./botOutboxFiles";
import type { BotOutboxEntry } from "./botOutboxStore";

async function command<W, A, E>(operation: AtomCommand<W, A, E>, input: W) {
  const result = await runAtomCommand(appAtomRegistry, operation, input, { reportFailure: false });
  if (result._tag === "Failure") throw squashAtomCommandFailure(result);
  return result.value;
}

export async function deliverBotOutboxFiles({
  environmentId,
  scope,
  principalId,
  entry,
  isCurrent,
}: {
  environmentId: EnvironmentId;
  scope: string;
  principalId: string;
  entry: BotOutboxEntry;
  isCurrent: () => boolean;
}) {
  if (!entry.files?.length || !entry.expectedThreadId) return false;
  const { hostId, expectedThreadId } = entry;
  const channelId = entry.chat.kind === "group" ? entry.chat.id : undefined;
  const agentId = entry.chat.kind === "agent" ? entry.chat.id : entry.groupAttachmentAgentId;
  const taskId = entry.chat.kind === "agent" ? (entry.chat.taskId ?? null) : null;
  if (!agentId || (channelId !== undefined && channelId !== expectedThreadId)) return false;
  const attachmentIds: string[] = [];
  const assertCurrent = () => {
    if (!isCurrent()) throw new Error("The saved chat is no longer connected.");
  };
  for (const file of entry.files) {
    assertCurrent();
    const identity: OpenbotOriginalUploadIdentity & { principalId: string } = {
      operationId: file.id,
      hostId,
      agentId,
      principalId,
      threadId: expectedThreadId,
      taskId,
      ...(channelId ? { channelId } : {}),
      name: file.name,
      mimeType: file.mimeType,
      size: file.size,
      sha256: file.sha256,
    };
    const recovered = await command(openbot.fileRecoverUpload, { environmentId, input: identity });
    assertCurrent();
    const pending =
      recovered.state === "absent"
        ? await transferBotFile(
            {
              environmentId,
              file: await openBotOutboxFile(scope, file),
              name: file.name,
              mimeType: file.mimeType,
              controller: new AbortController(),
            },
            async (attachmentId) => {
              assertCurrent();
              return command(openbot.fileOriginalUpload, {
                environmentId,
                input: { ...identity, attachmentId },
              });
            },
          )
        : recovered;
    if (
      !pending ||
      pending.state !== "ready" ||
      !pending.draft ||
      pending.draft.hostId !== hostId ||
      pending.draft.agentId !== agentId ||
      pending.draft.sha256 !== file.sha256 ||
      pending.draft.attachment.size !== file.size
    )
      throw new Error("The host did not confirm the saved attachment.");
    attachmentIds.push(pending.draft.attachment.id);
  }
  assertCurrent();
  const receipt = await command(openbot.fileSendDraft, {
    environmentId,
    input: {
      hostId,
      agentId,
      expectedThreadId,
      attachmentId: attachmentIds[0]!,
      attachmentIds,
      text: entry.text,
      ...(entry.replyToMessageId ? { replyToMessageId: entry.replyToMessageId } : {}),
      target: channelId
        ? { kind: "channel", channelId }
        : taskId
          ? { kind: "task", taskId }
          : { kind: "main" },
    },
  });
  return (
    receipt.hostId === hostId &&
    receipt.agentId === agentId &&
    receipt.state === "sent" &&
    receipt.attachment.id === attachmentIds[0] &&
    (channelId === undefined ||
      (receipt.target?.kind === "channel" && receipt.target.channelId === channelId)) &&
    Boolean(receipt.messageId)
  );
}
