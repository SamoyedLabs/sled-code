import { expect, it } from "vite-plus/test";
import {
  invalidateSettingGroup,
  settingsAdvanced,
  settingRequest,
  settingRecord,
} from "./settings.ts";
it("keeps role changes bound to the loaded revision and preserves unrelated roles", () => {
  const roles = [
    { id: "school", name: "School", memberIds: ["student"], agents: { homework: "chat" } },
    { id: "coding", name: "Coding", memberIds: ["developer"], agents: { coding: "manage" } },
  ];
  const sections = settingsAdvanced(
    "homework",
    ["agent-access-v1"],
    { "settings.agent-access.read": { revision: 7, mine: {}, everyone: {}, roles } },
    {},
  );
  const grant = sections
    .flatMap((section) => section.controls)
    .find((control) => control.id === "everyone:view")?.request;
  expect(grant?.parameters).toEqual({ revision: 7, everyone: { homework: "view" }, roles });
  expect(settingRequest("settings.agent-access.set", { everyone: {}, roles: [] })).toBeNull();
});
it("does not copy another Discord workspace's role grant into a newly selected workspace", () => {
  const values = {
    "settings.discord-access.access": { allowedRoles: [{ id: "private", name: "Private" }] },
    "parameters:settings.discord-access.access": { workspaceId: "original" },
    "settings.discord-access.roles": { roles: [{ id: "public", name: "Public" }] },
    "parameters:settings.discord-access.roles": { workspaceId: "new" },
  };
  const controls = settingsAdvanced(undefined, ["discord-access-v1"], values, {
    discordWorkspace: "new",
  }).flatMap((section) => section.controls);
  expect(
    controls.filter((control) => control.request?.operation === "settings.discord-access.update"),
  ).toHaveLength(0);
});
it("pins a memory inclusion change to its revision and bounds rendered memory controls", () => {
  const selections = Array.from({ length: 256 }, (_, index) => ({
    memoryId: `memory-${index}`,
    inclusion: "searchable",
    userControlled: false,
    revision: 9,
  }));
  const controls = settingsAdvanced(
    "school",
    ["agent-memories-v1"],
    {
      "settings.agent-memories.selection": {
        agentId: "school",
        selections,
        usedBytes: 10,
        budgetBytes: 100,
        nextCursor: null,
      },
    },
    {},
  ).flatMap((section) => section.controls);
  expect(
    controls.filter(
      (control) => control.request?.operation === "settings.agent-memories.inclusion",
    ),
  ).toHaveLength(75);
  expect(
    controls.find((control) => control.id === "memory-0:essential")?.request?.parameters,
  ).toEqual({
    agentId: "school",
    changes: [{ memoryId: "memory-0", inclusion: "essential", expectedRevision: 9 }],
  });
  expect(controls.some((control) => control.id === "next-entries")).toBe(true);
});
it("requires a pin snapshot and preserves other chats when pinning", () => {
  expect(
    settingsAdvanced("school", ["sidebar-pins-v1"], {}, {})
      .flatMap((s) => s.controls)
      .some((c) => c.id === "pin"),
  ).toBe(false);
  const controls = settingsAdvanced(
    "school",
    ["sidebar-pins-v1"],
    { "settings.sidebar-pins.read": { items: [{ kind: "channel", id: "team" }], updatedAt: null } },
    {},
  ).flatMap((s) => s.controls);
  expect(controls.find((c) => c.id === "pin")?.request?.parameters).toEqual({
    items: [
      { kind: "channel", id: "team" },
      { kind: "agent", id: "school" },
    ],
  });
});
it("does not use another agent's memory revisions", () => {
  const controls = settingsAdvanced(
    "school",
    ["agent-memories-v1"],
    {
      "settings.agent-memories.selection": {
        agentId: "private",
        selections: [{ memoryId: "memory", revision: 1, inclusion: "essential" }],
      },
    },
    {},
  ).flatMap((s) => s.controls);
  expect(controls.some((c) => c.request?.operation === "settings.agent-memories.inclusion")).toBe(
    false,
  );
});
it("installs only a reviewed skill version and preserves modified content by default", () => {
  const values = {
    "settings.local-catalog.skill": {
      id: "skill",
      versionId: "version-7",
      name: "Skill",
      instructions: "Read these",
    },
    "settings.skills-admin.list": [
      {
        skillId: "skill",
        name: "Skill",
        enabled: true,
        state: "modified",
        installedVersion: 6,
        availableVersion: 7,
      },
    ],
    "parameters:settings.skills-admin.list": { agentId: "school" },
  };
  const controls = settingsAdvanced("school", ["skills-admin-v1"], values, {}).flatMap(
    (s) => s.controls,
  );
  expect(controls.find((c) => c.id === "install-reviewed")?.request?.parameters).toEqual({
    agentId: "school",
    skillId: "skill",
    versionId: "version-7",
  });
  expect(controls.find((c) => c.id === "remove:skill")?.request?.parameters).toEqual({
    agentId: "school",
    skillId: "skill",
  });
  expect(controls.find((c) => c.id === "toggle:skill")?.request?.parameters).toEqual({
    agentId: "school",
    skillId: "skill",
    enabled: false,
  });
});

