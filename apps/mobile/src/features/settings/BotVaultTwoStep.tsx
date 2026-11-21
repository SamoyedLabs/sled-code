import {
  groupedTwoStepCode,
  parseTwoStepKey,
  twoStepCodeFromMac,
  twoStepMessage,
  twoStepRemainingMs,
  TWO_STEP_KEY_LIMIT,
  type TwoStepAlgorithm,
} from "@t3tools/contracts";
import { CameraView, scanFromURLAsync, useCameraPermissions } from "expo-camera";
import { CryptoDigestAlgorithm, digest } from "expo-crypto";
import * as Clipboard from "expo-clipboard";
import { useEffect, useMemo, useRef, useState } from "react";
import { AppState, View } from "react-native";
import { AppText as Text, AppTextInput } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { ScreenScrollView } from "../../components/ui/ScreenScrollView";
import { Sheet } from "../../components/ui/Sheet";
import { beginForegroundHandoff } from "../../lib/foreground-handoff";
import { chooseBotFile } from "./useBotFileUpload";
import { SettingsSection } from "./components/SettingsSection";
import { m } from "../../i18n/messages";
import { T, Var, msg, useGT } from "gt-react-native";

export type BotVaultCode = { code: string; period: number; expiresAt: number };
type CodePanelProps = {
  live: BotVaultCode | null;
  busy: boolean;
  onRefresh: () => void;
};

const digests = {
  "SHA-1": { algorithm: CryptoDigestAlgorithm.SHA1, block: 64 },
  "SHA-256": { algorithm: CryptoDigestAlgorithm.SHA256, block: 64 },
  "SHA-512": { algorithm: CryptoDigestAlgorithm.SHA512, block: 128 },
} as const satisfies Record<TwoStepAlgorithm, { algorithm: CryptoDigestAlgorithm; block: number }>;

// Adapted from OpenBot 1.4.11's native draft-code path. The input never leaves this device here.
async function makeDraftCode(key: NonNullable<ReturnType<typeof parseTwoStepKey>>, now: number) {
  const { algorithm, block } = digests[key.algorithm];
  const hash = async (value: Uint8Array<ArrayBuffer>) =>
    new Uint8Array(await digest(algorithm, value));
  const message = twoStepMessage(key.period, now);
  const padded = new Uint8Array(block);
  padded.set(key.secret.length > block ? await hash(key.secret) : key.secret);
  const inner = new Uint8Array(block + message.length);
  const outer = new Uint8Array(block + block / 2);
  for (let i = 0; i < block; i++) {
    inner[i] = (padded[i] ?? 0) ^ 0x36;
    outer[i] = (padded[i] ?? 0) ^ 0x5c;
  }
  try {
    inner.set(message, block);
    const innerHash = await hash(inner);
    outer.set(innerHash, block);
    const mac = await hash(outer.subarray(0, block + innerHash.length));
    const code = twoStepCodeFromMac(mac, key.digits);
    innerHash.fill(0);
    mac.fill(0);
    return { code, period: key.period, expiresAt: now + twoStepRemainingMs(key.period, now) };
  } finally {
    padded.fill(0);
    inner.fill(0);
    outer.fill(0);
  }
}

