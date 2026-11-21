import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import { formatAttachmentSize } from "@t3tools/client-runtime/state/attachments";
import { workflowAgents } from "@t3tools/client-runtime/openbot/presentation";
import { settingsCapabilities } from "@t3tools/client-runtime/openbot/settings";
import {
  readStorageUsage,
  type StorageCategory,
  type StorageUsage,
  type StoredFileRow,
} from "@t3tools/client-runtime/openbot/storage";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import * as Option from "effect/Option";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { View } from "react-native";
import { FilePreviewModal } from "../../components/ui/FilePreviewModal";
import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import * as Dialog from "../../components/ui/Dialog";
import { ListRow } from "../../components/ui/ListRow";
import { ListRowLayout } from "../../components/ui/ListRowLayout";
import { Menu } from "../../components/ui/Menu";
import { RowPressable } from "../../components/ui/RowPressable";
import { ScreenScrollView } from "../../components/ui/ScreenScrollView";
import { Sheet } from "../../components/ui/Sheet";
import { appAtomRegistry } from "../../state/atom-registry";
import { openbot } from "../../state/openbot";
import { environmentSession, usePreparedConnection } from "../../state/session";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { useBotAttachmentPreview } from "../bots/BotAttachmentPreview";
import { BotStorageRing } from "./BotStorageRing";
import { SettingsSection } from "./components/SettingsSection";
import { m } from "../../i18n/messages";
import { T, msg, useGT } from "gt-react-native";

type Scope = { environmentId: EnvironmentId; hostId: string; name: string };
type Clearable = "caches" | "logs";
type Change = { category: Clearable } | { fileId: string };
const categories = [
  { key: "workspaces", label: m(msg("Workspaces")), color: "#578cf6" },
  { key: "files", label: m(msg("Chat files")), color: "#8e72e8" },
  { key: "chats", label: m(msg("Chats")), color: "#51ac90" },
  { key: "downloads", label: m(msg("Downloads")), color: "#e59d49" },
  { key: "runtimes", label: m(msg("Runtimes")), color: "#e2749b" },
  { key: "app", label: m(msg("App data")), color: "#7894a9" },
] as const;
const groupOf: Record<StorageCategory, (typeof categories)[number]["key"]> = {
  workspaces: "workspaces",
  attachments: "files",
  generated: "files",
  chats: "chats",
  downloads: "downloads",
  runtimes: "runtimes",
  caches: "app",
  logs: "app",
};
const GiB = 1024 ** 3;
const size = (bytes: number) =>
  bytes >= GiB
    ? `${(bytes / GiB).toLocaleString(undefined, { maximumFractionDigits: 1 })} GB`
    : formatAttachmentSize(bytes);

export function BotServerStorage(scope: Scope) {
  const gt = useGT();
  const [open, setOpen] = useState(false);
  const compatibility = useEnvironmentQuery(
    openbot.readFromHost({
      environmentId: scope.environmentId,
      input: { hostId: scope.hostId, request: { operation: "compatibility.read" } },
    }),
  );
  if (!settingsCapabilities(compatibility.data).includes("storage-v1")) return null;
  return (
    <>
      <SettingsSection title={gt("Storage")}>
        <ListRow icon="internaldrive" label={gt("Server storage")} onPress={() => setOpen(true)} />
      </SettingsSection>
      {open && <StorageSheet {...scope} onClose={() => setOpen(false)} />}
    </>
  );
}

