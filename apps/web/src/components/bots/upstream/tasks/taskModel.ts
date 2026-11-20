import * as Schema from "effect/Schema";
import * as Result from "effect/Result";

const Task = Schema.Struct({
  id: Schema.String,
  agentId: Schema.String,
  threadId: Schema.String,
  title: Schema.String,
  state: Schema.Literals(["running", "queued", "idle", "closed"]),
  outcome: Schema.NullOr(Schema.Literals(["completed", "failed", "interrupted"])),
  progress: Schema.NullOr(Schema.String),
  error: Schema.NullOr(Schema.String),
  updatedAt: Schema.String,
  closedAt: Schema.NullOr(Schema.String),
});
export type Task = typeof Task.Type;
const decode = Schema.decodeUnknownResult(Schema.Struct({ tasks: Schema.Array(Task) }));
export function taskSnapshot(value: unknown) {
  const result = decode(value);
  return Result.isSuccess(result) ? result.success.tasks : null;
}
export function taskStatus(task: Task) {
  if (task.state === "running") return task.progress || "Working";
  if (task.state === "queued") return "Waiting";
  if (task.state === "closed") return "Archived";
  return task.outcome === "completed"
    ? "Answered"
    : task.outcome === "failed"
      ? "Failed"
      : task.outcome === "interrupted"
        ? "Stopped"
        : "Waiting";
}
export function taskSections(
  tasks: readonly Task[],
  showAllClosed: boolean,
  waitsForYou?: (task: Task) => boolean,
) {
  const open = tasks
    .filter((task) => task.state !== "closed")
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  const closed = tasks
    .filter((task) => task.state === "closed")
    .sort((a, b) => Date.parse(b.closedAt ?? b.updatedAt) - Date.parse(a.closedAt ?? a.updatedAt));
  return [
    {
      id: "needsYou",
      title: "Needs you",
      tasks: open.filter(
        (task) =>
          (task.state === "idle" && task.outcome !== null) ||
          (task.state === "running" && waitsForYou?.(task)),
      ),
    },
    {
      id: "working",
      title: "Working",
      tasks: open.filter((task) => task.state === "running" && !waitsForYou?.(task)),
    },
    {
      id: "waiting",
      title: "Waiting",
      tasks: open.filter(
        (task) => task.state === "queued" || (task.state === "idle" && task.outcome === null),
      ),
    },
    {
      id: "closed",
      title: "Archived",
      tasks: showAllClosed ? closed : closed.slice(0, 2),
      count: closed.length,
    },
  ];
}