function useClock(enabled: boolean) {
  const [now, setNow] = useState(Date.now);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Sample the system clock once a second while a verification code is visible.
  useEffect(() => {
    if (!enabled) return;
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [enabled]);
  return now;
}

export function BotVaultCodePanel({ live, busy, onRefresh }: CodePanelProps) {
  const gt = useGT();
  const now = useClock(live !== null);
  const remaining = live ? Math.max(0, Math.ceil((live.expiresAt - now) / 1000)) : 0;
  const code = live && remaining > 0 ? live.code : null;
  return (
    <SettingsSection title={gt("Verification code")}>
      <View className="gap-2 px-4 py-3">
        <Text className="text-2xl font-t3-semibold tabular-nums">
          {code ? groupedTwoStepCode(code) : gt("No code yet")}
        </Text>
        {code && (
          <Text className="text-foreground-muted">
            <T>
              Changes in <Var>{remaining}</Var>s
            </T>
          </Text>
        )}
        <View className="flex-row flex-wrap gap-2">
          {code && (
            <Button
              size="compact"
              label={gt("Copy code")}
              onPress={() => {
                if (live && Date.now() < live.expiresAt) void Clipboard.setStringAsync(code);
              }}
            />
          )}
          <Button
            size="compact"
            label={busy ? gt("Loading…") : gt("Refresh code")}
            disabled={busy}
            onPress={onRefresh}
          />
        </View>
      </View>
    </SettingsSection>
  );
}

export function BotVaultTwoStepSetup({
  onApply,
  onClose,
}: {
  onApply: (key: string) => void;
  onClose: () => void;
}) {
  const gt = useGT();
  const [input, setInput] = useState("");
  const [step, setStep] = useState<"input" | "scan" | "check">("input");
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [permission, askCamera] = useCameraPermissions();
  const scanned = useRef(false);
  const scope = useRef({ active: true, photo: false });
  const key = useMemo(() => parseTwoStepKey(input), [input]);
  const now = useClock(step === "check");
  const [draft, setDraft] = useState<{ key: typeof key; live: BotVaultCode } | null>(null);
  const current = draft && draft.key === key && draft.live.expiresAt > now ? draft.live : null;
  const period = key?.period ?? 30;
  const interval = step === "check" ? Math.floor(now / (period * 1000)) : -1;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Keep verification material scoped to the visible native setup sheet.
  useEffect(() => {
    const lifetime = scope.current;
    lifetime.active = true;
    const sub = AppState.addEventListener("change", (state) => {
      if (state !== "active" && !lifetime.photo) onClose();
    });
    return () => {
      lifetime.active = false;
      sub.remove();
    };
  }, [onClose]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Start an asynchronous native digest once per active code interval.
  useEffect(() => {
    if (!key || interval < 0) return;
    let active = true;
    void makeDraftCode(key, Date.now()).then(
      (live) => {
        if (active) setDraft({ key, live });
      },
      () => {
        if (active) setError(m(msg("Could not generate a verification code.")));
      },
    );
    return () => {
      active = false;
    };
  }, [key, interval]);
  const acceptKey = (value: string) => {
    if (!parseTwoStepKey(value)) {
      setError(gt("Enter a valid setup key or a time-based verification QR code."));
      return false;
    }
    setInput(value);
    setError(null);
    setStep("check");
    return true;
  };
  const chooseImage = async () => {
    if (reading) return;
    const lifetime = scope.current;
    setError(null);
    setReading(true);
    lifetime.photo = true;
    await (async () => {
      const image = await chooseBotFile("photos");
      if (!image || !lifetime.active) return;
      const codes = await scanFromURLAsync(image.uri, ["qr"]);
      if (!lifetime.active) return;
      const keyText = codes.find(({ data }) => parseTwoStepKey(data))?.data;
      if (keyText) acceptKey(keyText);
      else setError(gt("No verification setup QR code was found in this image."));
    })()
      .catch(() => {
        if (lifetime.active) setError(gt("Could not read the selected image."));
      })
      .finally(() => {
        lifetime.photo = false;
        if (lifetime.active) setReading(false);
      });
  };
  return (
    <Sheet
      title={step === "check" ? gt("Check verification code") : gt("Two-step verification")}
      onClose={onClose}
    >
      <ScreenScrollView
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        contentContainerClassName="gap-4 px-5 pb-6 pt-4"
      >
        {error && <Text accessibilityRole="alert">{error}</Text>}
        {step === "input" && (
          <>
            <Text className="text-foreground-muted">
              <T>Enter the setup key from your site or scan its QR code.</T>
            </Text>
            <AppTextInput
              accessibilityLabel={gt("Verification setup key")}
              className="min-h-12 rounded-xl bg-grouped-card px-4"
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              maxLength={TWO_STEP_KEY_LIMIT}
              value={input}
              onChangeText={(value) => {
                setInput(value);
                setError(null);
              }}
              placeholder={gt("Setup key")}
            />
            <Button
              label={gt("Check code")}
              disabled={!input.trim()}
              onPress={() => acceptKey(input)}
            />
            <Button
              label={gt("Choose QR image")}
              icon="photo"
              disabled={reading}
              onPress={() => void chooseImage()}
            />
            <Button
              label={gt("Scan QR code")}
              icon="camera"
              disabled={reading}
              onPress={() => {
                const lifetime = scope.current;
                lifetime.photo = true;
                const endHandoff = beginForegroundHandoff();
                void (permission?.granted ? Promise.resolve(permission) : askCamera())
                  .then((result) => {
                    if (!lifetime.active) return;
                    if (result.granted) {
                      scanned.current = false;
                      setStep("scan");
                    } else setError(gt("Allow camera access to scan the verification QR code."));
                  })
                  .catch(() => {
                    if (lifetime.active) setError(gt("Could not open the camera."));
                  })
                  .finally(() => {
                    lifetime.photo = false;
                    endHandoff();
                  });
              }}
            />
          </>
        )}
        {step === "scan" && (
          <>
            <CameraView
              style={{ height: 230, borderRadius: 18, overflow: "hidden" }}
              barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
              onBarcodeScanned={({ data }) => {
                if (!scanned.current) scanned.current = acceptKey(data);
              }}
            />
            <Button label={gt("Back to setup key")} tone="text" onPress={() => setStep("input")} />
          </>
        )}
        {step === "check" && (
          <>
            <Text className="text-foreground-muted">
              <T>Enter this code on the site to check the key.</T>
            </Text>
            <SettingsSection title={gt("Verification code")}>
              <View className="gap-2 px-4 py-3">
                <Text className="text-2xl font-t3-semibold tabular-nums">
                  {current ? groupedTwoStepCode(current.code) : gt("No code yet")}
                </Text>
                {current && (
                  <Text className="text-foreground-muted">
                    <T>
                      Changes in{" "}
                      <Var>{Math.max(0, Math.ceil((current.expiresAt - now) / 1000))}</Var>s
                    </T>
                  </Text>
                )}
              </View>
            </SettingsSection>
            <Button
              label={gt("Use this key")}
              disabled={!current}
              onPress={() => onApply(input.trim())}
            />
            <Button label={gt("Back to setup key")} tone="text" onPress={() => setStep("input")} />
          </>
        )}
      </ScreenScrollView>
    </Sheet>
  );
}
