import * as Schema from "effect/Schema";

export const DesktopVoiceInputRequest = Schema.Struct({
  id: Schema.String.check(Schema.isNonEmpty()).check(Schema.isMaxLength(128)),
  locale: Schema.String.check(Schema.isNonEmpty()).check(Schema.isMaxLength(128)),
});
export const DesktopVoiceInputId = Schema.Struct({
  id: Schema.String.check(Schema.isNonEmpty()).check(Schema.isMaxLength(128)),
});
export const DesktopVoiceInputResult = Schema.Struct({
  text: Schema.String,
  locale: Schema.String,
});
export const DesktopVoiceInputPhase = Schema.Struct({
  id: Schema.String,
  phase: Schema.Literals(["preparing", "recording", "transcribing"]),
  level: Schema.optional(Schema.Number.check(Schema.isBetween({ minimum: 0, maximum: 1 }))),
});
export type DesktopVoiceInputPhase = typeof DesktopVoiceInputPhase.Type;
export interface DesktopVoiceInputBridge {
  available: () => Promise<boolean>;
  record: (
    request: typeof DesktopVoiceInputRequest.Type,
  ) => Promise<typeof DesktopVoiceInputResult.Type>;
  stop: (request: typeof DesktopVoiceInputId.Type) => Promise<void>;
  cancel: (request: typeof DesktopVoiceInputId.Type) => Promise<void>;
  onPhase: (listener: (phase: DesktopVoiceInputPhase) => void) => () => void;
}
