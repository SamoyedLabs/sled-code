import { sha256 } from "@noble/hashes/sha2";
import { bytesToHex } from "@noble/hashes/utils";
import {
  OpenbotArchiveUpload,
  OpenbotMaterializedFile,
  type EnvironmentId,
} from "@t3tools/contracts";
import {
  OpenbotPendingTransfer,
  OpenbotTransferReceipt,
  OpenbotTransferSummary,
  type OpenbotTransferCommand,
  type OpenbotTransferExportOptions,
} from "@t3tools/contracts/openbot-instance-transfer";
import { resolveAssetUrl } from "@t3tools/client-runtime/state/assets";
import {
  executeAtomQuery,
  runAtomCommand,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { CryptoDigestAlgorithm, digestStringAsync, randomUUID } from "expo-crypto";
import { File, FileMode, UploadType } from "expo-file-system";
import * as SecureStore from "expo-secure-store";
import { downloadAttachmentForPreview } from "../../lib/attachmentDownload";
import { assetEnvironment } from "../../state/assets";
import { appAtomRegistry } from "../../state/atom-registry";
import { openbot } from "../../state/openbot";
import { environmentSession } from "../../state/session";

export type BotTransferHost = { environmentId: EnvironmentId; hostId: string };
export type BotTransferSummary = typeof OpenbotTransferSummary.Type;
type Request = OpenbotTransferCommand extends infer Command
  ? Command extends { hostId: string }
    ? Omit<Command, "hostId">
    : never
  : never;
const archiveLimit = 100 * 1024 * 1024;
const decodeSummary = Schema.decodeUnknownSync(OpenbotTransferSummary);
const decodeReceipt = Schema.decodeUnknownSync(OpenbotTransferReceipt);
const decodeRecovery = Schema.decodeUnknownSync(Schema.NullOr(OpenbotTransferReceipt));
const decodePending = Schema.decodeUnknownSync(OpenbotPendingTransfer);
const decodeExport = Schema.decodeUnknownSync(Schema.Struct({ file: OpenbotMaterializedFile }));
const decodeUpload = Schema.decodeUnknownSync(OpenbotArchiveUpload);

export async function bindBotTransfer(
  { environmentId, hostId }: BotTransferHost,
  signal: AbortSignal,
) {
  const connectionAtom = environmentSession.preparedConnectionValueAtom(environmentId);
  const connection = Option.getOrNull(appAtomRegistry.get(connectionAtom));
  const check = () => {
    signal.throwIfAborted();
    if (!connection || Option.getOrNull(appAtomRegistry.get(connectionAtom)) !== connection)
      throw new Error("The server connection changed. Reopen Transfer to recover its status.");
    return connection;
  };
  check();
  const binding = await executeAtomQuery(
    appAtomRegistry,
    openbot.fileContext({ environmentId, input: { hostId } }),
    { label: "Bind server transfer", refresh: true, reportFailure: false, signal },
  );
  check();
  if (binding._tag === "Failure") throw squashAtomCommandFailure(binding);
  if (binding.value.hostId !== hostId) throw new Error("The bot server changed.");
  const fingerprint = await digestStringAsync(
    CryptoDigestAlgorithm.SHA256,
    JSON.stringify([environmentId, hostId, binding.value.principalId]),
  );
  const receiptKey = `sled.bot.transfer.${fingerprint}`;
  const execute = async (request: Request) => {
    check();
    const result = await runAtomCommand(
      appAtomRegistry,
      openbot.instanceTransfer,
      { environmentId, input: { ...request, hostId } },
      { reportFailure: false },
    );
    check();
    if (result._tag === "Failure") throw squashAtomCommandFailure(result);
    return result.value;
  };
  const remember = async (requestId: string) => {
    check();
    await SecureStore.setItemAsync(receiptKey, requestId);
    if ((await SecureStore.getItemAsync(receiptKey)) !== requestId)
      throw new Error("The import receipt could not be saved.");
    check();
  };
  return {
    check,
    summary: async () => decodeSummary(await execute({ operation: "summary" })),
    recover: async () => {
      const requestId = await SecureStore.getItemAsync(receiptKey);
      if (requestId) {
        const receipt = decodeRecovery(await execute({ operation: "recover", requestId }));
        return { requestId, receipt };
      }
      const pending = decodePending(await execute({ operation: "pending" }));
      if (pending) await remember(pending.requestId);
      return pending;
    },
    forget: async () => {
      check();
      await SecureStore.deleteItemAsync(receiptKey);
    },
    stage: async (source: File, name: string) => {
      const size = source.size;
      if (
        !source.exists ||
        size === null ||
        size < 1 ||
        size > archiveLimit ||
        !/\.zip$/i.test(name)
      )
        throw new Error("Choose a nonempty ZIP file up to 100 MiB.");
      const { uploadId, relativeUrl } = decodeUpload(
        await execute({ operation: "upload", name, size }),
      );
      const url = resolveAssetUrl(check().httpBaseUrl, relativeUrl);
      if (!url) throw new Error("The archive upload is unavailable.");
      const response = await source
        .upload(url, {
          httpMethod: "PUT",
          uploadType: UploadType.BINARY_CONTENT,
          headers: { "Content-Type": "application/zip" },
          signal,
        })
        .catch(() => {
          throw new Error("The archive upload was interrupted.");
        });
      check();
      if (response.status < 200 || response.status >= 300)
        throw new Error("The archive upload did not complete.");
      const requestId = randomUUID();
      await remember(requestId);
      const receipt = decodeReceipt(await execute({ operation: "stage", requestId, uploadId }));
      return { requestId, receipt };
    },
    apply: async (token: string, keys: readonly string[], includeSettings: boolean) =>
      decodeReceipt(
        await execute({
          operation: "apply",
          token,
          keys,
          includeSettings,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        }),
      ),
    discard: async (token: string) => decodeReceipt(await execute({ operation: "discard", token })),
    download: async (options: typeof OpenbotTransferExportOptions.Type) => {
      const { file } = decodeExport(await execute({ operation: "export", ...options }));
      const atom = assetEnvironment.createUrl({
        environmentId,
        input: {
          resource: {
            _tag: "attachment",
            attachmentId: file.attachmentId,
            fileName: file.name,
            mimeType: file.mimeType,
            disposition: "attachment",
          },
        },
      });
      const result = await executeAtomQuery(appAtomRegistry, atom, {
        label: "Authorize transfer download",
        refresh: true,
        reportFailure: false,
        signal,
      });
      const baseUrl = check().httpBaseUrl;
      if (result._tag === "Failure") throw squashAtomCommandFailure(result);
      const url = resolveAssetUrl(baseUrl, result.value.relativeUrl);
      if (!url) throw new Error("The transfer download is unavailable.");
      const local = await downloadAttachmentForPreview({ url, attachment: file, signal });
      if (!local) throw new Error("The transfer download was interrupted.");
      try {
        const archive = new File(local.uri);
        if (archive.size !== file.size || file.size > archiveLimit)
          throw new Error("The archive size differs from the original.");
        const handle = archive.open(FileMode.ReadOnly);
        const hash = sha256.create();
        try {
          for (let remaining = file.size; remaining > 0;) {
            check();
            const bytes = await handle.readBytes(Math.min(1_048_576, remaining));
            if (bytes.length === 0) throw new Error("The archive download is incomplete.");
            remaining -= bytes.length;
            hash.update(bytes);
          }
          if (bytesToHex(hash.digest()) !== file.sha256)
            throw new Error("The downloaded archive differs from the original.");
        } finally {
          handle.close();
          hash.destroy();
        }
        return { local, archive, name: file.name };
      } catch (error) {
        local.dispose();
        throw error;
      }
    },
  };
}
