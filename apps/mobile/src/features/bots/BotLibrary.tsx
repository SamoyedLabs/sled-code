import { useAtomValue } from "@effect/atom-react";
import { useNavigation, type StaticScreenProps } from "@react-navigation/native";
import {
  OPENBOT_LIBRARY_FOLDERS_CAPABILITY,
  OPENBOT_LIBRARY_STORAGE_CAPABILITY,
  OpenbotLibraryFiles,
  OpenbotLibraryFolders,
  type EnvironmentId,
  type OpenbotLibraryAction,
  type OpenbotLibraryFile,
} from "@t3tools/contracts";
import { settingsCapabilities } from "@t3tools/client-runtime/openbot/settings";
import { randomUUID } from "expo-crypto";
import * as Schema from "effect/Schema";
import { LegendList } from "@legendapp/list/react-native";
import { useEffect, useMemo, useRef, useState, type ComponentProps } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { FilePreviewModal } from "../../components/ui/FilePreviewModal";
import { SymbolView, type AppSymbolName } from "../../components/ui/AppSymbol";
import * as Dialog from "../../components/ui/Dialog";
import { Menu } from "../../components/ui/Menu";
import { RefreshControl } from "../../components/ui/RefreshControl";
import { NativeScrollView } from "../../native/NativeScrollViewMarker";
import { openbot } from "../../state/openbot";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { SettingsScreen } from "../settings/components/SettingsScreen";
import { useBotAttachmentPreview } from "./BotAttachmentPreview";
import { BotLibraryGallery, LibraryPicture } from "./BotLibraryGallery";
import { BotGlass, useBotPalette } from "./upstream/BotChrome";
import { bentoBlocks } from "./upstream/openbot-mobile/features/servers/model/library-bento";
import { OpenBotText as Text } from "./upstream/OpenBotTypography";

type Scope = { environmentId: EnvironmentId; hostId: string };
type Place = { kind: "all" | "removed" } | { kind: "agent" | "folder"; id: string };
type Folder = OpenbotLibraryFolders["folders"][number];
type MenuActions = ComponentProps<typeof Menu>["actions"];
const all: Place = { kind: "all" };
const fileFilters = [
  "All files",
  "Images",
  "Documents",
  "Code",
  "Spreadsheets",
  "Media",
  "Other",
] as const;
type FileFilter = (typeof fileFilters)[number];
const decodeFiles = Schema.decodeUnknownOption(OpenbotLibraryFiles);
const decodeFolders = Schema.decodeUnknownOption(OpenbotLibraryFolders);
const EMPTY_FILES: readonly OpenbotLibraryFile[] = [];
const TILE_GAP = 6;
const fileIcons: Record<Exclude<FileFilter, "All files">, AppSymbolName> = {
  Images: "photo",
  Documents: "doc.text",
  Code: "chevron.left.forwardslash.chevron.right",
  Spreadsheets: "chart.bar.xaxis",
  Media: "headphones",
  Other: "doc",
};

function fileType(file: OpenbotLibraryFile): Exclude<FileFilter, "All files"> {
  if (file.kind === "image") return "Images";
  const extension = file.name.split(".").at(-1)?.toLowerCase();
  if (extension && /^(csv|xls[xm]?|ods|tsv)$/u.test(extension)) return "Spreadsheets";
  if (
    extension &&
    /^(js|ts|tsx|jsx|css|html|py|swift|sh|json|yaml|yml|toml|rs|go|sql)$/u.test(extension)
  )
    return "Code";
  if (file.mimeType.startsWith("audio/") || file.mimeType.startsWith("video/")) return "Media";
  if (file.previewKind === "pdf" || file.previewKind === "text") return "Documents";
  return "Other";
}

function folderDescendants(folders: readonly Folder[], id: string) {
  const subtree = new Set([id]);
  for (let depth = 0; depth < 5; depth += 1) {
    for (const folder of folders) {
      if (folder.parentId && subtree.has(folder.parentId)) subtree.add(folder.id);
    }
  }
  return subtree;
}

