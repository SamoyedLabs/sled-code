import * as Effect from "effect/Effect";
import { randomUUID } from "../../lib/utils";
import type { EnvironmentId } from "@t3tools/contracts";
import {
  AttachmentTransferError,
  runAttachmentUploadCycle,
} from "@t3tools/client-runtime/state/attachments";
import { resolveAssetUrl } from "@t3tools/client-runtime/state/assets";
import { appAtomRegistry } from "../../rpc/atomRegistry";
import { attachmentEnvironment } from "../../state/attachments";
import { readPreparedConnection } from "../../state/session";
import type { OpenbotOriginalUploadIdentity } from "@t3tools/contracts";
export async function pickQueueAttachment(
  environmentId: EnvironmentId,
  file: File,
  target: Pick<OpenbotOriginalUploadIdentity, "hostId" | "agentId" | "threadId" | "taskId">,
) {
  if (file.size <= 0 || file.size > 104857600)
    throw new Error("Choose an available file up to 100 MB.");
  const mimeType = file.type || "application/octet-stream";
  const hash = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  const sha256 = Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, "0")).join("");
  const identity = {
    ...target,
    operationId: randomUUID(),
    name: file.name,
    mimeType,
    size: file.size,
    sha256,
  };
  const pending = await Effect.runPromise(
    runAttachmentUploadCycle({
      registry: appAtomRegistry,
      createUploadUrl: attachmentEnvironment.createUploadUrl,
      remove: attachmentEnvironment.remove,
      environmentId,
      upload: { type: "file", name: file.name, sizeBytes: file.size, mimeType },
      resolveUploadUrl: (relative) => {
        const connection = readPreparedConnection(environmentId);
        return connection ? resolveAssetUrl(connection.httpBaseUrl, relative) : null;
      },
      transport: (url) =>
        Effect.tryPromise({
          try: (signal) =>
            // @effect-diagnostics-next-line globalFetchInEffect:off
            fetch(url, {
              method: "POST",
              body: file,
              headers: { "Content-Type": mimeType },
              signal,
            }).then((response) => {
              if (!response.ok) throw new AttachmentTransferError({ cause: "File upload failed." });
            }),
          catch: (cause) => new AttachmentTransferError({ cause }),
        }),
    }),
  );
  if (pending.status === "failed") throw pending.error;
  return { identity, attachmentId: pending.attachmentId };
}
