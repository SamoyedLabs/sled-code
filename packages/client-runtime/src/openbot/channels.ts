import * as Schema from "effect/Schema";
import * as Result from "effect/Result";
import {
  OpenbotChannelPage,
  OpenbotChannelSummary,
  OpenbotChannelAdminRequest,
  type OpenbotChannel,
  type OpenbotChannelDraft,
  type OpenbotChannelMessage,
  type OpenbotChannelTask,
} from "@t3tools/contracts";

const decodeList = Schema.decodeUnknownResult(Schema.Array(OpenbotChannelSummary));
const decodePage = Schema.decodeUnknownResult(OpenbotChannelPage);
const decodeAdmin = Schema.decodeUnknownResult(OpenbotChannelAdminRequest);
export function channelList(value: unknown) {
  const result = decodeList(value);
  return Result.isSuccess(result) ? result.success : null;
}
export function channelPage(value: unknown) {
  const result = decodePage(value);
  return Result.isSuccess(result) ? result.success : null;
}
type WithoutOperationId<Request> = Request extends unknown ? Omit<Request, "operationId"> : never;
export type ChannelActionInput = WithoutOperationId<OpenbotChannelAdminRequest>;
export function channelAdminRequest(
  input: ChannelActionInput,
  operationId: string,
): OpenbotChannelAdminRequest | null {
  const result = decodeAdmin({ ...input, operationId });
  return Result.isSuccess(result) ? result.success : null;
}
export type ChannelEdit = {
  readonly channelId: string;
  readonly baseRevision: number;
  readonly update: boolean;
  readonly base: OpenbotChannelDraft;
  readonly value: OpenbotChannelDraft;
};
function channelValue(channel: OpenbotChannel): OpenbotChannelDraft {
  return {
    name: channel.name,
    title: channel.title,
    instructions: channel.instructions,
    members: channel.members,
    leadAgentId: channel.leadAgentId,
  };
}
export function channelEditDraft(channel: OpenbotChannel): ChannelEdit {
  const value = channelValue(channel);
  return {
    channelId: channel.id,
    baseRevision: channel.revision,
    update: true,
    base: value,
    value,
  };
}
export function channelNewDraft(channelId: string): ChannelEdit {
  const value = { name: "", title: "", instructions: "", members: [], leadAgentId: null };
  return { channelId, baseRevision: 0, update: false, base: value, value };
}
export function channelSetVisibleMembers(
  edit: ChannelEdit,
  visibleIds: ReadonlySet<string>,
  selectedIds: readonly string[],
): ChannelEdit {
  const selected = new Set(selectedIds.filter((id) => visibleIds.has(id)));
  const retained = edit.value.members.filter(
    (member) => !visibleIds.has(member.agentId) || selected.has(member.agentId),
  );
  const retainedIds = new Set(retained.map((member) => member.agentId));
  const members = [
    ...retained,
    ...[...selected].filter((id) => !retainedIds.has(id)).map((agentId) => ({ agentId })),
  ];
  const leadAgentId = members.some((member) => member.agentId === edit.value.leadAgentId)
    ? edit.value.leadAgentId
    : null;
  return { ...edit, value: { ...edit.value, members, leadAgentId } };
}
export function channelDraftConflict(edit: ChannelEdit, current: OpenbotChannel | null) {
  return (
    edit.update &&
    (!current ||
      current.id !== edit.channelId ||
      JSON.stringify(channelValue(current)) !== JSON.stringify(edit.base))
  );
}
export function channelSaveRequest(
  edit: ChannelEdit,
  operationId: string,
  current: OpenbotChannel | null,
): Extract<OpenbotChannelAdminRequest, { operation: "channel.save" }> | null {
  if (channelDraftConflict(edit, current)) return null;
  const request = channelAdminRequest(
    {
      operation: "channel.save",
      channelId: edit.channelId,
      update: edit.update,
      draft: edit.value,
    },
    operationId,
  );
  return request?.operation === "channel.save" ? request : null;
}
export function channelMessages(
  channelId: string,
  pages: readonly OpenbotChannelPage[],
): readonly OpenbotChannelMessage[] {
  const messages = new Map<string, OpenbotChannelMessage>();
  for (const page of pages) {
    if (page.channel.id !== channelId) continue;
    for (const message of page.messages)
      if (message.channelId === channelId) messages.set(message.id, message);
  }
  return [...messages.values()].sort(
    (left, right) => left.sequence - right.sequence || left.id.localeCompare(right.id),
  );
}
export function channelTaskActions(
  state: OpenbotChannelTask["state"],
  archived: boolean,
): readonly ("stop" | "resume" | "reassign" | "cancel")[] {
  if (archived || state === "completed" || state === "cancelled") return [];
  return state === "paused" || state === "failed"
    ? ["resume", "reassign", "cancel"]
    : ["stop", "reassign"];
}
