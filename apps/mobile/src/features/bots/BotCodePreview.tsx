import { Image } from "expo-image";
import { setStringAsync } from "expo-clipboard";
import { useState } from "react";
import { Modal, Pressable, ScrollView, View, useWindowDimensions } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { ScrollView as GestureScrollView } from "react-native-gesture-handler";
import { SymbolView } from "../../components/ui/AppSymbol";
import { SegmentedControl } from "../../components/ui/SegmentedControl";
import { tryOpenExternalUrl } from "../../lib/openExternalUrl";
import type { BotPreview } from "./bot-reply-previews";
import { BotIconButton, useBotPalette } from "./upstream/BotChrome";
import { OpenBotText as Text } from "./upstream/OpenBotTypography";
import HtmlPreview from "./upstream/openbot-mobile/chat-preview/HtmlPreview";
import { useMermaidDiagram } from "./upstream/openbot-mobile/chat-preview/mermaid-diagrams";
import { useGT } from "gt-react-native";

export function BotCodePreview({
  preview,
  streaming,
}: {
  preview: BotPreview;
  streaming: boolean;
}) {
  const gt = useGT();
  const p = useBotPalette();
  const { width } = useWindowDimensions();
  const [open, setOpen] = useState(false);
  const title = preview.kind === "html" ? "HTML preview" : "Mermaid diagram";
  const diagram = useMermaidDiagram(
    preview.body,
    p.scheme === "dark",
    preview.kind === "mermaid" && !streaming,
  );
  const pngUrl = diagram?.status === "ready" ? diagram.pngUrl : null;
  const excerpt = preview.body.split("\n").slice(0, 4).join("\n");
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={title}
        accessibilityHint={gt("Opens the preview")}
        disabled={streaming}
        onPress={() => setOpen(true)}
        style={({ pressed }) => ({
          width: Math.min(440, width - 80),
          maxWidth: "100%",
          overflow: "hidden",
          borderColor: p.border,
          borderWidth: 1,
          borderRadius: 18,
          borderCurve: "continuous",
          backgroundColor: p.control,
          transform: [{ scale: pressed ? 0.98 : 1 }],
        })}
      >
        <View
          className="flex-row items-center gap-2.5 px-3 py-2.5"
          style={{ borderBottomWidth: 1, borderBottomColor: p.border }}
        >
          <SymbolView
            name={
              preview.kind === "html"
                ? "chevron.left.forwardslash.chevron.right"
                : "point.3.connected.trianglepath.dotted"
            }
            size={16}
            tintColor={p.text}
          />
          <Text style={{ color: p.text, fontWeight: "600", flex: 1 }}>{title}</Text>
          {!streaming && <SymbolView name="chevron.right" size={13} tintColor={p.muted} />}
        </View>
        {!streaming && preview.kind === "html" ? (
          <View pointerEvents="none" accessibilityElementsHidden style={{ height: 126 }}>
            <HtmlPreview source={preview.body} title={title} card />
          </View>
        ) : pngUrl ? (
          <Image source={{ uri: pngUrl }} contentFit="contain" style={{ height: 126, margin: 5 }} />
        ) : (
          <Text
            numberOfLines={4}
            style={{ padding: 12, color: p.muted, fontFamily: "Menlo", fontSize: 12 }}
          >
            {excerpt || gt("Preparing preview…")}
          </Text>
        )}
      </Pressable>
      {open && <CodePreviewModal preview={preview} title={title} onClose={() => setOpen(false)} />}
    </>
  );
}

function CodePreviewModal({
  preview,
  title,
  onClose,
}: {
  preview: BotPreview;
  title: string;
  onClose: () => void;
}) {
  const gt = useGT();
  const p = useBotPalette();
  const { width } = useWindowDimensions();
  const [mode, setMode] = useState<"preview" | "code">("preview");
  const [copied, setCopied] = useState(false);
  const diagram = useMermaidDiagram(preview.body, p.scheme === "dark", preview.kind === "mermaid");
  return (
    <Modal visible onRequestClose={onClose} presentationStyle="fullScreen" animationType="slide">
      <SafeAreaProvider>
        <SafeAreaView style={{ flex: 1, backgroundColor: p.canvas }}>
          <View className="min-h-12 flex-row items-center gap-2 px-3">
            <BotIconButton label={gt("Close preview")} icon="xmark" onPress={onClose} />
            <Text
              accessibilityRole="header"
              numberOfLines={1}
              style={{ color: p.text, flex: 1, fontWeight: "700", fontSize: 17 }}
            >
              {title}
            </Text>
            <BotIconButton
              label={copied ? gt("Code copied") : gt("Copy code")}
              icon={copied ? "checkmark" : "doc.on.doc"}
              onPress={() =>
                void setStringAsync(preview.body).then(
                  () => setCopied(true),
                  () => setCopied(false),
                )
              }
            />
          </View>
          <View className="px-4 pb-3">
            <SegmentedControl
              selected={mode}
              options={[
                { label: gt("Preview"), value: "preview" },
                { label: gt("Code"), value: "code" },
              ]}
              onSelect={setMode}
            />
          </View>
          {mode === "code" ? (
            <ScrollView contentContainerStyle={{ padding: 16 }}>
              <Text selectable style={{ color: p.text, fontFamily: "Menlo", fontSize: 13 }}>
                {preview.body}
              </Text>
            </ScrollView>
          ) : preview.kind === "html" ? (
            <HtmlPreview
              source={preview.body}
              title={title}
              onOpenLink={async (link) => {
                if (/^https?:\/\//i.test(link)) await tryOpenExternalUrl(link, "html-render");
              }}
            />
          ) : diagram?.status === "ready" ? (
            <GestureScrollView
              style={{ flex: 1 }}
              contentContainerStyle={{ flexGrow: 1 }}
              minimumZoomScale={0.75}
              maximumZoomScale={5}
              centerContent
            >
              <Image
                source={{ uri: diagram.pngUrl ?? diagram.svgUrl }}
                contentFit="contain"
                accessibilityLabel={gt("Rendered Mermaid diagram")}
                style={{
                  width: width - 24,
                  aspectRatio: diagram.width / diagram.height || 1,
                  alignSelf: "center",
                }}
              />
            </GestureScrollView>
          ) : (
            <Text accessibilityRole="alert" style={{ color: p.muted, padding: 16 }}>
              {diagram?.status === "failed"
                ? gt("This diagram could not be drawn.")
                : gt("Drawing diagram…")}
            </Text>
          )}
        </SafeAreaView>
      </SafeAreaProvider>
    </Modal>
  );
}
