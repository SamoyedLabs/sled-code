import { useId, useState, type ReactNode } from "react";
import type { EnvironmentId } from "@t3tools/contracts";
import { routineRows } from "@t3tools/client-runtime/openbot/presentation";
import { useBotEvents } from "./useBotRoutines";
import { requestConfirmDialog } from "../../confirmDialog";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import { Checkbox } from "../ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
export function RoutineGroup({ children }: { children: ReactNode }) {
  return <div className="space-y-3">{children}</div>;
}
export function RoutineText({ children, alert = false }: { children: ReactNode; alert?: boolean }) {
  return (
    <p role={alert ? "alert" : undefined} className="whitespace-pre-wrap break-words text-sm">
      {children}
    </p>
  );
}
export function RoutineHeading({ children }: { children: ReactNode }) {
  return <h3 className="text-sm font-medium">{children}</h3>;
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
  return (
    <Button variant="outline" size="sm" onClick={onClick} disabled={disabled}>
      {label}
    </Button>
  );
}
export function RoutineDisclosure({ label, children }: { label: string; children: ReactNode }) {
  const [expanded, setExpanded] = useState(false);
  const id = useId();
  return (
    <section className="space-y-3" aria-label={label}>
      <Button
        variant="outline"
        size="sm"
        aria-expanded={expanded}
        aria-controls={id}
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? `Close ${label.toLowerCase()}` : label}
      </Button>
      {expanded && <div id={id}>{children}</div>}
    </section>
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
    <label className="block space-y-1 text-sm">
      <span>{label}</span>
      {multiline ? (
        <Textarea
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          rows={5}
        />
      ) : (
        <Input
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </label>
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
    <label className="block space-y-1 text-sm">
      <span>{label}</span>
      <Select
        value={value || "__none"}
        disabled={disabled}
        onValueChange={(next) => {
          if (next) onChange(next === "__none" ? "" : next);
        }}
      >
        <SelectTrigger aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {!options.some((option) => option.id === "") && (
            <SelectItem value="__none">Choose {label.toLowerCase()}</SelectItem>
          )}
          {options.map((option) => (
            <SelectItem key={option.id || "__none"} value={option.id || "__none"}>
              {option.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
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
    <label className="flex items-center gap-2 text-sm">
      <Checkbox aria-label={label} checked={value} onCheckedChange={onChange} disabled={disabled} />
      {label}
    </label>
  );
}
function confirmDelete(action: () => void) {
  void (
    requestConfirmDialog("Delete this routine and its trigger?", {
      variant: "destructive",
    }) ?? Promise.resolve(false)
  ).then((confirmed) => {
    if (confirmed) action();
  });
}
function copyPrivate(text: string) {
  return navigator.clipboard.writeText(text).then(
    () => true,
    () => false,
  );
}
type Props = { environmentId: EnvironmentId; hostId: string };
export function BotEvents(props: Props) {
  return (
    <RoutineDisclosure label="Event routines and recovery">
      <EventPanel key={`${props.environmentId}:${props.hostId}`} {...props} />
    </RoutineDisclosure>
  );
}
function EventPanel({ environmentId, hostId }: Props) {
  const c = useBotEvents(environmentId, hostId);
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
        Choose who owns the routine, then set its trigger and instructions. Running a test starts
        real bot work.
      </RoutineText>
      {!c.canAdmin && (
        <RoutineText alert>Settings access is required to manage event routines.</RoutineText>
      )}
      <RoutineAction label="Refresh bots and channels" onClick={c.refresh} disabled={c.busy} />
      {c.error && <RoutineText alert>{c.error}</RoutineText>}
      <RoutineChoice
        label="Routine owner type"
        value={c.owner.kind}
        options={[
          { id: "agent", name: "Bot" },
          { id: "channel", name: "Channel" },
        ]}
        disabled={c.busy}
        onChange={(kind) => c.selectOwner(kind === "channel" ? "channel" : "agent", "")}
      />
      <RoutineChoice
        label={c.owner.kind === "agent" ? "Bot" : "Channel"}
        value={c.owner.id}
        options={c.owners}
        disabled={c.busy}
        onChange={(id) => c.selectOwner(c.owner.kind, id)}
      />
      {c.owners.length === 0 && (
        <RoutineText>
          No visible {c.owner.kind === "agent" ? "bots" : "channels"}. Create one in the workspace
          or refresh the connection.
        </RoutineText>
      )}
      <RoutineAction
        label="Load routines"
        disabled={disabled || !c.ownerAvailable}
        onClick={() => void c.act({ operation: "events.list", owner: c.owner })}
      />
      <RoutineChoice
        label="Routine"
        value={c.routineId}
        options={c.rows.map((row) => ({
          id: String(row.id),
          name: `${String(row.name || "Untitled routine")} · ${row.active ? "Active" : "Paused"}`,
        }))}
        disabled={c.busy}
        onChange={c.selectRoutine}
      />
      <RoutineAction
        label="New scheduled routine"
        disabled={disabled || !c.ownerAvailable}
        onClick={() => c.newRoutine("schedule")}
      />
      <RoutineAction
        label="New webhook routine"
        disabled={disabled || !c.ownerAvailable}
        onClick={() => c.newRoutine("webhook")}
      />
      <RoutineHeading>{c.routineId ? `Edit ${selectedName}` : "New routine"}</RoutineHeading>
      {c.readOnly && (
        <RoutineText alert>
          This routine uses configuration this client cannot safely edit. Its complete data is
          preserved below; use an updated client to change it.
        </RoutineText>
      )}
      {!c.readOnly && (
        <RoutineGroup>
          <RoutineField
            label="Routine name"
            value={form.name}
            onChange={(name) => c.patch({ name })}
            disabled={editable}
          />
          <RoutineField
            label="Instructions"
            value={form.instruction}
            onChange={(instruction) => c.patch({ instruction })}
            multiline
            disabled={editable}
          />
          <RoutineToggle
            label="Routine active"
            value={form.active}
            onChange={(active) => c.patch({ active })}
            disabled={editable}
          />
          <RoutineField
            label="Time zone"
            value={form.timezone}
            onChange={(timezone) => c.patch({ timezone })}
            disabled={editable}
          />
          <RoutineChoice
            label="Trigger"
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
                label="Event type (leave empty for any event)"
                value={trigger.eventType ?? ""}
                onChange={(eventType) =>
                  c.patch({ trigger: { ...trigger, eventType: eventType || null } })
                }
                disabled={editable}
              />
              <RoutineText>
                {trigger.filters.length} payload{" "}
                {trigger.filters.length === 1 ? "filter" : "filters"} retained. Change payload
                filters in advanced configuration.
              </RoutineText>
            </RoutineGroup>
          )}
          {schedule && (
            <RoutineGroup>
              <RoutineChoice
                label="Schedule"
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
                  label="Time (24-hour HH:MM)"
                  value={schedule.time}
                  onChange={(time) => patchSchedule({ time })}
                  disabled={editable}
                />
              )}
              {schedule.kind === "weekly" && (
                <RoutineChoice
                  label="Day"
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
                    label="Repeat every"
                    value={String(schedule.amount)}
                    onChange={(amount) => patchSchedule({ amount: Number(amount) })}
                    disabled={editable}
                  />
                  <RoutineChoice
                    label="Interval unit"
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
                  <RoutineDisclosure label="Interval start time">
                    <RoutineText>
                      The first occurrence is retained when you edit the interval. Change it only to
                      move the schedule's start.
                    </RoutineText>
                    <RoutineField
                      label="First occurrence (ISO date and time)"
                      value={schedule.anchorAt}
                      onChange={(anchorAt) => patchSchedule({ anchorAt })}
                      disabled={editable}
                    />
                  </RoutineDisclosure>
                </RoutineGroup>
              )}
              {schedule.kind === "custom" && (
                <RoutineField
                  label="Cron expression"
                  value={schedule.expression}
                  onChange={(expression) => patchSchedule({ expression })}
                  disabled={editable}
                />
              )}
            </RoutineGroup>
          )}
          <RoutineChoice
            label="When a scheduled occurrence was missed"
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
            label="When the bot is at its work limit"
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
      <RoutineDisclosure label={c.readOnly ? "Preserved configuration" : "Advanced configuration"}>
        <RoutineText>
          Keep the selected routine identity. Editing common fields retains its existing trigger
          filters and policies. Unrecognized future fields cannot be saved by this client.
        </RoutineText>
        <RoutineField
          label="Complete routine configuration"
          value={c.draft}
          onChange={c.updateDraft}
          multiline
          disabled={editable}
        />
      </RoutineDisclosure>
      {!request && !c.readOnly && (
        <RoutineText alert>
          {c.ownerAvailable
            ? "Configuration is invalid, or its identity differs from the selected routine. Correct the advanced configuration or start a new draft."
            : "Choose a visible bot or channel before editing a routine."}
        </RoutineText>
      )}
      <RoutineAction
        label={c.routineId ? "Save changes" : "Create routine"}
        disabled={
          editable || !c.canRun || !request || !form.name.trim() || !form.instruction.trim()
        }
        onClick={() => {
          if (request) void c.act(request);
        }}
      />
      {!c.canRun && c.canAdmin && (
        <RoutineText>Bot operation access is required to save, delete or run routines.</RoutineText>
      )}
      <RoutineAction
        label="Run selected routine now"
        disabled={selectedDisabled}
        onClick={() => void c.act({ operation: "events.test", owner: c.owner, id: c.routineId })}
      />
      <RoutineAction
        label="Send signed webhook test"
        disabled={selectedDisabled || trigger?.kind !== "webhook" || c.service?.connected === false}
        onClick={() =>
          void c.act({ operation: "events.sendTest", owner: c.owner, id: c.routineId })
        }
      />
      <RoutineAction
        label="Rotate webhook secret"
        disabled={selectedReadDisabled || trigger?.kind !== "webhook"}
        onClick={() =>
          void c.act({ operation: "events.rotateSecret", owner: c.owner, id: c.routineId })
        }
      />
      <RoutineAction
        label="Load activity and receipts"
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
        label="Load runs and recovery"
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
        label="Delete selected routine"
        disabled={selectedDisabled}
        onClick={() =>
          confirmDelete(
            () => void c.act({ operation: "events.delete", owner: c.owner, id: c.routineId }),
          )
        }
      />
      <RoutineText>
        Webhook delivery and signed tests require a connected Openbot account on the host. Creating
        or rotating a webhook does not connect that account.
      </RoutineText>
      {c.service?.connected === false && (
        <RoutineText alert>
          The host event service is disconnected. Connect its Openbot account before testing webhook
          delivery.
        </RoutineText>
      )}
      <RoutineAction
        label="Check event service"
        disabled={disabled}
        onClick={() => void c.act({ operation: "events.status" })}
      />
      {c.result !== null && <EventResult value={c.result} kind={c.resultKind} />}
      {c.configuration && (
        <RoutineGroup>
          <RoutineHeading>Private webhook configuration</RoutineHeading>
          <RoutineText>
            {c.configuration.name} · {c.owner.kind === "agent" ? "Bot" : "Channel"}: {c.ownerName}.
            Store this configuration privately before dismissing it.
          </RoutineText>
          <RoutineAction
            label={c.revealed ? "Hide configuration" : "Reveal configuration"}
            onClick={() => c.setRevealed(!c.revealed)}
          />
          <RoutineAction
            label="Copy private configuration"
            onClick={() => {
              void copyPrivate(JSON.stringify(c.configuration?.value, null, 2)).then((ok) =>
                setNotice(ok ? "Configuration copied." : "Could not copy configuration."),
              );
            }}
          />
          {c.revealed && (
            <RoutineText>{JSON.stringify(c.configuration.value, null, 2)}</RoutineText>
          )}
          <RoutineAction label="Dismiss configuration" onClick={c.dismissConfiguration} />
        </RoutineGroup>
      )}
      {notice && <RoutineText>{notice}</RoutineText>}
    </RoutineGroup>
  );
}
function EventResult({ value, kind }: { value: unknown; kind: string | null }) {
  const rows = routineRows(value);
  const status =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  return (
    <RoutineGroup>
      <RoutineHeading>
        {kind === "events.runs"
          ? "Recent runs"
          : kind === "events.activity"
            ? "Event activity"
            : "Request result"}
      </RoutineHeading>
      {Array.isArray(value) && rows.length === 0 && <RoutineText>No records yet.</RoutineText>}
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
          {Boolean(row.reason) && <RoutineText>Not started: {String(row.reason)}</RoutineText>}
        </RoutineGroup>
      ))}
      {kind === "events.status" && status && (
        <RoutineText>
          {status.supported ? "Events supported" : "Events unavailable"} ·{" "}
          {status.connected ? "Connected" : "Disconnected"}
        </RoutineText>
      )}
      {kind === "events.sendTest" && status && (
        <RoutineText>
          {status.status === "started"
            ? "Webhook accepted and work started."
            : `Webhook ignored: ${String(status.reason ?? "no matching trigger")}`}
        </RoutineText>
      )}
      {kind === "events.test" && (
        <RoutineText>Test request accepted. Load recent runs to follow its outcome.</RoutineText>
      )}
      <RoutineDisclosure label="Detailed response">
        <RoutineText>{JSON.stringify(value, null, 2)}</RoutineText>
      </RoutineDisclosure>
    </RoutineGroup>
  );
}
