import { useEffect, useEffectEvent, useRef, useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import { type EnvironmentId, type OpenbotConversationMessage } from "@t3tools/contracts";
import { botConversationPage } from "@t3tools/client-runtime/openbot/presentation";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { openbot } from "../../../../state/openbot";
import { useEnvironmentQuery } from "../../../../state/query";
import { useAtomCommand } from "../../../../state/use-atom-command";
import { readPreparedConnection } from "../../../../state/session";
import { randomUUID } from "../../../../lib/utils";
import {
  assistantReceipt,
  resolveRoutineAssistant,
  type AssistantAttempt,
} from "./routineAssistant";
export interface CanvasChatMessage {
  id: string;
  author: "user" | "agent";
  text: string;
  message?: OpenbotConversationMessage;
}
export function useRoutineAssistant(environmentId: EnvironmentId, hostId: string, agentId: string) {
  const [messages, setMessages] = useState<CanvasChatMessage[]>([]),
    [pending, setPending] = useState<AssistantAttempt | null>(null),
    [sending, setSending] = useState(false),
    [error, setError] = useState<string | null>(null),
    [uncertain, setUncertain] = useState(false);
  const lock = useRef(false),
    alive = useRef(true),
    connection = useRef(readPreparedConnection(environmentId));
  const write = useAtomCommand(openbot.writeToHost, { reportFailure: false });
  const allowed = useAtomValue(openbot.writeToHost.permissionAtom(environmentId));
  const current = () =>
    alive.current &&
    connection.current !== null &&
    readPreparedConnection(environmentId) === connection.current;
  const latest = useEnvironmentQuery(
    pending
      ? openbot.readFromHost({
          environmentId,
          input: {
            hostId,
            request: {
              operation: "conversation.page",
              agentId,
              anchor: { type: "latest" },
              limit: 100,
              deferDetails: true,
            },
          },
        })
      : null,
  );
  const around = useEnvironmentQuery(
    pending
      ? openbot.readFromHost({
          environmentId,
          input: {
            hostId,
            request: {
              operation: "conversation.page",
              agentId,
              anchor: { type: "around", messageId: pending.messageId },
              limit: 100,
              deferDetails: true,
            },
          },
        })
      : null,
  );
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- A late host reply may not update a closed or replaced canvas session.
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const resolution = pending
    ? resolveRoutineAssistant(
        pending,
        botConversationPage(around.data),
        botConversationPage(latest.data),
      )
    : null;
  const outcome =
    resolution?.kind === "complete"
      ? (resolution.answer?.id ?? "no-answer")
      : resolution?.kind === "failed"
        ? resolution.error
        : null;
  const consume = useEffectEvent(() => {
    if (!pending || !resolution || resolution.kind === "waiting" || !current()) return;
    if (resolution.kind === "failed") setError(resolution.error);
    else if (resolution.answer) {
      const answer = resolution.answer;
      setMessages((old) =>
        old.some((m) => m.id === answer.id)
          ? old
          : [...old, { id: answer.id, author: "agent", text: answer.text, message: answer }],
      );
    }
    setPending(null);
    lock.current = false;
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Consume one authoritative external delivery result at its receipt/answer milestone.
  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- Commit the exact externally delivered turn result once.
    if (outcome !== null) consume();
  }, [outcome]);
  const send = async (text: string) => {
    const body = text.trim();
    if (!body || lock.current || uncertain || !allowed) return;
    if (!current()) {
      setError("Reconnect the original host session before sending.");
      return;
    }
    lock.current = true;
    setSending(true);
    setError(null);
    const clientMessageId = randomUUID();
    setMessages((old) => [...old, { id: clientMessageId, author: "user", text: body }]);
    try {
      const result = await write({
        environmentId,
        input: {
          hostId,
          request: { operation: "conversation.send", agentId, text: body, clientMessageId },
        },
      });
      if (result._tag === "Failure") throw squashAtomCommandFailure(result);
      const receipt = assistantReceipt(result.value, agentId, clientMessageId);
      if (!receipt) throw new Error("The host did not return this agent’s delivery receipt.");
      if (current()) setPending(receipt);
    } catch (cause) {
      if (current()) {
        setUncertain(true);
        setError(
          `The request outcome could not be confirmed. Open the agent conversation before sending again. ${cause instanceof Error ? cause.message : ""}`,
        );
      }
    } finally {
      if (alive.current) setSending(false);
    }
  };
  return {
    messages,
    working: sending || pending !== null,
    error: error ?? around.error ?? latest.error,
    canSend: allowed && !uncertain,
    send,
    refresh: () => {
      around.refresh();
      latest.refresh();
    },
  };
}
