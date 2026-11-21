import { BotChannelGrants } from "./BotChannelGrants";
import { useState } from "react";
import type { EnvironmentId, OpenbotChannelTask } from "@t3tools/contracts";
import {
  channelSetVisibleMembers,
  channelTaskActions,
} from "@t3tools/client-runtime/openbot/presentation";
import { randomUUID } from "../../lib/utils";
import { requestConfirmDialog } from "../../confirmDialog";
import { useBotChannels } from "./useBotChannels";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import { Checkbox } from "../ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { T, Var, useGT } from "gt-react";

type Props = {
  environmentId: EnvironmentId;
  hostId: string;
  initiallyExpanded?: boolean;
  initialChannelId?: string;
  initialTaskId?: string;
};
type Controller = ReturnType<typeof useBotChannels>;
export function BotChannels(props: Props) {
  const gt = useGT();
  const [expanded, setExpanded] = useState(
    props.initiallyExpanded ?? props.initialChannelId !== undefined,
  );
  return (
    <section aria-label={gt("Bot channels")} className="space-y-3">
      <Button
        variant="outline"
        size="sm"
        aria-expanded={expanded}
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? gt("Close channels") : gt("Channels")}
      </Button>
      {expanded && <ChannelsPanel key={`${props.environmentId}:${props.hostId}`} {...props} />}
    </section>
  );
}
function Choice({
  label,
  value,
  options,
  disabled,
  empty,
  onChange,
}: {
  label: string;
  value: string | null;
  options: readonly { id: string; name: string }[];
  disabled: boolean;
  empty: string;
  onChange: (value: string | null) => void;
}) {
  return (
    <label className="block space-y-1 text-sm">
      <span>{label}</span>
      <Select
        value={value ?? "__none"}
        disabled={disabled}
        onValueChange={(next) => {
          if (next) onChange(next === "__none" ? null : next);
        }}
      >
        <SelectTrigger aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__none">{empty}</SelectItem>
          {options.map((option) => (
            <SelectItem key={option.id} value={option.id}>
              {option.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  );
}
async function confirm(message: string) {
  return (
    (await requestConfirmDialog(message, { variant: "destructive" })) ?? window.confirm(message)
  );
}
function ChannelSettings({ controller }: { controller: Controller }) {
  const gt = useGT();
  const edit = controller.edit;
  if (!edit) return null;
  const visible = new Set(controller.agents.map((agent) => agent.id));
  const members = new Set(edit.value.members.map((member) => member.agentId));
  const unavailable = edit.value.members.filter((member) => !visible.has(member.agentId));
  const disabled = controller.busy || !controller.canManage;
  return (
    <div className="space-y-3">
      <h3 className="text-base font-medium">
        {edit.update ? gt("Channel settings") : gt("New channel")}
      </h3>
      <label className="block space-y-1 text-sm">
        <span>
          <T>Channel name</T>
        </span>
        <Input
          value={edit.value.name}
          maxLength={80}
          disabled={disabled}
          onChange={(event) =>
            controller.setEdit({ ...edit, value: { ...edit.value, name: event.target.value } })
          }
        />
      </label>
      <label className="block space-y-1 text-sm">
        <span>
          <T>Title</T>
        </span>
        <Input
          value={edit.value.title}
          maxLength={120}
          disabled={disabled}
          onChange={(event) =>
            controller.setEdit({ ...edit, value: { ...edit.value, title: event.target.value } })
          }
        />
      </label>
      <label className="block space-y-1 text-sm">
        <span>
          <T>Shared instructions</T>
        </span>
        <Textarea
          value={edit.value.instructions}
          rows={4}
          maxLength={2_000}
          disabled={disabled}
          onChange={(event) =>
            controller.setEdit({
              ...edit,
              value: { ...edit.value, instructions: event.target.value },
            })
          }
        />
      </label>
      <fieldset className="space-y-2">
        <legend className="text-sm">
          <T>Member bots</T>
        </legend>
        {controller.agents.map((agent) => (
          <label key={agent.id} className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={members.has(agent.id)}
              disabled={disabled}
              onCheckedChange={(checked) =>
                controller.setEdit(
                  channelSetVisibleMembers(
                    edit,
                    visible,
                    checked ? [...members, agent.id] : [...members].filter((id) => id !== agent.id),
                  ),
                )
              }
            />
            <span>{agent.name}</span>
          </label>
        ))}
      </fieldset>
      {unavailable.length > 0 && (
        <p className="text-sm text-muted-foreground">
          <T>
            <Var>{unavailable.length}</Var> unlisted{" "}
            <Var>{unavailable.length === 1 ? gt("member is") : gt("members are")}</Var>
            <Var> </Var>
            retained. Changing visible members keeps them in this channel.
          </T>
        </p>
      )}
      <Choice
        label={gt("Lead bot")}
        value={edit.value.leadAgentId}
        empty="No lead"
        options={edit.value.members.map((member) => ({
          id: member.agentId,
          name:
            controller.agents.find((agent) => agent.id === member.agentId)?.name ??
            "Unlisted bot (retained)",
        }))}
        disabled={disabled}
        onChange={(leadAgentId) =>
          controller.setEdit({ ...edit, value: { ...edit.value, leadAgentId } })
        }
      />
      <p className="text-sm text-muted-foreground">
        <T>
          Removing a member pauses its unfinished work. Messages use the lead, an @mention, or a
          selected recipient.
        </T>
      </p>
      {controller.conflict && (
        <p role="alert" className="text-sm text-destructive">
          <T>
            The channel settings changed on the engine. Your draft is retained; discard it to load
            the current settings.
          </T>
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          disabled={disabled || controller.conflict || !edit.value.name.trim()}
          onClick={controller.save}
        >
          {edit.update ? gt("Save settings") : gt("Create channel")}
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={controller.busy}
          onClick={() => controller.setEdit(null)}
        >
          <T>Discard draft</T>
        </Button>
      </div>
    </div>
  );
}
function TaskRow({ controller, task }: { controller: Controller; task: OpenbotChannelTask }) {
  const gt = useGT();
  const [assignee, setAssignee] = useState<string | null>(null);
  const actions = channelTaskActions(task.state, controller.channel?.archived ?? true);
  const channel = controller.channel;
  if (!channel) return null;
  const options = channel.members.flatMap((member) => {
    const agent = controller.agents.find((row) => row.id === member.agentId);
    return agent ? [{ id: agent.id, name: agent.name }] : [];
  });
  const disabled = controller.busy || !controller.canOperate;
  return (
    <li className="space-y-2">
      <p className="text-sm font-medium">
        {task.ownerAgentId
          ? (controller.agents.find((agent) => agent.id === task.ownerAgentId)?.name ??
            gt("Unlisted bot"))
          : gt("Waiting for assignment")}{" "}
        · {task.state}
      </p>
      <p className="whitespace-pre-wrap break-words text-sm">{task.instruction}</p>
      {task.dependencies.length > 0 && (
        <p className="text-sm text-muted-foreground">
          <T>
            Depends on <Var>{task.dependencies.length}</Var>{" "}
            <Var>{task.dependencies.length === 1 ? "task" : "tasks"}</Var>.
          </T>
        </p>
      )}
      {task.error && (
        <p className="whitespace-pre-wrap break-words text-sm text-destructive">{task.error}</p>
      )}
      <div className="flex flex-wrap gap-2">
        {actions.includes("stop") && (
          <Button
            variant="outline"
            size="sm"
            disabled={disabled}
            onClick={() =>
              void controller.act({
                operation: "channel.stop",
                channelId: channel.id,
                taskId: task.id,
                recipientAgentId: null,
              })
            }
          >
            <T>Stop task</T>
          </Button>
        )}
        {actions.includes("resume") && (
          <Button
            size="sm"
            disabled={disabled}
            onClick={() =>
              void controller.act({
                operation: "channel.resume",
                channelId: channel.id,
                taskId: task.id,
                recipientAgentId: null,
              })
            }
          >
            <T>Resume task</T>
          </Button>
        )}
        {actions.includes("cancel") && (
          <Button
            variant="destructive"
            size="sm"
            disabled={disabled}
            onClick={() => {
              void confirm(
                gt(
                  "Cancel this task's run and all of its delegated tasks? The conversation stays available.",
                ),
              ).then((approved) => {
                if (approved)
                  void controller.act({
                    operation: "channel.cancel",
                    channelId: channel.id,
                    taskId: task.id,
                    recipientAgentId: null,
                  });
              });
            }}
          >
            <T>Cancel run</T>
          </Button>
        )}
      </div>
      {actions.includes("reassign") && (
        <div className="space-y-2">
          <Choice
            label={gt("Reassign task to")}
            value={assignee}
            options={options}
            empty="Choose a bot"
            disabled={disabled}
            onChange={setAssignee}
          />
          <Button
            variant="outline"
            size="sm"
            disabled={disabled || !assignee || !options.some((option) => option.id === assignee)}
            onClick={() => {
              if (assignee)
                void controller.act({
                  operation: "channel.reassign",
                  channelId: channel.id,
                  taskId: task.id,
                  recipientAgentId: assignee,
                });
            }}
          >
            <T>Reassign task</T>
          </Button>
        </div>
      )}
    </li>
  );
}
function ChannelsPanel({ environmentId, hostId, initialChannelId, initialTaskId }: Props) {
  const gt = useGT();
  const controller = useBotChannels(environmentId, hostId, randomUUID, initialChannelId);
  const [archived, setArchived] = useState(false);
  const [messageLimit, setMessageLimit] = useState(50);
  const [taskLimit, setTaskLimit] = useState(25);
  const channel = controller.channel;
  const members =
    channel?.members.flatMap((member) => {
      const agent = controller.agents.find((row) => row.id === member.agentId);
      return agent ? [{ id: agent.id, name: agent.name }] : [];
    }) ?? [];
  const disabled = controller.busy || !controller.canOperate;
  return (
    <div className="space-y-4" aria-busy={controller.busy}>
      <p className="text-sm text-muted-foreground">
        <T>
          Channels let bots share a conversation, coordinate assignments and hand work to each
          other.
        </T>
      </p>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" disabled={controller.busy} onClick={controller.refresh}>
          <T>Refresh channels</T>
        </Button>
        <Button
          size="sm"
          disabled={controller.busy || !controller.canManage || Boolean(controller.edit)}
          onClick={controller.create}
        >
          <T>New channel</T>
        </Button>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <Checkbox checked={archived} onCheckedChange={(checked) => setArchived(Boolean(checked))} />
        <span>
          <T>Show archived channels</T>
        </span>
      </label>
      {controller.loading && (
        <p role="status">
          <T>Loading channels…</T>
        </p>
      )}
      {controller.error && (
        <p role="alert" className="text-sm text-destructive">
          {controller.error}
        </p>
      )}
      {controller.notice && (
        <p role="status" className="text-sm">
          {controller.notice}
        </p>
      )}
      <ul className="space-y-2">
        {controller.channels
          ?.filter((item) => item.archived === archived)
          .map((item) => (
            <li key={item.id}>
              <Button
                variant={item.id === controller.selected ? "default" : "outline"}
                size="sm"
                disabled={controller.busy || Boolean(controller.edit)}
                onClick={() => {
                  controller.select(item.id);
                  setMessageLimit(50);
                  setTaskLimit(25);
                }}
              >
                <T>
                  <Var>{item.name}</Var> · <Var>{item.activeTasks}</Var> running ·{" "}
                  <Var>{item.unreadCount}</Var> unread
                </T>
              </Button>
            </li>
          ))}
      </ul>
      {controller.channels?.filter((item) => item.archived === archived).length === 0 && (
        <p className="text-sm text-muted-foreground">
          {archived ? gt("No archived channels.") : gt("No channels yet.")}
        </p>
      )}
      <ChannelSettings controller={controller} />
      {channel && (
        <div className="space-y-4">
          {(controller.recipient ?? channel.leadAgentId) && (
            <BotChannelGrants
              key={`${environmentId}:${hostId}:${channel.id}:${controller.recipient ?? channel.leadAgentId}`}
              environmentId={environmentId}
              hostId={hostId}
              channelId={channel.id}
              agentId={(controller.recipient ?? channel.leadAgentId)!}
            />
          )}
          <h3 className="text-base font-medium">
            {channel.name}
            {channel.archived ? gt(" · archived") : ""}
          </h3>
          {channel.title && <p className="text-sm">{channel.title}</p>}
          {channel.instructions && (
            <p className="whitespace-pre-wrap break-words text-sm text-muted-foreground">
              {channel.instructions}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={controller.busy || !controller.canManage || Boolean(controller.edit)}
              onClick={controller.editSettings}
            >
              <T>Edit channel</T>
            </Button>
            {channel.archived ? (
              <Button
                variant="outline"
                size="sm"
                disabled={controller.busy || !controller.canSettings}
                onClick={() =>
                  void controller.act({ operation: "channel.restore", channelId: channel.id })
                }
              >
                <T>Restore channel</T>
              </Button>
            ) : (
              <Button
                variant="outline"
                size="sm"
                disabled={disabled || Boolean(controller.edit)}
                onClick={() => {
                  void confirm(gt("Archive this channel? Running work will pause.")).then(
                    (approved) => {
                      if (approved)
                        void controller.act({
                          operation: "channel.archive",
                          channelId: channel.id,
                        });
                    },
                  );
                }}
              >
                <T>Archive channel</T>
              </Button>
            )}
            <Button
              variant="destructive"
              size="sm"
              disabled={disabled || Boolean(controller.edit)}
              onClick={() => {
                void confirm(
                  gt("Delete this channel and its history? Active work will stop."),
                ).then((approved) => {
                  if (approved)
                    void controller.act({ operation: "channel.delete", channelId: channel.id });
                });
              }}
            >
              <T>Delete channel</T>
            </Button>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={controller.busy || !controller.canSettings}
              onClick={() =>
                void controller.act({
                  operation: "channel.markRead",
                  channelId: channel.id,
                  throughSequence: controller.throughSequence,
                })
              }
            >
              <T>Mark channel read</T>
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={
                controller.busy ||
                (controller.messages.length <= messageLimit && controller.olderCursor === null)
              }
              onClick={() => {
                if (controller.messages.length <= messageLimit) void controller.older();
                setMessageLimit(messageLimit + 100);
              }}
            >
              <T>Older messages</T>
            </Button>
          </div>
          <ol className="space-y-4">
            {controller.messages.slice(-messageLimit).map((message) => (
              <li key={message.id} className="space-y-1">
                <p className="text-xs text-muted-foreground">
                  {message.author.name} · {message.message.status}
                  {message.superseded ? gt(" · earlier attempt") : ""}
                </p>
                <p className="whitespace-pre-wrap break-words text-sm">{message.message.text}</p>
                {message.message.attachments?.map((attachment) => (
                  <p key={attachment.id} className="text-sm text-muted-foreground">
                    <T>
                      File: <Var>{attachment.name}</Var>
                    </T>
                  </p>
                ))}
                <Button
                  variant="outline"
                  size="sm"
                  disabled={disabled || channel.archived || Boolean(controller.edit)}
                  onClick={() => controller.setReply(message.id)}
                >
                  <T>Reply</T>
                </Button>
              </li>
            ))}
          </ol>
          {controller.reply && (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">
                <T>
                  Replying to:<Var> </Var>
                  <Var>
                    {controller.messages
                      .find((message) => message.id === controller.reply)
                      ?.message.text.slice(0, 160) ?? gt("an earlier message")}
                  </Var>
                </T>
              </p>
              <Button variant="outline" size="sm" onClick={() => controller.setReply(null)}>
                <T>Clear reply</T>
              </Button>
            </div>
          )}
          <Choice
            label={gt("Send to")}
            value={controller.recipient}
            options={members}
            empty="Lead or @mentions"
            disabled={disabled || channel.archived || Boolean(controller.edit)}
            onChange={controller.setRecipient}
          />
          <label className="block space-y-1 text-sm">
            <span>
              <T>Channel message</T>
            </span>
            <Textarea
              rows={4}
              value={controller.text}
              maxLength={100_000}
              disabled={disabled || channel.archived || Boolean(controller.edit)}
              onChange={(event) => controller.setText(event.target.value)}
            />
          </label>
          <Button
            size="sm"
            disabled={
              disabled || channel.archived || Boolean(controller.edit) || !controller.text.trim()
            }
            onClick={controller.send}
          >
            <T>Send to channel</T>
          </Button>
          <h3 className="text-base font-medium">
            <T>Tasks</T>
          </h3>
          <ul className="space-y-4">
            {controller.tasks
              .toSorted(
                (left, right) =>
                  Number(right.id === initialTaskId) - Number(left.id === initialTaskId),
              )
              .slice(0, taskLimit)
              .map((task) => (
                <TaskRow key={task.id} controller={controller} task={task} />
              ))}
          </ul>
          {controller.tasks.length > taskLimit && (
            <Button variant="outline" size="sm" onClick={() => setTaskLimit(taskLimit + 25)}>
              <T>Show more tasks</T>
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
