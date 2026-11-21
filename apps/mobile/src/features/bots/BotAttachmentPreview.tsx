import { useAtomValue } from "@effect/atom-react";
import type {
  EnvironmentId,
  OpenbotAgentFileSource,
  OpenbotFileMaterializeInput,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { Pressable, View } from "react-native";

import type { FilePreviewSource } from "../../components/ui/FilePreviewModal";
import {
  downloadAndShareAttachment,
  downloadAttachmentForPreview,
  type AttachmentPreviewFile,
} from "../../lib/attachmentDownload";
import { refreshAssetUrl } from "../../state/assets";
import { SymbolView } from "../../components/ui/AppSymbol";
import * as Dialog from "../../components/ui/Dialog";
import { appAtomRegistry } from "../../state/atom-registry";
import { openbot } from "../../state/openbot";
import { environmentSession } from "../../state/session";
import { useAtomCommand } from "../../state/use-atom-command";
import { useBotPalette } from "./upstream/BotChrome";
import { OpenBotText as Text } from "./upstream/OpenBotTypography";
import { botAttachmentDownload, botChatAttachments } from "./bot-attachment-transfer";

type PrefetchedFile = {
  key: string;
  connection: object;
  file: AttachmentPreviewFile;
  source: FilePreviewSource;
};
type AutomaticTransfer = {
  key: string;
  controller: AbortController;
  promise: Promise<PrefetchedFile | null>;
};

async function downloadedFileSize(uri: string) {
  const { File } = await import("expo-file-system");
  return new File(uri).size;
}

export function useBotAttachmentPreview(
  environmentId: EnvironmentId,
  hostId: string,
  automatic = false,
) {
  const materialize = useAtomCommand(openbot.fileMaterialize, { reportFailure: false });
  const canOpen = useAtomValue(openbot.fileMaterialize.permissionAtom(environmentId));
  const [preview, setPreview] = useState<FilePreviewSource | null>(null);
  const request = useRef(0);
  const opening = useRef(false);
  const cached = useRef<PrefetchedFile | null>(null);
  const automaticTransfer = useRef<AutomaticTransfer | null>(null);
  const observed = useRef(new Set<string>());
  const scopeKey = JSON.stringify([environmentId, hostId]);
  const currentScope = useRef(scopeKey);
  const clearAutomatic = useCallback(() => {
    automaticTransfer.current?.controller.abort();
    automaticTransfer.current = null;
    cached.current?.file.dispose();
    cached.current = null;
    observed.current.clear();
  }, []);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Ignore a download that completes after the connected chat unmounts.
  useLayoutEffect(() => {
    currentScope.current = scopeKey;
    return () => {
      request.current += 1;
      opening.current = false;
      clearAutomatic();
    };
  }, [scopeKey, clearAutomatic]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Release automatic file downloads outside an active chat, keeping a file while its preview is open.
  useLayoutEffect(() => {
    if (!automatic && !preview && !opening.current) clearAutomatic();
  }, [automatic, preview, clearAutomatic]);
  const connectionAtom = environmentSession.preparedConnectionValueAtom(environmentId);
  const resolveItem = async (input: OpenbotFileMaterializeInput) => {
    const connection = Option.getOrNull(appAtomRegistry.get(connectionAtom));
    if (!connection || !canOpen) return null;
    const result = await materialize({ environmentId, input });
    if (Option.getOrNull(appAtomRegistry.get(connectionAtom)) !== connection) return null;
    if (result._tag === "Failure") throw new Error("Attachment unavailable");
    const file = result.value;
    return {
      environmentId,
      name: file.name,
      mimeType: file.mimeType,
      size: file.size,
      resource: {
        _tag: "attachment" as const,
        attachmentId: file.attachmentId,
        fileName: file.name,
        mimeType: file.mimeType,
        disposition: "inline" as const,
      },
      kind: file.mimeType.startsWith("image/")
        ? ("image" as const)
        : file.mimeType === "application/pdf"
          ? ("pdf" as const)
          : ("document" as const),
    };
  };
  const prefetch = (agentId: string, source: OpenbotAgentFileSource, size: number | undefined) => {
    if (
      !automatic ||
      preview ||
      opening.current ||
      automaticTransfer.current ||
      !canOpen ||
      botAttachmentDownload(size) !== "large"
    )
      return;
    const connection = Option.getOrNull(appAtomRegistry.get(connectionAtom));
    if (!connection) return;
    const input = { hostId, agentId, source };
    const key = JSON.stringify(input);
    if (observed.current.has(key)) return;
    observed.current.add(key);
    const controller = new AbortController();
    const signal = controller.signal;
    const current = () =>
      !signal.aborted &&
      currentScope.current === scopeKey &&
      Option.getOrNull(appAtomRegistry.get(connectionAtom)) === connection;
    const promise = (async () => {
      const item = await resolveItem(input);
      if (!current() || !item || item.size !== size) return null;
      const url = await refreshAssetUrl(item.environmentId, item.resource, signal);
      if (!current() || !url) return null;
      const file = await downloadAttachmentForPreview({ url, attachment: item, signal });
      if (!file) return null;
      const actualSize = await downloadedFileSize(file.uri);
      if (!current() || actualSize !== size) {
        file.dispose();
        return null;
      }
      const next: PrefetchedFile = {
        key,
        connection,
        file,
        source: { uri: file.uri, name: item.name, mimeType: item.mimeType, kind: item.kind },
      };
      cached.current?.file.dispose();
      cached.current = next;
      return next;
    })()
      .catch(() => null)
      .finally(() => {
        if (automaticTransfer.current?.controller === controller) automaticTransfer.current = null;
      });
    automaticTransfer.current = { key, controller, promise };
  };
  const openFile = async (input: OpenbotFileMaterializeInput) => {
    if (!canOpen) return;
    const current = ++request.current;
    opening.current = true;
    await (async () => {
      const key = JSON.stringify(input);
      if (automaticTransfer.current?.key !== key) automaticTransfer.current?.controller.abort();
      const hit =
        cached.current?.key === key
          ? cached.current
          : automaticTransfer.current?.key === key
            ? await automaticTransfer.current.promise
            : null;
      if (
        hit &&
        current === request.current &&
        Option.getOrNull(appAtomRegistry.get(connectionAtom)) === hit.connection
      ) {
        setPreview(hit.source);
        return;
      }
      if (current !== request.current) return;
      const item = await resolveItem(input);
      if (item && current === request.current) setPreview(item);
    })()
      .catch(() => {
        if (current === request.current)
          Dialog.alert("Attachment unavailable", "Reconnect to the original host and try again.");
      })
      .finally(() => {
        if (current === request.current) opening.current = false;
      });
  };
  const libraryInput = (fileId: string, conversationId?: string): OpenbotFileMaterializeInput => ({
    hostId,
    source: { kind: "library", fileId, ...(conversationId ? { conversationId } : {}) },
  });
  const resolveLibrary = async (
    fileId: string,
    conversationId: string | undefined,
    signal: AbortSignal,
  ) => {
    const item = await resolveItem(libraryInput(fileId, conversationId));
    if (!item || signal.aborted) return null;
    const uri = await refreshAssetUrl(item.environmentId, item.resource, signal);
    return uri ? { uri, name: item.name, mimeType: item.mimeType } : null;
  };
  return {
    canOpen,
    prefetch,
    open: (agentId: string, source: OpenbotAgentFileSource) =>
      openFile({ hostId, agentId, source }),
    openLibrary: (fileId: string, conversationId?: string) =>
      openFile(libraryInput(fileId, conversationId)),
    resolveLibrary,
    shareLibrary: async (
      fileId: string,
      conversationId: string | undefined,
      signal: AbortSignal,
    ) => {
      const item = await resolveLibrary(fileId, conversationId, signal);
      if (!item) throw new Error("File unavailable");
      await downloadAndShareAttachment({ url: item.uri, attachment: item, signal });
    },
    modal: {
      source: preview,
      onRequestClose: () => setPreview(null),
      onOpenError: () => {
        setPreview(null);
        Dialog.alert("Preview unavailable", "Reconnect to the original host and try again.");
      },
    },
  };
}

export function BotAttachmentList({
  value,
  canOpen,
  onOpen,
}: {
  value: unknown;
  canOpen: boolean;
  onOpen: (id: string) => void;
}) {
  const palette = useBotPalette();
  const files = botChatAttachments(value);
  if (!files.length) return null;
  return (
    <View className="gap-1 py-1">
      {files.map(({ id, name, size }) => (
        <Pressable
          key={id}
          accessibilityRole="button"
          accessibilityLabel={`Open attachment ${name}`}
          accessibilityHint={
            botAttachmentDownload(size) === "desktop" ? "Available on desktop" : undefined
          }
          disabled={!canOpen || botAttachmentDownload(size) === "desktop"}
          onPress={() => onOpen(id)}
          className="min-h-11 flex-row items-center gap-2 self-start rounded-xl px-3 active:opacity-60"
          style={{ backgroundColor: palette.control, borderColor: palette.border, borderWidth: 1 }}
        >
          <SymbolView name="doc" size={18} tintColor={palette.muted} />
          <Text numberOfLines={2} style={{ color: palette.text, flexShrink: 1 }}>
            {name}
          </Text>
          {botAttachmentDownload(size) === "desktop" && (
            <Text style={{ color: palette.muted, fontSize: 12 }}>Open on desktop</Text>
          )}
        </Pressable>
      ))}
    </View>
  );
}
