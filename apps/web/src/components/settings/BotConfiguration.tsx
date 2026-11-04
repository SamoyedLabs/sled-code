import { useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, OpenbotAdminRequest } from "@t3tools/contracts";
import { permissionView, instructionView } from "@t3tools/client-runtime/openbot/presentation";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { openbot } from "../../state/openbot";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { Textarea } from "../ui/textarea";
export function BotConfiguration({
  environmentId,
  agentId,
  hostId,
}: {
  environmentId: EnvironmentId;
  agentId: string;
  hostId: string;
}) {
  const canAdmin = useAtomValue(openbot.adminToHost.permissionAtom(environmentId));
  const admin = useAtomCommand(openbot.adminToHost, { reportFailure: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [permissions, setPermissions] = useState<ReturnType<typeof permissionView>>(null);
  const [instructions, setInstructions] = useState<ReturnType<typeof instructionView>>(null);
  const [text, setText] = useState("");
  const [revision, setRevision] = useState(0);
  const load = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const permissionResult = await admin({
      environmentId,
      input: { hostId, request: { operation: "agent.permissions.read", agentId } },
    });
    const instructionResult = await admin({
      environmentId,
      input: { hostId, request: { operation: "agent.instructions.read", agentId } },
    });
    if (permissionResult._tag === "Failure")
      setError(String(squashAtomCommandFailure(permissionResult)));
    else {
      const value = permissionView(permissionResult.value);
      setPermissions(value);
      if (value === null) setError("This host returned unsupported permission settings.");
    }
    if (instructionResult._tag === "Failure")
      setError(String(squashAtomCommandFailure(instructionResult)));
    else {
      const value = instructionView(instructionResult.value);
      setInstructions(value);
      if (value === null) setError("This host returned unsupported instructions.");
      else {
        setText(value.text);
        setRevision((value) => value + 1);
      }
    }
    setBusy(false);
  };
  const update = async (input: OpenbotAdminRequest) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const result = await admin({ environmentId, input: { hostId, request: input } });
    if (result._tag === "Failure") setError(String(squashAtomCommandFailure(result)));
    else if (input.operation === "agent.permissions.update") {
      const value = permissionView(result.value);
      setPermissions(value);
      if (value === null) setError("Reload settings before making another change.");
    } else if (input.operation === "agent.instructions.save") {
      const value = instructionView(result.value);
      setInstructions(value);
      if (value === null) setError("Reload instructions before making another change.");
    }
    setBusy(false);
  };

  return (
    <section className="space-y-3 rounded-lg border p-4" aria-label="Bot configuration">
      <h4 className="text-sm font-medium">Permissions and instructions</h4>
      <Button variant="outline" size="sm" disabled={busy || !canAdmin} onClick={() => void load()}>
        Load settings
      </Button>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {permissions && (
        <div className="space-y-2">
          <p className="text-sm">
            Access:{" "}
            {permissions.access === "workspace"
              ? "Workspace only"
              : permissions.autoApprove
                ? "Full access"
                : "Ask first"}
          </p>
          {permissions.autoApproveLocked && (
            <p className="text-sm text-muted-foreground">
              Approval settings are locked by this host.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            {(["workspace", "ask", "full"] as const).map((level) => (
              <Button
                key={level}
                variant="outline"
                size="sm"
                disabled={busy || !canAdmin || permissions.autoApproveLocked}
                onClick={() =>
                  void update({
                    operation: "agent.permissions.update",
                    agentId,
                    ...(level === "workspace"
                      ? { access: "workspace" as const }
                      : { access: "full" as const, autoApprove: level === "full" }),
                  })
                }
              >
                {level === "workspace"
                  ? "Workspace only"
                  : level === "ask"
                    ? "Ask first"
                    : "Full access"}
              </Button>
            ))}
          </div>
        </div>
      )}
      {instructions && (
        <form
          className="space-y-2"
          onSubmit={(event) => {
            event.preventDefault();
            void update({
              operation: "agent.instructions.save",
              agentId,
              text,
              expected: instructions.text,
            });
          }}
        >
          <label htmlFor={`bot-instructions-${agentId}`} className="text-sm">
            Instructions
          </label>
          <Textarea
            id={`bot-instructions-${agentId}`}
            key={revision}
            value={text}
            onChange={(event) => setText(event.target.value)}
            maxLength={32000}
            disabled={busy || !canAdmin}
          />
          <Button
            type="submit"
            size="sm"
            disabled={busy || !canAdmin || text === instructions.text}
          >
            Save instructions
          </Button>
        </form>
      )}
    </section>
  );
}
