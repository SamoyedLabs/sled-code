import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as EventProtocol from "./EventProtocol.ts";

describe("released events adapter", () => {
  it("routes recovery and signed test delivery separately without inventing retries", () => {
    const owner = { kind: "channel" as const, id: "channel-a" };
    expect(EventProtocol.route({ operation: "events.list", owner }).path).toBe(
      "/v1/admin/routine-recovery/routines/list",
    );
    expect(
      EventProtocol.route({ operation: "events.sendTest", owner, id: "routine-a" }),
    ).toMatchObject({ path: "/v1/admin/webhook-tests/send", body: { owner, id: "routine-a" } });
  });
  it.effect("keeps future fields but removes webhook configuration from routine reads", () =>
    Effect.gen(function* () {
      const routine = {
        id: "r",
        owner: { kind: "agent", id: "a" },
        name: "r",
        instruction: "work",
        active: true,
        timezone: "UTC",
        trigger: {
          kind: "webhook",
          url: "https://private.test/secret",
          eventType: null,
          filters: [],
        },
        createdAt: "now",
        updatedAt: "now",
        missedPolicy: "run-once",
        future: { revision: 8 },
      };
      const result = yield* EventProtocol.project("events.list", [routine]);
      expect(result).toEqual([{ ...routine, trigger: { ...routine.trigger, url: null } }]);
      const invalid = yield* EventProtocol.project("events.save", {
        routine: { ...routine, id: null },
        secret: "must-not-leak",
      }).pipe(Effect.flip);
      expect(String(invalid)).not.toContain("must-not-leak");
      expect(String(invalid)).not.toContain("private.test");
      const saved = yield* EventProtocol.project("events.save", { routine, secret: "once" });
      expect(saved).toMatchObject({
        secret: "once",
        routine: { trigger: { url: "https://private.test/secret" } },
      });
    }),
  );
});
