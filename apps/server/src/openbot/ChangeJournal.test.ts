import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as PubSub from "effect/PubSub";
import * as TestClock from "effect/testing/TestClock";
import { make } from "./ChangeJournal.ts";

it.effect("coalesces a burst and retains all scoped changes in the sliding notification", () =>
  Effect.gen(function* () {
    const journal = yield* make();
    const subscription = yield* PubSub.subscribe(journal.events);
    for (let i = 0; i < 20; i++)
      yield* journal.publish({ hostId: "host", resource: "tasks", agentId: "a", taskId: "task" });
    yield* journal.publish({ hostId: "host", resource: "memory", agentId: "b" });
    expect(yield* PubSub.size(journal.events)).toBe(0);
    yield* TestClock.adjust("100 millis");
    const batch = yield* PubSub.takeAll(subscription);
    expect(batch).toHaveLength(1);
    expect(batch[0]?.versions).toEqual({ '["tasks","a","task"]': 20, '["memory","b",null]': 21 });
    yield* journal.publish({ hostId: "replacement", resource: "all" });
    const replacement = yield* PubSub.take(subscription);
    expect(replacement.hostId).toBe("replacement");
    expect(replacement.epoch).toBe(1);
    expect(replacement.versions).toEqual({ '["all",null,null]': 22 });
  }),
);
