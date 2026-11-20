import * as Schema from "effect/Schema";

// OpenBot 1.4.11 live-voice-v1. Sled owns the binding between its authenticated sessions and these calls.
export const OPENBOT_LIVE_VOICE_CAPABILITY = "live-voice-v1";
export const OPENBOT_LIVE_VOICE_ROUTES = {
  start: "/v1/live-voice/start",
  stop: "/v1/live-voice/stop",
} as const;
export const OPENBOT_LIVE_VOICES = [
  "juniper",
  "maple",
  "spruce",
  "ember",
  "vale",
  "breeze",
  "arbor",
  "sol",
  "cove",
  "aube",
  "bubbie",
  "haetsal",
  "hanul",
  "himari",
  "leher",
  "miko",
  "neer",
  "porto",
  "rindo",
  "rio",
  "rivage",
  "selva",
  "sonna",
  "tinta",
  "viola",
] as const;
const identifier = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128));
const sdp = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(65_536));
const transcript = Schema.String.check(Schema.isMaxLength(100_000));

export const OpenbotLiveVoiceOffer = Schema.Struct({
  agentId: identifier,
  sdp,
  voice: Schema.optionalKey(Schema.Literals(OPENBOT_LIVE_VOICES)),
});
export type OpenbotLiveVoiceOffer = typeof OpenbotLiveVoiceOffer.Type;
export const OpenbotLiveVoiceAnswer = Schema.Struct({ sessionId: identifier, sdp });
export type OpenbotLiveVoiceAnswer = typeof OpenbotLiveVoiceAnswer.Type;
export const OpenbotLiveVoiceEvent = Schema.Union([
  Schema.TaggedStruct("transcript", {
    sessionId: identifier,
    role: Schema.Literals(["user", "assistant"]),
    text: transcript,
    final: Schema.Boolean,
  }),
  Schema.TaggedStruct("ended", {
    sessionId: identifier,
    error: Schema.NullOr(Schema.String.check(Schema.isMaxLength(4_000))),
  }),
]);
export type OpenbotLiveVoiceEvent = typeof OpenbotLiveVoiceEvent.Type;
export const OpenbotLiveVoiceCommand = Schema.Union([
  Schema.Struct({
    action: Schema.Literal("start"),
    hostId: identifier,
    offer: OpenbotLiveVoiceOffer,
  }),
  Schema.Struct({ action: Schema.Literal("read"), hostId: identifier, sessionId: identifier }),
  Schema.Struct({ action: Schema.Literal("stop"), hostId: identifier, sessionId: identifier }),
]);
export type OpenbotLiveVoiceCommand = typeof OpenbotLiveVoiceCommand.Type;
export const OpenbotLiveVoiceResult = Schema.Union([
  Schema.TaggedStruct("started", { answer: OpenbotLiveVoiceAnswer }),
  Schema.TaggedStruct("state", {
    user: transcript,
    assistant: transcript,
    ended: Schema.Boolean,
    failed: Schema.Boolean,
  }),
  Schema.TaggedStruct("stopped", {}),
]);
export type OpenbotLiveVoiceResult = typeof OpenbotLiveVoiceResult.Type;
