import { useState } from "react";
import { View } from "react-native";
import * as Dialog from "../../components/ui/Dialog";
import { ListActionRow } from "../../components/ui/ListActionRow";
import { ScreenScrollView } from "../../components/ui/ScreenScrollView";
import { SliderRow } from "../../components/ui/SliderRow";
import { SegmentedControl } from "../../components/ui/SegmentedControl";
import { AppText } from "../../components/ui/AppText";
import {
  BOT_SPEECH_MODEL_SIZE,
  BOT_SPEECH_SPEEDS,
  BOT_SPEECH_VOICES,
  getBotSpeechSpeed,
  getBotSpeechVoice,
  isBotSpeechModelReady,
  removeBotSpeechModel,
  saveBotSpeechSpeed,
  saveBotSpeechVoice,
  useBotMessageReading,
  type BotSpeechVoice,
} from "../bots/upstream/voice/BotMessageReading";
import { SettingsSection } from "./components/SettingsSection";
import { useBotElevenLabs } from "../bots/upstream/voice/botElevenLabs";
import { useBotVoiceServer } from "../bots/upstream/voice/botVoiceServer";
import {
  BOT_TURN_PAUSE,
  getBotTurnPause,
  saveBotTurnPause,
} from "../bots/upstream/voice/botTurnPause";
import { BotGptVoiceSettings } from "./BotGptVoiceSettings";
import { botGptVoiceNative } from "../bots/upstream/voice/botGptVoice";
import { BotElevenLabsSettings } from "./BotElevenLabsSettings";
import { BotVoiceServerSettings } from "./BotVoiceServerSettings";
import { useGlobalVoiceInput } from "../voice-input/VoiceInputProvider";
import {
  BOT_RECOGNITION_MODELS,
  downloadBotRecognition,
  removeBotRecognition,
  selectBotRecognition,
  useBotRecognition,
  useBotRecognitionModel,
} from "../bots/upstream/voice/botRecognition";
import { T, useGT } from "gt-react-native";

const SAMPLE_ID = "sample";
const SAMPLE_TEXT = "Hi. This is what I sound like when I read a bot reply.";

