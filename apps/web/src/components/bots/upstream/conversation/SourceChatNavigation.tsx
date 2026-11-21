/* oxlint-disable shadcn/no-unknown-classes -- Original navigation and rail selectors are in scoped conversation styles. */
import { useEffect, useRef, useState, type CSSProperties, type RefObject } from "react";
import { ScrollToEndButton } from "../../../chat/TimelineOverlays";
import { observeResize } from "../../../../lib/observeResize";
import { useStableCallback } from "../../../../hooks/useStableCallback";
import { tallyNewMessages, anchorNewMessages, type TimelineRow } from "./new-message-tally";
import "./scroll-rail.css";

export function useNewMessageTally(rows: readonly TimelineRow[], following: boolean) {
  const version = JSON.stringify(rows);
  const [seen, setSeen] = useState(() => ({ version, tally: anchorNewMessages(rows) }));
  if (seen.version !== version)
    setSeen({ version, tally: tallyNewMessages(seen.tally, rows, following) });
  return {
    count: seen.tally.count,
    dismiss: () => setSeen({ version, tally: anchorNewMessages(rows) }),
  };
}
export function UnreadMessagesBanner({
  count,
  busy,
  onJump,
  onRead,
}: {
  count: number;
  busy: boolean;
  onJump: () => void;
  onRead: () => void;
}) {
  if (!count) return null;
  return (
    <div className="unread-messages-banner" role="status" aria-label={`${count} new messages`}>
      <button type="button" className="ui-button unread-messages-jump" onClick={onJump}>
        {count} new messages
      </button>
      <button
        type="button"
        className="ui-button unread-messages-mark-read"
        disabled={busy}
        onClick={onRead}
      >
        <span className="unread-messages-mark-read-label">
          {busy ? "Marking…" : "Mark as read"}
        </span>
      </button>
    </div>
  );
}
export function UnreadMessagesDivider() {
  return (
    <div className="unread-messages-divider">
      <hr aria-label="Unread messages" />
      <span>New messages</span>
      <hr />
    </div>
  );
}
export function ScrollToLatestButton({ count, onJump }: { count: number; onJump: () => void }) {
  return (
    <ScrollToEndButton
      bottom="calc(100% + 6px)"
      summary={count > 0 ? `${count} new messages` : null}
      onScrollToEnd={onJump}
    />
  );
}
export type ChatScrollSection = {
  key: string;
  label: string;
  row?: number;
  start: number | undefined;
};
type RailState = { shown: boolean; height: number; inset: number; lengths: number[] };
const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
export function SourceChatScrollRail({
  scroller,
  as = "div",
  sections,
  onJump,
}: {
  as?: "div" | "li";
  scroller: RefObject<HTMLElement | null>;
  sections: readonly ChatScrollSection[];
  onJump: (section: ChatScrollSection) => void;
}) {
  const [rail, setRail] = useState<RailState>({ shown: false, height: 0, inset: 0, lengths: [] });
  const [active, setActive] = useState(0);
  const [keyboardFocus, setKeyboardFocus] = useState(false);
  const nav = useRef<HTMLElement>(null),
    track = useRef<HTMLDivElement>(null),
    list = useRef<HTMLOListElement>(null),
    head = useRef<HTMLSpanElement>(null);
  const control = useRef<{ jump: (key: string) => void }>({ jump: () => {} });
  const readSections = useStableCallback(() => sections);
  const version = JSON.stringify(sections);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- The source rail reads scroll geometry and paints only on scroll/resize or during its bounded 450ms jump; dispose all observers and frames.
  useEffect(() => {
    const element = scroller.current;
    if (!element) return;
    let frame = 0,
      relayout = true,
      drawn: number | undefined,
      opened: string | undefined;
    let jump: { from: number; startedAt: number } | undefined;
    let geometry:
      | { starts: number[]; ends: number[]; lastScroll: number; height: number }
      | undefined;
    const schedule = (layout = false) => {
      relayout = relayout || layout;
      if (frame) return;
      frame = requestAnimationFrame(update);
    };
    const update = () => {
      frame = 0;
      const current = readSections();
      if (relayout) {
        relayout = false;
        const height = element.clientHeight,
          content = element.scrollHeight,
          lastScroll = Math.max(0, content - height);
        if (!lastScroll || current.length < 2) {
          geometry = undefined;
          setRail((old) => (old.shown ? { ...old, shown: false } : old));
          return;
        }
        const starts: number[] = [];
        const mountedRows = new Map(
          [...element.querySelectorAll<HTMLElement>("[data-index]")].map((row) => [
            Number(row.dataset.index),
            row,
          ]),
        );
        const top = element.getBoundingClientRect().top;
        const scrollTop = element.scrollTop;
        for (const section of current) {
          const row = section.row === undefined ? undefined : mountedRows.get(section.row);
          const measured = row ? row.getBoundingClientRect().top - top + scrollTop : section.start;
          starts.push(Math.max(measured ?? starts.at(-1) ?? 0, starts.at(-1) ?? -Infinity));
        }
        const ends = [...starts.slice(1), content];
        geometry = { starts, ends, lastScroll, height };
        const inset = Number.parseFloat(getComputedStyle(element).paddingInlineEnd) || 0;
        const lengths = starts.map((start, index) =>
          Math.max(1, Math.round((ends[index] ?? content) - start)),
        );
        setRail((old) =>
          old.shown &&
          old.height === height &&
          old.inset === inset &&
          JSON.stringify(old.lengths) === JSON.stringify(lengths)
            ? old
            : { shown: true, height, inset, lengths },
        );
      }
      if (!geometry) return;
      const { starts, ends, lastScroll, height } = geometry;
      const reading = element.scrollTop + height * (element.scrollTop / Math.max(1, lastScroll));
      const openedIndex =
        opened === undefined ? -1 : current.findIndex((section) => section.key === opened);
      const target =
        openedIndex >= 0
          ? Math.min(
              Math.max(element.scrollTop, starts[openedIndex] ?? 0),
              ends[openedIndex] ?? reading,
            )
          : reading;
      let position = target;
      if (jump) {
        const progress = Math.min(1, (performance.now() - jump.startedAt) / 450);
        if (progress < 1) {
          const eased = progress < 0.5 ? 4 * progress ** 3 : 1 - (-2 * progress + 2) ** 3 / 2;
          position = jump.from + (target - jump.from) * eased;
          schedule();
        } else jump = undefined;
      }
      drawn = position;
      const index =
        openedIndex >= 0 && position === target
          ? openedIndex
          : Math.max(
              0,
              starts.findLastIndex((start) => position >= start),
            );
      const fills = starts.map(
        (start, i) =>
          Math.round(
            Math.min(1, Math.max(0, (position - start) / Math.max(1, (ends[i] ?? 0) - start))) *
              1000,
          ) / 1000,
      );
      for (let i = 0; i < (list.current?.children.length ?? 0); i++) {
        const item = list.current!.children[i];
        if (!(item instanceof HTMLElement)) continue;
        const state = i === index ? "active" : i < index ? "read" : "unread";
        if (item.dataset.railState !== state) item.dataset.railState = state;
        const fill = String(fills[i] ?? 0);
        if (item.style.getPropertyValue("--chat-scroll-rail-fill") !== fill)
          item.style.setProperty("--chat-scroll-rail-fill", fill);
      }
      const item = list.current?.children[index];
      if (item instanceof HTMLElement && head.current && track.current) {
        head.current.style.setProperty("--chat-scroll-rail-head-top", `${item.offsetTop}px`);
        head.current.style.setProperty("--chat-scroll-rail-head-length", `${item.offsetHeight}px`);
        head.current.style.setProperty("--chat-scroll-rail-fill", String(fills[index] ?? 0));
        if (item.offsetTop < track.current.scrollTop) track.current.scrollTop = item.offsetTop;
        else if (
          item.offsetTop + item.offsetHeight >
          track.current.scrollTop + track.current.clientHeight
        )
          track.current.scrollTop = item.offsetTop + item.offsetHeight - track.current.clientHeight;
      }
      setActive((old) => (old === index ? old : index));
    };
    control.current.jump = (key) => {
      opened = key;
      jump =
        drawn === undefined || reduced()
          ? undefined
          : { from: drawn, startedAt: performance.now() };
      schedule();
    };
    const input = () => {
      opened = undefined;
      jump = undefined;
      schedule();
    };
    const scroll = () => {
      if (!nav.current?.matches(":hover") && !nav.current?.contains(document.activeElement))
        opened = undefined;
      schedule();
    };
    const key = (event: KeyboardEvent) => {
      if (
        ["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].includes(event.key) &&
        !(
          event.target instanceof HTMLElement &&
          (event.target.isContentEditable || event.target.closest("input,textarea,select"))
        )
      )
        input();
    };
    element.addEventListener("scroll", scroll, { passive: true });
    element.addEventListener("wheel", input, { passive: true });
    element.addEventListener("touchmove", input, { passive: true });
    element.addEventListener("keydown", key);
    const stop = observeResize(
      [element, ...element.querySelectorAll<HTMLElement>(".virtual-chat-list, .ob-group-messages")],
      () => schedule(true),
    );
    schedule(true);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      stop();
      element.removeEventListener("scroll", scroll);
      element.removeEventListener("wheel", input);
      element.removeEventListener("touchmove", input);
      element.removeEventListener("keydown", key);
      control.current.jump = () => {};
    };
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- Section geometry and conditional rail DOM must rebuild the external scroll subscription.
  }, [scroller, readSections, version, rail.shown]);
  if (!rail.shown) return null;
  const Container = as;
  return (
    <Container
      role={as === "li" ? "presentation" : undefined}
      className="chat-scroll-rail"
      style={
        {
          height: rail.height,
          marginBottom: -rail.height,
          "--chat-scroll-rail-inset": `${rail.inset}px`,
        } as CSSProperties
      }
    >
      <nav
        ref={nav}
        className="chat-scroll-rail-nav"
        aria-label="Conversation outline"
        data-keyboard-focus={keyboardFocus ? "" : undefined}
        onFocusCapture={(event) => setKeyboardFocus(event.target.matches(":focus-visible"))}
        onBlurCapture={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) setKeyboardFocus(false);
        }}
      >
        <span className="chat-scroll-rail-surface" aria-hidden="true" />
        <p className="chat-scroll-rail-eyebrow" aria-hidden="true">
          <span>Conversation</span>
          <span className="chat-scroll-rail-count">
            <span className="t-digit-group" key={active}>
              <span className={reduced() ? undefined : "t-digit"}>
                {String(active + 1).padStart(2, "0")}
              </span>
            </span>
            {" / "}
            {String(sections.length).padStart(2, "0")}
          </span>
        </p>
        <div ref={track} className="chat-scroll-rail-track">
          <ol ref={list} className="chat-scroll-rail-list">
            {sections.map((section, index) => (
              <li
                key={section.key}
                className="chat-scroll-rail-item"
                style={
                  {
                    flexGrow: rail.lengths[index] ?? 1,
                    "--chat-scroll-rail-index": index,
                  } as CSSProperties
                }
              >
                <button
                  type="button"
                  className="ui-button chat-scroll-rail-link"
                  aria-current={index === active ? "location" : undefined}
                  onClick={() => {
                    control.current.jump(section.key);
                    onJump(section);
                  }}
                >
                  <span className="chat-scroll-rail-label" dir="auto">
                    {section.label}
                  </span>
                  <span className="chat-scroll-rail-bar" aria-hidden="true">
                    <span className="chat-scroll-rail-fill" />
                  </span>
                </button>
              </li>
            ))}
          </ol>
          <span ref={head} className="chat-scroll-rail-head" aria-hidden="true" />
        </div>
      </nav>
    </Container>
  );
}
