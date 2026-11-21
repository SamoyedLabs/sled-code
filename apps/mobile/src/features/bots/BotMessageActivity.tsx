import { decodeOpenbotTrace } from "@t3tools/client-runtime/openbot/rich-conversation";
import * as Option from "effect/Option";
import { useState } from "react";
import { useBotMessageDetail, type BotMessageDetailScope } from "./useBotMessageDetail";
import { Pressable, View } from "react-native";
import { SymbolView } from "../../components/ui/AppSymbol";
import { AppText as Text } from "../../components/ui/AppText";
import { ScreenScrollView } from "../../components/ui/ScreenScrollView";
import { Sheet } from "../../components/ui/Sheet";
import { useBotPalette } from "./upstream/BotChrome";
import { T, useGT } from "gt-react-native";

export function BotMessageActivity({
  scope,
  summary,
  deferred,
}: {
  scope: BotMessageDetailScope;
  summary: unknown;
  deferred: boolean;
}) {
  const gt = useGT();
  const p = useBotPalette();
  const [open, setOpen] = useState(false);
  const [stepLimit, setStepLimit] = useState(50);
  const { data, phase, load, clear } = useBotMessageDetail(scope);
  const trace = open
    ? Option.getOrNull(decodeOpenbotTrace(phase === "ready" ? data : summary))
    : null;
  const steps =
    trace?.steps.filter((step) => step.kind === "tool" || step.kind === "reasoning") ?? [];
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={gt("Activity")}
        style={{
          flexDirection: "row",
          alignItems: "center",
          alignSelf: "flex-start",
          gap: 4,
          minHeight: 28,
        }}
        onPress={() => {
          setOpen(true);
          if (deferred) void load("trace");
        }}
      >
        <Text style={{ color: p.muted, fontSize: 13 }}>
          <T>Activity</T>
        </Text>
        <SymbolView name="chevron.right" size={12} tintColor={p.muted} />
      </Pressable>
      {open && (
        <Sheet
          title={gt("Activity")}
          onClose={() => {
            clear();
            setOpen(false);
          }}
        >
          <ScreenScrollView
            contentInsetAdjustmentBehavior="automatic"
            contentContainerClassName="gap-3 px-5 py-4"
          >
            {phase === "loading" && (
              <Text accessibilityLiveRegion="polite">
                <T>Loading activity…</T>
              </Text>
            )}
            {phase === "error" && (
              <Pressable accessibilityRole="button" onPress={() => void load("trace")}>
                <Text>
                  <T>Could not load full activity. Tap to retry.</T>
                </Text>
              </Pressable>
            )}
            {!steps.length && phase !== "loading" && phase !== "error" && (
              <Text>
                <T>No activity recorded.</T>
              </Text>
            )}
            {steps.slice(0, stepLimit).map((step) => (
              <View key={step.id} className="gap-1 rounded-xl bg-grouped-card px-4 py-3">
                <Text className="font-t3-medium">
                  {step.kind === "reasoning"
                    ? (trace?.thoughtTitles?.[step.id] ?? gt("Thinking"))
                    : step.text || gt("Tool call")}
                </Text>
                {step.command && (
                  <Text selectable className="text-foreground-muted">
                    {step.command}
                  </Text>
                )}
                {step.failed && (
                  <Text className="text-danger-foreground">
                    <T>Failed</T>
                  </Text>
                )}
              </View>
            ))}
            {steps.length > stepLimit && (
              <Pressable accessibilityRole="button" onPress={() => setStepLimit(stepLimit + 50)}>
                <Text>
                  <T>Show more steps</T>
                </Text>
              </Pressable>
            )}
          </ScreenScrollView>
        </Sheet>
      )}
    </>
  );
}
