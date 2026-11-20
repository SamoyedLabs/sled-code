import { expect, it } from "vite-plus/test";
import { createWorkspaceTaskRefresh } from "./task-refresh";

it("updates a task list already opened by the global Tasks page while another bot is selected", async () => {
  const emitted: Array<{ agentId: string; tasks: string[] }> = [];
  const refresh = createWorkspaceTaskRefresh({
    list: async (agentId: string) => ({ agentId, tasks: ["new task from another client"] }),
    read: async () => [],
    listChanged: (_host, snapshot) => emitted.push(snapshot),
    conversationChanged: () => {},
  });
  refresh.observeList("other-bot");
  refresh.observeList("selected-bot");
  await refresh.refresh("owned-host", "selected-bot", () => true);
  expect(emitted).toEqual([
    { agentId: "other-bot", tasks: ["new task from another client"] },
    { agentId: "selected-bot", tasks: ["new task from another client"] },
  ]);
});

it("discards an old host's pending task read even if the same host is selected again", async () => {
  let resolve!: (value: string[]) => void;
  const pending = new Promise<string[]>((done) => { resolve = done; });
  const emitted: string[][] = [];
  const refresh = createWorkspaceTaskRefresh({
    list: () => pending,
    read: async () => [],
    listChanged: (_host, snapshot) => emitted.push(snapshot),
    conversationChanged: () => {},
  });
  const reading = refresh.refresh("owned-host", "selected-bot", () => true);
  refresh.clear();
  resolve(["obsolete result"]);
  await reading;
  expect(emitted).toEqual([]);
});
