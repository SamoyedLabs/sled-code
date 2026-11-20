import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, OpenbotDraftFile } from "@t3tools/contracts";
import { acceptedDraft } from "@t3tools/client-runtime/openbot/rich-conversation";
import { useRef, useState } from "react";
import * as Dialog from "../../components/ui/Dialog";
import { openbot } from "../../state/openbot";
import { useAtomCommand } from "../../state/use-atom-command";
import { useBotFileUpload, type BotFilePicker } from "../settings/useBotFileUpload";

export function useBotGroupAttachments(
  environmentId: EnvironmentId,
  hostId: string,
  channelId: string,
) {
  const upload = useBotFileUpload(environmentId, hostId);
  const canSend = useAtomValue(openbot.fileSendDraft.permissionAtom(environmentId));
  const sendFile = useAtomCommand(openbot.fileSendDraft, { reportFailure: false });
  const [files, setFiles] = useState<OpenbotDraftFile[]>([]);
  const [attempt, setAttempt] = useState<{ text: string; reply: string | null } | null>(null);
  const [sending, setSending] = useState(false);
  const lock = useRef(false);
  const agentId = files[0]?.agentId;
  const pick = async (source: BotFilePicker, recipient: string) => {
    if (!canSend || attempt || files.length >= 10 || (agentId && agentId !== recipient)) return;
    let file: Awaited<ReturnType<typeof upload.pick>> = null;
    try {
      file = await upload.pick(recipient, source);
    } catch {
      Dialog.alert(
        "Could not attach the file",
        "Try a supported file and check the host connection.",
      );
      return;
    }
    if (file?.state === "ready") {
      const readyFile = file;
      setFiles((current) =>
        current.some((item) => item.attachment.id === readyFile.attachment.id)
          ? current
          : [...current, readyFile],
      );
    }
  };
  const send = async (text: string, reply: string | null) => {
    const attachmentId = files[0]?.attachment.id;
    if (!attachmentId || !agentId || !canSend || lock.current || upload.busy) return false;
    const envelope = attempt ?? { text, reply };
    const target = { kind: "channel", channelId } as const;
    const scope = { hostId, agentId };
    lock.current = true;
    setSending(true);
    setAttempt(envelope);
    return (async () => {
      const result = await sendFile({
        environmentId,
        input: {
          ...scope,
          target,
          attachmentId,
          attachmentIds: files.map((file) => file.attachment.id),
          text: envelope.text,
          ...(envelope.reply ? { replyToMessageId: envelope.reply } : {}),
        },
      });
      if (result._tag === "Success" && acceptedDraft(scope, target, attachmentId, result.value)) {
        setFiles([]);
        setAttempt(null);
        return true;
      }
      Dialog.alert("Attachment delivery unconfirmed", "Tap Send to retry the same message.");
      return false;
    })().finally(() => {
      lock.current = false;
      setSending(false);
    });
  };
  return {
    files,
    agentId,
    pick,
    send,
    attempt,
    busy: upload.busy || sending,
    uploading: upload.busy,
    canAttach:
      canSend && upload.canUpload && !upload.busy && !sending && !attempt && files.length < 10,
    canSend,
    remove: (id: string) => {
      if (!attempt && !lock.current && !upload.busy)
        setFiles((current) => current.filter((item) => item.attachment.id !== id));
    },
  };
}
