/* oxlint-disable shadcn/no-unknown-classes -- Pinned DiagramInspector and routine visualization styles. */
import { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import type { EnvironmentId, OpenbotAgent, OpenbotRoutineFlowCanvas } from "@t3tools/contracts";
import { ChevronLeft, ChevronRight, Copy, Check } from "lucide-react";
import { SourceAgentAvatar } from "../../SourceAgentAvatar";
import { SourceButton } from "../settings/SettingsParts";
import { namedClipboardTarget, useCopyToClipboard } from "../../../../hooks/useCopyToClipboard";
import { DiagramWebhookConfig } from "./DiagramWebhookConfig";
import {
  diagramAgentTask,
  diagramRoutineSteps,
  diagramExecutionSteps,
  diagramRunOf,
  diagramRoutinesReaching,
  diagramRoutineColor,
} from "./diagram-graph";
import type { Diagram, DiagramNode, DiagramStepRun } from "./diagram-model";
import { T, useGT } from "gt-react";
type Canvas = typeof OpenbotRoutineFlowCanvas.Type;
const time = (v: string) =>
  new Date(v).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
export function DiagramInspector({
  environmentId,
  hostId,
  diagram,
  canvas,
  agents,
  selected,
  focus,
  writable,
  onSelect,
  onFocus,
  onEditTask,
  onEditRoutine,
  onRefresh,
}: {
  environmentId: EnvironmentId;
  hostId: string;
  diagram: Diagram;
  canvas: Canvas;
  agents: readonly (typeof OpenbotAgent.Type)[];
  selected: string | null;
  focus: string | null;
  writable: boolean;
  onSelect: (id: string | null) => void;
  onFocus: (id: string | null) => void;
  onEditTask: (node: DiagramNode, routineId: string, text: string) => void;
  onEditRoutine: (agentId: string, id: string) => void;
  onRefresh: () => void;
}) {
  const gt = useGT();
  const node = diagram.nodes.find((n) => n.id === selected),
    run = diagramRunOf(diagram, focus),
    step = run?.steps.find((s) => s.nodeId === node?.id);
  const steps = focus
    ? diagramRoutineSteps(diagram.edges, focus)
    : diagramExecutionSteps(diagram.nodes, diagram.edges);
  const name = (node: DiagramNode) =>
    node.kind === "routine"
      ? node.name
      : (agents.find((a) => a.id === node.agentId)?.name ?? "Unavailable agent");
  const profile = node?.kind === "agent" ? agents.find((a) => a.id === node.agentId) : undefined;
  const routine =
    node?.kind === "routine"
      ? canvas.routines.find((r) => `routine:${r.routine.id}` === node.id)
      : undefined;
  const ordered = diagram.nodes
    .filter((n) => n.kind === "agent" && (!focus || steps.has(n.id)))
    .sort((a, b) => (steps.get(a.id) ?? Infinity) - (steps.get(b.id) ?? Infinity));
  return (
    <aside className="diagram-inspector" aria-label={gt("Routine details")}>
      <header className="diagram-inspector-header">
        {node && (
          <SourceButton
            className="header-panel-toggle"
            variant="ghost"
            aria-label={gt("Back to run details")}
            onClick={() => onSelect(null)}
          >
            <ChevronLeft />
          </SourceButton>
        )}
        {profile && <SourceAgentAvatar agent={profile} size={24} />}
        <h2 className="diagram-inspector-title">{node ? name(node) : gt("Run details")}</h2>
        {node && steps.has(node.id) && (
          <span className="diagram-inspector-step-number">{steps.get(node.id)}</span>
        )}
      </header>
      <div className="diagram-inspector-body">
        {!node ? (
          <>
            {run ? (
              <>
                <div className="diagram-inspector-run">
                  <span data-status={run.status}>{run.status}</span>
                  <span>{time(run.startedAt)}</span>
                  <span className="diagram-inspector-muted">
                    {run.kind === "manual" ? gt("Started manually") : gt("Scheduled run")}
                  </span>
                </div>
                <h3 className="diagram-inspector-section-title">
                  <T>Steps</T>
                </h3>
                <ol className="diagram-inspector-steps">
                  {ordered.map((n) => (
                    <li key={n.id}>
                      <SourceButton
                        variant="ghost"
                        className="diagram-inspector-step"
                        onClick={() => onSelect(n.id)}
                      >
                        <span className="diagram-inspector-step-number">
                          {steps.get(n.id) ?? ""}
                        </span>
                        <span className="diagram-inspector-step-name">{name(n)}</span>
                        <StepStatus step={run.steps.find((s) => s.nodeId === n.id)} />
                      </SourceButton>
                    </li>
                  ))}
                </ol>
              </>
            ) : (
              <p className="diagram-inspector-empty">
                <T>No run yet. Choose a routine and run it to see each agent’s input and answer.</T>
              </p>
            )}
          </>
        ) : node.kind === "routine" && routine ? (
          <>
            <section className="diagram-inspector-section">
              <h3 className="diagram-inspector-section-title">
                <T>Instruction</T>
              </h3>
              <p>{node.instruction}</p>
            </section>
            {node.schedule ? (
              <>
                <section className="diagram-inspector-section">
                  <h3 className="diagram-inspector-section-title">
                    <T>Next 7 days</T>
                  </h3>
                  <RoutineWeek upcomingRuns={node.upcomingRuns} size="panel" />
                </section>
                <section className="diagram-inspector-section">
                  <h3 className="diagram-inspector-section-title">
                    <T>Upcoming runs</T>
                  </h3>
                  <ul className="diagram-inspector-times">
                    {node.upcomingRuns.slice(0, 6).map((at) => (
                      <li key={at}>{time(at)}</li>
                    ))}
                  </ul>
                  {!node.active && (
                    <p className="diagram-inspector-muted">
                      <T>Paused</T>
                    </p>
                  )}
                </section>
              </>
            ) : (
              <DiagramWebhookConfig
                key={`${hostId}:${routine.routine.id}`}
                environmentId={environmentId}
                hostId={hostId}
                routine={routine.routine}
                onRefresh={onRefresh}
              />
            )}
            <section className="diagram-inspector-section">
              <h3 className="diagram-inspector-section-title">
                <T>Starts these agents</T>
              </h3>
              {diagram.edges
                .filter((e) => e.from === node.id)
                .map((e) => {
                  const target = diagram.nodes.find((n) => n.id === e.to);
                  return target ? (
                    <SourceButton
                      key={e.id}
                      variant="ghost"
                      className="diagram-inspector-step"
                      onClick={() => onSelect(target.id)}
                    >
                      {name(target)}
                      <ChevronRight />
                    </SourceButton>
                  ) : null;
                })}
            </section>
            <section className="diagram-inspector-section">
              <h3 className="diagram-inspector-section-title">
                <T>Recent runs</T>
              </h3>
              {routine.recentRuns.length ? (
                <ul className="diagram-inspector-history">
                  {routine.recentRuns.map((r) => (
                    <li key={r.id}>
                      <time className="diagram-inspector-history-time">{time(r.createdAt)}</time>
                      <span>{r.status}</span>
                      <span className="diagram-inspector-history-kind">{r.kind}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="diagram-inspector-muted">
                  <T>No runs yet.</T>
                </p>
              )}
            </section>
            <SourceButton
              onClick={() => onEditRoutine(routine.routine.agentId, routine.routine.id)}
            >
              <T>Edit routine</T>
            </SourceButton>
          </>
        ) : (
          <>
            <section className="diagram-inspector-section">
              <h3 className="diagram-inspector-section-title">
                <T>Task</T>
              </h3>
              {focus && node.kind === "agent" && node.tasks && focus in node.tasks ? (
                <TaskEditor
                  key={`${node.id}:${focus}`}
                  value={diagramAgentTask(node, focus)}
                  disabled={!writable}
                  onSave={(text) => onEditTask(node, focus, text)}
                />
              ) : (
                <p>
                  {diagramAgentTask(node, focus) || gt("This agent is not connected to a routine.")}
                </p>
              )}
            </section>
            <section className="diagram-inspector-section">
              <h3 className="diagram-inspector-section-title">
                <T>Started by</T>
              </h3>
              <ul className="diagram-inspector-steps">
                {diagramRoutinesReaching(diagram.nodes, diagram.edges, node.id).map((r) => (
                  <li key={r.id}>
                    <SourceButton
                      variant="ghost"
                      className="diagram-inspector-step diagram-inspector-routine"
                      data-routine-color={diagramRoutineColor(diagram.nodes, r.id)}
                      aria-pressed={focus === r.id}
                      onClick={() => onFocus(r.id)}
                    >
                      <span className="diagram-inspector-routine-dot" />
                      <span className="diagram-inspector-step-name">{r.name}</span>
                      <StepStatus
                        step={diagramRunOf(diagram, r.id)?.steps.find((s) => s.nodeId === node.id)}
                      />
                    </SourceButton>
                  </li>
                ))}
              </ul>
            </section>
            <section className="diagram-inspector-section">
              <h3 className="diagram-inspector-section-heading">
                <span>
                  <T>Input</T>
                </span>
                {step?.input && <CopyText text={step.input} />}
              </h3>
              <p className="diagram-inspector-output">{step?.input ?? gt("No input yet.")}</p>
            </section>
            <section className="diagram-inspector-section">
              <h3 className="diagram-inspector-section-heading">
                <span>
                  <T>Answer</T>
                </span>
                {step?.output && <CopyText text={step.output} />}
              </h3>
              <p className="diagram-inspector-output">
                {step?.output ?? step?.error ?? gt("No answer yet.")}
              </p>
              {step && <StepStatus step={step} />}
            </section>
          </>
        )}
      </div>
    </aside>
  );
}
function StepStatus({ step }: { step: DiagramStepRun | undefined }) {
  const gt = useGT();
  const duration =
    step?.startedAt && step.finishedAt
      ? Math.max(0, Math.round((Date.parse(step.finishedAt) - Date.parse(step.startedAt)) / 1000))
      : null;
  return (
    <span className="diagram-inspector-step-status" data-status={step?.status}>
      {step?.status === "succeeded" ? <Check /> : null}
      {duration !== null ? `${duration}s` : (step?.status ?? gt("Not run"))}
    </span>
  );
}
function CopyText({ text }: { text: string }) {
  const gt = useGT();
  const { isCopied: copied, copyToClipboard } = useCopyToClipboard({
    target: namedClipboardTarget("routine result"),
  });
  return (
    <SourceButton
      variant="ghost"
      size="xs"
      aria-label={copied ? gt("Copied") : gt("Copy text")}
      onClick={() => copyToClipboard(text, undefined)}
    >
      {copied ? <Check /> : <Copy />}
    </SourceButton>
  );
}
function TaskEditor({
  value,
  disabled,
  onSave,
}: {
  value: string;
  disabled: boolean;
  onSave: (value: string) => void;
}) {
  const gt = useGT();
  const [draft, setDraft] = useState(value),
    [observed, setObserved] = useState(value),
    [editing, setEditing] = useState(false),
    discard = useRef(false),
    id = useId();
  if (value !== observed) {
    setObserved(value);
    if (!editing) setDraft(value);
  }
  const save = () => {
    setEditing(false);
    if (discard.current) {
      discard.current = false;
      return;
    }
    const text = draft.trim();
    if (!disabled && text !== value.trim()) onSave(text);
  };
  return (
    <textarea
      className="ui-textarea diagram-inspector-task"
      id={id}
      aria-label={gt("Task instructions")}
      rows={2}
      value={draft}
      readOnly={disabled}
      onFocus={() => {
        setEditing(true);
      }}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          discard.current = true;
          setDraft(value);
          e.currentTarget.blur();
        } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          e.currentTarget.blur();
        }
      }}
    />
  );
}
export function RoutineWeek({
  upcomingRuns,
  size,
}: {
  upcomingRuns: readonly string[];
  size: "card" | "panel";
}) {
  const gt = useGT();
  const [today, setToday] = useState(() => new Date());
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Advance the source calendar at local midnight and when the app wakes.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const update = () => {
      const now = new Date();
      setToday(now);
      const next = new Date(now);
      next.setHours(24, 0, 0, 0);
      timer = setTimeout(update, +next - +now);
    };
    const wake = () => {
      clearTimeout(timer);
      update();
    };
    update();
    document.addEventListener("visibilitychange", wake);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", wake);
    };
  }, []);
  const now = new Date(today);
  now.setHours(0, 0, 0, 0);
  const days = Array.from({ length: 7 }, (_, index) => {
    const start = new Date(now);
    start.setDate(now.getDate() + index);
    const end = new Date(start);
    end.setDate(start.getDate() + 1);
    return {
      date: start,
      today: index === 0,
      ticks: upcomingRuns
        .map(Date.parse)
        .filter((t) => t >= +start && t < +end)
        .map((t) => ((t - +start) / (+end - +start)) * 100),
    };
  });
  const count = days.reduce((n, d) => n + d.ticks.length, 0);
  return (
    <div
      className="diagram-routine-week"
      data-size={size}
      role="img"
      aria-label={gt("{count} runs in the next seven days", { count })}
    >
      {days.map((day) => (
        <div
          key={+day.date}
          className="diagram-routine-day"
          data-today={day.today ? "" : undefined}
          data-weekend={[0, 6].includes(day.date.getDay()) ? "" : undefined}
        >
          <span className="diagram-routine-day-track">
            {day.ticks.map((tick) => (
              <span
                key={tick}
                className="diagram-routine-tick"
                style={{ "--diagram-tick-at": `${tick}%` } as CSSProperties}
              />
            ))}
          </span>
          <span className="diagram-routine-day-name" aria-hidden="true">
            {day.date.toLocaleDateString(undefined, {
              weekday: size === "card" ? "narrow" : "short",
            })}
          </span>
        </div>
      ))}
    </div>
  );
}
