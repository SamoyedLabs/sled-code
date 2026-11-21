import type { OpenbotChange } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as PubSub from "effect/PubSub";
import * as Schema from "effect/Schema";
const encodeKey = Schema.encodeSync(
  Schema.fromJsonString(
    Schema.Tuple([Schema.String, Schema.NullOr(Schema.String), Schema.NullOr(Schema.String)]),
  ),
);

export const make = Effect.fn("OpenbotChangeJournal.make")(function* () {
  const scope = yield* Effect.scope;
  const events = yield* PubSub.sliding<OpenbotChange>(1);
  const versions = new Map<string, number>();
  let epoch = 0,
    sequence = 0;
  let latest: OpenbotChange | undefined;
  let scheduled = false;
  const publish = Effect.fn("OpenbotChangeJournal.publish")(function* (change: OpenbotChange) {
    if (latest && latest.hostId !== change.hostId) {
      versions.clear();
      epoch += 1;
    }
    const key = encodeKey([change.resource, change.agentId ?? null, change.taskId ?? null]);
    if (!versions.has(key) && versions.size >= 512) {
      versions.clear();
      epoch += 1;
    }
    versions.set(key, ++sequence);
    latest = change;
    if (change.resource === "all" || change.resource === "attention") {
      yield* PubSub.publish(events, { ...latest, epoch, versions: Object.fromEntries(versions) });
      return;
    }
    if (scheduled) return;
    scheduled = true;
    yield* Effect.sleep("100 millis").pipe(
      Effect.andThen(
        Effect.suspend(() => {
          scheduled = false;
          return latest
            ? PubSub.publish(events, { ...latest, epoch, versions: Object.fromEntries(versions) })
            : Effect.void;
        }),
      ),
      Effect.forkIn(scope),
    );
  });
  return { events, publish };
});
