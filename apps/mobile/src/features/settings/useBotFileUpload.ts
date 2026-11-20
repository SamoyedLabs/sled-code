import { useAtomValue } from "@effect/atom-react";
import {
  OPENBOT_MAX_FILE_BYTES,
  PROVIDER_SEND_TURN_MAX_FILE_BYTES,
  type EnvironmentId,
} from "@t3tools/contracts";
import { resolveAssetUrl } from "@t3tools/client-runtime/state/assets";
import {
  deletePendingAttachmentUpload,
  formatAttachmentSize,
  runAttachmentUploadCycle,
} from "@t3tools/client-runtime/state/attachments";
import { runAtomCommand, squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import * as Option from "effect/Option";
import { useLayoutEffect, useRef, useState } from "react";
import { Platform } from "react-native";
import { beginForegroundHandoff } from "../../lib/foreground-handoff";
import { appAtomRegistry } from "../../state/atom-registry";
import { attachmentEnvironment } from "../../state/attachments";
import { openbot } from "../../state/openbot";
import { environmentSession } from "../../state/session";
import { useBotChatAppearance } from "../bots/botChatAppearance";

export type BotFilePicker = "files" | "photos" | "camera";

export async function chooseBotFile(source: BotFilePicker) {
  const endHandoff = beginForegroundHandoff();
  try {
    if (source === "files") {
      const { getDocumentAsync } = await import("expo-document-picker");
      const picked = await getDocumentAsync({ multiple: false, copyToCacheDirectory: true });
      const asset = picked.assets?.[0];
      return asset ? { uri: asset.uri, name: asset.name, mimeType: asset.mimeType } : null;
    }
    const picker = await import("expo-image-picker");
    if (source === "camera" && !(await picker.requestCameraPermissionsAsync()).granted)
      throw new Error("Allow camera access to take a photo.");
    const result =
      source === "camera"
        ? await picker.launchCameraAsync({ mediaTypes: ["images"] })
        : await picker.launchImageLibraryAsync({ mediaTypes: ["images", "videos"] });
    const asset = result.assets?.[0];
    return asset
      ? {
          uri: asset.uri,
          name: asset.fileName ?? asset.uri.split("/").at(-1),
          mimeType: asset.mimeType ?? (asset.type === "video" ? "video/mp4" : "image/jpeg"),
        }
      : null;
  } finally {
    endHandoff();
  }
}

type BotFileTransfer = {
  environmentId: EnvironmentId;
  file: import("expo-file-system").File;
  name: string;
  mimeType: string;
  controller: AbortController;
};

export async function transferBotFile<T>(
  { environmentId, file, name, mimeType, controller }: BotFileTransfer,
  commit: (attachmentId: string, size: number) => Promise<T>,
) {
  const connectionAtom = environmentSession.preparedConnectionValueAtom(environmentId);
  const connection = Option.getOrNull(appAtomRegistry.get(connectionAtom));
  if (!connection || controller.signal.aborted) return null;
  const current = () =>
    !controller.signal.aborted &&
    Option.getOrNull(appAtomRegistry.get(connectionAtom)) === connection;
  const { UploadType } = await import("expo-file-system");
  if (!current()) return null;
  const size = file.size;
  if (!file.exists || size === null || size <= 0 || size > OPENBOT_MAX_FILE_BYTES)
    throw new Error(
      `Choose an available, nonempty file up to ${formatAttachmentSize(OPENBOT_MAX_FILE_BYTES)}.`,
    );
  const pending = await runAttachmentUploadCycle({
    registry: appAtomRegistry,
    createUploadUrl: attachmentEnvironment.createUploadUrl,
    remove: attachmentEnvironment.remove,
    environmentId,
    upload: {
      type: "file",
      name,
      sizeBytes: size,
      mimeType,
      ...(size > PROVIDER_SEND_TURN_MAX_FILE_BYTES ? { purpose: "openbot" as const } : {}),
    },
    resolveUploadUrl: (relativeUrl) =>
      current() ? resolveAssetUrl(connection.httpBaseUrl, relativeUrl) : null,
    transport: (url) => ({
      abort: () => controller.abort(),
      done: file
        .upload(url, {
          httpMethod: "POST",
          uploadType: UploadType.BINARY_CONTENT,
          headers: { "Content-Type": mimeType },
          signal: controller.signal,
        })
        .then((response) => {
          if (response.status < 200 || response.status >= 300)
            throw new Error("Could not upload this file to the environment.");
        }),
    }),
  });
  try {
    if (pending.status === "cancelled" || !current()) return null;
    if (pending.status === "failed") throw pending.error;
    const result = await commit(pending.attachmentId, size);
    return current() ? result : null;
  } finally {
    if (pending.attachmentId)
      deletePendingAttachmentUpload({
        registry: appAtomRegistry,
        remove: attachmentEnvironment.remove,
        environmentId,
        attachmentId: pending.attachmentId,
      });
  }
}

export function stageBotFile(input: BotFileTransfer & { hostId: string; agentId: string }) {
  const { environmentId, hostId, agentId, name, mimeType } = input;
  return transferBotFile(input, async (attachmentId, size) => {
    const result = await runAtomCommand(
      appAtomRegistry,
      openbot.fileUploadDraft,
      { environmentId, input: { hostId, agentId, attachmentId, name, mimeType, size } },
      { reportFailure: false },
    );
    if (result._tag === "Failure") throw squashAtomCommandFailure(result);
    return result.value;
  });
}

export function useBotFileUpload(environmentId: EnvironmentId, hostId: string) {
  const { fullQualityPhotos } = useBotChatAppearance();
  const canUpload = useAtomValue(openbot.fileUploadDraft.permissionAtom(environmentId));
  const [busy, setBusy] = useState(false);
  const active = useRef<AbortController | null>(null);
  const mounted = useRef(false);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Abort a transfer when its destination leaves the screen.
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      active.current?.abort();
    };
  }, []);
  const connectionAtom = environmentSession.preparedConnectionValueAtom(environmentId);
  const pick = async (agentId: string, source: BotFilePicker) => {
    if (!canUpload || active.current) return null;
    const connection = Option.getOrNull(appAtomRegistry.get(connectionAtom));
    if (!connection) return null;
    const controller = new AbortController();
    active.current = controller;
    setBusy(true);
    const current = () =>
      !controller.signal.aborted &&
      Option.getOrNull(appAtomRegistry.get(connectionAtom)) === connection;
    let reducedCopy: import("expo-file-system").File | undefined;
    return (async () => {
      const selected = await chooseBotFile(source);
      if (!selected || !current()) return null;
      const file = await openLocalFile(selected.uri);
      let name = selected.name || "file";
      let mimeType = selected.mimeType || "application/octet-stream";
      let uploadFile = file;
      if (
        Platform.OS === "ios" &&
        source !== "files" &&
        mimeType.startsWith("image/") &&
        !fullQualityPhotos
      ) {
        const photo = await shrinkBotPhoto(selected.uri, name);
        if (photo.uri !== selected.uri) {
          reducedCopy = await openLocalFile(photo.uri);
          uploadFile = reducedCopy;
          name = photo.name;
          mimeType = "image/jpeg";
        }
        if (!current()) return null;
      }
      return await stageBotFile({
        environmentId,
        hostId,
        agentId,
        file: uploadFile,
        name,
        mimeType,
        controller,
      });
    })().finally(() => {
      if (reducedCopy) {
        try {
          reducedCopy.delete();
        } catch {
          // The picker copy is in the app cache and can expire normally.
        }
      }
      active.current = null;
      if (mounted.current) setBusy(false);
    });
  };
  return { busy, canUpload, pick };
}

async function openLocalFile(uri: string) {
  const { File } = await import("expo-file-system");
  return new File(uri);
}

async function shrinkBotPhoto(uri: string, name: string) {
  const { smallerBotPhoto } = await import("../bots/upstream/smaller-photo");
  return smallerBotPhoto(uri, name);
}
