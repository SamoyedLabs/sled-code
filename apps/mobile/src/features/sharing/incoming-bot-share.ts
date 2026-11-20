import { resolveOwnedComposerAttachmentFileUri } from "../../lib/composerAttachmentFiles";
import type { IncomingShareDraft } from "./incoming-share-model";
import { isShareFileUriUnderOwnedRoots } from "./incoming-share-model";

/** Read only the exact copied inbox object, never a host path or a fresh picker result. */
export async function incomingBotShareFile(share: IncomingShareDraft, sourceId: string) {
  const item = share.attachments.find((a) => a.id === sourceId);
  if (!item) throw new Error("Shared attachment is no longer available.");
  const { File, Paths } = await import("expo-file-system");
  if (item.type === "image" && item.dataUrl) {
    const prefix = `data:${item.mimeType};base64,`;
    if (!item.dataUrl.startsWith(prefix)) throw new Error("Shared image identity changed.");
    // Native ingestion already copied these bytes into the durable inbox JSON.
    const bytes = Uint8Array.from(atob(item.dataUrl.slice(prefix.length)), (c) => c.charCodeAt(0));
    if (bytes.length !== item.sizeBytes) throw new Error("Shared image size changed.");
    return { item, bytes };
  }
  const uri = item.fileUri
    ? (resolveOwnedComposerAttachmentFileUri(item.fileUri, Paths.document.uri) ?? item.fileUri)
    : null;
  if (!uri || !isShareFileUriUnderOwnedRoots(uri, [Paths.document.uri, Paths.cache.uri]))
    throw new Error("Shared file is not an app-owned copy.");
  const file = new File(uri);
  if (!file.exists || file.size !== item.sizeBytes)
    throw new Error("Shared file changed or is unavailable.");
  return { item, bytes: await file.bytes() };
}

