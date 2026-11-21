import { useEffect, useEffectEvent, useState, type ReactNode } from "react";
import type { EnvironmentId } from "@t3tools/contracts";
import { routineRows } from "@t3tools/client-runtime/openbot/presentation";
import { useBotEvents, type BotRoutineEditTarget } from "./useBotRoutines";
import { View, Switch } from "react-native";
import * as Clipboard from "expo-clipboard";
import * as Dialog from "../../components/ui/Dialog";
import { Button } from "../../components/ui/Button";
import { AppText as Text, AppTextInput } from "../../components/ui/AppText";
import { Picker } from "../settings/BotConnectionControls";
import { m } from "../../i18n/messages";
import { T, Var, msg, useGT } from "gt-react-native";
export function RoutineGroup({ children }: { children: ReactNode }) {
  return <View className="gap-3">{children}</View>;
}
export function RoutineText({ children, alert = false }: { children: ReactNode; alert?: boolean }) {
  return (
    <Text selectable accessibilityRole={alert ? "alert" : undefined}>
      {children}
    </Text>
  );
}
export function RoutineHeading({ children }: { children: ReactNode }) {
  return (
    <Text accessibilityRole="header" className="font-semibold">
      {children}
    </Text>
  );
}
export function RoutineAction({
  label,
  onClick,
  disabled = false,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return <Button label={label} onPress={onClick} disabled={disabled} />;
}
export function RoutineDisclosure({ label, children }: { label: string; children: ReactNode }) {
  const gt = useGT();
  const [expanded, setExpanded] = useState(false);
  return (
    <View className="gap-3">
      <Button
        label={expanded ? gt("Close {value}", { value: label.toLowerCase() }) : label}
        accessibilityHint={expanded ? gt("Expanded") : gt("Collapsed")}
        onPress={() => setExpanded(!expanded)}
      />
      {expanded && children}
    </View>
  );
}
export function RoutineField({
  label,
  value,
  onChange,
  multiline = false,
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  multiline?: boolean;
  disabled?: boolean;
}) {
  return (
    <View className="gap-1">
      <Text>{label}</Text>
      <AppTextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChange}
        multiline={multiline}
        editable={!disabled}
        autoCapitalize="none"
        className="rounded-xl border border-border p-3 text-foreground"
      />
    </View>
  );
}
export function RoutineChoice({
  label,
  value,
  options,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  options: readonly { id: string; name: string }[];
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <Picker label={label} value={value} options={options} disabled={disabled} onChange={onChange} />
  );
}
function RoutineToggle({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
  disabled: boolean;
}) {
  return (
    <View className="flex-row items-center justify-between gap-3">
      <Text>{label}</Text>
      <Switch
        accessibilityLabel={label}
        value={value}
        onValueChange={onChange}
        disabled={disabled}
      />
    </View>
  );
}
function confirmDelete(action: () => void) {
  Dialog.alert(m(msg("Delete routine?")), m(msg("This removes its trigger from Openbot.")), [
    { text: m(msg("Cancel")), style: "cancel" },
    { text: "Delete", style: "destructive", onPress: action },
  ]);
}
function copyPrivate(text: string) {
  return Clipboard.setStringAsync(text).then(
    () => true,
    () => false,
  );
}
type Props = { environmentId: EnvironmentId; hostId: string };
export function BotEvents(props: Props) {
  const gt = useGT();
  return (
    <RoutineDisclosure label={gt("Event routines and recovery")}>
      <EventPanel key={`${props.environmentId}:${props.hostId}`} {...props} />
    </RoutineDisclosure>
  );
}
export function EventPanel({
  environmentId,
  hostId,
  initial,
}: Props & { initial?: BotRoutineEditTarget }) {
  const gt = useGT();
  const c = useBotEvents(environmentId, hostId, initial);
  const loadInitial = useEffectEvent(() => {
    if (initial) void c.act({ operation: "events.list", owner: initial.owner }, initial.routineId);
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Read the selected routine through the host admin operation after its permissions resolve.
  useEffect(() => {
    if (c.canAdmin && initial) loadInitial();
  }, [c.canAdmin, initial]);
  const [notice, setNotice] = useState<string | null>(null);
  const request = c.request;
  const form = c.form;
  const disabled = c.busy || !c.canAdmin;
  const editable = disabled || !c.ownerAvailable || c.readOnly;
  const selectedReadDisabled = disabled || !c.ownerAvailable || !c.routineId;
  const selectedDisabled = selectedReadDisabled || !c.canRun;
  const selectedName = String(
    c.rows.find((row) => row.id === c.routineId)?.name || "Selected routine",
  );
  const trigger = form.trigger;
  const schedule = trigger?.kind === "schedule" ? trigger.schedule : null;
  const commonKind =
    schedule && ["daily", "weekdays", "weekly", "interval", "custom"].includes(schedule.kind)
      ? schedule.kind
      : "preserve";
  function changeSchedule(kind: string) {
    if (kind === "preserve") return;
    const time =
      schedule && "time" in schedule && typeof schedule.time === "string" ? schedule.time : "09:00";
    const next: NonNullable<typeof schedule> =
      kind === "weekly"
        ? { kind: "weekly", weekday: 1, time }
        : kind === "interval"
          ? { kind: "interval", amount: 1, unit: "hours", anchorAt: new Date().toISOString() }
          : kind === "custom"
            ? { kind: "custom", expression: "0 9 * * *" }
            : kind === "daily"
              ? { kind: "daily", time }
              : { kind: "weekdays", time };
    c.patch({ trigger: { kind: "schedule", schedule: next } });
  }
  function patchSchedule(fields: {
    time?: string;
    weekday?: number;
    amount?: number;
    unit?: "minutes" | "hours" | "days";
    anchorAt?: string;
    expression?: string;
  }) {
    if (!schedule) return;
    const next =
      schedule.kind === "weekly"
        ? {
            ...schedule,
            time: fields.time ?? schedule.time,
            weekday: fields.weekday ?? schedule.weekday,
          }
        : schedule.kind === "interval"
          ? {
              ...schedule,
              amount: fields.amount ?? schedule.amount,
              unit: fields.unit ?? schedule.unit,
              anchorAt: fields.anchorAt ?? schedule.anchorAt,
            }
          : schedule.kind === "custom"
            ? { ...schedule, expression: fields.expression ?? schedule.expression }
            : schedule.kind === "daily" || schedule.kind === "weekdays"
              ? { ...schedule, time: fields.time ?? schedule.time }
              : schedule;
    c.patch({ trigger: { kind: "schedule", schedule: next } });
  }
  return (
    <RoutineGroup>
      <RoutineText>
        <T>
          Choose who owns the routine, then set its trigger and instructions. Running a test starts
          real bot work.
        </T>
      </RoutineText>
      {!c.canAdmin && (
        <RoutineText alert>
          <T>Settings access is required to manage event routines.</T>
        </RoutineText>
      )}
      <RoutineAction
        label={gt("Refresh bots and channels")}
        onClick={c.refresh}
        disabled={c.busy}
      />
      {c.error && <RoutineText alert>{c.error}</RoutineText>}
      <RoutineChoice
        label={gt("Routine owner type")}
        value={c.owner.kind}
        options={[
          { id: "agent", name: "Bot" },
          { id: "channel", name: "Channel" },
        ]}
        disabled={c.busy}
        onChange={(kind) => c.selectOwner(kind === "channel" ? "channel" : "agent", "")}
      />
      <RoutineChoice
        label={c.owner.kind === "agent" ? gt("Bot") : gt("Channel")}
        value={c.owner.id}
        options={c.owners}
        disabled={c.busy}
        onChange={(id) => c.selectOwner(c.owner.kind, id)}
      />
      {c.owners.length === 0 && (
        <RoutineText>
          <T>
            No visible <Var>{c.owner.kind === "agent" ? "bots" : "channels"}</Var>. Create one in
            the workspace or refresh the connection.
          </T>
        </RoutineText>
      )}
      <RoutineAction
        label={gt("Load routines")}
        disabled={disabled || !c.ownerAvailable}
        onClick={() =>
          void c.act({ operation: "events.list", owner: c.owner }, c.routineId || undefined)
        }
      />
      <RoutineChoice
        label={gt("Routine")}
        value={c.routineId}
        options={c.rows.map((row) => ({
          id: String(row.id),
          name: `${String(row.name || "Untitled routine")} · ${row.active ? "Active" : "Paused"}`,
        }))}
        disabled={c.busy}
        onChange={c.selectRoutine}
      />
      <RoutineAction
        label={gt("New scheduled routine")}
        disabled={disabled || !c.ownerAvailable}
        onClick={() => c.newRoutine("schedule")}
      />
      <RoutineAction
        label={gt("New webhook routine")}
        disabled={disabled || !c.ownerAvailable}
        onClick={() => c.newRoutine("webhook")}
      />
      <RoutineHeading>
        {c.routineId ? gt("Edit {selectedName}", { selectedName }) : gt("New routine")}
      </RoutineHeading>
      {c.readOnly && (
        <RoutineText alert>
          <T>
            This routine uses configuration this client cannot safely edit. Its complete data is
            preserved below; use an updated client to change it.
          </T>
        </RoutineText>
      )}
      {!c.readOnly && (
        <RoutineGroup>
          <RoutineField
            label={gt("Routine name")}
            value={form.name}
            onChange={(name) => c.patch({ name })}
            disabled={editable}
          />
          <RoutineField
            label={gt("Instructions")}
            value={form.instruction}
            onChange={(instruction) => c.patch({ instruction })}
            multiline
            disabled={editable}
          />
          <RoutineToggle
            label={gt("Routine active")}
            value={form.active}
            onChange={(active) => c.patch({ active })}
            disabled={editable}
          />
          <RoutineField
            label={gt("Time zone")}
            value={form.timezone}
            onChange={(timezone) => c.patch({ timezone })}
            disabled={editable}
          />
          <RoutineChoice
            label={gt("Trigger")}
            value={form.trigger.kind}
            options={[
              { id: "schedule", name: "Schedule" },
              { id: "webhook", name: "Webhook" },
            ]}
            disabled={editable}
            onChange={(kind) =>
              c.patch({
                trigger:
                  kind === "webhook"
                    ? { kind: "webhook", eventType: null, filters: [] }
                    : { kind: "schedule", schedule: { kind: "daily", time: "09:00" } },
              })
            }
          />
          {trigger?.kind === "webhook" && (
            <RoutineGroup>
              <RoutineField
                label={gt("Event type (leave empty for any event)")}
                value={trigger.eventType ?? ""}
                onChange={(eventType) =>
                  c.patch({ trigger: { ...trigger, eventType: eventType || null } })
                }
                disabled={editable}
              />
              <RoutineText>
                <T>
                  <Var>{trigger.filters.length}</Var> payload<Var> </Var>
                  <Var>{trigger.filters.length === 1 ? "filter" : "filters"}</Var> retained. Change
                  payload filters in advanced configuration.
                </T>
              </RoutineText>
            </RoutineGroup>
          )}
          {schedule && (
            <RoutineGroup>
              <RoutineChoice
                label={gt("Schedule")}
                value={commonKind}
                options={[
                  ...(commonKind === "preserve"
                    ? [{ id: "preserve", name: "Existing advanced schedule (preserved)" }]
                    : []),
                  { id: "daily", name: "Every day" },
                  { id: "weekdays", name: "Weekdays" },
                  { id: "weekly", name: "Weekly" },
                  { id: "interval", name: "At an interval" },
                  { id: "custom", name: "Custom cron expression" },
                ]}
                disabled={editable}
                onChange={changeSchedule}
              />
              {(schedule.kind === "daily" ||
                schedule.kind === "weekdays" ||
                schedule.kind === "weekly") && (
                <RoutineField
                  label={gt("Time (24-hour HH:MM)")}
                  value={schedule.time}
                  onChange={(time) => patchSchedule({ time })}
                  disabled={editable}
                />
              )}
              {schedule.kind === "weekly" && (
                <RoutineChoice
                  label={gt("Day")}
                  value={String(schedule.weekday)}
                  options={[
                    "Sunday",
                    "Monday",
                    "Tuesday",
                    "Wednesday",
                    "Thursday",
                    "Friday",
                    "Saturday",
                  ].map((name, id) => ({ id: String(id), name }))}
                  disabled={editable}
                  onChange={(weekday) => patchSchedule({ weekday: Number(weekday) })}
                />
              )}
              {schedule.kind === "interval" && (
                <RoutineGroup>
                  <RoutineField
                    label={gt("Repeat every")}
                    value={String(schedule.amount)}
                    onChange={(amount) => patchSchedule({ amount: Number(amount) })}
                    disabled={editable}
                  />
                  <RoutineChoice
                    label={gt("Interval unit")}
                    value={schedule.unit}
                    options={[
                      { id: "minutes", name: "Minutes" },
                      { id: "hours", name: "Hours" },
                      { id: "days", name: "Days" },
                    ]}
                    disabled={editable}
                    onChange={(unit) =>
                      patchSchedule({
                        unit: unit === "hours" || unit === "days" ? unit : "minutes",
                      })
                    }
                  />
                  <RoutineDisclosure label={gt("Interval start time")}>
                    <RoutineText>
                      <T>
                        The first occurrence is retained when you edit the interval. Change it only
                        to move the schedule's start.
                      </T>
                    </RoutineText>
                    <RoutineField
                      label={gt("First occurrence (ISO date and time)")}
                      value={schedule.anchorAt}
                      onChange={(anchorAt) => patchSchedule({ anchorAt })}
                      disabled={editable}
                    />
                  </RoutineDisclosure>
                </RoutineGroup>
              )}
              {schedule.kind === "custom" && (
                <RoutineField
                  label={gt("Cron expression")}
                  value={schedule.expression}
                  onChange={(expression) => patchSchedule({ expression })}
                  disabled={editable}
                />
              )}
            </RoutineGroup>
          )}
          <RoutineChoice
            label={gt("When a scheduled occurrence was missed")}
            value={form.missedPolicy ?? ""}
            options={[
              { id: "", name: "Use engine default" },
              { id: "skip", name: "Skip missed occurrences" },
              { id: "run-once", name: "Catch up once" },
            ]}
            disabled={editable}
            onChange={(missedPolicy) =>
              c.patch({
                missedPolicy:
                  missedPolicy === "skip" || missedPolicy === "run-once" ? missedPolicy : undefined,
              })
            }
          />
          <RoutineChoice
            label={gt("When the bot is at its work limit")}
            value={form.limitPolicy ?? ""}
            options={[
              { id: "", name: "Use engine default" },
              { id: "wait", name: "Wait until capacity is available" },
              { id: "skip", name: "Skip this occurrence" },
            ]}
            disabled={editable}
            onChange={(limitPolicy) =>
              c.patch({
                limitPolicy:
                  limitPolicy === "skip" || limitPolicy === "wait" ? limitPolicy : undefined,
              })
            }
          />
        </RoutineGroup>
      )}
      <RoutineDisclosure
        label={c.readOnly ? gt("Preserved configuration") : gt("Advanced configuration")}
      >
        <RoutineText>
          <T>
            Keep the selected routine identity. Editing common fields retains its existing trigger
            filters and policies. Unrecognized future fields cannot be saved by this client.
          </T>
        </RoutineText>
        <RoutineField
          label={gt("Complete routine configuration")}
          value={c.draft}
          onChange={c.updateDraft}
          multiline
          disabled={editable}
        />
      </RoutineDisclosure>
      {!request && !c.readOnly && (
        <RoutineText alert>
          {c.ownerAvailable
            ? gt(
                "Configuration is invalid, or its identity differs from the selected routine. Correct the advanced configuration or start a new draft.",
              )
            : gt("Choose a visible bot or channel before editing a routine.")}
        </RoutineText>
      )}
      <RoutineAction
        label={c.routineId ? gt("Save changes") : gt("Create routine")}
        disabled={
          editable || !c.canRun || !request || !form.name.trim() || !form.instruction.trim()
        }
        onClick={() => {
          if (request) void c.act(request);
        }}
      />
      {!c.canRun && c.canAdmin && (
        <RoutineText>
          <T>Bot operation access is required to save, delete or run routines.</T>
        </RoutineText>
      )}
      <RoutineAction
        label={gt("Run selected routine now")}
        disabled={selectedDisabled}
        onClick={() => void c.act({ operation: "events.test", owner: c.owner, id: c.routineId })}
      />
      <RoutineAction
        label={gt("Send signed webhook test")}
        disabled={selectedDisabled || trigger?.kind !== "webhook" || c.service?.connected === false}
        onClick={() =>
          void c.act({ operation: "events.sendTest", owner: c.owner, id: c.routineId })
        }
      />
      <RoutineAction
        label={gt("Rotate webhook secret")}
        disabled={selectedReadDisabled || trigger?.kind !== "webhook"}
        onClick={() =>
          void c.act({ operation: "events.rotateSecret", owner: c.owner, id: c.routineId })
        }
      />
      <RoutineAction
        label={gt("Load activity and receipts")}
        disabled={selectedReadDisabled}
        onClick={() =>
          void c.act({
            operation: "events.activity",
            owner: c.owner,
            routineId: c.routineId,
            limit: 50,
          })
        }
      />
      <RoutineAction
        label={gt("Load runs and recovery")}
        disabled={selectedReadDisabled}
        onClick={() =>
          void c.act({
            operation: "events.runs",
            owner: c.owner,
            routineId: c.routineId,
            limit: 50,
          })
        }
      />
      <RoutineAction
        label={gt("Delete selected routine")}
        disabled={selectedDisabled}
        onClick={() =>
          confirmDelete(
            () => void c.act({ operation: "events.delete", owner: c.owner, id: c.routineId }),
          )
        }
      />
      <RoutineText>
        <T>
          Webhook delivery and signed tests require a connected Openbot account on the host.
          Creating or rotating a webhook does not connect that account.
        </T>
      </RoutineText>
      {c.service?.connected === false && (
        <RoutineText alert>
          <T>
            The host event service is disconnected. Connect its Openbot account before testing
            webhook delivery.
          </T>
        </RoutineText>
      )}
      <RoutineAction
        label={gt("Check event service")}
        disabled={disabled}
        onClick={() => void c.act({ operation: "events.status" })}
      />
      {c.result !== null && <EventResult value={c.result} kind={c.resultKind} />}
      {c.configuration && (
        <RoutineGroup>
          <RoutineHeading>
            <T>Private webhook configuration</T>
          </RoutineHeading>
          <RoutineText>
            <T>
              <Var>{c.configuration.name}</Var> ·{" "}
              <Var>{c.owner.kind === "agent" ? gt("Bot") : gt("Channel")}</Var>:{" "}
              <Var>{c.ownerName}</Var>. Store this configuration privately before dismissing it.
            </T>
          </RoutineText>
          <RoutineAction
            label={c.revealed ? gt("Hide configuration") : gt("Reveal configuration")}
            onClick={() => c.setRevealed(!c.revealed)}
          />
          <RoutineAction
            label={gt("Copy private configuration")}
            onClick={() => {
              void copyPrivate(JSON.stringify(c.configuration?.value, null, 2)).then((ok) =>
                setNotice(ok ? gt("Configuration copied.") : gt("Could not copy configuration.")),
              );
            }}
          />
          {c.revealed && (
            <RoutineText>{JSON.stringify(c.configuration.value, null, 2)}</RoutineText>
          )}
          <RoutineAction label={gt("Dismiss configuration")} onClick={c.dismissConfiguration} />
        </RoutineGroup>
      )}
      {notice && <RoutineText>{notice}</RoutineText>}
    </RoutineGroup>
  );
}
function EventResult({ value, kind }: { value: unknown; kind: string | null }) {
  const gt = useGT();
  const rows = routineRows(value);
  const status =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  return (
    <RoutineGroup>
      <RoutineHeading>
        {kind === "events.runs"
          ? gt("Recent runs")
          : kind === "events.activity"
            ? gt("Event activity")
            : gt("Request result")}
      </RoutineHeading>
      {Array.isArray(value) && rows.length === 0 && (
        <RoutineText>
          <T>No records yet.</T>
        </RoutineText>
      )}
      {rows.map((row, index) => (
        <RoutineGroup key={String(row.id ?? index)}>
          <RoutineText>
            {String(row.routineName ?? row.eventType ?? "Routine")} ·{" "}
            {String(row.status ?? "Received")}
          </RoutineText>
          <RoutineText>{String(row.scheduledFor ?? row.occurredAt ?? "")}</RoutineText>
          {typeof row.error === "string" && row.error && (
            <RoutineText alert>{row.error}</RoutineText>
          )}
          {Boolean(row.reason) && (
            <RoutineText>
              <T>
                Not started: <Var>{String(row.reason)}</Var>
              </T>
            </RoutineText>
          )}
        </RoutineGroup>
      ))}
      {kind === "events.status" && status && (
        <RoutineText>
          {status.supported ? gt("Events supported") : gt("Events unavailable")} ·{" "}
          {status.connected ? gt("Connected") : gt("Disconnected")}
        </RoutineText>
      )}
      {kind === "events.sendTest" && status && (
        <RoutineText>
          {status.status === "started"
            ? gt("Webhook accepted and work started.")
            : gt("Webhook ignored: {String}", {
                String: String(status.reason ?? "no matching trigger"),
              })}
        </RoutineText>
      )}
      {kind === "events.test" && (
        <RoutineText>
          <T>Test request accepted. Load recent runs to follow its outcome.</T>
        </RoutineText>
      )}
      <RoutineDisclosure label={gt("Detailed response")}>
        <RoutineText>{JSON.stringify(value, null, 2)}</RoutineText>
      </RoutineDisclosure>
    </RoutineGroup>
  );
}
