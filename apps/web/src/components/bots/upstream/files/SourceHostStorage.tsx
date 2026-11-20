import { RegistryContext, useAtomValue } from "@effect/atom-react";
import { useContext, useEffect, useEffectEvent, useRef, useState, type ReactNode } from "react";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Result from "effect/Result";
import {
  OpenbotAgentList,
  type EnvironmentId,
  type OpenbotMaterializedFile,
} from "@t3tools/contracts";
import { providerAdminRequest } from "@t3tools/client-runtime/openbot/presentation";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { resolveAssetUrl } from "@t3tools/client-runtime/state/assets";
import { openbot } from "../../../../state/openbot";
import { useEnvironmentQuery } from "../../../../state/query";
import { assetEnvironment } from "../../../../state/assets";
import { useAtomCommand } from "../../../../state/use-atom-command";
import { useAtomQueryRunner } from "../../../../state/use-atom-query-runner";
import { usePreparedConnection, readPreparedConnection } from "../../../../state/session";
import { AttachmentFilePreview } from "../../../files/AttachmentFilePreview";
import { downloadMedia } from "../../../media/mediaContent";
import { SourceAgentAvatar } from "../../SourceAgentAvatar";
import { StorageOverview } from "./StorageOverview";
import {
  readStorageUsage,
  type StorageUsage,
  type StoredFileRow,
  type StoredFileAction,
} from "./types";
const decodeAgents = Schema.decodeUnknownResult(OpenbotAgentList);
export interface SourceHostStorageProps {
  environmentId: EnvironmentId;
  hostId: string;
  hostName?: string;
  onOpenAgent?: ((id: string) => void) | undefined;
  onShowMessage?: ((agentId: string, messageId: string) => void) | undefined;
  machine?: ReactNode;
}
export function SourceHostStorage(props: SourceHostStorageProps) {
  const connection = Option.getOrNull(usePreparedConnection(props.environmentId));
  const [session, setSession] = useState({ connection, epoch: 0 });
  if (connection !== session.connection) setSession({ connection, epoch: session.epoch + 1 });
  return <HostStorage key={`${props.environmentId}:${props.hostId}:${session.epoch}`} {...props} />;
}
function HostStorage(props: SourceHostStorageProps) {
  const { environmentId, hostId } = props;
  const registry = useContext(RegistryContext);
  const read = useAtomCommand(openbot.settingsRead, { reportFailure: false }),
    admin = useAtomCommand(openbot.adminToHost, { reportFailure: false }),
    materialize = useAtomCommand(openbot.fileMaterialize, { reportFailure: false });
  const asset = useAtomQueryRunner(assetEnvironment.createUrl, {
    refresh: true,
    reportFailure: false,
  });
  const connection = readPreparedConnection(environmentId),
    alive = useRef(true),
    scanSerial = useRef(0);
  const canRead = useAtomValue(
    openbot.settingsRead.permissionAtom(environmentId, {
      hostId,
      request: { operation: "settings.storage.usage", parameters: { scope: "host" } },
    }),
  );
  const canManage = useAtomValue(
    openbot.adminToHost.permissionAtom(environmentId, {
      hostId,
      request: {
        operation: "settings.storage.deleteFile",
        parameters: { fileId: "permission-check" },
      },
    }),
  );
  const agentsQuery = useEnvironmentQuery(
    openbot.readFromHost({
      environmentId,
      input: { hostId, request: { operation: "agent.list" } },
    }),
  );
  const parsedAgents = decodeAgents(agentsQuery.data),
    agents = Result.isSuccess(parsedAgents) ? parsedAgents.success : [];
  const [usage, setUsage] = useState<StorageUsage | null>(null),
    [loading, setLoading] = useState(false),
    [error, setError] = useState<string | null>(null),
    [revision, setRevision] = useState(0),
    [preview, setPreview] = useState<OpenbotMaterializedFile | null>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Stop storage mutations and private file previews from reaching a removed host panel.
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const assertCurrent = () => {
    if (!alive.current || !connection || readPreparedConnection(environmentId) !== connection)
      throw new Error("The original storage session changed.");
  };
  const readUsage = async (current: () => boolean, force = false) => {
    assertCurrent();
    if (!canRead) return;
    const serial = ++scanSerial.current;
    const currentScan = () => current() && serial === scanSerial.current;
    setLoading(true);
    setError(null);
    try {
      const response = await read({
        environmentId,
        input: {
          hostId,
          request: {
            operation: "settings.storage.usage",
            parameters: { scope: "host", ...(force ? { force: true } : {}) },
          },
        },
      });
      assertCurrent();
      if (!currentScan()) return;
      if (response._tag === "Failure") throw squashAtomCommandFailure(response);
      const next = readStorageUsage(response.value);
      if (next.scope !== "host" || next.agentId !== null || next.conversationId !== null)
        throw new Error("The storage inventory belongs to another scope.");
      setUsage({ ...next, files: next.files.map((file) => ({ ...file, previewUrl: null })) });
    } catch (cause) {
      if (alive.current && currentScan())
        setError(cause instanceof Error ? cause.message : "Could not measure storage.");
      throw cause;
    } finally {
      if (alive.current && currentScan()) setLoading(false);
    }
  };
  const load = useEffectEvent(async (scanRevision: number) => {
    await readUsage(() => alive.current, scanRevision > 0).catch(() => {});
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Scan the selected host after its exact read permission or explicit refresh changes.
  useEffect(() => {
    if (canRead) void load(revision);
  }, [canRead, revision]);
  const mutate = async (input: unknown) => {
    assertCurrent();
    const request = providerAdminRequest(input);
    if (!request) throw new Error("This host does not support that storage change.");
    if (!registry.get(openbot.adminToHost.permissionAtom(environmentId, { hostId, request })))
      throw new Error("You do not have permission to manage this storage.");
    try {
      const response = await admin({ environmentId, input: { hostId, request } });
      assertCurrent();
      if (response._tag === "Failure") throw squashAtomCommandFailure(response);
    } finally {
      if (alive.current && readPreparedConnection(environmentId) === connection)
        await readUsage(() => alive.current, true);
    }
  };
  const fileAction = async (file: StoredFileRow, action: StoredFileAction) => {
    assertCurrent();
    if (!usage?.files.some((row) => row.id === file.id && row.agentId === file.agentId))
      throw new Error("This file is no longer in the storage inventory.");
    if (action === "retry") {
      await readUsage(() => alive.current, true);
      return;
    }
    if (action === "delete") {
      if (!file.deletable) throw new Error("This file cannot be removed here.");
      await mutate({ operation: "settings.storage.deleteFile", parameters: { fileId: file.id } });
      return;
    }
    if (action === "show-in-chat") {
      if (file.agentId && file.messageId) props.onShowMessage?.(file.agentId, file.messageId);
      return;
    }
    if (action === "reveal") throw new Error("This file belongs to the host computer.");
    if (!file.agentId)
      throw new Error("This host file is not owned by an agent that can export it.");
    const input = {
      hostId,
      agentId: file.agentId,
      source: {
        kind: "stored" as const,
        fileId: file.id,
        ...(file.conversation ? { conversationId: file.conversation.id } : {}),
      },
    };
    if (!registry.get(openbot.fileMaterialize.permissionAtom(environmentId, input)))
      throw new Error("You do not have permission to open this host file.");
    const result = await materialize({ environmentId, input });
    assertCurrent();
    if (result._tag === "Failure") throw squashAtomCommandFailure(result);
    if (action === "open") {
      setPreview(result.value);
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
    assertCurrent();
    if (minted._tag === "Failure") throw squashAtomCommandFailure(minted);
    const url = resolveAssetUrl(connection!.httpBaseUrl, minted.value.relativeUrl);
    if (!url) throw new Error("The file download could not be opened.");
    await downloadMedia(url, result.value.name);
  };
  const action = async (file: StoredFileRow, kind: StoredFileAction) => {
    try {
      await fileAction(file, kind);
    } catch (cause) {
      if (alive.current)
        setError(cause instanceof Error ? cause.message : "Could not open the file.");
      if (kind === "delete") throw cause;
    }
  };
  return (
    <>
      <StorageOverview
        hostName={props.hostName ?? hostId}
        state={!canRead || error ? "error" : loading || !usage ? "scanning" : "ready"}
        error={canRead ? error : "You do not have permission to view this host’s storage."}
        usage={canRead ? usage : null}
        agents={agents}
        renderAvatar={(id) => {
          const agent = agents.find((a) => a.id === id);
          return agent ? <SourceAgentAvatar agent={agent} size={28} /> : null;
        }}
        machine={props.machine}
        canManage={canManage}
        onRescan={() => setRevision((value) => value + 1)}
        onOpenAgent={props.onOpenAgent}
        onOpenConversation={
          props.onOpenAgent
            ? (id) => {
                const agentId = usage?.conversations.find((chat) => chat.id === id)?.agentId;
                if (agentId) props.onOpenAgent?.(agentId);
              }
            : undefined
        }
        onClear={(category) =>
          mutate({ operation: "settings.storage.clear", parameters: { category } })
        }
        onFileAction={action}
      />
      {preview && (
        <AttachmentFilePreview
          name={preview.name}
          mimeType={preview.mimeType}
          sizeBytes={preview.size}
          asset={{ environmentId, attachmentId: preview.attachmentId }}
          onClose={() => setPreview(null)}
        />
      )}
    </>
  );
}
