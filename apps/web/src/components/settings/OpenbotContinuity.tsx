import { useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, OpenbotContinuityCommand } from "@t3tools/contracts";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { openbot } from "../../state/openbot";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
export function OpenbotContinuity({ environmentId }: { environmentId: EnvironmentId }) {
  const query = useEnvironmentQuery(openbot.continuity({ environmentId, input: {} }));
  const command = useAtomCommand(openbot.continuityCommand);
  const allowed = useAtomValue(openbot.continuityCommand.permissionAtom(environmentId));
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  async function send(input: OpenbotContinuityCommand) {
    if (busy || !allowed) return;
    setBusy(true);
    setError(null);
    try {
      const result = await command({ environmentId, input });
      if (result._tag === "Failure") setError(String(squashAtomCommandFailure(result)));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="space-y-2" aria-label="Bot background notifications">
      <h4 className="text-sm font-medium">Bot background notifications</h4>
      <p className="text-sm text-muted-foreground">
        Send reminders, task results and requests to your linked mobile account. Enable
        notifications in the mobile app as well.
      </p>
      {query.data && (
        <>
          <p className="text-sm">
            {query.data.enabled ? "Enabled for this session" : "Disabled for this session"} ·{" "}
            {query.data.transport === "configured"
              ? "Relay configured"
              : query.data.transport === "unsupported"
                ? "This relay does not support bot notifications"
                : "A notification relay and linked account are required"}
          </p>
          <p className="text-xs">
            {query.data.pending} pending · {query.data.delivered} accepted by delivery transport ·{" "}
            {query.data.revoked} stopped after access changed
          </p>
          <div className="flex gap-2">
            <Button
              size="sm"
              disabled={busy || !allowed}
              onClick={() => void send({ action: "configure", enabled: !query.data?.enabled })}
            >
              {query.data.enabled ? "Disable notifications" : "Enable notifications"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={busy || !allowed}
              onClick={() => void send({ action: "retry" })}
            >
              Retry pending
            </Button>
          </div>
          {query.data.lastError && <p role="status">Delivery: {query.data.lastError}</p>}
        </>
      )}
      {query.isPending && <p role="status">Loading notification status…</p>}
      {(error || query.error) && <p role="alert">{error || query.error}</p>}
      <Button size="sm" variant="outline" onClick={query.refresh} disabled={query.isPending}>
        Refresh notifications
      </Button>
    </section>
  );
}
