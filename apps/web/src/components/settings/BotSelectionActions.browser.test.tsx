/* oxlint-disable shadcn/no-unknown-classes -- The selection toolbar uses the scoped original OpenBot styles. */
import { useRef } from "react";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import { render } from "../../../test/render";
import { BotSelectionActions } from "./BotSelectionActions";
import "~/index.css";
import "../bots/upstream/openbot-react.css";
import "./bot-conversation.css";

it("keeps the selected message identity through presets, failed sends and custom instruction retries", async () => {
  const send = vi.fn<(_: string, body: string) => Promise<boolean>>().mockResolvedValue(false);
  const quote = vi.fn();
  function Conversation() {
    const root = useRef<HTMLDivElement>(null);
    return (
      <div className="openbot-react">
        <div ref={root} className="ob-chat">
          <p data-selection-message-id="original-message">A passage worth improving.</p>
          <BotSelectionActions root={root} disabled={false} onQuote={quote} onSend={send} />
        </div>
      </div>
    );
  }
  await using screen = await render(<Conversation />);
  const passage = screen.getByText("A passage worth improving.");
  await passage.click({ clickCount: 3 });
  await expect.element(page.getByRole("toolbar", { name: "Selected text actions" })).toBeVisible();
  await page.getByRole("button", { name: "Show more actions" }).click();
  await expect.element(page.getByRole("button", { name: "Grammar", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Explain", exact: true }).click();
  expect(send).toHaveBeenCalledWith(
    "original-message",
    "Explain this selected text.\n\n> A passage worth improving.",
  );
  await expect.element(page.getByRole("alert")).toHaveTextContent("Couldn’t send");
  send.mockResolvedValue(true);
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  expect(send).toHaveBeenLastCalledWith(
    "original-message",
    "Explain this selected text.\n\n> A passage worth improving.",
  );
  await expect.element(page.getByRole("toolbar")).not.toBeInTheDocument();
  await passage.click({ clickCount: 3 });
  await page.getByRole("textbox", { name: "Describe edits" }).fill("  Make it warmer  ");
  await expect
    .element(page.getByRole("button", { name: "Explain", exact: true }))
    .not.toBeInTheDocument();
  await userEvent.keyboard("{Enter}");
  expect(send).toHaveBeenLastCalledWith(
    "original-message",
    "Make it warmer\n\n> A passage worth improving.",
  );
  expect(quote).not.toHaveBeenCalled();
});

it("captures source-file lines without borrowing another conversation's text selection", async () => {
  const send = vi.fn<(_: string, body: string) => Promise<boolean>>().mockResolvedValue(true);
  function Files() {
    const root = useRef<HTMLDivElement>(null);
    return (
      <div className="openbot-react">
        <div ref={root}>
          <pre
            data-selection-file-quote="workspace-file:src/notes.txt"
            data-selection-file-lines="true"
          >
            <span>{"first line\n"}</span>
            <span>second passage</span>
            <span>{"\nthird line"}</span>
          </pre>
          <BotSelectionActions
            includeFiles
            root={root}
            disabled={false}
            onQuote={() => {}}
            onSend={send}
          />
        </div>
        <p data-selection-message-id="foreign-message">Unrelated conversation text</p>
      </div>
    );
  }
  await using screen = await render(<Files />);
  await screen.getByText("Unrelated conversation text").click({ clickCount: 3 });
  await expect.element(page.getByRole("toolbar")).not.toBeInTheDocument();
  await screen.getByText("second passage").click({ clickCount: 3 });
  await expect.element(page.getByRole("toolbar")).toBeVisible();
  await page.getByRole("button", { name: "Explain", exact: true }).click();
  expect(send).toHaveBeenCalledOnce();
  const [id, body] = send.mock.calls[0]!;
  expect(id).toBe("workspace-file:src/notes.txt#L2");
  expect(body).toContain("Explain this selected text.");
  expect(body).toMatch(/^@\[.+\]\(quote(?:\+uri)?:/u);
});
