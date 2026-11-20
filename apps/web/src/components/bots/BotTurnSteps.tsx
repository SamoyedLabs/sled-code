import { BotTraceWaterfall } from "./BotTraceWaterfall";
import type { BotTraceSpan } from "./bot-tool-activity";
// Tool spans retain the same disclosure in live conversations and the isolated preview.
import { useEffect, useId, useRef, useState } from "react";
import { getToolName, type DynamicToolUIPart, type ToolUIPart } from "ai";
import { ChevronDownIcon, ChevronRightIcon, PuzzleIcon, SearchIcon } from "lucide-react";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import { Dialog, DialogPopup, DialogTitle, DialogDescription } from "../ui/dialog";
import { Input } from "../ui/input";
import { BotAvatar } from "./avatar/BotAvatar";
type TraceMetadata = {
  startedAt?: number;
  endedAt?: number;
  toolTimings?: Record<string, { start: number; end?: number }>;
};

type Tool = ToolUIPart | DynamicToolUIPart;
type Agent = { name: string; seed: string; hue: number | null };
const title = (tool: Tool) => tool.title ?? getToolName(tool).replaceAll("_", " ");
const failed = (tool: Tool) => tool.state === "output-error" || tool.state === "output-denied";
const pending = (tool: Tool) => !tool.state.startsWith("output-");
const seconds = (ms: number) => `${Math.max(0, ms / 1000).toFixed(1)}s`;
function progress(tool: Tool) {
  if (failed(tool))
    return tool.state === "output-error" ? tool.errorText : `${title(tool)} was denied.`;
  const name = getToolName(tool);
  if (name === "search_product_notes")
    return pending(tool) ? "Searching product notes…" : "Found the product notes.";
  if (name === "read_launch_brief")
    return pending(tool) ? "Reading the launch brief…" : "Read the launch brief.";
  return title(tool);
}

