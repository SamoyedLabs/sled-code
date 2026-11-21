import { SidebarPeopleSection, type SidebarPeople } from "./SidebarPeopleSection";
import { orderedPeople } from "./directModel";
/* oxlint-disable shadcn/no-unknown-classes -- OpenBot source selectors live in the imported scoped sidebar styles. */
import {
  useContext,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type ReactNode,
} from "react";
import { RegistryContext, useAtomValue } from "@effect/atom-react";
import { ContextMenu } from "@base-ui/react/context-menu";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  ChevronDownIcon,
  FolderIcon,
  FolderOpenIcon,
  FolderPlusIcon,
  PencilIcon,
  RefreshCwIcon,
  PinIcon,
  PinOffIcon,
  MoonIcon,
  RotateCcwIcon,
  Trash2Icon,
} from "lucide-react";
import type { EnvironmentId, OpenbotAgent, OpenbotChannelSummary } from "@t3tools/contracts";
import { settingResult, settingsCapabilities } from "@t3tools/client-runtime/openbot/settings";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { openbot } from "../../../state/openbot";
import { useEnvironmentQuery } from "../../../state/query";
import { useAtomCommand } from "../../../state/use-atom-command";
import { readPreparedConnection } from "../../../state/session";
import { SourceAgentAvatar } from "../SourceAgentAvatar";
import { GroupAvatar } from "../GroupAvatar";
import { MenuItem, MenuSeparator, MenuSub, MenuSubTrigger } from "../../ui/menu";
import { renderClosingPositioner } from "../../ui/closing-positioner";
import { MenuSubPopup } from "./OpenbotMenu";
import { menuMotionRef } from "./openbotMenuMotion";
import {
  sidebarFolderAncestors,
  sidebarFolderParents,
  sidebarFolderPath,
} from "./openbotSidebarFolders";
import { createSidebarChatDragCard, measureSidebarDragSlots } from "./openbotSidebarDragDom";
import {
  reorderOffsets,
  sidebarDropTargetAt,
  sidebarDropTargetsEqual,
  type SidebarDragSource,
  type SidebarDragWorld,
  type SidebarDropTarget,
  type SidebarDragPoint,
  type DragOffset,
} from "./openbotSidebarDrag";
import {
  newestSidebarLayout,
  orderedSidebarChats,
  parseSidebarLayout,
  sidebarActionRequest,
  projectSidebarLayout,
  sidebarOptionalRead,
  sidebarCanNest,
  sidebarChatKey,
  sidebarChatName,
  sidebarDropAction,
  sidebarHidden,
  sidebarPins,
  sidebarPinRequest,
  sidebarPinReorderRequest,
  sidebarHideRequest,
  sidebarSectionOf,
  type SidebarAction,
  type SidebarChat,
  type SidebarLayout,
} from "./openbotSidebarModel";
import { createSidebarDragMotion } from "./openbotSidebarDragMotion";
import { SidebarDeleteDialog } from "./OpenbotSidebarDeleteDialog";
import type { OpenbotSettingsAdminRequest } from "@t3tools/contracts/openbot-settings";
import "./OpenbotSidebar.css";
import { T, useGT } from "gt-react";

export type OpenbotSidebarProps = {
  environmentId: EnvironmentId;
  hostId: string | null;
  agents: readonly (typeof OpenbotAgent.Type)[];
  channels: readonly OpenbotChannelSummary[];
  selectedAgentId: string | null;
  selectedChannelId: string | null;
  onAgent: (id: string) => void;
  onGroup: (id: string) => void;
  search?: string;
  people?: SidebarPeople;
};

type DragView = {
  source: SidebarDragSource;
  target: SidebarDropTarget | null;
  offsets: Record<string, DragOffset>;
  waiting: ReadonlySet<string>;
};
type Editor =
  | { type: "create"; parentId?: string }
  | { type: "rename"; sectionId: string; name: string };
