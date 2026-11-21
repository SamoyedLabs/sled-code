import { expect, it } from "vite-plus/test";
import { decodeAgentReport, decodeReport } from "./analytics";
import {
  accountUsageProviderRows,
  accountUsageRings,
  formatUsageResetIn,
} from "./account-usage-view";
import {
  pickerModels,
  groupPickerModels,
  isCustomModel,
  customProviderIds,
  providerAvailability,
} from "./provider-model-options";
import { spentUsageWindow } from "./plan-limits";
import { usageSeries } from "./usage-series";
import { readAccountUsage, type ClientAgentModelOption } from "./types";
const model = (provider: string, id: string, name = id): ClientAgentModelOption => ({
  provider,
  id,
  name,
  description: "",
  defaultReasoningEffort: "medium",
  supportedReasoningEfforts: ["low", "medium", "high"],
});
it("keeps provider identity when custom agent and endpoint model ids overlap, groups OpenCode variants and exposes older matches", () => {
  const options = [
    model("opencode", "goose/default", "Goose/Default"),
    model("acp", "goose/default", "Goose"),
    model("opencode", "anthropic/sonnet", "Anthropic/Sonnet"),
    model("opencode", "anthropic/sonnet/high", "Anthropic/Sonnet (high)"),
    { ...model("codex", "old", "Older model"), listing: "older" as const },
  ];
  const models = pickerModels(options);
  expect(models.filter((row) => row.id === "goose/default").map((row) => row.provider)).toEqual([
    "opencode",
    "acp",
  ]);
  expect(models.find((row) => row.id === "anthropic/sonnet")?.variants).toEqual([
    { id: "anthropic/sonnet", name: "Default" },
    { id: "anthropic/sonnet/high", name: "High" },
  ]);
  expect(groupPickerModels(models, "older")[0]?.models[0]?.listing).toBe("older");
  const custom = customProviderIds([{ id: "goose", harness: "pi" }]);
  expect(isCustomModel(options[0]!, custom)).toBe(false);
  expect(isCustomModel(model("pi", "goose/default"), custom)).toBe(true);
  expect(isCustomModel(options[1]!, custom)).toBe(true);
  expect(
    providerAvailability({ phase: "ready" }, [model("codex", "host-model")], "codex", (key) => key)
      .state,
  ).toBe("available");
});
it("keeps account identity, unsupported versus absent readings, groups and shared-quota ring ownership", () => {
  const window = { usedPercent: 75, windowDurationMins: 300, resetsAt: 1000 };
  const usage = readAccountUsage({
    limits: [
      { id: "grok", primary: window, secondary: null },
      {
        id: "cursor",
        primary: { ...window, usedPercent: 95 },
        secondary: null,
        sharedQuotaWith: "grok",
      },
      {
        id: "antigravity",
        primary: window,
        secondary: null,
        tertiary: { ...window, windowDurationMins: 43200 },
        groups: [
          { name: "Gemini Models", models: ["Gemini Flash"], primary: window, secondary: null },
          {
            name: "Claude Models",
            models: ["Claude"],
            primary: { ...window, usedPercent: 100 },
            secondary: null,
          },
        ],
      },
      {
        id: "codex",
        accountId: "a1111111111111111",
        primary: { ...window, usedPercent: 105 },
        secondary: null,
      },
    ],
  });
  const rows = accountUsageProviderRows(usage, [
    {
      id: "codex",
      state: "available",
      accounts: [
        {
          id: "default",
          label: null,
          email: "first@example.test",
          state: "connected",
          message: null,
        },
        { id: "a1111111111111111", label: "Work", email: null, state: "connected", message: null },
      ],
    },
    { id: "cline", state: "available" },
  ]);
  expect(rows.find((row) => row.provider === "codex" && row.accountId === null)).toMatchObject({
    name: "ChatGPT · first@example.test",
    remainingPercent: null,
    reportsUsage: true,
  });
  expect(rows.find((row) => row.accountId === "a1111111111111111")).toMatchObject({
    name: "ChatGPT · Work",
    remainingPercent: 0,
    tone: "critical",
  });
  expect(rows.find((row) => row.provider === "cline")?.reportsUsage).toBe(false);
  expect(
    rows.find((row) => row.provider === "antigravity")?.windows.map((row) => row.label),
  ).toEqual(["Gemini Models", "Claude Models"]);
  expect(rows.find((row) => row.provider === "antigravity")?.ringWindows).toHaveLength(1);
  const grok = accountUsageRings(rows).find((ring) => ring.row.provider === "grok");
  expect(grok?.shared[0]?.provider).toBe("cursor");
  expect(accountUsageRings(rows).some((ring) => ring.row.provider === "cursor")).toBe(false);
  expect(formatUsageResetIn(1000, 1000_000)).toBeNull();
});
it("limits only the selected account and matching model quota until the latest spent window resets", () => {
  const limits = [
    {
      id: "antigravity",
      accountId: "work",
      primary: null,
      secondary: null,
      groups: [
        {
          name: "Gemini",
          models: ["Gemini Flash"],
          primary: { usedPercent: 100, windowDurationMins: 300, resetsAt: 120 },
          secondary: { usedPercent: 100, windowDurationMins: 10080, resetsAt: 240 },
        },
        {
          name: "Lite",
          models: ["Gemini Flash Lite"],
          primary: { usedPercent: 20, windowDurationMins: 300, resetsAt: 120 },
          secondary: null,
        },
      ],
    },
  ];
  expect(spentUsageWindow(limits, "antigravity", "default", "gemini-3.8-flash", 0)).toBeNull();
  expect(
    spentUsageWindow(limits, "antigravity", "work", "gemini-3.8-flash", 0)?.window.resetsAt,
  ).toBe(240);
  expect(spentUsageWindow(limits, "antigravity", "work", "gemini-3.8-flash-lite", 0)).toBeNull();
  expect(spentUsageWindow(limits, "antigravity", "work", "gemini-3.8-flash", 240_000)).toBeNull();
});
it("preserves unpriced chart gaps and uses total tokens when the released provider split lacks cache reads", () => {
  const day = {
    date: "2026-11-01",
    uncachedInput: 40,
    cachedInput: 60,
    cacheCreation: 0,
    output: 0,
    processedTokens: 100,
    estimatedCostUsd: null,
    sessions: 1,
    userMessages: 1,
    assistantMessages: 1,
    turns: 1,
    missingUsageTurns: 0,
    unpricedRecords: 1,
    incompleteRecords: 0,
  };
  const cells = [
    { date: day.date, provider: "codex", processedTokens: 100, estimatedCostUsd: null },
  ];
  expect(usageSeries(cells, [day, { ...day, date: "2026-11-02" }], "cost")).toEqual({
    series: ["codex"],
    rows: [
      { date: day.date, codex: null },
      { date: "2026-11-02", codex: 0 },
    ],
  });
  expect(usageSeries(cells, [day], "tokens")).toEqual({
    series: ["total"],
    rows: [{ date: day.date, total: 40 }],
  });
});

it("decodes the per-agent report without requiring a workspace agent breakdown", () => {
  const totals = {
    uncachedInput: null,
    cachedInput: null,
    cacheCreation: null,
    output: null,
    processedTokens: 0,
    estimatedCostUsd: null,
    sessions: 0,
    userMessages: 0,
    assistantMessages: 0,
    turns: 0,
    missingUsageTurns: 0,
    unpricedRecords: 0,
    incompleteRecords: 0,
  };
  const workspace = {
    startDate: "2026-11-01",
    endDate: "2026-11-02",
    timeZone: "America/Chicago",
    collectionStartedAt: "2026-11-01T00:00:00Z",
    updatedAt: null,
    totals,
    daily: [],
    models: [],
  };
  const agent = { ...workspace, agentId: "agent-luna" };
  expect(decodeAgentReport(agent)).toMatchObject({ _tag: "Success", success: agent });
  expect(decodeAgentReport(workspace)._tag).toBe("Failure");
  expect(decodeReport(agent)._tag).toBe("Failure");
  expect(decodeReport({ ...workspace, agents: [] })._tag).toBe("Success");
});
