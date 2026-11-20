/* oxlint-disable shadcn/no-unknown-classes -- This mounts the original scoped preview styles. */
import { useRef, useState } from "react";
import { EnvironmentId } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";
import { render } from "../../../test/render";
import { BotFilePreview } from "./BotFilePreview";
import { BotSelectionActions } from "../settings/BotSelectionActions";
import { BotStreamingMessage } from "../settings/BotStreamingMessage";
import {
  BotFileSelectionWorkspace,
  usePublishBotFileSelection,
  type BotFileSelectionActions,
} from "../settings/BotFileSelectionContext";
import "~/index.css";
import "./upstream/openbot-react.css";
import "../settings/bot-conversation.css";

it("keeps a sibling file preview addressed to the current conversation and removes actions when permission changes", async () => {
  const first = vi.fn<(_: string, body: string) => Promise<boolean>>().mockResolvedValue(true);
  const second = vi.fn<(_: string, body: string) => Promise<boolean>>().mockResolvedValue(true);
  const quote = vi.fn();
  const file = new Blob(["first line\nsecond passage\nthird line"], { type: "text/plain" });
  function Main({ actions }: { actions: BotFileSelectionActions }) {
    usePublishBotFileSelection(true, actions);
    return null;
  }
  function Workspace() {
    const root = useRef<HTMLDivElement>(null);
    const [target, setTarget] = useState("first");
    const [disabled, setDisabled] = useState(false);
    return (
      <div ref={root}>
        <BotSelectionActions root={root} disabled={false} onQuote={quote} onSend={first} />
        <button onClick={() => setTarget("second")}>Switch conversation</button>
        <button onClick={() => setDisabled(true)}>Revoke write</button>
        <BotFileSelectionWorkspace key={target}>
          <Main
            actions={{ disabled, onQuote: quote, onSend: target === "first" ? first : second }}
          />
          <BotFilePreview
            name="notes.txt"
            mimeType="text/plain"
            sizeBytes={file.size}
            file={file}
            quoteTarget={{
              source: "attachment",
              attachmentId: "original-producer-file",
              name: "notes.txt",
            }}
          />
        </BotFileSelectionWorkspace>
      </div>
    );
  }
  await using screen = await render(<Workspace />);
  const contents = screen.getByText("first line\nsecond passage\nthird line");
  await expect.element(contents).toBeVisible();
  await screen.getByRole("button", { name: "Switch conversation" }).click();
  await contents.click({ clickCount: 3 });
  await expect.element(page.getByRole("toolbar", { name: "Selected text actions" })).toBeVisible();
  await page.getByRole("button", { name: "Explain", exact: true }).click();
  expect(first).not.toHaveBeenCalled();
  expect(second).toHaveBeenCalledOnce();
  expect(second.mock.calls[0]?.[0]).toMatch(
    /^attachment-file:original-producer-file\/notes.txt#L/u,
  );
  await contents.click({ clickCount: 3 });
  await page.getByRole("button", { name: "Quote selected text" }).click();
  await vi.waitFor(() => expect(quote).toHaveBeenCalledOnce());
  expect(quote.mock.calls[0]?.[0]).toMatch(/^attachment-file:original-producer-file\/notes.txt#L/u);
  await contents.click({ clickCount: 3 });
  await screen.getByRole("button", { name: "Revoke write" }).click();
  await contents.click({ clickCount: 3 });
  await expect.element(page.getByRole("toolbar")).not.toBeInTheDocument();
  expect(second).toHaveBeenCalledOnce();
});

it("renders a selected-message instruction and bounded source quote without reinterpreting an agent's ordinary Markdown", async () => {
  const text = "Improve this selected text.\n\n> first passage\n> second passage";
  const scope = {
    environmentId: EnvironmentId.make("selection-test"),
    hostId: "host",
    agentId: "agent",
    onLayout: () => {},
  };
  await using screen = await render(
    <div className="openbot-react">
      <BotStreamingMessage {...scope} text={text} selectionInstruction />
    </div>,
  );
  await expect
    .element(screen.getByText("first passage\nsecond passage"))
    .toHaveClass("ob-chat-selection-quote");
  await expect.element(screen.getByText("Improve this selected text.")).toBeVisible();
  await screen.rerender(
    <div className="openbot-react">
      <BotStreamingMessage {...scope} text={text} selectionInstruction={false} />
    </div>,
  );
  await expect
    .element(screen.getByText("first passage\nsecond passage"))
    .not.toHaveClass("ob-chat-selection-quote");
});
