import { decodeOpenbotTrace as trace } from "@t3tools/client-runtime/openbot/rich-conversation";

export function botToolActivity(value: unknown) {
  const decoded = trace(value);
  return decoded._tag === "Some" ? decoded.value.steps.filter((step) => step.kind === "tool") : [];
}

export type BotTraceSpan = {
  id: string;
  parentId: string | null;
  name: string;
  detail?: string;
  icon?: "thinking" | "agent" | "text" | "command";
  kind: "model" | "tool" | "waiting" | "handoff";
  start: number;
  end: number | null;
  failed?: boolean;
  tokens?: number;
  costUsd?: number;
};

/** OpenBot storedSpans timing semantics: one turn, then reasoning, tools/handoffs and answers. */
export function botTraceSpans(value: unknown, streaming = false): BotTraceSpan[] {
  const decoded = trace(value);
  if (decoded._tag === "None") return [];
  const data = decoded.value;
  const timed = data.steps.flatMap((step) => {
    if (!["reasoning", "tool", "message"].includes(step.kind)) return [];
    const start = Date.parse(step.startedAt ?? "");
    return Number.isFinite(start) ? [{ step, start }] : [];
  });
  if (!timed.length) return [];
  const parsedStart = Date.parse(data.startedAt ?? ""),
    parsedEnd = Date.parse(data.endedAt ?? "");
  const baseStart = Number.isFinite(parsedStart)
    ? parsedStart
    : Math.min(...timed.map((s) => s.start));
  const subStarts = (data.subagents ?? [])
    .map((sub) => Date.parse(sub.startedAt))
    .filter(Number.isFinite);
  const start = Math.min(baseStart, ...subStarts);
  const latest = Math.max(
    start,
    ...timed.map(({ step, start }) => {
      const end = Date.parse(step.endedAt ?? "");
      return Number.isFinite(end) ? Math.max(start, end) : start;
    }),
  );
  const subEnds = (data.subagents ?? [])
    .map((sub) => Date.parse(sub.endedAt ?? ""))
    .filter(Number.isFinite);
  const end = Number.isFinite(parsedEnd)
    ? Math.max(start, parsedEnd, ...subEnds)
    : streaming
      ? null
      : Math.max(latest, ...subEnds);
  const spans: BotTraceSpan[] = [
    {
      id: "turn",
      parentId: null,
      name: "Bot turn",
      icon: "agent",
      kind: "model",
      start,
      end,
      ...(data.tokens === undefined ? {} : { tokens: data.tokens }),
      ...(typeof data.costUsd === "number" ? { costUsd: data.costUsd } : {}),
    },
  ];
  let previousEnd = start;
  for (const { step, start: at } of timed) {
    const parsed = Date.parse(step.endedAt ?? "");
    const until = Number.isFinite(parsed) ? Math.max(at, parsed) : end;
    const from = step.kind !== "tool" && until === at ? Math.min(previousEnd, at) : at;
    previousEnd = Math.max(previousEnd, until ?? at);
    const detail = step.command || step.text;
    const subagent = data.subagents?.find((sub) => sub.id === step.id);
    const handoff =
      step.kind === "tool" && (Boolean(step.recipientAgentIds?.length) || Boolean(subagent));
    spans.push({
      id: step.id,
      parentId: "turn",
      name: handoff
        ? step.recipientAgentIds?.length
          ? `Message to ${step.recipientAgentIds.length} ${step.recipientAgentIds.length === 1 ? "bot" : "bots"}`
          : `Start ${subagent!.title}`
        : step.kind === "tool"
          ? step.command?.trim().split("\n", 1)[0] || step.text || "Tool call"
          : step.kind === "reasoning"
            ? data.thoughtTitles?.[step.id] || "Thinking"
            : "Answer",
      ...(detail ? { detail } : {}),
      ...(step.kind === "reasoning"
        ? { icon: "thinking" as const }
        : step.kind === "message"
          ? { icon: "text" as const }
          : step.command
            ? { icon: "command" as const }
            : {}),
      kind: handoff ? "handoff" : step.kind === "tool" ? "tool" : "model",
      start: from,
      end: until,
      ...(step.failed ? { failed: true } : {}),
    });
  }
  for (const sub of data.subagents ?? []) {
    const at = Date.parse(sub.startedAt),
      finished = Date.parse(sub.endedAt ?? "");
    if (!Number.isFinite(at)) continue;
    spans.push({
      id: `subagent:${sub.id}`,
      parentId: "turn",
      name: sub.title,
      icon: "agent",
      kind: "model",
      start: at,
      end: Number.isFinite(finished)
        ? Math.max(at, finished)
        : end === null
          ? null
          : Math.max(at, end),
      ...(sub.agentType ? { detail: sub.agentType } : {}),
      ...(sub.status === "failed" ? { failed: true } : {}),
    });
  }
  for (const wait of data.waits ?? []) {
    const asked = Date.parse(wait.startedAt),
      answered = Date.parse(wait.endedAt);
    if (!Number.isFinite(asked) || !Number.isFinite(answered)) continue;
    spans.push({
      id: wait.id,
      parentId: "turn",
      name: "Bot reply",
      detail: "Reply",
      kind: "waiting",
      start: Math.min(asked, answered, end ?? answered),
      end: Math.min(answered, end ?? answered),
    });
  }
  return spans;
}
