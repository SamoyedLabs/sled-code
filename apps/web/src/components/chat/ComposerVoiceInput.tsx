import { useSyncExternalStore } from "react";
import type { VoiceAudioSource } from "../../voice-input/MacVoiceSession";
import { MicIcon, SquareIcon, XIcon } from "lucide-react";
import { Button } from "../ui/button";
import { ComposerBanner } from "./ComposerBanner";
import type { useMacVoiceInput } from "../../voice-input/useMacVoiceInput";

type Voice = ReturnType<typeof useMacVoiceInput>;

export function ComposerVoiceInputButton({ voice, disabled }: { voice: Voice; disabled: boolean }) {
  if (!voice.available) return null;
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label="Record voice input"
      title="Record voice input"
      disabled={disabled || voice.busy}
      onPointerDown={(event) => event.preventDefault()}
      onClick={voice.start}
    >
      <MicIcon aria-hidden="true" />
    </Button>
  );
}

const WAVEFORM_BARS = Array.from({ length: 64 }, (_, index) => ({
  id: `voice-bar-${index}`,
  index,
}));

function VoiceWaveform({ audio }: { audio: VoiceAudioSource }) {
  const levels = useSyncExternalStore(audio.subscribe, audio.getSnapshot);
  return (
    <span
      aria-hidden="true"
      data-voice-waveform="true"
      className="flex h-7 min-w-0 flex-1 items-center justify-between gap-0.5 overflow-hidden"
    >
      {WAVEFORM_BARS.map((bar) => (
        <span
          key={bar.id}
          className="h-7 w-0.5 shrink-0 rounded-full bg-foreground transition-[transform,opacity] duration-100 ease-linear motion-reduce:transition-none"
          style={{
            transform: `scaleY(${(2 + (levels[bar.index] ?? 0) * 26) / 28})`,
            opacity: 0.22 + (levels[bar.index] ?? 0) * 0.78,
          }}
        />
      ))}
    </span>
  );
}

export function ComposerVoiceInputStatus({ voice }: { voice: Voice }) {
  if (!voice.busy && !voice.error) return null;
  const label =
    voice.error ??
    (voice.phase === "preparing"
      ? "Preparing voice input… The first use may download Apple’s speech model."
      : voice.phase === "recording"
        ? "Recording… Stop to transcribe (up to 5 minutes)."
        : "Transcribing on your Mac…");
  return (
    <ComposerBanner.Attachment>
      <ComposerBanner.Root variant={voice.error ? "error" : "info"}>
        <ComposerBanner.Row>
          <ComposerBanner.Content>
            {voice.phase === "recording" ? <VoiceWaveform audio={voice.audio} /> : null}
            <span
              className={voice.phase === "recording" ? "sr-only" : undefined}
              role={voice.error ? "alert" : "status"}
            >
              {label}
            </span>
          </ComposerBanner.Content>
          <ComposerBanner.Actions>
            {voice.phase === "recording" ? (
              <Button type="button" size="sm" variant="destructive" onClick={voice.stop}>
                <SquareIcon aria-hidden="true" />
                Stop
              </Button>
            ) : null}
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              aria-label={voice.error ? "Dismiss voice input error" : "Cancel voice input"}
              onClick={voice.cancel}
            >
              <XIcon aria-hidden="true" />
            </Button>
          </ComposerBanner.Actions>
        </ComposerBanner.Row>
      </ComposerBanner.Root>
    </ComposerBanner.Attachment>
  );
}
