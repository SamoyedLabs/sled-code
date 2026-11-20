import * as Clipboard from "expo-clipboard";
import { selectionAsync } from "./botFeedback";
import { useState } from "react";
import { Pressable, View } from "react-native";
import { AppText as Text } from "../../components/ui/AppText";
import { SymbolView } from "../../components/ui/AppSymbol";
import { ScreenScrollView } from "../../components/ui/ScreenScrollView";
import { Sheet } from "../../components/ui/Sheet";
import { useBotPalette } from "./upstream/BotChrome";
import * as Dialog from "../../components/ui/Dialog";
import { ListActionRow } from "../../components/ui/ListActionRow";
import { SettingsRow } from "../settings/components/SettingsRow";
import { SettingsSection } from "../settings/components/SettingsSection";
import { useMarkdownPreviewStyles } from "../files/FileMarkdownPreview";
import { BotReplyMarkdown } from "./BotReplyMotion";

const reactions = [
  "👍",
  "👎",
  "❤️",
  "😂",
  "🎉",
  "😮",
  "🔥",
  "👏",
  "🙏",
  "🤔",
  "👀",
  "✅",
  "🚀",
  "💯",
] as const;

export function BotMessageActions({
  text,
  createdAt,
  ownReaction,
  onClose,
  onReply,
  onReadAloud,
  reading = false,
  onBranch,
  pinAction,
  onReact,
  onDelete,
}: {
  text: string;
  createdAt?: string | undefined;
  ownReaction?: string | undefined;
  onClose: () => void;
  onReply?: (() => void) | undefined;
  onReadAloud?: (() => void) | undefined;
  reading?: boolean;
  onBranch?: (() => void) | undefined;
  pinAction?: { pinned: boolean; run: () => void } | undefined;
  onReact?: ((emoji: string | null) => void) | undefined;
  onDelete?: (() => void) | undefined;
}) {
  const [more, setMore] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const cells = more ? [...reactions] : [...reactions.slice(0, 11), "more"];
  const columns = cells.length / 2;
  const sent = createdAt ? new Date(createdAt) : null;
  const run = (action: () => void) => {
    onClose();
    action();
  };
  return (
    <Sheet title={selecting ? "Select text" : "Message actions"} onClose={onClose}>
      {selecting ? (
        <BotMessageTextSelection text={text} />
      ) : (
        <ScreenScrollView
          contentInsetAdjustmentBehavior="automatic"
          contentContainerClassName="gap-4 px-4 pt-5 pb-10"
        >
          {onReact && (
            <View className="gap-3" accessibilityRole="toolbar" accessibilityLabel="Reactions">
              {[cells.slice(0, columns), cells.slice(columns)].map((row) => (
                <View key={row[0]} className="flex-row">
                  {row.map((emoji) => {
                    const selected = emoji === ownReaction;
                    return (
                      <Pressable
                        key={emoji}
                        accessibilityRole="button"
                        accessibilityLabel={
                          emoji === "more"
                            ? "More reactions"
                            : selected
                              ? `Remove reaction ${emoji}`
                              : `React ${emoji}`
                        }
                        accessibilityState={{ selected }}
                        onPress={() => {
                          void selectionAsync().catch(() => undefined);
                          if (emoji === "more") setMore(true);
                          else run(() => onReact(selected ? null : emoji));
                        }}
                        className="min-h-11 flex-1 items-center justify-center active:opacity-60"
                      >
                        <View
                          className={`size-10 items-center justify-center rounded-full ${selected ? "bg-accent/30" : "bg-subtle"}`}
                        >
                          {emoji === "more" ? (
                            <SymbolView
                              name="face.smiling"
                              tintColorClassName="accent-icon"
                              size={20}
                            />
                          ) : (
                            <Text className="text-xl">{emoji}</Text>
                          )}
                        </View>
                      </Pressable>
                    );
                  })}
                </View>
              ))}
            </View>
          )}
          {(onReply || onBranch || pinAction) && (
            <SettingsSection>
              {onReply && (
                <SettingsRow icon="arrow.uturn.backward" label="Reply" onPress={() => run(onReply)} />
              )}
              {onBranch && (
                <SettingsRow icon="arrow.branch" label="Branch here" onPress={() => run(onBranch)} />
              )}
              {pinAction && (
                <SettingsRow
                  icon="pin"
                  label={pinAction.pinned ? "Unpin" : "Pin"}
                  onPress={() => run(pinAction.run)}
                />
              )}
            </SettingsSection>
          )}
          {onReadAloud && (
            <SettingsSection>
              <SettingsRow
                icon={reading ? "stop.fill" : "headphones"}
                label={reading ? "Stop reading" : "Read aloud"}
                onPress={() => run(onReadAloud)}
              />
            </SettingsSection>
          )}
          {text && (
            <SettingsSection
              footer={sent && Number.isFinite(sent.getTime()) ? sent.toLocaleString() : undefined}
            >
              <SettingsRow
                icon="doc.on.doc"
                label="Copy"
                onPress={() => {
                  run(() => {
                    void Clipboard.setStringAsync(text).catch(() =>
                      Dialog.alert("Could not copy message"),
                    );
                  });
                }}
              />
              <SettingsRow
                icon="textformat.size"
                label="Select text"
                onPress={() => setSelecting(true)}
              />
            </SettingsSection>
          )}
          {onDelete && (
            <SettingsSection>
              <ListActionRow
                icon="trash"
                label="Delete"
                tone="danger"
                onPress={() =>
                  run(() => {
                    Dialog.confirm({
                      title: "Delete this message?",
                      message:
                        "This removes the message for everyone in this chat. Agents may still remember it.",
                      confirmText: "Delete",
                      destructive: true,
                      onConfirm: onDelete,
                    });
                  })
                }
              />
            </SettingsSection>
          )}
        </ScreenScrollView>
      )}
    </Sheet>
  );
}

