import * as Schema from "effect/Schema";
import * as Result from "effect/Result";
import { OpenbotComputerCapabilities, OpenbotComputerSetup } from "@t3tools/contracts";
const decodeCapabilities = Schema.decodeUnknownResult(OpenbotComputerCapabilities);
const decodeSetup = Schema.decodeUnknownResult(OpenbotComputerSetup);
export function computerCapabilities(value: unknown) {
  const result = decodeCapabilities(value);
  return Result.isSuccess(result) ? result.success : null;
}
export function computerSetup(value: unknown) {
  const result = decodeSetup(value);
  return Result.isSuccess(result) ? result.success : null;
}
export const computerChecks = [
  ["screenRecording", "Screen recording"],
  ["accessibility", "Accessibility"],
  ["service", "Streaming service"],
  ["displays", "Displays"],
  ["guiSession", "Desktop session"],
] as const;
export function computerReadiness(
  capabilities: OpenbotComputerCapabilities | null,
  setup: OpenbotComputerSetup | null,
) {
  if (!capabilities) return "Check host capabilities first.";
  if (!capabilities.ready) return "Remote desktop runtime is unavailable on this host.";
  if (!setup) return "Check host setup before connecting.";
  if (setup.restartRequired) return "Restart the host application after granting OS permissions.";
  const blocked = computerChecks.filter(([key]) => setup[key] !== "allowed");
  if (blocked.length) return blocked.map(([key, label]) => `${label}: ${setup[key]}`).join(". ");
  if (!capabilities.displays.length) return "No displays are available on this host.";
  if (capabilities.activeSessions >= capabilities.maxSessions)
    return "The host has reached its remote desktop session limit.";
  return "Host checks passed. The authenticated computer viewer is not available in Sled yet.";
}
