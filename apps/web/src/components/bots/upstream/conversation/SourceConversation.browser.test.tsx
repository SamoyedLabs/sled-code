/* oxlint-disable shadcn/no-unknown-classes -- Original source token and quote classes are scoped in the imported CSS. */
import { useRef } from "react";
import { EnvironmentId } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";
import { render } from "../../../../../test/render";
import { BotChatMarkdown } from "../../BotChatMarkdown";
import { BotFilePreview } from "../../BotFilePreview";
import { serializeBotReference } from "../../../settings/botComposerModel";
import { watchBotQuotedText } from "./quotedText";
import "~/index.css";
import "../openbot-react.css";
import "../../../settings/bot-conversation.css";

it("opens canonical quoted text from a chip while keeping code fences and ordinary links literal", async () => {
  const open = vi.fn();
  const quote = serializeBotReference("quote", "a\n[passage] 😀", "original)message");
  await using screen = await render(
    <div className="openbot-react">
      <BotChatMarkdown
        environmentId={EnvironmentId.make("quote")}
        hostId="host"
        agentId="agent"
        onOpenQuote={open}
        text={`${quote}\n\n\`\`\`text\n${quote}\n\`\`\`\n\n[ordinary](quote:original)`}
      />
    </div>,
  );
  await screen.getByRole("button", { name: "Show quoted text: a\n[passage] 😀" }).click();
  expect(open).toHaveBeenCalledExactlyOnceWith("original)message", "a\n[passage] 😀");
  expect(
    screen
      .getByRole("region", { name: "TEXT code block" })
      .element()
      .querySelector(".message-code-line-source")?.textContent,
  ).toBe(quote);
});

it("highlights source code in messages and file previews without changing the underlying text", async () => {
  const text = 'const answer = 42;\nconsole.log("hi");';
  const file = new Blob([text], { type: "text/plain" });
  await using screen = await render(
    <div className="openbot-react">
      <BotFilePreview
        name="answer.ts"
        mimeType="text/plain"
        sizeBytes={file.size}
        file={file}
        quoteTarget={{ source: "workspace", path: "answer.ts" }}
      />
      <BotChatMarkdown
        environmentId={EnvironmentId.make("quote")}
        hostId="host"
        agentId="agent"
        text={`\`\`\`typescript answer.ts\n${text}\n\`\`\``}
      />
    </div>,
  );
  await expect.element(screen.getByRole("region", { name: "TypeScript code block" })).toBeVisible();
  await vi.waitFor(() => {
    const keywords = screen.getByText("const", { exact: true }).elements();
    expect(keywords).toHaveLength(2);
    expect(keywords.every((node) => node.getAttribute("data-code-token") === "kwd")).toBe(true);
  });
});

it("re-marks a file quote after tokenizer replaces nodes and releases the highlight on Escape", async () => {
  let release: (() => void) | undefined;
  function Preview() {
    const root = useRef<HTMLDivElement>(null);
    return (
      <div ref={root}>
        <pre data-selection-file-lines="true" data-testid="file">
          {"same passage\nconst second = 2;\nsame passage"}
        </pre>
        <button
          onClick={() => {
            if (root.current)
              release = watchBotQuotedText(root.current, "pre", "same passage", {
                start: 3,
                end: 3,
              });
          }}
        >
          Show quote
        </button>
      </div>
    );
  }
  await using screen = await render(<Preview />);
  try {
    await screen.getByRole("button", { name: "Show quote" }).click();
    await vi.waitFor(() =>
      expect([...CSS.highlights.get("openbot-quote-target")!][0]?.startOffset).toBe(31),
    );
    const pre = screen.getByTestId("file").element();
    pre.replaceChildren(
      Object.assign(document.createElement("span"), {
        textContent: "same passage\nconst second = 2;\n",
      }),
      Object.assign(document.createElement("span"), { textContent: "same passage" }),
    );
    await vi.waitFor(() =>
      expect([...CSS.highlights.get("openbot-quote-target")!][0]?.startContainer).toBe(
        pre.lastChild?.firstChild,
      ),
    );
    await userEvent.keyboard("{Escape}");
    await vi.waitFor(() => expect(CSS.highlights.has("openbot-quote-target")).toBe(false));
  } finally {
    release?.();
  }
});
