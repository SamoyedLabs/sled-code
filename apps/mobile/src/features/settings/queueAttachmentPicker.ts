import type { EnvironmentId } from "@t3tools/contracts";
import {
  AttachmentTransferError,
  runAttachmentUploadCycle,
} from "@t3tools/client-runtime/state/attachments";
import { resolveAssetUrl } from "@t3tools/client-runtime/state/assets";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { appAtomRegistry } from "../../state/atom-registry";
import { attachmentEnvironment } from "../../state/attachments";
import { environmentSession } from "../../state/session";
import { beginForegroundHandoff } from "../../lib/foreground-handoff";
import type { OpenbotOriginalUploadIdentity } from "@t3tools/contracts";
export async function pickQueueAttachment(
  environmentId: EnvironmentId,
  target: Pick<OpenbotOriginalUploadIdentity, "hostId" | "agentId" | "threadId" | "taskId">,
) {
  const { getDocumentAsync } = await import("expo-document-picker");
  const finish = beginForegroundHandoff();
  const picked = await getDocumentAsync({ multiple: false, copyToCacheDirectory: true }).finally(
    finish,
  );
  if (picked.canceled || !picked.assets[0]) return null;
  const selected = picked.assets[0];
  const { File, UploadType } = await import("expo-file-system");
  const file = new File(selected.uri),
    size = file.size;
  if (!file.exists || size === null || size <= 0 || size > 104857600)
    throw new Error("Choose an available file up to 100 MB.");
  const { randomUUID, digest, CryptoDigestAlgorithm } = await import("expo-crypto");
  const bytes = await file.bytes();
  const sha256 = Array.from(
    new Uint8Array(await digest(CryptoDigestAlgorithm.SHA256, bytes)),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
  const name = selected.name || "file",
    mimeType = selected.mimeType || "application/octet-stream";
  const identity = { ...target, operationId: randomUUID(), name, mimeType, size, sha256 };
  const pending = await Effect.runPromise(
    runAttachmentUploadCycle({
      registry: appAtomRegistry,
      createUploadUrl: attachmentEnvironment.createUploadUrl,
      remove: attachmentEnvironment.remove,
      environmentId,
      upload: { type: "file", name, sizeBytes: size, mimeType },
      resolveUploadUrl: (relative) => {
        const connection = appAtomRegistry.get(
          environmentSession.preparedConnectionValueAtom(environmentId),
        );
        return Option.isSome(connection)
          ? resolveAssetUrl(connection.value.httpBaseUrl, relative)
          : null;
      },
      transport: (url) =>
        Effect.tryPromise({
          try: (signal) =>
            file
              .upload(url, {
                httpMethod: "POST",
                uploadType: UploadType.BINARY_CONTENT,
                headers: { "Content-Type": mimeType },
                signal,
              })
              .then((response) => {
                if (response.status < 200 || response.status >= 300)
                  throw new AttachmentTransferError({ cause: "File upload failed." });
              }),
          catch: (cause) => new AttachmentTransferError({ cause }),
        }),
    }),
  );
  if (pending.status === "failed") throw pending.error;
  return { identity, attachmentId: pending.attachmentId };
}
