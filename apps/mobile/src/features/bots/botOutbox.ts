import { randomUUID } from "expo-crypto";
import { useEffect, useSyncExternalStore } from "react";
import { readBotPrivateRecord, storeBotPrivateRecord } from "./botOfflineCache";
import { createBotOutbox, emptyBotOutbox } from "./botOutboxStore";
import { releaseBotOutboxFiles } from "./botOutboxFiles";

export { outboxChatMatches, type BotOutboxEntry, type OutboxChat } from "./botOutboxStore";

const outboxes = new Map<string, ReturnType<typeof createBotOutbox>>();
const noSubscription = () => () => {};
const blank = () => emptyBotOutbox;

export function useBotOutbox(scope: string | null) {
  let outbox = scope ? outboxes.get(scope) : undefined;
  if (scope && !outbox) {
    outbox = createBotOutbox({
      read: () => readBotPrivateRecord(scope, "outbox"),
      save: (entries) => storeBotPrivateRecord(scope, "outbox", entries),
      newId: randomUUID,
      releaseFiles: (files) => releaseBotOutboxFiles(scope, files),
    });
    outboxes.set(scope, outbox);
  }
  const snapshot = useSyncExternalStore(
    outbox?.subscribe ?? noSubscription,
    outbox?.snapshot ?? blank,
  );
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Load the persisted send queue for this authenticated local profile.
  useEffect(() => {
    void outbox?.load();
  }, [outbox]);
  return { outbox, snapshot };
}
