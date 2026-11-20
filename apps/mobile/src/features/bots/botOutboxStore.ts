import * as Schema from "effect/Schema";
import { OPENBOT_MAX_FILE_BYTES } from "@t3tools/contracts";

const Id = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(512));
const Chat = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("agent"),
    id: Id,
    taskId: Schema.optionalKey(Schema.NullOr(Id)),
  }),
  Schema.Struct({ kind: Schema.Literal("group"), id: Id }),
]);
export type OutboxChat = typeof Chat.Type;
const OutboxFile = Schema.Struct({
  id: Schema.String.check(Schema.isPattern(/^[a-f0-9-]{36}$/u)),
  name: Schema.String.check(
    Schema.isMinLength(1),
    Schema.isMaxLength(255),
    Schema.isPattern(/^[^/\\\u0000-\u001f\u007f]+$/u),
  ),
  mimeType: Schema.String.check(
    Schema.isMinLength(1),
    Schema.isMaxLength(255),
    Schema.isPattern(/^[^\r\n\u0000]+$/u),
  ),
  size: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: OPENBOT_MAX_FILE_BYTES })),
  sha256: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/u)),
});
export type BotOutboxFile = typeof OutboxFile.Type;
export const decodeBotOutboxFile = Schema.decodeUnknownOption(OutboxFile);
const OutboxEntry = Schema.Struct({
  id: Id,
  hostId: Id,
  chat: Chat,
  text: Schema.String.check(Schema.isMaxLength(20_000)),
  replyToMessageId: Schema.NullOr(Id),
  expectedThreadId: Schema.optionalKey(Id),
  groupAttachmentAgentId: Schema.optionalKey(Id),
  sealed: Schema.optionalKey(Schema.Boolean),
  files: Schema.optionalKey(Schema.Array(OutboxFile).check(Schema.isMaxLength(10))),
}).check(
  Schema.makeFilter((entry) => {
    const files = entry.files ?? [];
    const groupFiles = entry.chat.kind === "group" && files.length > 0;
    const hasBoundFiles =
      files.length === 0 ||
      (Boolean(entry.expectedThreadId) &&
        (entry.chat.kind === "agent" ||
          (entry.expectedThreadId === entry.chat.id && Boolean(entry.groupAttachmentAgentId))));
    return (
      Boolean(entry.text.trim() || files.length) &&
      hasBoundFiles &&
      (groupFiles || entry.groupAttachmentAgentId === undefined) &&
      new Set(files.map((file) => file.id)).size === files.length
    );
  }),
);
export type BotOutboxEntry = typeof OutboxEntry.Type;
const decodeEntry = Schema.decodeUnknownOption(OutboxEntry);
const decode = Schema.decodeUnknownOption(
  Schema.Array(OutboxEntry).check(
    Schema.isMaxLength(50),
    Schema.makeFilter((rows) => new Set(rows.map((row) => row.id)).size === rows.length),
  ),
);
type Snapshot = {
  entries: readonly BotOutboxEntry[];
  ready: boolean;
  sending: string | null;
  editing: string | null;
  failed: string | null;
  storageError: boolean;
};
export const emptyBotOutbox: Snapshot = {
  entries: [],
  ready: false,
  sending: null,
  editing: null,
  failed: null,
  storageError: false,
};

