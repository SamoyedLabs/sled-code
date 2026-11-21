import { settlePromise } from "@t3tools/client-runtime/state/runtime";
import { useState } from "react";
import { View } from "react-native";
import {
  createQueueAttachments,
  type QueueAttachmentState,
  type QueueAttachmentPorts,
} from "@t3tools/client-runtime/openbot/queue-attachments";
import type { OpenbotOriginalUploadIdentity } from "@t3tools/contracts";
import { Button } from "../../components/ui/Button";
import { AppText as Text, AppTextInput } from "../../components/ui/AppText";
import { T, useGT } from "gt-react-native";
type Props = {
  initial: QueueAttachmentState;
  ports: QueueAttachmentPorts;
  available: boolean;
  onComplete: () => void;
  pick: () => Promise<OpenbotOriginalUploadIdentity | null>;
};
export function BotQueueAttachments(props: Props) {
  return <QueueAttachmentsForm key={JSON.stringify(props.initial.scope)} {...props} />;
}
function QueueAttachmentsForm({ initial, ports, available, pick, onComplete }: Props) {
  const gt = useGT();
  const [controller] = useState(() => createQueueAttachments(initial, ports));
  const [text, setText] = useState(initial.edit.text);
  const [state, setState] = useState(controller.state),
    [busy, setBusy] = useState(false),
    [status, setStatus] = useState("");
  const act = async (action: () => Promise<boolean>) => {
    if (busy) return;
    setBusy(true);
    const settled = await settlePromise(action);
    setStatus(
      settled._tag === "Success" && settled.value
        ? gt("Updated.")
        : ports.current() === null
          ? gt(
              "The original connection or access changed. After reconnecting, close this editor and resume the original edit before continuing.",
            )
          : gt("Not confirmed. Check the original result before continuing."),
    );
    setState(controller.state);
    setBusy(false);
    if (controller.state.phase === "saved" || controller.state.phase === "cancelled") onComplete();
  };
  if (!available)
    return (
      <Text>
        <T>Adding files to queued edits is unavailable on this host.</T>
      </Text>
    );
  const ready = state.phase === "ready";
  return (
    <View className="gap-2">
      <AppTextInput
        accessibilityLabel={gt("Queued message")}
        multiline
        value={text}
        editable={!busy && ready}
        onChangeText={setText}
      />
      <Text>
        <T>These files will be added to this queued message when you save.</T>
      </Text>
      {state.edit.keepAttachmentIds.map((id) => (
        <Button
          key={id}
          disabled={busy || !ready}
          onPress={() =>
            void act(() =>
              controller.change(
                text,
                state.edit.keepAttachmentIds.filter((keep) => keep !== id),
              ),
            )
          }
          label={gt("Remove retained file {id}", { id })}
        />
      ))}
      {state.edit.uploads.map((u) => (
        <View key={u.identity.operationId}>
          <Text>{u.identity.name}</Text>
          <Button
            disabled={busy || !ready}
            onPress={() => void act(() => controller.remove(u.identity.operationId))}
            label={gt("Remove {name}", { name: u.identity.name })}
          />
        </View>
      ))}
      <Button
        disabled={busy || !ready || state.pendingUpload !== null}
        onPress={() =>
          void act(async () => {
            const identity = await pick();
            return identity ? controller.attach(identity) : false;
          })
        }
        label={gt("Attach file")}
      />
      {state.pendingUpload && (
        <>
          <Text>
            <T>Upload result is unknown. Recover it or remove this exact upload before saving.</T>
          </Text>
          <Button
            disabled={busy}
            onPress={() => void act(() => controller.recoverUpload())}
            label={gt("Recover upload")}
          />
          <Button
            disabled={busy || !ready}
            onPress={() => void act(() => controller.remove(state.pendingUpload!.operationId))}
            label={gt("Remove pending upload")}
          />
        </>
      )}
      <Button
        disabled={busy || !ready || state.pendingUpload !== null || !state.edit.uploads.length}
        onPress={() =>
          void act(async () => {
            if (!(await controller.change(text, state.edit.keepAttachmentIds))) return false;
            return controller.save();
          })
        }
        label={gt("Save queued edit")}
      />
      {(state.phase === "unknown" || state.phase === "saving") && (
        <>
          <Text>
            <T>The result is uncertain. Check the original receipt before continuing.</T>
          </Text>
          <Button
            disabled={busy}
            onPress={() => void act(() => controller.reconcile())}
            label={gt("Check edit result")}
          />
        </>
      )}
      <Button
        disabled={busy || !ready}
        onPress={() => void act(() => controller.cancel())}
        label={gt("Cancel edit")}
      />
      <Text accessibilityLiveRegion="polite">
        {state.phase === "saved" ? gt("Queued message updated.") : status}
      </Text>
    </View>
  );
}
