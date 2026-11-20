import { Component, useLayoutEffect, type ReactNode } from "react";
import type { Editor } from "@tiptap/core";
import { EnvironmentId } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";
import { render } from "../../../test/render";
import { BotComposerEditor } from "./BotComposerEditor";

const lifecycle = vi.hoisted(() => ({ editor: null as Editor | null }));
vi.mock("@tiptap/react", async (original) => {
  const actual = await original<typeof import("@tiptap/react")>();
  return {
    ...actual,
    useEditor: (...args: Parameters<typeof actual.useEditor>) => {
      const editor = actual.useEditor(...args);
      lifecycle.editor = editor;
      return editor;
    },
  };
});
vi.mock("@effect/atom-react", () => ({ useAtomValue: () => false }));
vi.mock("../../state/openbot", () => ({
  openbot: {
    readFromHost: (input: unknown) => input,
    settingsRead: { permissionAtom: () => null },
    adminToHost: { permissionAtom: () => null },
  },
}));
vi.mock("../../state/query", () => ({
  useEnvironmentQuery: () => ({ data: [], isPending: false }),
}));
vi.mock("../../state/use-atom-command", () => ({ useAtomCommand: () => vi.fn() }));
class LifecycleBoundary extends Component<{ children: ReactNode }, { error: string | null }> {
  override state = { error: null };
  static getDerivedStateFromError(error: Error) {
    return { error: error.message };
  }
  override render() {
    return this.state.error ? (
      <output aria-label="Editor failure">{this.state.error}</output>
    ) : (
      this.props.children
    );
  }
}
function DetachView({ detach }: { detach: boolean }) {
  useLayoutEffect(() => {
    if (detach) lifecycle.editor?.unmount();
  }, [detach]);
  return null;
}
function Conversation({ detach = false }: { detach?: boolean }) {
  return (
    <LifecycleBoundary>
      <BotComposerEditor
        environmentId={EnvironmentId.make("composer-lifecycle")}
        hostId="host"
        agentId="agent"
        value={detach ? "Restored draft" : "Original draft"}
        onChange={vi.fn()}
        onSubmit={vi.fn()}
        disabled={detach}
        placeholder="Message the bot"
        attachments={[]}
      />
      <DetachView detach={detach} />
    </LifecycleBoundary>
  );
}
it("does not access a detached Tiptap view while conversation effects finish, and remounts the composer", async () => {
  await using screen = await render(<Conversation />);
  await expect
    .element(screen.getByRole("textbox", { name: "Message to bot" }))
    .toHaveTextContent("Original draft");
  await screen.rerender(<Conversation detach />);
  await expect
    .element(screen.getByRole("status", { name: "Editor failure" }))
    .not.toBeInTheDocument();
  await screen.rerender(<Conversation key="next-conversation" />);
  await expect
    .element(screen.getByRole("textbox", { name: "Message to bot" }))
    .toHaveTextContent("Original draft");
});

it("does not echo old editor text when a successful send clears the controlled draft", async () => {
  const change = vi.fn();
  const composer = (value: string, disabled = false) => (
    <BotComposerEditor
      environmentId={EnvironmentId.make("composer-clear")}
      hostId="host"
      agentId="agent"
      value={value}
      onChange={change}
      onSubmit={vi.fn()}
      disabled={disabled}
      placeholder="Message the bot"
      attachments={[]}
    />
  );
  await using screen = await render(composer("Already sent"));
  const input = screen.getByRole("textbox", { name: "Message to bot" });
  await expect.element(input).toHaveTextContent("Already sent");
  change.mockClear();
  await screen.rerender(composer("", true));
  await expect.element(input).toHaveTextContent("");
  expect(change).not.toHaveBeenCalled();
  await screen.rerender(composer(""));
  expect(change).not.toHaveBeenCalled();
  await input.click();
  await userEvent.type(input, "Next draft");
  expect(change).toHaveBeenLastCalledWith("Next draft");
});
