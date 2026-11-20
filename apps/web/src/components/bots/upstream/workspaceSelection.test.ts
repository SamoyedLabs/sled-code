import { expect, it } from "vite-plus/test";
import { readWorkspaceBot, retainWorkspaceBot } from "./workspaceSelection";
it("retains exact host/agent identity separately for each environment and rejects corrupt storage", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
  retainWorkspaceBot("one", { hostId: "host-a", agentId: "agent" }, storage);
  retainWorkspaceBot("two", { hostId: "host-b", agentId: "agent" }, storage);
  expect(readWorkspaceBot("one", storage)).toEqual({ hostId: "host-a", agentId: "agent" });
  expect(readWorkspaceBot("two", storage)).toEqual({ hostId: "host-b", agentId: "agent" });
  values.set("sled:openbot:last-agent:v1:one", '{"hostId":5,"agentId":"other"}');
  expect(readWorkspaceBot("one", storage)).toBeNull();
  values.set("sled:openbot:last-agent:v1:one", "broken");
  expect(readWorkspaceBot("one", storage)).toBeNull();
});
