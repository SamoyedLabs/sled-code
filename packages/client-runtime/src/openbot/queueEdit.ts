import type { OpenbotQueueDelivery } from "@t3tools/contracts";

type Identity = { readonly deliveryId: string; readonly editId: string };
export type BotQueueEdit =
  | (Identity & { readonly state: "pending" })
  | (Identity & {
      readonly state: "ready";
      readonly text: string;
      readonly keepAttachmentIds: readonly string[];
    });

export class BotQueueEditSession {
  #current: BotQueueEdit | null = null;
  get current() {
    return this.#current;
  }
  begin(deliveryId: string, newId: () => string): BotQueueEdit | null {
    if (this.#current) return this.#current.deliveryId === deliveryId ? this.#current : null;
    this.#current = { deliveryId, editId: newId(), state: "pending" };
    return this.#current;
  }
  confirm(editId: string, delivery: OpenbotQueueDelivery): BotQueueEdit | null {
    if (
      this.#current?.editId !== editId ||
      this.#current.deliveryId !== delivery.id ||
      delivery.status !== "queued" ||
      delivery.editing !== true
    )
      return this.#current;
    this.#current = {
      deliveryId: delivery.id,
      editId,
      state: "ready",
      text: delivery.text,
      keepAttachmentIds: delivery.attachments.flatMap((attachment) =>
        attachment !== null &&
        typeof attachment === "object" &&
        !Array.isArray(attachment) &&
        "id" in attachment &&
        typeof attachment.id === "string"
          ? [attachment.id]
          : [],
      ),
    };
    return this.#current;
  }
  retainAttachments(editId: string, ids: readonly string[]) {
    const current = this.#current;
    if (
      current?.state === "ready" &&
      current.editId === editId &&
      new Set(ids).size === ids.length &&
      ids.every((id) => current.keepAttachmentIds.includes(id))
    )
      this.#current = { ...current, keepAttachmentIds: [...ids] };
    return this.#current;
  }
  changeText(text: string) {
    if (this.#current?.state === "ready") this.#current = { ...this.#current, text };
    return this.#current;
  }
  finish(editId: string) {
    if (this.#current?.editId === editId) this.#current = null;
    return this.#current;
  }
}
