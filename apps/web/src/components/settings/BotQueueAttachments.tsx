import { settlePromise } from "@t3tools/client-runtime/state/runtime";
import { useRef, useState } from "react";
import {
  createQueueAttachments,
  type QueueAttachmentState,
  type QueueAttachmentPorts,
} from "@t3tools/client-runtime/openbot/queue-attachments";
import type { OpenbotOriginalUploadIdentity } from "@t3tools/contracts";
import { Button } from "../ui/button";
import { T, Var, useGT } from "gt-react";
type Props = {
  initial: QueueAttachmentState;
  ports: QueueAttachmentPorts;
  available: boolean;
  onComplete: () => void;
  pick: (file: File) => Promise<OpenbotOriginalUploadIdentity | null>;
};
export function BotQueueAttachments(props: Props) {
  return <QueueAttachmentsForm key={JSON.stringify(props.initial.scope)} {...props} />;
}
function QueueAttachmentsForm({ initial, ports, available, pick, onComplete }: Props) {
  const gt = useGT();
  const picker = useRef<HTMLInputElement>(null);
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
      <p>
        <T>Adding files to queued edits is unavailable on this host.</T>
      </p>
    );
  const ready = state.phase === "ready";
  return (
    <section aria-label={gt("Files for queued edit")} aria-busy={busy} className="space-y-2">
      <label className="block">
        <T>Queued message</T>
        <textarea
          className="w-full rounded border p-2"
          value={text}
          disabled={busy || !ready}
          onChange={(event) => setText(event.target.value)}
        />
      </label>
      <p>
        <T>These files will be added to this queued message when you save.</T>
      </p>
      <ul>
        {state.edit.keepAttachmentIds.map((id) => (
          <Button
            key={id}
            disabled={busy || !ready}
            onClick={() =>
              void act(() =>
                controller.change(
                  text,
                  state.edit.keepAttachmentIds.filter((keep) => keep !== id),
                ),
              )
            }
          >
            <T>
              Remove retained file <Var>{id}</Var>
            </T>
          </Button>
        ))}
        {state.edit.uploads.map((u) => (
          <li key={u.identity.operationId}>
            {u.identity.name}{" "}
            <Button
              disabled={busy || !ready}
              onClick={() => void act(() => controller.remove(u.identity.operationId))}
            >
              <T>
                Remove <Var>{u.identity.name}</Var>
              </T>
            </Button>
          </li>
        ))}
      </ul>
      {state.pendingUpload && (
        <p>
          <T>Upload result is unknown. Recover it or remove this exact upload before saving.</T>
        </p>
      )}
      <input
        ref={picker}
        type="file"
        hidden
        tabIndex={-1}
        aria-label={gt("File for queued edit")}
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          if (!file || busy || !ready || state.pendingUpload !== null) return;
          void act(async () => {
            const identity = await pick(file);
            return identity ? controller.attach(identity) : false;
          });
        }}
      />
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={busy || !ready || state.pendingUpload !== null}
          onClick={() => picker.current?.click()}
        >
          <T>Attach file</T>
        </Button>
        {state.pendingUpload && (
          <>
            <Button disabled={busy} onClick={() => void act(() => controller.recoverUpload())}>
              <T>Recover upload</T>
            </Button>
            <Button
              disabled={busy || !ready}
              onClick={() => void act(() => controller.remove(state.pendingUpload!.operationId))}
            >
              <T>Remove pending upload</T>
            </Button>
          </>
        )}
        <Button
          disabled={busy || !ready || state.pendingUpload !== null || !state.edit.uploads.length}
          onClick={() =>
            void act(async () => {
              if (!(await controller.change(text, state.edit.keepAttachmentIds))) return false;
              return controller.save();
            })
          }
        >
          <T>Save queued edit</T>
        </Button>
        {(state.phase === "unknown" || state.phase === "saving") && (
          <Button disabled={busy} onClick={() => void act(() => controller.reconcile())}>
            <T>Check edit result</T>
          </Button>
        )}
        <Button disabled={busy || !ready} onClick={() => void act(() => controller.cancel())}>
          <T>Cancel edit</T>
        </Button>
      </div>
      {(state.phase === "unknown" || state.phase === "saving") && (
        <p>
          <T>
            The result is uncertain. Saving again and releasing files are unavailable until the
            original receipt is confirmed.
          </T>
        </p>
      )}
      <p role="status">{state.phase === "saved" ? gt("Queued message updated.") : status}</p>
    </section>
  );
}
