import { useEffect, useRef, useState } from "react";
import {
  BotQueueEditSession,
  type BotQueueEdit,
} from "@t3tools/client-runtime/openbot/presentation";
import { View } from "react-native";
import { randomUUID } from "expo-crypto";
import { AppText as Text, AppTextInput } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";

import type { useBotConversationPanel } from "./useBotConversationPanel";
export function BotConversationQueue({
  controller: c,
  agentId,
}: {
  controller: ReturnType<typeof useBotConversationPanel>;
  agentId: string;
}) {
  const [edit, setEdit] = useState<BotQueueEdit | null>(null);
  const session = useRef(new BotQueueEditSession());
  const releaseOnLeave = useRef<(() => void) | null>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Release the external host edit lease when its panel unmounts.
  useEffect(() => () => releaseOnLeave.current?.(), []);
  const begin = async (deliveryId: string) => {
    const pending = session.current.begin(deliveryId, randomUUID);
    if (!pending) return;
    setEdit(pending);
    releaseOnLeave.current = () => {
      void c.releaseEdit(pending.deliveryId, pending.editId);
    };
    const acquired = await c.beginEdit(pending.deliveryId, pending.editId);
    if (acquired) setEdit(session.current.confirm(pending.editId, acquired));
  };
  const disabled = c.busy || !c.permission;
  const queued =
    c.queue?.deliveries
      .filter((d) => d.status === "queued")
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0)) ?? [];
  return (
    <View className="gap-3">
      <Text accessibilityRole="header">Queue</Text>
      {c.queue?.hold && <Text>Queue held by channel work.</Text>}
      {(c.queue?.deliveries ?? [])
        .filter((d) => d.status !== "completed" && d.status !== "cancelled")
        .slice(0, 100)
        .map((d) => (
          <View key={d.id} className="gap-2">
            <Text>
              {d.status} · {d.text}
            </Text>
            {d.error && <Text>{d.error}</Text>}
            {d.status === "queued" && (
              <View className="gap-2">
                <Button
                  disabled={disabled || edit !== null}
                  onPress={() => void begin(d.id)}
                  label="Edit"
                />
                <Button
                  disabled={disabled}
                  onPress={() =>
                    void c.act({ operation: "queue.cancel", agentId, deliveryId: d.id })
                  }
                  label="Cancel delivery"
                />
                <Button
                  disabled={disabled || !c.snapshot?.activeTurnId}
                  onPress={() => {
                    if (c.snapshot?.activeTurnId)
                      void c.act({
                        operation: "queue.steer",
                        agentId,
                        deliveryId: d.id,
                        expectedTurnId: c.snapshot.activeTurnId,
                      });
                  }}
                  label="Steer running turn"
                />
                <Button
                  disabled={disabled || queued.length > 100 || queued[0]?.id === d.id}
                  onPress={() =>
                    void c.act({
                      operation: "queue.reorder",
                      agentId,
                      deliveryIds: [d.id, ...queued.filter((q) => q.id !== d.id).map((q) => q.id)],
                    })
                  }
                  label="Move first"
                />
              </View>
            )}
            {d.status === "failed" && d.turnId && (
              <Button
                disabled={disabled}
                onPress={() =>
                  void c.act({ operation: "queue.acknowledgeFailure", agentId, turnId: d.turnId! })
                }
                label="Acknowledge failure"
              />
            )}
          </View>
        ))}
      {edit && (
        <View className="gap-2">
          {edit.state === "pending" ? (
            <>
              <Text accessibilityLiveRegion="polite">
                This edit has not been confirmed. Retry or release it before editing another
                message.
              </Text>
              <Button
                disabled={disabled}
                onPress={() => void begin(edit.deliveryId)}
                label="Retry edit"
              />
            </>
          ) : (
            <>
              <AppTextInput
                accessibilityLabel="Edit queued message"
                value={edit.text}
                maxLength={100000}
                editable={!disabled}
                onChangeText={(text) => setEdit(session.current.changeText(text))}
              />
              <Button
                disabled={disabled}
                onPress={async () => {
                  if (
                    await c.act({
                      operation: "queue.edit",
                      agentId,
                      deliveryId: edit.deliveryId,
                      editId: edit.editId,
                      text: edit.text,
                      keepAttachmentIds: edit.keepAttachmentIds,
                      action: "save",
                      attachmentDraftIds: [],
                    })
                  ) {
                    setEdit(session.current.finish(edit.editId));
                    releaseOnLeave.current = null;
                  }
                }}
                label="Save queue edit"
              />
            </>
          )}
          <Button
            disabled={disabled}
            onPress={async () => {
              if (
                await c.act({
                  operation: "queue.edit",
                  agentId,
                  deliveryId: edit.deliveryId,
                  editId: edit.editId,
                  action: "cancel",
                })
              ) {
                setEdit(session.current.finish(edit.editId));
                releaseOnLeave.current = null;
              }
            }}
            label="Release edit"
          />
          <Text>
            Release this edit before leaving; a connection failure can prevent automatic release.
          </Text>
        </View>
      )}
    </View>
  );
}
