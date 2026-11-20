import { useStableCallback } from "../../../../hooks/useStableCallback";
/* oxlint-disable shadcn/no-unknown-classes -- Uses the existing workflow settings rows. */
import { useEffect, useRef, useState } from "react";
import * as Schema from "effect/Schema";
import * as Option from "effect/Option";
import { Copy, RefreshCw, X } from "lucide-react";
import type { EnvironmentId } from "@t3tools/contracts";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { openbot } from "../../../../state/openbot";
import { readPreparedConnection, usePreparedConnection } from "../../../../state/session";
import { useAtomCommand } from "../../../../state/use-atom-command";

const configuration = Schema.decodeUnknownSync(
  Schema.Struct({
    workflowId: Schema.String,
    nodeId: Schema.String,
    configured: Schema.Boolean,
    webhookUrl: Schema.NullOr(Schema.String),
  }),
);
const signingSecret = Schema.decodeUnknownSync(Schema.Struct({ secret: Schema.String }));

export function WorkflowWebhookSettings(props: {
  environmentId: EnvironmentId;
  hostId: string;
  workflowId: string;
  nodeId: string;
  disabled: boolean;
  savedGraph: boolean;
  onChanged: () => void;
}) {
  const connection = Option.getOrNull(usePreparedConnection(props.environmentId));
  const [session, setSession] = useState({ connection, epoch: 0 });
  if (session.connection !== connection) setSession({ connection, epoch: session.epoch + 1 });
  return (
    <WebhookSettings
      key={JSON.stringify([
        props.environmentId,
        props.hostId,
        props.workflowId,
        props.nodeId,
        session.epoch,
      ])}
      {...props}
    />
  );
}

function WebhookSettings({
  environmentId,
  hostId,
  workflowId,
  nodeId,
  disabled,
  savedGraph,
  onChanged,
}: Parameters<typeof WorkflowWebhookSettings>[0]) {
  const admin = useAtomCommand(openbot.adminToHost, { reportFailure: false });
  const connection = readPreparedConnection(environmentId);
  const [config, setConfig] = useState<ReturnType<typeof configuration> | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  const pending = useRef(false);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Hold and release this view’s external request lifetime so a closed or replaced target cannot receive secrets.
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const current = () =>
    Boolean(mounted.current && connection && readPreparedConnection(environmentId) === connection);
  const load = useStableCallback(async (active: () => boolean) => {
    try {
      const result = await admin({
        environmentId,
        input: {
          hostId,
          request: { operation: "workflow.webhookConfiguration", workflowId, nodeId },
        },
      });
      if (!active() || !current()) return;
      if (result._tag === "Failure") throw squashAtomCommandFailure(result);
      const value = configuration(result.value);
      if (value.workflowId !== workflowId || value.nodeId !== nodeId)
        throw Error("The webhook destination changed.");
      setConfig(value);
      setError(null);
    } catch (cause) {
      if (active() && current()) setError(String(cause));
    }
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Pull the admin-only address for this exact saved workflow and invalidate late replies on close/session replacement.
  useEffect(() => {
    if (disabled || !savedGraph) return;
    let active = true;
    void load(() => active);
    return () => {
      active = false;
    };
  }, [disabled, savedGraph, load]);
  const rotate = async () => {
    if (pending.current || disabled || !savedGraph || !current()) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    try {
      const result = await admin({
        environmentId,
        input: {
          hostId,
          request: { operation: "workflow.rotateWebhookSecret", workflowId, nodeId },
        },
      });
      if (!current()) return;
      if (result._tag === "Failure") throw squashAtomCommandFailure(result);
      setSecret(signingSecret(result.value).secret);
      await load(() => mounted.current);
      if (current()) onChanged();
    } catch (cause) {
      if (current()) setError(String(cause));
    } finally {
      pending.current = false;
      if (current()) setBusy(false);
    }
  };
  const copy = (text: string) =>
    void navigator.clipboard.writeText(text).catch((cause) => setError(String(cause)));
  return (
    <>
      {config?.webhookUrl && (
        <div className="wfn-row">
          <span>Address</span>
          <code className="wfn-row-value wfn-row-code">{config.webhookUrl}</code>
          <button
            type="button"
            aria-label="Copy webhook address"
            onClick={() => copy(config.webhookUrl!)}
          >
            <Copy size={13} />
          </button>
        </div>
      )}
      {config?.configured && !config.webhookUrl && (
        <p role="status">
          Link this computer through Sled Connect to make its webhook address available.
        </p>
      )}
      <button
        type="button"
        className="wfn-row"
        disabled={disabled || busy || !savedGraph}
        onClick={() => void rotate()}
      >
        <RefreshCw size={13} />
        {!savedGraph
          ? "Save changes to manage webhook"
          : busy
            ? "Creating signing secret…"
            : config?.configured
              ? "Regenerate signing secret"
              : "Create webhook"}
      </button>
      {secret && (
        <div className="wfn-settings-block">
          <p>Copy this signing secret now. It is shown once.</p>
          <code>{secret}</code>
          <button type="button" aria-label="Copy signing secret" onClick={() => copy(secret)}>
            <Copy size={13} />
          </button>
          <button type="button" aria-label="Dismiss signing secret" onClick={() => setSecret(null)}>
            <X size={13} />
          </button>
        </div>
      )}
      {error && (
        <>
          <p role="alert">{error}</p>
          <button
            type="button"
            className="wfn-row"
            disabled={disabled || !savedGraph || busy}
            onClick={() => void load(() => mounted.current)}
          >
            Retry webhook address
          </button>
        </>
      )}
    </>
  );
}