function collapseKey(environmentId: EnvironmentId, hostId: string) {
  return `openbot.sidebar-collapse:${JSON.stringify([environmentId, hostId])}`;
}
function readCollapsed(key: string): ReadonlySet<string> {
  try {
    const ids: unknown = JSON.parse(localStorage.getItem(key) ?? "[]");
    return new Set(
      Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : [],
    );
  } catch {
    return new Set();
  }
}
function saveCollapsed(key: string, ids: ReadonlySet<string>) {
  try {
    localStorage.setItem(key, JSON.stringify([...ids]));
  } catch {
    /* Collapse still works when storage is unavailable. */
  }
}
function timeLabel(value: string | null | undefined) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toDateString() === new Date().toDateString()
    ? date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : date.toLocaleDateString([], { month: "short", day: "numeric" });
}
function SidebarContextPopup({ children }: { children: ReactNode }) {
  return (
    <ContextMenu.Portal>
      <ContextMenu.Positioner
        className="openbot-react openbot-popup-positioner"
        data-openbot-positioner=""
        render={renderClosingPositioner}
      >
        <ContextMenu.Popup
          ref={menuMotionRef(undefined)}
          className="ui-action-menu agent-context-menu"
        >
          {children}
        </ContextMenu.Popup>
      </ContextMenu.Positioner>
    </ContextMenu.Portal>
  );
}
export function OpenbotSidebar(props: OpenbotSidebarProps) {
  const gt = useGT();
  return props.hostId ? (
    <HostSidebar
      key={JSON.stringify([props.environmentId, props.hostId])}
      {...props}
      hostId={props.hostId}
    />
  ) : (
    <nav className="agent-list" aria-label={gt("Chats")}>
      <p className="ob-sidebar-notice" role="status">
        <T>Choose a host to view chats.</T>
      </p>
    </nav>
  );
}
function HostSidebar(props: OpenbotSidebarProps & { hostId: string }) {
  const gt = useGT();
  const { environmentId, hostId } = props;
  const [peopleOrder, setPeopleOrder] = useState<readonly string[]>(() => {
    try {
      const ids: unknown = JSON.parse(
        localStorage.getItem(`openbot.people-order:${JSON.stringify([environmentId, hostId])}`) ??
          "[]",
      );
      return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : [];
    } catch {
      return [];
    }
  });
  const people = props.people?.selfId
    ? {
        ...props.people,
        members: orderedPeople(
          props.people.members,
          props.people.selfId,
          props.people.threads,
          peopleOrder,
        ),
      }
    : null;
  const reorderPeople = (sourceId: string, targetId: string, placement: "before" | "after") => {
    if (!people) return;
    const ids = people.members.map((member) => member.id).filter((id) => id !== sourceId);
    const target = ids.indexOf(targetId);
    if (target < 0) return;
    ids.splice(target + (placement === "after" ? 1 : 0), 0, sourceId);
    setPeopleOrder(ids);
    try {
      localStorage.setItem(
        `openbot.people-order:${JSON.stringify([environmentId, hostId])}`,
        JSON.stringify(ids),
      );
    } catch {
      /* Reordering remains available without storage. */
    }
  };

  const registry = useContext(RegistryContext);
  const compatibility = useEnvironmentQuery(
    openbot.readFromHost({
      environmentId,
      input: { hostId, request: { operation: "compatibility.read" } },
    }),
  );
  const capabilities = settingsCapabilities(compatibility.data);
  const canReadFolders = useAtomValue(
    openbot.settingsRead.permissionAtom(environmentId, {
      hostId,
      request: { operation: "settings.sidebar-folders.read", parameters: {} },
    }),
  );
  const canReadPins = useAtomValue(
    openbot.settingsRead.permissionAtom(environmentId, {
      hostId,
      request: { operation: "settings.sidebar-pins.read", parameters: {} },
    }),
  );
  const canReadHidden = useAtomValue(
    openbot.settingsRead.permissionAtom(environmentId, {
      hostId,
      request: { operation: "settings.agent-hidden.read", parameters: {} },
    }),
  );
  const supportsFolders = capabilities.includes("sidebar-folders-v1") && canReadFolders;
  const coreQuery = useEnvironmentQuery(
    openbot.readFromHost({
      environmentId,
      input: { hostId, request: { operation: "workspace.sidebar" } },
    }),
  );
  const folderQuery = useEnvironmentQuery(
    supportsFolders
      ? openbot.readFromHost({
          environmentId,
          input: {
            hostId,
            request: { operation: "settings.sidebar-folders.read", parameters: {} },
          },
        })
      : null,
  );
  const refreshSidebar = () => {
    coreQuery.refresh();
    if (supportsFolders) folderQuery.refresh();
  };
  const pins = useEnvironmentQuery(
    capabilities.includes("sidebar-pins-v1") && canReadPins
      ? openbot.readFromHost({
          environmentId,
          input: { hostId, request: { operation: "settings.sidebar-pins.read", parameters: {} } },
        })
      : null,
  );
  const hidden = useEnvironmentQuery(
    capabilities.includes("agent-hidden-v1") && canReadHidden
      ? openbot.readFromHost({
          environmentId,
          input: { hostId, request: { operation: "settings.agent-hidden.read", parameters: {} } },
        })
      : null,
  );
  const attention = useEnvironmentQuery(openbot.attention({ environmentId, input: {} }));
  const admin = useAtomCommand(openbot.adminToHost, { reportFailure: false });
  const canAdmin = useAtomValue(
    openbot.adminToHost.permissionAtom(environmentId, {
      hostId,
      request: {
        operation: "settings.sidebar-folders.actions",
        parameters: { type: "create", name: "Folder" },
      },
    }),
  );
  const pinPermission = useAtomValue(
    openbot.adminToHost.permissionAtom(environmentId, {
      hostId,
      request: { operation: "settings.sidebar-pins.set", parameters: { items: [] } },
    }),
  );
  const hidePermission = useAtomValue(
    openbot.adminToHost.permissionAtom(environmentId, {
      hostId,
      request: {
        operation: "settings.agent-hidden.set",
        parameters: { agentId: props.agents[0]?.id ?? "unselected", hidden: false },
      },
    }),
  );
  const [savedPins, setSavedPins] = useState<{ value: unknown; readAt: number } | null>(null);
  const [savedHidden, setSavedHidden] = useState<{ value: unknown; readAt: number } | null>(null);
  const [deleteFolder, setDeleteFolder] = useState<{ id: string; name: string } | null>(null);
  const [dragMotion] = useState(createSidebarDragMotion);
  const [saved, setSaved] = useState<SidebarLayout | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [editor, setEditor] = useState<Editor | null>(null);
  const [collapsed, setCollapsed] = useState(() =>
    readCollapsed(collapseKey(environmentId, hostId)),
  );
  const [dragView, setDragView] = useState<DragView | null>(null);
  const list = useRef<HTMLElement>(null);
  const drag = useRef<SidebarDragWorld | null>(null);
  const lock = useRef(false);
  const mounted = useRef(true);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Release native drag state and ignore host responses after this host-scoped component leaves the DOM.
  useEffect(() => {
    mounted.current = true;
    const cancelDrag = () => {
      drag.current = null;
      setDragView(null);
      dragMotion.stop();
    };
    window.addEventListener("blur", cancelDrag);
    return () => {
      window.removeEventListener("blur", cancelDrag);
      dragMotion.stop();
      mounted.current = false;
      drag.current = null;
    };
  }, [dragMotion]);
  const projection = projectSidebarLayout(coreQuery, folderQuery, supportsFolders, saved);
  const layout = projection.layout;
  const mutable = projection.foldersMutable && !projection.error && canAdmin && !busy;
  const allChats = orderedSidebarChats(layout, props.agents, props.channels);
  const hiddenRead = sidebarOptionalRead(canReadHidden, hidden);
  const pinRead = sidebarOptionalRead(canReadPins, pins);
  const hiddenIds = sidebarHidden(
    hiddenRead === null
      ? null
      : savedHidden && hidden.dataUpdatedAt <= savedHidden.readAt
        ? savedHidden.value
        : hiddenRead,
  );
  const pinItems = sidebarPins(
    pinRead === null
      ? null
      : savedPins && pins.dataUpdatedAt <= savedPins.readAt
        ? savedPins.value
        : pinRead,
  );
  const pinKeys = pinItems.map(sidebarChatKey);
  const canPin =
    capabilities.includes("sidebar-pins-v1") &&
    pinPermission &&
    !busy &&
    pinRead !== null &&
    !pins.isPending;
  const canHide =
    capabilities.includes("agent-hidden-v1") &&
    hidePermission &&
    !busy &&
    hiddenRead !== null &&
    !hidden.isPending;
  const liveWaiting = new Set(
    attention.data?.hostId === hostId && attention.data.state === "ready"
      ? attention.data.requests.map((request) => request.agentId)
      : [],
  );
  const waitingIds = dragView?.waiting ?? liveWaiting;
  const search = props.search?.trim().toLocaleLowerCase() ?? "";
  const matches = (chat: SidebarChat) =>
    !search ||
    sidebarChatName(chat).toLocaleLowerCase().includes(search) ||
    (chat.kind === "agent" &&
      (chat.agent.preview?.toLocaleLowerCase().includes(search) ||
        chat.agent.title?.toLocaleLowerCase().includes(search)));
  const hiddenChats = allChats.filter(
    (chat) => chat.kind === "agent" && hiddenIds.has(chat.id) && matches(chat),
  );
  const shownChats = allChats.filter(
    (chat) => !(chat.kind === "agent" && hiddenIds.has(chat.id)) && matches(chat),
  );
  const pinnedChats = pinKeys.flatMap((key) => {
    const chat = shownChats.find((candidate) => sidebarChatKey(candidate) === key);
    return chat ? [chat] : [];
  });
  const listedChats = shownChats.filter((chat) => !pinKeys.includes(sidebarChatKey(chat)));
  const waitingChats = listedChats.filter((chat) => waitingIds.has(chat.id));
  const regularChats = listedChats.filter((chat) => !waitingIds.has(chat.id));
  const groups = new Map<string, SidebarChat[]>();
  for (const chat of regularChats) {
    const sectionId = sidebarSectionOf(layout, chat.id);
    groups.set(sectionId, [...(groups.get(sectionId) ?? []), chat]);
  }
  const parents = sidebarFolderParents(layout);
  const folders = new Map(layout.sections.map((section) => [section.id, section]));
  const visibleIds = layout.order.filter(
    (id) =>
      folders.has(id) ||
      (id === "people" && !!people?.members.length) ||
      (id === "unassigned" && (groups.get(id)?.length ?? 0) > 0),
  );
  const children = (parentId: string | null) =>
    visibleIds.filter((id) => (parents.get(id) ?? null) === parentId);
  const toggle = (id: string) => {
    const next = new Set(collapsed);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setCollapsed(next);
    saveCollapsed(collapseKey(environmentId, hostId), next);
  };
  const run = async (action: SidebarAction) => {
    const request = sidebarActionRequest(action);
    if (
      !mutable ||
      lock.current ||
      !request ||
      !registry.get(openbot.adminToHost.permissionAtom(environmentId, { hostId, request }))
    )
      return false;
    const connection = readPreparedConnection(environmentId);
    if (!connection) {
      setNotice(gt("Reconnect this host to arrange chats."));
      return false;
    }
    lock.current = true;
    setBusy(true);
    setNotice(null);
    setAnnouncement("");
    const result = await admin({ environmentId, input: { hostId, request } });
    lock.current = false;
    if (!mounted.current) return false;
    setBusy(false);
    if (readPreparedConnection(environmentId) !== connection) {
      setNotice(
        gt("The connection changed before the host confirmed this move. Refresh the sidebar."),
      );
      refreshSidebar();
      return false;
    }
    if (result._tag === "Failure") {
      setNotice(String(squashAtomCommandFailure(result)));
      refreshSidebar();
      return false;
    }
    const next = parseSidebarLayout(result.value);
    if (!next || next.revision < layout.revision) {
      setNotice(gt("The host returned an outdated layout. Refresh before moving chats again."));
      refreshSidebar();
      return false;
    }
    setSaved((previous) => newestSidebarLayout(next, previous));
    setAnnouncement("Sidebar saved.");
    refreshSidebar();
    return true;
  };
  const runPreference = async (request: typeof OpenbotSettingsAdminRequest.Type | null) => {
    if (
      !request ||
      (request.operation === "settings.sidebar-pins.set"
        ? !canPin
        : request.operation === "settings.agent-hidden.set"
          ? !canHide
          : true) ||
      lock.current ||
      !registry.get(openbot.adminToHost.permissionAtom(environmentId, { hostId, request }))
    )
      return false;
    const connection = readPreparedConnection(environmentId);
    if (!connection) {
      setNotice(gt("Reconnect this host to update chats."));
      return false;
    }
    lock.current = true;
    setBusy(true);
    setNotice(null);
    setAnnouncement("");
    const readAt =
      request.operation === "settings.sidebar-pins.set" ? pins.dataUpdatedAt : hidden.dataUpdatedAt;
    const result = await admin({ environmentId, input: { hostId, request } });
    lock.current = false;
    if (!mounted.current) return false;
    setBusy(false);
    if (readPreparedConnection(environmentId) !== connection) {
      setNotice(
        gt("The connection changed before the host confirmed this update. Refresh the sidebar."),
      );
      pins.refresh();
      hidden.refresh();
      return false;
    }
    if (result._tag === "Failure") {
      setNotice(String(squashAtomCommandFailure(result)));
      if (request.operation === "settings.sidebar-pins.set") pins.refresh();
      else hidden.refresh();
      return false;
    }
    const value = settingResult(request.operation, result.value);
    if (value === null) {
      setNotice(gt("The host returned an invalid sidebar update. Refresh before trying again."));
      if (request.operation === "settings.sidebar-pins.set") pins.refresh();
      else hidden.refresh();
      return false;
    }
    if (request.operation === "settings.sidebar-pins.set") {
      setSavedPins({ value, readAt });
      pins.refresh();
    } else {
      setSavedHidden({ value, readAt });
      hidden.refresh();
    }
    setAnnouncement("Sidebar saved.");
    return true;
  };
  const preferenceItems = (chat: SidebarChat, isHidden = false) => (
    <>
      {canPin && !isHidden && (
        <MenuItem
          onClick={() =>
            void runPreference(
              sidebarPinRequest(
                pinItems,
                { kind: chat.kind, id: chat.id },
                !pinKeys.includes(sidebarChatKey(chat)),
              ),
            )
          }
        >
          {pinKeys.includes(sidebarChatKey(chat)) ? <PinOffIcon /> : <PinIcon />}
          {pinKeys.includes(sidebarChatKey(chat)) ? gt("Unpin") : gt("Pin")}
        </MenuItem>
      )}
      {canHide && chat.kind === "agent" && (
        <MenuItem onClick={() => void runPreference(sidebarHideRequest(chat.id, !isHidden))}>
          {isHidden ? <RotateCcwIcon /> : <MoonIcon />}
          {isHidden ? gt("Restore") : gt("Hide")}
        </MenuItem>
      )}
    </>
  );
  const stopDrag = () => {
    dragMotion.stop();
    drag.current = null;
    setDragView(null);
  };
  const startDrag = (event: DragEvent<HTMLElement>, source: SidebarDragSource) => {
    if ((source.kind !== "person" && !mutable) || search || !list.current) {
      event.preventDefault();
      return;
    }
    event.stopPropagation();
    const measurement = measureSidebarDragSlots(list.current, (id) => sidebarSectionOf(layout, id));
    drag.current = {
      chatScrollDelta: 0,
      sectionScrollDelta: 0,
      sessionScrollDelta: 0,
      chatSlots: measurement.chats,
      sectionSlots: measurement.sections,
      personSlots: measurement.people,
      pinnedSlots: [],
      geometry: { ...measurement.geometry, pinned: null },
      canPinDraggedItem: () => false,
      sectionAcceptsChat: (id) => id === "unassigned" || folders.has(id),
      folders: {
        canNest: (id, parent) => sidebarCanNest(layout, id, parent),
        isInside: (id, ancestor) => sidebarFolderAncestors(parents, id).includes(ancestor),
        parent: (id) => parents.get(id) ?? null,
      },
      session: { source, startScrollTop: list.current.scrollTop },
    };
    dragMotion.start({
      bounds: list.current,
      source: event.currentTarget,
      event,
      className:
        source.kind === "chat"
          ? "sidebar-agent-drag-preview"
          : source.kind === "person"
            ? "sidebar-person-drag-preview"
            : "sidebar-section-drag-preview",
      ...(source.kind === "chat"
        ? { createPreview: createSidebarChatDragCard, previewSize: { height: 102, width: 72 } }
        : { horizontal: false }),
    });
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", JSON.stringify({ environmentId, hostId, source }));
    setDragView({ source, target: null, offsets: {}, waiting: new Set(waitingIds) });
  };
  const resolveDrag = (point: SidebarDragPoint) => {
    const world = drag.current;
    if (!world || !list.current) return;
    const delta = list.current.scrollTop - world.session.startScrollTop;
    world.chatScrollDelta = delta;
    world.sectionScrollDelta = delta;
    world.sessionScrollDelta = delta;
    const target = sidebarDropTargetAt(world, point);
    const springId =
      target?.kind === "section" || target?.kind === "section-into" ? target.sectionId : null;
    dragMotion.springOpen(springId && collapsed.has(springId) ? springId : null, toggle);
    let offsets: Record<string, DragOffset> = {};
    if (
      world.session.source.kind === "chat" &&
      target?.kind === "chat" &&
      sidebarSectionOf(layout, world.session.source.id) === target.target.sectionId
    ) {
      offsets = reorderOffsets(
        (groups.get(target.target.sectionId) ?? []).map((chat) => chat.id),
        world.session.source.id,
        { id: target.target.chatId, placement: target.target.placement },
        (id) => world.chatSlots.get(id),
        "y",
      );
    }
    if (world.session.source.kind === "person" && target?.kind === "person" && people) {
      offsets = reorderOffsets(
        people.members.map((member) => member.id),
        world.session.source.id,
        { id: target.target.memberId, placement: target.target.placement },
        (id) => world.personSlots.get(id),
        "y",
      );
    }
    setDragView((previous) =>
      previous && sidebarDropTargetsEqual(previous.target, target)
        ? previous
        : {
            source: world.session.source,
            target,
            offsets,
            waiting: previous?.waiting ?? new Set(waitingIds),
          },
    );
  };
  const dragOver = (event: DragEvent<HTMLElement>) => {
    if (!drag.current) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    const point = { clientX: event.clientX, clientY: event.clientY };
    resolveDrag(point);
    dragMotion.update(point, resolveDrag);
  };
  const remeasureDrag = () => {
    if (!drag.current || !list.current) return;
    const world = drag.current;
    const measured = measureSidebarDragSlots(list.current, (id) => sidebarSectionOf(layout, id));
    world.chatSlots = measured.chats;
    world.sectionSlots = measured.sections;
    world.geometry = { ...measured.geometry, pinned: null };
    world.session.startScrollTop = list.current.scrollTop;
    world.chatScrollDelta = 0;
    world.sectionScrollDelta = 0;
    world.sessionScrollDelta = 0;
  };
  const drop = (event: DragEvent<HTMLElement>) => {
    const world = drag.current;
    if (!world) return;
    event.preventDefault();
    event.stopPropagation();
    const delta =
      (list.current?.scrollTop ?? world.session.startScrollTop) - world.session.startScrollTop;
    world.chatScrollDelta = delta;
    world.sectionScrollDelta = delta;
    world.sessionScrollDelta = delta;
    const target = sidebarDropTargetAt(world, event);
    if (world.session.source.kind === "person" && target?.kind === "person") {
      reorderPeople(world.session.source.id, target.target.memberId, target.target.placement);
      stopDrag();
      return;
    }
    const action = sidebarDropAction(layout, regularChats, world.session.source, target);
    stopDrag();
    if (action) void run(action);
  };
  const moveChat = (chat: SidebarChat, direction: -1 | 1) => {
    const sectionId = sidebarSectionOf(layout, chat.id);
    const ids = (groups.get(sectionId) ?? []).map((item) => item.id);
    const targetId = ids[ids.indexOf(chat.id) + direction];
    if (!targetId) return;
    const action = sidebarDropAction(
      layout,
      regularChats,
      { kind: "chat", id: chat.id, origin: "section" },
      {
        kind: "chat",
        target: { chatId: targetId, sectionId, placement: direction < 0 ? "before" : "after" },
      },
    );
    if (action) void run(action);
  };
  const row = (chat: SidebarChat, special?: "waiting" | "hidden") => (
    <SidebarRow
      key={sidebarChatKey(chat)}
      chat={chat}
      agents={props.agents}
      selected={
        chat.kind === "agent"
          ? props.selectedAgentId === chat.id
          : props.selectedChannelId === chat.id
      }
      onSelect={() => (chat.kind === "agent" ? props.onAgent(chat.id) : props.onGroup(chat.id))}
      mutable={mutable && !search && !special}
      hidden={special === "hidden"}
      waiting={special === "waiting"}
      dragView={dragView}
      onStartDrag={startDrag}
      onEndDrag={stopDrag}
      onKeyboardMove={(direction) => moveChat(chat, direction)}
      menu={
        canPin || (canHide && chat.kind === "agent") || (mutable && !special) ? (
          <>
            {preferenceItems(chat, special === "hidden")}
            {mutable && !special ? (
              <>
                <MenuItem onClick={() => moveChat(chat, -1)}>
                  <ArrowUpIcon />
                  <T>Move up</T>
                </MenuItem>
                <MenuItem onClick={() => moveChat(chat, 1)}>
                  <ArrowDownIcon />
                  <T>Move down</T>
                </MenuItem>
                <MenuSub>
                  <MenuSubTrigger>
                    <FolderIcon />
                    <T>Move to</T>
                  </MenuSubTrigger>
                  <MenuSubPopup>
                    <MenuItem
                      onClick={() =>
                        void run({
                          type: "move-agent",
                          agentId: chat.id,
                          sectionId: null,
                          beforeAgentId: null,
                        })
                      }
                    >
                      <T>Unassigned</T>
                    </MenuItem>
                    {layout.order
                      .filter((id) => folders.has(id))
                      .map((id) => (
                        <MenuItem
                          key={id}
                          onClick={() =>
                            void run({
                              type: "move-agent",
                              agentId: chat.id,
                              sectionId: id,
                              beforeAgentId: null,
                            })
                          }
                        >
                          {sidebarFolderPath(layout, parents, id).join(" / ")}
                        </MenuItem>
                      ))}
                  </MenuSubPopup>
                </MenuSub>
              </>
            ) : null}
          </>
        ) : null
      }
    />
  );
  const folderActions = (id: string) => {
    const parentId = parents.get(id) ?? null;
    const siblings = children(parentId);
    const index = siblings.indexOf(id);
    const move = (direction: -1 | 1) => {
      const targetId = siblings[index + direction];
      if (!targetId) return;
      const action = sidebarDropAction(
        layout,
        allChats,
        { kind: "section", id },
        {
          kind: "section-order",
          target: { sectionId: targetId, placement: direction < 0 ? "before" : "after" },
        },
      );
      if (action) void run(action);
    };
    return (
      <>
        <MenuItem
          onClick={() =>
            setEditor({ type: "rename", sectionId: id, name: folders.get(id)?.name ?? "" })
          }
        >
          <PencilIcon />
          <T>Rename</T>
        </MenuItem>
        <MenuItem
          disabled={sidebarFolderAncestors(parents, id).length >= 2}
          onClick={() => {
            if (collapsed.has(id)) toggle(id);
            setEditor({ type: "create", parentId: id });
          }}
        >
          <FolderPlusIcon />
          <T>New folder inside</T>
        </MenuItem>
        <MenuSeparator />
        <MenuItem disabled={index <= 0} onClick={() => move(-1)}>
          <ArrowUpIcon />
          <T>Move up</T>
        </MenuItem>
        <MenuItem disabled={index === siblings.length - 1} onClick={() => move(1)}>
          <ArrowDownIcon />
          <T>Move down</T>
        </MenuItem>
        <MenuSub>
          <MenuSubTrigger>
            <FolderIcon />
            <T>Move to</T>
          </MenuSubTrigger>
          <MenuSubPopup>
            <MenuItem
              disabled={parentId === null}
              onClick={() =>
                void run({ type: "nest", sectionId: id, parentId: null, beforeSectionId: null })
              }
            >
              <T>Top level</T>
            </MenuItem>
            {layout.order
              .filter((target) => sidebarCanNest(layout, id, target))
              .map((target) => (
                <MenuItem
                  key={target}
                  onClick={() =>
                    void run({
                      type: "nest",
                      sectionId: id,
                      parentId: target,
                      beforeSectionId: null,
                    })
                  }
                >
                  {sidebarFolderPath(layout, parents, target).join(" / ")}
                </MenuItem>
              ))}
          </MenuSubPopup>
        </MenuSub>
        <MenuSeparator />
        <MenuItem
          variant="destructive"
          onClick={() => {
            setNotice(null);
            setDeleteFolder({ id, name: folders.get(id)?.name ?? "Folder" });
          }}
        >
          <Trash2Icon />
          Delete
        </MenuItem>
      </>
    );
  };
  const error = projection.error;
  return (
    <nav
      ref={list}
      className="agent-list"
      aria-label={gt("Chats")}
      aria-busy={busy}
      data-sidebar-dragging={dragView?.source.kind}
      onDragOver={dragOver}
      onDrop={drop}
      onDragEnd={stopDrag}
      onTransitionEnd={(event) => {
        if (event.propertyName === "grid-template-rows") remeasureDrag();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") stopDrag();
      }}
    >
      <span className="sr-only" role="status">
        {announcement}
      </span>
      {(error || notice) && (
        <p role={error ? "alert" : "status"} className="ob-sidebar-notice">
          {error ?? notice}
          {error && (
            <button
              type="button"
              className="sidebar-icon-button"
              aria-label={gt("Refresh sidebar")}
              onClick={refreshSidebar}
            >
              <RefreshCwIcon />
            </button>
          )}
        </p>
      )}
      {pinnedChats.length > 0 && (
        <section className="sidebar-pinned-group" aria-label={gt("Pinned chats")}>
          <ul className="sidebar-pinned-list">
            {pinnedChats.map((chat) => (
              <li
                key={sidebarChatKey(chat)}
                className="sidebar-pinned-item"
                onKeyDown={(event) => {
                  if (
                    canPin &&
                    event.altKey &&
                    (event.key === "ArrowLeft" || event.key === "ArrowRight")
                  ) {
                    event.preventDefault();
                    void runPreference(
                      sidebarPinReorderRequest(
                        pinItems,
                        sidebarChatKey(chat),
                        event.key === "ArrowLeft" ? -1 : 1,
                      ),
                    );
                  }
                }}
              >
                <ContextMenu.Root>
                  <ContextMenu.Trigger
                    render={<button type="button" />}
                    className={`agent-row sidebar-pinned-row${(chat.kind === "agent" ? props.selectedAgentId : props.selectedChannelId) === chat.id ? " agent-row-active" : ""}`}
                    onClick={() =>
                      chat.kind === "agent" ? props.onAgent(chat.id) : props.onGroup(chat.id)
                    }
                  >
                    <SidebarAvatar chat={chat} agents={props.agents} pinned />
                    <span className="agent-row-copy sidebar-pinned-copy">
                      <strong className="sidebar-pinned-name">{sidebarChatName(chat)}</strong>
                      {waitingIds.has(chat.id) && (
                        <span className="agent-row-wait-chip">
                          <T>Needs you</T>
                        </span>
                      )}
                    </span>
                  </ContextMenu.Trigger>
                  {(canPin || (canHide && chat.kind === "agent")) && (
                    <SidebarContextPopup>{preferenceItems(chat)}</SidebarContextPopup>
                  )}
                </ContextMenu.Root>
              </li>
            ))}
          </ul>
        </section>
      )}
      {waitingChats.length > 0 && (
        <section className="sidebar-chat-group sidebar-waiting-group" aria-label={gt("Needs you")}>
          <header>
            <span className="sidebar-waiting-group-name">
              <T>Needs you</T>
            </span>
            <span className="sidebar-waiting-group-count">{waitingChats.length}</span>
          </header>
          {waitingChats.map((chat) => row(chat, "waiting"))}
        </section>
      )}
      {children(null).map((id) =>
        id === "people" && people ? (
          <SidebarPeopleSection
            key={id}
            people={people}
            offsets={dragView?.offsets ?? {}}
            draggingId={dragView?.source.kind === "person" ? dragView.source.id : null}
            closed={collapsed.has(id)}
            mutable={mutable && !search}
            toggle={() => toggle(id)}
            onStartDrag={startDrag}
            onEndDrag={stopDrag}
            onMove={(source, direction) => {
              const index = people.members.findIndex((member) => member.id === source),
                target = people.members[index + direction];
              if (target) reorderPeople(source, target.id, direction < 0 ? "before" : "after");
            }}
          />
        ) : (
          <SidebarSection
            key={id}
            id={id}
            depth={0}
            layout={layout}
            groups={groups}
            collapsed={collapsed}
            dragView={dragView}
            mutable={mutable && !search}
            onToggle={toggle}
            onStartDrag={startDrag}
            onEndDrag={stopDrag}
            renderRow={row}
            folderActions={folderActions}
          />
        ),
      )}
      {hiddenChats.length > 0 && (
        <section className="sidebar-chat-group" aria-label={gt("Hidden")}>
          <header>
            <button
              type="button"
              className="sidebar-section-toggle"
              aria-expanded={!collapsed.has("hidden")}
              onClick={() => toggle("hidden")}
            >
              <span className="sidebar-section-name">
                <T>Hidden</T>
              </span>
              <ChevronDownIcon
                className={`sidebar-section-chevron${collapsed.has("hidden") ? " sidebar-section-chevron-collapsed" : ""}`}
              />
            </button>
          </header>
          <div
            className="sidebar-section-collapse"
            data-collapsed={collapsed.has("hidden") ? "" : undefined}
            inert={collapsed.has("hidden")}
          >
            <div className="sidebar-section-body">
              {hiddenChats.map((chat) => row(chat, "hidden"))}
            </div>
          </div>
        </section>
      )}
      {deleteFolder && (
        <SidebarDeleteDialog
          name={deleteFolder.name}
          pending={busy}
          error={notice}
          onCancel={() => setDeleteFolder(null)}
          onConfirm={async () => {
            if (await run({ type: "delete", sectionId: deleteFolder.id })) setDeleteFolder(null);
          }}
        />
      )}
      {editor && (
        <SidebarEditor
          key={JSON.stringify(editor)}
          editor={editor}
          busy={busy}
          onCancel={() => setEditor(null)}
          onSave={async (name) => {
            const action: SidebarAction =
              editor.type === "rename"
                ? { type: "rename", sectionId: editor.sectionId, name }
                : {
                    type: "create",
                    name,
                    ...(editor.parentId ? { parentId: editor.parentId } : {}),
                  };
            if (await run(action)) setEditor(null);
          }}
        />
      )}
      {mutable && !editor && (
        <button
          type="button"
          className="sidebar-section-toggle sidebar-section-draft"
          onClick={() => setEditor({ type: "create" })}
        >
          <FolderPlusIcon className="sidebar-folder-icon" />
          <span>
            <T>New folder</T>
          </span>
        </button>
      )}
      {shownChats.length === 0 && hiddenChats.length === 0 && (
        <p className="ob-sidebar-notice">
          {search ? gt("No matching chats.") : gt("No chats yet.")}
        </p>
      )}
    </nav>
  );
}

