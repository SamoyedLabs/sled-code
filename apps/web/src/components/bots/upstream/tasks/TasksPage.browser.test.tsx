vi.mock("../../../../hooks/useSettings", () => ({
  useEnvironmentIdentificationMode: () => "none",
}));
import { createContext, type ReactNode } from "react";
import { EnvironmentId, type OpenbotDraftFile } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";
import { render, act } from "../../../../../test/render";
import { TasksPage } from "./TasksPage";
const f = vi.hoisted(() => ({
  principal: "original",
  connection: {},
  fail: false,
  text: vi.fn(),
  files: vi.fn(),
  move: vi.fn(),
  discard: vi.fn(),
  ready: (_draft: OpenbotDraftFile) => {},
}));
vi.mock("@effect/atom-react", () => ({
  RegistryContext: createContext({ refresh: () => {} }),
  useAtomValue: (value: { read?: unknown }) => (value?.read ? [] : true),
}));
vi.mock("../../../../state/session", () => ({ readPreparedConnection: () => f.connection }));
vi.mock("../../../../state/openbot", () => {
  const method = () => ({ permissionAtom: () => ({}) });
  return {
    openbot: {
      readFromHost: () => ({}),
      attention: () => ({}),
      fileDrafts: () => ({}),
      fileContext: method(),
      fileSendDraft: method(),
      writeToHost: method(),
      newTaskStart: "text",
    },
  };
});
vi.mock("../../../../state/query", () => ({
  useEnvironmentQuery: () => ({ data: [], error: null }),
  formatEnvironmentQueryError: () => "",
}));
vi.mock("../../../../state/use-atom-command", () => ({
  useAtomCommand: (method: unknown) => (method === "text" ? f.text : f.files),
}));
vi.mock("../../../../state/use-atom-query-runner", () => ({
  useAtomQueryRunner: () => async (query: { input: { request?: unknown } }) => ({
    _tag: "Success",
    value: query.input.request ? { tasks: [] } : { principalId: f.principal },
  }),
}));
vi.mock("../../../SidebarStageBackdrop", () => ({
  StageBackdropButtonArt: () => null,
  useSidebarStageBackdropVariant: () => null,
}));
vi.mock("../../../settings/BotDictation", () => ({
  BotDictation: ({ send }: { send: ReactNode }) => <>{send}</>,
  useBotDictation: () => ({}),
}));
vi.mock("../../avatar/BotAvatar", () => ({ BotAvatar: () => null }));
vi.mock("../../../settings/BotConversationPanel", () => ({ BotConversationPanel: () => null }));
vi.mock("../../SourceProviderEnvironment", () => ({ SourceModelPicker: () => null }));
vi.mock("./TasksEmpty", () => ({ TasksEmptyBoard: () => null }));
vi.mock("../../../settings/BotComposerEditor", () => ({
  BotComposerEditor: ({
    value,
    onChange,
    disabled,
  }: {
    value: string;
    onChange: (text: string) => void;
    disabled: boolean;
  }) => (
    <textarea
      aria-label="Task draft"
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
    />
  ),
}));
vi.mock("./useNewThreadAttachments", () => ({
  useNewThreadAttachments: (
    _env: unknown,
    _host: unknown,
    _agent: unknown,
    disabled: boolean,
    onReady: (draft: OpenbotDraftFile) => void,
  ) => {
    f.ready = onReady;
    return {
      available: !disabled,
      busy: false,
      error: null,
      add: vi.fn(),
      reassign: f.move,
      discardUnused: f.discard,
    };
  },
}));
const draft = (agentId = "a", id = "file-a"): OpenbotDraftFile =>
  ({
    agentId,
    attachment: { id, name: "original.txt", mimeType: "text/plain", size: 5 },
    state: "ready",
  }) as OpenbotDraftFile;
const view = () => (
  <TasksPage
    environmentId={EnvironmentId.make("global-task-proof")}
    hostId="host"
    agents={[
      { id: "a", name: "Alpha" },
      { id: "b", name: "Beta" },
    ]}
  />
);
const saved = () =>
  JSON.parse(
    sessionStorage.getItem('sled:openbot:global-task-start:["global-task-proof","host"]') ?? "null",
  );
