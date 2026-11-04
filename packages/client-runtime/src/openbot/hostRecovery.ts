import type { OpenbotHostStatus } from "@t3tools/contracts";

export function botHostRecoveryDescription(status: OpenbotHostStatus): string {
  if (status.desiredRunning === undefined)
    return "This server controls the engine for the current session. Update its Sled server to enable automatic startup and recovery.";
  if (status.recovery?.state === "preference-error")
    return "The startup preference could not be saved or loaded. Check this machine's storage before relying on automatic startup; Stop may only apply to this session.";
  if (status.recovery?.state === "exhausted")
    return "Automatic recovery paused after six attempts. Check the startup error, then choose Retry engine or Stop to disable automatic startup.";
  if (status.recovery?.state === "backoff")
    return `The engine will retry after a short delay (attempt ${status.recovery.attempt} of 6). Stop cancels recovery and automatic startup.`;
  if (status.recovery?.state === "switching")
    return "The engine runtime is switching. Stop also disables automatic startup.";
  return status.desiredRunning
    ? "Automatic startup is enabled. This engine starts with Sled and recovers from unexpected exits while Sled is running."
    : "Starting the engine enables automatic startup and crash recovery on this machine. Stop turns both off.";
}
