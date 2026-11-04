import {
  channelScheduleDraft,
  channelScheduleValue,
  type ChannelScheduleDraft,
} from "@t3tools/client-runtime/openbot/presentation";
import { useState } from "react";
import type {
  EnvironmentId,
  OpenbotChannelMemory,
  OpenbotChannelRoutine,
} from "@t3tools/contracts";
import { useBotChannelExtras } from "./useBotChannelExtras";
import { requestConfirmDialog } from "../../confirmDialog";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";

type Props = { environmentId: EnvironmentId; hostId: string };
type Controller = ReturnType<typeof useBotChannelExtras>;
export function BotChannelExtras(props: Props) {
  const [expanded, setExpanded] = useState(false);
  return (
    <section aria-label="Channel responsibilities" className="space-y-3">
      <Button variant="outline" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
        Channel memory and routines
      </Button>
      {expanded && <Panel key={`${props.environmentId}:${props.hostId}`} {...props} />}
    </section>
  );
}
function Panel(props: Props) {
  const c = useBotChannelExtras(props.environmentId, props.hostId);
  const [text, setText] = useState("");
  const disabled = c.busy || !c.canManage;
  return (
    <div className="space-y-3" aria-busy={c.busy}>
      <label>
        Channel
        <select
          disabled={c.busy}
          className="block w-full"
          value={c.channelId}
          onChange={(event) => c.setChannelId(event.target.value)}
        >
          <option value="">Choose a channel</option>
          {c.channels?.map((channel) => (
            <option key={channel.id} value={channel.id}>
              {channel.name}
            </option>
          ))}
        </select>
      </label>
      <Button variant="outline" onClick={c.refresh}>
        Refresh
      </Button>
      {c.error && <p role="alert">{String(c.error)}</p>}
      {c.channelId && (
        <>
          <h3>Shared memory</h3>
          {c.memories === null ? (
            <p>Loading channel memory…</p>
          ) : c.memories.length === 0 ? (
            <p>No saved memories.</p>
          ) : (
            c.memories.map((memory) => (
              <Memory key={memory.id + memory.updatedAt} memory={memory} c={c} />
            ))
          )}
          <Textarea
            aria-label="New channel memory"
            maxLength={500}
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
          <Button
            disabled={disabled || !text.trim()}
            onClick={() =>
              void c.act({ operation: "channel.memory.create", channelId: c.channelId, text })
            }
          >
            Add memory
          </Button>
          <Button
            disabled={disabled || !c.memories?.length}
            onClick={async () => {
              if (await requestConfirmDialog("Clear all shared memories in this channel?"))
                void c.act({ operation: "channel.memory.clear", channelId: c.channelId });
            }}
          >
            Clear memory
          </Button>
          <h3>Routines</h3>
          <Routine key={`new:${c.channelId}`} c={c} />
          {c.routines?.map((routine) => (
            <Routine key={routine.id + routine.updatedAt} c={c} routine={routine} />
          ))}
          {c.routineId && (
            <div aria-label="Routine run history">
              <h4>Run history</h4>
              {c.runs === null ? (
                <p>Loading runs…</p>
              ) : c.runs.length === 0 ? (
                <p>No runs yet.</p>
              ) : (
                c.runs.map((run) => (
                  <p key={run.id}>
                    {run.scheduledFor}: {run.status}
                    {run.error ? `: ${run.error}` : ""}
                  </p>
                ))
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
function Memory({ memory, c }: { memory: OpenbotChannelMemory; c: Controller }) {
  const [text, setText] = useState(memory.text);
  return (
    <div className="space-y-2">
      <Textarea
        aria-label="Saved channel memory"
        maxLength={500}
        value={text}
        onChange={(event) => setText(event.target.value)}
      />
      <Button
        disabled={c.busy || !c.canManage || !text.trim()}
        onClick={() =>
          void c.act({
            operation: "channel.memory.update",
            channelId: c.channelId,
            memoryId: memory.id,
            text,
          })
        }
      >
        Save memory
      </Button>
      <Button
        disabled={c.busy || !c.canManage}
        onClick={() =>
          void c.act({
            operation: "channel.memory.delete",
            channelId: c.channelId,
            memoryId: memory.id,
          })
        }
      >
        Delete memory
      </Button>
    </div>
  );
}
function Routine({ routine, c }: { routine?: OpenbotChannelRoutine; c: Controller }) {
  const [name, setName] = useState(routine?.name ?? "");
  const [instruction, setInstruction] = useState(routine?.instruction ?? "");
  const [schedule, setSchedule] = useState(() => channelScheduleDraft(routine?.trigger.schedule));
  const scheduleValue = channelScheduleValue(schedule);
  const [timezone, setTimezone] = useState("UTC");
  const disabled = c.busy || !c.canRun;
  return (
    <div className="space-y-2 rounded border p-3">
      <Input
        aria-label="Routine name"
        maxLength={80}
        value={name}
        onChange={(event) => setName(event.target.value)}
      />
      <Textarea
        aria-label="Routine instruction"
        maxLength={100000}
        value={instruction}
        onChange={(event) => setInstruction(event.target.value)}
      />
      {!routine && (
        <>
          <Input
            aria-label="Timezone"
            value={timezone}
            onChange={(event) => setTimezone(event.target.value)}
          />
        </>
      )}
      <ScheduleEditor value={schedule} onChange={setSchedule} disabled={disabled} />
      {routine && (
        <p>
          {routine.active ? "Active" : "Paused"} · {routine.trigger.schedule.kind} ·{" "}
          {routine.timezone} · Next: {routine.trigger.nextRunAt}
        </p>
      )}
      <Button
        disabled={disabled || !name.trim() || !instruction.trim() || scheduleValue === null}
        onClick={() =>
          void c.act(
            routine
              ? {
                  operation: "channel.routine.update",
                  channelId: c.channelId,
                  routineId: routine.id,
                  name,
                  instruction,
                  ...(scheduleValue ? { schedule: scheduleValue } : {}),
                }
              : {
                  operation: "channel.routine.create",
                  channelId: c.channelId,
                  name,
                  instruction,
                  active: true,
                  timezone,
                  schedule: scheduleValue!,
                },
          )
        }
      >
        {routine ? "Save routine" : "Create routine"}
      </Button>
      {routine && (
        <>
          <Button
            disabled={disabled}
            onClick={() =>
              void c.act({
                operation: "channel.routine.update",
                channelId: c.channelId,
                routineId: routine.id,
                active: !routine.active,
              })
            }
          >
            {routine.active ? "Pause" : "Resume"}
          </Button>
          <Button
            disabled={c.busy || !c.canRun}
            onClick={() =>
              void c.act({
                operation: "channel.routine.test",
                channelId: c.channelId,
                routineId: routine.id,
              })
            }
          >
            Run now
          </Button>
          <Button
            disabled={disabled}
            onClick={() =>
              void c.act({
                operation: "channel.routine.delete",
                channelId: c.channelId,
                routineId: routine.id,
              })
            }
          >
            Delete routine
          </Button>
          <Button variant="outline" onClick={() => c.setRoutineId(routine.id)}>
            Run history
          </Button>
        </>
      )}
    </div>
  );
}

function ScheduleEditor({
  value,
  onChange,
  disabled,
}: {
  value: ChannelScheduleDraft;
  onChange: (value: ChannelScheduleDraft) => void;
  disabled: boolean;
}) {
  const fields: {
    key:
      | "time"
      | "minute"
      | "weekday"
      | "day"
      | "amount"
      | "anchorAt"
      | "expression"
      | "months"
      | "days";
    label: string;
  }[] = [];
  if (
    ["daily", "weekdays", "weekly", "monthly"].includes(value.kind) ||
    (value.kind === "advanced" && value.timeKind === "at-time")
  )
    fields.push({ key: "time", label: "Time (HH:MM)" });
  if (value.kind === "hourly") fields.push({ key: "minute", label: "Minute (0–59)" });
  if (value.kind === "weekly")
    fields.push({ key: "weekday", label: "Weekday (0 Sunday–6 Saturday)" });
  if (value.kind === "monthly") fields.push({ key: "day", label: "Day of month (1–31)" });
  if (value.kind === "interval" || (value.kind === "advanced" && value.timeKind === "every"))
    fields.push({ key: "amount", label: "Repeat every" });
  if (value.kind === "interval")
    fields.push({ key: "anchorAt", label: "Start at (ISO date and time)" });
  if (value.kind === "custom") fields.push({ key: "expression", label: "Cron expression" });
  if (value.kind === "advanced") {
    fields.push({ key: "months", label: "Months (1–12, comma separated)" });
    if (value.dayKind !== "every-day")
      fields.push({
        key: "days",
        label:
          value.dayKind === "days-of-week"
            ? "Weekdays (0–6, comma separated)"
            : "Month days (1–31, comma separated)",
      });
  }
  const choice = (
    label: string,
    key: "kind" | "unit" | "dayKind" | "timeKind",
    options: readonly string[],
  ) => (
    <label key={key}>
      {label}
      <select
        disabled={disabled}
        value={value[key]}
        onChange={(event) => onChange({ ...value, [key]: event.target.value })}
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option.replaceAll("-", " ")}
          </option>
        ))}
      </select>
    </label>
  );
  return (
    <div className="space-y-2">
      {choice("Schedule", "kind", [
        "hourly",
        "daily",
        "weekdays",
        "weekly",
        "monthly",
        "interval",
        "custom",
        "advanced",
      ])}
      {value.kind === "advanced" && (
        <>
          {choice("Days", "dayKind", ["every-day", "days-of-week", "days-of-month"])}
          {choice("Timing", "timeKind", ["at-time", "every"])}
        </>
      )}
      {(value.kind === "interval" || (value.kind === "advanced" && value.timeKind === "every")) &&
        choice(
          "Unit",
          "unit",
          value.kind === "interval" ? ["minutes", "hours", "days"] : ["minutes", "hours"],
        )}
      {fields.map((field) => (
        <Input
          key={field.key}
          aria-label={field.label}
          placeholder={field.label}
          disabled={disabled}
          value={value[field.key]}
          onChange={(event) => onChange({ ...value, [field.key]: event.target.value })}
        />
      ))}
      {channelScheduleValue(value) === null && (
        <p role="alert">Complete the schedule with valid values.</p>
      )}
    </div>
  );
}
