/* oxlint-disable shadcn/no-unknown-classes -- Pinned AgentSettingsPanel and AgentInstructionsView selectors are supplied by source stylesheets. */
import { useState } from "react";
import * as Schema from "effect/Schema";
import ReactMarkdown from "react-markdown";
import { FileText } from "lucide-react";
import { instructionView, permissionView } from "@t3tools/client-runtime/openbot/presentation";
import type { OpenbotSettingsRequest } from "@t3tools/contracts/openbot-settings";
import { confirmed } from "../../../settings/BotConnectionControls";
import { useAgentSettingsValue, type AgentSettingsApi } from "./agent-settings-api";
import { SettingsLinkGroup, SettingsPanelContent, SettingsPanelHeader } from "./SettingsPanel";
import { SourceButton } from "./SettingsParts";
import { SourceSwitch } from "./SourceSwitch";
const HostTools = Schema.Struct({
  computerUse: Schema.Boolean,
  allowAutomation: Schema.Boolean,
  busyMessageMode: Schema.NullOr(Schema.Literals(["queue", "steer"])),
  defaultBusyMessageMode: Schema.Literals(["queue", "steer"]),
});
const decodeHostTools = Schema.decodeUnknownSync(HostTools);
const decodeRecord = Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Json));
const decodeTaskLimit = Schema.decodeUnknownSync(
  Schema.Struct({ taskLimit: Schema.NullOr(Schema.Number) }),
);
export function SettingsReadState({
  busy,
  error,
  onRetry,
}: {
  busy: boolean;
  error: string | null;
  onRetry: () => void;
}) {
  return error ? (
    <p role="alert" className="agent-settings-save-error">
      {error}
      <SourceButton onClick={onRetry}>Retry</SourceButton>
    </p>
  ) : busy ? (
    <p className="ui-text" data-variant="caption" data-tone="muted" role="status">
      Loading…
    </p>
  ) : null;
}
function HostToolSwitches({ api }: { api: AgentSettingsApi }) {
  const c = useAgentSettingsValue(
    async () => decodeHostTools(await api.setting("settings.agent-host-settings.settings")),
    api.agentId,
  );
  return (
    <>
      <SettingsReadState
        busy={c.busy && !c.value}
        error={c.error}
        onRetry={() => void c.refresh()}
      />
      {c.value && (
        <>
          <SettingToggle
            label="Computer Use"
            description="Let this agent control apps on this computer"
            value={c.value.computerUse}
            disabled={c.busy}
            onChange={(computerUse) =>
              void c.change(() =>
                api.setting("settings.agent-host-settings.update", {
                  agentId: api.agentId,
                  computerUse,
                }),
              )
            }
          />
          <SettingToggle
            label="Local scripts"
            description="Let scripts on the host send messages, run routines, answer questions, and accept or decline approvals"
            value={c.value.allowAutomation}
            disabled={c.busy}
            onChange={(allowAutomation) =>
              void c.change(() =>
                api.setting("settings.agent-host-settings.update", {
                  agentId: api.agentId,
                  allowAutomation,
                }),
              )
            }
          />
        </>
      )}
    </>
  );
}
export function AgentPermissionsPage({ api }: { api: AgentSettingsApi }) {
  const c = useAgentSettingsValue(async () => {
    const value = permissionView(
      await api.admin({ operation: "agent.permissions.read", agentId: api.agentId }),
    );
    if (!value) throw new Error("This host returned unsupported permission settings.");
    return value;
  }, api.agentId);
  const value = c.value;
  const level = value?.access === "workspace" ? "workspace" : value?.autoApprove ? "full" : "ask";
  const change = async (next: string) => {
    if (!value || !["workspace", "ask", "full"].includes(next)) return;
    const widens =
      (level === "workspace" && next !== "workspace") || (level === "ask" && next === "full");
    if (
      widens &&
      !(await confirmed(
        next === "full"
          ? "Allow full access? The agent can change files outside its workspace without asking for approval."
          : "Allow access outside the workspace? The agent asks before sensitive actions.",
      ))
    )
      return;
    await c.change(() =>
      api.admin({
        operation: "agent.permissions.update",
        agentId: api.agentId,
        ...(next === "workspace"
          ? { access: "workspace" as const }
          : { access: "full" as const, autoApprove: next === "full" }),
      }),
    );
  };
  return (
    <>
      <SettingsReadState busy={c.busy && !value} error={c.error} onRetry={() => void c.refresh()} />
      {value && (
        <>
          <SettingsLinkGroup inset className="agent-settings-runtime-rows">
            <label className="agent-settings-runtime-row">
              <span className="agent-settings-runtime-label">Access</span>
              <select
                className="ui-native-select"
                aria-label="Agent access"
                value={level}
                disabled={
                  c.busy ||
                  value.autoApproveLocked ||
                  !api.canAdmin({
                    operation: "agent.permissions.update",
                    agentId: api.agentId,
                    access: value.access,
                  })
                }
                onChange={(event) => void change(event.target.value)}
              >
                <option value="workspace">Workspace only</option>
                <option value="ask">Ask first</option>
                <option value="full">Full access</option>
              </select>
            </label>
          </SettingsLinkGroup>
          <p
            className="agent-settings-runtime-note ui-text"
            data-variant="caption"
            data-tone="muted"
          >
            {value.autoApproveLocked
              ? "Approval settings are locked by this host."
              : level === "workspace"
                ? "The agent works in its workspace and the folders you allow. Computer Use and the OpenBot browser are not limited; you can turn Computer Use off below."
                : level === "ask"
                  ? "The agent can work outside its workspace and asks before sensitive actions."
                  : "The agent can work outside its workspace without asking for approval."}
          </p>
        </>
      )}
      {api.capabilities.includes("agent-host-settings-v1") && <HostToolSwitches api={api} />}
    </>
  );
}
export function SettingToggle({
  label,
  description,
  value,
  disabled,
  onChange,
}: {
  label: string;
  description: string;
  value: boolean;
  disabled: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="agent-settings-notifications">
      <div>
        <strong>{label}</strong>
        <span>{description}</span>
      </div>
      <SourceSwitch label={label} checked={value} disabled={disabled} onChange={onChange} />
    </div>
  );
}
function AdvancedBoolean({
  api,
  read,
  update,
  field,
  label,
  description,
}: {
  api: AgentSettingsApi;
  read: OpenbotSettingsRequest["operation"];
  update: OpenbotSettingsRequest["operation"];
  field: string;
  label: string;
  description: string;
}) {
  const c = useAgentSettingsValue(async () => decodeRecord(await api.setting(read)), read);
  const value = c.value?.[field];
  return (
    <>
      <SettingsReadState
        busy={c.busy && !c.value}
        error={c.error}
        onRetry={() => void c.refresh()}
      />
      {typeof value === "boolean" && (
        <SettingToggle
          label={label}
          description={description}
          value={value}
          disabled={c.busy}
          onChange={(next) =>
            void c.change(() => api.setting(update, { agentId: api.agentId, [field]: next }))
          }
        />
      )}
    </>
  );
}
function BusyMessage({ api }: { api: AgentSettingsApi }) {
  const c = useAgentSettingsValue(
    async () => decodeHostTools(await api.setting("settings.agent-host-settings.settings")),
    api.agentId,
  );
  return (
    <>
      <SettingsReadState
        busy={c.busy && !c.value}
        error={c.error}
        onRetry={() => void c.refresh()}
      />
      {c.value && (
        <label className="agent-settings-runtime-row">
          <span className="agent-settings-runtime-label">While working</span>
          <select
            className="ui-native-select"
            aria-label="Messages while the agent works"
            value={c.value.busyMessageMode ?? "default"}
            disabled={c.busy}
            onChange={(event) =>
              void c.change(() =>
                api.setting("settings.agent-host-settings.update", {
                  agentId: api.agentId,
                  busyMessageMode: event.target.value === "default" ? null : event.target.value,
                }),
              )
            }
          >
            <option value="default">
              Host default · {c.value.defaultBusyMessageMode === "queue" ? "Queue" : "Steer"}
            </option>
            <option value="queue">Queue</option>
            <option value="steer">Steer</option>
          </select>
        </label>
      )}
    </>
  );
}
function TaskLimit({ api }: { api: AgentSettingsApi }) {
  const c = useAgentSettingsValue(
    async () => decodeTaskLimit(await api.setting("settings.agent-task-limit.settings")),
    api.agentId,
  );
  return (
    <>
      <SettingsReadState
        busy={c.busy && !c.value}
        error={c.error}
        onRetry={() => void c.refresh()}
      />
      {c.value && (
        <label className="agent-settings-runtime-row">
          <span className="agent-settings-runtime-label">Parallel threads</span>
          <select
            className="ui-native-select"
            aria-label="Threads that run at the same time"
            value={c.value.taskLimit ?? "default"}
            disabled={c.busy}
            onChange={(event) =>
              void c.change(() =>
                api.setting("settings.agent-task-limit.update", {
                  agentId: api.agentId,
                  taskLimit: event.target.value === "default" ? null : Number(event.target.value),
                }),
              )
            }
          >
            <option value="default">Host default</option>
            {[1, 2, 3, 4].map((limit) => (
              <option key={limit} value={limit}>
                {limit}
              </option>
            ))}
          </select>
        </label>
      )}
    </>
  );
}
export function AgentAdvancedPage({ api }: { api: AgentSettingsApi }) {
  return (
    <>
      <SettingsLinkGroup inset className="agent-settings-runtime-rows">
        {api.capabilities.includes("agent-host-settings-v1") && <BusyMessage api={api} />}
        {api.capabilities.includes("agent-task-limit-v1") && <TaskLimit api={api} />}
      </SettingsLinkGroup>
      {api.capabilities.includes("agent-new-chat-v1") && (
        <AdvancedBoolean
          api={api}
          read="settings.agent-new-chat.settings"
          update="settings.agent-new-chat.update"
          field="allowNewChat"
          label="Agent starts new chats"
          description="Let the agent start a new chat when its chat gets long. It saves notes first."
        />
      )}
      {api.capabilities.includes("agent-plan-card-v1") && (
        <AdvancedBoolean
          api={api}
          read="settings.agent-plan-card.settings"
          update="settings.agent-plan-card.update"
          field="quickAcknowledgement"
          label="Show the plan before long tasks"
          description="Before a long task, the agent shows its plan. It starts after 10 s, or when you press Start."
        />
      )}
    </>
  );
}
export function AgentInstructionsPage({
  api,
  onBack,
  onClose,
}: {
  api: AgentSettingsApi;
  onBack: () => void;
  onClose: () => void;
}) {
  const c = useAgentSettingsValue(async () => {
    const value = instructionView(
      await api.admin({ operation: "agent.instructions.read", agentId: api.agentId }),
    );
    if (!value) throw new Error("This host returned unsupported instructions.");
    return value;
  }, api.agentId);
  const [draft, setDraft] = useState<{ text: string; expected: string } | null>(null);
  const back = async () => {
    if (draft) {
      if (draft.text === draft.expected || (await confirmed("Discard unsaved instructions?")))
        setDraft(null);
    } else onBack();
  };
  const close = async () => {
    if (
      !draft ||
      draft.text === draft.expected ||
      (await confirmed("Discard unsaved instructions?"))
    )
      onClose();
  };
  return (
    <div className="agent-memories-view">
      <SettingsPanelHeader
        title="Instructions"
        onBack={() => void back()}
        onClose={() => void close()}
      />
      <SettingsPanelContent>
        <div className="agent-memories-page">
          <SettingsReadState
            busy={c.busy && !c.value}
            error={c.error}
            onRetry={() => void c.refresh()}
          />
          {c.value && (
            <>
              {draft ? (
                <>
                  <textarea
                    className="ui-textarea agent-instructions-input"
                    aria-label="Agent instructions"
                    maxLength={32000}
                    value={draft.text}
                    disabled={c.busy}
                    onChange={(event) => setDraft({ ...draft, text: event.target.value })}
                  />
                  <SourceButton
                    disabled={c.busy || draft.text === draft.expected}
                    onClick={() =>
                      void c.change(async () => {
                        const result = instructionView(
                          await api.admin({
                            operation: "agent.instructions.save",
                            agentId: api.agentId,
                            text: draft.text,
                            expected: draft.expected,
                          }),
                        );
                        if (!result)
                          throw new Error("Reload instructions before making another change.");
                        setDraft(null);
                      })
                    }
                  >
                    Save instructions
                  </SourceButton>
                </>
              ) : (
                <>
                  <div className="agent-instructions-bar">
                    <FileText className="agent-instructions-bar-icon" aria-hidden="true" />
                    <div className="agent-instructions-bar-file">
                      <span className="agent-instructions-bar-name">{c.value.fileName}</span>
                    </div>
                    <SourceButton
                      variant="secondary"
                      disabled={
                        !api.canAdmin({
                          operation: "agent.instructions.save",
                          agentId: api.agentId,
                          text: c.value.text,
                          expected: c.value.text,
                        })
                      }
                      onClick={() => setDraft({ text: c.value!.text, expected: c.value!.text })}
                    >
                      Edit
                    </SourceButton>
                  </div>
                  {c.value.text.trim() ? (
                    <div className="agent-instructions-text message-markdown">
                      <ReactMarkdown>{c.value.text}</ReactMarkdown>
                    </div>
                  ) : (
                    <p className="agent-instructions-empty">Rules this agent always follows</p>
                  )}
                </>
              )}
            </>
          )}
        </div>
      </SettingsPanelContent>
    </div>
  );
}
