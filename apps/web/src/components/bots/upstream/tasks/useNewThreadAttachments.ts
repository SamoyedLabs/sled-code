import { useEffect, useRef, useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, OpenbotDraftFile } from "@t3tools/contracts";
import {
  runAttachmentUploadCycle,
  deletePendingAttachmentUpload,
} from "@t3tools/client-runtime/state/attachments";
import { resolveAssetUrl } from "@t3tools/client-runtime/state/assets";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { appAtomRegistry } from "../../../../rpc/atomRegistry";
import { attachmentEnvironment } from "../../../../state/attachments";
import { readPreparedConnection } from "../../../../state/session";
import { openbot } from "../../../../state/openbot";
import { useAtomCommand } from "../../../../state/use-atom-command";

/** Reuse the Files upload/draft service; first-turn delivery stays in its durable new-task journal. */
export function useNewThreadAttachments(
  environmentId: EnvironmentId,
  hostId: string,
  agentId: string,
  disabled: boolean,
  onReady: (draft: OpenbotDraftFile) => void,
) {
  const upload = useAtomCommand(openbot.fileUploadDraft, { reportFailure: false });
  const discard = useAtomCommand(openbot.fileDiscardDraft, { reportFailure: false });
  const originals = useRef(new Map<string, File>());
  const canUpload = useAtomValue(openbot.fileUploadDraft.permissionAtom(environmentId));
  const lock = useRef(false);
  const alive = useRef(true),
    transfers = useRef(new Set<AbortController>());
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Own temporary upload transports; an unmounted destination must not receive a late attachment.
  useEffect(() => {
    alive.current = true;
    const active = transfers.current;
    return () => {
      alive.current = false;
      for (const transfer of active) transfer.abort();
    };
  }, []);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const add = async (
    files: readonly File[],
    selectedCount: number,
    targetAgentId = agentId,
    notify = true,
  ) => {
    if (lock.current || (disabled && notify) || !canUpload || !files.length) return;
    if (selectedCount + files.length > 10) {
      setError("Choose up to 10 files for the first message.");
      return;
    }
    const connection = readPreparedConnection(environmentId);
    if (!connection) {
      setError("Reconnect before adding files.");
      return;
    }
    lock.current = true;
    setBusy(true);
    setError(null);
    const accepted: OpenbotDraftFile[] = [];
    try {
      for (const file of files) {
        if (file.size === 0 || file.size > 104_857_600)
          throw Error("Choose a nonempty file up to 100 MiB.");
        const mimeType = file.type || "application/octet-stream";
        const abort = new AbortController();
        transfers.current.add(abort);
        const pending = await runAttachmentUploadCycle({
          registry: appAtomRegistry,
          createUploadUrl: attachmentEnvironment.createUploadUrl,
          remove: attachmentEnvironment.remove,
          environmentId,
          upload: { type: "file", name: file.name, sizeBytes: file.size, mimeType },
          resolveUploadUrl: (relative) =>
            readPreparedConnection(environmentId) === connection
              ? resolveAssetUrl(connection.httpBaseUrl, relative)
              : null,
          transport: (url) => ({
            abort: () => abort.abort(),
            done: fetch(url, {
              method: "POST",
              body: file,
              headers: { "Content-Type": mimeType },
              signal: abort.signal,
            }).then((response) => {
              if (!response.ok) throw Error("The file upload failed.");
            }),
          }),
        });
        transfers.current.delete(abort);
        if (pending.status === "cancelled" || !alive.current) return;
        if (pending.status !== "uploaded") throw Error("The file upload did not complete.");
        if (readPreparedConnection(environmentId) !== connection)
          throw Error("The original connection changed. The file was not sent.");
        const result = await upload({
          environmentId,
          input: {
            hostId,
            agentId: targetAgentId,
            attachmentId: pending.attachmentId,
            name: file.name,
            mimeType,
            size: file.size,
          },
        });
        if (result._tag === "Failure") throw squashAtomCommandFailure(result);
        deletePendingAttachmentUpload({
          registry: appAtomRegistry,
          remove: attachmentEnvironment.remove,
          environmentId,
          attachmentId: pending.attachmentId,
        });
        if (readPreparedConnection(environmentId) !== connection)
          throw Error("The original connection changed. Reopen Files to recover the staged file.");
        accepted.push(result.value);
        originals.current.set(result.value.attachment.id, file);
        if (alive.current && notify) onReady(result.value);
      }
      return accepted;
    } catch (cause) {
      if (!notify)
        for (const draft of accepted) {
          originals.current.delete(draft.attachment.id);
          await discard({
            environmentId,
            input: { hostId, agentId: targetAgentId, attachmentId: draft.attachment.id },
          }).catch(() => undefined);
        }
      if (alive.current)
        setError(
          cause instanceof Error
            ? cause.message
            : "The file upload could not be confirmed. Check Files before uploading again.",
        );
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  };
  const reassign = async (drafts: readonly OpenbotDraftFile[], nextAgentId: string) => {
    const files = drafts.map((draft) => originals.current.get(draft.attachment.id));
    if (files.some((file) => !file))
      throw Error("Choose the original files again before moving this draft to another agent.");
    const moved = await add(
      files.filter((file): file is File => file !== undefined),
      0,
      nextAgentId,
      false,
    );
    if (!moved || moved.length !== drafts.length) return null;
    return moved;
  };
  const discardUnused = async (drafts: readonly OpenbotDraftFile[]) => {
    for (const draft of drafts) {
      originals.current.delete(draft.attachment.id);
      await discard({
        environmentId,
        input: { hostId, agentId: draft.agentId, attachmentId: draft.attachment.id },
      }).catch(() => undefined);
    }
  };
  return { add, reassign, discardUnused, busy, error, available: canUpload && !disabled && !busy };
}
