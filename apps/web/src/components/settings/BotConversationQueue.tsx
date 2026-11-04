import { useEffect, useRef, useState } from "react";
import {
  BotQueueEditSession,
  type BotQueueEdit,
} from "@t3tools/client-runtime/openbot/presentation";
import { randomUUID } from "../../lib/utils";
import { Button } from "../ui/button";
import { Textarea } from "../ui/textarea";
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
    <section aria-label="Bot queue" className="space-y-3">
      <h3>Queue</h3>
      {c.queue?.hold && <p>Queue held by channel work.</p>}
      {(c.queue?.deliveries ?? [])
        .filter((d) => d.status !== "completed" && d.status !== "cancelled")
        .slice(0, 100)
        .map((d) => (
          <div key={d.id} className="space-y-2">
            <p>
              {d.status} · {d.text}
            </p>
            {d.error && <p>{d.error}</p>}
            {d.status === "queued" && (
              <div className="flex flex-wrap gap-2">
                <Button disabled={disabled || edit !== null} onClick={() => void begin(d.id)}>
                  Edit
                </Button>
                <Button
                  disabled={disabled}
                  onClick={() =>
                    void c.act({ operation: "queue.cancel", agentId, deliveryId: d.id })
                  }
                >
                  Cancel delivery
                </Button>
                <Button
                  disabled={disabled || !c.snapshot?.activeTurnId}
                  onClick={() => {
                    if (c.snapshot?.activeTurnId)
                      void c.act({
                        operation: "queue.steer",
                        agentId,
                        deliveryId: d.id,
                        expectedTurnId: c.snapshot.activeTurnId,
                      });
                  }}
                >
                  Steer running turn
                </Button>
                <Button
                  disabled={disabled || queued.length > 100 || queued[0]?.id === d.id}
                  onClick={() =>
                    void c.act({
                      operation: "queue.reorder",
                      agentId,
                      deliveryIds: [d.id, ...queued.filter((q) => q.id !== d.id).map((q) => q.id)],
                    })
                  }
                >
                  Move first
                </Button>
              </div>
            )}
            {d.status === "failed" && d.turnId && (
              <Button
                disabled={disabled}
                onClick={() =>
                  void c.act({ operation: "queue.acknowledgeFailure", agentId, turnId: d.turnId! })
                }
              >
                Acknowledge failure
              </Button>
            )}
          </div>
        ))}
      {edit && (
        <div className="space-y-2">
          {edit.state === "pending" ? (
            <>
              <p role="status">
                This edit has not been confirmed. Retry or release it before editing another
                message.
              </p>
              <Button disabled={disabled} onClick={() => void begin(edit.deliveryId)}>
                Retry edit
              </Button>
            </>
          ) : (
            <>
              {edit.keepAttachmentIds.map((id) => (
                <Button
                  key={id}
                  disabled={disabled}
                  onClick={() =>
                    setEdit(
                      session.current.retainAttachments(
                        edit.editId,
                        edit.keepAttachmentIds.filter((keep) => keep !== id),
                      ),
                    )
                  }
                >
                  Remove retained file {id}
                </Button>
              ))}
              <Textarea
                aria-label="Edit queued message"
                value={edit.text}
                maxLength={100000}
                disabled={disabled}
                onChange={(e) => setEdit(session.current.changeText(e.target.value))}
              />
              <Button
                disabled={disabled}
                onClick={async () => {
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
              >
                Save queue edit
              </Button>
            </>
          )}
          <Button
            disabled={disabled}
            onClick={async () => {
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
          >
            Release edit
          </Button>
          <p>
            Release this edit before leaving; a connection failure can prevent automatic release.
          </p>
        </div>
      )}
    </section>
  );
}
