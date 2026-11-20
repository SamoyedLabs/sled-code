import { useEffect, useRef, useState } from "react";
import type { OpenbotAdminRequest } from "@t3tools/contracts";
import type { OpenbotSettingsRequest } from "@t3tools/contracts/openbot-settings";
import type { Json } from "effect/Schema";
import { useStableCallback } from "../../../../hooks/useStableCallback";
export interface AgentSettingsApi {
  agentId: string;
  capabilities: readonly string[];
  canAdmin: (request: OpenbotAdminRequest) => boolean;
  admin: (request: OpenbotAdminRequest) => Promise<unknown>;
  setting: (operation: OpenbotSettingsRequest["operation"], parameters?: Json) => Promise<unknown>;
}
export function useAgentSettingsValue<T>(load: () => Promise<T>, key: string) {
  const [value, setValue] = useState<T | null>(null),
    [error, setError] = useState<string | null>(null),
    [busy, setBusy] = useState(false);
  const generation = useRef(0),
    lock = useRef(false);
  const refresh = useStableCallback(async () => {
    const current = ++generation.current;
    setBusy(true);
    setError(null);
    try {
      const result = await load();
      if (generation.current === current) setValue(result);
    } catch (cause) {
      if (generation.current === current)
        setError(cause instanceof Error ? cause.message : "The setting could not be read.");
    } finally {
      if (generation.current === current) setBusy(false);
    }
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Read this source page's guarded host setting and discard responses after its page scope is disposed.
  useEffect(() => {
    if (key) void refresh();
    return () => {
      generation.current++;
    };
  }, [key, refresh]);
  const change = async (action: () => Promise<unknown>) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError(null);
    try {
      await action();
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The setting could not be saved.");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  return { value, error, busy, refresh, change };
}
