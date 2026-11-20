import { expect, it } from "vite-plus/test";
import { validateBotWorkspaceSearch } from "./workspaceNavigation";
import { botHostSettingsSection } from "../settings/unifiedBotSettings";
it("retains exact host, environment and conversation targets without accepting arbitrary sections", () => {
  const target = validateBotWorkspaceSearch({
    machine: "remote",
    botHost: "host-a",
    botAgent: "agent-a",
    botPage: "chats",
    botVisit: "visit-a",
    botMessage: "message-a",
    botTask: "task-a",
    botRoutine: "routine-a",
  });
  expect(target).toMatchObject({
    machine: "remote",
    botHost: "host-a",
    botAgent: "agent-a",
    botPage: "chats",
    botVisit: "visit-a",
    botMessage: "message-a",
    botTask: "task-a",
    botRoutine: "routine-a",
  });
  expect(
    validateBotWorkspaceSearch({ botPage: "settings", botAgent: ["agent-a"], botHost: 12 }),
  ).toMatchObject({ botAgent: undefined, botHost: undefined });
  expect(validateBotWorkspaceSearch({ botPage: "settings" }).botPage).toBeUndefined();
});
it("resolves host and individual bot preferences inside the same Settings page", () => {
  expect(botHostSettingsSection("bot-host-providers")).toBe("providers");
  expect(botHostSettingsSection("bot-host-account")).toBe("account");
  expect(botHostSettingsSection("bot-agent-a1")).toBe("agents");
  expect(botHostSettingsSection("unknown")).toBe("general");
});