export function useBotLibraryAvailability(scope: Scope | null) {
  const compatibility = useEnvironmentQuery(
    scope
      ? openbot.readFromHost({
          environmentId: scope.environmentId,
          input: { hostId: scope.hostId, request: { operation: "compatibility.read" } },
        })
      : null,
  );
  return settingsCapabilities(compatibility.data).includes(OPENBOT_LIBRARY_STORAGE_CAPABILITY);
}

export function BotLibraryRoute({ route }: StaticScreenProps<Scope>) {
  return <BotLibrary key={JSON.stringify(route.params)} {...route.params} />;
}

function BotLibrary({ environmentId, hostId }: Scope) {
  const p = useBotPalette();
  const insets = useSafeAreaInsets();
  const [place, setPlace] = useState<Place>(all);
  const [filter, setFilter] = useState<FileFilter>("All files");
  const [width, setWidth] = useState(0);
  const [rescan, setRescan] = useState(false);
  const [busy, setBusy] = useState(false);
  const navigation = useNavigation();
  const shareAbort = useRef<AbortController | null>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Cancel the share owned by this Library when it leaves.
  useEffect(() => () => shareAbort.current?.abort(), []);
  const [gallery, setGallery] = useState<{
    files: readonly OpenbotLibraryFile[];
    index: number;
  } | null>(null);
  const [undo, setUndo] = useState<OpenbotLibraryAction | null>(null);
  const lock = useRef(false);
  const compatibility = useEnvironmentQuery(
    openbot.readFromHost({
      environmentId,
      input: { hostId, request: { operation: "compatibility.read" } },
    }),
  );
  const streamingImages = settingsCapabilities(compatibility.data).includes(
    "sled-library-stream-v1",
  );
  const filesSupported = settingsCapabilities(compatibility.data).includes(
    OPENBOT_LIBRARY_STORAGE_CAPABILITY,
  );
  const foldersSupported = settingsCapabilities(compatibility.data).includes(
    OPENBOT_LIBRARY_FOLDERS_CAPABILITY,
  );
  const inventory = useEnvironmentQuery(
    filesSupported
      ? openbot.readFromHost({
          environmentId,
          input: {
            hostId,
            request: { operation: "library.files.list", ...(rescan ? { force: true } : {}) },
          },
        })
      : null,
  );
  const structure = useEnvironmentQuery(
    foldersSupported
      ? openbot.readFromHost({
          environmentId,
          input: { hostId, request: { operation: "library.folders.read" } },
        })
      : null,
  );
  const agentList = useEnvironmentQuery(openbot.agents({ environmentId, input: {} }));
  const writeInput = {
    hostId,
    request: {
      operation: "library.folders.change" as const,
      action: { type: "delete" as const, folderId: "" },
    },
  };
  const canWrite = useAtomValue(openbot.adminToHost.permissionAtom(environmentId, writeInput));
  const canDelete = useAtomValue(
    openbot.adminToHost.permissionAtom(environmentId, {
      hostId,
      request: { operation: "library.files.delete", fileId: "file" },
    }),
  );
  const write = useAtomCommand(openbot.adminToHost, { reportFailure: false });
  const preview = useBotAttachmentPreview(environmentId, hostId);
  const filesResult = useMemo(() => decodeFiles(inventory.data), [inventory.data]);
  const foldersResult = useMemo(() => decodeFolders(structure.data), [structure.data]);
  const model = foldersResult._tag === "Some" ? foldersResult.value : null;
  const files = filesResult._tag === "Some" ? filesResult.value.files : EMPTY_FILES;
  const folders = model?.folders ?? [];
  const agents = agentList.data ?? [];
  const agentNames = useMemo(
    () => new Map(agentList.data?.map((agent) => [agent.id, agent.name])),
    [agentList.data],
  );
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const selected = place.kind === "folder" ? byId.get(place.id) : undefined;
  const activeAgent = place.kind === "agent" ? place.id : selected?.agentId;
  const label =
    selected?.name ??
    (activeAgent ? agentNames.get(activeAgent) : undefined) ??
    (place.kind === "removed" ? "Removed bots" : "All files");
  const pathLabel = (id: string) => {
    const path: string[] = [];
    let row = byId.get(id);
    while (row && path.length < 5) {
      path.unshift(row.name);
      row = row.parentId ? byId.get(row.parentId) : undefined;
    }
    return path.join(" / ");
  };
  const placementOf = (fileId: string) =>
    model && Object.hasOwn(model.placement, fileId) ? model.placement[fileId] : undefined;
  const selectedId = selected?.id;
  const placeKind = place.kind;
  const { filtersHere, activeFilter, shown } = (() => {
    const membership = model?.placement;
    const filesHere = files.filter((file) => {
      if (file.status === "missing") return false;
      const folderId =
        membership && Object.hasOwn(membership, file.id) ? membership[file.id] : undefined;
      if (selectedId) return folderId === selectedId;
      if (activeAgent) return file.agentId === activeAgent && !folderId;
      if (placeKind === "removed") return file.agentId !== null && !agentNames.has(file.agentId);
      return true;
    });
    const filtersHere = fileFilters.filter(
      (value) => value === "All files" || filesHere.some((file) => value === fileType(file)),
    );
    const activeFilter = filtersHere.includes(filter) ? filter : "All files";
    const shown = filesHere
      .filter((file) => activeFilter === "All files" || fileType(file) === activeFilter)
      .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
    return { filtersHere, activeFilter, shown };
  })();
  const gridWidth = Math.max(0, width - 40);
  const columns = Math.max(3, Math.floor((gridWidth + TILE_GAP) / (104 + TILE_GAP)));
  const layout =
    gridWidth > 0
      ? bentoBlocks(
          shown.map((file) => file.kind === "image"),
          gridWidth,
          columns,
          TILE_GAP,
        )
      : [];
  const canOrganize = Boolean(canWrite && model && !busy);
  const mutate = async (action: OpenbotLibraryAction, undoAction?: OpenbotLibraryAction) => {
    if (!canOrganize || lock.current) return;
    lock.current = true;
    setBusy(true);
    await (async () => {
      const result = await write({
        environmentId,
        input: {
          hostId,
          request: { operation: "library.folders.change", action },
        },
      });
      if (result._tag !== "Success" || decodeFolders(result.value)._tag !== "Some")
        throw new Error("Unconfirmed folder change");
      setUndo(undoAction ?? null);
      if (action.type === "delete" && selected?.id === action.folderId)
        setPlace({ kind: "agent", id: selected.agentId });
    })()
      .catch(() => {
        Dialog.alert("Could not change folders", "Refresh the Library and try again.");
      })
      .finally(() => {
        structure.refresh();
        lock.current = false;
        setBusy(false);
      });
  };
  const promptName = (agentId: string, existing?: Folder, parentId?: string, fileId?: string) => {
    Dialog.prompt({
      title: existing ? "Rename folder" : "New folder",
      placeholder: "Folder name",
      initialValue: existing?.name ?? "",
      confirmText: existing ? "Rename" : "Create",
      onConfirm: (value) => {
        const name = value.trim();
        if (!name || name.length > 80) return;
        void mutate(
          existing
            ? { type: "rename", folderId: existing.id, name }
            : {
                type: "create",
                id: randomUUID(),
                agentId,
                name,
                ...(parentId ? { parentId } : {}),
                ...(fileId ? { fileIds: [fileId] } : {}),
              },
        );
      },
    });
  };
  const folderActions = (folder: Folder): MenuActions => {
    const descendants = folderDescendants(folders, folder.id);
    const eligible = folders.filter(
      (row) => row.agentId === folder.agentId && !descendants.has(row.id),
    );
    return [
      { id: "rename", title: "Rename" },
      { id: "new", title: "New folder" },
      {
        id: "move",
        title: "Move folder",
        subactions: [
          { id: "root", title: "Top level" },
          ...eligible.map((row) => ({ id: `move:${row.id}`, title: pathLabel(row.id) })),
        ],
      },
      { id: "delete", title: "Remove folder", attributes: { destructive: true } },
    ];
  };
  const onFolderAction = (folder: Folder, event: string) => {
    if (event === "rename") promptName(folder.agentId, folder);
    if (event === "new") promptName(folder.agentId, undefined, folder.id);
    if (event === "root" || event.startsWith("move:"))
      void mutate({
        type: "move",
        folderId: folder.id,
        parentId: event === "root" ? null : event.slice(5),
        beforeFolderId: null,
      });
    if (event === "delete")
      Dialog.confirm({
        title: "Remove folder?",
        message: "The files will stay in the Library.",
        confirmText: "Remove folder",
        destructive: true,
        onConfirm: () => {
          const removed = folderDescendants(folders, folder.id);
          const restore: OpenbotLibraryAction = {
            type: "restore",
            folders: folders.flatMap((row, index) =>
              removed.has(row.id) ? [{ index, folder: row }] : [],
            ),
            placement: Object.fromEntries(
              Object.entries(model?.placement ?? {}).filter(([, id]) => removed.has(id)),
            ),
          };
          void mutate({ type: "delete", folderId: folder.id }, restore);
        },
      });
  };
  const folderRows = activeAgent
    ? folders.filter(
        (row) => row.agentId === activeAgent && (row.parentId ?? null) === (selected?.id ?? null),
      )
    : [];
  const placeActions: MenuActions = [
    { id: "all", title: "All files" },
    ...agents.map((agent) => ({ id: `agent:${agent.id}`, title: agent.name })),
    ...folders.map((row) => ({ id: `folder:${row.id}`, title: pathLabel(row.id) })),
    ...(files.some((file) => file.agentId !== null && !agentNames.has(file.agentId))
      ? [{ id: "removed", title: "Removed bots" }]
      : []),
  ];
  async function shareFile(file: OpenbotLibraryFile) {
    if (shareAbort.current) return;
    const controller = new AbortController();
    shareAbort.current = controller;
    const conversationId = file.conversation?.id;
    try {
      await preview.shareLibrary(file.id, conversationId, controller.signal);
    } catch {
      if (!controller.signal.aborted) Dialog.alert("Could not share the file", "Try again.");
    }
    if (shareAbort.current === controller) shareAbort.current = null;
  }
  function confirmDeleteFile(file: OpenbotLibraryFile) {
    if (!canDelete || !file.deletable) return;
    Dialog.confirm({
      title: "Delete file?",
      message: file.name,
      confirmText: "Delete",
      destructive: true,
      onConfirm: () => {
        if (lock.current) return;
        lock.current = true;
        setBusy(true);
        void write({
          environmentId,
          input: { hostId, request: { operation: "library.files.delete", fileId: file.id } },
        })
          .then((result) => {
            if (
              result._tag !== "Success" ||
              (typeof result.value === "object" &&
                result.value !== null &&
                "dataError" in result.value)
            )
              throw new Error("Deletion was not confirmed.");
            setRescan(true);
            inventory.refresh();
            structure.refresh();
          })
          .catch(() => {
            Dialog.alert(
              "Could not delete the file",
              "Check this computer’s permissions and try again.",
            );
          })
          .finally(() => {
            lock.current = false;
            setBusy(false);
          });
      },
    });
  }
  const openFile = (file: OpenbotLibraryFile) => {
    if (file.kind === "image") {
      const pictures = shown.filter((item) => item.kind === "image");
      const index = pictures.findIndex((item) => item.id === file.id);
      if (index >= 0) {
        setGallery({ files: pictures, index });
        return;
      }
    }
    void preview.openLibrary(file.id, file.conversation?.id);
  };

  return (
    <SettingsScreen title={label === "All files" ? "Library" : label}>
      <View
        style={{ flex: 1, backgroundColor: p.canvas }}
        onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
      >
        <LegendList
          renderScrollComponent={NativeScrollView}
          data={layout}
          estimatedItemSize={220}
          extraData={{
            shown,
            folders,
            agents,
            agentNames,
            p,
            canOrganize,
            canDelete,
            busy,
            streamingImages,
            preview,
          }}
          contentInsetAdjustmentBehavior="automatic"
          keyExtractor={(block) => block.tiles.map((tile) => shown[tile.index]?.id).join(",")}
          refreshControl={
            <RefreshControl
              refreshing={rescan && inventory.isPending}
              onRefresh={() => {
                setRescan(true);
                if (rescan) inventory.refresh();
                structure.refresh();
              }}
            />
          }
          contentContainerStyle={{
            paddingHorizontal: 20,
            paddingTop: 12,
            paddingBottom: insets.bottom + 78,
          }}
          ListHeaderComponent={
            <View style={{ gap: 12, marginBottom: 14 }}>
              {activeAgent && (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                  <Text style={{ flex: 1, color: p.muted }}>
                    {agentNames.get(activeAgent) ?? "Bot"}
                    {selected ? ` · ${pathLabel(selected.id)}` : ""}
                  </Text>
                  {canOrganize && (
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => promptName(activeAgent, undefined, selected?.id)}
                    >
                      <Text style={{ color: p.text }}>New folder</Text>
                    </Pressable>
                  )}
                </View>
              )}
              {folderRows.map((row) => (
                <View
                  key={row.id}
                  style={{ flexDirection: "row", backgroundColor: p.surface, borderRadius: 12 }}
                >
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={row.name}
                    onPress={() => setPlace({ kind: "folder", id: row.id })}
                    style={{
                      minHeight: 44,
                      flex: 1,
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 10,
                      paddingHorizontal: 12,
                    }}
                  >
                    <SymbolView name="folder" size={18} tintColor={p.muted} />
                    <Text numberOfLines={1} style={{ color: p.text, flexShrink: 1 }}>
                      {row.name}
                    </Text>
                  </Pressable>
                  {canOrganize && (
                    <Menu
                      actions={folderActions(row)}
                      onPressAction={({ nativeEvent }) => onFolderAction(row, nativeEvent.event)}
                    >
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Actions for ${row.name}`}
                        style={{ padding: 12 }}
                      >
                        <SymbolView name="ellipsis" size={18} tintColor={p.muted} />
                      </Pressable>
                    </Menu>
                  )}
                </View>
              ))}
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ gap: 6 }}
              >
                {filtersHere.map((item) => (
                  <Pressable
                    key={item}
                    accessibilityRole="button"
                    accessibilityState={{ selected: activeFilter === item }}
                    onPress={() => setFilter(item)}
                    style={{
                      paddingHorizontal: 12,
                      paddingVertical: 8,
                      borderRadius: 20,
                      backgroundColor: activeFilter === item ? p.control : p.surface,
                    }}
                  >
                    <Text style={{ color: activeFilter === item ? p.text : p.muted }}>{item}</Text>
                  </Pressable>
                ))}
              </ScrollView>
              {undo && canOrganize && (
                <Pressable accessibilityRole="button" onPress={() => void mutate(undo)}>
                  <Text style={{ color: p.text }}>Undo folder removal</Text>
                </Pressable>
              )}
            </View>
          }
          ListEmptyComponent={
            <Text style={{ paddingTop: 36, textAlign: "center", color: p.muted }}>
              {compatibility.isPending || inventory.isPending
                ? "Loading Library…"
                : inventory.error
                  ? "The Library could not load."
                  : filesSupported
                    ? "No files here yet."
                    : "Library is unavailable on this computer."}
            </Text>
          }
          renderItem={({ item }) => (
            <View style={{ height: item.height, marginBottom: TILE_GAP }}>
              {item.tiles.map(({ index, left, top, width: tileWidth, height }) => {
                const file = shown[index];
                if (!file) return null;
                const agentId = file.agentId;
                const destinations = folders.filter((row) => row.agentId === agentId);
                const agent = agents.find((row) => row.id === agentId);
                const actionItems: MenuActions = [
                  ...(agent && file.messageId ? [{ id: "show", title: "Show in chat" }] : []),
                  ...(preview.canOpen
                    ? [
                        { id: "open", title: "Open file" },
                        { id: "share", title: "Share" },
                      ]
                    : []),
                  ...(canDelete && file.deletable
                    ? [
                        {
                          id: "delete",
                          title: "Delete",
                          attributes: { destructive: true, disabled: busy },
                        },
                      ]
                    : []),
                  ...(canOrganize && agentId && agentNames.has(agentId)
                    ? [
                        { id: "new", title: "Move to new folder" },
                        ...(placementOf(file.id)
                          ? [{ id: "remove", title: "Remove from folder" }]
                          : []),
                        ...destinations.map((row) => ({
                          id: `place:${row.id}`,
                          title: pathLabel(row.id),
                        })),
                      ]
                    : []),
                ];
                const tile = (
                  <Pressable
                    accessibilityLabel={file.name}
                    accessibilityRole="button"
                    onPress={() => openFile(file)}
                    style={{
                      flex: 1,
                      justifyContent: "space-between",
                      padding: 10,
                      backgroundColor: p.surface,
                      borderRadius: 10,
                      overflow: "hidden",
                    }}
                  >
                    <View
                      style={{
                        width: 32,
                        height: 32,
                        borderRadius: 9,
                        backgroundColor: p.control,
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <SymbolView name={fileIcons[fileType(file)]} size={18} tintColor={p.muted} />
                    </View>
                    <View style={{ gap: 2 }}>
                      <Text numberOfLines={2} style={{ color: p.text, fontSize: 12 }}>
                        {file.name}
                      </Text>
                      <Text numberOfLines={1} style={{ color: p.muted, fontSize: 11 }}>
                        {file.conversation?.title ??
                          (file.agentId ? agentNames.get(file.agentId) : undefined)}
                      </Text>
                    </View>
                    {file.kind === "image" && (
                      <LibraryPicture
                        environmentId={environmentId}
                        hostId={hostId}
                        file={file}
                        streamingImages={streamingImages}
                      />
                    )}
                  </Pressable>
                );
                return (
                  <View
                    key={file.id}
                    style={{ position: "absolute", left, top, width: tileWidth, height }}
                  >
                    {actionItems.length ? (
                      <Menu
                        shouldOpenOnLongPress
                        style={{ flex: 1 }}
                        actions={actionItems}
                        onPressAction={({ nativeEvent }) => {
                          const { event } = nativeEvent;
                          if (event === "open") openFile(file);
                          if (event === "share") void shareFile(file);
                          if (event === "show" && agent && file.messageId) {
                            navigation.navigate("BotAgentThread", {
                              environmentId,
                              hostId,
                              agentId: agent.id,
                              name: agent.name,
                              title: agent.name,
                              taskId: null,
                              initialMessageId: file.messageId,
                              ...(agent.avatarSeed ? { avatarSeed: agent.avatarSeed } : {}),
                              ...(agent.avatarHue == null ? {} : { avatarHue: agent.avatarHue }),
                            });
                          }
                          if (event === "delete") confirmDeleteFile(file);
                          if (event === "new" && agentId)
                            promptName(agentId, undefined, undefined, file.id);
                          if (event === "remove" || event.startsWith("place:"))
                            void mutate({
                              type: "place",
                              fileIds: [file.id],
                              folderId: event === "remove" ? null : event.slice(6),
                            });
                        }}
                      >
                        {tile}
                      </Menu>
                    ) : (
                      tile
                    )}
                  </View>
                );
              })}
            </View>
          )}
        />
        <View style={{ position: "absolute", bottom: insets.bottom + 8, alignSelf: "center" }}>
          <Menu
            actions={placeActions}
            onPressAction={({ nativeEvent }) => {
              const { event } = nativeEvent;
              if (event === "all" || event === "removed") setPlace({ kind: event });
              if (event.startsWith("agent:")) setPlace({ kind: "agent", id: event.slice(6) });
              if (event.startsWith("folder:")) setPlace({ kind: "folder", id: event.slice(7) });
            }}
          >
            <BotGlass style={{ borderRadius: 24 }}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Library location"
                style={{
                  minHeight: 44,
                  flexDirection: "row",
                  alignItems: "center",
                  paddingHorizontal: 14,
                  gap: 10,
                }}
              >
                <SymbolView
                  name={selected ? "folder" : "square.grid.2x2"}
                  size={17}
                  tintColor={p.muted}
                />
                <Text style={{ color: p.text }}>{label}</Text>
                <SymbolView name="chevron.down" size={12} tintColor={p.muted} />
              </Pressable>
            </BotGlass>
          </Menu>
        </View>
        <FilePreviewModal {...preview.modal} />
        {gallery && (
          <BotLibraryGallery
            environmentId={environmentId}
            hostId={hostId}
            files={gallery.files}
            initialIndex={gallery.index}
            canShare={preview.canOpen}
            streamingImages={streamingImages}
            resolve={(file, signal) =>
              preview.resolveLibrary(file.id, file.conversation?.id, signal)
            }
            share={(file, signal) => preview.shareLibrary(file.id, file.conversation?.id, signal)}
            onClose={() => setGallery(null)}
          />
        )}
      </View>
    </SettingsScreen>
  );
}
