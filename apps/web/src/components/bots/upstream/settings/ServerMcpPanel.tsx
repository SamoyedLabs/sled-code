/* oxlint-disable react/no-array-index-key -- Original repeatable MCP form rows use positional identity (Solid For keyed=false) to preserve the focused input while its value changes. */
/* oxlint-disable shadcn/no-unknown-classes -- Original ServerMcpPanel selectors are supplied by source CSS. */
import { Menu } from "@base-ui/react/menu";
import { settlePromise, squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { Blocks, Ellipsis, Pencil, Plug, Plus, Trash2 } from "lucide-react";
import { useId, useRef, useState, type ReactNode } from "react";
import { confirmed } from "../../../settings/BotConnectionControls";
import { OpenbotSlidingTabs } from "../OpenbotSlidingTabs";
import { SettingsSection, SourceButton } from "./SettingsParts";
import { SourceSwitch } from "./SourceSwitch";
import {
  emptyMcpConfig,
  isMcpHttpAddress,
  mcpConfigChanged,
  mcpConfigDraft,
  mcpConfigErrors,
  mcpSaveConnects,
  normalizeMcpConfig,
  type McpKeyValue,
  type McpServerConfig,
  type McpTestResult,
} from "./mcp-model";
import "./server-mcp.css";
import { MenuPopup } from "../OpenbotMenu";
import { randomUUID } from "../../../../lib/utils";

export interface ServerMcpPanelProps {
  servers: readonly McpServerConfig[] | null;
  initialServerId?: string | undefined;
  initialCreate?: boolean | undefined;
  canManage: boolean;
  loadError?: string | null;
  toolRuntimeNote?: string | null;
  onRetryLoad?: () => void;
  onSave: (config: McpServerConfig) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
  onSetEnabled: (id: string, enabled: boolean) => Promise<void>;
  onTest?: ((config: McpServerConfig) => Promise<McpTestResult>) | undefined;
  signIn?: (config: McpServerConfig) => ReactNode;
  signInApp?: (config: McpServerConfig) => ReactNode;
}
export function ServerMcpPanel(props: ServerMcpPanelProps) {
  const [editing, setEditing] = useState<McpServerConfig | null>(null);
  const [openedInitial, setOpenedInitial] = useState(false);
  if ((props.initialServerId || props.initialCreate) && props.servers && !openedInitial) {
    setOpenedInitial(true);
    setEditing(
      props.initialCreate
        ? emptyMcpConfig()
        : (props.servers.find((server) => server.id === props.initialServerId) ?? null),
    );
  }
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const lock = useRef(false);
  const [tests, setTests] = useState<Record<string, McpTestResult>>({});
  const act = async (id: string, action: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(id);
    setError(null);
    const settled = await settlePromise(action);
    if (settled._tag === "Failure") {
      const cause = squashAtomCommandFailure(settled);
      setError(cause instanceof Error ? cause.message : "Could not change the MCP server.");
    }
    lock.current = false;
    setBusy(null);
  };
  const open = (server: McpServerConfig | null) => {
    setError(null);
    setEditing(server ?? emptyMcpConfig());
  };
  if (editing)
    return (
      <McpForm
        key={editing.id || "new"}
        {...props}
        baseline={editing}
        onBack={() => setEditing(null)}
      />
    );
  return (
    <div className="server-mcp-panel">
      <SettingsSection
        title="MCP servers"
        description="Model Context Protocol servers give this server’s agents extra tools. Claude and Codex agents get only the servers in this list; OpenCode and Grok agents can also start servers from their own configuration files."
        actions={
          props.servers &&
          props.servers.length > 0 && (
            <SourceButton disabled={!props.canManage || busy !== null} onClick={() => open(null)}>
              <Plus aria-hidden="true" />
              Connect a custom MCP
            </SourceButton>
          )
        }
      >
        {error && (
          <p className="server-mcp-error" role="alert">
            {error}
          </p>
        )}
        {props.toolRuntimeNote && (
          <p className="ui-text server-mcp-runtime-note" data-variant="caption" data-tone="muted">
            {props.toolRuntimeNote}
          </p>
        )}
        {props.servers === null ? (
          <p role={props.loadError ? "alert" : "status"}>
            {props.loadError ?? "Loading MCP servers…"}
            {props.loadError && props.onRetryLoad && (
              <SourceButton onClick={props.onRetryLoad}>Retry</SourceButton>
            )}
          </p>
        ) : props.servers.length === 0 ? (
          <div className="server-mcp-empty">
            {props.loadError ? (
              <p role="alert">{props.loadError}</p>
            ) : (
              <>
                <p className="ui-text" data-variant="caption" data-tone="muted">
                  No MCP servers yet.
                </p>
                <SourceButton disabled={!props.canManage} onClick={() => open(null)}>
                  <Plus aria-hidden="true" />
                  Connect a custom MCP
                </SourceButton>
              </>
            )}
          </div>
        ) : (
          <div className="ui-item-group server-mcp-list">
            {props.servers.map((config) => {
              const test = tests[config.id];
              return (
                <div
                  key={config.id}
                  className="ui-item server-mcp-row"
                  data-size="default"
                  data-disabled={config.enabled ? undefined : ""}
                >
                  <div className="ui-item-media server-mcp-row-icon">
                    <Blocks aria-hidden="true" />
                  </div>
                  <div className="ui-item-content">
                    <div className="server-mcp-row-title">
                      <div className="ui-item-title">{config.name}</div>
                      <span
                        className={`z-badge z-badge-variant-${test ? (test.error ? "destructive-light" : "success-light") : "secondary"}`}
                      >
                        {busy === `test:${config.id}`
                          ? "Connecting…"
                          : test
                            ? test.error
                              ? "Failed"
                              : `Connected · ${test.toolCount} tools`
                            : config.enabled
                              ? "Enabled"
                              : "Disabled"}
                      </span>
                    </div>
                    {test?.error && <div className="ui-item-description">{test.error}</div>}
                    {props.signIn?.(config)}
                  </div>
                  <div className="ui-item-actions">
                    <SourceSwitch
                      label={`Enable ${config.name}`}
                      checked={config.enabled}
                      disabled={!props.canManage || busy !== null}
                      onChange={(enabled) =>
                        void act(config.id, () => props.onSetEnabled(config.id, enabled))
                      }
                    />
                    <Menu.Root>
                      <Menu.Trigger
                        className="ui-button ui-button-variant-ghost ui-button-size-icon-sm"
                        aria-label={`Actions for ${config.name}`}
                        disabled={!props.canManage || busy !== null}
                      >
                        <Ellipsis aria-hidden="true" />
                      </Menu.Trigger>
                      <MenuPopup align="end" className="server-mcp-row-menu">
                        <Menu.Item
                          disabled={!props.onTest}
                          onClick={() =>
                            void act(`test:${config.id}`, async () => {
                              if (props.onTest) {
                                const result = await props.onTest(config);
                                setTests((current) => ({ ...current, [config.id]: result }));
                              }
                            })
                          }
                        >
                          <Plug aria-hidden="true" />
                          Test connection
                        </Menu.Item>
                        <Menu.Item onClick={() => open(config)}>
                          <Pencil aria-hidden="true" />
                          Edit
                        </Menu.Item>
                        <Menu.Item
                          className="ui-action-menu-danger"
                          onClick={() =>
                            void act(config.id, async () => {
                              if (
                                await confirmed(
                                  `Remove ${config.name}? Its tools stop being offered to this server’s agents. The configuration is not kept.`,
                                )
                              )
                                await props.onRemove(config.id);
                            })
                          }
                        >
                          <Trash2 aria-hidden="true" />
                          Remove
                        </Menu.Item>
                      </MenuPopup>
                    </Menu.Root>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </SettingsSection>
    </div>
  );
}

function McpForm({
  baseline,
  onBack,
  ...props
}: ServerMcpPanelProps & { baseline: McpServerConfig; onBack: () => void }) {
  const [draft, setDraft] = useState(() => mcpConfigDraft(baseline));
  const [newId] = useState(() => `mcp-${randomUUID()}`);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [test, setTest] = useState<{ signature: string; result: McpTestResult } | null>(null);
  const [touched, setTouched] = useState(false);
  const lock = useRef(false);
  const errors = mcpConfigErrors(draft);
  const changed = mcpConfigChanged(draft, baseline);
  const signature = JSON.stringify(normalizeMcpConfig(draft));
  const disabled = !props.canManage || busy;
  const patch = (next: Partial<McpServerConfig>) =>
    setDraft((current) => {
      const retained = { ...current.retained };
      if (next.args) delete retained.args;
      if (next.env) delete retained.env;
      if (next.headers) delete retained.headers;
      return { ...current, ...next, ...(current.retained ? { retained } : {}) };
    });
  const run = async (save: boolean) => {
    if (lock.current) return;
    setTouched(true);
    if (Object.keys(errors).length) return;
    lock.current = true;
    setBusy(true);
    setError(null);
    const config = normalizeMcpConfig(draft);
    const settled = await settlePromise(async () => {
      if (!save || mcpSaveConnects(config, baseline, !baseline.id)) {
        if (!props.onTest) throw new Error("This server cannot be tested here.");
        const result = await props.onTest(config);
        setTest({ signature, result });
        if (result.error) throw new Error(result.error);
      }
      if (save) {
        await props.onSave({ ...config, id: config.id || newId });
        onBack();
      }
    });
    if (settled._tag === "Failure") {
      const cause = squashAtomCommandFailure(settled);
      setError(cause instanceof Error ? cause.message : "Could not save the MCP server.");
    }
    lock.current = false;
    setBusy(false);
  };
  const back = async () => {
    if (!changed || (await confirmed("Discard unsaved MCP server changes?"))) onBack();
  };
  return (
    <div className="server-mcp-panel">
      <div className="server-mcp-form">
        <SourceButton variant="ghost" disabled={busy} onClick={() => void back()}>
          Back
        </SourceButton>
        <SettingsSection
          title="Details"
          description="Name this server and choose how OpenBot reaches it."
          actions={
            <OpenbotSlidingTabs
              value={draft.transport}
              onChange={(transport) => {
                if (!disabled) patch({ transport });
              }}
              items={[
                { value: "stdio", label: "STDIO" },
                { value: "http", label: "Streamable HTTP" },
              ]}
              label="Transport"
            />
          }
        >
          <McpField
            label="Name"
            value={draft.name}
            placeholder="MCP server name"
            disabled={disabled}
            error={touched ? errors.name : undefined}
            onChange={(name) => patch({ name })}
          />
        </SettingsSection>
        {draft.transport === "stdio" ? (
          <SettingsSection title="Launch">
            <McpField
              label="Command to launch"
              description="The program only. The launch does not read this field as a command line, so a word such as serve-sqlite goes in Arguments below."
              value={draft.command}
              disabled={disabled}
              error={touched ? errors.command : undefined}
              onChange={(command) => {
                if (isMcpHttpAddress(command) && command.length - draft.command.length > 1)
                  patch({ transport: "http", url: command, command: "" });
                else patch({ command });
              }}
              onBlur={() => {
                if (isMcpHttpAddress(draft.command))
                  patch({ transport: "http", url: draft.command, command: "" });
              }}
            />
            {draft.retained?.args !== undefined && (
              <RetainedField
                label="arguments"
                summary={`${draft.retained.args} saved arguments`}
                disabled={disabled}
                onReplace={() => patch({ args: [] })}
              />
            )}
            <McpStringRows
              label="Arguments"
              addLabel="Add argument"
              values={draft.args}
              disabled={disabled || draft.retained?.args !== undefined}
              onChange={(args) => patch({ args })}
            />
            {draft.retained?.env !== undefined && (
              <RetainedField
                label="environment variables"
                summary={draft.retained.env.join(", ") || "No saved environment variables"}
                disabled={disabled}
                onReplace={() => patch({ env: [] })}
              />
            )}
            <McpPairs
              label="Environment variables"
              addLabel="Add environment variable"
              values={draft.env}
              disabled={disabled || draft.retained?.env !== undefined}
              onChange={(env) => patch({ env })}
            />
            <McpStringRows
              label="Environment variable passthrough"
              addLabel="Add variable"
              values={draft.envPassthrough}
              disabled={disabled}
              onChange={(envPassthrough) => patch({ envPassthrough })}
            />
            <McpField
              label="Working directory"
              description="Claude and Codex agents and the connection test start the server here. Leave it empty to give this server to every provider: the other providers cannot set a directory, so they skip a server that names one."
              value={draft.workingDirectory}
              disabled={disabled}
              onChange={(workingDirectory) => patch({ workingDirectory })}
            />
          </SettingsSection>
        ) : (
          <SettingsSection
            title="Endpoint"
            description="Every provider can use an HTTP MCP server."
          >
            <McpField
              label="Server URL"
              type="url"
              value={draft.url}
              disabled={disabled}
              error={touched ? errors.url : undefined}
              onChange={(url) => patch({ url })}
            />
            {draft.retained?.headers !== undefined && (
              <RetainedField
                label="headers"
                summary={draft.retained.headers.join(", ") || "No saved headers"}
                disabled={disabled}
                onReplace={() => patch({ headers: [] })}
              />
            )}
            <McpPairs
              label="Headers"
              addLabel="Add header"
              values={draft.headers}
              disabled={disabled || draft.retained?.headers !== undefined}
              onChange={(headers) => patch({ headers })}
            />
            {props.signInApp?.(draft)}
          </SettingsSection>
        )}
        <SettingsSection
          title="Test"
          description="Connects once with these settings and reports the tools it offers. Nothing is saved or kept."
          actions={
            <>
              <span>{props.signIn?.(draft)}</span>
              <SourceButton disabled={disabled || !props.onTest} onClick={() => void run(false)}>
                <Plug aria-hidden="true" />
                Test connection
              </SourceButton>
            </>
          }
        >
          <p
            className="ui-text server-mcp-test-result"
            data-variant="caption"
            data-tone="muted"
            role="status"
          >
            {test?.signature === signature
              ? (test.result.error ?? `Connected · ${test.result.toolCount} tools`)
              : "Not tested yet."}
          </p>
        </SettingsSection>
        {error && (
          <p className="server-mcp-error" role="alert">
            {error}
          </p>
        )}
        {changed && (
          <footer className="settings-modal-footer">
            <p className="ui-text" data-variant="caption">
              Changes not saved
            </p>
            <SourceButton
              disabled={busy}
              onClick={() => {
                setDraft(mcpConfigDraft(baseline));
                setTest(null);
                setError(null);
              }}
            >
              Reset
            </SourceButton>
            <SourceButton variant="default" disabled={disabled} onClick={() => void run(true)}>
              {busy ? "Saving…" : "Save"}
            </SourceButton>
          </footer>
        )}
      </div>
    </div>
  );
}
function McpField({
  label,
  description,
  error,
  value,
  onChange,
  onBlur,
  disabled,
  placeholder,
  type = "text",
}: {
  label: string;
  description?: string;
  error?: string | undefined;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  disabled: boolean;
  placeholder?: string;
  type?: string;
}) {
  const id = useId();
  return (
    <div className="ui-field" data-invalid={error ? "" : undefined}>
      <label className="ui-label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        className="ui-input"
        data-size="md"
        type={type}
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onBlur}
        aria-invalid={Boolean(error)}
        aria-describedby={description ? `${id}-description` : undefined}
      />
      {description && (
        <div id={`${id}-description`} className="ui-field-description">
          {description}
        </div>
      )}
      {error && (
        <div className="ui-field-error" role="alert">
          {error}
        </div>
      )}
    </div>
  );
}
function McpStringRows({
  label,
  addLabel,
  values,
  disabled,
  onChange,
}: {
  label: string;
  addLabel: string;
  values: string[];
  disabled: boolean;
  onChange: (values: string[]) => void;
}) {
  return (
    <fieldset className="server-mcp-repeat">
      <legend className="server-mcp-repeat-legend">{label}</legend>
      {values.map((value, index) => (
        <div key={index} className="server-mcp-repeat-row">
          <input
            className="ui-input"
            data-size="md"
            aria-label={`${label} ${index + 1}`}
            value={value}
            disabled={disabled}
            onChange={(event) =>
              onChange(values.map((current, i) => (i === index ? event.target.value : current)))
            }
          />
          <SourceButton
            variant="ghost"
            aria-label={`Remove ${label.toLowerCase()} ${index + 1}`}
            disabled={disabled}
            onClick={() => onChange(values.filter((_, i) => i !== index))}
          >
            <Trash2 aria-hidden="true" />
          </SourceButton>
        </div>
      ))}
      <SourceButton
        className="server-mcp-repeat-add"
        variant="ghost"
        disabled={disabled}
        onClick={() => onChange([...values, ""])}
      >
        <Plus aria-hidden="true" />
        {addLabel}
      </SourceButton>
    </fieldset>
  );
}
function McpPairs({
  label,
  addLabel,
  values,
  disabled,
  onChange,
}: {
  label: string;
  addLabel: string;
  values: McpKeyValue[];
  disabled: boolean;
  onChange: (values: McpKeyValue[]) => void;
}) {
  return (
    <fieldset className="server-mcp-repeat">
      <legend className="server-mcp-repeat-legend">{label}</legend>
      {values.map((value, index) => (
        <div key={index} className="server-mcp-repeat-row server-mcp-repeat-row-pair">
          <input
            className="ui-input"
            data-size="md"
            aria-label={`${label} ${index + 1} key`}
            placeholder="Key"
            value={value.key}
            disabled={disabled}
            onChange={(event) =>
              onChange(
                values.map((current, i) =>
                  i === index ? { ...current, key: event.target.value } : current,
                ),
              )
            }
          />
          <input
            className="ui-input"
            data-size="md"
            type="password"
            autoComplete="off"
            spellCheck={false}
            aria-label={`${label} ${index + 1} value`}
            placeholder="Value"
            value={value.value}
            disabled={disabled}
            onChange={(event) =>
              onChange(
                values.map((current, i) =>
                  i === index ? { ...current, value: event.target.value } : current,
                ),
              )
            }
          />
          <SourceButton
            variant="ghost"
            aria-label={`Remove ${label.toLowerCase()} ${index + 1}`}
            disabled={disabled}
            onClick={() => onChange(values.filter((_, i) => i !== index))}
          >
            <Trash2 aria-hidden="true" />
          </SourceButton>
        </div>
      ))}
      <SourceButton
        className="server-mcp-repeat-add"
        variant="ghost"
        disabled={disabled}
        onClick={() => onChange([...values, { key: "", value: "" }])}
      >
        <Plus aria-hidden="true" />
        {addLabel}
      </SourceButton>
    </fieldset>
  );
}

function RetainedField({
  label,
  summary,
  disabled,
  onReplace,
}: {
  label: string;
  summary: string;
  disabled: boolean;
  onReplace: () => void;
}) {
  return (
    <div className="settings-field">
      <p className="ui-text" data-variant="caption" data-tone="muted">
        {summary}. Values stay on the host until you replace them.
      </p>
      <SourceButton variant="ghost" disabled={disabled} onClick={onReplace}>
        Replace saved {label}
      </SourceButton>
    </div>
  );
}