export function createBotOutbox(storage: {
  read: () => Promise<unknown>;
  save: (entries: readonly BotOutboxEntry[]) => Promise<boolean>;
  newId: () => string;
  releaseFiles?: (files: readonly BotOutboxFile[]) => Promise<void>;
}) {
  let snapshot = emptyBotOutbox;
  let loaded: Promise<void> | undefined;
  let tail = Promise.resolve<unknown>(undefined);
  const listeners = new Set<() => void>();
  const update = (patch: Partial<Snapshot>) => {
    snapshot = { ...snapshot, ...patch };
    for (const listener of listeners) listener();
  };
  const load = () =>
    (loaded ??= storage
      .read()
      .then((data) => {
        if (data === null) {
          update({ ready: true });
          return;
        }
        const result = decode(data);
        if (result._tag !== "Some") throw new Error("The saved messages could not be read.");
        update({ entries: result.value, ready: true });
      })
      .catch(() => update({ storageError: true })));

  function save(next: (previous: readonly BotOutboxEntry[]) => readonly BotOutboxEntry[] | null) {
    const result = tail
      .then(async () => {
        await load();
        if (!snapshot.ready) return false;
        const entries = next(snapshot.entries);
        if (!entries) return false;
        if (entries === snapshot.entries) return true;
        if (entries.length > 50 || !(await storage.save(entries))) return false;
        update({ entries, storageError: false });
        return true;
      })
      .catch(() => {
        update({ storageError: true });
        return false;
      });
    tail = result;
    return result;
  }
  return {
    snapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    load,
    enqueue(input: Omit<BotOutboxEntry, "id" | "sealed">) {
      const entry = decodeEntry({
        ...input,
        id: storage.newId(),
        sealed: false,
        text: input.text.trim(),
      });
      return entry._tag === "Some"
        ? save((entries) => [...entries, entry.value])
        : Promise.resolve(false);
    },
    beginEdit(id: string) {
      const entry = snapshot.entries.find((item) => item.id === id);
      if (snapshot.editing || snapshot.sending === id || entry?.sealed !== false) return false;
      update({ editing: id });
      return true;
    },
    endEdit(id: string) {
      if (snapshot.editing === id) update({ editing: null });
    },
    async saveEdit(
      id: string,
      text: string,
      attachments?: { keep: ReadonlySet<string>; add: readonly BotOutboxFile[] },
    ) {
      let removed: readonly BotOutboxFile[] = [];
      const edited = await save((entries) => {
        if (snapshot.editing !== id || snapshot.sending === id) return null;
        const previous = entries.find((entry) => entry.id === id);
        if (previous?.sealed !== false) return null;
        const { files, groupAttachmentAgentId, ...body } = previous;
        const originals = files ?? [];
        if (
          attachments &&
          attachments.add.some((file) =>
            entries.some((entry) => entry.files?.some((stored) => stored.id === file.id)),
          )
        )
          return null;
        const nextFiles = attachments
          ? [...originals.filter((file) => attachments.keep.has(file.id)), ...attachments.add]
          : originals;
        const entry = decodeEntry({
          ...body,
          text: text.trim(),
          ...(nextFiles.length
            ? { files: nextFiles, ...(groupAttachmentAgentId ? { groupAttachmentAgentId } : {}) }
            : {}),
        });
        if (entry._tag !== "Some") return null;
        if (attachments) removed = originals.filter((file) => !attachments.keep.has(file.id));
        return entries.map((item) => (item.id === id ? entry.value : item));
      });
      if (edited && snapshot.editing === id) {
        update({ editing: null, failed: snapshot.failed === id ? null : snapshot.failed });
      }
      if (edited && removed.length) await storage.releaseFiles?.(removed).catch(() => undefined);
      return edited;
    },
    async cancel(id: string) {
      if (snapshot.sending === id || snapshot.editing === id) return false;
      let files: readonly BotOutboxFile[] = [];
      const removed = await save((entries) => {
        if (snapshot.sending === id || snapshot.editing === id) return null;
        files = entries.find((entry) => entry.id === id)?.files ?? [];
        return entries.filter((entry) => entry.id !== id);
      });
      if (removed && files.length) await storage.releaseFiles?.(files).catch(() => undefined);
      return removed;
    },
    async claim(entry: BotOutboxEntry) {
      const { id } = entry;
      if (
        snapshot.sending ||
        snapshot.failed === id ||
        snapshot.editing === id ||
        snapshot.entries[0] !== entry
      ) {
        return false;
      }
      update({ sending: id });
      // Once a delivery can have reached the host, retries must reuse exactly the same body.
      // Older records may already have been sent, so they are treated as sealed.
      if (entry.sealed !== false) return true;
      const sealed = await save((entries) =>
        entries.map((item) => (item.id === id ? { ...item, sealed: true } : item)),
      );
      if (!sealed) update({ sending: null, failed: id });
      return sealed;
    },
    async settle(id: string, accepted: boolean) {
      if (snapshot.sending !== id) return;
      const files = snapshot.entries.find((entry) => entry.id === id)?.files ?? [];
      const removed =
        accepted && (await save((entries) => entries.filter((entry) => entry.id !== id)));
      update({ sending: null, failed: removed ? null : id });
      if (removed && files.length) await storage.releaseFiles?.(files).catch(() => undefined);
    },
    retry() {
      update({ failed: null });
    },
  };
}

export function outboxChatMatches(left: OutboxChat, right: OutboxChat) {
  return (
    left.kind === right.kind &&
    left.id === right.id &&
    (left.kind !== "agent" ||
      (left.taskId ?? null) === (right.kind === "agent" ? (right.taskId ?? null) : null))
  );
}
