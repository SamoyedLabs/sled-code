import { useEffect, useRef, useState } from "react";
import {
  ArrowLeftRight,
  Brain,
  Bot,
  MessageCircle,
  Code,
  ChevronDown,
  ChevronRight,
  Clock3,
  Pause,
  Play,
  Puzzle,
  RotateCcw,
  Search,
  Square,
} from "lucide-react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import type { BotTraceSpan } from "./bot-tool-activity";
import { T, Var, useGT } from "gt-react";

const icons = { thinking: Brain, agent: Bot, text: MessageCircle, command: Code };
const kinds = { model: Brain, tool: Puzzle, waiting: Clock3, handoff: ArrowLeftRight };
const duration = (ms: number) =>
  ms > 0 && ms < 100
    ? `${Math.round(ms)}ms`
    : ms < 60000
      ? `${(Math.max(0, ms) / 1000).toFixed(ms < 10000 ? 1 : 0)}s`
      : `${Math.floor(ms / 60000)}m ${Math.round(ms / 1000) % 60}s`;
const usd = (value: number) =>
  new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: value > 0 && value < 0.01 ? 3 : 2,
  }).format(value);

/** OpenBot's expanded trace interaction: a searchable folding tree, real totals and run replay. */
export function BotTraceWaterfall({
  spans,
  now,
  onSelectTool,
  toolIds,
}: {
  spans: readonly BotTraceSpan[];
  now: number;
  toolIds: ReadonlySet<string>;
  onSelectTool: (id: string) => void;
}) {
  const gt = useGT();
  const [query, setQuery] = useState("");
  const [onlyFailed, setOnlyFailed] = useState(false);
  const [folded, setFolded] = useState<ReadonlySet<string>>(new Set());
  const [replay, setReplay] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [selected, setSelected] = useState<string | null>(null);
  const [rowLimit, setRowLimit] = useState(200);
  const [focused, setFocused] = useState<string | null>(null);
  const search = useRef<HTMLInputElement>(null);
  const root = useRef<HTMLElement>(null);
  const origin = Math.min(...spans.map((span) => span.start));
  const fullDuration = Math.max(0, ...spans.map((span) => (span.end ?? now) - origin));
  const clock = replay === null ? now : origin + replay;
  const replaying = playing && (replay ?? 0) < fullDuration;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Replay runs only while the user plays the expanded inspector; pause/unmount cancels the sole frame subscription.
  useEffect(() => {
    if (!replaying) return;
    let frame = 0,
      last = performance.now();
    const tick = (at: number) => {
      const delta = (at - last) * speed;
      last = at;
      setReplay((value) => {
        const next = Math.min(fullDuration, (value ?? 0) + delta);
        return next;
      });
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    const hide = () => {
      if (document.hidden) setPlaying(false);
    };
    document.addEventListener("visibilitychange", hide);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("visibilitychange", hide);
    };
  }, [replaying, speed, fullDuration]);
  const visible = spans
    .filter((span) => replay === null || span.start <= clock)
    .map((span) => {
      if (span.end !== null && span.end <= clock) return span;
      const { failed: _failed, tokens: _tokens, costUsd: _cost, ...unfinished } = span;
      return { ...unfinished, end: null };
    });
  const ids = new Set(visible.map((span) => span.id));
  const parents = new Map(
    visible.map((span) => [
      span.id,
      span.parentId && ids.has(span.parentId) && span.parentId !== span.id ? span.parentId : null,
    ]),
  );
  const children = new Map<string | null, BotTraceSpan[]>();
  for (const span of visible) {
    const parent = parents.get(span.id) ?? null;
    const rows = children.get(parent) ?? [];
    rows.push(span);
    children.set(parent, rows);
  }
  for (const rows of children.values()) rows.sort((a, b) => a.start - b.start);
  const filtering = Boolean(query.trim() || onlyFailed);
  const kept = new Set<string>();
  if (filtering)
    for (const span of visible) {
      if (
        (!onlyFailed || span.failed) &&
        `${span.name} ${span.detail ?? ""}`
          .toLocaleLowerCase()
          .includes(query.trim().toLocaleLowerCase())
      ) {
        let id: string | null = span.id;
        const walked = new Set<string>();
        while (id && !walked.has(id)) {
          walked.add(id);
          kept.add(id);
          id = parents.get(id) ?? null;
        }
      }
    }
  const rows: { span: BotTraceSpan; depth: number }[] = [];
  const walked = new Set<string>();
  const visit = (parent: string | null, depth: number) => {
    if (depth > 20) return;
    for (const span of children.get(parent) ?? []) {
      if (walked.has(span.id) || (filtering && !kept.has(span.id))) continue;
      walked.add(span.id);
      rows.push({ span, depth });
      if (filtering || !folded.has(span.id)) visit(span.id, depth + 1);
    }
  };
  visit(null, 0);
  const displayed = rows.slice(0, rowLimit);
  const totals = visible.reduce(
    (sum, span) => ({
      tools:
        sum.tools +
        Number(!children.has(span.id) && (span.kind === "tool" || span.kind === "handoff")),
      models: sum.models + Number(!children.has(span.id) && span.kind === "model"),
      errors: sum.errors + Number(span.failed === true),
      tokens: span.tokens === undefined ? sum.tokens : (sum.tokens ?? 0) + span.tokens,
      cost: span.costUsd === undefined ? sum.cost : (sum.cost ?? 0) + span.costUsd,
    }),
    { tools: 0, models: 0, errors: 0, tokens: null as number | null, cost: null as number | null },
  );
  const active = visible.find((span) => span.id === selected);
  const toggle = (id: string) =>
    setFolded((before) => {
      const next = new Set(before);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const focus = (id: string) => {
    setFocused(id);
    const buttons = root.current?.querySelectorAll<HTMLButtonElement>("button[data-trace-row]");
    for (const button of buttons ?? [])
      if (button.dataset.traceRow === id) {
        button.focus();
        break;
      }
  };
  const restart = () => {
    setReplay(0);
    setPlaying(true);
  };
  return (
    <section
      ref={root}
      aria-label={gt("Turn trace")}
      className="min-w-0 space-y-4"
      onKeyDown={(event) => {
        if (
          (event.metaKey || event.ctrlKey) &&
          !event.altKey &&
          !event.shiftKey &&
          event.key.toLowerCase() === "f"
        ) {
          event.preventDefault();
          event.stopPropagation();
          search.current?.focus();
          search.current?.select();
        }
      }}
    >
      <div className="flex items-center gap-3 pr-8">
        <h2 className="flex-1 text-base font-semibold">
          <T>Trace</T>
        </h2>
        <Search className="size-4 text-muted-foreground" />
        <Input
          ref={search}
          type="search"
          aria-label={gt("Search trace")}
          placeholder={gt("Search trace…")}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="max-w-60"
        />
      </div>
      <dl className="flex flex-wrap border-y text-xs">
        {[
          ["Duration", duration(replay ?? fullDuration)],
          ["Cost", totals.cost === null ? "Not reported" : usd(totals.cost)],
          ["Tokens", totals.tokens === null ? "Not reported" : totals.tokens.toLocaleString()],
          ["LLM calls", totals.models],
          ["Tool calls", totals.tools],
          ["Errors", totals.errors],
        ].map(([label, value]) => (
          <div key={label} className="min-w-24 flex-1 border-r p-3 last:border-r-0">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="mt-1 text-base font-medium tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
      <div className="flex items-center gap-2">
        <Button
          size="xs"
          variant={onlyFailed ? "secondary" : "ghost-muted"}
          aria-pressed={onlyFailed}
          onClick={() => setOnlyFailed(!onlyFailed)}
        >
          <T>Errors</T>
        </Button>
        <span className="text-xs text-muted-foreground">
          <T>Select a tool to inspect its progress line.</T>
        </span>
      </div>
      <div
        className="max-h-80 overflow-auto"
        role="treegrid"
        aria-label={gt("Trace steps")}
        aria-colcount={2}
      >
        <div className="min-w-[520px]">
          <div
            role="row"
            className="sticky top-0 z-10 grid grid-cols-[minmax(180px,1fr)_minmax(220px,2fr)] gap-3 border-b bg-popover py-2 text-xs text-muted-foreground"
          >
            <span role="columnheader">
              <T>Steps</T>
            </span>
            <div role="columnheader" className="flex justify-between">
              {[0, 0.25, 0.5, 0.75, 1].map((n) => (
                <span key={n}>{duration(fullDuration * n)}</span>
              ))}
            </div>
          </div>
          {displayed.map(({ span, depth }, index) => {
            const Icon = span.icon ? icons[span.icon] : kinds[span.kind];
            const parent = children.has(span.id);
            const until = Math.max(span.start, span.end ?? clock);
            const left = Math.max(
              0,
              Math.min(100, ((span.start - origin) / Math.max(1, fullDuration)) * 100),
            );
            const width = Math.max(
              0,
              Math.min(100 - left, ((until - span.start) / Math.max(1, fullDuration)) * 100),
            );
            return (
              <div
                key={span.id}
                role="row"
                aria-level={depth + 1}
                aria-expanded={parent ? filtering || !folded.has(span.id) : undefined}
                aria-selected={selected === span.id}
                className="grid grid-cols-[minmax(180px,1fr)_minmax(220px,2fr)] items-center gap-3 border-b py-2 text-xs"
              >
                <div
                  role="gridcell"
                  className="flex min-w-0 items-center gap-1"
                  style={{ paddingLeft: depth * 14 }}
                >
                  {parent ? (
                    <button
                      type="button"
                      tabIndex={-1}
                      aria-label={`${folded.has(span.id) ? "Expand" : "Collapse"} ${span.name}`}
                      onClick={() => toggle(span.id)}
                    >
                      {folded.has(span.id) && !filtering ? (
                        <ChevronRight className="size-3" />
                      ) : (
                        <ChevronDown className="size-3" />
                      )}
                    </button>
                  ) : (
                    <span className="w-3" />
                  )}
                  <button
                    type="button"
                    data-trace-row={span.id}
                    tabIndex={(focused ?? displayed[0]?.span.id) === span.id ? 0 : -1}
                    aria-label={gt("Show step: {name}", { name: span.name })}
                    className="flex min-w-0 items-center gap-2 text-left hover:underline"
                    onFocus={() => setFocused(span.id)}
                    onClick={() =>
                      toolIds.has(span.id) ? onSelectTool(span.id) : setSelected(span.id)
                    }
                    onKeyDown={(event) => {
                      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                        event.preventDefault();
                        const next = displayed[index + (event.key === "ArrowDown" ? 1 : -1)];
                        if (next) focus(next.span.id);
                      }
                      if (event.key === "ArrowRight" && parent) {
                        event.preventDefault();
                        if (folded.has(span.id)) toggle(span.id);
                        else if (displayed[index + 1]) focus(displayed[index + 1]!.span.id);
                      }
                      if (event.key === "ArrowLeft") {
                        event.preventDefault();
                        if (parent && !folded.has(span.id)) toggle(span.id);
                        else {
                          const p = parents.get(span.id);
                          if (p) focus(p);
                        }
                      }
                      if (event.key === "Home" || event.key === "End") {
                        event.preventDefault();
                        const next = event.key === "Home" ? displayed[0] : displayed.at(-1);
                        if (next) focus(next.span.id);
                      }
                    }}
                  >
                    <Icon className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="truncate">{span.name}</span>
                    {span.failed && (
                      <span className="text-destructive">
                        <T>Failed</T>
                      </span>
                    )}
                  </button>
                </div>
                <div
                  role="gridcell"
                  className="relative flex h-6 items-center"
                  aria-label={`${span.kind} · ${duration(until - span.start)}${span.costUsd === undefined ? "" : ` · ${usd(span.costUsd)}`}`}
                >
                  <span className="absolute inset-0 rounded-sm bg-muted/30" />
                  <span
                    className={
                      span.failed
                        ? "absolute h-2 min-w-px rounded-sm bg-destructive/70"
                        : span.kind === "handoff"
                          ? "absolute h-2 min-w-px rounded-sm bg-primary/70"
                          : "absolute h-2 min-w-px rounded-sm bg-foreground/40"
                    }
                    style={{ left: `${left}%`, width: `${width}%` }}
                  />
                  <span className="relative ml-auto rounded-sm bg-popover/90 px-1 tabular-nums text-muted-foreground">
                    {duration(until - span.start)}
                  </span>
                </div>
              </div>
            );
          })}
          {!rows.length && (
            <p role="status" className="p-6 text-center text-xs text-muted-foreground">
              <T>No matching steps.</T>
            </p>
          )}
        </div>
      </div>
      {rows.length > rowLimit && (
        <Button size="xs" variant="ghost-muted" onClick={() => setRowLimit((limit) => limit + 200)}>
          <T>
            Show next <Var>{Math.min(200, rows.length - rowLimit)}</Var> steps
          </T>
        </Button>
      )}
      {active && (
        <div className="rounded-md border p-3 text-xs">
          <p className="font-medium">{active.name}</p>
          <p className="mt-1 text-muted-foreground">
            {active.kind} ·{" "}
            {active.failed
              ? gt("Provider reported failure or refusal")
              : active.end === null
                ? gt("Not completed at this point")
                : gt("Completed span")}
          </p>
          {active.detail && (
            <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words">
              {active.detail}
            </pre>
          )}
        </div>
      )}
      <footer className="flex flex-wrap items-center gap-2">
        <Button
          size="icon-xs"
          variant="outline"
          aria-label={
            replaying
              ? gt("Pause replay")
              : replay === null
                ? gt("Replay trace")
                : gt("Resume replay")
          }
          disabled={fullDuration === 0}
          onClick={() => {
            if (replay === null || replay >= fullDuration) setReplay(0);
            setPlaying(!replaying);
          }}
        >
          {replaying ? <Pause /> : <Play />}
        </Button>
        <Button
          size="icon-xs"
          variant="ghost-muted"
          aria-label={gt("Restart replay")}
          disabled={fullDuration === 0}
          onClick={restart}
        >
          <RotateCcw />
        </Button>
        {replay !== null && (
          <Button
            size="icon-xs"
            variant="ghost-muted"
            aria-label={gt("Stop replay")}
            onClick={() => {
              setPlaying(false);
              setReplay(null);
            }}
          >
            <Square />
          </Button>
        )}
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <T>Speed</T>
          <select
            aria-label={gt("Replay speed")}
            value={speed}
            onChange={(event) => setSpeed(Number(event.target.value))}
            className="rounded-md border bg-popover px-2 py-1"
          >
            {[1, 2, 5, 10].map((n) => (
              <option key={n} value={n}>
                {n}×
              </option>
            ))}
          </select>
        </label>
        <ul
          aria-label={gt("Span kinds")}
          className="ml-auto flex flex-wrap gap-3 text-xs text-muted-foreground"
        >
          {Object.entries(kinds).map(([kind, Icon]) => (
            <li key={kind} className="flex items-center gap-1">
              <Icon className="size-3" />
              {kind}
            </li>
          ))}
        </ul>
      </footer>
    </section>
  );
}
