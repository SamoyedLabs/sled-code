import { EnvironmentId } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";
import { memo } from "react";
import { render } from "../../../test/render";
import { BotChatMarkdown } from "./BotChatMarkdown";

const renderMarkdown = vi.hoisted(() =>
  vi.fn<(_: { text: string; extraRemarkPlugins: unknown }) => void>(),
);
vi.mock("../ChatMarkdown", () => ({
  default: memo(function Markdown(props: { text: string; extraRemarkPlugins: unknown }) {
    renderMarkdown(props);
    return <p>{props.text}</p>;
  }),
}));
it("reuses the markdown parser inputs on unchanged snapshots and updates changed content", async () => {
  renderMarkdown.mockClear();
  const scope = {
    environmentId: EnvironmentId.make("render-proof"),
    hostId: "host",
    agentId: "agent",
  };
  await using screen = await render(<BotChatMarkdown {...scope} text="Original answer" />);
  const initial = renderMarkdown.mock.calls.length;
  for (let i = 0; i < 20; i++)
    await screen.rerender(<BotChatMarkdown {...scope} text="Original answer" />);
  expect(renderMarkdown).toHaveBeenCalledTimes(initial);
  await screen.rerender(<BotChatMarkdown {...scope} text="Updated answer" />);
  expect(renderMarkdown).toHaveBeenCalledTimes(initial + 1);
});
it("shares static parser configuration across virtualized messages", async () => {
  renderMarkdown.mockClear();
  const scope = {
    environmentId: EnvironmentId.make("render-proof"),
    hostId: "host",
    agentId: "agent",
  };
  await using screen = await render(
    <>
      <BotChatMarkdown {...scope} text="First" />
      <BotChatMarkdown {...scope} text="Second" />
    </>,
  );
  await expect.element(screen.getByText("First", { exact: true })).toBeVisible();
  expect(renderMarkdown).toHaveBeenCalledTimes(2);
  expect(renderMarkdown.mock.calls[0]?.[0].extraRemarkPlugins).toBe(
    renderMarkdown.mock.calls[1]?.[0].extraRemarkPlugins,
  );
});
