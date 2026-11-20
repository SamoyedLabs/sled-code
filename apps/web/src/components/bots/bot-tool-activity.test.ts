import { expect, it } from "vite-plus/test";
import { botToolActivity, botTraceSpans } from "./bot-tool-activity";

it("shows actual provider tool spans without counting commentary or final answers as tool calls", () => {
  const terminal = {
    id: "exec-1611e045-000b-47d9-88b9-dc2747c1a08d",
    kind: "tool",
    command: "/bin/zsh -lc \"date -u '+%Y-%m-%dT%H:%M:%SZ'\"",
    endedAt: "2026-11-13T21:21:20.793Z",
  };
  const search = {
    id: "call_81a0c8d090934c01b44757f83e259580",
    kind: "tool",
    text: "Searching for current information…",
    endedAt: null,
  };
  expect(
    botToolActivity({
      steps: [
        { id: "commentary", kind: "reasoning" },
        terminal,
        search,
        { id: "answer", kind: "message" },
      ],
    }),
  ).toEqual([terminal, search]);
  expect(botToolActivity(undefined)).toEqual([]);
  expect(botToolActivity({ steps: [{ kind: "tool" }] })).toEqual([]);
});

it("retains reported failures/usage and uses native whole-message timing without counting the parent as a call", () => {
  const at = (seconds: number) => new Date(Date.UTC(2026, 10, 15, 12, 0, seconds)).toISOString();
  const spans = botTraceSpans({
    startedAt: at(0),
    endedAt: at(8),
    tokens: 0,
    costUsd: 0,
    steps: [
      { id: "think", kind: "reasoning", startedAt: at(2), endedAt: at(2) },
      {
        id: "handoff",
        kind: "tool",
        recipientAgentIds: ["writer"],
        startedAt: at(2),
        endedAt: at(4),
        failed: true,
      },
      { id: "answer", kind: "message", startedAt: at(8), endedAt: at(8) },
      { id: "unsupported", kind: "unknown", startedAt: at(9), endedAt: null },
    ],
  });
  expect(spans.map((span) => [span.id, span.kind, span.parentId])).toEqual([
    ["turn", "model", null],
    ["think", "model", "turn"],
    ["handoff", "handoff", "turn"],
    ["answer", "model", "turn"],
  ]);
  expect(spans[0]).toMatchObject({ tokens: 0, costUsd: 0 });
  expect(spans[1]).toMatchObject({ start: Date.parse(at(0)), end: Date.parse(at(2)) });
  expect(spans[2]).toMatchObject({ name: "Message to 1 bot", failed: true });
  expect(spans[3]).toMatchObject({ start: Date.parse(at(4)), end: Date.parse(at(8)) });
  expect(
    botTraceSpans({ steps: [{ id: "bad-time", kind: "tool", startedAt: "invalid" }] }),
  ).toEqual([]);
});

it("includes only stored subordinate work and clamps observed waits to their turn", () => {
  const at = (s: number) => new Date(Date.UTC(2026, 10, 15, 12, 0, s)).toISOString();
  const spans = botTraceSpans({
    startedAt: at(0),
    endedAt: at(10),
    steps: [
      { id: "thought", kind: "reasoning", startedAt: at(2), endedAt: at(2) },
      { id: "helper", kind: "tool", startedAt: at(2), endedAt: at(3) },
    ],
    thoughtTitles: { thought: "Inspect the source" },
    subagents: [
      {
        id: "helper",
        title: "Read notes",
        agentType: "research",
        status: "failed",
        startedAt: at(3),
        endedAt: at(8),
      },
    ],
    waits: [{ id: "reply:observed", startedAt: at(4), endedAt: at(12) }],
  });
  expect(spans.find((s) => s.id === "thought")).toMatchObject({
    name: "Inspect the source",
    icon: "thinking",
  });
  expect(spans.find((s) => s.id === "helper")).toMatchObject({
    name: "Start Read notes",
    kind: "handoff",
  });
  expect(spans.find((s) => s.id === "subagent:helper")).toMatchObject({
    parentId: "turn",
    name: "Read notes",
    kind: "model",
    failed: true,
  });
  expect(spans.find((s) => s.id === "reply:observed")).toMatchObject({
    kind: "waiting",
    start: Date.parse(at(4)),
    end: Date.parse(at(10)),
  });
});