/** Uses the same environment upload cycle and Files command as BotFiles. */
export async function uploadIncomingBotShare(input: {
  share: IncomingShareDraft;
  sourceId: string;
  identity?: import("../../../../../packages/contracts/src/openbotFiles").OpenbotOriginalUploadIdentity;
  originalUpload?: (
    input: import("../../../../../packages/contracts/src/openbotFiles").OpenbotOriginalUploadInput,
  ) => Promise<{
    state: "absent" | "released" | "ready";
    draft: import("@t3tools/contracts").OpenbotDraftFile | null;
  }>;
  environmentId: import("@t3tools/contracts").EnvironmentId;
  hostId: string;
  agentId: string;
  assertCurrent: () => void;
  uploadDraft: (
    input: import("@t3tools/contracts").OpenbotFileUploadInput,
  ) => Promise<import("@t3tools/contracts").OpenbotDraftFile>;
}) {
  input.assertCurrent();
  const { item, bytes } = await incomingBotShareFile(input.share, input.sourceId);
  input.assertCurrent();
  if (!input.identity || !input.originalUpload)
    throw new Error("Authenticated original upload is unavailable.");
  const { CryptoDigestAlgorithm, digest } = await import("expo-crypto");
  const hash = Array.from(new Uint8Array(await digest(CryptoDigestAlgorithm.SHA256, bytes)), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
  if (hash !== input.identity.sha256) throw new Error("Shared source bytes changed.");
  const { runAttachmentUploadCycle, deletePendingAttachmentUpload } =
    await import("@t3tools/client-runtime/state/attachments");
  const { resolveAssetUrl } = await import("@t3tools/client-runtime/state/assets");
  const { appAtomRegistry } = await import("../../state/atom-registry");
  const { attachmentEnvironment } = await import("../../state/attachments");
  const { environmentSession } = await import("../../state/session");
  const Option = await import("effect/Option");
  const { fetch } = await import("expo/fetch");
  const abort = new AbortController();
  input.assertCurrent();
  const uploaded = await runAttachmentUploadCycle({
    registry: appAtomRegistry,
    createUploadUrl: attachmentEnvironment.createUploadUrl,
    remove: attachmentEnvironment.remove,
    environmentId: input.environmentId,
    upload: { type: "file", name: item.name, sizeBytes: bytes.length, mimeType: item.mimeType },
    resolveUploadUrl: (relativeUrl) => {
      input.assertCurrent();
      const connection = appAtomRegistry.get(
        environmentSession.preparedConnectionValueAtom(input.environmentId),
      );
      return Option.isSome(connection)
        ? resolveAssetUrl(connection.value.httpBaseUrl, relativeUrl)
        : null;
    },
    transport: (url) => ({
      abort: () => abort.abort(),
      done: fetch(url, {
        method: "POST",
        body: bytes,
        headers: { "Content-Type": item.mimeType },
        signal: abort.signal,
      }).then((response) => {
        if (!response.ok) throw new Error("Shared file upload failed.");
      }),
    }),
  });
  if (uploaded.status !== "uploaded") throw new Error("Shared file upload was not confirmed.");
  input.assertCurrent();
  const outcome = await input.originalUpload({
    ...input.identity,
    hostId: input.hostId,
    agentId: input.agentId,
    attachmentId: uploaded.attachmentId,
    name: item.name,
    mimeType: item.mimeType,
    size: bytes.length,
  });
  if (outcome.state !== "ready" || !outcome.draft)
    throw new Error("Original upload is not confirmed. Source retained.");
  const receipt = outcome.draft;
  if (
    receipt.attachment.size !== bytes.length ||
    receipt.attachment.name !== item.name ||
    receipt.attachment.mimeType !== item.mimeType
  )
    throw new Error("Shared file receipt changed.");
  deletePendingAttachmentUpload({
    registry: appAtomRegistry,
    remove: attachmentEnvironment.remove,
    environmentId: input.environmentId,
    attachmentId: uploaded.attachmentId,
  });
  return receipt;
}

/** Compose with the app-lifetime inbox instance; C owns exposing that instance and mounting. */
export function createIncomingBotSharePorts(input: {
  inbox: import("./incoming-share-inbox").IncomingShareInbox;
  shareId: string;
  destination: import("@t3tools/client-runtime/openbot/incoming-share").BotShareDestination;
  publish: (drafts: readonly IncomingShareDraft[]) => void;
  current: import("@t3tools/client-runtime/openbot/incoming-share").BotSharePorts["current"];
  list: import("@t3tools/client-runtime/openbot/incoming-share").BotSharePorts["list"];
  send: import("@t3tools/client-runtime/openbot/incoming-share").BotSharePorts["send"];
  discard: import("@t3tools/client-runtime/openbot/incoming-share").BotSharePorts["discard"];
  uploadDraft: Parameters<typeof uploadIncomingBotShare>[0]["uploadDraft"];
  originalUpload?: Parameters<typeof uploadIncomingBotShare>[0]["originalUpload"];
  cancelUpload?: import("@t3tools/client-runtime/openbot/incoming-share").BotSharePorts["cancelUpload"];
  recoverUpload?: import("@t3tools/client-runtime/openbot/incoming-share").BotSharePorts["recoverUpload"];
}): import("@t3tools/client-runtime/openbot/incoming-share").BotSharePorts {
  const read = async () => {
    const drafts = await input.inbox.refresh({ ingestNative: false });
    const share = drafts.find((d) => d.id === input.shareId);
    if (!share || share.destination)
      throw new Error("The share is unavailable or reserved for a project.");
    return share;
  };
  const assertCurrent = () => {
    const now = input.current();
    if (!now || JSON.stringify(now) !== JSON.stringify(input.destination))
      throw new Error("Share destination changed.");
  };
  return {
    read: async () => {
      const share = await read();
      return {
        id: share.id,
        text: share.text,
        sourceIds: share.attachments.map((a) => a.id),
        transfer: share.botTransfer ?? null,
      };
    },
    save: async (expected, next) =>
      input.publish(await input.inbox.updateBotTransfer(input.shareId, expected, next)),
    consume: async (expected) =>
      input.publish(await input.inbox.consumeBotTransfer(input.shareId, expected)),
    prepareUpload: async (sourceId) => {
      assertCurrent();
      const { item, bytes } = await incomingBotShareFile(await read(), sourceId);
      const { randomUUID, digest, CryptoDigestAlgorithm } = await import("expo-crypto");
      const sha256 = Array.from(
        new Uint8Array(await digest(CryptoDigestAlgorithm.SHA256, bytes)),
        (b) => b.toString(16).padStart(2, "0"),
      ).join("");
      assertCurrent();
      return {
        operationId: randomUUID(),
        hostId: input.destination.hostId,
        agentId: input.destination.agentId,
        threadId: input.destination.threadId,
        taskId: input.destination.target.kind === "task" ? input.destination.target.taskId : null,
        name: item.name,
        mimeType: item.mimeType,
        size: bytes.length,
        sha256,
      };
    },
    recoverUpload: input.recoverUpload,
    cancelUpload: input.cancelUpload,
    upload: async (sourceId, identity) => {
      assertCurrent();
      const { EnvironmentId } = await import("@t3tools/contracts");
      return uploadIncomingBotShare({
        share: await read(),
        sourceId,
        identity,
        originalUpload: input.originalUpload,
        environmentId: EnvironmentId.make(input.destination.environmentId),
        hostId: input.destination.hostId,
        agentId: input.destination.agentId,
        assertCurrent,
        uploadDraft: input.uploadDraft,
      });
    },
    current: input.current,
    list: input.list,
    send: input.send,
    discard: input.discard,
  };
}
