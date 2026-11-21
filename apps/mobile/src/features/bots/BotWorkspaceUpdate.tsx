import { useBotReducedMotion } from "./botFeedback";
import { useIsFocused } from "@react-navigation/native";
import Storage from "expo-sqlite/kv-store";
import { UpdateInfoType, useUpdates } from "expo-updates";
import { useState } from "react";
import { Pressable, View } from "react-native";
import { useSharedValue } from "react-native-reanimated";
import { isAppUpdateCheckAvailable, runAppUpdateCheck } from "../updates/app-updates";
import {
  BloubEyes,
  EYES_HEIGHT,
  EYES_WIDTH,
} from "./upstream/openbot-mobile/shared/components/bloub-stage/bloub-eyes";
import { OpenBotText as Text } from "./upstream/OpenBotTypography";
import { T, useGT } from "gt-react-native";

const DISMISSED_UPDATE_KEY = "bots.dismissedAppUpdate.v1";
const EYES_SCALE = 0.55;
const BODY = "#cdadec";
const EYE = "#040007";

export function BotWorkspaceUpdate() {
  const { isUpdatePending, downloadedUpdate } = useUpdates();
  if (
    !isAppUpdateCheckAvailable() ||
    !isUpdatePending ||
    downloadedUpdate?.type !== UpdateInfoType.NEW
  )
    return null;
  return <DownloadedUpdate key={downloadedUpdate.updateId} updateId={downloadedUpdate.updateId} />;
}

function DownloadedUpdate({ updateId }: { updateId: string }) {
  const gt = useGT();
  const [dismissed, setDismissed] = useState(() => {
    try {
      return Storage.getItemSync(DISMISSED_UPDATE_KEY) === updateId;
    } catch {
      return false;
    }
  });
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const focused = useIsFocused();
  const reduced = useBotReducedMotion();
  const gazeX = useSharedValue(0);
  const gazeY = useSharedValue(0);
  if (dismissed) return null;

  async function install() {
    setInstalling(true);
    setError(null);
    try {
      await runAppUpdateCheck({ applyMode: "immediate", onFailure: setError });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : gt("Could not install the update."));
    }
    setInstalling(false);
  }

  function later() {
    setDismissed(true);
    void Storage.setItem(DISMISSED_UPDATE_KEY, updateId).catch(() => undefined);
  }

  return (
    <View
      style={{
        backgroundColor: BODY,
        experimental_backgroundImage:
          "radial-gradient(120% 70% at 18% 0%, #e6d6f6 0%, #cdadec 58%)",
        borderBottomLeftRadius: 40,
        borderBottomRightRadius: 40,
        borderCurve: "continuous",
        paddingTop: 12,
        paddingBottom: 28,
        paddingHorizontal: 24,
        alignItems: "center",
        gap: 8,
      }}
    >
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        pointerEvents="none"
        style={{
          alignItems: "center",
          justifyContent: "center",
          width: EYES_WIDTH * EYES_SCALE,
          height: EYES_HEIGHT * EYES_SCALE,
        }}
      >
        <View
          style={{ width: EYES_WIDTH, height: EYES_HEIGHT, transform: [{ scale: EYES_SCALE }] }}
        >
          <BloubEyes
            mood={installing ? "think" : "idle"}
            active={focused}
            reduced={reduced}
            gazeX={gazeX}
            gazeY={gazeY}
            eyeColor={EYE}
          />
        </View>
      </View>
      <Text
        accessibilityRole="header"
        style={{ color: EYE, textAlign: "center", fontSize: 20, fontWeight: "700" }}
      >
        <T>Sled update ready</T>
      </Text>
      <Text style={{ color: "#50445d", textAlign: "center", fontSize: 14 }}>
        <T>Restart to apply the downloaded update.</T>
      </Text>
      {error && (
        <Text accessibilityRole="alert" style={{ color: EYE, textAlign: "center" }}>
          {error}
        </Text>
      )}
      <View
        style={{
          flexDirection: "row",
          justifyContent: "center",
          flexWrap: "wrap",
          gap: 8,
          marginTop: 8,
        }}
      >
        <UpdateButton
          label={installing ? gt("Updating…") : gt("Update")}
          onPress={() => void install()}
          primary
          disabled={installing}
        />
        <UpdateButton label={gt("Later")} onPress={later} disabled={installing} />
      </View>
    </View>
  );
}

function UpdateButton({
  label,
  onPress,
  primary = false,
  disabled,
}: {
  label: string;
  onPress: () => void;
  primary?: boolean;
  disabled: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 44,
        borderRadius: 22,
        borderCurve: "continuous",
        paddingHorizontal: 18,
        justifyContent: "center",
        backgroundColor: primary ? EYE : "#04000714",
        opacity: disabled ? 0.55 : pressed ? 0.75 : 1,
      })}
    >
      <Text style={{ color: primary ? BODY : EYE, fontWeight: "600", fontSize: 14 }}>{label}</Text>
    </Pressable>
  );
}
