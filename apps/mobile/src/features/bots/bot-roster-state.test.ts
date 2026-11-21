import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import { botRosterState, botRosterWaits, resolveRosterEnvironment } from "./bot-roster-state";

describe("Bots home connection states", () => {
  it("projects the highest priority wait independently for each bot", () => {
    expect(
      botRosterWaits([
        { agentId: "one", kind: "prompt" },
        { agentId: "two", kind: "approval" },
        { agentId: "one", kind: "approval" },
        { agentId: "two", kind: "takeover" },
      ]),
    ).toEqual(
      new Map([
        ["one", "prompt"],
        ["two", "takeover"],
      ]),
    );
  });

  it("keeps a selected computer through reconnects instead of switching to an online one", () => {
    const primary = {
      environmentId: EnvironmentId.make("primary"),
      connection: { phase: "reconnecting" },
    } as const;
    const online = {
      environmentId: EnvironmentId.make("secondary"),
      connection: { phase: "connected" },
    } as const;
    const computers = [primary, online];
    expect(resolveRosterEnvironment(computers, primary.environmentId)).toBe(primary);
    expect(resolveRosterEnvironment(computers, null)).toBe(online);
    expect(resolveRosterEnvironment([primary], null)).toBe(primary);
    expect(resolveRosterEnvironment([], primary.environmentId)).toBeUndefined();
  });

  it("keeps startup, a disconnected computer, and disabled Bot hosting distinct", () => {
    const ready = { state: "ready", hostId: "bots" } as const;
    const base = {
      catalogReady: true,
      connection: "connected",
      host: ready,
      hostError: false,
    } as const;
    expect(botRosterState(base)).toBe("ready");
    expect(botRosterState({ ...base, catalogReady: false, connection: undefined })).toBe("loading");
    expect(botRosterState({ ...base, connection: undefined })).toBe("empty");
    expect(botRosterState({ ...base, connection: "connecting" })).toBe("loading");
    expect(botRosterState({ ...base, connection: "reconnecting" })).toBe("waiting");
    expect(botRosterState({ ...base, connection: "offline" })).toBe("waiting");
    expect(botRosterState({ ...base, host: { state: "disabled" } })).toBe("disabled");
    expect(botRosterState({ ...base, host: { state: "ready" } })).toBe("failed");
    expect(botRosterState({ ...base, host: null })).toBe("loading");
    expect(botRosterState({ ...base, host: null, hostError: true })).toBe("failed");
  });
});
