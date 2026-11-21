import * as Schema from "effect/Schema";
import * as Result from "effect/Result";
import { OpenbotComputerCapabilities, OpenbotComputerSetup } from "@t3tools/contracts";
import { mFallback, msg } from "gt-i18n";
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
  if (!capabilities) return mFallback(msg("Check host capabilities first."));
  if (!capabilities.ready)
    return mFallback(msg("Remote desktop runtime is unavailable on this host."));
  if (!setup) return mFallback(msg("Check host setup before connecting."));
  if (setup.restartRequired)
    return mFallback(msg("Restart the host application after granting OS permissions."));
  const blocked = computerChecks.filter(([key]) => setup[key] !== "allowed");
  if (blocked.length) return blocked.map(([key, label]) => `${label}: ${setup[key]}`).join(". ");
  if (!capabilities.displays.length)
    return mFallback(msg("No displays are available on this host."));
  if (capabilities.activeSessions >= capabilities.maxSessions)
    return mFallback(msg("The host has reached its remote desktop session limit."));
  return mFallback(msg("Host checks passed. Start the computer viewer to connect."));
}
