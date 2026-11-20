import { useEffect, useRef, useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, OpenbotPerson, OpenbotDirectPage } from "@t3tools/contracts";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { openbot } from "../../../state/openbot";
import { useEnvironmentQuery } from "../../../state/query";
import { useAtomCommand } from "../../../state/use-atom-command";
import { useAtomQueryRunner } from "../../../state/use-atom-query-runner";
import { readPreparedConnection } from "../../../state/session";
import { randomUUID } from "../../../lib/utils";
import { useClientSettings } from "../../../hooks/useSettings";
import { SourceDirectConversation } from "./SourceDirectConversation";
import {
  decodeDirectPage,
  decodeDirectMessage,
  decodeDirectReadState,
  directMessages,
  readDirectDraft,
  validDirectPage,
  type DirectDraft,
} from "./directModel";

export function ReactBotDirectConversation({
  environmentId,
  hostId,
  member,
  selfId,
  onChanged,
}: {
  environmentId: EnvironmentId;
  hostId: string;
  member: OpenbotPerson;
  selfId: string;
  onChanged: () => void;
}) {
  const key = `openbot.direct-draft:${JSON.stringify([environmentId, hostId, selfId, member.id])}`;
  const [draft, setDraft] = useState(() => readDirectDraft(localStorage, key));
  const [window, setWindow] = useState<OpenbotDirectPage | null>(null);
  const [older, setOlder] = useState<readonly OpenbotDirectPage[]>([]);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const lock = useRef(false),
    alive = useRef(true);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Fence in-flight transport replies when this scoped conversation unmounts.
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const settings = useClientSettings();
  const query = useEnvironmentQuery(
    openbot.readFromHost({
      environmentId,
      input: {
        hostId,
        request: {
          operation: "direct.page",
          memberId: member.id,
          anchor: { type: "latest" },
          limit: 100,
        },
      },
    }),
  );
  const decoded = decodeDirectPage(query.data);
  const latest =
    decoded._tag === "Some" && validDirectPage(decoded.value, member.id, selfId)
      ? decoded.value
      : null;
  const shown = window ?? latest;
  const canSend = useAtomValue(
    openbot.writeToHost.permissionAtom(environmentId, {
      hostId,
      request: {
        operation: "direct.send",
        memberId: member.id,
        text: "permission",
        clientMessageId: "permission",
      },
    }),
  );
  const write = useAtomCommand(openbot.writeToHost, { reportFailure: false });
  const read = useAtomQueryRunner(openbot.readFromHost, { reportFailure: false, refresh: true });
  const updateDraft = (next: DirectDraft) => {
    setDraft(next);
    try {
      localStorage.setItem(key, JSON.stringify(next));
    } catch {
      /* Keep the live draft if storage is unavailable. */
    }
  };
  const current = (connection: ReturnType<typeof readPreparedConnection>) =>
    alive.current && readPreparedConnection(environmentId) === connection;
  const refresh = () => {
    query.refresh();
    onChanged();
  };
  const send = async () => {
    if (lock.current || !canSend || member.disabled || !draft.text.trim()) return;
    const connection = readPreparedConnection(environmentId);
    if (!connection) {
      setError("Reconnect before sending this message.");
      return;
    }
    const attempt = draft.attempt ?? { id: randomUUID(), text: draft.text.trim() };
    updateDraft({ text: attempt.text, attempt });
    lock.current = true;
    setBusy(true);
    setError(null);
    try {
      const result = await write({
        environmentId,
        input: {
          hostId,
          request: {
            operation: "direct.send",
            memberId: member.id,
            text: attempt.text,
            clientMessageId: attempt.id,
          },
        },
      });
      if (!current(connection)) return;
      if (result._tag === "Failure") throw Error(String(squashAtomCommandFailure(result)));
      const receipt = decodeDirectMessage(result.value);
      if (
        receipt._tag !== "Some" ||
        receipt.value.senderMemberId !== selfId ||
        receipt.value.recipientMemberId !== member.id ||
        receipt.value.text !== attempt.text
      )
        throw Error("The host returned a receipt for a different message.");
      updateDraft({ text: "", attempt: null });
      setWindow(null);
      setOlder([]);
      refresh();
    } catch (cause) {
      if (current(connection))
        setError(cause instanceof Error ? cause.message : "The message could not be confirmed.");
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  };
  const loadOlder = async () => {
    const page = older.at(-1) ?? shown,
      cursor = page?.pageInfo.olderCursor;
    if (lock.current || !cursor || !shown) return;
    const connection = readPreparedConnection(environmentId),
      threadId = shown.threadId;
    lock.current = true;
    setBusy(true);
    setError(null);
    try {
      const result = await read({
        environmentId,
        input: {
          hostId,
          request: {
            operation: "direct.page",
            memberId: member.id,
            anchor: { type: "before", cursor },
            limit: 100,
          },
        },
      });
      if (!current(connection)) return;
      if (result._tag === "Failure") throw Error("Older messages could not be loaded.");
      const value = decodeDirectPage(result.value);
      if (
        value._tag !== "Some" ||
        value.value.threadId !== threadId ||
        !validDirectPage(value.value, member.id, selfId)
      )
        throw Error("The host returned a different conversation.");
      setOlder((pages) => [...pages, value.value]);
    } catch (cause) {
      if (current(connection))
        setError(cause instanceof Error ? cause.message : "Older messages could not be loaded.");
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  };
  const openMessage = async (messageId: string) => {
    if (lock.current) return;
    const connection = readPreparedConnection(environmentId);
    lock.current = true;
    setBusy(true);
    setError(null);
    try {
      const result = await read({
        environmentId,
        input: {
          hostId,
          request: {
            operation: "direct.page",
            memberId: member.id,
            anchor: { type: "around", messageId },
            limit: 100,
          },
        },
      });
      if (!current(connection)) return;
      if (result._tag === "Failure") throw Error("The original message could not be loaded.");
      const value = decodeDirectPage(result.value);
      if (
        value._tag !== "Some" ||
        !validDirectPage(value.value, member.id, selfId) ||
        !value.value.messages.some((message) => message.id === messageId)
      )
        throw Error("The host did not return the original message.");
      setWindow(value.value);
      setOlder([]);
    } catch (cause) {
      if (current(connection))
        setError(
          cause instanceof Error ? cause.message : "The original message could not be loaded.",
        );
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  };
  const markRead = async () => {
    const throughSequence = shown?.messages.at(-1)?.sequence;
    if (lock.current || !canSend || throughSequence === undefined) return;
    const connection = readPreparedConnection(environmentId);
    lock.current = true;
    setBusy(true);
    setError(null);
    try {
      const result = await write({
        environmentId,
        input: {
          hostId,
          request: { operation: "direct.markRead", memberId: member.id, throughSequence },
        },
      });
      if (!current(connection)) return;
      if (result._tag === "Failure") throw Error(String(squashAtomCommandFailure(result)));
      const readState = decodeDirectReadState(result.value);
      if (readState._tag !== "Some") throw Error("The host returned an unsupported read boundary.");
      setWindow((current) => (current ? { ...current, readState: readState.value } : null));
      refresh();
    } catch (cause) {
      if (current(connection))
        setError(cause instanceof Error ? cause.message : "Read status could not be saved.");
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  };
  return (
    <SourceDirectConversation
      member={member}
      selfId={selfId}
      messages={directMessages(shown, older)}
      readState={shown?.readState}
      loading={query.isPending && !query.data}
      error={
        error ??
        query.error ??
        (query.data && !latest
          ? "The host returned a different or unsupported conversation."
          : null)
      }
      hasOlder={(older.at(-1) ?? shown)?.pageInfo.hasOlder ?? false}
      busy={busy}
      text={draft.text}
      uncertain={draft.attempt !== null}
      canSend={canSend && !member.disabled}
      modifierSend={
        settings.sendShortcut !== "enter" &&
        (settings.sendShortcut !== "mod-enter-multiline" || /[\r\n]/.test(draft.text))
      }
      onText={(text) => updateDraft({ text, attempt: null })}
      onSend={() => void send()}
      onOlder={() => void loadOlder()}
      onMarkRead={() => void markRead()}
      anchored={window !== null}
      onOpenMessage={(messageId) => void openMessage(messageId)}
      onLatest={() => {
        setWindow(null);
        setOlder([]);
        query.refresh();
      }}
      onRefresh={refresh}
    />
  );
}
