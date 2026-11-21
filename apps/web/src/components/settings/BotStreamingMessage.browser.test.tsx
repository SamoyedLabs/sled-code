import { Activity, StrictMode } from "react";
import { EnvironmentId } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";
import { act, fakeTimers, render } from "../../../test/render";
import { BotStreamingMessage } from "./BotStreamingMessage";
vi.mock("../bots/BotChatMarkdown", () => ({
  BotChatMarkdown: ({ text }: { text: string }) => <p>{text}</p>,
}));

it("resumes the actual text reveal after a Code/Bots Activity round trip", async () => {
  using _clock = fakeTimers();
  const onLayout = vi.fn();
  const scope = {
    environmentId: EnvironmentId.make("stream-proof"),
    hostId: "owned-host",
    agentId: "owned-agent",
  };
  const view = (text: string, visible: boolean, streaming = true) => (
    <StrictMode>
      <Activity mode={visible ? "visible" : "hidden"}>
        <BotStreamingMessage {...scope} text={text} isStreaming={streaming} onLayout={onLayout} />
      </Activity>
    </StrictMode>
  );
  await using screen = await render(view("First ", true));
  await screen.rerender(view("First second third fourth ", true));
  await screen.rerender(view("First second third fourth ", false));
  await screen.rerender(view("First second third fourth ", true));
  await act(() => vi.advanceTimersByTimeAsync(1000));
  expect(screen.container.textContent).toBe("First second third fourth ");
  await screen.rerender(view("First second third fourth ", true, false));
  await act(() => vi.advanceTimersByTimeAsync(1000));
  expect(vi.getTimerCount()).toBe(0);
});
