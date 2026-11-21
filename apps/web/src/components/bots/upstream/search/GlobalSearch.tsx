/* oxlint-disable shadcn/no-unknown-classes -- GlobalSearch uses original scoped OpenBot selectors. */
import { Dialog } from "@base-ui/react/dialog";
import {
  SearchIcon,
  HashIcon,
  FileIcon,
  CalendarClockIcon,
  CornerDownLeftIcon,
  ArrowUpIcon,
  ArrowDownIcon,
  ArrowRightToLineIcon,
  CommandIcon,
  SettingsIcon,
  LoaderCircleIcon,
  type LucideIcon,
} from "lucide-react";
import { useId, useLayoutEffect, useRef, useState } from "react";
import type { OpenbotAgent, OpenbotChannelSummary } from "@t3tools/contracts";
import { SourceAgentAvatar } from "../../SourceAgentAvatar";
import { observeResize } from "../../../../lib/observeResize";
import { normalizedSearchText, matchParts, snippetAround } from "./global-search-text";
import { trackResultHighlight, trackResultsHeight } from "./global-search-motion";
import { useSearchPages, type SearchPage } from "./useSearchPages";
import "./global-search.css";
import { T, useGT } from "gt-react";
type Agent = typeof OpenbotAgent.Type & { description?: string | undefined };
export type SearchMessage = {
  agentId: string;
  taskId?: string | undefined;
  message: {
    id: string;
    text: string;
    author: string;
    createdAt: string;
    itemType?: string | undefined;
  };
};
export type SearchFile = {
  id: string;
  name: string;
  agentId: string;
  messageId: string;
  taskId?: string | undefined;
  time: string;
};
export type SearchRoutine = {
  id: string;
  name: string;
  agentId?: string;
  channelId?: string;
  detail: string;
};
export type SearchAction = {
  id: string;
  label: string;
  group: "actions" | "settings";
  icon?: LucideIcon;
  detail?: string;
  keywords?: string;
  run: () => void;
};
export type SearchTarget =
  | { kind: "agent"; id: string }
  | { kind: "channel"; id: string }
  | { kind: "message"; agentId: string; messageId: string; taskId?: string }
  | { kind: "routine"; routine: SearchRoutine };
