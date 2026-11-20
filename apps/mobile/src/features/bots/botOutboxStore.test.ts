import { describe, expect, it } from "vite-plus/test";
import { createBotOutbox, type BotOutboxEntry } from "./botOutboxStore";

const draft = {
  hostId: "test-host",
  chat: { kind: "agent", id: "bot1" },
  text: "A private offline fixture",
  replyToMessageId: null,
  expectedThreadId: "current-thread",
} as const;

function fixture() {
  let stored: unknown = null;
  let sequence = 0;
  let writable = true;
  const released: string[] = [];
  const create = () =>
    createBotOutbox({
      read: async () => stored,
      save: async (entries) => {
        if (!writable) return false;
        stored = entries;
        return true;
      },
      newId: () => `message-${++sequence}`,
      releaseFiles: async (files) => {
        released.push(...files.map((file) => file.id));
      },
    });
  return {
    create,
    released,
    get persisted() {
      return stored;
    },
    set persisted(value: unknown) {
      stored = value;
    },
    set writable(value: boolean) {
      writable = value;
    },
  };
}

describe("the offline Bots send queue", () => {
  it("saves concurrent sends in order and restores them after a restart", async () => {
    const data = fixture();
    const firstRun = data.create();
    expect(
      await Promise.all([
        firstRun.enqueue(draft),
        firstRun.enqueue({ ...draft, text: "Next message" }),
      ]),
    ).toEqual([true, true]);
    const restarted = data.create();
    await restarted.load();
    expect(restarted.snapshot().entries).toEqual([
      { ...draft, id: "message-1", sealed: false },
      { ...draft, id: "message-2", sealed: false, text: "Next message" },
    ]);
  });

  it("reuses the delivery ID after an unconfirmed send and after a failed durable removal", async () => {
    const data = fixture();
    const outbox = data.create();
    await outbox.enqueue(draft);
    expect(await outbox.claim(outbox.snapshot().entries[0]!)).toBe(true);
    expect(await outbox.claim(outbox.snapshot().entries[0]!)).toBe(false);
    expect(await outbox.cancel("message-1")).toBe(false);
    await outbox.settle("message-1", false);
    expect(await outbox.claim(outbox.snapshot().entries[0]!)).toBe(false);
    expect(outbox.snapshot().failed).toBe("message-1");
    outbox.retry();
    expect(await outbox.claim(outbox.snapshot().entries[0]!)).toBe(true);
    data.writable = false;
    await outbox.settle("message-1", true);
    expect(outbox.snapshot().entries[0]?.id).toBe("message-1");
    const restarted = data.create();
    await restarted.load();
    data.writable = true;
    expect(await restarted.claim(restarted.snapshot().entries[0]!)).toBe(true);
    await restarted.settle("message-1", true);
    expect(restarted.snapshot().entries).toEqual([]);
    expect(data.persisted).toEqual([]);
  });

  it("persists edits before sending and fences both stale readers and uncertain retries", async () => {
    const data = fixture();
    const outbox = data.create();
    await outbox.enqueue(draft);
    const original = outbox.snapshot().entries[0]!;
    expect(outbox.beginEdit(original.id)).toBe(true);
    expect(await outbox.claim(original)).toBe(false);
    expect(await outbox.cancel(original.id)).toBe(false);
    data.writable = false;
    expect(await outbox.saveEdit(original.id, "Unsaved edit")).toBe(false);
    expect(outbox.snapshot().entries[0]).toBe(original);
    data.writable = true;
    expect(await outbox.saveEdit(original.id, "Revised fixture")).toBe(true);
    expect(await outbox.claim(original)).toBe(false);
    const revised = outbox.snapshot().entries[0]!;
    expect(revised).toEqual({ ...original, text: "Revised fixture" });
    expect(await outbox.claim(revised)).toBe(true);
    expect(data.persisted).toEqual([{ ...revised, sealed: true }]);
    const restarted = data.create();
    await restarted.load();
    expect(restarted.beginEdit(revised.id)).toBe(false);
    expect(await restarted.claim(restarted.snapshot().entries[0]!)).toBe(true);
    await restarted.settle(revised.id, true);
    expect(data.persisted).toEqual([]);
  });

  it("cannot claim a draft until the send journal is durably sealed", async () => {
    const data = fixture();
    const outbox = data.create();
    await outbox.enqueue(draft);
    const entry = outbox.snapshot().entries[0]!;
    data.writable = false;
    expect(await outbox.claim(entry)).toBe(false);
    expect(outbox.snapshot().sending).toBe(null);
    expect(data.persisted).toEqual([entry]);
    data.writable = true;
    expect(outbox.beginEdit(entry.id)).toBe(true);
    expect(await outbox.saveEdit(entry.id, "Fixed draft")).toBe(true);
    expect(await outbox.claim(outbox.snapshot().entries[0]!)).toBe(true);
  });

  it("leaves an unreadable queue intact and refuses to report an unsaved message", async () => {
    const data = fixture();
    data.persisted = { unknownVersion: true };
    const corrupted = data.create();
    expect(await corrupted.enqueue(draft)).toBe(false);
    expect(corrupted.snapshot().storageError).toBe(true);
    expect(data.persisted).toEqual({ unknownVersion: true });
    data.persisted = null;
    data.writable = false;
    const outbox = data.create();
    expect(await outbox.enqueue(draft)).toBe(false);
    expect(outbox.snapshot().entries).toEqual([] satisfies BotOutboxEntry[]);
  });

  it("requires both an exact group and a recipient for media queued offline", async () => {
    const outbox = fixture().create();
    const input = {
      ...draft,
      chat: { kind: "group", id: "channel-a" },
      text: "",
      files: [
        {
          id: "d2137101-4ccb-45be-b124-28feda01bb22",
          name: "fixture.png",
          mimeType: "image/png",
          size: 2,
          sha256: "a".repeat(64),
        },
      ],
    } as const;
    expect(await outbox.enqueue(input)).toBe(false);
    expect(
      await outbox.enqueue({
        ...input,
        expectedThreadId: "channel-b",
        groupAttachmentAgentId: "bot-a",
      }),
    ).toBe(false);
    expect(
      await outbox.enqueue({
        ...input,
        expectedThreadId: "channel-a",
        groupAttachmentAgentId: "bot-a",
      }),
    ).toBe(true);
    expect(outbox.snapshot().entries[0]).toMatchObject({
      expectedThreadId: "channel-a",
      groupAttachmentAgentId: "bot-a",
    });
  });

  it("changes the file list of an offline group draft only after a durable save", async () => {
    const data = fixture();
    const outbox = data.create();
    const original = {
      id: "d2137101-4ccb-45be-b124-28feda01bb22",
      name: "old.png",
      mimeType: "image/png",
      size: 2,
      sha256: "a".repeat(64),
    };
    const replacement = {
      ...original,
      id: "1bbdf372-0138-4d42-a765-91afc89d75b3",
      name: "new.png",
    };
    await outbox.enqueue({
      ...draft,
      chat: { kind: "group", id: "channel-a" },
      expectedThreadId: "channel-a",
      groupAttachmentAgentId: "bot-a",
      files: [original],
    });
    expect(outbox.beginEdit("message-1")).toBe(true);
    const change = { keep: new Set<string>(), add: [replacement] };
    data.writable = false;
    expect(await outbox.saveEdit("message-1", "Revised", change)).toBe(false);
    expect(data.released).toEqual([]);
    expect(outbox.snapshot().entries[0]?.files).toEqual([original]);
    data.writable = true;
    expect(await outbox.saveEdit("message-1", "Revised", change)).toBe(true);
    expect(data.released).toEqual([original.id]);
    const restarted = data.create();
    await restarted.load();
    expect(restarted.snapshot().entries[0]).toMatchObject({
      files: [replacement],
      groupAttachmentAgentId: "bot-a",
      text: "Revised",
    });
    expect(restarted.beginEdit("message-1")).toBe(true);
    expect(await restarted.saveEdit("message-1", "", { keep: new Set(), add: [] })).toBe(false);
    expect(await restarted.saveEdit("message-1", "Text only", { keep: new Set(), add: [] })).toBe(
      true,
    );
    const textOnly = restarted.snapshot().entries[0];
    expect(textOnly?.files).toBeUndefined();
    expect(textOnly?.groupAttachmentAgentId).toBeUndefined();
    expect(textOnly?.chat).toEqual({ kind: "group", id: "channel-a" });
    expect(data.released).toEqual([original.id, replacement.id]);
  });

  it("keeps attachment copies until the durable entry is removed", async () => {
    const data = fixture();
    const first = data.create();
    const id = "d2137101-4ccb-45be-b124-28feda01bb22";
    const files = [
      { id, name: "fixture.txt", mimeType: "text/plain", size: 2, sha256: "a".repeat(64) },
    ];
    expect(await first.enqueue({ ...draft, text: "", files })).toBe(true);
    expect(await first.claim(first.snapshot().entries[0]!)).toBe(true);
    data.writable = false;
    await first.settle("message-1", true);
    expect(data.released).toEqual([]);
    const restarted = data.create();
    await restarted.load();
    expect(restarted.snapshot().entries[0]?.files).toEqual(files);
    data.writable = true;
    expect(await restarted.claim(restarted.snapshot().entries[0]!)).toBe(true);
    await restarted.settle("message-1", true);
    expect(data.released).toEqual([id]);
  });
});
