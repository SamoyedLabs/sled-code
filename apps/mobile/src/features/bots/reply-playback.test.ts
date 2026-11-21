import { afterEach, expect, it, vi } from "vite-plus/test";
import { startReplyPlayback } from "./upstream/openbot-mobile/chat-preview/reply-playback";

afterEach(() => vi.useRealTimers());

it("keeps revealing while chunks arrive and finishes a short tail without restarting", () => {
  vi.useFakeTimers();
  let body = "First";
  let streaming = true;
  const publish = vi.fn();
  const complete = vi.fn();
  const stop = startReplyPlayback({ read: () => ({ body, streaming }), publish, complete });
  for (let chunk = 0; chunk < 20; chunk++) {
    body += " word";
    vi.advanceTimersByTime(12);
  }
  expect(publish.mock.calls.length).toBeGreaterThan(1);
  streaming = false;
  vi.runAllTimers();
  expect(publish.mock.calls.at(-1)?.[0]).toBe(body);
  expect(complete).toHaveBeenCalledOnce();
  stop();
});

it("cancels pending playback when the chat unmounts", () => {
  vi.useFakeTimers();
  const publish = vi.fn();
  const stop = startReplyPlayback({
    read: () => ({ body: "A reply", streaming: true }),
    publish,
    complete: vi.fn(),
  });
  stop();
  vi.runAllTimers();
  expect(publish).not.toHaveBeenCalled();
});