function SidebarAvatar({
  chat,
  agents,
  pinned = false,
  hidden = false,
}: {
  chat: SidebarChat;
  agents: OpenbotSidebarProps["agents"];
  pinned?: boolean;
  hidden?: boolean;
}) {
  return (
    <span className={`agent-row-avatar${pinned ? " sidebar-pinned-avatar" : ""}`}>
      {chat.kind === "agent" ? (
        <span className="agent-avatar ob-sidebar-avatar">
          <SourceAgentAvatar
            agent={chat.agent}
            size={pinned ? 56 : 46}
            mood={hidden ? "asleep" : "idle"}
            workingFaces
          />
        </span>
      ) : (
        <GroupAvatar
          channelId={chat.channel.id}
          members={chat.channel.members}
          agents={agents}
          layout="cluster"
          size={pinned ? 56 : 46}
        />
      )}
    </span>
  );
}
function SidebarRow({
  chat,
  agents,
  selected,
  onSelect,
  mutable,
  hidden,
  waiting,
  dragView,
  onStartDrag,
  onEndDrag,
  onKeyboardMove,
  menu,
}: {
  chat: SidebarChat;
  agents: OpenbotSidebarProps["agents"];
  selected: boolean;
  onSelect: () => void;
  mutable: boolean;
  hidden: boolean;
  waiting: boolean;
  dragView: DragView | null;
  onStartDrag: (event: DragEvent<HTMLElement>, source: SidebarDragSource) => void;
  onEndDrag: () => void;
  onKeyboardMove: (direction: -1 | 1) => void;
  menu: ReactNode;
}) {
  const gt = useGT();
  const dragging = dragView?.source.kind === "chat" && dragView.source.id === chat.id;
  const offset = dragView?.offsets[chat.id]?.y ?? 0;
  const date = chat.kind === "agent" ? chat.agent.updatedAt : chat.channel.lastMessage?.at;
  const preview = hidden
    ? "Hidden"
    : waiting
      ? "Waiting for your input"
      : chat.kind === "agent"
        ? chat.agent.preview
        : chat.channel.lastMessage?.text;
  return (
    <div
      className={`sidebar-agent-item${hidden ? " sidebar-agent-item-user-hidden" : ""}${dragging ? " sidebar-agent-item-dragging" : ""}${offset ? " sidebar-drag-shifting" : ""}`}
      style={{ "--sidebar-drag-y": `${offset}px` } as CSSProperties}
      data-chat-id={hidden || waiting ? undefined : chat.id}
      draggable={mutable}
      onDragStart={(event) => onStartDrag(event, { kind: "chat", id: chat.id, origin: "section" })}
      onDragEnd={onEndDrag}
    >
      <ContextMenu.Root>
        <ContextMenu.Trigger
          render={<button type="button" />}
          className={`agent-row${selected ? " agent-row-active" : ""}${dragging ? " sidebar-agent-row-dragging" : ""}`}
          aria-pressed={selected}
          onClick={onSelect}
          onKeyDown={(event) => {
            if (mutable && event.altKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
              event.preventDefault();
              onKeyboardMove(event.key === "ArrowUp" ? -1 : 1);
            }
          }}
        >
          <SidebarAvatar chat={chat} agents={agents} hidden={hidden} />
          <span className="agent-row-copy">
            <span className="agent-row-heading">
              <span className="agent-row-title">
                <span className="agent-row-name">
                  <strong dir="auto">{sidebarChatName(chat)}</strong>
                </span>
                {chat.kind === "agent" && chat.agent.title && (
                  <span className="agent-role-badge">
                    <span>{chat.agent.title}</span>
                  </span>
                )}
              </span>
              {waiting ? (
                <span className="agent-row-wait-chip">
                  <T>Needs you</T>
                </span>
              ) : (
                !hidden && (
                  <time className="agent-row-time" dateTime={date ?? undefined}>
                    {timeLabel(date)}
                  </time>
                )
              )}
            </span>
            <span className="agent-row-preview" dir="auto">
              {preview || gt("No messages yet")}
            </span>
          </span>
          {chat.kind === "channel" && chat.channel.unreadCount > 0 && (
            <span className="sidebar-folder-unread">{Math.min(chat.channel.unreadCount, 99)}</span>
          )}
        </ContextMenu.Trigger>
        {menu && <SidebarContextPopup>{menu}</SidebarContextPopup>}
      </ContextMenu.Root>
    </div>
  );
}

