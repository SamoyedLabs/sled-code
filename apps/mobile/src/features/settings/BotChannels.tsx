import { useState } from "react";
import { Switch, View } from "react-native";
import * as Crypto from "expo-crypto";
import type { EnvironmentId, OpenbotChannelTask } from "@t3tools/contracts";
import {
  channelSetVisibleMembers,
  channelTaskActions,
} from "@t3tools/client-runtime/openbot/presentation";
import { useBotChannels } from "./useBotChannels";
import { Picker } from "./BotConnectionControls";
import { Button } from "../../components/ui/Button";
import { AppText as Text, AppTextInput } from "../../components/ui/AppText";
import * as Dialog from "../../components/ui/Dialog";

type Props = { environmentId: EnvironmentId; hostId: string };
type Controller = ReturnType<typeof useBotChannels>;
export function BotChannels(props: Props) {
  const [expanded, setExpanded] = useState(false);
  return (
    <View className="gap-3">
      <Button
        label={expanded ? "Close channels" : "Channels"}
        onPress={() => setExpanded(!expanded)}
      />
      {expanded && <ChannelsPanel key={`${props.environmentId}:${props.hostId}`} {...props} />}
    </View>
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
    <Picker
      label={label}
      value={value ?? "__none"}
      options={[{ id: "__none", name: empty }, ...options]}
      disabled={disabled}
      onChange={(next) => onChange(next === "__none" ? null : next)}
    />
  );
}
function confirm(title: string, message: string, action: () => void) {
  Dialog.alert(title, message, [
    { text: "Cancel", style: "cancel" },
    { text: "Continue", style: "destructive", onPress: action },
  ]);
}
function ChannelSettings({ controller }: { controller: Controller }) {
  const edit = controller.edit;
  if (!edit) return null;
  const visible = new Set(controller.agents.map((agent) => agent.id));
  const members = new Set(edit.value.members.map((member) => member.agentId));
  const unavailable = edit.value.members.filter((member) => !visible.has(member.agentId));
  const disabled = controller.busy || !controller.canManage;
  return (
    <View className="gap-3">
      <Text accessibilityRole="header" className="font-t3-medium">
        {edit.update ? "Channel settings" : "New channel"}
      </Text>
      <View className="gap-2">
        <Text>Channel name</Text>
        <AppTextInput
          accessibilityLabel="Channel name"
          value={edit.value.name}
          maxLength={80}
          editable={!disabled}
          onChangeText={(name) => controller.setEdit({ ...edit, value: { ...edit.value, name } })}
          className="rounded-xl border border-border bg-grouped-card p-3 text-foreground"
        />
      </View>
      <View className="gap-2">
        <Text>Title</Text>
        <AppTextInput
          accessibilityLabel="Title"
          value={edit.value.title}
          maxLength={120}
          editable={!disabled}
          onChangeText={(title) => controller.setEdit({ ...edit, value: { ...edit.value, title } })}
          className="rounded-xl border border-border bg-grouped-card p-3 text-foreground"
        />
      </View>
      <View className="gap-2">
        <Text>Shared instructions</Text>
        <AppTextInput
          accessibilityLabel="Shared instructions"
          value={edit.value.instructions}
          multiline
          maxLength={2_000}
          editable={!disabled}
          onChangeText={(instructions) =>
            controller.setEdit({ ...edit, value: { ...edit.value, instructions } })
          }
          className="rounded-xl border border-border bg-grouped-card p-3 text-foreground"
        />
      </View>
      <Text className="font-t3-medium">Member bots</Text>
      {controller.agents.map((agent) => (
        <View key={agent.id} className="flex-row items-center justify-between gap-3">
          <Text>{agent.name}</Text>
          <Switch
            accessibilityLabel={agent.name}
            value={members.has(agent.id)}
            disabled={disabled}
            onValueChange={(checked) =>
              controller.setEdit(
                channelSetVisibleMembers(
                  edit,
                  visible,
                  checked ? [...members, agent.id] : [...members].filter((id) => id !== agent.id),
                ),
              )
            }
          />
        </View>
      ))}
      {unavailable.length > 0 && (
        <Text className="text-foreground-muted">
          {unavailable.length} unlisted {unavailable.length === 1 ? "member is" : "members are"}{" "}
          retained. Changing visible members keeps them in this channel.
        </Text>
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
      <Text className="text-foreground-muted">
        Removing a member pauses its unfinished work. Messages use the lead, an @mention, or a
        selected recipient.
      </Text>
      {controller.conflict && (
        <Text accessibilityRole="alert" className="text-danger">
          The channel settings changed on the engine. Your draft is retained; discard it to load the
          current settings.
        </Text>
      )}
      <Button
        label={edit.update ? "Save settings" : "Create channel"}
        disabled={disabled || controller.conflict || !edit.value.name.trim()}
        onPress={controller.save}
      />
      <Button
        label="Discard draft"
        disabled={controller.busy}
        onPress={() => controller.setEdit(null)}
      />
    </View>
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
    <View className="gap-2">
      <Text className="font-t3-medium">
        {task.ownerAgentId
          ? (controller.agents.find((agent) => agent.id === task.ownerAgentId)?.name ??
            "Unlisted bot")
          : "Waiting for assignment"}{" "}
        · {task.state}
      </Text>
      <Text selectable>{task.instruction}</Text>
      {task.dependencies.length > 0 && (
        <Text className="text-foreground-muted">
          Depends on {task.dependencies.length} {task.dependencies.length === 1 ? "task" : "tasks"}.
        </Text>
      )}
      {task.error && (
        <Text selectable className="text-danger">
          {task.error}
        </Text>
      )}
      {actions.includes("stop") && (
        <Button
          label="Stop task"
          disabled={disabled}
          onPress={() =>
            void controller.act({
              operation: "channel.stop",
              channelId: channel.id,
              taskId: task.id,
              recipientAgentId: null,
            })
          }
        />
      )}
      {actions.includes("resume") && (
        <Button
          label="Resume task"
          disabled={disabled}
          onPress={() =>
            void controller.act({
              operation: "channel.resume",
              channelId: channel.id,
              taskId: task.id,
              recipientAgentId: null,
            })
          }
        />
      )}
      {actions.includes("cancel") && (
        <Button
          label="Cancel run"
          tone="danger"
          disabled={disabled}
          onPress={() =>
            confirm(
              "Cancel this run?",
              "This cancels the task's root run and its delegated tasks. The conversation stays available.",
              () =>
                void controller.act({
                  operation: "channel.cancel",
                  channelId: channel.id,
                  taskId: task.id,
                  recipientAgentId: null,
                }),
            )
          }
        />
      )}
      {actions.includes("reassign") && (
        <View className="gap-2">
          <Choice
            label="Reassign task to"
            value={assignee}
            options={options}
            empty="Choose a bot"
            disabled={disabled}
            onChange={setAssignee}
          />
          <Button
            label="Reassign task"
            disabled={disabled || !assignee || !options.some((option) => option.id === assignee)}
            onPress={() => {
              if (assignee)
                void controller.act({
                  operation: "channel.reassign",
                  channelId: channel.id,
                  taskId: task.id,
                  recipientAgentId: assignee,
                });
            }}
          />
        </View>
      )}
    </View>
  );
}
function ChannelsPanel({ environmentId, hostId }: Props) {
  const controller = useBotChannels(environmentId, hostId, Crypto.randomUUID);
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
    <View className="gap-4">
      <Text className="text-foreground-muted">
        Channels let bots share a conversation, coordinate assignments and hand work to each other.
      </Text>
      <Button label="Refresh channels" disabled={controller.busy} onPress={controller.refresh} />
      <Button
        label="New channel"
        disabled={controller.busy || !controller.canManage || Boolean(controller.edit)}
        onPress={controller.create}
      />
      <View className="flex-row items-center justify-between gap-3">
        <Text>Show archived channels</Text>
        <Switch
          accessibilityLabel="Show archived channels"
          value={archived}
          onValueChange={setArchived}
        />
      </View>
      {controller.loading && <Text accessibilityLiveRegion="polite">Loading channels…</Text>}
      {controller.error && (
        <Text accessibilityRole="alert" className="text-danger">
          {controller.error}
        </Text>
      )}
      {controller.notice && <Text accessibilityLiveRegion="polite">{controller.notice}</Text>}
      {controller.channels
        ?.filter((item) => item.archived === archived)
        .map((item) => (
          <Button
            key={item.id}
            label={`${item.name} · ${item.activeTasks} running · ${item.unreadCount} unread`}
            tone={item.id === controller.selected ? "primary" : "secondary"}
            disabled={controller.busy || Boolean(controller.edit)}
            onPress={() => {
              controller.select(item.id);
              setMessageLimit(50);
              setTaskLimit(25);
            }}
          />
        ))}
      {controller.channels?.filter((item) => item.archived === archived).length === 0 && (
        <Text className="text-foreground-muted">
          {archived ? "No archived channels." : "No channels yet."}
        </Text>
      )}
      <ChannelSettings controller={controller} />
      {channel && (
        <View className="gap-4">
          <Text accessibilityRole="header" className="font-t3-medium">
            {channel.name}
            {channel.archived ? " · archived" : ""}
          </Text>
          {channel.title && <Text>{channel.title}</Text>}
          {channel.instructions && (
            <Text selectable className="text-foreground-muted">
              {channel.instructions}
            </Text>
          )}
          <Button
            label="Edit channel"
            disabled={controller.busy || !controller.canManage || Boolean(controller.edit)}
            onPress={controller.editSettings}
          />
          {channel.archived ? (
            <Button
              label="Restore channel"
              disabled={controller.busy || !controller.canSettings}
              onPress={() =>
                void controller.act({ operation: "channel.restore", channelId: channel.id })
              }
            />
          ) : (
            <Button
              label="Archive channel"
              disabled={disabled || Boolean(controller.edit)}
              onPress={() =>
                confirm(
                  "Archive channel?",
                  "Running work will pause.",
                  () =>
                    void controller.act({ operation: "channel.archive", channelId: channel.id }),
                )
              }
            />
          )}
          <Button
            label="Delete channel"
            tone="danger"
            disabled={disabled || Boolean(controller.edit)}
            onPress={() =>
              confirm(
                "Delete channel?",
                "This deletes its history and stops active work.",
                () => void controller.act({ operation: "channel.delete", channelId: channel.id }),
              )
            }
          />
          <Button
            label="Mark channel read"
            disabled={controller.busy || !controller.canSettings}
            onPress={() =>
              void controller.act({
                operation: "channel.markRead",
                channelId: channel.id,
                throughSequence: controller.throughSequence,
              })
            }
          />
          <Button
            label="Older messages"
            disabled={
              controller.busy ||
              (controller.messages.length <= messageLimit && controller.olderCursor === null)
            }
            onPress={() => {
              if (controller.messages.length <= messageLimit) void controller.older();
              setMessageLimit(messageLimit + 100);
            }}
          />
          {controller.messages.slice(-messageLimit).map((message) => (
            <View key={message.id} className="gap-1">
              <Text className="text-foreground-muted">
                {message.author.name} · {message.message.status}
                {message.superseded ? " · earlier attempt" : ""}
              </Text>
              <Text selectable>{message.message.text}</Text>
              {message.message.attachments?.map((attachment) => (
                <Text key={attachment.id} className="text-foreground-muted">
                  File: {attachment.name}
                </Text>
              ))}
              <Button
                label="Reply"
                disabled={disabled || channel.archived || Boolean(controller.edit)}
                onPress={() => controller.setReply(message.id)}
              />
            </View>
          ))}
          {controller.reply && (
            <View className="gap-2">
              <Text className="text-foreground-muted">
                Replying to:{" "}
                {controller.messages
                  .find((message) => message.id === controller.reply)
                  ?.message.text.slice(0, 160) ?? "an earlier message"}
              </Text>
              <Button label="Clear reply" onPress={() => controller.setReply(null)} />
            </View>
          )}
          <Choice
            label="Send to"
            value={controller.recipient}
            options={members}
            empty="Lead or @mentions"
            disabled={disabled || channel.archived || Boolean(controller.edit)}
            onChange={controller.setRecipient}
          />
          <View className="gap-2">
            <Text>Channel message</Text>
            <AppTextInput
              accessibilityLabel="Channel message"
              value={controller.text}
              multiline
              maxLength={100_000}
              editable={!disabled && !channel.archived && !controller.edit}
              onChangeText={controller.setText}
              className="rounded-xl border border-border bg-grouped-card p-3 text-foreground"
            />
          </View>
          <Button
            label="Send to channel"
            disabled={
              disabled || channel.archived || Boolean(controller.edit) || !controller.text.trim()
            }
            onPress={controller.send}
          />
          <Text accessibilityRole="header" className="font-t3-medium">
            Tasks
          </Text>
          {controller.tasks.slice(0, taskLimit).map((task) => (
            <TaskRow key={task.id} controller={controller} task={task} />
          ))}
          {controller.tasks.length > taskLimit && (
            <Button label="Show more tasks" onPress={() => setTaskLimit(taskLimit + 25)} />
          )}
        </View>
      )}
    </View>
  );
}
