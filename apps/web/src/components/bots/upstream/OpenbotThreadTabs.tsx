/* oxlint-disable shadcn/no-unknown-classes -- Source thread selectors are supplied by openbot-thread-tabs.css. */
import { useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { ContextMenu } from "@base-ui/react/context-menu";
import {
  Archive,
  ArrowRightToLine,
  Check,
  ChevronDown,
  CircleX,
  ListIcon,
  ListTodoIcon,
  MessageSquareIcon,
  PanelRight,
  PencilLine,
  Plus,
  Trash2,
  XIcon,
} from "lucide-react";
import { Tooltip, TooltipTrigger, TooltipPopup } from "../../ui/tooltip";
import { Menu, MenuTrigger, MenuItem, MenuSeparator } from "../../ui/menu";
import { MenuPopup } from "./OpenbotMenu";
import { menuMotionRef } from "./openbotMenuMotion";
import { settlePromise } from "@t3tools/client-runtime/state/runtime";
import { useStableCallback } from "../../../hooks/useStableCallback";
import {
  bindThreadTabDrag,
  bindThreadHeaderFit,
  threadTabCarry,
  type OpenbotThreadTab,
} from "./openbotThreadTabDrag";
import {
  closeThreadTab,
  dockThreadTab,
  moveThreadTab,
  type OpenbotThreadTabLayout,
} from "./openbotThreadTabLayout";
import "./openbot-thread-tabs.css";
import "./openbot-side-thread-tabs.css";
export { useOpenbotThreadTabLayout } from "./useOpenbotThreadTabLayout";
export type { OpenbotThreadTabLayout } from "./openbotThreadTabLayout";
export type OpenbotThreadTabsProps = {
  tasks: readonly OpenbotThreadTab[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onNew: () => void;
  onRename: (id: string, title: string) => Promise<boolean>;
  layout?: OpenbotThreadTabLayout;
  onLayoutChange?: (layout: OpenbotThreadTabLayout) => void;
  onMoveToSide?: (id: string) => void;
  onArchive?: (id: string) => void;
  onRestore?: (id: string) => void;
  onDelete?: (id: string) => void;
  canStartNew?: boolean;
  taskChats?: boolean;
};
export function ThreadTabGhost({ from }: { from: "chat" | "side" }) {
  const carried = useSyncExternalStore(threadTabCarry.subscribe, threadTabCarry.getSnapshot);
  if (!carried || carried.from !== from) return null;
  return createPortal(
    <div className="openbot-react">
      <div
        className="side-panel-tab thread-tab-ghost"
        style={{ left: carried.x, top: carried.y }}
        aria-hidden="true"
      >
        <span className="side-panel-tab-close">
          <span className="side-panel-tab-icon">
            <MessageSquareIcon size={12} />
          </span>
        </span>
        <span className="side-panel-tab-label" dir="auto">
          {carried.thread.title}
        </span>
      </div>
    </div>,
    document.body,
  );
}
export function OpenbotThreadTabs(props: OpenbotThreadTabsProps) {
  const { tasks, selectedId, onSelect, onNew, onRename } = props;
  const newLabel = props.taskChats ? "New task chat" : "New thread";
  const allLabel = props.taskChats ? "All task chats" : "All threads";
  const ChatIcon = props.taskChats ? ListTodoIcon : MessageSquareIcon;
  const [closed, setClosed] = useState<readonly string[]>([]);
  const [order, setOrder] = useState<readonly string[]>([]);
  const [mode, setMode] = useState<"tabs" | "compact" | "minimal">("tabs");
  const [target, setTarget] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [rename, setRename] = useState<{
    id: string;
    title: string;
    original: string;
    left: number;
    width: number;
    at: number;
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);
  const renameSaving = useRef(false);
  const row = useRef<HTMLDivElement>(null),
    list = useRef<HTMLDivElement>(null),
    area = useRef<HTMLDivElement>(null),
    fill = useRef<HTMLSpanElement>(null);
  const drag = useRef<ReturnType<typeof bindThreadTabDrag> | null>(null);
  const carried = useSyncExternalStore(threadTabCarry.subscribe, threadTabCarry.getSnapshot);
  const openTasks = tasks.filter((task) => task.state !== "closed");
  const openIds =
    props.layout?.open ??
    [...openTasks]
      .sort((a, b) => {
        const ai = order.indexOf(a.id),
          bi = order.indexOf(b.id);
        return (
          (ai < 0 ? order.length + tasks.indexOf(a) : ai) -
          (bi < 0 ? order.length + tasks.indexOf(b) : bi)
        );
      })
      .filter((task) => !closed.includes(task.id) || task.id === selectedId)
      .map((task) => task.id);
  const visible = openIds.flatMap((id) => openTasks.find((task) => task.id === id) ?? []);
  const layout: OpenbotThreadTabLayout = props.layout ?? {
    open: openIds,
    active: selectedId,
    side: [],
  };
  const write = useStableCallback((next: OpenbotThreadTabLayout) => {
    if (props.onLayoutChange) props.onLayoutChange(next);
    else {
      setOrder(next.open);
      setClosed(tasks.filter((task) => !next.open.includes(task.id)).map((task) => task.id));
    }
  });
  const getThreads = useStableCallback(() => visible);
  const move = useStableCallback((id: string, index: number) =>
    write(moveThreadTab({ ...layout, active: selectedId }, id, index, "open")),
  );
  const dock = useStableCallback((id: string) => {
    write(dockThreadTab({ ...layout, active: selectedId }, id, "side"));
    if (selectedId === id) onSelect(null);
    props.onMoveToSide?.(id);
  });
  const close = useStableCallback((id: string) => {
    const next = closeThreadTab({ ...layout, active: selectedId }, id, "open");
    write(next);
    if (selectedId === id) onSelect(next.active);
  });
  const choose = (id: string | null) => {
    write({
      ...layout,
      active: id,
      open: id && !layout.open.includes(id) ? [...layout.open, id] : layout.open,
      side: layout.side.filter((side) => side !== id),
    });
    onSelect(id);
  };
  const canDock = !!props.onMoveToSide;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Bind source pointer drag, measured fill, overflow scrolling and focus retention to the tab strip.
  useLayoutEffect(() => {
    if (!list.current) return;
    const binding = bindThreadTabDrag(list.current, {
      row: "chat",
      getThreads,
      onMove: move,
      onDock: canDock ? dock : undefined,
      fill: fill.current,
    });
    drag.current = binding;
    return () => {
      binding.dispose();
      drag.current = null;
    };
  }, [getThreads, move, dock, canDock]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- The source header mode follows available DOM width, including space returned by the model picker.
  useLayoutEffect(() => (row.current ? bindThreadHeaderFit(row.current, setMode) : undefined), []);
  const startRename = useStableCallback((id: string) => {
    if (saving) return;
    const task = tasks.find((item) => item.id === id),
      tab = list.current?.querySelector<HTMLElement>(`[data-thread-id="${CSS.escape(id)}"]`),
      title = tab?.querySelector(".agent-threads-tab-title");
    if (!task || !tab || !title || !area.current) return;
    const strip = list.current!;
    const start = tab.offsetLeft - 24,
      end = tab.offsetLeft + tab.offsetWidth + 24 - strip.clientWidth;
    if (start < strip.scrollLeft) strip.scrollLeft = start;
    else if (end > strip.scrollLeft) strip.scrollLeft = end;
    const box = tab.getBoundingClientRect(),
      left = title.getBoundingClientRect().left;
    setRenameError(null);
    setRename({
      id,
      title: task.title,
      original: task.title,
      left: left - area.current.getBoundingClientRect().left,
      width: Math.max(
        40,
        box.right - left - (Number.parseFloat(getComputedStyle(tab).paddingRight) || 0),
      ),
      at: performance.now(),
    });
  });
  const finishRename = async (keep: boolean, refocus: boolean) => {
    if (!rename || renameSaving.current) return;
    const edit = rename;
    let finished = false;
    if (!keep || !edit.title.trim() || edit.title.trim() === edit.original) {
      setRename(null);
      finished = true;
    } else {
      renameSaving.current = true;
      setSaving(true);
      const settled = await settlePromise(async () => onRename(edit.id, edit.title.trim()));
      renameSaving.current = false;
      setSaving(false);
      if (settled._tag === "Success" && settled.value) {
        setRename(null);
        finished = true;
      } else setRenameError("The thread title could not be saved.");
    }
    if (refocus && finished)
      requestAnimationFrame(() =>
        list.current
          ?.querySelector<HTMLElement>(`[data-thread-id="${CSS.escape(edit.id)}"]`)
          ?.focus(),
      );
  };
  const focusedTask = tasks.find((task) => task.id === (target ?? selectedId));
  const targetIndex = visible.findIndex((task) => task.id === focusedTask?.id);
  const closeOthers = () => {
    if (!focusedTask) return;
    write({ ...layout, open: [focusedTask.id], active: focusedTask.id });
    onSelect(focusedTask.id);
  };
  const closeRight = () => {
    if (!focusedTask) return;
    const ids = visible.slice(0, targetIndex + 1).map((task) => task.id);
    const active = selectedId && ids.includes(selectedId) ? selectedId : focusedTask.id;
    write({ ...layout, open: ids, active });
    onSelect(active);
  };
  const actualMode = visible.length === 0 && mode === "compact" ? "tabs" : mode;
  const active = tasks.find((task) => task.id === selectedId);
  return (
    <div
      ref={row}
      className="agent-threads-header"
      data-mode={actualMode}
      data-drop-target={carried?.from === "side" ? "" : undefined}
    >
      <div
        ref={area}
        className="agent-threads-tabs-area"
        hidden={actualMode !== "tabs" || visible.length === 0}
      >
        <ContextMenu.Root onOpenChange={setMenuOpen}>
          <ContextMenu.Trigger
            className="agent-threads-tabs-trigger"
            onContextMenu={(event) => {
              const id =
                event.target instanceof Element
                  ? event.target.closest<HTMLElement>(".agent-threads-tab")?.dataset.threadId
                  : undefined;
              if (!id) event.preventDefault();
              else setTarget(id);
            }}
          >
            <div
              ref={list}
              role="tablist"
              aria-label={props.taskChats ? "Open task chats" : "Open threads"}
              className="agent-threads-tabs ui-sliding-tabs"
            >
              <span
                ref={fill}
                aria-hidden="true"
                className="ui-sliding-tabs-pill agent-threads-fill"
                data-initializing=""
              />
              {visible.map((task) => (
                <Tooltip key={task.id}>
                  <TooltipTrigger
                    render={
                      <button
                        type="button"
                        role="tab"
                        tabIndex={
                          task.id === selectedId || (!selectedId && visible[0]?.id === task.id)
                            ? 0
                            : -1
                        }
                        aria-selected={task.id === selectedId}
                        aria-label={task.title || "New task"}
                        aria-keyshortcuts="Delete F2"
                        className="agent-threads-tab ui-sliding-tabs-trigger"
                        data-selected={task.id === selectedId ? "" : undefined}
                        data-renaming={rename?.id === task.id ? "" : undefined}
                        data-menu-open={menuOpen && target === task.id ? "" : undefined}
                        data-thread-id={task.id}
                        data-attention={
                          task.state === "waiting"
                            ? "waiting"
                            : task.outcome === "failed"
                              ? "failed"
                              : undefined
                        }
                        onDoubleClick={(event) => {
                          if (
                            !(
                              event.target instanceof Element &&
                              event.target.closest(".agent-threads-tab-close")
                            )
                          )
                            startRename(task.id);
                        }}
                        onAuxClick={(event) => {
                          if (event.button === 1) {
                            event.preventDefault();
                            close(task.id);
                          }
                        }}
                        onClick={() => choose(task.id)}
                        onPointerDown={(event) => {
                          if (event.pointerType !== "mouse") setTarget(task.id);
                        }}
                        onKeyDown={(event) => {
                          if (
                            event.altKey &&
                            event.shiftKey &&
                            (event.key === "ArrowLeft" || event.key === "ArrowRight")
                          ) {
                            event.preventDefault();
                            event.stopPropagation();
                            drag.current?.move(task.id, event.key === "ArrowLeft" ? -1 : 1);
                          } else if (event.key === "F2") {
                            event.preventDefault();
                            startRename(task.id);
                          } else if (event.key === "Delete" || event.key === "Backspace") {
                            event.preventDefault();
                            close(task.id);
                          } else if (
                            ["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)
                          ) {
                            event.preventDefault();
                            const index =
                              event.key === "Home"
                                ? 0
                                : event.key === "End"
                                  ? visible.length - 1
                                  : (visible.indexOf(task) +
                                      (event.key === "ArrowRight" ? 1 : -1) +
                                      visible.length) %
                                    visible.length;
                            const next = visible[index];
                            if (next) {
                              choose(next.id);
                              list.current
                                ?.querySelector<HTMLElement>(
                                  `[data-thread-id="${CSS.escape(next.id)}"]`,
                                )
                                ?.focus();
                            }
                          } else if (event.key === "F10" && event.shiftKey) setTarget(task.id);
                        }}
                      />
                    }
                  >
                    <span
                      className="agent-threads-tab-close"
                      aria-hidden="true"
                      onPointerDown={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                      }}
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        if (!rename) close(task.id);
                      }}
                    >
                      <span className="agent-threads-tab-icon">
                        <ChatIcon className="size-3" />
                      </span>
                      <XIcon className="agent-threads-tab-x" />
                    </span>
                    <span className="agent-threads-tab-title" dir="auto">
                      {task.title || "New task"}
                    </span>
                  </TooltipTrigger>
                  <TooltipPopup>{task.title || "New task"}</TooltipPopup>
                </Tooltip>
              ))}
            </div>
          </ContextMenu.Trigger>
          <ContextMenu.Portal>
            <ContextMenu.Positioner className="openbot-react">
              <ContextMenu.Popup
                className="ui-action-menu agent-threads-tab-menu"
                ref={menuMotionRef(undefined)}
                aria-label="Thread actions"
              >
                <ContextMenu.Item
                  disabled={!focusedTask}
                  onClick={() => {
                    if (focusedTask) requestAnimationFrame(() => startRename(focusedTask.id));
                  }}
                >
                  <PencilLine size={14} />
                  Rename
                </ContextMenu.Item>
                {canDock && (
                  <ContextMenu.Item
                    onClick={() => {
                      if (focusedTask) dock(focusedTask.id);
                    }}
                  >
                    <PanelRight size={14} />
                    Move to side panel
                  </ContextMenu.Item>
                )}
                <ContextMenu.Separator />
                <ContextMenu.Item
                  onClick={() => {
                    if (focusedTask) close(focusedTask.id);
                  }}
                >
                  <XIcon size={14} />
                  Close tab
                </ContextMenu.Item>
                <ContextMenu.Item disabled={visible.length < 2} onClick={closeOthers}>
                  <CircleX size={14} />
                  Close other tabs
                </ContextMenu.Item>
                <ContextMenu.Item
                  disabled={targetIndex < 0 || targetIndex >= visible.length - 1}
                  onClick={closeRight}
                >
                  <ArrowRightToLine size={14} />
                  Close tabs to the right
                </ContextMenu.Item>
                {props.onArchive && (
                  <>
                    <ContextMenu.Separator />
                    <ContextMenu.Item
                      disabled={!focusedTask || ["running", "waiting"].includes(focusedTask.state)}
                      onClick={() => {
                        if (focusedTask) props.onArchive?.(focusedTask.id);
                      }}
                    >
                      <Archive size={14} />
                      Archive thread
                    </ContextMenu.Item>
                  </>
                )}
                {props.onDelete && (
                  <ContextMenu.Item
                    className="ui-action-menu-danger"
                    disabled={
                      !focusedTask || ["running", "waiting", "queued"].includes(focusedTask.state)
                    }
                    onClick={() => {
                      if (focusedTask) props.onDelete?.(focusedTask.id);
                    }}
                  >
                    <Trash2 size={14} />
                    Delete thread
                  </ContextMenu.Item>
                )}
              </ContextMenu.Popup>
            </ContextMenu.Positioner>
          </ContextMenu.Portal>
        </ContextMenu.Root>
        {rename && (
          <input
            key={rename.id}
            ref={(node) => {
              if (node && document.activeElement !== node) {
                node.focus();
                node.select();
              }
            }}
            className="agent-threads-rename ui-input"
            aria-label="Thread title"
            maxLength={120}
            style={{ left: rename.left, width: rename.width }}
            value={rename.title}
            disabled={saving}
            aria-invalid={!!renameError}
            onChange={(event) => setRename({ ...rename, title: event.target.value })}
            onBlur={(event) => {
              if (renameSaving.current) return;
              if (performance.now() - rename.at < 400) {
                const field = event.currentTarget;
                requestAnimationFrame(() => field.isConnected && field.focus());
                return;
              }
              void finishRename(true, false);
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                void finishRename(false, true);
              } else if (event.key === "Enter") {
                event.preventDefault();
                void finishRename(true, true);
              }
            }}
          />
        )}
        {renameError && (
          <span role="alert" className="agent-threads-rename-error">
            {renameError}
          </span>
        )}
      </div>
      {actualMode === "tabs" && (
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                className="agent-threads-icon-button"
                aria-label={newLabel}
                disabled={props.canStartNew === false}
                onClick={onNew}
              />
            }
          >
            <Plus size={15} />
          </TooltipTrigger>
          <TooltipPopup>{newLabel}</TooltipPopup>
        </Tooltip>
      )}
      <Menu>
        <Tooltip>
          <TooltipTrigger
            render={
              <MenuTrigger
                render={
                  <button
                    type="button"
                    className={
                      actualMode === "compact"
                        ? "agent-threads-switcher ui-button"
                        : "agent-threads-icon-button"
                    }
                    aria-label={allLabel}
                  />
                }
              />
            }
          >
            {actualMode === "compact" ? (
              <>
                <ChatIcon size={14} />
                <span className="agent-threads-switcher-title">
                  {active?.title ?? (props.taskChats ? "Choose task chat" : "Threads")}
                </span>
                <ChevronDown size={12} />
              </>
            ) : (
              <ListIcon size={16} />
            )}
          </TooltipTrigger>
          <TooltipPopup>{allLabel}</TooltipPopup>
        </Tooltip>
        <MenuPopup align="start">
          {props.taskChats && (
            <>
              <MenuItem onClick={() => choose(null)}>
                <MessageSquareIcon size={14} />
                Main chat{!selectedId && <Check size={12} />}
              </MenuItem>
              <MenuSeparator />
            </>
          )}
          <MenuItem disabled={props.canStartNew === false} onClick={onNew}>
            <Plus size={14} />
            {newLabel}
          </MenuItem>
          <MenuSeparator />
          {tasks.map((task) => (
            <MenuItem
              key={task.id}
              onClick={() => {
                if (task.state === "closed") props.onRestore?.(task.id);
                else choose(task.id);
              }}
              disabled={task.state === "closed" && !props.onRestore}
            >
              {task.title || "New task"}
              {task.state === "closed" && <span>Archived</span>}
              {task.id === selectedId && <Check size={12} />}
            </MenuItem>
          ))}
        </MenuPopup>
      </Menu>
      {actualMode !== "tabs" && (
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                className="agent-threads-icon-button agent-threads-compact-new"
                aria-label={newLabel}
                disabled={props.canStartNew === false}
                onClick={onNew}
              />
            }
          >
            <Plus size={15} />
          </TooltipTrigger>
          <TooltipPopup>{newLabel}</TooltipPopup>
        </Tooltip>
      )}
      <ThreadTabGhost from="chat" />
    </div>
  );
}
