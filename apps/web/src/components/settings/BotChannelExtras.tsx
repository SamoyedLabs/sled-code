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
import { T, Var, useGT } from "gt-react";

type Props = { environmentId: EnvironmentId; hostId: string };
type Controller = ReturnType<typeof useBotChannelExtras>;
export function BotChannelExtras(props: Props) {
  const gt = useGT();
  const [expanded, setExpanded] = useState(false);
  return (
    <section aria-label={gt("Channel responsibilities")} className="space-y-3">
      <Button variant="outline" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
        <T>Channel memory and routines</T>
      </Button>
      {expanded && <Panel key={`${props.environmentId}:${props.hostId}`} {...props} />}
    </section>
  );
}
function Panel(props: Props) {
  const gt = useGT();
  const c = useBotChannelExtras(props.environmentId, props.hostId);
  const [text, setText] = useState("");
  const disabled = c.busy || !c.canManage;
  return (
    <div className="space-y-3" aria-busy={c.busy}>
      <label>
        <T>Channel</T>
        <select
          disabled={c.busy}
          className="block w-full"
          value={c.channelId}
          onChange={(event) => c.setChannelId(event.target.value)}
        >
          <option value="">
            <T>Choose a channel</T>
          </option>
          {c.channels?.map((channel) => (
            <option key={channel.id} value={channel.id}>
              {channel.name}
            </option>
          ))}
        </select>
      </label>
      <Button variant="outline" onClick={c.refresh}>
        <T>Refresh</T>
      </Button>
      {c.error && <p role="alert">{String(c.error)}</p>}
      {c.channelId && (
        <>
          <h3>
            <T>Shared memory</T>
          </h3>
          {c.memories === null ? (
            <p>
              <T>Loading channel memory…</T>
            </p>
          ) : c.memories.length === 0 ? (
            <p>
              <T>No saved memories.</T>
            </p>
          ) : (
            c.memories.map((memory) => (
              <Memory key={memory.id + memory.updatedAt} memory={memory} c={c} />
            ))
          )}
          <Textarea
            aria-label={gt("New channel memory")}
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
            <T>Add memory</T>
          </Button>
          <Button
            disabled={disabled || !c.memories?.length}
            onClick={async () => {
              if (await requestConfirmDialog("Clear all shared memories in this channel?"))
                void c.act({ operation: "channel.memory.clear", channelId: c.channelId });
            }}
          >
            <T>Clear memory</T>
          </Button>
          <h3>
            <T>Routines</T>
          </h3>
          <Routine key={`new:${c.channelId}`} c={c} />
          {c.routines?.map((routine) => (
            <Routine key={routine.id + routine.updatedAt} c={c} routine={routine} />
          ))}
          {c.routineId && (
            <div aria-label={gt("Routine run history")}>
              <h4>
                <T>Run history</T>
              </h4>
              {c.runs === null ? (
                <p>
                  <T>Loading runs…</T>
                </p>
              ) : c.runs.length === 0 ? (
                <p>
                  <T>No runs yet.</T>
                </p>
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
  const gt = useGT();
  const [text, setText] = useState(memory.text);
  return (
    <div className="space-y-2">
      <Textarea
        aria-label={gt("Saved channel memory")}
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
        <T>Save memory</T>
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
        <T>Delete memory</T>
      </Button>
    </div>
  );
}
function Routine({ routine, c }: { routine?: OpenbotChannelRoutine; c: Controller }) {
  const gt = useGT();
  const [name, setName] = useState(routine?.name ?? "");
  const [instruction, setInstruction] = useState(routine?.instruction ?? "");
  const [schedule, setSchedule] = useState(() => channelScheduleDraft(routine?.trigger.schedule));
  const scheduleValue = channelScheduleValue(schedule);
  const [timezone, setTimezone] = useState("UTC");
  const disabled = c.busy || !c.canRun;
  return (
    <div className="space-y-2 rounded border p-3">
      <Input
        aria-label={gt("Routine name")}
        maxLength={80}
        value={name}
        onChange={(event) => setName(event.target.value)}
      />
      <Textarea
        aria-label={gt("Routine instruction")}
        maxLength={100000}
        value={instruction}
        onChange={(event) => setInstruction(event.target.value)}
      />
      {!routine && (
        <>
          <Input
            aria-label={gt("Timezone")}
            value={timezone}
            onChange={(event) => setTimezone(event.target.value)}
          />
        </>
      )}
      <ScheduleEditor value={schedule} onChange={setSchedule} disabled={disabled} />
      {routine && (
        <p>
          <T>
            <Var>{routine.active ? gt("Active") : gt("Paused")}</Var> ·{" "}
            <Var>{routine.trigger.schedule.kind}</Var> ·<Var> </Var>
            <Var>{routine.timezone}</Var> · Next: <Var>{routine.trigger.nextRunAt}</Var>
          </T>
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
        {routine ? gt("Save routine") : gt("Create routine")}
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
            {routine.active ? gt("Pause") : gt("Resume")}
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
            <T>Run now</T>
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
            <T>Delete routine</T>
          </Button>
          <Button variant="outline" onClick={() => c.setRoutineId(routine.id)}>
            <T>Run history</T>
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
  const gt = useGT();
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
    fields.push({ key: "time", label: gt("Time (HH:MM)") });
  if (value.kind === "hourly") fields.push({ key: "minute", label: gt("Minute (0–59)") });
  if (value.kind === "weekly")
    fields.push({ key: "weekday", label: gt("Weekday (0 Sunday–6 Saturday)") });
  if (value.kind === "monthly") fields.push({ key: "day", label: gt("Day of month (1–31)") });
  if (value.kind === "interval" || (value.kind === "advanced" && value.timeKind === "every"))
    fields.push({ key: "amount", label: gt("Repeat every") });
  if (value.kind === "interval")
    fields.push({ key: "anchorAt", label: gt("Start at (ISO date and time)") });
  if (value.kind === "custom") fields.push({ key: "expression", label: gt("Cron expression") });
  if (value.kind === "advanced") {
    fields.push({ key: "months", label: gt("Months (1–12, comma separated)") });
    if (value.dayKind !== "every-day")
      fields.push({
        key: "days",
        label:
          value.dayKind === "days-of-week"
            ? gt("Weekdays (0–6, comma separated)")
            : gt("Month days (1–31, comma separated)"),
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
        <p role="alert">
          <T>Complete the schedule with valid values.</T>
        </p>
      )}
    </div>
  );
}