function BotMessageTextSelection({ text }: { text: string }) {
  const markdown = useMarkdownPreviewStyles();
  return (
    <ScreenScrollView
      contentInsetAdjustmentBehavior="automatic"
      contentContainerClassName="px-5 py-4"
    >
      <BotReplyMarkdown
        body={text}
        streaming={false}
        selectable
        textStyle={markdown.nativeTextStyle}
      />
    </ScreenScrollView>
  );
}

/** A host message can carry reactions even when a task or its permissions disallow editing them. */
export function botMessageReactions(value: unknown) {
  const reactions = new Map<string, { emoji: string; own: boolean }>();
  if (!Array.isArray(value)) return [];
  for (const reaction of value) {
    const emoji: unknown = reaction?.emoji;
    const actor = reaction?.actor;
    if (typeof emoji !== "string" || !emoji.trim()) continue;
    if (actor?.kind === "user") reactions.set("user", { emoji, own: true });
    if (actor?.kind === "agent" && typeof actor.agentId === "string" && actor.agentId)
      reactions.set(`agent:${actor.agentId}`, { emoji, own: false });
  }
  return Array.from(reactions, ([key, reaction]) => ({ key, ...reaction }));
}

export function ownBotMessageReaction(reactions: unknown) {
  return botMessageReactions(reactions).find((reaction) => reaction.own)?.emoji;
}

export function BotMessageReactionPill({
  reactions,
  ownMessage,
  onRemove,
}: {
  reactions: ReturnType<typeof botMessageReactions>;
  ownMessage: boolean;
  onRemove: (() => void) | undefined;
}) {
  const p = useBotPalette();
  if (!reactions.length) return null;
  return (
    <View
      style={{
        position: "absolute",
        bottom: -16,
        ...(ownMessage ? { left: 12 } : { right: 12 }),
        flexDirection: "row",
        maxWidth: "95%",
        flexWrap: "wrap",
        alignItems: "center",
        paddingHorizontal: 4,
        borderRadius: 18,
        borderWidth: 3,
        borderColor: p.canvas,
        backgroundColor: p.surface,
      }}
    >
      {reactions.map(({ key, emoji, own }) =>
        own && onRemove ? (
          <Pressable
            key={key}
            accessibilityRole="button"
            accessibilityLabel={`Remove reaction ${emoji}`}
            hitSlop={8}
            onPress={() => {
              void selectionAsync().catch(() => undefined);
              onRemove();
            }}
            className="h-7 justify-center px-1 active:opacity-60"
          >
            <Text>{emoji}</Text>
          </Pressable>
        ) : (
          <View
            key={key}
            accessible
            accessibilityRole="image"
            accessibilityLabel={own ? `Your reaction ${emoji}` : `Bot reaction ${emoji}`}
            className="h-7 justify-center px-1"
          >
            <Text>{emoji}</Text>
          </View>
        ),
      )}
    </View>
  );
}
