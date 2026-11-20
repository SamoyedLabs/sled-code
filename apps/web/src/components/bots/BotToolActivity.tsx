import type { DynamicToolUIPart } from "ai";
import { BotTurnSteps } from "./BotTurnSteps";
import { BotDeferredToolActivity, type BotTraceScope } from "./BotDeferredToolActivity";
import { botToolActivity, botTraceSpans } from "./bot-tool-activity";

const clockOffset = Date.now() - performance.now();
function time(value: string | null | undefined) {
  const parsed = value ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) ? parsed - clockOffset : undefined;
}
export function BotToolActivity({
  trace,
  streaming = false,
  initialOpen = false,
  deferred,
}: {
  trace: unknown;
  streaming?: boolean;
  initialOpen?: boolean;
  deferred?: BotTraceScope | undefined;
}) {
  if (deferred && (!trace || deferred.channelId))
    return <BotDeferredToolActivity key={JSON.stringify(deferred)} scope={deferred} />;
  const steps = botToolActivity(trace);
  const spans = botTraceSpans(trace, streaming);
  if (!steps.length && !spans.some((span) => span.icon === "thinking")) return null;
  const tools: DynamicToolUIPart[] = steps.map((step) => ({
    type: "dynamic-tool",
    toolName: step.command ? "terminal_command" : "tool",
    toolCallId: step.id,
    title: step.command ? "Terminal command" : step.text || "Tool call",
    ...(step.failed
      ? {
          state: "output-error" as const,
          input: step.command ? { command: step.command } : {},
          errorText: "The provider reported this step as failed or declined.",
        }
      : step.endedAt || !streaming
        ? {
            state: "output-available" as const,
            input: step.command ? { command: step.command } : {},
            output: { summary: step.text ?? "", outcome: "Not reported" },
          }
        : {
            state: "input-available" as const,
            input: step.command ? { command: step.command } : {},
          }),
  }));
  const starts = steps.flatMap((step) => {
    const t = time(step.startedAt);
    return t === undefined ? [] : [t];
  });
  const ends = steps.flatMap((step) => {
    const t = time(step.endedAt);
    return t === undefined ? [] : [t];
  });
  const metadata = {
    ...(spans[0]
      ? { startedAt: spans[0].start - clockOffset }
      : starts.length
        ? { startedAt: Math.min(...starts) }
        : {}),
    ...(spans[0]?.end != null
      ? { endedAt: spans[0].end - clockOffset }
      : ends.length === steps.length && ends.length
        ? { endedAt: Math.max(...ends) }
        : {}),
    toolTimings: Object.fromEntries(
      steps.flatMap((step) => {
        const start = time(step.startedAt),
          end = time(step.endedAt);
        return start === undefined
          ? []
          : [[step.id, { start, ...(end === undefined ? {} : { end }) }]];
      }),
    ),
  };
  return (
    <BotTurnSteps
      traceSpans={spans}
      initialTraceOpen={initialOpen}
      showToolDetails
      tools={tools}
      live={streaming}
      compact
      showAvatar={false}
      metadata={metadata}
    />
  );
}
