import { ComputerView } from "./ComputerView";
import { useEffect, useState } from "react";
import { computerChecks, computerReadiness } from "@t3tools/client-runtime/openbot/presentation";
import type { ComputerActions } from "@t3tools/client-runtime/openbot/presentation";
import { useStableCallback } from "../../hooks/useStableCallback";
import { MonitorIcon } from "lucide-react";
import { Button } from "../ui/button";
import { useBotComputer } from "./useBotComputer";

export function BotComputer({
  actions,
  workspace = false,
}: {
  actions: ComputerActions;
  workspace?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <section aria-label="Host computer" className="space-y-3">
      {!workspace && (
        <Button
          variant="outline"
          size="sm"
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
        >
          Computer
        </Button>
      )}
      {(expanded || workspace) && <ComputerPanel actions={actions} workspace={workspace} />}
    </section>
  );
}
function ComputerPanel({ actions, workspace }: { actions: ComputerActions; workspace: boolean }) {
  const computer = useBotComputer(actions);
  const refresh = useStableCallback(computer.refresh);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Read host capabilities on opening the computer workspace; starting a viewer remains explicit.
  useEffect(() => {
    if (workspace) refresh();
  }, [workspace, refresh]);
  return (
    <div className="space-y-4" aria-busy={computer.busy}>
      {workspace && (
        <div className="flex items-center gap-3">
          <MonitorIcon className="size-6 text-muted-foreground" />
          <h2 className="text-lg font-semibold">Computer</h2>
        </div>
      )}
      <p className="max-w-2xl text-sm text-muted-foreground">
        Computer access controls the host desktop and affects every connected viewer. OS permissions
        must be granted on the host.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" disabled={computer.busy} onClick={computer.refresh}>
          Refresh host capabilities
        </Button>
        <Button
          variant="outline"
          disabled={computer.busy || !actions.canCheckSetup}
          onClick={computer.checkSetup}
        >
          Check host setup
        </Button>
      </div>
      {computer.error && <p role="alert">{computer.error}</p>}
      <p role="status">{computerReadiness(computer.capabilities, computer.setup)}</p>
      {computer.setup && (
        <dl className="grid max-w-2xl grid-cols-2 gap-3 rounded-xl border p-4 text-sm">
          {computerChecks.map(([key, label]) => (
            <div key={key}>
              <dt>{label}</dt>
              <dd>{computer.setup?.[key]}</dd>
            </div>
          ))}
        </dl>
      )}
      {computer.capabilities && (
        <>
          <p>
            {computer.capabilities.platform} · {computer.capabilities.activeSessions} /{" "}
            {computer.capabilities.maxSessions} active sessions
          </p>
          <fieldset className="space-y-2 rounded-xl border p-4 text-sm" disabled={computer.busy}>
            <legend>Display shared by all viewers</legend>
            {computer.capabilities.displays.map((display) => (
              <div key={display.id}>
                <Button
                  variant="outline"
                  disabled={!actions.canSelectDisplay(display.id)}
                  aria-pressed={display.id === computer.capabilities?.selectedDisplayId}
                  onClick={() => computer.selectDisplay(display.id)}
                >
                  {display.label} ({display.width} × {display.height})
                </Button>
              </div>
            ))}
          </fieldset>
        </>
      )}
      <div className="flex gap-2">
        <Button
          disabled={computer.busy || !!computer.viewer || !actions.viewer?.canOpen}
          onClick={computer.openViewer}
        >
          Start computer viewer
        </Button>
        <Button
          disabled={computer.busy || !computer.viewer?.canClose()}
          onClick={computer.closeViewer}
        >
          Stop my viewer
        </Button>
      </div>
      {!actions.viewer?.canOpen && (
        <p role="status">
          Computer control requires desktop access for this environment connection.
        </p>
      )}
      {computer.viewer && (
        <ComputerView key={computer.viewer.id} id={computer.viewer.id} url={computer.viewer.url} />
      )}
    </div>
  );
}