type Tab = "all" | "agents" | "channels" | "messages" | "files" | "routines";
type Group = Exclude<Tab, "all"> | "actions" | "settings";
type Item = {
  key: string;
  label: string;
  detail: string;
  text: string;
  time?: string;
  agent?: Agent | undefined;
  icon?: LucideIcon;
  target?: SearchTarget;
  action?: () => void;
};
const labels = {
  all: "All",
  agents: "Agents",
  channels: "Channels",
  messages: "Messages",
  files: "Files",
  routines: "Routines",
  actions: "Actions",
  settings: "Settings",
};
const messageKey = (hit: SearchMessage) => `${hit.agentId}:${hit.message.id}`;
const fileKey = (file: SearchFile) => `${file.agentId}:${file.messageId}:${file.id}`;
export type GlobalSearchProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agents: readonly Agent[];
  channels?: readonly OpenbotChannelSummary[];
  routines?: readonly SearchRoutine[];
  routinesLoading?: boolean;
  routinesFailed?: boolean;
  onRetryRoutines?: () => void;
  actions?: readonly SearchAction[];
  onSearchMessages?: (query: string, cursor?: string) => Promise<SearchPage<SearchMessage>>;
  onSearchFiles?: (query: string, cursor?: string) => Promise<SearchPage<SearchFile>>;
  onSelect: (target: SearchTarget) => void;
};
const noneMessages = async (): Promise<SearchPage<SearchMessage>> => ({
  results: [],
  nextCursor: null,
});
const noneFiles = async (): Promise<SearchPage<SearchFile>> => ({ results: [], nextCursor: null });
function Highlight({ text, query }: { text: string; query: string }) {
  let offset = 0;
  return matchParts(text, query).map((part) => {
    const start = offset;
    offset += part.text.length;
    return part.match ? (
      <mark key={start} className="global-search-match">
        {part.text}
      </mark>
    ) : (
      part.text
    );
  });
}
function Filters({
  tabs,
  value,
  onChange,
}: {
  tabs: readonly Tab[];
  value: Tab;
  onChange: (tab: Tab) => void;
}) {
  const gt = useGT();
  const list = useRef<HTMLDivElement>(null),
    pill = useRef<HTMLSpanElement>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Source filter indicator is positioned from actual button geometry and tracks resize; first placement does not animate.
  useLayoutEffect(() => {
    const root = list.current;
    if (!root) return;
    const measure = () => {
      const tab = root.querySelector<HTMLElement>(`[data-value="${value}"]`);
      if (tab && pill.current) {
        pill.current.style.transform = `translateX(${tab.offsetLeft}px)`;
        pill.current.style.width = `${tab.offsetWidth}px`;
      }
    };
    measure();
    const stop = observeResize(
      [root, ...root.querySelectorAll<HTMLElement>("[role=tab]")],
      measure,
    );
    const frame = requestAnimationFrame(() => pill.current?.removeAttribute("data-initializing"));
    return () => {
      stop();
      cancelAnimationFrame(frame);
    };
  }, [value]);
  return (
    <div className="global-search-filters">
      <div ref={list} role="tablist" aria-label={gt("Search filters")}>
        <span
          ref={pill}
          className="global-search-filter-pill"
          data-initializing=""
          aria-hidden="true"
        />
        {tabs.map((tab) => (
          <button
            key={tab}
            type="button"
            role="tab"
            data-value={tab}
            data-selected={tab === value ? "" : undefined}
            aria-selected={tab === value}
            tabIndex={tab === value ? 0 : -1}
            onClick={() => onChange(tab)}
          >
            {labels[tab]}
          </button>
        ))}
      </div>
    </div>
  );
}
/** React binding of upstream GlobalSearch, preserving section limits, remote pagination and source DOM/motion. */
export function GlobalSearch(props: GlobalSearchProps) {
  return (
    <Dialog.Root open={props.open} onOpenChange={props.onOpenChange}>
      <Dialog.Portal>
        <div className="openbot-react">
          <Dialog.Backdrop className="ui-dialog-overlay global-search-overlay" />
          <Dialog.Popup
            className="openbot-react ui-dialog-content global-search-dialog"
            aria-describedby={undefined}
          >
            <Dialog.Title className="sr-only">
              <T>Search OpenBot</T>
            </Dialog.Title>
            <SearchContent {...props} />
          </Dialog.Popup>
        </div>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
function SearchContent(props: GlobalSearchProps) {
  const gt = useGT();
  const [query, setQuery] = useState(""),
    [tab, setTab] = useState<Tab>("all"),
    [active, setActive] = useState<string | null>(null),
    [scrollTop, setScrollTop] = useState(0);
  const id = useId(),
    input = useRef<HTMLInputElement>(null),
    results = useRef<HTMLDivElement>(null),
    body = useRef<HTMLDivElement>(null),
    highlight = useRef<HTMLDivElement>(null);
  const value = normalizedSearchText(query);
  const tabs: Tab[] = [
    "all",
    "agents",
    ...(props.channels ? ["channels" as const] : []),
    ...(props.onSearchMessages ? ["messages" as const] : []),
    ...(props.onSearchFiles ? ["files" as const] : []),
    ...(props.routines ? ["routines" as const] : []),
  ];
  const messages = useSearchPages(
    value && props.onSearchMessages && (tab === "all" || tab === "messages") ? value : null,
    props.onSearchMessages ?? noneMessages,
    messageKey,
  );
  const files = useSearchPages(
    props.onSearchFiles && ((tab === "all" && value) || tab === "files") ? value : null,
    props.onSearchFiles ?? noneFiles,
    fileKey,
  );
  const agentsById = new Map(props.agents.map((agent) => [agent.id, agent]));
  const make = (key: string, label: string, detail: string, rest: Partial<Item>): Item => ({
    key,
    label,
    detail,
    text: normalizedSearchText(`${label} ${detail}`),
    ...rest,
  });
  const matched = (items: Item[]) =>
    value ? items.filter((item) => item.text.includes(value)) : items;
  const all: Record<Group, Item[]> = {
    agents: matched(
      props.agents.map((agent) =>
        make(`agent:${agent.id}`, agent.name, agent.title ?? agent.preview ?? "", {
          agent,
          target: { kind: "agent", id: agent.id },
          text: normalizedSearchText(
            `${agent.name} ${agent.title ?? ""} ${agent.description ?? ""} ${agent.preview ?? ""}`,
          ),
        }),
      ),
    ),
    channels: matched(
      (props.channels ?? [])
        .filter((channel) => !channel.archived)
        .map((channel) =>
          make(`channel:${channel.id}`, channel.name, channel.lastMessage?.text ?? "", {
            icon: HashIcon,
            target: { kind: "channel", id: channel.id },
          }),
        ),
    ),
    messages: messages.items.flatMap((hit) => {
      const agent = agentsById.get(hit.agentId);
      return agent && hit.message.itemType !== "thinking" && hit.message.text.trim()
        ? [
            make(`message:${messageKey(hit)}`, agent.name, hit.message.text.replace(/\s+/g, " "), {
              agent,
              time: new Date(hit.message.createdAt).toLocaleString(),
              target: {
                kind: "message",
                agentId: hit.agentId,
                messageId: hit.message.id,
                ...(hit.taskId ? { taskId: hit.taskId } : {}),
              },
            }),
          ]
        : [];
    }),
    files: files.items.flatMap((file) => {
      const agent = agentsById.get(file.agentId);
      return agent
        ? [
            make(`file:${fileKey(file)}`, file.name, agent.name, {
              icon: FileIcon,
              time: file.time,
              target: {
                kind: "message",
                agentId: file.agentId,
                messageId: file.messageId,
                ...(file.taskId ? { taskId: file.taskId } : {}),
              },
            }),
          ]
        : [];
    }),
    routines: matched(
      (props.routines ?? []).map((routine) =>
        make(`routine:${routine.id}`, routine.name, routine.detail, {
          agent: routine.agentId ? agentsById.get(routine.agentId) : undefined,
          icon: CalendarClockIcon,
          target: { kind: "routine", routine },
        }),
      ),
    ),
    actions: [],
    settings: [],
  };
  for (const action of props.actions ?? []) {
    const item = make(`action:${action.id}`, action.label, action.detail ?? "", {
      icon: action.icon ?? SettingsIcon,
      action: action.run,
      text: normalizedSearchText(`${action.label} ${action.detail ?? ""} ${action.keywords ?? ""}`),
    });
    if (value && item.text.includes(value)) all[action.group].push(item);
  }
  const order: Group[] =
    tab !== "all"
      ? [tab]
      : value
        ? ["agents", "channels", "messages", "files", "routines", "actions", "settings"]
        : ["agents", "channels"];
  const sections = order
    .map((group) => ({
      group,
      total:
        group === "messages"
          ? (messages.total ?? all[group].length)
          : group === "files"
            ? (files.total ?? all[group].length)
            : all[group].length,
      items:
        tab === "all" && value && group !== "actions" && group !== "settings"
          ? all[group].slice(0, 5)
          : all[group],
    }))
    .filter((section) => section.items.length);
  const flat = sections.flatMap((section) => section.items),
    selected = flat.find((item) => item.key === active) ?? flat[0];
  let top = 0;
  const nodes = sections.flatMap((section, index) => {
    const rows: {
      key: string;
      top: number;
      height: number;
      section?: typeof section;
      item?: Item;
    }[] = [{ key: `section:${section.group}`, top, height: index === 0 ? 28 : 34, section }];
    top += index === 0 ? 28 : 34;
    for (const item of section.items) {
      rows.push({ key: item.key, top, height: 36, item });
      top += 36;
    }
    return rows;
  });
  const visible = nodes.filter(
    (node) => node.top + node.height >= scrollTop - 108 && node.top <= scrollTop + 508,
  );
  const pending =
      messages.pending ||
      files.pending ||
      (props.routinesLoading && (tab === "routines" || (tab === "all" && !!value))),
    failed =
      messages.failed ||
      files.failed ||
      (props.routinesFailed && (tab === "routines" || tab === "all"));
  const choose = (item: Item | undefined) => {
    if (!item) return;
    props.onOpenChange(false);
    if (item.action) item.action();
    else if (item.target) props.onSelect(item.target);
  };
  const changeTab = (next: Tab) => {
    setTab(next);
    setActive(null);
    setScrollTop(0);
    if (results.current) results.current.scrollTop = 0;
  };
  const cycleTab = (step: number) =>
    changeTab(tabs[(tabs.indexOf(tab) + step + tabs.length) % tabs.length] ?? "all");
  const follow = (index: number) => {
    const item = flat[(index + flat.length) % flat.length];
    if (!item) return;
    setActive(item.key);
    const row = nodes.find((node) => node.item?.key === item.key),
      root = results.current;
    if (root && row) {
      if (row.top < root.scrollTop + 16) root.scrollTop = Math.max(0, row.top - 16);
      else if (row.top + 36 > root.scrollTop + root.clientHeight - 16)
        root.scrollTop = row.top + 52 - root.clientHeight;
      setScrollTop(root.scrollTop);
    }
  };
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Source DOM observers own highlight/height motion and ARIA focus for rows as they enter/leave the virtual window.
  useLayoutEffect(() => {
    const root = results.current,
      inner = body.current,
      mark = highlight.current;
    if (!root || !inner || !mark) return;
    input.current?.focus();
    const stopHighlight = trackResultHighlight(root, mark, (row) => {
      if (row?.id) input.current?.setAttribute("aria-activedescendant", row.id);
      else input.current?.removeAttribute("aria-activedescendant");
    });
    const stopHeight = trackResultsHeight(root, inner, () => {});
    return () => {
      stopHighlight();
      stopHeight();
    };
  }, []);
  return (
    <>
      <div className="global-search-control">
        <SearchIcon aria-hidden="true" />
        <input
          ref={input}
          className="global-search-input"
          aria-label={gt("Search OpenBot")}
          role="combobox"
          aria-expanded="true"
          aria-controls={id}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          placeholder={gt("Search")}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(null);
            setScrollTop(0);
            if (results.current) results.current.scrollTop = 0;
          }}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              follow(
                flat.findIndex((item) => item.key === active) +
                  (event.key === "ArrowDown" ? 1 : -1),
              );
            } else if (event.key === "Enter") {
              event.preventDefault();
              choose(selected);
            } else if (event.key === "Tab") {
              event.preventDefault();
              cycleTab(event.shiftKey ? -1 : 1);
            } else if (
              (event.metaKey || event.ctrlKey) &&
              !event.altKey &&
              !event.shiftKey &&
              /^[1-9]$/.test(event.key)
            ) {
              event.preventDefault();
              choose(flat[Number(event.key) - 1]);
            }
          }}
        />
        <Filters tabs={tabs} value={tab} onChange={changeTab} />
      </div>
      <div
        ref={results}
        className="global-search-results"
        onScroll={(event) => {
          const root = event.currentTarget;
          setScrollTop(root.scrollTop);
          if (root.scrollTop + root.clientHeight >= root.scrollHeight - 72) {
            if (tab === "messages") messages.loadMore();
            if (tab === "files") files.loadMore();
          }
        }}
      >
        <div ref={highlight} className="global-search-highlight" aria-hidden="true" hidden />
        <div ref={body} className="global-search-results-body">
          <div
            role="listbox"
            aria-label={gt("Search results")}
            id={id}
            data-list={`${tab} ${value}`}
            style={{ height: top }}
          >
            {visible.map((node) =>
              node.section ? (
                <div
                  key={node.key}
                  data-index={node.key}
                  role="presentation"
                  className="global-search-section"
                  data-spaced={node.top > 0 ? "" : undefined}
                  style={{ top: node.top }}
                >
                  <span>{labels[node.section.group]}</span>
                  <span className="global-search-section-count">{node.section.total}</span>
                </div>
              ) : node.item ? (
                <div
                  key={node.key}
                  id={`${id}-${encodeURIComponent(node.item.key)}`}
                  data-index={node.key}
                  role="option"
                  aria-selected={node.item.key === selected?.key}
                  data-highlighted={node.item.key === selected?.key ? "" : undefined}
                  data-first={node.item.key === flat[0]?.key ? "" : undefined}
                  className="global-search-result"
                  style={{ top: node.top }}
                  onPointerMove={() => setActive(node.item!.key)}
                  onPointerDown={(event) => event.preventDefault()}
                  onClick={() => choose(node.item)}
                >
                  {node.item.agent ? (
                    <span className="agent-avatar global-search-avatar">
                      <SourceAgentAvatar agent={node.item.agent} size={24} />
                    </span>
                  ) : (
                    <span className="global-search-icon">
                      {node.item.icon && <node.item.icon />}
                    </span>
                  )}
                  <span className="global-search-result-title">
                    <Highlight text={node.item.label} query={query} />
                  </span>
                  {node.item.detail && (
                    <span className="global-search-result-detail">
                      <Highlight text={snippetAround(node.item.detail, query)} query={query} />
                    </span>
                  )}
                  {node.item.time && (
                    <span className="global-search-result-time">{node.item.time}</span>
                  )}
                  <kbd className="global-search-result-enter" aria-hidden="true">
                    <CornerDownLeftIcon />
                  </kbd>
                </div>
              ) : null,
            )}
          </div>
          {pending && (
            <div className="global-search-status" role="status">
              <LoaderCircleIcon className="size-3 animate-spin" />
              <T>Searching…</T>
            </div>
          )}
          {failed && !pending && (
            <div className="global-search-status global-search-failed" role="alert">
              <T>Search failed.</T>{" "}
              <button
                type="button"
                onClick={() => {
                  messages.retry();
                  files.retry();
                  props.onRetryRoutines?.();
                }}
              >
                <T>Retry</T>
              </button>
            </div>
          )}
          {!flat.length && !pending && !failed && (
            <div className="global-search-empty">
              <T>No results</T>
            </div>
          )}
        </div>
      </div>
      <div className="global-search-footer" aria-hidden="true">
        <span className="global-search-hint">
          <kbd>
            <ArrowUpIcon />
          </kbd>
          <kbd>
            <ArrowDownIcon />
          </kbd>
          <T>Navigate</T>
        </span>
        <span className="global-search-hint">
          <kbd>
            <CornerDownLeftIcon />
          </kbd>
          <T>Open</T>
        </span>
        <span className="global-search-hint">
          <kbd>
            <ArrowRightToLineIcon />
          </kbd>
          <T>Filter</T>
        </span>
        <span className="global-search-hint">
          <kbd>
            <CommandIcon />
          </kbd>
          <kbd>1–9</kbd>
          <T>Jump</T>
        </span>
        <span className="global-search-hint">
          <kbd>Esc</kbd>
          <T>Close</T>
        </span>
      </div>
    </>
  );
}
