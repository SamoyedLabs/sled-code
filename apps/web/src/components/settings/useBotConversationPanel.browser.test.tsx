import { useState } from "react";
import { EnvironmentId } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";
import { render } from "../../../test/render";
import { useBotConversationPanel } from "./useBotConversationPanel";

const fixture = vi.hoisted(() => ({ revision: 1, newest: 1499, connection: {} }));
type Query = {
  kind?: string;
  input?: { request?: { operation: string; anchor?: { type: string; cursor?: string } } };
};
function historyPage(before = fixture.newest + 1) {
  const first = Math.max(0, before - 50);
  return {
    agentId: "agent",
    threadId: "thread",
    activeTurnId: null,
    revision: fixture.revision,
    messages: Array.from({ length: before - first }, (_, offset) => ({
      id: `message-${first + offset}`,
      author: "assistant",
      text: `Original message ${first + offset}`,
      status: "completed",
      createdAt: new Date(1700000000000 + (first + offset) * 1000).toISOString(),
    })),
    references: {},
    pageInfo: { hasOlder: first > 0, olderCursor: first > 0 ? String(first) : null },
  };
}
vi.mock("@effect/atom-react", () => ({ useAtomValue: () => true }));
vi.mock("../../state/session", () => ({ readPreparedConnection: () => fixture.connection }));
vi.mock("../../state/openbot", () => ({
  openbot: {
    fileDrafts: () => ({ kind: "drafts" }),
    readFromHost: (query: Query) => query,
    fileSendDraft: { permissionAtom: () => null },
    writeToHost: { permissionAtom: () => null },
  },
}));
vi.mock("../../state/query", () => ({
  useEnvironmentQuery: (query: Query) => ({
    data:
      query.kind === "drafts"
        ? []
        : query.input?.request?.operation === "conversation.page"
          ? historyPage()
          : null,
    isPending: false,
    error: null,
    refresh: () => {},
  }),
}));
vi.mock("../../state/use-atom-command", () => ({
  useAtomCommand: () => async () => ({ _tag: "Success", value: null }),
}));
vi.mock("../../state/use-atom-query-runner", () => ({
  useAtomQueryRunner: () => async (query: Query) => ({
    _tag: "Success",
    value: historyPage(
      query.input?.request?.anchor?.type === "before"
        ? Number(query.input.request.anchor.cursor)
        : undefined,
    ),
  }),
}));
function HistoryController({ taskId = null }: { taskId?: string | null }) {
  const [, update] = useState(0);
  const c = useBotConversationPanel(
    EnvironmentId.make("history-proof"),
    "host",
    "agent",
    taskId,
    () => "unused",
  );
  return (
    <>
      <button onClick={() => void c.older()}>Older</button>
      <button onClick={() => void c.showLatest()}>Latest</button>
      <button
        onClick={() => {
          fixture.revision++;
          fixture.newest++;
          update((value) => value + 1);
        }}
      >
        Append
      </button>
      <output aria-label="Window">
        {JSON.stringify({
          first: c.messages[0]?.id,
          last: c.messages.at(-1)?.id,
          count: c.messages.length,
          older: c.hasOlder,
          newer: c.hasNewer,
        })}
      </output>
    </>
  );
}
it.each([null, "task-history"])(
  "reads beyond 500 messages and retains anchored history for scope %s",
  async (taskId) => {
    fixture.revision = 1;
    fixture.newest = 1499;
    await using screen = await render(<HistoryController taskId={taskId} />);
    const state = () =>
      JSON.parse(screen.getByRole("status", { name: "Window" }).element().textContent ?? "{}");
    for (let index = 0; index < 20; index++) {
      await screen.getByRole("button", { name: "Older", exact: true }).click();
      expect(state().first).toBe(`message-${1400 - index * 50}`);
      expect(state().count).toBeLessThanOrEqual(500);
    }
    const beforeArrival = state();
    await screen.getByRole("button", { name: "Append", exact: true }).click();
    expect(state()).toEqual(beforeArrival);
    await screen.getByRole("button", { name: "Latest", exact: true }).click();
    expect(state().last).toBe("message-1500");
    expect(state().newer).toBe(false);
    await screen.getByRole("button", { name: "Append", exact: true }).click();
    expect(state().last).toBe("message-1501");
  },
);
