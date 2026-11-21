import { RegistryContext, useAtomValue } from "@effect/atom-react";
import { useContext, useEffect, useEffectEvent, useState } from "react";
import * as Option from "effect/Option";
import type { EnvironmentId, OpenbotMaterializedFile } from "@t3tools/contracts";
import { settlePromise, squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { resolveAssetUrl } from "@t3tools/client-runtime/state/assets";
import { openbot } from "../../../../state/openbot";
import { assetEnvironment } from "../../../../state/assets";
import { useAtomCommand } from "../../../../state/use-atom-command";
import { useAtomQueryRunner } from "../../../../state/use-atom-query-runner";
import { usePreparedConnection, readPreparedConnection } from "../../../../state/session";
import { BotFilePreview } from "../../BotFilePreview";
import { downloadMedia } from "../../../media/mediaContent";
import { AgentFilesView } from "./AgentFilesView";
import { ConversationFilesPanel } from "./ConversationFilesPanel";
import {
  readStorageUsage,
  type StorageUsage,
  type StoredFileRow,
  type StoredFileAction,
} from "./types";
export interface FilesEnvironmentProps {
  environmentId: EnvironmentId;
  hostId: string;
  agentId: string;
  agentName: string;
  conversation?: { id: string; title: string } | undefined;
  onBack: () => void;
  onClose: () => void;
  onOpenConversation: (conversationId: string) => void;
  onShowMessage: (file: StoredFileRow) => void;
}
export function FilesEnvironment(props: FilesEnvironmentProps) {
  const connection = Option.getOrNull(usePreparedConnection(props.environmentId));
  const [session, setSession] = useState({ connection, epoch: 0 });
  if (session.connection !== connection) setSession({ connection, epoch: session.epoch + 1 });
  return (
    <FilesHost
      key={`${props.environmentId}:${props.hostId}:${props.agentId}:${props.conversation?.id ?? "agent"}:${session.epoch}`}
      {...props}
    />
  );
}
function FilesHost(props: FilesEnvironmentProps) {
  const { environmentId, hostId, agentId } = props;
  const registry = useContext(RegistryContext);
  const read = useAtomCommand(openbot.settingsRead, { reportFailure: false });
  const admin = useAtomCommand(openbot.adminToHost, { reportFailure: false });
  const materialize = useAtomCommand(openbot.fileMaterialize, { reportFailure: false });
  const asset = useAtomQueryRunner(assetEnvironment.createUrl, {
    refresh: true,
    reportFailure: false,
  });
  const parameters = props.conversation
    ? { scope: "conversation", agentId, conversationId: props.conversation.id }
    : { scope: "agent", agentId };
  const canRead = useAtomValue(
    openbot.settingsRead.permissionAtom(environmentId, {
      hostId,
      request: { operation: "settings.storage.usage", parameters },
    }),
  );
  const canDelete = useAtomValue(
    openbot.adminToHost.permissionAtom(environmentId, {
      hostId,
      request: {
        operation: "settings.storage.deleteFile",
        parameters: { fileId: "permission-check" },
      },
    }),
  );
  const [usage, setUsage] = useState<StorageUsage | null>(null),
    [loading, setLoading] = useState(false),
    [error, setError] = useState<string | null>(null),
    [revision, setRevision] = useState(0),
    [preview, setPreview] = useState<
      (OpenbotMaterializedFile & { originalAttachmentId: string }) | null
    >(null);
  const refresh = useEffectEvent(async (current: () => boolean, force: boolean) => {
    const connection = readPreparedConnection(environmentId);
    if (!canRead || !connection) return;
    setLoading(true);
    setError(null);
    const result = await read({
      environmentId,
      input: {
        hostId,
        request: {
          operation: "settings.storage.usage",
          parameters: { ...parameters, ...(force ? { force: true } : {}) },
        },
      },
    });
    if (!current() || readPreparedConnection(environmentId) !== connection) return;
    const settled = await settlePromise(async () => {
      if (result._tag === "Failure") throw squashAtomCommandFailure(result);
      const next = readStorageUsage(result.value);
      if (
        next.agentId !== agentId ||
        next.scope !== parameters.scope ||
        (props.conversation && next.conversationId !== props.conversation.id)
      )
        throw new Error("The file inventory belongs to another conversation.");
      // Team storage rows may name a host-only preview scheme. Only the materialized gateway supplies browser URLs.
      setUsage({ ...next, files: next.files.map((file) => ({ ...file, previewUrl: null })) });
    });
    if (settled._tag === "Failure") {
      const cause = squashAtomCommandFailure(settled);
      setError(cause instanceof Error ? cause.message : "Could not load the files.");
    }
    setLoading(false);
  });
  /* oxlint-disable t3code/no-unreasoned-state-sync, react/set-state-in-effect, react/exhaustive-effect-dependencies -- Load the guarded storage inventory on permission and explicit refresh changes, fencing late host responses. */
  useEffect(() => {
    let active = true;
    void refresh(() => active, revision > 0);
    return () => {
      active = false;
    };
  }, [canRead, revision]);
  /* oxlint-enable t3code/no-unreasoned-state-sync, react/set-state-in-effect, react/exhaustive-effect-dependencies */
  const act = async (file: StoredFileRow, action: StoredFileAction) => {
    const connection = readPreparedConnection(environmentId);
    if (!connection) throw new Error("Reconnect the original host session.");
    if (action === "show-in-chat") {
      props.onShowMessage(file);
      return;
    }
    if (action === "retry") {
      setRevision((value) => value + 1);
      return;
    }
    if (action === "delete") {
      const request = {
        operation: "settings.storage.deleteFile" as const,
        parameters: { fileId: file.id },
      };
      if (!registry.get(openbot.adminToHost.permissionAtom(environmentId, { hostId, request })))
        throw new Error("You don’t have permission to delete this file.");
      const settled = await settlePromise(async () => {
        const result = await admin({ environmentId, input: { hostId, request } });
        if (result._tag === "Failure") throw squashAtomCommandFailure(result);
      });
      if (readPreparedConnection(environmentId) === connection) setRevision((value) => value + 1);
      if (settled._tag === "Failure") throw squashAtomCommandFailure(settled);
      return;
    }
    if (action === "reveal") throw new Error("This file belongs to the host computer.");
    const input = {
      hostId,
      agentId,
      source: {
        kind: "stored" as const,
        fileId: file.id,
        ...(props.conversation ? { conversationId: props.conversation.id } : {}),
      },
    };
    if (!registry.get(openbot.fileMaterialize.permissionAtom(environmentId, input)))
      throw new Error("You don’t have permission to open this file.");
    const result = await materialize({ environmentId, input });
    if (result._tag === "Failure") throw squashAtomCommandFailure(result);
    if (readPreparedConnection(environmentId) !== connection)
      throw new Error("The original host session changed.");
    if (action === "open") {
      setPreview({ ...result.value, originalAttachmentId: file.id });
      return;
    }
    const minted = await asset({
      environmentId,
      input: {
        resource: {
          _tag: "attachment",
          attachmentId: result.value.attachmentId,
          fileName: result.value.name,
          mimeType: result.value.mimeType,
          disposition: "attachment",
        },
      },
    });
    if (minted._tag === "Failure") throw squashAtomCommandFailure(minted);
    if (readPreparedConnection(environmentId) !== connection)
      throw new Error("The original host session changed.");
    const url = resolveAssetUrl(connection.httpBaseUrl, minted.value.relativeUrl);
    if (!url) throw new Error("The file download could not be opened.");
    await downloadMedia(url, result.value.name);
  };
  const action = (file: StoredFileRow, kind: StoredFileAction) =>
    act(file, kind).catch((cause) => {
      const message = cause instanceof Error ? cause.message : "Could not open this file.";
      setError(message);
      if (kind === "delete") throw new Error(message);
    });
  const common = {
    files: canRead ? (usage?.files ?? []) : [],
    loading: loading && !usage,
    error: canRead ? error : "You don’t have permission to view this host’s files.",
    onRetry: () => setRevision((value) => value + 1),
    canDelete,
    onClose: props.onClose,
    onPreviewFile: (file: StoredFileRow) => {
      void action(file, "open");
    },
    onAction: action,
  };
  if (preview)
    return (
      <BotFilePreview
        quoteTarget={{
          source: "attachment",
          attachmentId: preview.originalAttachmentId,
          name: preview.name,
        }}
        name={preview.name}
        mimeType={preview.mimeType}
        sizeBytes={preview.size}
        asset={{ environmentId, attachmentId: preview.attachmentId }}
        onClose={() => setPreview(null)}
      />
    );
  return props.conversation ? (
    <ConversationFilesPanel
      {...common}
      conversationTitle={props.conversation.title}
      chatBytes={usage?.breakdown.reduce((sum, row) => sum + row.bytes, 0) ?? 0}
    />
  ) : (
    <AgentFilesView
      {...common}
      agentName={props.agentName}
      breakdown={canRead ? (usage?.breakdown ?? []) : []}
      conversations={canRead ? (usage?.conversations ?? []) : []}
      onBack={props.onBack}
      onOpenConversation={props.onOpenConversation}
    />
  );
}
