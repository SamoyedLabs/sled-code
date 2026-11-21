import {
  OpenbotDraftFile,
  OpenbotOriginalUploadIdentity,
  type EnvironmentId,
} from "@t3tools/contracts";
import {
  AttachmentTransferError,
  runAttachmentUploadCycle,
  deletePendingAttachmentUpload,
} from "@t3tools/client-runtime/state/attachments";
import { resolveAssetUrl } from "@t3tools/client-runtime/state/assets";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type * as Cause from "effect/Cause";
import { workspaceUploadRetry, sameWorkspaceUploadTarget } from "./workspaceOriginalUpload";
import { randomUUID } from "../../../lib/utils";
import * as Schema from "effect/Schema";
import { appAtomRegistry } from "../../../rpc/atomRegistry";
import { attachmentEnvironment } from "../../../state/attachments";
import { openbot } from "../../../state/openbot";
import { readPreparedConnection } from "../../../state/session";
import * as Effect from "effect/Effect";
import { useAtomCommand } from "../../../state/use-atom-command";
import { useAtomQueryRunner } from "../../../state/use-atom-query-runner";

const Scope = Schema.Struct({
  agentId: Schema.String,
  taskId: Schema.NullOr(Schema.String),
  threadId: Schema.optional(Schema.String),
});
const Snapshot = Schema.Struct({ agentId: Schema.String, threadId: Schema.String });
export const WorkspaceUploadRecord = Schema.Struct({
  principal: Schema.String,
  identity: OpenbotOriginalUploadIdentity,
  phase: Schema.Literals(["uploading", "ready", "sending", "sent", "released"]),
  draft: Schema.NullOr(OpenbotDraftFile),
  temporaryAttachmentId: Schema.optional(Schema.String),
});
export type WorkspaceUploadRecord = typeof WorkspaceUploadRecord.Type;
type UploadRecord = WorkspaceUploadRecord;
export type WorkspaceUploadControl = {
  signal?: AbortSignal;
  current?: () => boolean;
  onIdentity?: (identity: OpenbotOriginalUploadIdentity) => void;
};
const decodeRecord = Schema.decodeUnknownSync(WorkspaceUploadRecord);
const decodeScope = Schema.decodeUnknownSync(Scope);
const decodeSnapshot = Schema.decodeUnknownSync(Snapshot);
function ok<T>(
  result: { _tag: "Success"; value: T } | { _tag: "Failure"; cause: Cause.Cause<unknown> },
): T {
  if (result._tag === "Failure") throw squashAtomCommandFailure(result);
  return result.value;
}
/** The backend Files journal owns send idempotency. This local journal retains the original upload identity across reloads. */
export function useWorkspaceFiles(environmentId: EnvironmentId, hostId: string | null) {
  const context = useAtomQueryRunner(openbot.fileContext, { refresh: true, reportFailure: false });
  const read = useAtomCommand(openbot.dataRead, { reportFailure: false });
  const upload = useAtomCommand(openbot.fileOriginalUpload, { reportFailure: false });
  const recover = useAtomCommand(openbot.fileRecoverUpload, { reportFailure: false });
  const cancel = useAtomCommand(openbot.fileCancelUpload, { reportFailure: false });
  const send = useAtomCommand(openbot.fileSendDraft, { reportFailure: false });
  const drafts = useAtomQueryRunner(openbot.fileDrafts, { refresh: true, reportFailure: false });
  return async (
    action: string,
    args: Record<string, unknown>,
    control: WorkspaceUploadControl = {},
  ) => {
    if (!hostId || args.hostId !== hostId) throw new Error("The file destination changed.");
    const connection = readPreparedConnection(environmentId);
    if (!connection) throw new Error("Reconnect the original session.");
    const principal = ok(await context({ environmentId, input: { hostId } })).principalId;
    const check = async () => {
      if (control.current?.() === false || readPreparedConnection(environmentId) !== connection)
        throw new Error("The original session changed.");
      if (
        ok(await context({ environmentId, input: { hostId } })).principalId !== principal ||
        control.current?.() === false ||
        readPreparedConnection(environmentId) !== connection
      )
        throw new Error("The original session changed.");
    };
    const prefix = `sled.workspace-original.v1:${JSON.stringify([environmentId, hostId, principal])}:`;
    const save = (record: UploadRecord) =>
      localStorage.setItem(prefix + record.identity.operationId, JSON.stringify(record));
    const cleanTemporary = (record: UploadRecord) => {
      if (record.temporaryAttachmentId)
        deletePendingAttachmentUpload({
          registry: appAtomRegistry,
          remove: attachmentEnvironment.remove,
          environmentId,
          attachmentId: record.temporaryAttachmentId,
        });
    };
    const records = () =>
      Object.keys(localStorage)
        .filter((key) => key.startsWith(prefix))
        .map((key) => decodeRecord(JSON.parse(localStorage.getItem(key)!)));
    if (action === "original-pending") {
      const scope = decodeScope(args.target);
      await check();
      return records().filter(
        (record) =>
          record.phase === "uploading" &&
          sameWorkspaceUploadTarget(record.identity, { ...scope, hostId }),
      );
    }
    if (action === "original-recover" || action === "original-release") {
      const record = records().find((item) => item.identity.operationId === args.operationId);
      const scope = decodeScope(args.target);
      if (!record || !sameWorkspaceUploadTarget(record.identity, { ...scope, hostId }))
        throw new Error("The original upload belongs to another conversation.");
      if (record.phase === "sending" || record.phase === "sent")
        throw new Error("This file has an unresolved delivery.");
      await check();
      const receipt = ok(
        await (action === "original-release" ? cancel : recover)({
          environmentId,
          input: { ...record.identity, principalId: principal },
        }),
      );
      if (receipt.state === "ready" && receipt.draft) {
        save({ ...record, phase: "ready", draft: receipt.draft });
        cleanTemporary(record);
        await check();
        if (action === "original-release") throw new Error("File release has not been confirmed.");
        return { ...receipt.draft.attachment, previewUrl: null };
      }
      if (
        action === "original-release" &&
        (receipt.state === "released" || receipt.state === "absent")
      ) {
        save({ ...record, phase: "released", draft: receipt.draft });
        if (record.temporaryAttachmentId)
          deletePendingAttachmentUpload({
            registry: appAtomRegistry,
            remove: attachmentEnvironment.remove,
            environmentId,
            attachmentId: record.temporaryAttachmentId,
          });
        await check();
        return null;
      }
      await check();
      throw new Error(
        receipt.state === "released"
          ? "The original upload was cancelled."
          : "No ready upload receipt. Choose the original file again to retry it, or remove this upload.",
      );
    }
    if (action === "original-upload") {
      const scope = decodeScope(args.target);
      if (!(args.file instanceof File) || args.file.size < 1 || args.file.size > 104857600)
        throw new Error("Choose a file up to 100 MB.");
      const file = args.file;
      const snapshot = decodeSnapshot(
        ok(
          await read({
            environmentId,
            input: {
              hostId,
              request: scope.taskId
                ? { operation: "task.read", agentId: scope.agentId, taskId: scope.taskId }
                : { operation: "conversation.read", agentId: scope.agentId },
            },
          }),
        ),
      );
      if (
        snapshot.agentId !== scope.agentId ||
        (scope.threadId && snapshot.threadId !== scope.threadId)
      )
        throw new Error("The upload conversation changed.");
      const sha256 = Array.from(
        new Uint8Array(await crypto.subtle.digest("SHA-256", await file.arrayBuffer())),
        (b) => b.toString(16).padStart(2, "0"),
      ).join("");
      await check();
      const previous = workspaceUploadRetry(
        records(),
        {
          ...scope,
          hostId,
          threadId: snapshot.threadId,
          sha256,
          name: file.name,
          size: file.size,
          mimeType: file.type || "application/octet-stream",
        },
        args.operationId,
      );
      if (previous) {
        control.onIdentity?.(previous.identity);
        const receipt = ok(
          await recover({ environmentId, input: { ...previous.identity, principalId: principal } }),
        );
        if (receipt.state === "ready" && receipt.draft) {
          save({ ...previous, phase: "ready", draft: receipt.draft });
          cleanTemporary(previous);
          await check();
          return { ...receipt.draft.attachment, previewUrl: null };
        }
        await check();
        if (receipt.state === "released")
          throw new Error("The original upload was cancelled. Remove it before starting another.");
        // An absent receipt may retry the same identity and original bytes, never a fresh operation.
      }
      const identity = previous?.identity ?? {
        ...scope,
        hostId,
        threadId: snapshot.threadId,
        operationId: randomUUID(),
        name: file.name,
        size: file.size,
        mimeType: file.type || "application/octet-stream",
        sha256,
      };
      let record: UploadRecord = { principal, identity, phase: "uploading", draft: null };
      if (control.signal?.aborted) throw new Error("Upload cancelled.");
      save(record);
      control.onIdentity?.(identity);
      const abort = new AbortController();
      const cancelTransfer = () => abort.abort();
      control.signal?.addEventListener("abort", cancelTransfer, { once: true });
      const temporary = await Effect.runPromise(
        runAttachmentUploadCycle({
          registry: appAtomRegistry,
          createUploadUrl: attachmentEnvironment.createUploadUrl,
          remove: attachmentEnvironment.remove,
          environmentId,
          onMinted: (attachmentId) => {
            record = { ...record, temporaryAttachmentId: attachmentId };
            save(record);
            return control.signal?.aborted || control.current?.() === false ? "cancel" : "continue";
          },
          upload: {
            type: "file",
            name: identity.name,
            sizeBytes: identity.size,
            mimeType: identity.mimeType,
          },
          resolveUploadUrl: (relative) =>
            readPreparedConnection(environmentId) === connection
              ? resolveAssetUrl(connection.httpBaseUrl, relative)
              : null,
          transport: (url) =>
            Effect.tryPromise({
              try: (signal) => {
                const onAbort = () => abort.abort();
                signal.addEventListener("abort", onAbort, { once: true });
                // @effect-diagnostics-next-line globalFetchInEffect:off
                return fetch(url, {
                  method: "POST",
                  body: file,
                  headers: { "Content-Type": identity.mimeType },
                  signal: abort.signal,
                })
                  .then((response) => {
                    if (!response.ok)
                      throw new AttachmentTransferError({ cause: "File upload failed." });
                  })
                  .finally(() => signal.removeEventListener("abort", onAbort));
              },
              catch: (cause) => new AttachmentTransferError({ cause }),
            }),
        }),
      );
      control.signal?.removeEventListener("abort", cancelTransfer);
      if (temporary.status !== "uploaded")
        throw new Error("The file upload did not complete. Original identity retained.");
      await check();
      if (control.signal?.aborted)
        throw new Error("Upload cancelled. Remove it to release the original reservation.");
      const receipt = ok(
        await upload({
          environmentId,
          input: { ...identity, principalId: principal, attachmentId: temporary.attachmentId },
        }),
      );
      if (receipt.state !== "ready" || !receipt.draft)
        throw new Error("Original file receipt is not ready.");
      // Save a late authoritative receipt even if its original view detached during the RPC.
      save({ ...record, phase: "ready", draft: receipt.draft });
      deletePendingAttachmentUpload({
        registry: appAtomRegistry,
        remove: attachmentEnvironment.remove,
        environmentId,
        attachmentId: temporary.attachmentId,
      });
      await check();
      return { ...receipt.draft.attachment, previewUrl: null };
    }
    if (action === "original-discard") {
      const record = records().find((item) => item.draft?.attachment.id === args.attachmentId);
      if (!record || record.phase === "sending" || record.phase === "sent")
        throw new Error("This file cannot be discarded while its delivery is unresolved.");
      await check();
      const receipt = ok(
        await cancel({ environmentId, input: { ...record.identity, principalId: principal } }),
      );
      if (receipt.state !== "released" && receipt.state !== "absent")
        throw new Error("Original file release is not confirmed.");
      save({ ...record, phase: "released", draft: receipt.draft });
      return null;
    }
    if (action === "original-send") {
      const scope = decodeScope(args.target);
      const ids = Schema.decodeUnknownSync(
        Schema.Array(Schema.String).check(Schema.isMinLength(1), Schema.isMaxLength(10)),
      )(args.attachmentIds);
      if (new Set(ids).size !== ids.length || typeof args.text !== "string")
        throw new Error("Invalid attachment send.");
      const all = records();
      const selected = ids.map((id) => {
        const record = all.find((item) => item.draft?.attachment.id === id);
        if (
          !record ||
          record.identity.agentId !== scope.agentId ||
          record.identity.taskId !== scope.taskId ||
          record.phase === "released" ||
          record.phase === "uploading"
        )
          throw new Error("The file belongs to another destination or original session.");
        return record;
      });
      const threadId = selected[0]!.identity.threadId;
      if (selected.some((item) => item.identity.threadId !== threadId))
        throw new Error("Files span different conversation identities.");
      await check();
      // The existing backend journal returns receipts only once sending began; it never resends an uncertain mutation.
      for (const item of selected) save({ ...item, phase: "sending" });
      const receipt = ok(
        await send({
          environmentId,
          input: {
            hostId,
            agentId: scope.agentId,
            attachmentId: ids[0]!,
            attachmentIds: ids,
            expectedThreadId: threadId,
            text: args.text,
            target: scope.taskId ? { kind: "task", taskId: scope.taskId } : { kind: "main" },
            ...(typeof args.replyToMessageId === "string"
              ? { replyToMessageId: args.replyToMessageId }
              : {}),
          },
        }),
      );
      await check();
      if (receipt.state !== "sent" || !receipt.messageId)
        throw new Error("Delivery remains unconfirmed. Retry only checks the original receipt.");
      const state = ok(await drafts({ environmentId, input: { hostId, agentId: scope.agentId } }));
      for (const item of selected) {
        const accepted = state.find((draft) => draft.attachment.id === item.draft!.attachment.id);
        if (!accepted || accepted.state !== "sent" || accepted.messageId !== receipt.messageId)
          throw new Error("The complete attachment batch is not confirmed.");
        save({ ...item, phase: "sent", draft: accepted });
      }
      return receipt;
    }
    throw new Error("Unsupported original file operation.");
  };
}
