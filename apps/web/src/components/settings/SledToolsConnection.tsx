import { useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import type { AuthMcpClientAccess, EnvironmentId } from "@t3tools/contracts";
import { sledToolAccessOptions } from "@t3tools/client-runtime/openbot/presentation";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { openbot } from "../../state/openbot";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
export function SledToolsConnection({ environmentId }: { environmentId: EnvironmentId }) {
  const query = useEnvironmentQuery(openbot.sledTools({ environmentId, input: {} }));
  const allowed = useAtomValue(openbot.connectSledTools.permissionAtom(environmentId));
  const connect = useAtomCommand(openbot.connectSledTools, { reportFailure: false });
  const disconnect = useAtomCommand(openbot.disconnectSledTools, { reportFailure: false });
  const [access, setAccess] = useState<AuthMcpClientAccess>("read-only");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const act = async (remove: boolean) => {
    if (busy || !allowed) return;
    setBusy(true);
    setError(null);
    const result = remove
      ? await disconnect({ environmentId, input: {} })
      : await connect({ environmentId, input: { access } });
    if (result._tag === "Failure") setError(String(squashAtomCommandFailure(result)));
    query.refresh();
    setBusy(false);
  };
  const status = query.data;
  return (
    <section className="space-y-3 rounded-lg border p-4" aria-label="Sled tools connection">
      <h4 className="text-sm font-medium">Connect bots to Sled</h4>
      <p className="text-sm text-muted-foreground">
        Let this bot engine inspect Sled projects and delegate coding work. Choose its maximum
        authority; each bot keeps its own permissions.
      </p>
      <p role="status" className="text-sm">
        {query.isPending
          ? "Checking connection…"
          : status?.state === "connected"
            ? "Connected"
            : status?.state === "expired"
              ? "Access expired. Reconnect to renew it."
              : status?.state === "host-unavailable"
                ? "Start the bot engine to connect."
                : status?.state === "revocation-pending"
                  ? "Access revocation is pending. Retry disconnect to complete it."
                  : status?.state === "cleanup-pending"
                    ? "Upstream configuration cleanup is pending."
                    : "Not connected"}
      </p>
      {status?.access && (
        <p className="text-sm">
          Current ceiling:{" "}
          {sledToolAccessOptions.find((item) => item.value === status.access)?.label ??
            status.access}
        </p>
      )}
      {status?.expiresAt && (
        <p className="text-sm text-muted-foreground">
          Expires: {new Date(status.expiresAt).toLocaleString()}
        </p>
      )}
      <label className="block space-y-1 text-sm">
        <span>Authority to grant</span>
        <select
          className="block rounded-md border bg-background p-2"
          value={access}
          disabled={busy || !allowed}
          onChange={(event) => {
            const option = sledToolAccessOptions.find((item) => item.value === event.target.value);
            if (option) setAccess(option.value);
          }}
        >
          {sledToolAccessOptions.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </select>
      </label>
      {(error || query.error) && (
        <p role="alert" className="text-sm text-destructive">
          {error ?? query.error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          disabled={busy || !allowed || status?.state === "host-unavailable" || query.isPending}
          onClick={() => void act(false)}
        >
          {status?.state === "connected" ? "Update connection" : "Connect Sled tools"}
        </Button>
        {status?.state !== "disconnected" && (
          <Button
            variant="outline"
            disabled={busy || !allowed || !status}
            onClick={() => void act(true)}
          >
            Disconnect
          </Button>
        )}
        <Button variant="ghost" onClick={query.refresh} disabled={busy}>
          Refresh connection
        </Button>
      </div>
    </section>
  );
}
