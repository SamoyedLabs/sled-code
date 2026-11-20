/* oxlint-disable shadcn/no-unknown-classes -- This test mounts the original conversation CSS. */
import { useRef, useState } from "react";
import { expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";
import { render } from "../../../../../test/render";
import {
  ScrollToLatestButton,
  SourceChatScrollRail,
  UnreadMessagesBanner,
} from "./SourceChatNavigation";
import { useSourceChatVirtualizer } from "./useSourceChatVirtualizer";
import "~/index.css";
import "../openbot-react.css";
import "../People.css";
import "../../../settings/bot-conversation.css";
import "../../group-conversation.css";
const historyRenders = vi.fn();
function History({ count }: { count: number }) {
  historyRenders();
  const scroller = useRef<HTMLOListElement>(null),
    root = useRef<HTMLOListElement>(null),
    following = useRef(true);
  const ids = Array.from({ length: count }, (_, index) => `original-${index}`);
  const virtual = useSourceChatVirtualizer<HTMLOListElement, HTMLLIElement>(
    scroller,
    root,
    ids,
    following,
  );
  const [jump, setJump] = useState("");
  return (
    <div className="openbot-react">
      <output aria-label="Last jump">{jump}</output>
      <button onClick={() => virtual.instance.options.onChange?.(virtual.instance, false)}>
        Repeat measured range
      </button>
      <ol ref={scroller} aria-label="History" style={{ height: 300, overflowY: "auto" }}>
        <SourceChatScrollRail
          as="li"
          scroller={scroller}
          sections={[
            { key: "top", label: "Original question", row: 0, start: 0 },
            { key: "last", label: "Later question", row: 250, start: 14000 },
          ]}
          onJump={(section) => {
            following.current = false;
            setJump(section.key);
            virtual.instance.scrollToIndex(section.row ?? 0, { align: "start" });
          }}
        />
        <li style={{ listStyle: "none" }}>
          <ol
            ref={root}
            className="virtual-chat-list"
            style={{
              position: "relative",
              height: virtual.virtualized ? virtual.total : "auto",
              listStyle: "none",
              padding: 0,
              margin: 0,
            }}
          >
            {virtual.items.map((item) => (
              <li
                key={ids[item.index]}
                ref={(element) => virtual.instance.measureElement(element)}
                data-index={item.index}
                style={{
                  height: 56,
                  position: virtual.virtualized ? "absolute" : "relative",
                  top: 0,
                  width: "100%",
                  transform: virtual.virtualized
                    ? `translateY(${item.start - virtual.margin}px)`
                    : undefined,
                }}
              >
                {ids[item.index]}
              </li>
            ))}
          </ol>
        </li>
      </ol>
    </div>
  );
}
it("keeps an asynchronously loaded ol/li history bounded and reveals the original row through the rail", async () => {
  await using screen = await render(<History count={0} />);
  await screen.rerender(<History count={300} />);
  await expect.element(screen.getByText("original-299", { exact: true })).toBeVisible();
  const railItems = screen.container.querySelectorAll(".chat-scroll-rail-item");
  expect([...railItems].every((item) => !item.hasAttribute("data-state"))).toBe(true);
  expect(
    screen.getByRole("list", { name: "History" }).element().querySelectorAll("[data-index]").length,
  ).toBeLessThan(50);
  const question = screen.getByRole("button", { name: "Original question", exact: true });
  await expect.element(question).toBeVisible();
  await question.click({
    position: { x: question.element().clientWidth - 6, y: question.element().clientHeight / 2 },
  });
  await expect.element(screen.getByText("original-0", { exact: true })).toBeVisible();
  await expect.element(screen.getByRole("status", { name: "Last jump" })).toHaveTextContent("top");
});
it("separates unread navigation from marking read", async () => {
  const jump = vi.fn(),
    mark = vi.fn();
  await using screen = await render(
    <div className="openbot-react">
      <UnreadMessagesBanner count={3} busy={false} onJump={jump} onRead={mark} />
    </div>,
  );
  await screen.getByRole("button", { name: "3 new messages", exact: true }).click();
  expect(jump).toHaveBeenCalledOnce();
  expect(mark).not.toHaveBeenCalled();
  await screen.getByRole("button", { name: "Mark as read", exact: true }).click();
  expect(mark).toHaveBeenCalledOnce();
});

it("does not commit React again when the virtualizer reports an unchanged measured range", async () => {
  historyRenders.mockClear();
  await using screen = await render(<History count={300} />);
  await expect.element(screen.getByText("original-299", { exact: true })).toBeVisible();
  const repeat = screen.getByRole("button", { name: "Repeat measured range" });
  await repeat.click();
  const before = historyRenders.mock.calls.length;
  expect(before).toBeGreaterThan(0);
  await repeat.click();
  expect(historyRenders).toHaveBeenCalledTimes(before);
});

it("opens the outline for keyboard focus and clears it when focus leaves", async () => {
  await using screen = await render(<History count={300} />);
  await expect.element(screen.getByText("original-299", { exact: true })).toBeVisible();
  const outside = screen.getByRole("button", { name: "Repeat measured range" });
  await outside.click();
  await userEvent.tab();
  const outline = screen.getByRole("navigation", { name: "Conversation outline" });
  await expect.element(outline).toHaveAttribute("data-keyboard-focus", "");
  await outside.click();
  await expect.element(outline).not.toHaveAttribute("data-keyboard-focus");
});

function GroupHistory({ count }: { count: number }) {
  const scroller = useRef<HTMLDivElement>(null);
  return (
    <div className="openbot-react">
      <div
        ref={scroller}
        aria-label="Group history"
        className="ob-chat-scroll ob-group-scroll"
        style={{ height: 300, flex: "none" }}
      >
        <SourceChatScrollRail
          scroller={scroller}
          sections={[
            { key: "first", label: "First request", row: 0, start: 0 },
            { key: "last", label: "Last request", row: count - 1, start: (count - 1) * 100 },
          ]}
          onJump={() => {}}
        />
        <div className="ob-group-transcript">
          <ol className="ob-group-messages virtual-chat-list">
            {Array.from({ length: count }, (_, index) => (
              <li key={index} data-index={index} style={{ height: 100 }}>
                Group message {index}
              </li>
            ))}
          </ol>
        </div>
      </div>
    </div>
  );
}

it("keeps the beginning of a group history reachable as the outline and messages grow", async () => {
  await using screen = await render(<GroupHistory count={6} />);
  const history = screen.getByLabelText("Group history");
  await expect
    .element(screen.getByRole("navigation", { name: "Conversation outline" }))
    .toBeVisible();
  const firstTop = () =>
    screen.getByText("Group message 0", { exact: true }).element().getBoundingClientRect().top -
    history.element().getBoundingClientRect().top;
  expect(firstTop()).toBeGreaterThanOrEqual(0);
  const before = firstTop();
  await screen.rerender(<GroupHistory count={8} />);
  expect(firstTop()).toBe(before);
});

function GroupJumpToLatest({
  count,
  composerHeight = 100,
  rowCount = 30,
}: {
  count: number;
  composerHeight?: number;
  rowCount?: number;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const following = useRef(false);
  const virtual = useSourceChatVirtualizer(
    scroller,
    root,
    Array.from({ length: rowCount }, (_, index) => `jump-${index}`),
    following,
  );
  const [away, setAway] = useState(true);
  return (
    <div className="openbot-react">
      <div className="ob-group-conversation ob-chat" data-workspace style={{ height: 400 }}>
        <div
          ref={scroller}
          className="ob-chat-scroll ob-group-scroll"
          aria-label="Jump history"
          onScroll={(event) => {
            const element = event.currentTarget;
            setAway(element.scrollHeight - element.clientHeight - element.scrollTop > 4);
          }}
        >
          <div ref={root} className="ob-group-transcript">
            {Array.from({ length: rowCount }, (_, index) => (
              <p key={index} style={{ height: 100 }}>
                Message {index}
              </p>
            ))}
          </div>
        </div>
        <div
          className="ob-chat-composer-wrap"
          aria-label="Jump composer"
          style={{ height: composerHeight, flexShrink: 0 }}
        >
          {away && (
            <ScrollToLatestButton
              count={count}
              onJump={() => {
                virtual.scrollToEnd();
              }}
            />
          )}
          <textarea aria-label="Draft" />
        </div>
      </div>
    </div>
  );
}
it.each([
  [0, 8],
  [3, 30],
])(
  "places the latest control (%i new) above a growing composer and makes its center clickable",
  async (count, rowCount) => {
    await using screen = await render(<GroupJumpToLatest count={count} rowCount={rowCount} />);
    const button = screen.getByRole("button", {
      name: count ? `Scroll to end ${count} new messages` : "Scroll to end",
    });
    await screen.rerender(
      <GroupJumpToLatest count={count} rowCount={rowCount} composerHeight={180} />,
    );
    const rect = button.element().getBoundingClientRect();
    const composer = screen.getByLabelText("Jump composer").element().getBoundingClientRect();
    expect(rect.bottom).toBeLessThanOrEqual(composer.top - 8);
    expect(
      button
        .element()
        .contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)),
    ).toBe(true);
    const historyElement = screen.getByLabelText("Jump history").element();
    const offsets: number[] = [];
    historyElement.addEventListener("scroll", () => offsets.push(historyElement.scrollTop));
    await button.click();
    await expect
      .poll(() => {
        const history = screen.getByLabelText("Jump history").element();
        return history.scrollHeight - history.clientHeight - history.scrollTop;
      })
      .toBeLessThanOrEqual(4);
    const end = historyElement.scrollHeight - historyElement.clientHeight;
    expect(offsets.some((offset) => offset > 0 && offset < end - 4)).toBe(true);
    await expect.element(button).not.toBeInTheDocument();
  },
);

it.each([8, 30])("respects reduced motion for %i history rows", async (rowCount) => {
  const matchMedia = window.matchMedia.bind(window);
  using _media = vi.spyOn(window, "matchMedia").mockImplementation((query) => {
    const media = matchMedia(query);
    if (query === "(prefers-reduced-motion: reduce)")
      Object.defineProperty(media, "matches", { value: true });
    return media;
  });
  await using screen = await render(<GroupJumpToLatest count={0} rowCount={rowCount} />);
  const history = screen.getByLabelText("Jump history").element();
  using scroll = vi.spyOn(history, "scrollTo");
  await screen.getByRole("button", { name: "Scroll to end" }).click();
  await expect
    .poll(() => history.scrollHeight - history.clientHeight - history.scrollTop)
    .toBeLessThanOrEqual(4);
  expect(scroll).toHaveBeenCalledWith(expect.objectContaining({ behavior: "auto" }));
});
