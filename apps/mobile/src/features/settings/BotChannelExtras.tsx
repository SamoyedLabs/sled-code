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
import { View } from "react-native";
import * as Dialog from "../../components/ui/Dialog";
import { AppText as Text, AppTextInput } from "../../components/ui/AppText";
import { Picker } from "./BotConnectionControls";
import { Button as NativeButton } from "../../components/ui/Button";
import { T, Var, useGT } from "gt-react-native";
function Button({
  children,
  onPress,
  disabled,
}: {
  children: string;
  onPress: () => void;
  disabled?: boolean;
  variant?: string;
}) {
  return <NativeButton label={children} onPress={onPress} disabled={disabled} />;
}

type Props = { environmentId: EnvironmentId; hostId: string };
type Controller = ReturnType<typeof useBotChannelExtras>;
export function BotChannelExtras(props: Props) {
  const gt = useGT();
  const [expanded, setExpanded] = useState(false);
  return (
    <View accessibilityLabel={gt("Channel responsibilities")} className="gap-3">
      <Button variant="outline" onPress={() => setExpanded(!expanded)}>
        {gt("Channel memory and routines")}
      </Button>
      {expanded && <Panel key={`${props.environmentId}:${props.hostId}`} {...props} />}
    </View>
  );
}
function Panel(props: Props) {
  const gt = useGT();
  const c = useBotChannelExtras(props.environmentId, props.hostId);
  const [text, setText] = useState("");
  const disabled = c.busy || !c.canManage;
  return (
    <View className="gap-3">
      <Picker
        label={gt("Channel")}
        value={c.channelId}
        options={[
          { id: "", name: "Choose a channel" },
          ...(c.channels ?? []).map((channel) => ({ id: channel.id, name: channel.name })),
        ]}
        onChange={c.setChannelId}
        disabled={c.busy}
      />
      <Button variant="outline" onPress={c.refresh}>
        {gt("Refresh")}
      </Button>
      {c.error && <Text accessibilityRole="alert">{String(c.error)}</Text>}
      {c.channelId !== "" && (
        <>
          <Text>
            <T>Shared memory</T>
          </Text>
          {c.memories === null ? (
            <Text>
              <T>Loading channel memory…</T>
            </Text>
          ) : c.memories.length === 0 ? (
            <Text>
              <T>No saved memories.</T>
            </Text>
          ) : (
            c.memories.map((memory) => (
              <Memory key={memory.id + memory.updatedAt} memory={memory} c={c} />
            ))
          )}
          <AppTextInput
            multiline
            accessibilityLabel={gt("New channel memory")}
            maxLength={500}
            value={text}
            onChangeText={setText}
          />
          <Button
            disabled={disabled || !text.trim()}
            onPress={() =>
              void c.act({ operation: "channel.memory.create", channelId: c.channelId, text })
            }
          >
            {gt("Add memory")}
          </Button>
          <Button
            disabled={disabled || !c.memories?.length}
            onPress={() =>
              Dialog.alert(
                gt("Clear channel memory?"),
                gt("All shared memories will be deleted."),
                [
                  { text: gt("Cancel"), style: "cancel" },
                  {
                    text: gt("Clear"),
                    style: "destructive",
                    onPress: () =>
                      void c.act({ operation: "channel.memory.clear", channelId: c.channelId }),
                  },
                ],
              )
            }
          >
            {gt("Clear memory")}
          </Button>
          <Text>
            <T>Routines</T>
          </Text>
          <Routine key={`new:${c.channelId}`} c={c} />
          {c.routines?.map((routine) => (
            <Routine key={routine.id + routine.updatedAt} c={c} routine={routine} />
          ))}
          {c.routineId && (
            <View accessibilityLabel={gt("Routine run history")}>
              <Text>
                <T>Run history</T>
              </Text>
              {c.runs === null ? (
                <Text>
                  <T>Loading runs…</T>
                </Text>
              ) : c.runs.length === 0 ? (
                <Text>
                  <T>No runs yet.</T>
                </Text>
              ) : (
                c.runs.map((run) => (
                  <Text key={run.id}>
                    {run.scheduledFor}: {run.status}
                    {run.error ? `: ${run.error}` : ""}
                  </Text>
                ))
              )}
            </View>
          )}
        </>
      )}
    </View>
  );
}
function Memory({ memory, c }: { memory: OpenbotChannelMemory; c: Controller }) {
  const gt = useGT();
  const [text, setText] = useState(memory.text);
  return (
    <View className="gap-2">
      <AppTextInput
        multiline
        accessibilityLabel={gt("Saved channel memory")}
        maxLength={500}
        value={text}
        onChangeText={setText}
      />
      <Button
        disabled={c.busy || !c.canManage || !text.trim()}
        onPress={() =>
          void c.act({
            operation: "channel.memory.update",
            channelId: c.channelId,
            memoryId: memory.id,
            text,
          })
        }
      >
        {gt("Save memory")}
      </Button>
      <Button
        disabled={c.busy || !c.canManage}
        onPress={() =>
          void c.act({
            operation: "channel.memory.delete",
            channelId: c.channelId,
            memoryId: memory.id,
          })
        }
      >
        {gt("Delete memory")}
      </Button>
    </View>
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
    <View className="gap-2 rounded border p-3">
      <AppTextInput
        accessibilityLabel={gt("Routine name")}
        maxLength={80}
        value={name}
        onChangeText={setName}
      />
      <AppTextInput
        multiline
        accessibilityLabel={gt("Routine instruction")}
        maxLength={100000}
        value={instruction}
        onChangeText={setInstruction}
      />
      {!routine && (
        <>
          <AppTextInput
            accessibilityLabel={gt("Timezone")}
            value={timezone}
            onChangeText={setTimezone}
          />
        </>
      )}
      <ScheduleEditor value={schedule} onChange={setSchedule} disabled={disabled} />
      {routine && (
        <Text>
          <T>
            <Var>{routine.active ? gt("Active") : gt("Paused")}</Var> ·{" "}
            <Var>{routine.trigger.schedule.kind}</Var> ·<Var> </Var>
            <Var>{routine.timezone}</Var> · Next: <Var>{routine.trigger.nextRunAt}</Var>
          </T>
        </Text>
      )}
      <Button
        disabled={disabled || !name.trim() || !instruction.trim() || scheduleValue === null}
        onPress={() =>
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
            onPress={() =>
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
            onPress={() =>
              void c.act({
                operation: "channel.routine.test",
                channelId: c.channelId,
                routineId: routine.id,
              })
            }
          >
            {gt("Run now")}
          </Button>
          <Button
            disabled={disabled}
            onPress={() =>
              void c.act({
                operation: "channel.routine.delete",
                channelId: c.channelId,
                routineId: routine.id,
              })
            }
          >
            {gt("Delete routine")}
          </Button>
          <Button variant="outline" onPress={() => c.setRoutineId(routine.id)}>
            {gt("Run history")}
          </Button>
        </>
      )}
    </View>
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
    <Picker
      key={key}
      label={label}
      disabled={disabled}
      value={value[key]}
      options={options.map((option) => ({ id: option, name: option.replaceAll("-", " ") }))}
      onChange={(next) => onChange({ ...value, [key]: next })}
    />
  );
  return (
    <View className="gap-2">
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
        <AppTextInput
          key={field.key}
          accessibilityLabel={field.label}
          placeholder={field.label}
          editable={!disabled}
          value={value[field.key]}
          onChangeText={(next) => onChange({ ...value, [field.key]: next })}
        />
      ))}
      {channelScheduleValue(value) === null && (
        <Text accessibilityRole="alert">
          <T>Complete the schedule with valid values.</T>
        </Text>
      )}
    </View>
  );
}
