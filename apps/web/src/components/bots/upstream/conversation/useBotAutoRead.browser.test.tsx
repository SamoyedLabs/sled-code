import { Activity, useRef } from "react";
import { expect, it, vi } from "vite-plus/test";
import { act, fakeTimers, render } from "../../../../../test/render";
import { useBotAutoRead } from "./useBotAutoRead";

function Chat({
  identity = "main-a",
  watermark = "message-1",
  enabled = true,
  onRead,
}: {
  identity?: string;
  watermark?: string;
  enabled?: boolean;
  onRead: (through: string) => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  useBotAutoRead({ identity, watermark, scroller, enabled, unread: 3, onRead });
  return (
    <div ref={scroller} aria-label="History" style={{ height: 100, overflow: "auto" }}>
      <div style={{ height: 400 }}>History</div>
    </div>
  );
}
const flush = () => act(() => vi.advanceTimersByTimeAsync(34));
it("acknowledges the exact visible tail once, including a later message and another conversation", async () => {
  using _timers = fakeTimers();
  using _focus = vi.spyOn(document, "hasFocus").mockReturnValue(true);
  const read = vi.fn();
  await using screen = await render(<Chat onRead={read} />);
  await flush();
  expect(read).not.toHaveBeenCalled();
  const history = screen.getByLabelText("History").element();
  history.scrollTop = history.scrollHeight;
  history.dispatchEvent(new Event("scroll"));
  await flush();
  expect(read.mock.calls).toEqual([["message-1"]]);
  history.dispatchEvent(new Event("scroll"));
  window.dispatchEvent(new Event("focus"));
  await flush();
  expect(read).toHaveBeenCalledTimes(1);
  await screen.rerender(<Chat onRead={read} watermark="message-2" />);
  await flush();
  expect(read.mock.calls).toEqual([["message-1"], ["message-2"]]);
  await screen.rerender(<Chat onRead={read} identity="task-b" watermark="task-message" />);
  await flush();
  expect(read.mock.calls.at(-1)).toEqual(["task-message"]);
});
it("waits for focus and skips an older-history or streaming window", async () => {
  using _timers = fakeTimers();
  using focus = vi.spyOn(document, "hasFocus").mockReturnValue(false);
  const read = vi.fn();
  await using screen = await render(<Chat onRead={read} enabled={false} />);
  screen.getByLabelText("History").element().scrollTop = 400;
  await flush();
  expect(read).not.toHaveBeenCalled();
  await screen.rerender(<Chat onRead={read} enabled />);
  await flush();
  expect(read).not.toHaveBeenCalled();
  focus.mockReturnValue(true);
  window.dispatchEvent(new Event("focus"));
  await flush();
  expect(read.mock.calls).toEqual([["message-1"]]);
});
it("does not acknowledge a retained hidden chat and disposes a pending old-scope receipt", async () => {
  using _timers = fakeTimers();
  using _focus = vi.spyOn(document, "hasFocus").mockReturnValue(true);
  const read = vi.fn();
  await using screen = await render(
    <Activity mode="visible">
      <Chat onRead={read} />
    </Activity>,
  );
  screen.getByLabelText("History").element().scrollTop = 400;
  await screen.rerender(
    <Activity mode="hidden">
      <Chat onRead={read} />
    </Activity>,
  );
  await flush();
  expect(read).not.toHaveBeenCalled();
  await screen.rerender(
    <Activity mode="visible">
      <Chat identity="other-host" watermark="other-tail" onRead={read} />
    </Activity>,
  );
  await flush();
  expect(read.mock.calls).toEqual([["other-tail"]]);
  await screen.unmount();
  window.dispatchEvent(new Event("focus"));
  await flush();
  expect(read).toHaveBeenCalledTimes(1);
});

it("waits for a background document to become visible", async () => {
  using _timers = fakeTimers();
  using _focus = vi.spyOn(document, "hasFocus").mockReturnValue(true);
  using hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(true);
  const read = vi.fn();
  await using screen = await render(<Chat onRead={read} />);
  screen.getByLabelText("History").element().scrollTop = 400;
  await flush();
  expect(read).not.toHaveBeenCalled();
  hidden.mockReturnValue(false);
  document.dispatchEvent(new Event("visibilitychange"));
  await flush();
  expect(read.mock.calls).toEqual([["message-1"]]);
});
