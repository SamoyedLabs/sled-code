/* oxlint-disable shadcn/no-unknown-classes -- Source McpConnectShell/McpKeyDialog/McpLocalDialog translated to React. */
import { Dialog } from "@base-ui/react/dialog";
import { useRef, useState } from "react";
import * as Schema from "effect/Schema";
import { settlePromise, squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { SourceButton } from "../settings/SettingsParts";
import { SkillMark } from "../marketplace/MarketplaceParts";
import { SourceMcpRelay, type McpExecute } from "./SourceMcpRelay";
import { createPluginAppConfig } from "./plugin-catalog";
import { applyMcpFlow, isListingUrl, mcpFlowComplete, mcpFlowFields } from "./mcp-connect-flows";
import type { McpServerConfig, MarketplacePluginApp } from "./plugin-model";
import "./mcp-connect-dialog.css";
import "./integration-layout.css";
import { T, Var, useGT } from "gt-react";
const decodeTest = Schema.decodeUnknownSync(
  Schema.Struct({ toolCount: Schema.Number, error: Schema.NullOr(Schema.String) }),
);
export function AppConnectDialog(props: {
  app: MarketplacePluginApp;
  hostName: string;
  mcpServerId?: string;
  initialConfig?: McpServerConfig;
  execute: McpExecute;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const gt = useGT();
  const [flowId, setFlowId] = useState(props.app.server.auth?.[0]?.id),
    [values, setValues] = useState<Record<string, string>>({}),
    [busy, setBusy] = useState(false),
    [relayActive, setRelayActive] = useState(false),
    [error, setError] = useState<string | null>(null),
    [uncertain, setUncertain] = useState(false);
  const lock = useRef(false);
  const flow = props.app.server.auth?.find((value) => value.id === flowId),
    base = props.initialConfig ?? createPluginAppConfig(props.app);
  const save = async (config: typeof base) => {
    setUncertain(true);
    if (props.mcpServerId)
      await props.execute({
        operation: "mcp.saveCredentialsById",
        mcpServerId: props.mcpServerId,
        env: config.env,
        headers: config.headers,
        ...(mcpFlowFields(flow).some((field) => field.url) ? { url: config.url } : {}),
      });
    else await props.execute({ operation: "mcp.save", config });
    setUncertain(false);
    await props.onSaved();
    props.onClose();
  };
  const submit = async () => {
    if (lock.current || uncertain) return;
    lock.current = true;
    setBusy(true);
    setError(null);
    const settled = await settlePromise(async () => {
      if (!mcpFlowComplete(flow, values)) throw new Error("Fill in the required fields.");
      for (const field of mcpFlowFields(flow)) {
        if (field.url && !isListingUrl((values[field.id] ?? "").trim(), base.url))
          throw new Error("Use the HTTPS address from this service.");
      }
      const config = applyMcpFlow(base, flow, values);
      const result = decodeTest(
        await props.execute(
          props.mcpServerId
            ? {
                operation: "mcp.testCredentialsById",
                mcpServerId: props.mcpServerId,
                env: config.env,
                headers: config.headers,
                ...(mcpFlowFields(flow).some((field) => field.url) ? { url: config.url } : {}),
              }
            : { operation: "mcp.test", config },
        ),
      );
      if (result.error) throw new Error(result.error);
      await save(config);
    });
    if (settled._tag === "Failure") {
      const cause = squashAtomCommandFailure(settled);
      setError(cause instanceof Error ? cause.message : gt("Could not connect the app."));
    }
    lock.current = false;
    setBusy(false);
  };
  const close = () => {
    if (!busy && !relayActive) props.onClose();
  };
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <Dialog.Portal>
        <div className="openbot-react">
          <Dialog.Viewport className="integration-dialog-backdrop">
            <Dialog.Popup className="integration-wizard-dialog">
              <div className="integration-wizard">
                <header className="integration-wizard-head">
                  <div className="integration-wizard-logos">
                    <span className="integration-logo-tile">
                      <SkillMark url={props.app.iconUrl} />
                    </span>
                  </div>
                  <Dialog.Title>
                    <T>
                      Connect <Var>{props.app.name}</Var>
                    </T>
                  </Dialog.Title>
                  <Dialog.Description>
                    <T>
                      Give your agents access to <Var>{props.app.name}</Var> on{" "}
                      <Var>{props.hostName}</Var>.
                    </T>
                  </Dialog.Description>
                </header>
                <div className="integration-wizard-body">
                  {(props.app.server.auth?.length ?? 0) > 1 && (
                    <div
                      className="ui-tabs-list"
                      role="tablist"
                      aria-label={gt("Connection method")}
                    >
                      {props.app.server.auth?.map((choice) => (
                        <button
                          key={choice.id}
                          role="tab"
                          aria-selected={flow?.id === choice.id}
                          disabled={busy || uncertain || relayActive}
                          className="ui-tabs-trigger"
                          onClick={() => {
                            setFlowId(choice.id);
                            setValues({});
                            setError(null);
                          }}
                        >
                          {choice.label}
                        </button>
                      ))}
                    </div>
                  )}
                  {flow?.kind === "link" ? (
                    <SourceMcpRelay
                      key={flow.id}
                      name={props.app.name}
                      hostName={props.hostName}
                      config={base}
                      {...(props.mcpServerId ? { mcpServerId: props.mcpServerId } : {})}
                      execute={props.execute}
                      onCancel={props.onClose}
                      onActiveChange={setRelayActive}
                      onConnected={async () => {
                        if (props.mcpServerId) {
                          await props.onSaved();
                          props.onClose();
                        } else await save(base);
                      }}
                    />
                  ) : (
                    <form
                      className="integration-wizard-form"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void submit();
                      }}
                    >
                      {flow?.kind === "local" ? (
                        <div className="mcp-connect-card">
                          <h4 className="mcp-local-heading">
                            <T>
                              Set up <Var>{props.app.name}</Var> on <Var>{props.hostName}</Var>
                            </T>
                          </h4>
                          <ol className="mcp-local-steps">
                            {flow.steps.map((step) => (
                              <li key={step}>{step}</li>
                            ))}
                          </ol>
                          {flow.note && <p>{flow.note}</p>}
                          <p role="note">
                            <T>
                              This connection must be available on the host. Local desktop setup
                              cannot be performed from this remote client.
                            </T>
                          </p>
                          {flow.docsUrl && (
                            <a href={flow.docsUrl} target="_blank" rel="noreferrer">
                              {flow.docsLabel ?? gt("Setup instructions")}
                            </a>
                          )}
                        </div>
                      ) : (
                        <div className="mcp-connect-card">
                          {mcpFlowFields(flow).map((field) => (
                            <div className="mcp-connect-row" key={field.id}>
                              <label className="ui-field">
                                <span className="ui-label">
                                  {field.label}
                                  {field.optional ? gt(" (optional)") : ""}
                                </span>
                                <input
                                  className="ui-input"
                                  type={field.url ? "url" : "password"}
                                  autoComplete="off"
                                  spellCheck={false}
                                  placeholder={field.placeholder}
                                  required={!field.optional}
                                  value={values[field.id] ?? ""}
                                  disabled={busy || uncertain || relayActive}
                                  onChange={(event) => {
                                    setValues({ ...values, [field.id]: event.target.value });
                                    setError(null);
                                  }}
                                />
                                {field.hint && (
                                  <span className="ui-field-description">{field.hint}</span>
                                )}
                              </label>
                            </div>
                          ))}
                          {flow?.kind === "key" && flow.docsUrl && (
                            <a
                              className="mcp-connect-docs"
                              href={flow.docsUrl}
                              target="_blank"
                              rel="noreferrer"
                            >
                              {flow.docsLabel ?? gt("Get your API key")}
                            </a>
                          )}
                          <p className="mcp-connect-row mcp-connect-privacy">
                            <T>
                              Credentials are kept on <Var>{props.hostName}</Var>.
                            </T>
                          </p>
                        </div>
                      )}
                      {error && (
                        <p role="alert" className="ui-field-error">
                          {error}
                        </p>
                      )}
                      {uncertain && (
                        <p role="alert">
                          <T>
                            The save outcome is unknown. Refresh the connection status before trying
                            again.
                          </T>
                        </p>
                      )}
                      <footer className="integration-wizard-foot">
                        <SourceButton variant="ghost" disabled={busy} onClick={close}>
                          <T>Cancel</T>
                        </SourceButton>
                        <SourceButton
                          type="submit"
                          variant="default"
                          disabled={busy || uncertain || flow?.kind === "local"}
                        >
                          {busy ? gt("Connecting…") : gt("Connect")}
                        </SourceButton>
                      </footer>
                    </form>
                  )}
                </div>
              </div>
            </Dialog.Popup>
          </Dialog.Viewport>
        </div>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