it("invalidates read and mutation snapshots before an uncertain write without losing another group", () => {
  expect(
    invalidateSettingGroup(
      {
        "settings.agent-memories.selection": { revision: 2 },
        "parameters:settings.agent-memories.selection": { agentId: "school" },
        "latest:agent-memories": {},
        "latest-parameters:agent-memories": {},
        "settings.sidebar-pins.read": { items: [] },
      },
      "settings.agent-memories.inclusion",
    ),
  ).toEqual({ "settings.sidebar-pins.read": { items: [] } });
});
it("binds result destinations to the read routine and preserves the stop-delivery lifecycle", () => {
  const values = {
    "parameters:settings.routine-results.destination": { agentId: "school", routineId: "daily" },
    "settings.routine-results.destination": { destination: null },
    "settings.routine-results.options": {
      connections: [
        {
          connectionId: "slack",
          connectionName: "School",
          places: [{ id: "room", name: "Room" }],
          placesFailed: false,
        },
      ],
    },
  };
  const controls = settingsAdvanced("school", ["routine-results-v1"], values, {
    resultRoutine: "daily",
  }).flatMap((s) => s.controls);
  expect(controls.find((c) => c.id === "slack:room")?.request?.parameters).toEqual({
    agentId: "school",
    routineId: "daily",
    destination: { connectionId: "slack", placeId: "room", placeName: "Room" },
  });
  expect(controls.find((c) => c.id === "off")?.request?.parameters).toEqual({
    agentId: "school",
    routineId: "daily",
    destination: null,
  });
  expect(
    settingsAdvanced("school", ["routine-results-v1"], values, { resultRoutine: "other" })
      .flatMap((s) => s.controls)
      .some((c) => c.request?.operation === "settings.routine-results.setDestination"),
  ).toBe(false);
});
it("binds GitHub trigger actions and side answers to the read identity and never invents folder actions", () => {
  const values = {
    "settings.workflows-github.history": {
      deliveries: [
        {
          id: "older",
          nodeId: "trigger",
          event: "opened",
          outcome: "skipped",
          reason: null,
          item: null,
          receivedAt: "2026-11-03T00:00:00Z",
        },
        {
          id: "delivery",
          receivedAt: "2026-11-04T00:00:00Z",
          nodeId: "trigger",
          event: "opened",
          outcome: "skipped",
          reason: null,
          item: null,
        },
      ],
      runs: [],
    },
    "parameters:settings.workflows-github.history": { workflowId: "first" },
    "settings.side-question.ask": { answer: "Private answer" },
    "parameters:settings.side-question.ask": { agentId: "first" },
  };
  const stale = settingsAdvanced("second", ["workflows-github-v1", "side-question-v1"], values, {
    githubWorkflow: "second",
  });
  expect(JSON.stringify(stale)).not.toContain("Private answer");
  expect(
    stale
      .flatMap((s) => s.controls)
      .some((c) => c.request?.operation === "settings.workflows-github.runLastEvent"),
  ).toBe(false);
  const current = settingsAdvanced("first", ["workflows-github-v1", "side-question-v1"], values, {
    githubWorkflow: "first",
  });
  expect(
    current
      .flatMap((s) => s.controls)
      .filter((c) => c.request?.operation === "settings.workflows-github.runLastEvent"),
  ).toHaveLength(1);
  expect(
    current
      .flatMap((s) => s.controls)
      .find((c) => c.request?.operation === "settings.workflows-github.runLastEvent")?.request
      ?.parameters,
  ).toEqual({ workflowId: "first", nodeId: "trigger", requestId: "sled:delivery" });
  expect(
    settingRequest("settings.sidebar-folders.actions", { type: "arbitrary", path: "/tmp" }),
  ).toBeNull();
});

it("keeps side-question follow-ups bounded and scoped to their agent", () => {
  const values = {
    "settings.side-question.ask": { answer: "x".repeat(40000) },
    "parameters:settings.side-question.ask": {
      agentId: "a",
      question: "previous",
      earlier: Array.from({ length: 20 }, () => ({ question: "q", answer: "a" })),
    },
  };
  const request = settingsAdvanced("a", ["side-question-v1"], values, { sideQuestion: "follow up" })
    .flatMap((s) => s.controls)
    .find((c) => c.id === "followup")?.request;
  const params = settingRecord(request?.parameters);
  expect(params).toMatchObject({ agentId: "a", question: "follow up" });
  const earlier = params.earlier;
  if (!Array.isArray(earlier)) throw new Error("Missing follow-up");
  expect(earlier).toHaveLength(20);
  expect(earlier.at(-1)).toEqual({ question: "previous", answer: "x".repeat(32000) });
  expect(
    settingsAdvanced("b", ["side-question-v1"], values, { sideQuestion: "follow up" })
      .flatMap((s) => s.controls)
      .some((c) => c.id === "followup"),
  ).toBe(false);
});
it("only exposes storage delete for a deletable file in the reviewed agent scan", () => {
  const values = {
    "settings.storage.usage": {
      scope: "agent",
      agentId: "a",
      files: [
        { id: "file", name: "notes", status: "available", deletable: true, size: 1 },
        { id: "missing", name: "gone", status: "missing", deletable: true, size: 0 },
      ],
    },
  };
  const actions = (id: string) =>
    settingsAdvanced(id, ["storage-v1"], values, {})
      .flatMap((s) => s.controls)
      .filter((c) => c.request?.operation === "settings.storage.deleteFile");
  expect(actions("b")).toEqual([]);
  expect(actions("a").map((c) => c.request?.parameters)).toEqual([{ fileId: "file" }]);
  expect(actions("a")[0]?.confirm).toBe(true);
});
