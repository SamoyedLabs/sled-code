import { AuthSessionId, EnvironmentId, IsoDateTime, ThreadId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

/** Internal event: recipient identity is never part of a public bot notification payload. */
export const ChannelCodingEvent = Schema.Struct({
  eventId: Schema.String,
  hostId: Schema.String,
  agentId: Schema.String,
  channelId: Schema.String,
  taskId: Schema.String,
  threadId: ThreadId,
  environmentId: Schema.optional(EnvironmentId),
  status: Schema.Literals([
    "executing",
    "needs_approval",
    "needs_input",
    "completed",
    "failed",
    "cancelled",
    "stale",
  ]),
  updatedAt: IsoDateTime,
  recipient: Schema.Struct({
    sessionId: AuthSessionId,
    grantId: Schema.optional(Schema.String),
  }),
});
export type ChannelCodingEvent = typeof ChannelCodingEvent.Type;
export class ChannelCodingEvents extends Context.Service<
  ChannelCodingEvents,
  {
    readonly stream: Stream.Stream<ChannelCodingEvent>;
    readonly publish: (event: ChannelCodingEvent) => Effect.Effect<void>;
  }
>()("t3/openbot/ChannelCodingEvents") {}
export const layer = Layer.effect(
  ChannelCodingEvents,
  Effect.gen(function* () {
    const events = yield* PubSub.unbounded<ChannelCodingEvent>();
    return ChannelCodingEvents.of({
      stream: Stream.fromPubSub(events),
      publish: Effect.fn("ChannelCodingEvents.publish")((event: ChannelCodingEvent) =>
        PubSub.publish(events, event).pipe(Effect.asVoid),
      ),
    });
  }),
);
