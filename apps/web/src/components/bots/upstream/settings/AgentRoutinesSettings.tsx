/* oxlint-disable shadcn/no-unknown-classes -- Original AgentRoutinesSettings, RoutineRunHistory, and RoutineWebhookEvents selectors. */
/* oxlint-disable react/no-array-index-key -- Source filter rows use positional identity to keep focus while typing. */
import { useRef, useState, type ReactNode } from "react";
import { settlePromise, squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import * as Schema from "effect/Schema";
import {
  type EnvironmentId,
  OpenbotEventRoutine,
  OpenbotEventRoutineInput,
  OpenbotRoutineRun,
  OpenbotEventReceipt,
  OpenbotEventActivity,
  type OpenbotAdminRequest,
} from "@t3tools/contracts";
import {
  Clock3,
  Webhook,
  Check,
  X,
  TriangleAlert,
  CirclePause,
  Minus,
  Plus,
  SlidersHorizontal,
  ChevronRight,
  ChevronDown,
  Copy,
  RefreshCw,
} from "lucide-react";
import { confirmed } from "../../../settings/BotConnectionControls";
import { SourceButton } from "./SettingsParts";
import { SettingsPanelHeader, SettingsPanelContent } from "./SettingsPanel";
import { SourceSwitch } from "./SourceSwitch";
import { SourceSelect } from "../provider/SourceSelect";
import { AgentRoutinesList } from "./AgentRoutinesList";
import { useAgentSettingsValue } from "./agent-settings-api";
import { useSourceSettingsAdmin } from "./useSourceSettingsAdmin";
import { RoutineSchedulePicker, clockLabel, daysLabel } from "./RoutineSchedulePicker";
import {
  routineScheduleToDraft,
  routineDraftProblemCode,
  type RoutineSchedule,
} from "./routine-schedule-draft";
import {
  eventFilterDraftsValid,
  eventFilterPointerValid,
  type EventFilterDraft,
} from "./routine-event-filter";
import { settingsCapabilities } from "@t3tools/client-runtime/openbot/settings";
import { openbot } from "../../../../state/openbot";
import { useEnvironmentQuery } from "../../../../state/query";
import {
  RoutineResultDestinationField,
  decodeResultOptions,
  decodeResultDestination,
  type RoutineResultChoice,
} from "./RoutineResultDestinationField";
import { rt } from "./routine-text";
const decodeRows = Schema.decodeUnknownSync(Schema.Array(OpenbotEventRoutine));
const decodeInput = Schema.decodeUnknownSync(OpenbotEventRoutineInput);
const decodeSaved = Schema.decodeUnknownSync(
  Schema.Struct({ routine: OpenbotEventRoutine, secret: Schema.NullOr(Schema.String) }),
);
const decodeActivity = Schema.decodeUnknownSync(Schema.Array(OpenbotEventActivity));
const decodeRuns = Schema.decodeUnknownSync(Schema.Array(OpenbotRoutineRun));
const decodeSecret = Schema.decodeUnknownSync(Schema.Struct({ secret: Schema.String }));
const decodeReceipt = Schema.decodeUnknownSync(OpenbotEventReceipt);
const decodeConfiguration = Schema.decodeUnknownSync(
  Schema.Struct({
    owner: Schema.Struct({ kind: Schema.Literals(["agent", "channel"]), id: Schema.String }),
    id: Schema.String,
    webhookUrl: Schema.NullOr(Schema.String),
    relayService: Schema.optional(Schema.Literal("sled-connect")),
  }),
);
const decodeEventStatus = Schema.decodeUnknownSync(
  Schema.Struct({ supported: Schema.Boolean, connected: Schema.Boolean }),
);
const decodeEndpoint = Schema.decodeUnknownSync(
  Schema.Struct({
    routine: Schema.Struct({
      trigger: Schema.Struct({ url: Schema.optional(Schema.NullOr(Schema.String)) }),
    }),
  }),
);
type Routine = typeof OpenbotEventRoutine.Type;
import { draftFor, routineDraftInput, type Input, type Draft } from "./routine-editor-model";
function summary(routine: Routine) {
  if (routine.trigger.kind === "webhook") return routine.trigger.eventType || "Any webhook event";
  const schedule = routineScheduleToDraft(
    JSON.parse(JSON.stringify(routine.trigger.schedule)) as RoutineSchedule,
  );
  switch (schedule.kind) {
    case "daily":
      return `${daysLabel(schedule.days)} at ${clockLabel(schedule.time)}`;
    case "weekly":
      return `${daysLabel([schedule.weekday])} at ${clockLabel(schedule.time)}`;
    case "monthly":
      return `Day ${schedule.day} at ${clockLabel(schedule.time)}`;
    case "yearly":
      return `${schedule.month}/${schedule.day} at ${clockLabel(schedule.time)}`;
    case "hourly":
      return `Every ${schedule.everyHours} ${schedule.everyHours === 1 ? "hour" : "hours"} · ${daysLabel(schedule.days)}`;
    case "custom":
      return schedule.expression;
    case "once":
      return `${schedule.date} at ${clockLabel(schedule.time)}`;
  }
}
export interface AgentRoutinesSettingsProps {
  environmentId: EnvironmentId;
  hostId: string;
  agentId: string;
  timezone?: string;
  onBack: () => void;
  onClose: () => void;
  onOpenRun?: ((messageId: string) => void) | undefined;
  initialRoutineId?: string | null | undefined;
}
export function AgentRoutinesSettings(props: AgentRoutinesSettingsProps) {
  const host = useSourceSettingsAdmin(props.environmentId, props.hostId);
  const [scope, setScope] = useState({ connection: host.connection, epoch: 0 });
  if (scope.connection !== host.connection)
    setScope({ connection: host.connection, epoch: scope.epoch + 1 });
  return (
    <Routines
      key={`${props.environmentId}:${props.hostId}:${props.agentId}:${scope.epoch}`}
      {...props}
    />
  );
}
function Routines({
  environmentId,
  hostId,
  agentId,
  timezone,
  onBack,
  onClose,
  onOpenRun,
  initialRoutineId,
}: AgentRoutinesSettingsProps) {
  const host = useSourceSettingsAdmin(environmentId, hostId),
    owner = { kind: "agent" as const, id: agentId };
  const compatibility = useEnvironmentQuery(
    openbot.readFromHost({
      environmentId,
      input: { hostId, request: { operation: "compatibility.read" } },
    }),
  );
  const includeOneTime = settingsCapabilities(compatibility.data).includes("sled-once-routines-v1");
  const c = useAgentSettingsValue(
    async () =>
      decodeRows(
        await host.execute({
          operation: "events.list",
          owner,
          ...(includeOneTime ? { includeOneTime: true } : {}),
        }),
      ),
    `${agentId}:${includeOneTime}`,
  );
  const [draft, setDraft] = useState<Draft | null>(null),
    [baseline, setBaseline] = useState<string | null>(null),
    [error, setError] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [uncertain, setUncertain] = useState(false),
    [secret, setSecret] = useState<string | null>(null),
    [url, setUrl] = useState<string | null>(null),
    [confirmDelete, setConfirmDelete] = useState(false),
    [started, setStarted] = useState(false),
    [openedInitial, setOpenedInitial] = useState(false),
    [showErrors, setShowErrors] = useState(false);
  const [resultDraft, setResultDraft] = useState<RoutineResultChoice | null | undefined>(undefined);

  const hasResults = settingsCapabilities(compatibility.data).includes("routine-results-v1");
  const resultScope = draft ? `${agentId}:${draft.input.id ?? "new"}` : "";
  const results = useAgentSettingsValue(
    async () => {
      const [options, destination] = await Promise.all([
        host.setting("settings.routine-results.options", {}),
        draft?.input.id
          ? host.setting("settings.routine-results.destination", {
              agentId,
              routineId: draft.input.id,
            })
          : Promise.resolve({ destination: null }),
      ]);
      return {
        scope: resultScope,
        options: decodeResultOptions(options).connections,
        saved: decodeResultDestination(destination).destination,
      };
    },
    hasResults ? resultScope : "",
  );
  const resultValue = results.value?.scope === resultScope ? results.value : null;
  const lock = useRef(false);
  const start = (input: Input) => {
    const next = draftFor(input);
    setDraft(next);
    setResultDraft(undefined);
    setBaseline(input.id ? JSON.stringify(routineDraftInput(next)) : null);
    setSecret(null);
    setUrl(null);
    setError(null);
    setUncertain(false);
    setConfirmDelete(false);
    setStarted(false);
  };
  if (!openedInitial && initialRoutineId !== undefined && c.value) {
    setOpenedInitial(true);
    const selected = c.value.find((row) => row.id === initialRoutineId);
    if (selected) start(selected);
    else if (initialRoutineId === null)
      start({
        owner,
        name: "",
        instruction: "",
        active: true,
        timezone: timezone ?? new Intl.DateTimeFormat().resolvedOptions().timeZone,
        trigger: { kind: "schedule", schedule: { kind: "daily", time: "09:00" } },
        limitPolicy: "wait",
        missedPolicy: "run-once",
      });
  }
  const input = (() => {
    try {
      return draft ? routineDraftInput(draft) : null;
    } catch {
      return null;
    }
  })();
  const dirty = draft
    ? input
      ? JSON.stringify(input) !== baseline || resultDraft !== undefined
      : true
    : false;
  const valid = Boolean(
    draft &&
    input?.name &&
    input.instruction &&
    (input.trigger.kind === "webhook"
      ? eventFilterDraftsValid(draft.filters)
      : !routineDraftProblemCode(draft.schedule)),
  );
  const patch = (change: Partial<Input>) =>
    setDraft((current) =>
      current ? { ...current, input: { ...current.input, ...change } } : current,
    );
  const leave = async (action: () => void) => {
    if (lock.current) return;
    if (!dirty || (await confirmed("Discard unsaved routine changes?"))) action();
  };
  const list = () => {
    setDraft(null);
    setSecret(null);
    setUrl(null);
    setError(null);
    setUncertain(false);
    void c.refresh();
  };
  const act = async (action: () => Promise<void>, mayHaveRun = false) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError(null);
    const settled = await settlePromise(action);
    if (settled._tag === "Failure") {
      const cause = squashAtomCommandFailure(settled);
      if (mayHaveRun) setUncertain(true);
      setError(
        cause instanceof Error
          ? cause.message
          : "The request could not complete. Reload before retrying.",
      );
    }
    lock.current = false;
    setBusy(false);
  };
  const save = () => {
    setShowErrors(true);
    if (!input || !valid || uncertain) return;
    void act(async () => {
      const responseValue = await host.execute({
        operation: "events.save",
        ...input,
        ...(includeOneTime ? { includeOneTime: true } : {}),
      });
      const saved = decodeSaved(responseValue);
      if (
        saved.routine.owner.kind !== owner.kind ||
        saved.routine.owner.id !== owner.id ||
        (input.id && saved.routine.id !== input.id)
      )
        throw new Error("The saved routine could not be identified. Reload before retrying.");
      start(saved.routine);
      setSecret(saved.secret);
      const response = decodeEndpoint(responseValue);
      setUrl(response.routine.trigger.url ?? null);
      if (resultDraft !== undefined) {
        setResultDraft(resultDraft);
        await host.setting("settings.routine-results.setDestination", {
          agentId,
          routineId: saved.routine.id,
          destination: resultDraft ? { ...resultDraft } : null,
        });
        setResultDraft(undefined);
        await results.refresh();
      }
      await c.refresh();
    }, !input.id);
  };
  const canSave = draft ? host.can({ operation: "events.save", ...draft.input }) : false;
  if (!draft)
    return (
      <AgentRoutinesList
        routines={(c.value ?? []).map((row) => ({
          id: row.id,
          name: row.name,
          active: row.active,
          createdAt: row.createdAt,
          completed: false,
          triggerKind: row.trigger.kind,
          summary: summary(row),
        }))}
        loading={c.busy && !c.value}
        loadError={c.error}
        onBack={onBack}
        onRetry={() => void c.refresh()}
        onCreate={
          host.can({ operation: "events.list", owner })
            ? () =>
                start({
                  owner,
                  name: "",
                  instruction: "",
                  active: true,
                  timezone: timezone ?? new Intl.DateTimeFormat().resolvedOptions().timeZone,
                  trigger: { kind: "schedule", schedule: { kind: "daily", time: "09:00" } },
                  limitPolicy: "wait",
                  missedPolicy: "run-once",
                })
            : undefined
        }
        onOpen={(row) => {
          const record = c.value?.find((item) => item.id === row.id);
          if (record) start(record);
        }}
        onSetActive={async (id, active) => {
          const routine = c.value?.find((row) => row.id === id);
          if (!routine) throw new Error("Reload routines before changing this routine.");
          await host.execute({ operation: "events.save", ...decodeInput({ ...routine, active }) });
          await c.refresh();
        }}
      />
    );
  return (
    <div className="agent-routines-settings">
      <SettingsPanelHeader
        title="Routine"
        onBack={() => void leave(list)}
        onClose={() => void leave(onClose)}
      />
      <SettingsPanelContent>
        <div className="agent-routine-editor">
          <div className="agent-routine-editor-actions">
            <label className="agent-routine-active-toggle">
              <SourceSwitch
                label={draft.input.active ? "Active" : "Paused"}
                checked={draft.input.active}
                disabled={busy || !canSave || uncertain}
                onChange={(active) => patch({ active })}
              />
              {draft.input.active ? "Active" : "Paused"}
            </label>
            <div className="agent-routine-action-buttons">
              {confirmDelete ? (
                <>
                  <SourceButton
                    variant="destructive"
                    disabled={busy || !draft.input.id}
                    onClick={() =>
                      void act(async () => {
                        await host.execute({
                          operation: "events.delete",
                          owner,
                          id: draft.input.id!,
                        });
                        list();
                      })
                    }
                  >
                    Delete now
                  </SourceButton>
                  <SourceButton
                    variant="secondary"
                    disabled={busy}
                    onClick={() => setConfirmDelete(false)}
                  >
                    Cancel
                  </SourceButton>
                </>
              ) : (
                <>
                  <SourceButton
                    variant="destructive"
                    disabled={busy || !canSave}
                    onClick={() => (draft.input.id ? setConfirmDelete(true) : void leave(list))}
                  >
                    Delete
                  </SourceButton>
                  {dirty ? (
                    <SourceButton disabled={busy || !canSave || uncertain} onClick={save}>
                      {busy ? "Saving…" : "Save"}
                    </SourceButton>
                  ) : (
                    <SourceButton
                      className="agent-routine-test"
                      disabled={
                        busy ||
                        uncertain ||
                        !draft.input.id ||
                        !host.can({ operation: "events.test", owner, id: draft.input.id ?? "" })
                      }
                      onClick={() =>
                        void act(async () => {
                          await host.execute({
                            operation: "events.test",
                            owner,
                            id: draft.input.id!,
                          });
                          setStarted(true);
                        }, true)
                      }
                    >
                      {busy ? "Starting…" : "Test run"}
                    </SourceButton>
                  )}
                </>
              )}
            </div>
          </div>
          <label className="settings-field">
            <span>Name</span>
            <input
              className="ui-input"
              value={draft.input.name}
              maxLength={80}
              placeholder="Morning briefing"
              disabled={busy || uncertain || !canSave}
              aria-invalid={showErrors && !draft.input.name.trim()}
              onChange={(event) => patch({ name: event.target.value })}
            />
            {showErrors && !draft.input.name.trim() && (
              <p className="agent-routine-field-error">Enter a name.</p>
            )}
          </label>
          <section className="agent-routine-when" aria-labelledby="agent-routine-when-heading">
            <h3 id="agent-routine-when-heading">When to run</h3>
            <fieldset
              className="agent-routine-trigger-kind"
              disabled={busy || uncertain || !canSave}
            >
              <legend className="sr-only">Trigger</legend>
              {["schedule", "webhook"].map((kind) => (
                <SourceButton
                  key={kind}
                  variant={draft.input.trigger.kind === kind ? "secondary" : "ghost"}
                  aria-pressed={draft.input.trigger.kind === kind}
                  onClick={() => {
                    if (draft.input.trigger.kind === kind) return;
                    if (kind === "webhook")
                      patch({ trigger: { kind: "webhook", eventType: null, filters: [] } });
                    else
                      setDraft({
                        ...draft,
                        scheduleEdited: true,
                        input: {
                          ...draft.input,
                          trigger: { kind: "schedule", schedule: { kind: "daily", time: "09:00" } },
                        },
                      });
                  }}
                >
                  {kind === "schedule" ? (
                    <Clock3 className="agent-routine-trigger-kind-icon" />
                  ) : (
                    <Webhook className="agent-routine-trigger-kind-icon" />
                  )}
                  {kind === "schedule" ? "Schedule" : "Webhook"}
                </SourceButton>
              ))}
            </fieldset>
            {draft.input.trigger.kind === "schedule" ? (
              <RoutineSchedulePicker
                allowOnce={includeOneTime}
                schedule={draft.schedule}
                disabled={busy || uncertain || !canSave}
                onChange={(schedule) => setDraft({ ...draft, schedule, scheduleEdited: true })}
              />
            ) : (
              <WebhookEditor
                input={draft.input}
                filters={draft.filters}
                onFiltersChange={(filters) => setDraft({ ...draft, filters })}
                onEventTypeChange={(eventType) => {
                  if (draft.input.trigger.kind === "webhook")
                    patch({ trigger: { ...draft.input.trigger, eventType: eventType || null } });
                }}
                secret={secret}
                url={url}
                onDismissSecret={() => setSecret(null)}
                disabled={busy || uncertain || !canSave}
                onSave={save}
                onRotate={() =>
                  void act(async () => {
                    if (
                      await confirmed(
                        "Replace the webhook signing secret? Existing senders must use the new secret.",
                      )
                    )
                      setSecret(
                        decodeSecret(
                          await host.execute({
                            operation: "events.rotateSecret",
                            owner,
                            id: draft.input.id!,
                          }),
                        ).secret,
                      );
                  })
                }
                execute={host.execute}
              />
            )}
          </section>
          <label className="settings-field agent-routine-instruction-field">
            <span>Instruction</span>
            <textarea
              className="ui-textarea"
              value={draft.input.instruction}
              maxLength={100000}
              placeholder="Describe what this agent should do."
              disabled={busy || uncertain || !canSave}
              aria-invalid={showErrors && !draft.input.instruction.trim()}
              onChange={(event) => patch({ instruction: event.target.value })}
            />
            <span className="ui-text" data-variant="caption" data-tone="muted">
              {rt("routine.settings.instructionNoUpdateHint")}
            </span>
          </label>
          <Field label={rt("routine.settings.limitPolicy")}>
            <SourceSelect
              label={rt("routine.settings.limitPolicy")}
              value={draft.input.limitPolicy ?? "wait"}
              disabled={busy || uncertain || !canSave}
              options={[
                { id: "wait", name: rt("routine.settings.limitPolicy.wait") },
                { id: "skip", name: rt("routine.settings.limitPolicy.skip") },
              ]}
              onChange={(value) => patch({ limitPolicy: value === "skip" ? "skip" : "wait" })}
            />
          </Field>
          {draft.input.trigger.kind === "schedule" && (
            <Field label={rt("routine.settings.missedPolicy")}>
              <SourceSelect
                label={rt("routine.settings.missedPolicy")}
                value={draft.input.missedPolicy ?? "skip"}
                disabled={busy || uncertain || !canSave}
                options={[
                  { id: "skip", name: rt("routine.settings.missedPolicy.skip") },
                  { id: "run-once", name: rt("routine.settings.missedPolicy.runOnce") },
                ]}
                onChange={(value) =>
                  patch({ missedPolicy: value === "skip" ? "skip" : "run-once" })
                }
              />
            </Field>
          )}
          {hasResults && resultValue && (
            <RoutineResultDestinationField
              options={resultValue.options}
              saved={resultValue.saved}
              value={resultDraft === undefined ? resultValue.saved : resultDraft}
              onChange={setResultDraft}
              disabled={busy || uncertain || !canSave}
            />
          )}
          {hasResults && results.error && (
            <p role="alert">
              {results.error}
              <SourceButton onClick={() => void results.refresh()}>Retry</SourceButton>
            </p>
          )}
          <p className="ui-text" data-variant="caption" data-tone="muted">
            Times use {draft.input.timezone}.
          </p>
          {started && <p role="status">The test run has started.</p>}
          {error && (
            <p role="alert" className="agent-routine-field-error">
              {error}
            </p>
          )}
          {uncertain && (
            <p role="alert">
              The outcome is uncertain. Review the host’s routines before trying again.
              <SourceButton onClick={list}>Reload routines</SourceButton>
            </p>
          )}
          {draft.input.id && (
            <RoutineHistory
              key={`${draft.input.id}:${started}`}
              id={draft.input.id}
              webhook={draft.input.trigger.kind === "webhook"}
              owner={owner}
              execute={host.execute}
              onOpenRun={onOpenRun}
            />
          )}
        </div>
      </SettingsPanelContent>
    </div>
  );
}
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="settings-field">
      <span>{label}</span>
      {children}
    </div>
  );
}
function RoutineHistory({
  id,
  webhook,
  owner,
  execute,
  onOpenRun,
}: {
  id: string;
  webhook: boolean;
  owner: { kind: "agent"; id: string };
  execute: (request: OpenbotAdminRequest) => Promise<unknown>;
  onOpenRun?: ((id: string) => void) | undefined;
}) {
  const c = useAgentSettingsValue(async () => {
    const [runs, activity] = await Promise.allSettled([
      execute({ operation: "events.runs", owner, routineId: id, limit: 10 }),
      webhook
        ? execute({ operation: "events.activity", owner, routineId: id, limit: 50 })
        : Promise.resolve([]),
    ]);
    if (runs.status === "rejected") throw runs.reason;
    return {
      runs: decodeRuns(runs.value),
      activity: activity.status === "fulfilled" ? decodeActivity(activity.value) : [],
      activityError: activity.status === "rejected" ? rt("routine.history.activityFailed") : null,
    };
  }, `${id}:${webhook}`);
  const entries = [
    ...(c.value?.runs ?? []).map((run) => ({ kind: "run" as const, at: run.scheduledFor, run })),
    ...(c.value?.activity ?? [])
      .filter((item) => item.status === "ignored")
      .map((item) => ({ kind: "ignored" as const, at: item.occurredAt, item })),
  ]
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    .slice(0, 10);
  return (
    <section className="agent-routine-history">
      <h3>{rt("routine.history.title")}</h3>
      {c.error && (
        <p role="alert">
          {c.error}
          <SourceButton onClick={() => void c.refresh()}>Retry</SourceButton>
        </p>
      )}
      <div className="agent-routine-run-list">
        {c.value?.activityError && <p role="alert">{c.value.activityError}</p>}
        {entries.map((entry) => {
          if (entry.kind === "ignored")
            return (
              <div key={entry.item.id} className="agent-routine-run-row">
                <span className="agent-routine-run-text">
                  <span>{new Date(entry.at).toLocaleString()}</span>
                  <span className="agent-routine-run-note">
                    {rt(
                      entry.item.reason
                        ? `routine.history.ignored.${entry.item.reason === "event-type" ? "eventType" : entry.item.reason}`
                        : "routine.history.ignored",
                    )}
                  </span>
                </span>
                <span
                  className="agent-routine-run-icon agent-routine-run-icon-ignored"
                  aria-hidden="true"
                >
                  <Minus />
                </span>
              </div>
            );
          const run = entry.run;
          const Icon =
            run.status === "succeeded"
              ? Check
              : run.status === "failed"
                ? TriangleAlert
                : run.status === "cancelled"
                  ? X
                  : run.status === "needs-attention"
                    ? CirclePause
                    : run.missed
                      ? Minus
                      : Clock3;
          const content = (
            <>
              <span className="agent-routine-run-text">
                <span>
                  {new Date(run.scheduledFor).toLocaleString()}
                  {run.kind === "manual"
                    ? ` · ${run.source === "script" ? "Script" : run.source === "webhook" ? "Webhook" : "Manual"}`
                    : ""}
                </span>
                {run.error && <span className="agent-routine-run-note">{run.error}</span>}
                {run.missed && (
                  <span className="agent-routine-run-note">
                    {rt("routine.history.skipped", { count: run.missed.count })}
                  </span>
                )}
              </span>
              <span
                className={`agent-routine-run-icon agent-routine-run-icon-${run.status}`}
                aria-label={run.status}
              >
                <Icon aria-hidden="true" />
              </span>
            </>
          );
          return onOpenRun && run.deliveryId ? (
            <SourceButton
              key={run.id}
              variant="ghost"
              className="agent-routine-run-row agent-routine-run-link"
              onClick={() => onOpenRun(run.deliveryId!)}
            >
              {content}
            </SourceButton>
          ) : (
            <div key={run.id} className="agent-routine-run-row">
              {content}
            </div>
          );
        })}
        {c.value && entries.length === 0 && <p className="agent-routines-empty">No runs yet.</p>}
      </div>
    </section>
  );
}
function WebhookEditor({
  input,
  filters,
  onFiltersChange,
  onEventTypeChange,
  secret,
  url: savedUrl,
  onDismissSecret,
  disabled,
  onSave,
  onRotate,
  execute,
}: {
  input: Input;
  filters: EventFilterDraft[];
  onFiltersChange: (filters: EventFilterDraft[]) => void;
  onEventTypeChange: (value: string) => void;
  secret: string | null;
  url: string | null;
  onDismissSecret: () => void;
  disabled: boolean;
  onSave: () => void;
  onRotate: () => void;
  execute: (request: OpenbotAdminRequest) => Promise<unknown>;
}) {
  const [eventsOpen, setEventsOpen] = useState(false),
    [copied, setCopied] = useState<ReadonlySet<string>>(new Set()),
    [test, setTest] = useState<string | null>(null),
    [testing, setTesting] = useState(false),
    [error, setError] = useState<string | null>(null);
  const endpoint = useAgentSettingsValue(async () => {
    if (!input.id) return null;
    const configuration = await execute({
      operation: "events.configuration",
      owner: input.owner,
      id: input.id,
    });
    const result = decodeConfiguration(configuration);
    if (
      result.id !== input.id ||
      result.owner.kind !== input.owner.kind ||
      result.owner.id !== input.owner.id
    )
      throw new Error("The endpoint belongs to another routine.");
    if (result.relayService === "sled-connect")
      return { url: result.webhookUrl, connected: null, usesSledConnect: true };
    const status = await execute({ operation: "events.status" });
    return {
      url: result.webhookUrl,
      connected: decodeEventStatus(status).connected,
      usesSledConnect: false,
    };
  }, input.id ?? "");
  const url = savedUrl ?? endpoint.value?.url ?? null;
  const inputRef = useRef<HTMLInputElement>(null),
    lock = useRef(false);
  const copy = async (kind: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied((current) => new Set([...current, kind]));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not copy.");
    }
  };
  const send = async () => {
    const routineId = input.id;
    if (lock.current || !routineId) return;
    lock.current = true;
    setTesting(true);
    const settled = await settlePromise(async () => {
      const result = decodeReceipt(
        await execute({ operation: "events.sendTest", owner: input.owner, id: routineId }),
      );
      setTest(
        result.status === "started"
          ? `Started · ${result.eventType}`
          : `Ignored · ${result.reason}`,
      );
    });
    if (settled._tag === "Failure") {
      const cause = squashAtomCommandFailure(settled);
      setError(cause instanceof Error ? cause.message : "Could not send the test.");
    }
    lock.current = false;
    setTesting(false);
  };
  const eventType = input.trigger.kind === "webhook" ? (input.trigger.eventType ?? "") : "";
  return (
    <div className="routine-trigger-card">
      <div className="routine-trigger-card-header">
        <span className="routine-trigger-icon" aria-hidden="true">
          <Webhook />
        </span>
        <span className="routine-trigger-card-title">
          {rt("routine.trigger.webhookDescription")}
        </span>
      </div>
      <ol className="routine-webhook-steps">
        {[
          {
            id: "url",
            title: rt("routine.webhook.stepUrl"),
            body: input.id ? (
              <>
                <div className="routine-webhook-inset">
                  <div className="routine-webhook-field">
                    <span className="routine-webhook-label">{rt("routine.webhook.url")}</span>
                    {url ? (
                      <>
                        <code className="routine-webhook-value">
                          {url.replace(/^https:\/\//, "")}
                        </code>
                        <SourceButton
                          variant="ghost"
                          aria-label={rt("routine.webhook.copyUrl")}
                          onClick={() => void copy("url", url)}
                        >
                          {copied.has("url") ? <Check /> : <Copy />}
                        </SourceButton>
                      </>
                    ) : (
                      <span className="routine-webhook-value" role="status">
                        {endpoint.value?.usesSledConnect
                          ? "Link this host to Sled Connect for a public URL."
                          : rt(
                              endpoint.value?.connected === false
                                ? "routine.webhook.urlPendingOffline"
                                : "routine.webhook.urlPending",
                            )}
                      </span>
                    )}
                  </div>
                </div>
                {endpoint.error && (
                  <p role="alert">
                    {endpoint.error}
                    <SourceButton onClick={() => void endpoint.refresh()}>Retry</SourceButton>
                  </p>
                )}
                <p
                  className="ui-text"
                  data-variant="caption"
                  data-tone={endpoint.value?.connected === false ? "warning" : "muted"}
                >
                  {endpoint.value?.usesSledConnect
                    ? "Public webhook delivery uses Sled Connect. Local tests do not require a cloud account."
                    : rt(
                        endpoint.value?.connected === false
                          ? "routine.webhook.relayOffline"
                          : "routine.webhook.stepUrlHint",
                      )}
                </p>
              </>
            ) : (
              <>
                <p>{rt("routine.webhook.urlAfterSave")}</p>
                <SourceButton disabled={disabled} onClick={onSave}>
                  {rt("routine.webhook.saveForUrl")}
                </SourceButton>
              </>
            ),
          },
          {
            id: "secret",
            title: rt("routine.webhook.stepSecret"),
            body: (
              <>
                <p>{rt("routine.webhook.stepSecretHint")}</p>
                {input.id && (
                  <div className="routine-webhook-inset">
                    <div className="routine-webhook-field">
                      <span className="routine-webhook-label">
                        {rt("routine.webhook.secretTitle")}
                      </span>
                      {secret ? (
                        <>
                          <code className="routine-webhook-value routine-webhook-secret">
                            {secret}
                          </code>
                          <SourceButton
                            variant="ghost"
                            aria-label={rt("routine.webhook.copySecret")}
                            onClick={() => void copy("secret", secret)}
                          >
                            {copied.has("secret") ? <Check /> : <Copy />}
                          </SourceButton>
                        </>
                      ) : (
                        <>
                          <code className="routine-webhook-value" aria-hidden="true">
                            whsec_••••••••••••
                          </code>
                          <span className="sr-only">{rt("routine.webhook.secretHidden")}</span>
                          <SourceButton
                            variant="ghost"
                            disabled={disabled}
                            aria-label={rt("routine.webhook.regenerateSecret")}
                            onClick={onRotate}
                          >
                            <RefreshCw aria-hidden="true" />
                          </SourceButton>
                        </>
                      )}
                    </div>
                    {secret && (
                      <div className="routine-webhook-note routine-webhook-secret-note">
                        <span className="ui-text" data-variant="caption" data-tone="warning">
                          {rt("routine.webhook.secretWarning")}
                        </span>
                        <SourceButton variant="ghost" size="xs" onClick={onDismissSecret}>
                          Done
                        </SourceButton>
                      </div>
                    )}
                  </div>
                )}
              </>
            ),
          },
          {
            id: "test",
            title: rt("routine.webhook.stepTest"),
            body: (
              <>
                <SourceButton
                  disabled={disabled || testing || !input.id}
                  onClick={() => void send()}
                >
                  {testing ? "Sending…" : "Send test event"}
                </SourceButton>
                {test && <p role="status">{test}</p>}
              </>
            ),
          },
        ].map((step, index) => (
          <li key={step.id} data-disabled={!input.id && step.id !== "url" ? "" : undefined}>
            <span
              className="routine-webhook-step-marker"
              data-done={copied.has(step.id) ? "" : undefined}
            >
              {copied.has(step.id) ? <Check aria-hidden="true" /> : index + 1}
            </span>
            <div className="routine-webhook-step-body">
              <strong>{step.title}</strong>
              {step.body}
            </div>
          </li>
        ))}
      </ol>
      {eventType || filters.length || eventsOpen ? (
        <SourceButton
          variant="ghost"
          className="routine-webhook-field routine-webhook-events-toggle"
          aria-expanded={eventsOpen}
          onClick={() => setEventsOpen(!eventsOpen)}
        >
          <span className="routine-webhook-label">Events</span>
          <span className="routine-webhook-value">
            {eventType || "All events"}
            {filters.length ? ` · ${filters.length} filters` : ""}
          </span>
          {eventsOpen ? <ChevronDown /> : <ChevronRight />}
        </SourceButton>
      ) : (
        <SourceButton
          variant="ghost"
          className="routine-webhook-filter-link"
          onClick={() => {
            setEventsOpen(true);
            requestAnimationFrame(() => inputRef.current?.focus());
          }}
        >
          <SlidersHorizontal />
          Filter events
        </SourceButton>
      )}
      {eventsOpen && (
        <div className="routine-webhook-events">
          <label className="settings-field">
            <span>Event type</span>
            <input
              ref={inputRef}
              className="ui-input"
              disabled={disabled}
              value={eventType}
              placeholder="order.created"
              onChange={(event) => onEventTypeChange(event.target.value)}
            />
          </label>
          <div className="settings-field">
            <span>Filters</span>
            {filters.map((filter, index) => (
              <div className="routine-webhook-filter" key={index}>
                <div className="agent-routine-event-filter">
                  <input
                    className="ui-input"
                    aria-label="JSON pointer"
                    placeholder="/data/order/status"
                    aria-invalid={!eventFilterPointerValid(filter.pointer)}
                    value={filter.pointer}
                    disabled={disabled}
                    onChange={(event) =>
                      onFiltersChange(
                        filters.map((row, i) =>
                          i === index ? { ...row, pointer: event.target.value } : row,
                        ),
                      )
                    }
                  />
                  <input
                    className="ui-input"
                    aria-label="Filter value"
                    value={filter.value}
                    disabled={disabled}
                    onChange={(event) =>
                      onFiltersChange(
                        filters.map((row, i) =>
                          i === index ? { ...row, value: event.target.value } : row,
                        ),
                      )
                    }
                  />
                  <SourceButton
                    variant="ghost"
                    aria-label="Remove filter"
                    disabled={disabled}
                    onClick={() => onFiltersChange(filters.filter((_, i) => i !== index))}
                  >
                    <X />
                  </SourceButton>
                </div>
              </div>
            ))}
            <SourceButton
              variant="ghost"
              disabled={disabled || filters.length >= 128}
              onClick={() => onFiltersChange([...filters, { pointer: "", value: "" }])}
            >
              <Plus />
              Add filter
            </SourceButton>
          </div>
        </div>
      )}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
