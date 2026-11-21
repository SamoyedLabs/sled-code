import { useEffect, useRef } from "react";
import { Linking, View } from "react-native";
import { useVoiceInputController } from "../voice-input/useVoiceInputController";
import { useGlobalVoiceInput } from "../voice-input/VoiceInputProvider";
import { resolveVoiceComposerPresentation } from "../voice-input/voiceInputPresentation";
import { Button } from "../../components/ui/Button";
import { AppText as Text } from "../../components/ui/AppText";
import { useBotVoiceRecognizerAvailable } from "../bots/upstream/voice/botRecognition";
import { T, useGT } from "gt-react-native";
export function useBotDictation(
  ownerKey: string,
  value: string,
  onChange: (value: string) => void,
  disabled: boolean,
) {
  const gt = useGT();
  const { session } = useGlobalVoiceInput();
  const recognizerAvailable = useBotVoiceRecognizerAvailable();
  const draft = useRef<string | null>(value);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- synchronize the external voice session's draft revision with the bot composer
  useEffect(() => {
    draft.current = value;
  }, [value]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- release microphone and reject late transcription when this bot destination unmounts
  useEffect(
    () => () => {
      draft.current = null;
      session.cancel(ownerKey);
    },
    [ownerKey, session],
  );
  return useVoiceInputController({
    ownerKey,
    label: gt("Bot message"),
    readDraftMessage: () => draft.current,
    selection: { start: value.length, end: value.length },
    disabled,
    ...(recognizerAvailable === null ? {} : { transcriberAvailable: recognizerAvailable }),
    onChangeDraftMessage: (text) => {
      if (draft.current !== null) onChange(text);
    },
    onChangeSelection: () => {},
  });
}
export function BotDictation({
  voice,
  disabled,
}: {
  voice: ReturnType<typeof useBotDictation>;
  disabled: boolean;
}) {
  const gt = useGT();
  const presentation = resolveVoiceComposerPresentation(voice.state, voice.elapsedSeconds);
  return (
    <View className="gap-2">
      {!voice.isBusy && (
        <Button
          label={gt("Dictate message")}
          disabled={disabled || !voice.isAvailable}
          onPress={voice.start}
        />
      )}
      {!voice.isAvailable && !voice.isBusy && (
        <Text>
          <T>Local dictation is unavailable on this device. Configure voice input in Settings.</T>
        </Text>
      )}
      {voice.isBusy && (
        <>
          <Button
            label={gt("Stop and transcribe")}
            disabled={!presentation.confirmationEnabled}
            onPress={() => void voice.stop()}
          />
          <Button label={gt("Cancel dictation")} onPress={() => void voice.cancel()} />
        </>
      )}
      {presentation.statusLabel && (
        <Text accessibilityLiveRegion="polite">{presentation.statusLabel}</Text>
      )}
      {voice.state.errorAction === "settings" && (
        <Button
          label={gt("Open microphone settings")}
          onPress={() => void Linking.openSettings()}
        />
      )}
    </View>
  );
}
