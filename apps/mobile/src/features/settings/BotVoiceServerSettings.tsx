import { useRef, useState } from "react";
import { Pressable, View, type TextInputInstance } from "react-native";
import { AppText as Text, AppTextInput } from "../../components/ui/AppText";
import * as Dialog from "../../components/ui/Dialog";
import { ListActionRow } from "../../components/ui/ListActionRow";
import { Menu } from "../../components/ui/Menu";
import {
  probeBotVoiceServer,
  removeBotVoiceServer,
  saveBotVoiceServer,
  useBotVoiceServer,
} from "../bots/upstream/voice/botVoiceServer";
import { selectBotRecognition, useBotRecognition } from "../bots/upstream/voice/botRecognition";
import {
  fitVoiceServerRoutes,
  type VoiceServerModels,
  type VoiceServerRoutes,
} from "../bots/upstream/voice/botVoiceServerWire";
import { SettingsSection } from "./components/SettingsSection";

const emptyRoutes: VoiceServerRoutes = {
  dictation: false,
  speech: false,
  transcriptionModel: null,
  speechModel: null,
  voice: null,
};

export function BotVoiceServerSettings({ disabled }: { disabled: boolean }) {
  const saved = useBotVoiceServer();
  const listening = useBotRecognition();
  const [editing, setEditing] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [removalError, setRemovalError] = useState(false);
  const host = saved ? new URL(saved.address).host : null;
  return (
    <SettingsSection
      title="Voice server"
      footer="Connect an OpenAI-compatible server for dictation and spoken replies."
    >
      {editing ? (
        <VoiceServerEditor
          disabled={disabled}
          saved={saved}
          onClose={() => setEditing(false)}
          onSaved={(routes) => {
            if (!routes.dictation && listening === "voice-server") selectBotRecognition("device");
            setEditing(false);
          }}
        />
      ) : (
        <>
          <ListActionRow
            icon="server.rack"
            label={saved ? "Edit voice server" : "Add voice server"}
            detail={host ?? undefined}
            disabled={disabled || removing}
            onPress={() => setEditing(true)}
          />
          {saved && (
            <ListActionRow
              icon="trash"
              label="Remove voice server"
              loading={removing}
              disabled={disabled || removing}
              onPress={() =>
                Dialog.confirm({
                  title: "Remove the voice server?",
                  message: "Your device’s voice settings will be used again.",
                  confirmText: "Remove",
                  destructive: true,
                  onConfirm: () => {
                    setRemoving(true);
                    setRemovalError(false);
                    void removeBotVoiceServer()
                      .then(() => {
                        if (listening === "voice-server") selectBotRecognition("device");
                      })
                      .catch(() => setRemovalError(true))
                      .finally(() => setRemoving(false));
                  },
                })
              }
            />
          )}
          {removalError && (
            <Text accessibilityRole="alert" className="p-3">
              Could not remove the voice server.
            </Text>
          )}
        </>
      )}
    </SettingsSection>
  );
}