type SectionProps = {
  id: string;
  depth: number;
  layout: SidebarLayout;
  groups: ReadonlyMap<string, SidebarChat[]>;
  collapsed: ReadonlySet<string>;
  dragView: DragView | null;
  mutable: boolean;
  onToggle: (id: string) => void;
  onStartDrag: (event: DragEvent<HTMLElement>, source: SidebarDragSource) => void;
  onEndDrag: () => void;
  renderRow: (chat: SidebarChat) => ReactNode;
  folderActions: (id: string) => ReactNode;
};
function SidebarSection(props: SectionProps) {
  const { id, depth, layout, groups, collapsed, dragView } = props;
  const section = layout.sections.find((candidate) => candidate.id === id);
  const parents = sidebarFolderParents(layout);
  const children = layout.order.filter((child) => parents.get(child) === id);
  const chats = groups.get(id) ?? [];
  const headed = !!section || layout.sections.length > 0;
  const closed = headed && collapsed.has(id);
  const target = dragView?.target;
  const highlight =
    (target?.kind === "section" || target?.kind === "section-into") && target.sectionId === id;
  const position =
    target?.kind === "section-order" && target.target.sectionId === id
      ? target.target.placement
      : null;
  const name = section?.name ?? "Unassigned";
  const parentName = layout.sections.find((item) => item.id === parents.get(id))?.name;
  const dragging = dragView?.source.kind === "section" && dragView.source.id === id;
  return (
    <section
      className={`sidebar-chat-group sidebar-section${section ? " sidebar-folder" : ""}${highlight ? " sidebar-section-agent-drop-target" : ""}${position ? ` sidebar-section-drop-${position}` : ""}${dragging ? " sidebar-section-dragging" : ""}`}
      data-section-id={id}
      data-depth={section ? depth : undefined}
      aria-label={sidebarFolderPath(layout, parents, id).join(" / ") || name}
    >
      {headed && (
        <header>
          <ContextMenu.Root>
            <ContextMenu.Trigger
              render={<button type="button" />}
              className="sidebar-section-toggle sidebar-section-drag-handle"
              draggable={props.mutable && !!section}
              aria-expanded={!closed}
              aria-controls={`sidebar-section-body-${id}`}
              onClick={() => props.onToggle(id)}
              onDragStart={(event) => props.onStartDrag(event, { kind: "section", id })}
              onDragEnd={props.onEndDrag}
            >
              <span className="sidebar-section-name">
                {parentName && <span className="sidebar-folder-parent">{parentName} / </span>}
                {name}
              </span>
              {section ? (
                <span className="sidebar-folder-end">
                  {closed || (chats.length === 0 && children.length === 0) ? (
                    <FolderIcon className="sidebar-folder-icon" />
                  ) : (
                    <FolderOpenIcon className="sidebar-folder-icon" />
                  )}
                </span>
              ) : (
                <ChevronDownIcon
                  className={`sidebar-section-chevron${closed ? " sidebar-section-chevron-collapsed" : ""}`}
                />
              )}
            </ContextMenu.Trigger>
            {section && props.mutable && (
              <SidebarContextPopup>{props.folderActions(id)}</SidebarContextPopup>
            )}
          </ContextMenu.Root>
        </header>
      )}
      <div
        className="sidebar-section-collapse"
        data-collapsed={closed ? "" : undefined}
        aria-hidden={closed || undefined}
        inert={closed}
      >
        <div id={`sidebar-section-body-${id}`} className="sidebar-section-body">
          {chats.map(props.renderRow)}
          {children.map((child) => (
            <SidebarSection {...props} key={child} id={child} depth={depth + 1} />
          ))}
        </div>
      </div>
    </section>
  );
}
function SidebarEditor({
  editor,
  busy,
  onCancel,
  onSave,
}: {
  editor: Editor;
  busy: boolean;
  onCancel: () => void;
  onSave: (name: string) => Promise<void>;
}) {
  const gt = useGT();
  const [name, setName] = useState(editor.type === "rename" ? editor.name : "");
  return (
    <form
      className="sidebar-section-editor-wrap ob-sidebar-editor"
      onSubmit={(event) => {
        event.preventDefault();
        if (name.trim() && !busy) void onSave(name.trim());
      }}
    >
      <input
        autoFocus
        className="sidebar-section-editor"
        aria-label={gt("Folder name")}
        value={name}
        maxLength={40}
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") onCancel();
        }}
        disabled={busy}
        placeholder={gt("Folder name")}
      />
      <button type="submit" disabled={!name.trim() || busy}>
        <T>Save</T>
      </button>
      <button type="button" onClick={onCancel} disabled={busy}>
        <T>Cancel</T>
      </button>
    </form>
  );
}
