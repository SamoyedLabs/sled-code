import { useState } from "react";
import { Pressable, View } from "react-native";
import { AppText as Text, AppTextInput } from "../../components/ui/AppText";
import * as Dialog from "../../components/ui/Dialog";
import { ListActionRow } from "../../components/ui/ListActionRow";
import { Menu } from "../../components/ui/Menu";
import {
  botElevenLabsVoices,
  connectBotElevenLabs,
  removeBotElevenLabs,
  saveBotElevenLabsSettings,
  useBotElevenLabs,
} from "../bots/upstream/voice/botElevenLabs";
import { selectBotRecognition, useBotRecognition } from "../bots/upstream/voice/botRecognition";
import { SPEECH_MODELS, elevenLabsVoiceParts } from "../bots/upstream/voice/elevenlabs";
import { useBotMessageReading } from "../bots/upstream/voice/BotMessageReading";
import { SettingsSection } from "./components/SettingsSection";
import { T, Var, useGT } from "gt-react-native";

const SAMPLE = "elevenlabs-sample";

export function BotElevenLabsSettings({ disabled }: { disabled: boolean }) {
  const gt = useGT();
  const settings = useBotElevenLabs();
  const listening = useBotRecognition();
  const sample = useBotMessageReading("voice-settings-elevenlabs");
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState("");
  const [voices, setVoices] = useState<Awaited<ReturnType<typeof botElevenLabsVoices>>>([]);
  const locked = disabled || busy;

  async function run(action: () => Promise<void>, message: string) {
    setBusy(true);
    try {
      await action();
    } catch {
      Dialog.alert(message, gt("Check the ElevenLabs API key and its permissions."));
    }
    setBusy(false);
  }

  return (
    <SettingsSection
      title="ElevenLabs"
      footer="Use an ElevenLabs API key for spoken replies and Scribe dictation."
    >
      {editing ? (
        <View className="gap-2 px-4 py-2">
          <AppTextInput
            accessibilityLabel={gt("ElevenLabs API key")}
            placeholder={gt("API key")}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            textContentType="none"
            editable={!locked}
            value={key}
            onChangeText={setKey}
          />
          <ListActionRow
            label={gt("Connect")}
            loading={busy}
            disabled={locked || !key.trim()}
            onPress={() =>
              void run(async () => {
                const available = await connectBotElevenLabs(key);
                setVoices(available);
                setKey("");
                setEditing(false);
              }, "Could not connect to ElevenLabs")
            }
          />
          <ListActionRow
            label={gt("Cancel")}
            disabled={busy}
            onPress={() => {
              setKey("");
              setEditing(false);
            }}
          />
        </View>
      ) : settings ? (
        <>
          <ListActionRow
            label={gt("Read replies with ElevenLabs")}
            detail={settings.readReplies ? gt("Selected") : undefined}
            disabled={locked || !settings.voice}
            onPress={() =>
              void run(
                () =>
                  saveBotElevenLabsSettings({ ...settings, readReplies: !settings.readReplies }),
                "Could not save the reply voice",
              )
            }
          />
          <ListActionRow
            label={gt("Refresh voices")}
            disabled={locked}
            onPress={() =>
              void run(async () => setVoices(await botElevenLabsVoices()), "Could not load voices")
            }
          />
          {voices.length > 0 && (
            <Menu
              actions={voices.map(({ id, name }) => ({
                id,
                title: elevenLabsVoiceParts(name).title,
                state: id === settings.voice ? "on" : "off",
              }))}
              onPressAction={({ nativeEvent }) => {
                if (!locked && voices.some(({ id }) => id === nativeEvent.event))
                  void run(
                    () => saveBotElevenLabsSettings({ ...settings, voice: nativeEvent.event }),
                    "Could not save the reply voice",
                  );
              }}
            >
              <Pressable
                accessibilityRole="button"
                disabled={locked}
                className="min-h-11 justify-center px-4"
              >
                <Text>
                  {voices.find(({ id }) => id === settings.voice)?.name ?? gt("Choose a voice")}
                </Text>
              </Pressable>
            </Menu>
          )}
          <Menu
            actions={Object.keys(SPEECH_MODELS).map((id) => ({
              id,
              title: id.replace("elevenlabs-", "").replaceAll("-", " "),
              state: id === settings.model ? "on" : "off",
            }))}
            onPressAction={({ nativeEvent }) => {
              const model = (Object.keys(SPEECH_MODELS) as (keyof typeof SPEECH_MODELS)[]).find(
                (id) => id === nativeEvent.event,
              );
              if (!locked && model)
                void run(
                  () => saveBotElevenLabsSettings({ ...settings, model }),
                  "Could not save the speech model",
                );
            }}
          >
            <Pressable
              accessibilityRole="button"
              disabled={locked}
              className="min-h-11 justify-center px-4"
            >
              <Text>
                <T>
                  Speech model ·{" "}
                  <Var>{settings.model.replace("elevenlabs-", "").replaceAll("-", " ")}</Var>
                </T>
              </Text>
            </Pressable>
          </Menu>
          <ListActionRow
            label={sample.messageId === SAMPLE ? gt("Stop preview") : gt("Listen to ElevenLabs")}
            disabled={locked || !settings.voice || !sample.available}
            onPress={() => sample.previewElevenLabs(SAMPLE, "Hi. This is what I sound like.")}
          />
          <ListActionRow
            label={gt("Remove ElevenLabs key")}
            disabled={locked}
            onPress={() =>
              Dialog.confirm({
                title: gt("Remove the ElevenLabs key?"),
                confirmText: gt("Remove"),
                destructive: true,
                onConfirm: () => {
                  sample.stop();
                  void run(async () => {
                    await removeBotElevenLabs();
                    if (listening === "elevenlabs") selectBotRecognition("device");
                  }, "Could not remove the key");
                },
              })
            }
          />
        </>
      ) : (
        <ListActionRow
          label={gt("Connect ElevenLabs")}
          disabled={locked}
          onPress={() => setEditing(true)}
        />
      )}
    </SettingsSection>
  );
}
