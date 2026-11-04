import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as ChannelProtocol from "./ChannelProtocol.ts";

describe("released channel settings", () => {
  it.effect("uses the frozen memory routes and projects bounded public records", () =>
    Effect.gen(function* () {
      expect(
        ChannelProtocol.route({
          operation: "channel.memory.create",
          channelId: "c",
          text: "Remember",
        }),
      ).toMatchObject({
        method: "POST",
        path: "/v1/channels/memories/create",
        body: { channelId: "c", text: "Remember" },
      });
      const memory = {
        id: "m",
        channelId: "c",
        text: "Remember",
        origin: "manual",
        sourceTurnId: null,
        createdAt: "now",
        updatedAt: "now",
      };
      expect(
        yield* ChannelProtocol.project("channel.memories", [
          { ...memory, privateSession: "secret" },
        ]),
      ).toEqual([memory]);
      expect(
        (yield* Effect.result(
          ChannelProtocol.project("channel.memories", [{ ...memory, text: "x".repeat(501) }]),
        ))._tag,
      ).toBe("Failure");
    }),
  );
});

it.effect(
  "projects released routine schedules and run history without exposing engine fields",
  () =>
    Effect.gen(function* () {
      const base = {
        id: "routine",
        channelId: "channel",
        name: "Check",
        instruction: "Review progress",
        active: true,
        timezone: "UTC",
        createdAt: "now",
        updatedAt: "now",
      };
      const schedule = {
        kind: "advanced",
        months: [1, 6],
        days: { kind: "days-of-week", days: [1, 5] },
        time: { kind: "every", amount: 3, unit: "hours" },
      };
      const routine = {
        ...base,
        trigger: {
          id: "trigger",
          routineId: "routine",
          schedule,
          nextRunAt: "next",
          createdAt: "now",
          updatedAt: "now",
        },
      };
      expect(
        yield* ChannelProtocol.project("channel.routines", [
          { ...routine, providerSession: "secret" },
        ]),
      ).toEqual([routine]);
      expect(
        ChannelProtocol.route({
          operation: "channel.routine.runs",
          channelId: "channel",
          routineId: "routine",
          limit: 100,
        }),
      ).toMatchObject({
        path: "/v1/channels/routines/runs",
        method: "POST",
        body: { channelId: "channel", routineId: "routine", limit: 100 },
      });
      expect(
        (yield* Effect.result(
          ChannelProtocol.project("channel.routines", [
            { ...routine, trigger: { ...routine.trigger, schedule: { kind: "once", at: "now" } } },
          ]),
        ))._tag,
      ).toBe("Failure");
      const run = {
        id: "run",
        channelId: "channel",
        routineId: "routine",
        triggerId: null,
        kind: "manual",
        scheduledFor: "now",
        routineName: "Check",
        instruction: "Review progress",
        requestMessageId: null,
        status: "needs-attention",
        error: null,
        createdAt: "now",
        updatedAt: "now",
      };
      expect(
        yield* ChannelProtocol.project("channel.routine.runs", [{ ...run, session: "private" }]),
      ).toEqual([run]);
    }),
);