function VoiceServerEditor({
  disabled,
  saved,
  onClose,
  onSaved,
}: {
  disabled: boolean;
  saved: ReturnType<typeof useBotVoiceServer>;
  onClose: () => void;
  onSaved: (routes: VoiceServerRoutes) => void;
}) {
  const keyInput = useRef<TextInputInstance>(null);
  const [address, setAddress] = useState(saved?.address ?? "");
  const [key, setKey] = useState("");
  const [models, setModels] = useState<VoiceServerModels | null>(null);
  const [routes, setRoutes] = useState(saved?.routes ?? emptyRoutes);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState<"test" | "save" | null>(null);
  const locked = disabled || working !== null;
  async function probe() {
    setWorking("test");
    setError(null);
    await (async () => {
      const available = await probeBotVoiceServer(address, key);
      if (!available.transcription.length && !available.speech.length) {
        setError("The server returned no dictation or speech models.");
        return;
      }
      setModels(available);
      setRoutes((current) => fitVoiceServerRoutes(current, available));
    })()
      .catch((error) => {
        setError(error instanceof Error ? error.message : "Could not reach the voice server.");
      })
      .finally(() => {
        setWorking(null);
      });
  }
  async function save() {
    setWorking("save");
    setError(null);
    try {
      await saveBotVoiceServer(address, key, routes);
      onSaved(routes);
    } catch {
      setError("Could not save the voice server.");
    }
    setWorking(null);
  }
  function resetProbe() {
    setModels(null);
    setError(null);
  }
  return (
    <View className="gap-2 p-3">
      <Text textRole="footnote" className="text-foreground-muted">
        Server address
      </Text>
      <AppTextInput
        accessibilityLabel="Voice server address"
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        returnKeyType="next"
        submitBehavior="submit"
        onSubmitEditing={() => keyInput.current?.focus()}
        placeholder="https://voice.example.com/v1"
        value={address}
        editable={!locked}
        onChangeText={(value) => {
          setAddress(value);
          resetProbe();
        }}
      />
      <Text textRole="footnote" className="text-foreground-muted">
        API key
      </Text>
      <AppTextInput
        ref={keyInput}
        accessibilityLabel="Voice server API key"
        returnKeyType="done"
        autoCapitalize="none"
        autoCorrect={false}
        secureTextEntry
        textContentType="none"
        autoComplete="off"
        importantForAutofill="no"
        placeholder={saved?.hasKey ? "Saved key" : "Optional"}
        value={key}
        editable={!locked}
        onChangeText={(value) => {
          setKey(value);
          resetProbe();
        }}
      />
      <ListActionRow
        icon="arrow.clockwise"
        label="Test connection"
        disabled={locked || !address.trim()}
        loading={working === "test"}
        onPress={() => void probe()}
      />
      {models && (
        <>
          {models.transcription.length > 0 && (
            <>
              <ListActionRow
                label="Use for dictation"
                detail={routes.dictation ? "On" : "Off"}
                disabled={locked}
                onPress={() =>
                  setRoutes((current) => ({ ...current, dictation: !current.dictation }))
                }
              />
              <VoiceChoice
                label="Transcription model"
                selected={routes.transcriptionModel}
                choices={models.transcription}
                disabled={locked || !routes.dictation}
                select={(transcriptionModel) =>
                  setRoutes((current) => ({ ...current, transcriptionModel }))
                }
              />
            </>
          )}
          {models.speech.length > 0 && (
            <>
              <ListActionRow
                label="Use for spoken replies"
                detail={routes.speech ? "On" : "Off"}
                disabled={locked}
                onPress={() => setRoutes((current) => ({ ...current, speech: !current.speech }))}
              />
              <VoiceChoice
                label="Speech model"
                selected={routes.speechModel}
                choices={models.speech}
                disabled={locked || !routes.speech}
                select={(speechModel) => setRoutes((current) => ({ ...current, speechModel }))}
              />
              <VoiceChoice
                label="Voice"
                selected={routes.voice}
                choices={models.voices}
                disabled={locked || !routes.speech}
                select={(voice) => setRoutes((current) => ({ ...current, voice }))}
              />
            </>
          )}
          <ListActionRow
            icon="checkmark"
            label="Save voice server"
            disabled={locked}
            loading={working === "save"}
            onPress={() => void save()}
          />
        </>
      )}
      {error && <Text accessibilityRole="alert">{error}</Text>}
      <ListActionRow label="Cancel" disabled={locked} onPress={onClose} />
    </View>
  );
}

function VoiceChoice({
  label,
  selected,
  choices,
  disabled,
  select,
}: {
  label: string;
  selected: string | null;
  choices: readonly string[];
  disabled: boolean;
  select: (value: string) => void;
}) {
  return (
    <Menu
      actions={choices.map((name) => ({
        id: name,
        title: name,
        state: name === selected ? "on" : "off",
      }))}
      onPressAction={({ nativeEvent }) => select(nativeEvent.event)}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityValue={{ text: selected ?? "" }}
        accessibilityState={{ disabled }}
        disabled={disabled}
        className="min-h-11 flex-row items-center justify-between gap-3 px-3"
      >
        <Text>{label}</Text>
        <Text className="flex-1 text-right text-foreground-muted" numberOfLines={1}>
          {selected}
        </Text>
      </Pressable>
    </Menu>
  );
}
