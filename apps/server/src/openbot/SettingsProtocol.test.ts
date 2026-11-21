import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { route, project } from "./SettingsProtocol.ts";
it.effect(
  "uses closed host paths and strips private fields before settings return to clients",
  () =>
    Effect.gen(function* () {
      expect(
        route({
          operation: "settings.agent-hidden.set",
          parameters: { agentId: "school", hidden: true },
        }),
      ).toMatchObject({
        method: "POST",
        path: "/v1/hidden-agents/set",
        body: { agentId: "school", hidden: true },
      });
      expect(
        yield* project("settings.agent-task-limit.settings", {
          taskLimit: 2,
          account: { token: "private" },
          privatePath: "/host",
        }),
      ).toEqual({ taskLimit: 2 });
      expect(
        (yield* project("settings.agent-task-limit.settings", { taskLimit: 100 }).pipe(
          Effect.result,
        ))._tag,
      ).toBe("Failure");
    }),
);
it.effect("uses the released skill codec and fixed route without a caller chosen URL", () =>
  Effect.gen(function* () {
    expect(
      route({
        operation: "settings.skills-admin.install",
        parameters: { agentId: "school", skillId: "skill", versionId: "reviewed" },
      }),
    ).toMatchObject({
      path: "/v1/admin/skills/install",
      body: { agentId: "school", skillId: "skill", versionId: "reviewed" },
    });
    expect(yield* project("settings.skills-admin.uninstall", {})).toEqual({});
    expect(
      (yield* project("settings.skills-admin.list", [
        { skillId: "skill", privateToken: "no" },
      ]).pipe(Effect.result))._tag,
    ).toBe("Failure");
  }),
);

it.effect("reads the released per-member unread map with GET and strips private fields", () =>
  Effect.gen(function* () {
    const request = route({ operation: "settings.conversation-reads.read", parameters: {} });
    expect(request).toMatchObject({ method: "GET", path: "/v1/agents/conversation-reads" });
    expect("body" in request).toBe(false);
    expect(
      yield* project("settings.conversation-reads.read", {
        student: {
          unreadCount: 3,
          firstUnreadMessageId: "first",
          throughMessageId: null,
          secret: "private",
        },
      }),
    ).toEqual({
      student: { unreadCount: 3, firstUnreadMessageId: "first", throughMessageId: null },
    });
    expect(
      (yield* project("settings.conversation-reads.read", {
        student: { unreadCount: -1, firstUnreadMessageId: null, throughMessageId: null },
      }).pipe(Effect.result))._tag,
    ).toBe("Failure");
  }),
);
it.effect("keeps storage deletion on opaque receipts and never returns host preview URLs", () =>
  Effect.gen(function* () {
    expect(
      route({
        operation: "settings.storage.deleteFile",
        parameters: { fileId: "attachment:owned", path: "/private" },
      }),
    ).toMatchObject({ path: "/v1/storage/delete-file", body: { fileId: "attachment:owned" } });
    const result = yield* project("settings.storage.usage", {
      scope: "agent",
      agentId: "a",
      conversationId: null,
      scannedAt: "now",
      freeBytes: 1,
      breakdown: [],
      agents: [],
      conversations: [],
      truncated: false,
      files: [
        {
          id: "file",
          name: "notes.txt",
          size: 3,
          kind: "file",
          mimeType: "text/plain",
          previewKind: "text",
          previewUrl: "http://127.0.0.1/private",
          source: "attachment",
          agentId: "a",
          conversation: null,
          messageId: "m",
          createdAt: "now",
          status: "available",
          deletable: true,
          path: "/private/notes",
        },
      ],
    });
    expect(JSON.stringify(result)).not.toContain("/private");
    expect(result).toMatchObject({ files: [{ id: "file", previewUrl: null }] });
  }),
);
