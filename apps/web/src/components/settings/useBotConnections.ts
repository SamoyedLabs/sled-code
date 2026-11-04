import { useRef, useState } from "react";
import {
  EMPTY_BOT_CONNECTIONS,
  botConnectionResult,
  type BotConnectionState,
  type BotConnectionExecute,
} from "@t3tools/client-runtime/openbot/presentation";
import type { OpenbotAdminRequest } from "@t3tools/contracts";
export function useBotConnections(execute: BotConnectionExecute) {
  const [state, setState] = useState<BotConnectionState>(EMPTY_BOT_CONNECTIONS);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lock = useRef(false);
  const run = async (requests: readonly OpenbotAdminRequest[]) => {
    if (lock.current) return false;
    lock.current = true;
    setBusy(true);
    setError(null);
    let next: BotConnectionState = { ...state, notice: null };
    setState(next);
    let success = true;
    for (const request of requests) {
      const result = await execute(request).catch(
        (): Awaited<ReturnType<BotConnectionExecute>> => ({
          ok: false,
          error: "Could not update this connection. Refresh and try again.",
        }),
      );
      if (!result.ok) {
        setError(result.error);
        success = false;
        break;
      }
      const projected = botConnectionResult(next, request, result.value);
      if (!projected) {
        setError(
          "This engine returned unsupported connection settings. Refresh before changing them.",
        );
        success = false;
        break;
      }
      next = projected;
      setState(next);
    }
    setBusy(false);
    lock.current = false;
    return success;
  };
  return {
    state,
    busy,
    error,
    run,
    setError,
    clearSkills: () => setState({ ...state, skills: null }),
    clearFeedback: () => {
      setError(null);
      setState({ ...state, notice: null });
    },
  };
}

export type BotConnectionPanelProps = {
  controller: ReturnType<typeof useBotConnections>;
  allowed: boolean;
};
