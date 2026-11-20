/* oxlint-disable shadcn/no-unknown-classes -- SidePanel source selectors are in openbot-side-thread-tabs.css. */
import { useLayoutEffect, useRef, useSyncExternalStore, type ReactNode } from "react";
import { MessageSquareIcon, PanelLeft, XIcon } from "lucide-react";
import { useStableCallback } from "../../../hooks/useStableCallback";
import { bindThreadTabDrag, threadTabCarry, type OpenbotThreadTab } from "./openbotThreadTabDrag";
import { ThreadTabGhost } from "./OpenbotThreadTabs";
import "./openbot-side-thread-tabs.css";
export type OpenbotSideThreadTabsProps = {
  threads: readonly OpenbotThreadTab[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onMove: (id: string, index: number) => void;
  onMoveToChat: (id: string) => void;
  maximized?: boolean;
  children?: ReactNode;
  actions?: ReactNode;
};
export function OpenbotSideThreadTabs(props: OpenbotSideThreadTabsProps) {
  const list = useRef<HTMLDivElement>(null);
  const carried = useSyncExternalStore(threadTabCarry.subscribe, threadTabCarry.getSnapshot);
  const getThreads = useStableCallback(() => props.threads),
    move = useStableCallback(props.onMove),
    dock = useStableCallback(props.onMoveToChat),
    maximized = useStableCallback(() => props.maximized ?? false);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Bind the upstream side-tab reorder and reverse-docking pointer lifecycle.
  useLayoutEffect(() => {
    if (!list.current) return;
    const binding = bindThreadTabDrag(list.current, {
      row: "side",
      getThreads,
      onMove: move,
      onDock: dock,
      isMaximized: maximized,
    });
    return () => binding.dispose();
  }, [getThreads, move, dock, maximized]);
  return (
    <div className="side-panel-header" data-drop-target={carried?.from === "chat" ? "" : undefined}>
      <div ref={list} className="side-panel-tabs" role="tablist" aria-label="Side panel tabs">
        {props.children}
        {props.threads.map((thread) => (
          <div
            key={thread.id}
            role="presentation"
            className="side-panel-tab side-panel-thread-tab"
            data-thread-id={thread.id}
            data-selected={props.selectedId === thread.id ? "true" : undefined}
          >
            <button
              type="button"
              className="side-panel-tab-close"
              tabIndex={-1}
              aria-hidden="true"
              onPointerDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
              }}
              onClick={() => props.onClose(thread.id)}
            >
              <span className="side-panel-tab-icon">
                <MessageSquareIcon size={13} />
              </span>
              <XIcon className="side-panel-tab-x" size={13} />
            </button>
            <button
              type="button"
              role="tab"
              className="side-panel-tab-select"
              aria-selected={props.selectedId === thread.id}
              tabIndex={
                props.selectedId === thread.id ||
                (!props.selectedId && props.threads[0]?.id === thread.id)
                  ? 0
                  : -1
              }
              aria-keyshortcuts="Delete"
              onClick={() => props.onSelect(thread.id)}
              onKeyDown={(event) => {
                if (event.key === "Delete" || event.key === "Backspace") {
                  event.preventDefault();
                  props.onClose(thread.id);
                  return;
                }
                if (
                  event.altKey &&
                  event.shiftKey &&
                  (event.key === "ArrowLeft" || event.key === "ArrowRight")
                ) {
                  event.preventDefault();
                  props.onMove(
                    thread.id,
                    Math.max(
                      0,
                      Math.min(
                        props.threads.length - 1,
                        props.threads.indexOf(thread) + (event.key === "ArrowLeft" ? -1 : 1),
                      ),
                    ),
                  );
                  return;
                }
                if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
                event.preventDefault();
                const index =
                  event.key === "Home"
                    ? 0
                    : event.key === "End"
                      ? props.threads.length - 1
                      : (props.threads.indexOf(thread) +
                          (event.key === "ArrowRight" ? 1 : -1) +
                          props.threads.length) %
                        props.threads.length;
                const next = props.threads[index];
                if (next) {
                  props.onSelect(next.id);
                  list.current
                    ?.querySelector<HTMLElement>(
                      `[data-thread-id="${CSS.escape(next.id)}"] [role="tab"]`,
                    )
                    ?.focus();
                }
              }}
            >
              <span className="side-panel-tab-label" dir="auto">
                {thread.title}
              </span>
            </button>
            <button
              type="button"
              className="side-panel-thread-return"
              aria-label={`Move ${thread.title} to chat`}
              onClick={() => props.onMoveToChat(thread.id)}
            >
              <PanelLeft size={12} />
            </button>
          </div>
        ))}
        {carried?.from === "chat" && <span className="side-panel-thread-drop" aria-hidden="true" />}
      </div>
      {props.actions}
      <ThreadTabGhost from="side" />
    </div>
  );
}
