import type { EnvironmentId } from "@t3tools/contracts";
import { useEffect, useState } from "react";
import { Keyboard, Pressable, View } from "react-native";
import { Menu } from "../../components/ui/Menu";
import { useBotOfflineScope } from "./botOfflineCache";
import { outboxChatMatches, useBotOutbox, type OutboxChat } from "./botOutbox";
import {
  chooseBotOutboxFile,
  releaseBotOutboxFiles,
  saveBotOutboxFiles,
  type BotOutboxFilePick,
} from "./botOutboxFiles";
import { BotGlass, BotIconButton, useBotPalette } from "./upstream/BotChrome";
import { BotMessageComposer } from "./upstream/BotMessageComposer";
import { OpenBotText as Text } from "./upstream/OpenBotTypography";

type PendingScope = { environmentId: EnvironmentId; hostId: string; chat: OutboxChat };

export function useEditingBotOutbox({ environmentId, hostId, chat }: PendingScope) {
  const scope = useBotOfflineScope(environmentId);
  const { snapshot } = useBotOutbox(scope);
  return snapshot.entries.some(
    (entry) =>
      entry.id === snapshot.editing &&
      entry.hostId === hostId &&
      outboxChatMatches(entry.chat, chat),
  );
}

export function BotPendingMessages({
  environmentId,
  hostId,
  chat,
  allowEditing = true,
}: PendingScope & { allowEditing?: boolean }) {
  const scope = useBotOfflineScope(environmentId);
  const { outbox, snapshot } = useBotOutbox(scope);
  const palette = useBotPalette();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [keep, setKeep] = useState<ReadonlySet<string>>(new Set());
  const [added, setAdded] = useState<readonly BotOutboxFilePick[]>([]);
  const [picking, setPicking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Release this editor's delivery reservation on close.
  useEffect(() => {
    if (editingId) return () => outbox?.endEdit(editingId);
  }, [outbox, editingId]);
  const queued = snapshot.entries.filter(
    (entry) => entry.hostId === hostId && outboxChatMatches(entry.chat, chat),
  );
  if (!queued.length || !outbox) return null;
  return (
    <View style={{ gap: 7 }}>
      {queued.map((entry) => {
        const sending = snapshot.sending === entry.id;
        const failed = snapshot.failed === entry.id;
        const editing = snapshot.editing === entry.id && editingId === entry.id;
        const canEdit = allowEditing && entry.sealed === false && !sending && !snapshot.editing;
        if (editing) {
          const originals = (entry.files ?? []).filter((file) => keep.has(file.id));
          const files = [...originals, ...added];
          // An existing durable destination is required to add files while offline.
          const canAttach = Boolean(
            scope &&
            entry.expectedThreadId &&
            (entry.chat.kind === "agent" || entry.groupAttachmentAgentId),
          );
          return (
            <View key={entry.id} style={{ gap: 7 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                <Text style={{ color: palette.muted, fontSize: 12, flex: 1 }}>
                  Editing queued message
                </Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Cancel queued message edit"
                  disabled={saving || picking}
                  onPress={() => {
                    outbox.endEdit(entry.id);
                    setEditingId(null);
                    Keyboard.dismiss();
                  }}
                >
                  <Text style={{ color: palette.text }}>Cancel</Text>
                </Pressable>
              </View>
              {files.map((file) => (
                <Pressable
                  key={file.id}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove queued attachment ${file.name}`}
                  disabled={saving || picking}
                  onPress={() => {
                    setKeep((current) => new Set([...current].filter((id) => id !== file.id)));
                    setAdded((current) => current.filter(({ id }) => id !== file.id));
                  }}
                  style={{
                    alignSelf: "flex-start",
                    borderRadius: 12,
                    padding: 8,
                    backgroundColor: palette.control,
                  }}
                >
                  <Text numberOfLines={1} style={{ color: palette.text }}>
                    {file.name} ×
                  </Text>
                </Pressable>
              ))}
              {error && (
                <Text accessibilityRole="alert" style={{ color: palette.text }}>
                  Could not save your changes.
                </Text>
              )}
              <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 8 }}>
                {canAttach && (
                  <Menu
                    actions={[
                      { id: "files", title: "Files" },
                      { id: "photos", title: "Photos" },
                      { id: "camera", title: "Camera" },
                    ]}
                    onPressAction={async ({ nativeEvent }) => {
                      const source = nativeEvent.event;
                      if (saving || picking || files.length >= 10) return;
                      if (source !== "files" && source !== "photos" && source !== "camera") return;
                      setPicking(true);
                      try {
                        const file = await chooseBotOutboxFile(source);
                        if (file) setAdded((current) => [...current, file]);
                      } catch {
                        setError(true);
                      }
                      setPicking(false);
                    }}
                  >
                    <BotGlass>
                      <BotIconButton
                        label="Add to queued message"
                        icon="plus"
                        disabled={saving || picking || files.length >= 10}
                      />
                    </BotGlass>
                  </Menu>
                )}
                <BotMessageComposer
                  action="send"
                  label="Edit queued message"
                  sendLabel="Save changes"
                  text={text}
                  onChangeText={setText}
                  editable={!saving}
                  actionDisabled={
                    saving || picking || text.length > 20_000 || (!text.trim() && !files.length)
                  }
                  showVoiceControl={false}
                  onAction={async (committedText) => {
                    if (!scope) return;
                    setSaving(true);
                    setError(false);
                    try {
                      const stored = await saveBotOutboxFiles(scope, added);
                      if (await outbox.saveEdit(entry.id, committedText, { keep, add: stored })) {
                        setEditingId(null);
                        Keyboard.dismiss();
                      } else {
                        await releaseBotOutboxFiles(scope, stored);
                        setError(true);
                      }
                    } catch {
                      setError(true);
                    }
                    setSaving(false);
                  }}
                />
              </View>
            </View>
          );
        }
        return (
          <View
            key={entry.id}
            style={{ gap: 5, padding: 10, borderRadius: 14, backgroundColor: palette.control }}
          >
            <Text numberOfLines={3} style={{ color: palette.text, fontSize: 14 }}>
              {[entry.text, ...(entry.files ?? []).map((file) => file.name)]
                .filter(Boolean)
                .join("\n")}
            </Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
              <Text
                accessibilityLiveRegion="polite"
                style={{ color: palette.muted, fontSize: 12, flex: 1 }}
              >
                {sending ? "Sending…" : failed ? "Delivery unconfirmed" : "Waiting to send"}
              </Text>
              {canEdit && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Edit queued message"
                  onPress={() => {
                    if (!outbox.beginEdit(entry.id)) return;
                    setText(entry.text);
                    setKeep(new Set(entry.files?.map(({ id }) => id)));
                    setAdded([]);
                    setError(false);
                    setEditingId(entry.id);
                  }}
                >
                  <Text style={{ color: palette.text }}>Edit</Text>
                </Pressable>
              )}
              {failed && (
                <Pressable accessibilityRole="button" onPress={() => outbox.retry()}>
                  <Text style={{ color: palette.text }}>Retry</Text>
                </Pressable>
              )}
              {!sending && snapshot.editing !== entry.id && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Remove queued message"
                  onPress={() => void outbox.cancel(entry.id)}
                >
                  <Text style={{ color: palette.text }}>Remove</Text>
                </Pressable>
              )}
            </View>
          </View>
        );
      })}
    </View>
  );
}
