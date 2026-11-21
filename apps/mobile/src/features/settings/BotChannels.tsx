import { BotChannelGrants } from "./BotChannelGrants";
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
import { m } from "../../i18n/messages";
import { T, Var, msg, useGT } from "gt-react-native";

type Props = {
  environmentId: EnvironmentId;
  hostId: string;
  initialChannelId?: string;
  initialTaskId?: string;
  defaultExpanded?: boolean;
  createOnOpen?: boolean;
  onCreated?: (channelId: string, name: string) => void;
  onCancelCreation?: () => void;
};
type Controller = ReturnType<typeof useBotChannels>;
export function BotChannels(props: Props) {
  const gt = useGT();
  const [expanded, setExpanded] = useState(
    props.defaultExpanded || props.initialChannelId !== undefined,
  );
  if (props.createOnOpen) return <ChannelsPanel {...props} />;
  return (
    <View className="gap-3">
      <Button
        label={expanded ? gt("Close channels") : gt("Channels")}
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
    { text: m(msg("Cancel")), style: "cancel" },
    { text: m(msg("Continue")), style: "destructive", onPress: action },
  ]);
}
function ChannelSettings({
  controller,
  onDiscard,
}: {
  controller: Controller;
  onDiscard?: () => void;
}) {
  const gt = useGT();
  const edit = controller.edit;
  if (!edit) return null;
  const visible = new Set(controller.agents.map((agent) => agent.id));
  const members = new Set(edit.value.members.map((member) => member.agentId));
  const unavailable = edit.value.members.filter((member) => !visible.has(member.agentId));
  const disabled = controller.busy || !controller.canManage;
  return (
    <View className="gap-3">
      <Text accessibilityRole="header" className="font-t3-medium">
        {edit.update ? gt("Channel settings") : gt("New channel")}
      </Text>
      <View className="gap-2">
        <Text>
          <T>Channel name</T>
        </Text>
        <AppTextInput
          accessibilityLabel={gt("Channel name")}
          value={edit.value.name}
          maxLength={80}
          editable={!disabled}
          onChangeText={(name) => controller.setEdit({ ...edit, value: { ...edit.value, name } })}
          className="rounded-xl border border-border bg-grouped-card p-3 text-foreground"
        />
      </View>
      <View className="gap-2">
        <Text>
          <T>Title</T>
        </Text>
        <AppTextInput
          accessibilityLabel={gt("Title")}
          value={edit.value.title}
          maxLength={120}
          editable={!disabled}
          onChangeText={(title) => controller.setEdit({ ...edit, value: { ...edit.value, title } })}
          className="rounded-xl border border-border bg-grouped-card p-3 text-foreground"
        />
      </View>
      <View className="gap-2">
        <Text>
          <T>Shared instructions</T>
        </Text>
        <AppTextInput
          accessibilityLabel={gt("Shared instructions")}
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
      <Text className="font-t3-medium">
        <T>Member bots</T>
      </Text>
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
          <T>
            <Var>{unavailable.length}</Var> unlisted{" "}
            <Var>{unavailable.length === 1 ? gt("member is") : gt("members are")}</Var>
            <Var> </Var>
            retained. Changing visible members keeps them in this channel.
          </T>
        </Text>
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
      <Text className="text-foreground-muted">
        <T>
          Removing a member pauses its unfinished work. Messages use the lead, an @mention, or a
          selected recipient.
        </T>
      </Text>
      {controller.conflict && (
        <Text accessibilityRole="alert" className="text-danger">
          <T>
            The channel settings changed on the engine. Your draft is retained; discard it to load
            the current settings.
          </T>
        </Text>
      )}
      <Button
        label={edit.update ? gt("Save settings") : gt("Create channel")}
        disabled={disabled || controller.conflict || !edit.value.name.trim()}
        onPress={controller.save}
      />
      <Button
        label={gt("Discard draft")}
        disabled={controller.busy}
        onPress={onDiscard ?? (() => controller.setEdit(null))}
      />
    </View>
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
    <View className="gap-2">
      <Text className="font-t3-medium">
        {task.ownerAgentId
          ? (controller.agents.find((agent) => agent.id === task.ownerAgentId)?.name ??
            gt("Unlisted bot"))
          : gt("Waiting for assignment")}{" "}
        · {task.state}
      </Text>
      <Text selectable>{task.instruction}</Text>
      {task.dependencies.length > 0 && (
        <Text className="text-foreground-muted">
          <T>
            Depends on <Var>{task.dependencies.length}</Var>{" "}
            <Var>{task.dependencies.length === 1 ? "task" : "tasks"}</Var>.
          </T>
        </Text>
      )}
      {task.error && (
        <Text selectable className="text-danger">
          {task.error}
        </Text>
      )}
      {actions.includes("stop") && (
        <Button
          label={gt("Stop task")}
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
          label={gt("Resume task")}
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
          label={gt("Cancel run")}
          tone="danger"
          disabled={disabled}
          onPress={() =>
            confirm(
              gt("Cancel this run?"),
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
            label={gt("Reassign task to")}
            value={assignee}
            options={options}
            empty="Choose a bot"
            disabled={disabled}
            onChange={setAssignee}
          />
          <Button
            label={gt("Reassign task")}
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
function ChannelsPanel({
  environmentId,
  hostId,
  initialChannelId,
  initialTaskId,
  createOnOpen,
  onCreated,
  onCancelCreation,
}: Props) {
  const gt = useGT();
  const controller = useBotChannels(environmentId, hostId, Crypto.randomUUID, initialChannelId, {
    createOnOpen,
    onCreated,
  });
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
  if (createOnOpen)
    return (
      <View className="gap-4">
        {controller.error && (
          <Text accessibilityRole="alert" className="text-danger">
            {controller.error}
          </Text>
        )}
        <ChannelSettings controller={controller} onDiscard={onCancelCreation} />
      </View>
    );
  return (
    <View className="gap-4">
      <Text className="text-foreground-muted">
        <T>
          Channels let bots share a conversation, coordinate assignments and hand work to each
          other.
        </T>
      </Text>
      <Button
        label={gt("Refresh channels")}
        disabled={controller.busy}
        onPress={controller.refresh}
      />
      <Button
        label={gt("New channel")}
        disabled={controller.busy || !controller.canManage || Boolean(controller.edit)}
        onPress={controller.create}
      />
      <View className="flex-row items-center justify-between gap-3">
        <Text>
          <T>Show archived channels</T>
        </Text>
        <Switch
          accessibilityLabel={gt("Show archived channels")}
          value={archived}
          onValueChange={setArchived}
        />
      </View>
      {controller.loading && (
        <Text accessibilityLiveRegion="polite">
          <T>Loading channels…</T>
        </Text>
      )}
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
            label={gt("{name} · {activeTasks} running · {unreadCount} unread", {
              name: item.name,
              activeTasks: item.activeTasks,
              unreadCount: item.unreadCount,
            })}
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
          {archived ? gt("No archived channels.") : gt("No channels yet.")}
        </Text>
      )}
      <ChannelSettings controller={controller} />
      {channel && (
        <View className="gap-4">
          {(controller.recipient ?? channel.leadAgentId) && (
            <BotChannelGrants
              key={`${environmentId}:${hostId}:${channel.id}:${controller.recipient ?? channel.leadAgentId}`}
              environmentId={environmentId}
              hostId={hostId}
              channelId={channel.id}
              agentId={(controller.recipient ?? channel.leadAgentId)!}
            />
          )}
          <Text accessibilityRole="header" className="font-t3-medium">
            {channel.name}
            {channel.archived ? gt(" · archived") : ""}
          </Text>
          {channel.title && <Text>{channel.title}</Text>}
          {channel.instructions && (
            <Text selectable className="text-foreground-muted">
              {channel.instructions}
            </Text>
          )}
          <Button
            label={gt("Edit channel")}
            disabled={controller.busy || !controller.canManage || Boolean(controller.edit)}
            onPress={controller.editSettings}
          />
          {channel.archived ? (
            <Button
              label={gt("Restore channel")}
              disabled={controller.busy || !controller.canSettings}
              onPress={() =>
                void controller.act({ operation: "channel.restore", channelId: channel.id })
              }
            />
          ) : (
            <Button
              label={gt("Archive channel")}
              disabled={disabled || Boolean(controller.edit)}
              onPress={() =>
                confirm(
                  gt("Archive channel?"),
                  "Running work will pause.",
                  () =>
                    void controller.act({ operation: "channel.archive", channelId: channel.id }),
                )
              }
            />
          )}
          <Button
            label={gt("Delete channel")}
            tone="danger"
            disabled={disabled || Boolean(controller.edit)}
            onPress={() =>
              confirm(
                gt("Delete channel?"),
                "This deletes its history and stops active work.",
                () => void controller.act({ operation: "channel.delete", channelId: channel.id }),
              )
            }
          />
          <Button
            label={gt("Mark channel read")}
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
            label={gt("Older messages")}
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
                {message.superseded ? gt(" · earlier attempt") : ""}
              </Text>
              <Text selectable>{message.message.text}</Text>
              {message.message.attachments?.map((attachment) => (
                <Text key={attachment.id} className="text-foreground-muted">
                  <T>
                    File: <Var>{attachment.name}</Var>
                  </T>
                </Text>
              ))}
              <Button
                label={gt("Reply")}
                disabled={disabled || channel.archived || Boolean(controller.edit)}
                onPress={() => controller.setReply(message.id)}
              />
            </View>
          ))}
          {controller.reply && (
            <View className="gap-2">
              <Text className="text-foreground-muted">
                <T>
                  Replying to:<Var> </Var>
                  <Var>
                    {controller.messages
                      .find((message) => message.id === controller.reply)
                      ?.message.text.slice(0, 160) ?? gt("an earlier message")}
                  </Var>
                </T>
              </Text>
              <Button label={gt("Clear reply")} onPress={() => controller.setReply(null)} />
            </View>
          )}
          <Choice
            label={gt("Send to")}
            value={controller.recipient}
            options={members}
            empty="Lead or @mentions"
            disabled={disabled || channel.archived || Boolean(controller.edit)}
            onChange={controller.setRecipient}
          />
          <View className="gap-2">
            <Text>
              <T>Channel message</T>
            </Text>
            <AppTextInput
              accessibilityLabel={gt("Channel message")}
              value={controller.text}
              multiline
              maxLength={100_000}
              editable={!disabled && !channel.archived && !controller.edit}
              onChangeText={controller.setText}
              className="rounded-xl border border-border bg-grouped-card p-3 text-foreground"
            />
          </View>
          <Button
            label={gt("Send to channel")}
            disabled={
              disabled || channel.archived || Boolean(controller.edit) || !controller.text.trim()
            }
            onPress={() => void controller.send()}
          />
          <Text accessibilityRole="header" className="font-t3-medium">
            <T>Tasks</T>
          </Text>
          {[...controller.tasks]
            .sort(
              (left, right) =>
                Number(right.id === initialTaskId) - Number(left.id === initialTaskId),
            )
            .slice(0, taskLimit)
            .map((task) => (
              <TaskRow key={task.id} controller={controller} task={task} />
            ))}
          {controller.tasks.length > taskLimit && (
            <Button label={gt("Show more tasks")} onPress={() => setTaskLimit(taskLimit + 25)} />
          )}
        </View>
      )}
    </View>
  );
}
