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

type Props = { environmentId: EnvironmentId; hostId: string };
type Controller = ReturnType<typeof useBotChannels>;
export function BotChannels(props: Props) {
  const [expanded, setExpanded] = useState(false);
  return (
    <section aria-label="Bot channels" className="space-y-3">
      <Button
        variant="outline"
        size="sm"
        aria-expanded={expanded}
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? "Close channels" : "Channels"}
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
  const edit = controller.edit;
  if (!edit) return null;
  const visible = new Set(controller.agents.map((agent) => agent.id));
  const members = new Set(edit.value.members.map((member) => member.agentId));
  const unavailable = edit.value.members.filter((member) => !visible.has(member.agentId));
  const disabled = controller.busy || !controller.canManage;
  return (
    <div className="space-y-3">
      <h3 className="text-base font-medium">{edit.update ? "Channel settings" : "New channel"}</h3>
      <label className="block space-y-1 text-sm">
        <span>Channel name</span>
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
        <span>Title</span>
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
        <span>Shared instructions</span>
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
        <legend className="text-sm">Member bots</legend>
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
          {unavailable.length} unlisted {unavailable.length === 1 ? "member is" : "members are"}{" "}
          retained. Changing visible members keeps them in this channel.
        </p>
      )}
      <Choice
        label="Lead bot"
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
        Removing a member pauses its unfinished work. Messages use the lead, an @mention, or a
        selected recipient.
      </p>
      {controller.conflict && (
        <p role="alert" className="text-sm text-destructive">
          The channel settings changed on the engine. Your draft is retained; discard it to load the
          current settings.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          disabled={disabled || controller.conflict || !edit.value.name.trim()}
          onClick={controller.save}
        >
          {edit.update ? "Save settings" : "Create channel"}
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={controller.busy}
          onClick={() => controller.setEdit(null)}
        >
          Discard draft
        </Button>
      </div>
    </div>
  );
}
function TaskRow({ controller, task }: { controller: Controller; task: OpenbotChannelTask }) {
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
            "Unlisted bot")
          : "Waiting for assignment"}{" "}
        · {task.state}
      </p>
      <p className="whitespace-pre-wrap break-words text-sm">{task.instruction}</p>
      {task.dependencies.length > 0 && (
        <p className="text-sm text-muted-foreground">
          Depends on {task.dependencies.length} {task.dependencies.length === 1 ? "task" : "tasks"}.
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
            Stop task
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
            Resume task
          </Button>
        )}
        {actions.includes("cancel") && (
          <Button
            variant="destructive"
            size="sm"
            disabled={disabled}
            onClick={() => {
              void confirm(
                "Cancel this task's run and all of its delegated tasks? The conversation stays available.",
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
            Cancel run
          </Button>
        )}
      </div>
      {actions.includes("reassign") && (
        <div className="space-y-2">
          <Choice
            label="Reassign task to"
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
            Reassign task
          </Button>
        </div>
      )}
    </li>
  );
}
function ChannelsPanel({ environmentId, hostId }: Props) {
  const controller = useBotChannels(environmentId, hostId, randomUUID);
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
        Channels let bots share a conversation, coordinate assignments and hand work to each other.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" disabled={controller.busy} onClick={controller.refresh}>
          Refresh channels
        </Button>
        <Button
          size="sm"
          disabled={controller.busy || !controller.canManage || Boolean(controller.edit)}
          onClick={controller.create}
        >
          New channel
        </Button>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <Checkbox checked={archived} onCheckedChange={(checked) => setArchived(Boolean(checked))} />
        <span>Show archived channels</span>
      </label>
      {controller.loading && <p role="status">Loading channels…</p>}
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
                {item.name} · {item.activeTasks} running · {item.unreadCount} unread
              </Button>
            </li>
          ))}
      </ul>
      {controller.channels?.filter((item) => item.archived === archived).length === 0 && (
        <p className="text-sm text-muted-foreground">
          {archived ? "No archived channels." : "No channels yet."}
        </p>
      )}
      <ChannelSettings controller={controller} />
      {channel && (
        <div className="space-y-4">
          <h3 className="text-base font-medium">
            {channel.name}
            {channel.archived ? " · archived" : ""}
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
              Edit channel
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
                Restore channel
              </Button>
            ) : (
              <Button
                variant="outline"
                size="sm"
                disabled={disabled || Boolean(controller.edit)}
                onClick={() => {
                  void confirm("Archive this channel? Running work will pause.").then(
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
                Archive channel
              </Button>
            )}
            <Button
              variant="destructive"
              size="sm"
              disabled={disabled || Boolean(controller.edit)}
              onClick={() => {
                void confirm("Delete this channel and its history? Active work will stop.").then(
                  (approved) => {
                    if (approved)
                      void controller.act({ operation: "channel.delete", channelId: channel.id });
                  },
                );
              }}
            >
              Delete channel
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
              Mark channel read
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
              Older messages
            </Button>
          </div>
          <ol className="space-y-4">
            {controller.messages.slice(-messageLimit).map((message) => (
              <li key={message.id} className="space-y-1">
                <p className="text-xs text-muted-foreground">
                  {message.author.name} · {message.message.status}
                  {message.superseded ? " · earlier attempt" : ""}
                </p>
                <p className="whitespace-pre-wrap break-words text-sm">{message.message.text}</p>
                {message.message.attachments?.map((attachment) => (
                  <p key={attachment.id} className="text-sm text-muted-foreground">
                    File: {attachment.name}
                  </p>
                ))}
                <Button
                  variant="outline"
                  size="sm"
                  disabled={disabled || channel.archived || Boolean(controller.edit)}
                  onClick={() => controller.setReply(message.id)}
                >
                  Reply
                </Button>
              </li>
            ))}
          </ol>
          {controller.reply && (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">
                Replying to:{" "}
                {controller.messages
                  .find((message) => message.id === controller.reply)
                  ?.message.text.slice(0, 160) ?? "an earlier message"}
              </p>
              <Button variant="outline" size="sm" onClick={() => controller.setReply(null)}>
                Clear reply
              </Button>
            </div>
          )}
          <Choice
            label="Send to"
            value={controller.recipient}
            options={members}
            empty="Lead or @mentions"
            disabled={disabled || channel.archived || Boolean(controller.edit)}
            onChange={controller.setRecipient}
          />
          <label className="block space-y-1 text-sm">
            <span>Channel message</span>
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
            Send to channel
          </Button>
          <h3 className="text-base font-medium">Tasks</h3>
          <ul className="space-y-4">
            {controller.tasks.slice(0, taskLimit).map((task) => (
              <TaskRow key={task.id} controller={controller} task={task} />
            ))}
          </ul>
          {controller.tasks.length > taskLimit && (
            <Button variant="outline" size="sm" onClick={() => setTaskLimit(taskLimit + 25)}>
              Show more tasks
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
