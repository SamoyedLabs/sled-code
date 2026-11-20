import { SourceSignInRelayControls } from "../provider/ProviderSignInDialogs";
/* oxlint-disable shadcn/no-unknown-classes -- Source web-mcp-relay and McpSignInPage. */
import { useEffect, useEffectEvent, useRef, useState } from "react";
import * as Schema from "effect/Schema";
import type { OpenbotAdminRequest } from "@t3tools/contracts";
import { relayCallbackQuery } from "./relay-callback";
import { SourceButton } from "../settings/SettingsParts";
import type { McpServerConfig } from "./plugin-model";
const decodeStarted = Schema.decodeUnknownSync(
  Schema.Struct({ flowId: Schema.String, expiresAt: Schema.Number }),
);
const decodeStatus = Schema.decodeUnknownSync(
  Schema.Struct({
    authorizeUrl: Schema.NullOr(Schema.String),
    callback: Schema.NullOr(
      Schema.Struct({
        port: Schema.Number,
        path: Schema.String,
        state: Schema.NullOr(Schema.String),
      }),
    ),
    result: Schema.NullOr(Schema.Struct({ error: Schema.NullOr(Schema.String) })),
  }),
);
export type McpExecute = (request: OpenbotAdminRequest) => Promise<unknown>;
export function SourceMcpRelay(props: {
  name: string;
  hostName: string;
  config?: McpServerConfig;
  mcpServerId?: string;
  execute: McpExecute;
  onConnected: () => Promise<void>;
  onCancel: () => void;
  onActiveChange?: (active: boolean) => void;
}) {
  const [flow, setFlow] = useState<ReturnType<typeof decodeStarted> | null>(null),
    [status, setStatus] = useState<ReturnType<typeof decodeStatus> | null>(null),
    [error, setError] = useState<string | null>(null),
    [busy, setBusy] = useState(false);
  const lock = useRef(false),
    alive = useRef(true),
    done = useRef(false);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Drop relay responses when the owning dialog closes.
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const accept = async (value: unknown) => {
    const next = decodeStatus(value);
    if (!alive.current || done.current) return;
    setStatus(next);
    if (next.result) {
      done.current = true;
      if (next.result.error) {
        setError(next.result.error);
        setBusy(false);
      } else {
        setBusy(true);
        try {
          await props.onConnected();
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : "Could not save the connected app.");
          setBusy(false);
        }
      }
    }
  };
  const poll = useEffectEvent(async () => {
    if (!flow || done.current || lock.current) return;
    if (Date.now() >= flow.expiresAt) {
      done.current = true;
      setError("This sign-in expired. Close it and try again.");
      return;
    }
    lock.current = true;
    try {
      await accept(
        await props.execute({ operation: "provider.signInRelay.status", flowId: flow.flowId }),
      );
    } catch (cause) {
      if (alive.current)
        setError(cause instanceof Error ? cause.message : "Could not read sign-in status.");
    } finally {
      lock.current = false;
    }
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Poll only the explicitly started, host-owned relay flow; never start sign-in in an effect.
  useEffect(() => {
    if (!flow) return;
    const timer = setInterval(() => void poll(), 1000);
    return () => clearInterval(timer);
  }, [flow]);
  const start = async () => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    props.onActiveChange?.(true);
    setError(null);
    try {
      const request: OpenbotAdminRequest = props.mcpServerId
        ? { operation: "mcp.signInRelay.startById", mcpServerId: props.mcpServerId }
        : props.config
          ? { operation: "mcp.signInRelay.start", config: props.config }
          : (() => {
              throw new Error("No app configuration was supplied.");
            })();
      const next = decodeStarted(await props.execute(request));
      if (alive.current) setFlow(next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not start sign-in.");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  const complete = async (address: string) => {
    if (!flow || !status?.authorizeUrl || lock.current) return;
    const query = relayCallbackQuery(
      address,
      new URL(status.authorizeUrl).searchParams.get("state"),
    );
    if (query === null) {
      throw new Error("Paste the complete callback address from this sign-in.");
    }
    lock.current = true;
    setBusy(true);
    setError(null);
    try {
      await accept(
        await props.execute({
          operation: "provider.signInRelay.complete",
          flowId: flow.flowId,
          query,
        }),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not complete sign-in.");
      throw cause;
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  };
  const cancel = async () => {
    if (busy) return;
    done.current = true;
    if (flow) {
      try {
        await props.execute({ operation: "provider.signInRelay.cancel", flowId: flow.flowId });
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Could not cancel sign-in.");
        return;
      }
    }
    props.onActiveChange?.(false);
    props.onCancel();
  };
  const url = (() => {
    try {
      const value = new URL(status?.authorizeUrl ?? "");
      return value.protocol === "https:" && !value.username && !value.password ? value.href : null;
    } catch {
      return null;
    }
  })();
  return (
    <div className="mcp-connect-card">
      <p className="mcp-connect-row">
        Sign in to {props.name} in your browser. The connection is kept on {props.hostName}.
      </p>
      {!flow && (
        <SourceButton variant="default" disabled={busy} onClick={() => void start()}>
          {busy ? "Starting…" : "Sign in"}
        </SourceButton>
      )}
      {flow && !status?.result && (
        <div className="mcp-connect-row">
          {url ? (
            <SourceSignInRelayControls
              page={{ authorizeHost: new URL(url).host, listening: false, pasteable: true }}
              onOpen={() => {
                window.open(url, "_blank", "noopener,noreferrer");
              }}
              onPaste={complete}
            />
          ) : (
            <p role="status">Waiting for the sign-in page…</p>
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="ui-field-error">
          {error}
        </p>
      )}
      <SourceButton variant="ghost" disabled={busy} onClick={() => void cancel()}>
        Cancel
      </SourceButton>
    </div>
  );
}