export function SettingsBotVoiceRouteScreen() {
  const gt = useGT();
  const [tab, setTab] = useState<"listening" | "speaking" | "gptLive">("listening");
  const [pause, setPause] = useState(getBotTurnPause);
  const [voice, setVoice] = useState(getBotSpeechVoice);
  const [speed, setSpeed] = useState(getBotSpeechSpeed);
  const [removing, setRemoving] = useState(false);
  const listening = useBotRecognition();
  const server = useBotVoiceServer();
  const elevenLabs = useBotElevenLabs();
  const { isBusy: usingMicrophone } = useGlobalVoiceInput();
  const sample = useBotMessageReading("voice-settings");
  const previewing = sample.messageId === SAMPLE_ID;
  const installed = !sample.downloadingModel && isBotSpeechModelReady();

  function choose(next: BotSpeechVoice) {
    try {
      saveBotSpeechVoice(next);
      if (previewing) sample.toggle(SAMPLE_ID, SAMPLE_TEXT);
      setVoice(next);
    } catch {
      Dialog.alert(gt("Could not save the voice"), gt("Try choosing it again."));
    }
  }

  function changeModel() {
    if (!installed) {
      sample.toggleModelDownload();
      return;
    }
    Dialog.confirm({
      title: gt("Remove the voice model?"),
      message: gt("You can download Supertonic 3 again to read bot replies aloud."),
      confirmText: gt("Remove"),
      destructive: true,
      onConfirm: () => {
        setRemoving(true);
        void removeBotSpeechModel()
          .catch(() => Dialog.alert(gt("Could not remove the voice model"), gt("Try again.")))
          .finally(() => setRemoving(false));
      },
    });
  }

  return (
    <ScreenScrollView
      contentInsetAdjustmentBehavior="automatic"
      automaticallyAdjustKeyboardInsets
      keyboardDismissMode="interactive"
      keyboardShouldPersistTaps="handled"
      contentContainerClassName="gap-6 px-4 py-5"
    >
      <SegmentedControl
        options={[
          { value: "listening", label: gt("Listening") },
          { value: "speaking", label: gt("Speaking") },
          ...(botGptVoiceNative
            ? [{ value: "gptLive" as const, label: gt("GPT live voice") }]
            : []),
        ]}
        selected={tab}
        onSelect={(next) => {
          sample.stop();
          setTab(next);
        }}
      />
      {tab === "listening" ? (
        <>
          <SettingsSection
            title={gt("Listening")}
            footer="Choose how Bots transcribes your dictation."
          >
            <ListActionRow
              icon="mic"
              label={gt("Device dictation")}
              detail={listening === "device" ? gt("Selected") : undefined}
              disabled={usingMicrophone}
              onPress={() => selectBotRecognition("device")}
            />
            {server?.routes.dictation && (
              <ListActionRow
                icon="server.rack"
                label={gt("Voice server dictation")}
                detail={listening === "voice-server" ? gt("Selected") : undefined}
                disabled={usingMicrophone}
                onPress={() => selectBotRecognition("voice-server")}
              />
            )}
            {elevenLabs && (
              <ListActionRow
                icon="mic"
                label={gt("Scribe v2 Realtime")}
                detail={listening === "elevenlabs" ? gt("Selected") : undefined}
                disabled={usingMicrophone}
                onPress={() => selectBotRecognition("elevenlabs")}
              />
            )}
            {BOT_RECOGNITION_MODELS.map((model) => (
              <RecognitionModelRows
                key={model.id}
                model={model}
                selected={listening === model.id}
                usingMicrophone={usingMicrophone}
              />
            ))}
          </SettingsSection>
          <BotVoiceServerSettings disabled={usingMicrophone} />
          <BotElevenLabsSettings disabled={usingMicrophone} />
          <SettingsSection
            title={gt("Voice conversation")}
            footer="How long Bots waits for you to keep speaking before sending."
          >
            <SliderRow
              {...BOT_TURN_PAUSE}
              icon="mic"
              label={gt("Pause before sending")}
              value={pause}
              valueLabel={`${pause / 1000} s`}
              disabled={usingMicrophone}
              onChange={(next) => {
                try {
                  setPause(saveBotTurnPause(next));
                } catch {
                  Dialog.alert(gt("Could not save the pause"), gt("Try choosing it again."));
                }
              }}
            />
          </SettingsSection>
        </>
      ) : tab === "gptLive" ? (
        <BotGptVoiceSettings disabled={usingMicrophone} />
      ) : (
        <>
          <BotElevenLabsSettings disabled={usingMicrophone} />
          <SettingsSection
            title={gt("Supertonic 3")}
            footer={
              sample.available
                ? "The model stays on this device until you remove it."
                : "On-device reading is unavailable in this build."
            }
          >
            <ListActionRow
              icon="arrow.down.circle"
              label={
                sample.downloadingModel
                  ? gt("Cancel download")
                  : installed
                    ? gt("Remove voice model")
                    : gt("Download voice model")
              }
              detail={sample.downloadingModel ? `${sample.progress}%` : BOT_SPEECH_MODEL_SIZE}
              disabled={!sample.available || previewing}
              loading={removing}
              onPress={changeModel}
            />
            <ListActionRow
              icon="headphones"
              label={previewing ? gt("Stop preview") : gt("Listen")}
              disabled={!installed || removing}
              onPress={() => sample.toggle(SAMPLE_ID, SAMPLE_TEXT, voice)}
            />
          </SettingsSection>
          <View className="gap-2">
            <AppText textRole="footnote" className="px-4 text-foreground-muted">
              <T>Speed</T>
            </AppText>
            <SegmentedControl
              options={BOT_SPEECH_SPEEDS.map((value) => ({ value, label: `${value}×` }))}
              selected={speed}
              role="button"
              onSelect={(next) => {
                try {
                  saveBotSpeechSpeed(next);
                  setSpeed(next);
                } catch {
                  Dialog.alert(
                    gt("Could not save the playback speed"),
                    gt("Try choosing it again."),
                  );
                }
              }}
            />
            <AppText textRole="footnote" className="px-4 text-foreground-muted">
              <T>Changes how fast bot replies are read aloud.</T>
            </AppText>
          </View>
          <SettingsSection title={gt("Supertonic 3 voice")}>
            {BOT_SPEECH_VOICES.map((option) => (
              <ListActionRow
                key={option}
                label={`${option.startsWith("F") ? "Female" : "Male"} ${option.slice(1)}`}
                detail={voice === option ? gt("Selected") : undefined}
                disabled={!sample.available}
                onPress={() => choose(option)}
              />
            ))}
          </SettingsSection>
        </>
      )}
    </ScreenScrollView>
  );
}

function RecognitionModelRows({
  model,
  selected,
  usingMicrophone,
}: {
  model: (typeof BOT_RECOGNITION_MODELS)[number];
  selected: boolean;
  usingMicrophone: boolean;
}) {
  const gt = useGT();
  const state = useBotRecognitionModel(model);
  const [removing, setRemoving] = useState(false);
  const size = model.files.reduce((total, item) => total + item.bytes, 0);
  return (
    <>
      <ListActionRow
        icon="mic"
        label={model.name}
        detail={
          !state.supported
            ? gt("Unavailable on this build or device")
            : selected
              ? gt("Selected")
              : state.ready
                ? model.detail
                : state.downloading
                  ? gt("Downloading · {progress}%", { progress: state.progress })
                  : state.error
                    ? gt("Download failed · Tap to retry")
                    : gt("{value} MB · Download", { value: Math.round(size / 1_000_000) })
        }
        disabled={!state.supported || usingMicrophone || removing}
        onPress={() => {
          if (state.ready) selectBotRecognition(model.id);
          else void downloadBotRecognition(model);
        }}
      />
      {state.ready && (
        <ListActionRow
          icon="trash"
          label={gt("Remove {name}", { name: model.name })}
          disabled={usingMicrophone || removing}
          loading={removing}
          onPress={() =>
            Dialog.confirm({
              title: gt("Remove {name}?", { name: model.name }),
              message: gt("You can download the model again."),
              confirmText: gt("Remove"),
              destructive: true,
              onConfirm: () => {
                setRemoving(true);
                void removeBotRecognition(model)
                  .catch(() => Dialog.alert(gt("Could not remove the model"), gt("Try again.")))
                  .finally(() => setRemoving(false));
              },
            })
          }
        />
      )}
    </>
  );
}
