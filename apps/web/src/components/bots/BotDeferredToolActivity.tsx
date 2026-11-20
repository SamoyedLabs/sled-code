import { useEffect, useRef, useState } from "react";
import { OpenbotConversationDetail, type EnvironmentId } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import * as Result from "effect/Result";
import { openbot } from "../../state/openbot";
import { useAtomQueryRunner } from "../../state/use-atom-query-runner";
import { readPreparedConnection } from "../../state/session";
import { useStableCallback } from "../../hooks/useStableCallback";
import { Button } from "../ui/button";
import { ChevronRightIcon } from "lucide-react";
import { BotToolActivity } from "./BotToolActivity";

export type BotTraceScope = {
  environmentId: EnvironmentId;
  hostId: string;
  messageId: string;
} & (
  | { channelId: string; agentId?: never; taskId?: never }
  | { channelId?: never; agentId: string; taskId: string | null }
);

const decode = Schema.decodeUnknownResult(OpenbotConversationDetail);
const MAX_TRACE_CHARS = 2 * 1024 * 1024;

export function BotDeferredToolActivity({ scope }: { scope: BotTraceScope }) {
  const read = useAtomQueryRunner(openbot.readFromHost, { reportFailure: false, refresh: true });
  const currentScope = useStableCallback(() => JSON.stringify(scope));
  const mounted = useRef(false);
  const lock = useRef<symbol | null>(null);
  const epoch = useRef(0);
  const [state, setState] = useState<{
    phase: "idle" | "loading" | "ready" | "error";
    trace?: unknown;
  }>({ phase: "idle" });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Ignore late read completions after the owning conversation hides or unmounts.
  useEffect(() => {
    mounted.current = true;
    // oxlint-disable-next-line react/set-state-in-effect -- A retained view resumes with an interrupted external read; release its stale loading state once.
    setState((current) => (current.phase === "loading" ? { phase: "idle" } : current));
    return () => {
      mounted.current = false;
      epoch.current++;
      lock.current = null;
    };
  }, []);
  const load = async () => {
    if (lock.current) return;
    const attempt = Symbol();
    lock.current = attempt;
    const generation = epoch.current;
    const identity = currentScope(),
      connection = readPreparedConnection(scope.environmentId);
    const valid = () =>
      mounted.current &&
      epoch.current === generation &&
      currentScope() === identity &&
      readPreparedConnection(scope.environmentId) === connection;
    setState({ phase: "loading" });
    try {
      let offset = 0,
        version: string | null = null,
        text = "";
      for (let part = 0; part < 128; part++) {
        if (!valid()) return;
        const result = await read({
          environmentId: scope.environmentId,
          input: {
            hostId: scope.hostId,
            request:
              scope.channelId !== undefined
                ? {
                    operation: "channel.trace",
                    channelId: scope.channelId,
                    messageId: scope.messageId,
                    offset,
                    version,
                  }
                : {
                    operation: "conversation.detail",
                    agentId: scope.agentId,
                    taskId: scope.taskId,
                    messageId: scope.messageId,
                    field: "trace",
                    offset,
                    version,
                  },
          },
        });
        if (!valid()) return;
        if (result._tag === "Failure") throw Error("Trace read refused");
        const parsed = decode(result.value);
        if (!Result.isSuccess(parsed)) throw Error("Unsupported trace");
        const page = parsed.success;
        if (
          page.messageId !== scope.messageId ||
          page.field !== "trace" ||
          page.offset !== offset ||
          (version !== null && page.version !== version) ||
          page.totalLength > MAX_TRACE_CHARS
        )
          throw Error("Trace identity changed");
        text += page.value;
        if (text.length > MAX_TRACE_CHARS) throw Error("Trace too large");
        if (page.nextOffset === null) {
          setState({ phase: "ready", trace: JSON.parse(text) });
          return;
        }
        if (page.nextOffset !== offset + page.value.length || page.nextOffset <= offset)
          throw Error("Invalid trace page");
        offset = page.nextOffset;
        version = page.version;
      }
      throw Error("Trace too large");
    } catch {
      if (valid()) setState({ phase: "error" });
    } finally {
      if (lock.current === attempt) lock.current = null;
    }
  };
  if (state.phase === "ready") return <BotToolActivity trace={state.trace} initialOpen />;
  return (
    <div className="min-w-0 text-xs">
      <Button
        variant="ghost-muted"
        size="xs"
        className="-ml-2"
        disabled={state.phase === "loading"}
        onClick={() => void load()}
      >
        {state.phase === "loading" ? "Loading activity…" : "Activity"}
        <ChevronRightIcon className="size-3" aria-hidden="true" />
      </Button>
      {state.phase === "error" && (
        <p role="alert" className="text-destructive">
          The trace changed or could not be read. Open Activity to retry.
        </p>
      )}
    </div>
  );
}
