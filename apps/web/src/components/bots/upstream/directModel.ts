import * as Schema from "effect/Schema";
import {
  OpenbotPeople,
  OpenbotDirectSelf,
  OpenbotDirectThreads,
  OpenbotDirectPage,
  OpenbotDirectMessage,
  OpenbotDirectReadState,
  type OpenbotPerson,
  type OpenbotDirectThread,
} from "@t3tools/contracts";

export const decodePeople = Schema.decodeUnknownOption(OpenbotPeople);
export const decodeSelf = Schema.decodeUnknownOption(OpenbotDirectSelf);
export const decodeDirectThreads = Schema.decodeUnknownOption(OpenbotDirectThreads);
export const decodeDirectPage = Schema.decodeUnknownOption(OpenbotDirectPage);
export const decodeDirectReadState = Schema.decodeUnknownOption(OpenbotDirectReadState);
export const decodeDirectMessage = Schema.decodeUnknownOption(OpenbotDirectMessage);
export function personName(member: OpenbotPerson) {
  return member.name?.trim() || member.email || member.username;
}
export function orderedPeople(
  members: readonly OpenbotPerson[],
  selfId: string,
  threads: readonly OpenbotDirectThread[],
  order: readonly string[],
) {
  const byMember = new Map(threads.map((thread) => [thread.otherMemberId, thread]));
  const positions = new Map(order.map((id, index) => [id, index]));
  return members
    .filter((member) => !member.disabled && member.id !== selfId)
    .toSorted((a, b) => {
      const ordered = (positions.get(a.id) ?? order.length) - (positions.get(b.id) ?? order.length);
      if (ordered) return ordered;
      const left = byMember.get(a.id),
        right = byMember.get(b.id);
      if (left || right) return (right?.updatedAt ?? "").localeCompare(left?.updatedAt ?? "");
      return Number(b.online) - Number(a.online) || personName(a).localeCompare(personName(b));
    });
}
export function directMessages(
  latest: OpenbotDirectPage | null,
  older: readonly OpenbotDirectPage[],
) {
  if (!latest) return [];
  const messages = new Map(latest.messages.map((message) => [message.id, message]));
  for (const page of older) {
    if (page.threadId !== latest.threadId || page.otherMemberId !== latest.otherMemberId) continue;
    for (const message of page.messages)
      if (!messages.has(message.id)) messages.set(message.id, message);
  }
  return [...messages.values()].sort((a, b) => a.sequence - b.sequence);
}
export function validDirectPage(page: OpenbotDirectPage, memberId: string, selfId: string) {
  return (
    page.otherMemberId === memberId &&
    page.messages.every(
      (message) =>
        message.threadId === page.threadId &&
        ((message.senderMemberId === selfId && message.recipientMemberId === memberId) ||
          (message.senderMemberId === memberId && message.recipientMemberId === selfId)),
    )
  );
}
export type DirectDraft = { text: string; attempt: { id: string; text: string } | null };
export function readDirectDraft(storage: Pick<Storage, "getItem">, key: string): DirectDraft {
  try {
    const value = JSON.parse(storage.getItem(key) ?? "null");
    if (value && typeof value.text === "string" && value.text.length <= 20_000) {
      const attempt = value.attempt;
      if (
        attempt === null ||
        (attempt &&
          typeof attempt.id === "string" &&
          attempt.id.length > 0 &&
          typeof attempt.text === "string" &&
          attempt.text.length <= 20_000)
      )
        return { text: attempt?.text ?? value.text, attempt };
    }
  } catch {
    /* The editor still works when draft storage is unavailable. */
  }
  return { text: "", attempt: null };
}
