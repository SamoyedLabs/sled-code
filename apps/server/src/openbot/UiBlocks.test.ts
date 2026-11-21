import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { respond } from "./UiBlocks.ts";
import type { BlockCommand } from "@t3tools/contracts/openbot-ui-block-answer";
it.effect("refuses a stale fresh read before submitting and preserves authoritative refusal", () =>
  Effect.gen(function* () {
    const command: BlockCommand = {
      operation: "conversation.blockRespond",
      agentId: "agent",
      taskId: "task",
      threadId: "thread",
      turnId: "turn",
      messageId: "m",
      blockId: "block",
      requestId: 4,
      response: { actionId: "yes" },
    };
    const snapshot = {
      agentId: "agent",
      threadId: "thread",
      activeTurnId: "turn",
      revision: 3,
      messages: [
        {
          id: "m",
          turnId: "turn",
          author: "agent" as const,
          text: "Pick",
          status: "completed" as const,
          createdAt: "now",
          questionPrompt: { requestId: 4, resolution: null },
          uiBlock: {
            version: 1,
            blockId: "block",
            spec: { type: "quick_replies", options: [{ id: "yes", label: "Yes please" }] },
            state: { status: "pending" },
          },
        },
      ],
    };
    const calls: unknown[] = [];
    const ports = {
      read: (agentId: string, taskId: string | null) => {
        calls.push([agentId, taskId]);
        return Effect.succeed(snapshot);
      },
      answer: (requestId: string | number, answers: Record<string, string[]>) => {
        calls.push([requestId, answers]);
        return Effect.fail("upstream-conflict" as const);
      },
    };
    const refusal = yield* respond(command, ports).pipe(Effect.result);
    expect(refusal).toMatchObject({ _tag: "Failure", failure: "upstream-conflict" });
    expect(calls).toEqual([
      ["agent", "task"],
      [4, { reply: ["Yes please"] }],
    ]);
    calls.length = 0;
    const stale = yield* respond(command, {
      ...ports,
      read: () => Effect.succeed({ ...snapshot, activeTurnId: null }),
    }).pipe(Effect.result);
    expect(stale._tag).toBe("Failure");
    expect(calls).toEqual([]);
  }),
);
