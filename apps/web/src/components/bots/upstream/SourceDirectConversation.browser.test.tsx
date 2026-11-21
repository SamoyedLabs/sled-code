/* oxlint-disable shadcn/no-unknown-classes -- The source conversation is intentionally scoped by openbot-react. */
import { expect, it, vi } from "vite-plus/test";
import { render } from "../../../../test/render";
import { SourceDirectConversation } from "./SourceDirectConversation";
import "~/index.css";
import "./openbot-react.css";
it("keeps IME confirmation out of send and locks unconfirmed text while allowing the same attempt retry", async () => {
  const send = vi.fn(),
    text = vi.fn();
  const props = {
    member: {
      id: "other",
      username: "person",
      name: "Person",
      email: null,
      online: true,
      disabled: false,
    },
    selfId: "self",
    messages: [],
    readState: undefined,
    loading: false,
    error: null,
    hasOlder: false,
    busy: false,
    text: "Unconfirmed message",
    uncertain: false,
    canSend: true,
    onText: text,
    onSend: send,
    onOlder: vi.fn(),
    onMarkRead: vi.fn(),
    onRefresh: vi.fn(),
  };
  await using screen = await render(
    <div className="openbot-react">
      <SourceDirectConversation {...props} />
    </div>,
  );
  const editor = screen.getByRole("textbox", { name: "Message Person" });
  editor
    .element()
    .dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", isComposing: true, bubbles: true }),
    );
  expect(send).not.toHaveBeenCalled();
  editor.element().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  expect(send).toHaveBeenCalledOnce();
  await screen.rerender(
    <div className="openbot-react">
      <SourceDirectConversation {...props} uncertain />
    </div>,
  );
  await expect.element(editor).toBeDisabled();
  await screen.getByRole("button", { name: "Retry same message" }).click();
  expect(send).toHaveBeenCalledTimes(2);
  await screen.rerender(
    <div className="openbot-react">
      <SourceDirectConversation {...props} uncertain busy />
    </div>,
  );
  await expect.element(screen.getByRole("button", { name: "Retry same message" })).toBeDisabled();
});

it("keeps long direct histories bounded while preserving the latest original message", async () => {
  const messages = Array.from({ length: 300 }, (_, index) => ({
    id: `message-${index}`,
    threadId: "thread",
    senderMemberId: index % 2 ? "other" : "self",
    recipientMemberId: index % 2 ? "self" : "other",
    text: `Original message ${index}`,
    createdAt: "2026-11-10T12:00:00Z",
    sequence: index,
  }));
  const props = {
    member: {
      id: "other",
      username: "person",
      name: "Person",
      email: null,
      online: true,
      disabled: false,
    },
    selfId: "self",
    messages,
    readState: undefined,
    loading: false,
    error: null,
    hasOlder: false,
    busy: false,
    text: "",
    uncertain: false,
    canSend: true,
    onText: vi.fn(),
    onSend: vi.fn(),
    onOlder: vi.fn(),
    onMarkRead: vi.fn(),
    onRefresh: vi.fn(),
  };
  await using screen = await render(
    <div className="openbot-react" style={{ height: 600 }}>
      <SourceDirectConversation {...props} />
    </div>,
  );
  await screen.rerender(
    <div className="openbot-react" style={{ height: 600 }}>
      <SourceDirectConversation {...props} messages={[]} />
    </div>,
  );
  await screen.rerender(
    <div className="openbot-react" style={{ height: 600 }}>
      <SourceDirectConversation {...props} />
    </div>,
  );
  await vi.waitFor(() => {
    const rows = screen.getByRole("article").elements();
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThan(60);
  });
  await expect.element(screen.getByText("Original message 299", { exact: true })).toBeVisible();
  const log = screen.getByRole("log", { name: "Direct messages" }).element();
  expect(
    log.scrollTop,
    JSON.stringify({
      height: log.scrollHeight,
      viewport: log.clientHeight,
      total: log.querySelector(".virtual-chat-list")?.getAttribute("style"),
      rows: log.querySelectorAll("article").length,
    }),
  ).toBeGreaterThan(0);
});

it("opens the exact unloaded unread message before marking read and can return to latest", async () => {
  const open = vi.fn(),
    mark = vi.fn(),
    latest = vi.fn();
  const message = {
    id: "latest",
    threadId: "thread",
    senderMemberId: "other",
    recipientMemberId: "self",
    text: "Latest original message",
    createdAt: "2026-11-10T12:00:00Z",
    sequence: 20,
  };
  const props = {
    member: {
      id: "other",
      username: "person",
      name: "Person",
      email: null,
      online: true,
      disabled: false,
    },
    selfId: "self",
    messages: [message],
    readState: { unreadCount: 20, firstUnreadMessageId: "original-unread", throughSequence: 0 },
    loading: false,
    error: null,
    hasOlder: true,
    busy: false,
    text: "",
    uncertain: false,
    canSend: true,
    onText: vi.fn(),
    onSend: vi.fn(),
    onOlder: vi.fn(),
    onMarkRead: mark,
    onRefresh: vi.fn(),
    onOpenMessage: open,
    onLatest: latest,
  };
  await using screen = await render(
    <div className="openbot-react" style={{ height: 600 }}>
      <SourceDirectConversation {...props} />
    </div>,
  );
  await screen.getByRole("button", { name: "20 new messages" }).click();
  expect(open).toHaveBeenCalledExactlyOnceWith("original-unread");
  expect(mark).not.toHaveBeenCalled();
  await screen.rerender(
    <div className="openbot-react" style={{ height: 600 }}>
      <SourceDirectConversation
        {...props}
        anchored
        messages={[
          { ...message, id: "original-unread", sequence: 1, text: "The original unread message" },
          message,
        ]}
      />
    </div>,
  );
  await vi.waitFor(() => expect(mark).toHaveBeenCalledOnce());
  await screen.getByRole("button", { name: "Scroll to latest message" }).click();
  expect(latest).toHaveBeenCalledOnce();
});