function StorageSheet({ environmentId, hostId, name, onClose }: Scope & { onClose: () => void }) {
  const gt = useGT();
  const [usage, setUsage] = useState<StorageUsage | null>(null);
  const [detail, setDetail] = useState(false);
  const [fileLimit, setFileLimit] = useState(100);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const active = useRef<AbortController | null>(null);
  const read = useAtomCommand(openbot.settingsRead, { reportFailure: false });
  const admin = useAtomCommand(openbot.adminToHost, { reportFailure: false });
  const agents = useEnvironmentQuery(
    openbot.readFromHost({
      environmentId,
      input: { hostId, request: { operation: "agent.list" } },
    }),
  );
  const operationalConnection = Option.getOrNull(usePreparedConnection(environmentId));
  const connectionAtom = environmentSession.preparedConnectionValueAtom(environmentId);
  const canClear = useAtomValue(
    openbot.adminToHost.permissionAtom(environmentId, {
      hostId,
      request: { operation: "settings.storage.clear", parameters: { category: "caches" } },
    }),
  );
  const canDelete = useAtomValue(
    openbot.adminToHost.permissionAtom(environmentId, {
      hostId,
      request: { operation: "settings.storage.deleteFile", parameters: { fileId: "permission" } },
    }),
  );
  const preview = useBotAttachmentPreview(environmentId, hostId);
  const agentsById = new Map(workflowAgents(agents.data).map((agent) => [agent.id, agent.name]));
  async function measure(force: boolean, change?: Change) {
    if (active.current || !operationalConnection) return;
    const controller = new AbortController();
    active.current = controller;
    setBusy(true);
    setError(null);
    const check = () => {
      controller.signal.throwIfAborted();
      if (Option.getOrNull(appAtomRegistry.get(connectionAtom)) !== operationalConnection)
        throw new Error("The server connection changed. Reopen Storage and try again.");
    };
    await (async () => {
      check();
      if (change) {
        const request =
          "fileId" in change
            ? { operation: "settings.storage.deleteFile" as const, parameters: change }
            : { operation: "settings.storage.clear" as const, parameters: change };
        const result = await admin({ environmentId, input: { hostId, request } });
        check();
        if (result._tag === "Failure") throw squashAtomCommandFailure(result);
      }
      const result = await read({
        environmentId,
        input: {
          hostId,
          request: {
            operation: "settings.storage.usage",
            parameters: { scope: "host", ...(force ? { force: true } : {}) },
          },
        },
      });
      check();
      if (result._tag === "Failure") throw squashAtomCommandFailure(result);
      const data = readStorageUsage(result.value);
      if (data.scope !== "host" || data.agentId !== null || data.conversationId !== null)
        throw new Error("The storage inventory belongs to another scope.");
      setUsage(data);
    })()
      .catch((cause) => {
        if (!controller.signal.aborted)
          setError(cause instanceof Error ? cause.message : gt("Storage measurement failed."));
      })
      .finally(() => {
        if (active.current === controller) {
          active.current = null;
          setBusy(false);
        }
      });
  }
  const load = useEffectEvent(() => void measure(false));
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Load the scoped host inventory and cancel it when the server connection changes or Storage closes.
  useEffect(() => {
    if (!operationalConnection) return;
    let mounted = true;
    queueMicrotask(() => {
      if (mounted) load();
    });
    return () => {
      mounted = false;
      active.current?.abort();
      active.current = null;
    };
  }, [operationalConnection]);

  const groups = categories
    .map((group) => ({
      ...group,
      bytes:
        usage?.breakdown
          .filter((entry) => groupOf[entry.category] === group.key)
          .reduce((sum, entry) => sum + entry.bytes, 0) ?? 0,
    }))
    .filter((group) => group.bytes > 0);
  const total = groups.reduce((sum, group) => sum + group.bytes, 0);
  const focused = groups.find((group) => group.key === selected);
  const sortedAgents = [...(usage?.agents ?? [])].sort((a, b) => b.bytes - a.bytes);
  const largest = [...(usage?.conversations ?? [])].sort((a, b) => b.bytes - a.bytes).slice(0, 5);
  const files = [...(usage?.files ?? [])].sort((a, b) => b.size - a.size);
  const clearable = (usage?.breakdown ?? []).filter(
    (item): item is typeof item & { category: Clearable } =>
      item.removable && item.bytes > 0 && (item.category === "caches" || item.category === "logs"),
  );
  const confirmClear = (category: Clearable) => {
    Dialog.confirm({
      title: category === "caches" ? gt("Clear server caches?") : gt("Clear server logs?"),
      message: gt("This removes the selected data from this bot server."),
      confirmText: gt("Clear"),
      destructive: true,
      onConfirm: () => void measure(true, { category }),
    });
  };
  const openFile = (file: StoredFileRow) => {
    if (file.status !== "available" || !preview.canOpen) return;
    const conversation = file.conversation ? { conversationId: file.conversation.id } : {};
    if (file.agentId) {
      void preview.open(file.agentId, { kind: "stored", fileId: file.id, ...conversation });
    } else {
      void preview.openLibrary(file.id, file.conversation?.id);
    }
  };
  const confirmDelete = (file: StoredFileRow) => {
    if (!file.deletable || !canDelete) return;
    Dialog.confirm({
      title: gt("Delete this stored file?"),
      message: file.name,
      confirmText: "Delete",
      destructive: true,
      onConfirm: () => void measure(true, { fileId: file.id }),
    });
  };
  return (
    <>
      <Sheet title={detail ? gt("Stored files") : gt("Storage")} onClose={onClose}>
        <ScreenScrollView
          contentInsetAdjustmentBehavior="automatic"
          contentContainerClassName="gap-4 px-5 pb-6 pt-4"
        >
          {detail && (
            <Button tone="text" label={gt("Back to Storage")} onPress={() => setDetail(false)} />
          )}
          {!operationalConnection && (
            <Text>
              <T>Reconnect to this server to measure storage.</T>
            </Text>
          )}
          {error && <Text accessibilityRole="alert">{error}</Text>}
          {!detail && (
            <Button
              label={busy ? gt("Measuring…") : gt("Measure again")}
              icon="arrow.clockwise"
              loading={busy && Boolean(operationalConnection)}
              disabled={!operationalConnection}
              onPress={() => void measure(true)}
            />
          )}
          {!detail && usage && (
            <>
              <SettingsSection
                title={name}
                footer={
                  usage.freeBytes === null
                    ? undefined
                    : `${size(usage.freeBytes)} free on this computer`
                }
              >
                {groups.length > 0 ? (
                  <>
                    <BotStorageRing
                      segments={groups}
                      selected={focused?.key ?? null}
                      value={size(focused?.bytes ?? total)}
                      caption={focused?.label ?? gt("Used")}
                      label={gt("Storage by type: {value}", {
                        value: groups
                          .map((group) => `${group.label} ${size(group.bytes)}`)
                          .join(", "),
                      })}
                    />
                    {groups.map((group) => (
                      <RowPressable
                        key={group.key}
                        accessibilityRole="button"
                        accessibilityLabel={`${group.label}, ${size(group.bytes)}`}
                        accessibilityState={{ selected: selected === group.key }}
                        onPress={() =>
                          setSelected((current) => (current === group.key ? null : group.key))
                        }
                        className="px-1"
                      >
                        <View className="flex-row items-center px-3">
                          <View
                            className="size-3 rounded-full"
                            style={{ backgroundColor: group.color }}
                          />
                          <View className="min-w-0 flex-1">
                            <ListRowLayout
                              label={group.label}
                              detail={`${size(group.bytes)} · ${Math.max(0.1, Math.round((group.bytes * 1000) / total) / 10)}%`}
                            />
                          </View>
                        </View>
                      </RowPressable>
                    ))}
                  </>
                ) : (
                  <ListRowLayout label={gt("No measured storage")} />
                )}
              </SettingsSection>
              {sortedAgents.length > 0 && (
                <SettingsSection title={gt("Storage by agent")}>
                  {sortedAgents.map((agent) => (
                    <ListRowLayout
                      key={agent.agentId}
                      icon="person.crop.circle"
                      label={agentsById.get(agent.agentId) ?? gt("Removed agent")}
                      description={gt("{fileCount} files · {conversationCount} chats", {
                        fileCount: agent.fileCount,
                        conversationCount: agent.conversationCount,
                      })}
                      detail={size(agent.bytes)}
                    />
                  ))}
                </SettingsSection>
              )}
              {largest.length > 0 && (
                <SettingsSection title={gt("Largest chats")}>
                  {largest.map((chat) => (
                    <ListRowLayout
                      key={JSON.stringify([chat.agentId, chat.id])}
                      label={chat.title}
                      description={gt("{value} · {messageCount} messages · {fileCount} files", {
                        value: agentsById.get(chat.agentId) ?? "Removed agent",
                        messageCount: chat.messageCount,
                        fileCount: chat.fileCount,
                      })}
                      detail={size(chat.bytes)}
                    />
                  ))}
                </SettingsSection>
              )}
              {files.length > 0 && (
                <SettingsSection title={gt("Files")}>
                  <ListRow
                    icon="doc"
                    label={gt("All stored files")}
                    description={`${files.length} files`}
                    detail={size(files.reduce((sum, item) => sum + item.size, 0))}
                    onPress={() => setDetail(true)}
                  />
                </SettingsSection>
              )}
              {canClear && clearable.length > 0 && (
                <SettingsSection title={gt("Clean up")}>
                  {clearable.map((item) => (
                    <ListRow
                      key={item.category}
                      icon="trash"
                      label={item.category === "caches" ? gt("Clear caches") : gt("Clear logs")}
                      detail={size(item.bytes)}
                      disabled={busy || !operationalConnection}
                      onPress={() => confirmClear(item.category)}
                    />
                  ))}
                </SettingsSection>
              )}
            </>
          )}
          {detail && (
            <SettingsSection
              title={gt("{length} stored files", { length: files.length })}
              footer={
                usage?.truncated
                  ? "The inventory is limited to the storage records this server lists."
                  : undefined
              }
            >
              {files.slice(0, fileLimit).map((file) => {
                const viewable = preview.canOpen && file.status === "available";
                const deletable =
                  canDelete && file.deletable && !busy && Boolean(operationalConnection);
                const description = [
                  file.conversation?.title,
                  file.status === "missing" ? "Missing" : null,
                ]
                  .filter(Boolean)
                  .join(" · ");
                return (
                  <Menu
                    key={JSON.stringify([file.agentId, file.id])}
                    shouldOpenOnLongPress
                    actions={[
                      { id: "open", title: gt("Preview"), attributes: { disabled: !viewable } },
                      ...(deletable
                        ? [
                            {
                              id: "delete",
                              title: gt("Delete file"),
                              attributes: { destructive: true },
                            },
                          ]
                        : []),
                    ]}
                    onPressAction={({ nativeEvent }) => {
                      if (nativeEvent.event === "open") openFile(file);
                      if (nativeEvent.event === "delete") confirmDelete(file);
                    }}
                  >
                    <ListRow
                      icon={file.kind === "image" ? "photo" : "doc"}
                      label={file.name}
                      description={description || undefined}
                      detail={size(file.size)}
                      onPress={() => openFile(file)}
                    />
                  </Menu>
                );
              })}
              {files.length > fileLimit && (
                <ListRow
                  label={gt("Show more files")}
                  onPress={() => setFileLimit((count) => count + 100)}
                />
              )}
            </SettingsSection>
          )}
        </ScreenScrollView>
      </Sheet>
      {preview.modal.source && <FilePreviewModal {...preview.modal} />}
    </>
  );
}
