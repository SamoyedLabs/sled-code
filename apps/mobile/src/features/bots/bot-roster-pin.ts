import * as Schema from "effect/Schema";

export const Pin = Schema.Struct({
  kind: Schema.Literals(["agent", "channel"]),
  id: Schema.String,
});
export type BotRosterPin = typeof Pin.Type;

export const botRosterItemKey = (pin: BotRosterPin) => `${pin.kind}:${pin.id}`;
