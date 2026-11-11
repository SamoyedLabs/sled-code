import * as Option from "effect/Option";
import { Atom } from "effect/reactivity";
import { scopedThreadKey } from "../lib/scopedEntities";
import { appAtomRegistry } from "./atom-registry";
import { threadHasCaughtUpTo } from "@t3tools/client-runtime/state/threads";
import type { AcknowledgedThreadMessage, QueuedThreadMessage } from "./thread-outbox-model";
import { environmentThreadDetails } from "./threads";

const retainedMessagesAtom = Atom.make<ReadonlyArray<AcknowledgedThreadMessage>>([]).pipe(
  Atom.keepAlive,
);
const echoedMessages = new WeakSet<AcknowledgedThreadMessage>();

export const acknowledgedThreadMessagesAtom = Atom.writable(
  (get) => {
    const current = get(retainedMessagesAtom);
    const next = current.filter((message) => {
      if (echoedMessages.has(message)) return false;
      const stateAtom = environmentThreadDetails.stateAtom({
        environmentId: message.environmentId,
        threadId: message.threadId,
      });
      // Observe an already loaded thread without opening a stream for an offscreen delivery.
      const node = appAtomRegistry.getNodes().get(stateAtom);
      if (node === undefined || Option.isNone(node.valueOption())) return true;
      const thread = get(stateAtom);
      if (
        !threadHasCaughtUpTo(message, {
          sequence: thread.sequence,
          messages: Option.getOrUndefined(thread.data)?.messages,
        })
      )
        return true;
      // Paging or reconnecting must never turn an observed echo back into a pending row.
      echoedMessages.add(message);
      return false;
    });
    return next.length === current.length ? current : next;
  },
  (context, messages: ReadonlyArray<AcknowledgedThreadMessage>) =>
    context.set(retainedMessagesAtom, messages),
).pipe(Atom.setIdleTTL(0));

function writeAcknowledgedThreadMessages(
  update: (
    current: ReadonlyArray<AcknowledgedThreadMessage>,
  ) => ReadonlyArray<AcknowledgedThreadMessage>,
) {
  const current = appAtomRegistry.get(acknowledgedThreadMessagesAtom);
  const next = update(current);
  if (next.length === current.length && next.every((entry, index) => entry === current[index])) {
    return;
  }
  appAtomRegistry.set(acknowledgedThreadMessagesAtom, next);
}

export function retainAcknowledgedThreadMessage(message: AcknowledgedThreadMessage) {
  writeAcknowledgedThreadMessages((current) =>
    current.some((entry) => entry.messageId === message.messageId)
      ? current
      : [...current, message],
  );
}

// A bounded window later pages the message out and a remount restarts at sequence 0, so
// rows must leave as soon as their thread has caught up, not at the next write.
export function pruneCaughtUpAcknowledgedThreadMessages(
  threadKey: string,
  thread: Parameters<typeof threadHasCaughtUpTo>[1],
) {
  writeAcknowledgedThreadMessages((current) =>
    current.filter(
      (entry) =>
        scopedThreadKey(entry.environmentId, entry.threadId) !== threadKey ||
        !threadHasCaughtUpTo(entry, thread),
    ),
  );
}

export function forgetAcknowledgedThreadMessage(message: QueuedThreadMessage) {
  writeAcknowledgedThreadMessages((current) =>
    current.filter((entry) => entry.messageId !== message.messageId),
  );
}