function resetFixtures() {
  sessionStorage.clear();
  f.principal = "original";
  f.fail = false;
  f.text
    .mockReset()
    .mockImplementation(async () =>
      f.fail ? { _tag: "Failure" } : { _tag: "Success", value: { id: "task", agentId: "a" } },
    );
  f.files
    .mockReset()
    .mockImplementation(async () =>
      f.fail ? { _tag: "Failure" } : { _tag: "Success", value: { state: "sent", taskId: "task" } },
    );
  f.move.mockReset().mockResolvedValue([draft("b", "file-b")]);
  f.discard.mockReset().mockResolvedValue(undefined);
}

it("queues a file-only start, persists changed agent/files before releasing originals, and Undo restores the exact draft", async () => {
  resetFixtures();
  await using screen = await render(view());
  await act(() => f.ready(draft()));
  await screen.getByRole("button", { name: "Start task", exact: true }).click();
  expect(saved()).toMatchObject({ agentId: "a", fileIds: ["file-a"], phase: "queued" });
  expect(f.files).not.toHaveBeenCalled();
  const chooser = screen
    .getByRole("combobox", { name: "Pending task agent" })
    .element() as HTMLSelectElement;
  await act(() => {
    chooser.value = "b";
    chooser.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(saved()).toMatchObject({ agentId: "b", fileIds: ["file-b"] });
  expect(f.move).toHaveBeenCalledWith([draft()], "b");
  expect(f.discard).toHaveBeenCalledWith([draft()]);
  await screen.getByRole("button", { name: "Undo", exact: true }).click();
  expect(saved()).toBeNull();
  expect(f.files).not.toHaveBeenCalled();
  await expect
    .element(screen.getByRole("combobox", { name: "Task agent" }))
    .toHaveTextContent("Beta");
  await screen.getByRole("button", { name: "Start task", exact: true }).click();
  await screen.getByRole("button", { name: "Start now", exact: true }).click();
  expect(f.files).toHaveBeenCalledExactlyOnceWith({
    environmentId: "global-task-proof",
    input: {
      hostId: "host",
      agentId: "b",
      attachmentId: "file-b",
      attachmentIds: ["file-b"],
      text: "",
      target: { kind: "new-task" },
    },
  });
});
it("retains an uncertain original start across remount, refuses another principal, and checks the same request ID", async () => {
  resetFixtures();
  f.fail = true;
  await using first = await render(view());
  await first.getByRole("textbox", { name: "Task draft" }).fill("Original work");
  await first.getByRole("button", { name: "Start task", exact: true }).click();
  const original = saved();
  await first.getByRole("button", { name: "Start now", exact: true }).click();
  expect(saved().phase).toBe("attempted");
  await first.unmount();
  await using recovered = await render(view());
  await expect.element(recovered.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
  f.principal = "foreign";
  await recovered.getByRole("button", { name: "Check original start", exact: true }).click();
  expect(f.text).toHaveBeenCalledTimes(1);
  expect(saved().requestId).toBe(original.requestId);
  f.principal = "original";
  f.fail = false;
  await recovered.getByRole("button", { name: "Check original start", exact: true }).click();
  expect(f.text).toHaveBeenCalledTimes(2);
  expect(f.text.mock.calls[1]).toEqual(f.text.mock.calls[0]);
  expect(saved()).toBeNull();
});
it("does not claim Undo when durable storage refuses cancellation", async () => {
  resetFixtures();
  await using screen = await render(view());
  await screen.getByRole("textbox", { name: "Task draft" }).fill("Retain me");
  await screen.getByRole("button", { name: "Start task", exact: true }).click();
  const original = saved();
  const remove = vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
    throw Error("blocked");
  });
  try {
    await screen.getByRole("button", { name: "Undo", exact: true }).click();
    expect(saved()).toEqual(original);
    await expect
      .element(screen.getByRole("button", { name: "Start task", exact: true }))
      .toBeDisabled();
  } finally {
    remove.mockRestore();
  }
  await screen.getByRole("button", { name: "Undo", exact: true }).click();
  expect(saved()).toBeNull();
  expect(f.text).not.toHaveBeenCalled();
});
