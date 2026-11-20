import { expect, it } from "vite-plus/test";
import { botMemoryRows, botSubagentRows } from "./bot-message-notes";

it("decodes an OpenBot background subagent without a provider type alongside typed workers", () => {
  const worker = {
    id: "worker-one",
    title: "Check the fixture",
    agentType: null,
    prompt: "Read one file",
    startedAt: "2026-11-20T18:00:00Z",
    endedAt: null,
    status: "running",
    steps: [{ id: "step-one", kind: "read", text: "fixture.txt" }],
    error: null,
    background: true,
  };
  const completed = {
    ...worker,
    id: "worker-two",
    agentType: "explorer",
    status: "completed",
    endedAt: "2026-11-20T18:01:00Z",
  };
  expect(botSubagentRows([worker, completed])).toEqual([worker, completed]);
});

it("keeps the previous value of an updated memory alongside forgotten memories", () => {
  const changes = [
    { memoryId: "updated", action: "updated", text: "New name", previousText: "Old name" },
    { memoryId: "forgotten", action: "forgotten", text: "Unused setting" },
  ];
  expect(botMemoryRows(changes)).toEqual(changes);
});
