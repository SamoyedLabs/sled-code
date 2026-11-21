import { expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";
import * as Result from "effect/Result";
import {
  OpenbotSettingsReadRequest,
  OpenbotSettingsAdminRequest,
  PINNED_SETTINGS,
  settingsRequiredScopes,
} from "./openbotSettings.ts";
const decodeRead = Schema.decodeUnknownResult(OpenbotSettingsReadRequest);
const decodeAdmin = Schema.decodeUnknownResult(OpenbotSettingsAdminRequest);
it("keeps server notification writes out of the read transport and rejects custom methods", () => {
  const command = {
    operation: "settings.agent-notification-levels.server",
    parameters: { level: "nothing" },
  };
  expect(Result.isFailure(decodeRead(command))).toBe(true);
  expect(Result.isSuccess(decodeAdmin(command))).toBe(true);
  expect(
    Result.isFailure(
      decodeAdmin({
        operation: "settings.execute",
        parameters: { url: "http://private", method: "DELETE" },
      }),
    ),
  ).toBe(true);
});
it("pins exact session-setting request fields and enforces role revision and task-limit bounds", () => {
  expect(
    Result.isFailure(
      decodeAdmin({
        operation: "settings.agent-session-settings.set",
        parameters: { agentId: "a", settingId: "s", value: true, command: "secret" },
      }),
    ),
  ).toBe(true);
  expect(
    Result.isFailure(
      decodeAdmin({
        operation: "settings.agent-access.set",
        parameters: { everyone: {}, roles: [] },
      }),
    ),
  ).toBe(true);
  expect(
    Result.isFailure(
      decodeAdmin({
        operation: "settings.agent-task-limit.update",
        parameters: { agentId: "a", taskLimit: 5 },
      }),
    ),
  ).toBe(true);
  expect(
    Result.isSuccess(
      decodeAdmin({
        operation: "settings.agent-task-limit.update",
        parameters: { agentId: "a", taskLimit: null },
      }),
    ),
  ).toBe(true);
});
it("keeps all names bound to bounded frozen codecs and grants access and filesystem scopes only for those families", () => {
  expect(new Set(PINNED_SETTINGS.map((entry) => entry.operation)).size).toBe(
    PINNED_SETTINGS.length,
  );
  expect(
    PINNED_SETTINGS.every(
      (entry) =>
        typeof entry.codec?.request === "function" && typeof entry.codec?.response === "function",
    ),
  ).toBe(true);
  expect(settingsRequiredScopes("settings.agent-access.set", "admin")).toContain("access:write");
  expect(settingsRequiredScopes("settings.agent-access.set", "read")).toBeNull();
  expect(settingsRequiredScopes("settings.agent-folders.add", "admin")).toContain(
    "filesystem:write",
  );
  expect(settingsRequiredScopes("settings.storage.deleteFile", "admin")).toContain(
    "filesystem:write",
  );
  expect(settingsRequiredScopes("settings.storage.usage", "read")).toContain("filesystem:read");
  expect(settingsRequiredScopes("settings.execute", "admin")).toBeNull();
});

it("uses chat authority for only the released context controls", () => {
  expect(settingsRequiredScopes("settings.context-reset.clear", "admin")).toEqual([
    "orchestration:operate",
  ]);
  expect(settingsRequiredScopes("settings.context-compact.compact", "admin")).toEqual([
    "orchestration:operate",
  ]);
  expect(settingsRequiredScopes("settings.context-compact.compactTask", "admin")).toEqual([
    "orchestration:operate",
  ]);
  expect(settingsRequiredScopes("settings.agent-access.set", "admin")).toContain(
    "providers:manage",
  );
});

it("gives storage inventory read authority and keeps cleanup behind settings and file write", () => {
  expect(settingsRequiredScopes("settings.storage.usage", "read")).toEqual([
    "orchestration:read",
    "filesystem:read",
  ]);
  expect(settingsRequiredScopes("settings.storage.disk", "read")).toEqual([
    "orchestration:read",
    "filesystem:read",
  ]);
  for (const operation of ["settings.storage.clear", "settings.storage.deleteFile"]) {
    expect(settingsRequiredScopes(operation, "admin")).toEqual([
      "settings:write",
      "filesystem:write",
    ]);
    expect(settingsRequiredScopes(operation, "read")).toBeNull();
  }
});

it("lets a settings administrator browse public listings without provider administration", () => {
  for (const operation of [
    "settings.local-catalog.searchAgents",
    "settings.local-catalog.searchSkills",
    "settings.local-catalog.skill",
    "settings.local-catalog.skillBySlug",
  ]) {
    expect(settingsRequiredScopes(operation, "read")).toEqual(["settings:write"]);
    expect(settingsRequiredScopes(operation, "admin")).toBeNull();
  }
  expect(settingsRequiredScopes("settings.local-catalog.myAgents", "read")).toContain(
    "providers:manage",
  );
  expect(settingsRequiredScopes("settings.skills-admin.install", "admin")).toContain(
    "providers:manage",
  );
});

it("allows roster reads with orchestration read and preserves administrator authority for server-wide hides", () => {
  for (const operation of [
    "settings.sled-roster-pins.read",
    "settings.sidebar-folders.read",
    "settings.agent-hidden.read",
  ]) {
    expect(settingsRequiredScopes(operation, "read")).toEqual(["orchestration:read"]);
    expect(settingsRequiredScopes(operation, "admin")).toBeNull();
  }
  for (const operation of ["settings.sled-roster-pins.set", "settings.sidebar-folders.actions"]) {
    expect(settingsRequiredScopes(operation, "admin")).toEqual([
      "settings:write",
      "orchestration:operate",
    ]);
    expect(settingsRequiredScopes(operation, "read")).toBeNull();
  }
  expect(settingsRequiredScopes("settings.sidebar-pins.set", "admin")).toContain(
    "providers:manage",
  );
  expect(settingsRequiredScopes("settings.agent-hidden.set", "admin")).toContain(
    "providers:manage",
  );
});

it("pins agent default choices and background program operations to managed settings authority", () => {
  expect(
    Result.isSuccess(decodeRead({ operation: "settings.agent-defaults.settings", parameters: {} })),
  ).toBe(true);
  expect(
    Result.isSuccess(
      decodeAdmin({
        operation: "settings.agent-defaults.choice",
        parameters: { agentIds: ["bot-one"], setting: "allowNewChat", choice: "default" },
      }),
    ),
  ).toBe(true);
  expect(
    Result.isFailure(
      decodeAdmin({
        operation: "settings.agent-defaults.choice",
        parameters: { agentIds: ["bot-one"], setting: "computerUse", choice: "on" },
      }),
    ),
  ).toBe(true);
  expect(
    Result.isFailure(
      decodeAdmin({
        operation: "settings.background-processes.stop",
        parameters: { pid: 123, signal: "TERM" },
      }),
    ),
  ).toBe(true);
  expect(
    Result.isSuccess(
      decodeAdmin({
        operation: "settings.background-processes.stop",
        parameters: { id: "host-reported-process-id" },
      }),
    ),
  ).toBe(true);
  expect(settingsRequiredScopes("settings.background-processes.stop", "read")).toBeNull();
  expect(settingsRequiredScopes("settings.background-processes.stop", "admin")).toEqual([
    "settings:write",
    "providers:manage",
  ]);
});