export function BotTurnSteps({
  tools,
  traceSpans,
  live = false,
  stopped = false,
  agent,
  showAvatar = true,
  compact = false,
  metadata,
  sourceLabel = "Bot turn",
  llmCalls,
  showToolDetails = false,
  initialTraceOpen = false,
}: {
  tools: readonly Tool[];
  traceSpans?: readonly BotTraceSpan[];
  live?: boolean;
  stopped?: boolean;
  agent?: Agent | undefined;
  showAvatar?: boolean;
  compact?: boolean;
  metadata?: TraceMetadata | undefined;
  sourceLabel?: string;
  llmCalls?: number;
  showToolDetails?: boolean;
  initialTraceOpen?: boolean;
}) {
  const [stepsOpen, setStepsOpen] = useState(false);
  const [stepLimit, setStepLimit] = useState(50);
  const [traceOpen, setTraceOpen] = useState(initialTraceOpen);
  const [focused, setFocused] = useState<string | null>(null);
  const [now, setNow] = useState(() => performance.now());
  const [epochOffset] = useState(() => Date.now() - performance.now());
  const [query, setQuery] = useState("");
  const [onlyFailed, setOnlyFailed] = useState(false);
  const panelId = useId();
  const opener = useRef<HTMLButtonElement>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Subscribe to the live turn's elapsed clock; completed turns have no running timer.
  useEffect(() => {
    if (!live || compact) return;
    const timer = setInterval(() => setNow(performance.now()), 1000);
    return () => clearInterval(timer);
  }, [live, compact]);
  const start = metadata?.startedAt;
  const end = metadata?.endedAt;
  const duration = start !== undefined && end !== undefined ? Math.max(0, end - start) : null;
  const elapsed = start !== undefined ? Math.max(0, now - start) : 0;
  const failures = tools.filter(failed).length;
  const current = tools.findLast(pending);
  const label = compact
    ? `${tools.length} ${tools.length === 1 ? "step" : "steps"}`
    : current
      ? progress(current)
      : tools.length
        ? "Writing a reply…"
        : "Working…";
  const total = Math.max(1, duration ?? 0);
  const shown = tools.filter(
    (tool) =>
      (!onlyFailed || failed(tool)) &&
      `${title(tool)} ${progress(tool)}`.toLowerCase().includes(query.toLowerCase()),
  );
  const stepCount = traceSpans?.length
    ? traceSpans.filter(
        (span) => span.parentId !== null && (span.kind !== "model" || span.icon === "thinking"),
      ).length
    : tools.length;
  if (!stepCount && (!live || compact)) return null;
  const stepList = stepsOpen ? (
    <section
      id={panelId}
      aria-label="Agent steps"
      tabIndex={0}
      className="max-h-[220px] overflow-y-auto border-l border-border pl-3"
    >
      <ol className="space-y-2 py-2">
        {tools.slice(0, stepLimit).map((tool) => (
          <li
            key={tool.toolCallId}
            ref={(node) => {
              if (node && focused === tool.toolCallId) node.scrollIntoView({ block: "nearest" });
            }}
            className={
              focused === tool.toolCallId
                ? "flex items-start gap-2 rounded-sm bg-accent p-1 text-xs"
                : "flex items-start gap-2 text-xs text-muted-foreground"
            }
          >
            <PuzzleIcon className="mt-0.5 size-3 shrink-0" />
            <div className="min-w-0">
              {stopped && pending(tool)
                ? `${title(tool)} stopped before a result was reported.`
                : progress(tool)}
              {showToolDetails &&
                typeof tool.input === "object" &&
                tool.input !== null &&
                Object.keys(tool.input).length > 0 && (
                  <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted p-2 font-mono text-2xs">
                    <code>{JSON.stringify(tool.input, null, 2)}</code>
                  </pre>
                )}
            </div>
          </li>
        ))}
      </ol>
      {tools.length > stepLimit && (
        <Button variant="ghost-muted" size="xs" onClick={() => setStepLimit(stepLimit + 50)}>
          Show next {Math.min(50, tools.length - stepLimit)} steps
        </Button>
      )}
    </section>
  ) : null;
  return (
    <div className="min-w-0" data-openbot-turn-steps={live ? "live" : "finished"}>
      {live ? (
        <>
          <div className="flex items-center gap-3 py-2" role="status" aria-live="polite">
            {agent && showAvatar && (
              <BotAvatar seed={agent.seed} hue={agent.hue} size={30} mood="working" />
            )}
            <span className="text-sm text-muted-foreground">{label}</span>
            {!compact && elapsed >= 5000 && (
              <span className="text-xs tabular-nums text-muted-foreground">
                {Math.floor(elapsed / 1000)}s
              </span>
            )}
            {tools.length > 0 && (
              <Button
                variant="ghost-muted"
                size="icon-xs"
                aria-label={stepsOpen ? "Hide agent steps" : "Show agent steps"}
                aria-expanded={stepsOpen}
                aria-controls={stepsOpen ? panelId : undefined}
                onClick={() => setStepsOpen(!stepsOpen)}
              >
                {stepsOpen ? <ChevronDownIcon /> : <ChevronRightIcon />}
              </Button>
            )}
          </div>
          {stepsOpen && <div className={showAvatar ? "ml-11" : undefined}>{stepList}</div>}
        </>
      ) : (
        <>
          <div className="mb-1 flex items-center gap-1">
            <Button
              variant="ghost-muted"
              size="xs"
              className="-ml-2"
              ref={opener}
              aria-label={stepsOpen ? "Collapse agent steps" : "Open turn trace"}
              aria-controls={stepsOpen ? panelId : undefined}
              aria-haspopup={stepsOpen ? undefined : "dialog"}
              aria-expanded={stepsOpen ? true : undefined}
              onClick={() => {
                if (stepsOpen) setStepsOpen(false);
                else setTraceOpen(true);
              }}
            >
              <span>
                {stepCount} {stepCount === 1 ? "step" : "steps"}
              </span>
              {failures > 0 && (
                <Badge variant="error" size="sm">
                  {failures} failed
                </Badge>
              )}
              {duration !== null && (
                <span className="font-normal tabular-nums text-muted-foreground">
                  {Math.round(duration / 1000)}s
                </span>
              )}
              {stopped && <span className="font-normal text-muted-foreground">Stopped</span>}
              {stepsOpen ? (
                <ChevronDownIcon className="size-3" />
              ) : (
                <ChevronRightIcon className="size-3" />
              )}
            </Button>
          </div>
          {stepsOpen && <div className="mb-3">{stepList}</div>}
        </>
      )}
      <Dialog open={traceOpen} onOpenChange={setTraceOpen}>
        {traceOpen && (
          <DialogPopup
            className="sm:max-w-4xl"
            bottomStickOnMobile={false}
            finalFocus={() => opener.current}
          >
            {traceSpans?.length ? (
              <div className="p-6">
                <DialogTitle className="sr-only">Trace</DialogTitle>
                <DialogDescription className="sr-only">
                  Inspect this bot turn’s timing, reported usage and steps.
                </DialogDescription>
                <BotTraceWaterfall
                  spans={traceSpans}
                  now={now + epochOffset}
                  toolIds={new Set(tools.map((tool) => tool.toolCallId))}
                  onSelectTool={(id) => {
                    setTraceOpen(false);
                    setStepsOpen(true);
                    setFocused(id);
                  }}
                />
              </div>
            ) : (
              <div className="space-y-5 p-6">
                <div className="pr-8">
                  <DialogTitle>Trace</DialogTitle>
                  <DialogDescription>
                    {sourceLabel}
                    {agent ? ` · ${agent.name}` : ""}
                  </DialogDescription>
                </div>
                <div className="grid grid-cols-4 gap-4 border-y py-4 text-xs">
                  <div>
                    <span className="text-muted-foreground">Duration</span>
                    <p className="mt-1 text-lg font-medium tabular-nums">
                      {duration !== null ? seconds(duration) : "Not reported"}
                    </p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">LLM calls</span>
                    <p className="mt-1 text-lg font-medium tabular-nums">
                      {llmCalls ?? "Not reported"}
                    </p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Tool calls</span>
                    <p className="mt-1 text-lg font-medium tabular-nums">{tools.length}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Errors</span>
                    <p className="mt-1 text-lg font-medium tabular-nums">{failures}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <SearchIcon className="size-4 shrink-0 text-muted-foreground" />
                  <Input
                    aria-label="Search trace"
                    placeholder="Search trace…"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                  />
                  <Button
                    variant={onlyFailed ? "secondary" : "ghost-muted"}
                    size="sm"
                    aria-pressed={onlyFailed}
                    onClick={() => setOnlyFailed(!onlyFailed)}
                  >
                    Errors
                  </Button>
                </div>
                <div className="max-h-80 overflow-auto">
                  <div className="min-w-[520px]">
                    <div className="grid grid-cols-[minmax(160px,1fr)_minmax(220px,2fr)_52px] gap-3 border-b pb-2 text-xs text-muted-foreground">
                      <span>Steps</span>
                      <div className="flex justify-between">
                        {[0, 0.25, 0.5, 0.75, 1].map((fraction) => (
                          <span key={fraction}>{seconds(total * fraction)}</span>
                        ))}
                      </div>
                      <span />
                    </div>
                    {shown.slice(0, 200).map((tool) => {
                      const timing = metadata?.toolTimings?.[tool.toolCallId];
                      const at =
                        timing && start !== undefined ? Math.max(0, timing.start - start) : null;
                      const length =
                        timing?.end !== undefined ? Math.max(0, timing.end - timing.start) : null;
                      return (
                        <div
                          key={tool.toolCallId}
                          className="grid grid-cols-[minmax(160px,1fr)_minmax(220px,2fr)_52px] items-center gap-3 border-b py-3 text-xs"
                        >
                          <button
                            type="button"
                            className="flex min-w-0 items-center gap-2 text-left hover:underline"
                            aria-label={`Show step: ${title(tool)}`}
                            onClick={() => {
                              setTraceOpen(false);
                              setStepsOpen(true);
                              setFocused(tool.toolCallId);
                            }}
                          >
                            <PuzzleIcon className="size-3.5 shrink-0 text-muted-foreground" />
                            <span className="truncate">{title(tool)}</span>
                            {failed(tool) && <span className="text-destructive">Failed</span>}
                          </button>
                          <div className="relative h-4 rounded-sm bg-muted/40">
                            {at !== null && length !== null ? (
                              <span
                                className={
                                  failed(tool)
                                    ? "absolute top-1 h-2 min-w-1 rounded-sm bg-destructive/70"
                                    : "absolute top-1 h-2 min-w-1 rounded-sm bg-foreground/40"
                                }
                                style={{
                                  left: `${Math.min(99, (at / total) * 100)}%`,
                                  width: `${Math.min(100 - (at / total) * 100, (length / total) * 100)}%`,
                                }}
                              />
                            ) : (
                              <span className="px-2 text-2xs text-muted-foreground">
                                Timing not reported
                              </span>
                            )}
                          </div>
                          <span className="text-right tabular-nums text-muted-foreground">
                            {length !== null ? seconds(length) : stopped ? "Stopped" : "n/a"}
                          </span>
                        </div>
                      );
                    })}
                    {!shown.length && (
                      <p className="py-6 text-center text-xs text-muted-foreground">
                        No matching steps.
                      </p>
                    )}
                  </div>
                </div>
                <p className="text-2xs text-muted-foreground">
                  Select a step to return to its progress line in the conversation.
                </p>
              </div>
            )}
          </DialogPopup>
        )}
      </Dialog>
    </div>
  );
}
