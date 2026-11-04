import { useState } from "react";
import { computerChecks, computerReadiness } from "@t3tools/client-runtime/openbot/presentation";
import type { ComputerActions } from "@t3tools/client-runtime/openbot/presentation";
import { Button } from "../ui/button";
import { useBotComputer } from "./useBotComputer";

export function BotComputer({ actions }: { actions: ComputerActions }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <section aria-label="Host computer" className="space-y-3">
      <Button
        variant="outline"
        size="sm"
        aria-expanded={expanded}
        onClick={() => setExpanded(!expanded)}
      >
        Computer
      </Button>
      {expanded && <ComputerPanel actions={actions} />}
    </section>
  );
}
function ComputerPanel({ actions }: { actions: ComputerActions }) {
  const computer = useBotComputer(actions);
  return (
    <div className="space-y-3" aria-busy={computer.busy}>
      <p>
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
        <dl>
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
          <fieldset disabled={computer.busy}>
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
        <Button disabled>Start computer viewer</Button>
        <Button disabled>Stop my viewer</Button>
      </div>
      <p>
        The authenticated computer viewer is unavailable. No session is opened by these checks.
        Existing host sessions cannot be stopped from this panel.
      </p>
    </div>
  );
}
