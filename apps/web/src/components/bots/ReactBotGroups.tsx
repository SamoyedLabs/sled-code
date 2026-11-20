import {
  BotMessageComposer,
  BotComposerInput,
  BotComposerFooter,
  BotComposerSend,
  BotComposerVoice,
  BotComposerVoiceStatus,
  BotComposerRecipient,
} from "../settings/BotMessageComposer";
import { ComposerControl } from "../chat/ComposerControl";
import { SourceModelPicker } from "./SourceProviderEnvironment";
import { useEnvironmentQuery } from "../../state/query";
import { openbot } from "../../state/openbot";
import { settingsCapabilities } from "@t3tools/client-runtime/openbot/settings";
import { SourceAgentAvatarHost } from "./SourceAgentAvatar";
import { GroupPictureEditor } from "./upstream/channels/GroupPictureEditor";
import { useSourceChatVirtualizer } from "./upstream/conversation/useSourceChatVirtualizer";
import { useBotAutoRead } from "./upstream/conversation/useBotAutoRead";
import {
  SourceChatScrollRail,
  UnreadMessagesBanner,
  UnreadMessagesDivider,
  ScrollToLatestButton,
  useNewMessageTally,
  type ChatScrollSection,
} from "./upstream/conversation/SourceChatNavigation";
/* oxlint-disable shadcn/no-unknown-classes -- Source OpenBot conversation selectors are provided by the imported feature CSS. */
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { writeTextToClipboard } from "../../hooks/useCopyToClipboard";
import { BotComposerEditor, type BotComposerEditorHandle } from "../settings/BotComposerEditor";
import { BotStreamingMessage } from "../settings/BotStreamingMessage";
import { BotToolActivity } from "./BotToolActivity";
import { BotTypingIndicator } from "./BotTypingIndicator";
import { BotMessageFiles } from "./BotMessageFiles";
import { BotGroupRichMessage, BotGroupRequests } from "./BotGroupRichMessage";
import { BotFiles } from "../settings/BotFiles";
import type { EnvironmentId, OpenbotChannelTask } from "@t3tools/contracts";
import {
  channelSetVisibleMembers,
  channelTaskActions,
} from "@t3tools/client-runtime/openbot/presentation";
import {
  CheckCheckIcon,
  PlusIcon,
  RefreshCwIcon,
  SearchIcon,
  UsersIcon,
  PanelRightIcon,
  XIcon,
  ReplyIcon,
  FolderIcon,
  ListTodoIcon,
  CopyIcon,
  CheckIcon,
} from "lucide-react";
import { randomUUID, cn } from "../../lib/utils";
import { requestConfirmDialog } from "../../confirmDialog";
import { useBotChannels } from "../settings/useBotChannels";
import { BotChannelGrants } from "../settings/BotChannelGrants";
import { BotChannelExtras } from "../settings/BotChannelExtras";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import { Checkbox } from "../ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { BotAvatar } from "./avatar/BotAvatar";

import { GroupAvatar } from "./GroupAvatar";
import { GroupSidePanel } from "./GroupSidePanel";
import { GroupCommentarySteps } from "./GroupCommentarySteps";
import {
  continuesGroupSender,
  groupWorkerIds,
  stoppedGroupRuns,
  groupDayMarker,
  projectGroupCommentary,
} from "./group-conversation";
import { COLOR_BY_ID } from "./avatar/vendor/bloub-engine";
import { botAvatarProfile } from "./avatar/avatar-profile";
import { useBotDictation } from "../settings/BotDictation";
import { Menu, MenuTrigger, MenuItem } from "../ui/menu";
import { MenuPopup } from "./upstream/OpenbotMenu";
import { OpenbotSlidingTabs } from "./upstream/OpenbotSlidingTabs";
import "../settings/bot-conversation.css";
import "./group-conversation.css";

type Props = {
  environmentId: EnvironmentId;
  hostId: string;
  initialChannelId?: string;
  initialTaskId?: string;
  initialCreate?: boolean;
  embedded?: boolean;
  onSelectAgent?: ((agentId: string) => void) | undefined;
};
type Controller = ReturnType<typeof useBotChannels>;
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
          <SelectValue>{options.find((option) => option.id === value)?.name ?? empty}</SelectValue>
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
      <h3 className="text-base font-medium">{edit.update ? "Group settings" : "New group"}</h3>
      <label className="block space-y-1 text-sm">
        <span>Group name</span>
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
          retained. Changing visible members keeps them in this group.
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
          The group settings changed. Your draft is retained; discard it to load the current
          settings.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          disabled={disabled || controller.conflict || !edit.value.name.trim()}
          onClick={controller.save}
        >
          {edit.update ? "Save settings" : "Create group"}
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

const PANEL_TABS = [
  { value: "Files", label: "Files" },
  { value: "Tasks", label: "Tasks" },
] as const;

export function ReactBotGroups(props: Props) {
  return (
    <SourceAgentAvatarHost environmentId={props.environmentId} hostId={props.hostId}>
      <GroupWorkspace key={JSON.stringify([props.environmentId, props.hostId])} {...props} />
    </SourceAgentAvatarHost>
  );
}
function GroupWorkspace({
  environmentId,
  hostId,
  initialChannelId,
  initialTaskId,
  initialCreate = false,
  embedded = false,
  onSelectAgent,
}: Props) {
  const traceCompatibility = useEnvironmentQuery(
    openbot.readFromHost({
      environmentId,
      input: { hostId, request: { operation: "compatibility.read" } },
    }),
  );
  const supportsFullTrace = settingsCapabilities(traceCompatibility.data).includes(
    "sled-channel-trace-v1",
  );
  const c = useBotChannels(environmentId, hostId, randomUUID, initialChannelId, initialCreate);
  const [search, setSearch] = useState("");
  const [archived, setArchived] = useState(false);
  const [view, setView] = useState<"Chat" | "Tasks" | "Files" | "Settings">(
    initialCreate ? "Settings" : initialTaskId ? "Tasks" : "Chat",
  );
  const [messageLimit, setMessageLimit] = useState(50);
  const [taskLimit, setTaskLimit] = useState(25);
  const scroller = useRef<HTMLDivElement>(null);
  const editor = useRef<BotComposerEditorHandle>(null);
  const [copyError, setCopyError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const stickBottom = useRef(true);
  const olderPosition = useRef<{ height: number; top: number } | null>(null);
  const channel = c.channel;
  const voice = useBotDictation(
    `${environmentId}:${hostId}:channel:${channel?.id ?? "new"}`,
    c.text,
    c.setText,
  );
  const channelSummary = channel
    ? {
        ...c.channels?.find((item) => item.id === channel.id),
        ...channel,
        unreadCount: 0,
        activeTasks: c.tasks.length,
        lastMessage: null,
      }
    : null;
  const disabled = c.busy || !c.canOperate;
  const composeDisabled = disabled || !channel || channel.archived || Boolean(c.edit) || voice.busy;
  const members =
    channel?.members.flatMap((member) => {
      const agent = c.agents.find((row) => row.id === member.agentId);
      return agent ? [{ id: agent.id, name: agent.name }] : [];
    }) ?? [];
  const groups = c.channels?.filter(
    (item) =>
      item.archived === archived &&
      item.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
  );
  const editorAgentId = c.recipient ?? channel?.leadAgentId ?? channel?.members[0]?.agentId;
  const projection = projectGroupCommentary(c.messages);
  const [unreadTarget, setUnreadTarget] = useState<{ channelId: string; id: string } | null>(null);
  const unreadJumped = useRef<string | null>(null);
  const unreadIndex =
    unreadTarget?.channelId === channel?.id
      ? projection.rows.findIndex((item) => item.id === unreadTarget?.id)
      : -1;
  const messages = projection.rows.slice(
    -Math.max(messageLimit, unreadIndex >= 0 ? projection.rows.length - unreadIndex : 0),
  );
  const virtualRoot = useRef<HTMLOListElement>(null);
  const virtual = useSourceChatVirtualizer<HTMLDivElement, HTMLLIElement>(
    scroller,
    virtualRoot,
    messages.map((message) => message.id),
    stickBottom,
  );
  const [awayFromLatest, setAwayFromLatest] = useState(false);
  useBotAutoRead({
    identity: JSON.stringify([environmentId, hostId, channel?.id]),
    scroller,
    watermark: channel ? String(c.throughSequence) : null,
    unread: c.channels?.find((item) => item.id === channel?.id)?.unreadCount ?? 0,
    enabled:
      Boolean(channel) &&
      view === "Chat" &&
      !c.edit &&
      c.canOperate &&
      !c.busy &&
      !c.loading &&
      !c.hasNewer &&
      c.messages.at(-1)?.message.status !== "streaming",
    onRead: (through) => {
      void c.markReadThrough(Number(through));
    },
  });
  const tally = useNewMessageTally(
    projection.rows.map((row) => ({
      id: row.id,
      countable:
        row.author.kind !== "member" &&
        Boolean(
          row.message.text.trim() ||
          row.message.attachments?.length ||
          row.message.uiBlock ||
          row.message.questionPrompt,
        ),
    })),
    !awayFromLatest,
  );
  const railSections: ChatScrollSection[] = messages.flatMap((message, row) =>
    message.author.kind === "member" && message.message.text.trim()
      ? [
          {
            key: message.id,
            label: message.message.text.replace(/\s+/g, " ").slice(0, 160),
            row,
            start: virtual.virtualized ? virtual.instance.measurementsCache[row]?.start : undefined,
          },
        ]
      : [],
  );
  if (projection.rows.length > messageLimit || c.olderCursor !== null)
    railSections.unshift({ key: "", label: "Earlier messages", start: 0 });

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- A read-only unread jump may load a page; scroll only after its original row enters the current virtualized timeline.
  useEffect(() => {
    if (
      !unreadTarget ||
      unreadTarget.channelId !== channel?.id ||
      unreadJumped.current === `${unreadTarget.channelId}:${unreadTarget.id}`
    )
      return;
    const row = messages.findIndex((message) => message.id === unreadTarget.id);
    if (row < 0) return;
    virtual.instance.scrollToIndex(row, { align: "start" });
    unreadJumped.current = `${unreadTarget.channelId}:${unreadTarget.id}`;
  }, [unreadTarget, channel?.id, messages, virtual.instance]);
  const [revealedStep, setRevealedStep] = useState<{ id: string } | null>(null);
  const lastText = c.messages.at(-1)?.message.text;
  const workers =
    channel && !channel.archived ? groupWorkerIds(c.tasks, c.messages, channel.leadAgentId) : [];
  const stopped = channel && !channel.archived ? stoppedGroupRuns(c.tasks) : [];
  const pane = Boolean(c.edit) || view !== "Chat";
  const agentColor = (id: string) => {
    const agent = c.agents.find((item) => item.id === id);
    return COLOR_BY_ID.get(
      botAvatarProfile(agent?.avatarSeed ?? id, agent?.avatarHue ?? null).color,
    )?.hex;
  };
  const submit = () => {
    if (!composeDisabled && c.text.trim()) {
      stickBottom.current = true;
      c.send();
    }
  };
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Keep the transcript pinned only while the reader remains at the bottom, preserving an older-history anchor.
  useEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const previous = olderPosition.current;
    if (previous) {
      element.scrollTop = previous.top + element.scrollHeight - previous.height;
      olderPosition.current = null;
    } else if (stickBottom.current) element.scrollTop = element.scrollHeight;
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- Each transcript revision can change DOM height even when the scroller instance stays the same.
  }, [channel?.id, c.messages.length, lastText, messageLimit]);
  return (
    <section aria-label="Groups" className="ob-groups" aria-busy={c.busy}>
      {!embedded && (
        <aside className="flex w-56 shrink-0 flex-col border-r bg-muted/15 max-sm:w-40">
          <div className="flex h-14 items-center justify-between px-4">
            <h2 className="text-sm font-semibold">Groups</h2>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="New group"
              disabled={c.busy || !c.canManage || Boolean(c.edit)}
              onClick={() => {
                c.create();
                setView("Settings");
              }}
            >
              <PlusIcon aria-hidden="true" />
            </Button>
          </div>
          <div className="px-3 pb-3">
            <label className="flex items-center gap-2 rounded-md bg-muted/50 px-2.5 py-2 text-muted-foreground">
              <SearchIcon className="size-3.5 shrink-0" aria-hidden="true" />
              <input
                className="min-w-0 flex-1 bg-transparent text-xs outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
                aria-label="Search groups"
                placeholder="Search groups"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
          </div>
          <div className="flex-1 overflow-y-auto px-2">
            {c.loading && !c.channels && (
              <p role="status" className="px-2 py-3 text-xs text-muted-foreground">
                Loading groups…
              </p>
            )}
            {groups?.length === 0 && (
              <p className="px-2 py-3 text-xs text-muted-foreground">
                {search
                  ? "No matching groups."
                  : archived
                    ? "No archived groups."
                    : "No groups yet."}
              </p>
            )}
            <ul className="space-y-1">
              {groups?.map((group) => (
                <li key={group.id}>
                  <button
                    type="button"
                    disabled={c.busy || Boolean(c.edit)}
                    aria-current={c.selected === group.id ? "page" : undefined}
                    onClick={() => {
                      c.select(group.id);
                      setView("Chat");
                      stickBottom.current = true;
                      setMessageLimit(50);
                      setTaskLimit(25);
                    }}
                    className={cn(
                      "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-3 text-left hover:bg-muted/70 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring disabled:opacity-50",
                      c.selected === group.id && "bg-muted",
                    )}
                  >
                    <GroupAvatar
                      channelId={group.id}
                      members={group.members}
                      agents={c.agents}
                      layout="cluster"
                      size={36}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{group.name}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {group.lastMessage?.text || `${group.members.length} bots`}
                      </p>
                    </div>
                    {group.unreadCount > 0 && (
                      <span
                        className="rounded-full bg-primary px-1.5 text-3xs text-primary-foreground"
                        aria-label={`${group.unreadCount} unread messages`}
                      >
                        {group.unreadCount}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </div>
          <div className="flex items-center justify-between border-t px-3 py-2">
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <Checkbox
                checked={archived}
                onCheckedChange={(value) => setArchived(Boolean(value))}
              />
              Archived
            </label>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Refresh groups"
              onClick={c.refresh}
              disabled={c.busy}
            >
              <RefreshCwIcon aria-hidden="true" />
            </Button>
          </div>
        </aside>
      )}

      <div className="ob-group-main">
        {(channel || c.edit) && (
          <header className="conversation-header ob-group-header">
            <div className="conversation-heading-group">
              <button
                type="button"
                className="conversation-title channel-title"
                aria-label="Group settings"
                aria-expanded={view === "Settings" || Boolean(c.edit)}
                onClick={() => setView(view === "Settings" ? "Chat" : "Settings")}
                data-avatar-hover
              >
                {channel && (
                  <GroupAvatar
                    channelId={channel.id}
                    members={channel.members}
                    agents={c.agents}
                    size={18}
                  />
                )}
                <span className="channel-header-copy">
                  <h1>{c.edit && !c.edit.update ? "New group" : channel?.name}</h1>
                  {channel?.title && <span className="channel-header-title">{channel.title}</span>}
                </span>
              </button>
            </div>
            {channel && (
              <div className="conversation-header-actions">
                {channel.archived && <span className="ob-group-archived">Archived</span>}
                <button
                  type="button"
                  className="header-panel-toggle"
                  aria-label={pane ? "Close group panel" : "Open group files and tasks"}
                  aria-expanded={pane}
                  onClick={() => setView(pane ? "Chat" : "Files")}
                  disabled={Boolean(c.edit)}
                >
                  <PanelRightIcon />
                </button>
              </div>
            )}
          </header>
        )}
        <div className="ob-group-frame" data-embedded={embedded || undefined}>
          <div className="ob-group-conversation ob-chat" data-workspace>
            {(c.error || copyError) && (
              <p role="alert" className="ob-group-notice ob-chat-error">
                {c.error ?? copyError}
              </p>
            )}
            {c.notice && (
              <p role="status" className="ob-group-notice">
                {c.notice}
              </p>
            )}
            {c.loading && c.selected && !channel && (
              <p role="status" className="ob-group-notice">
                Loading conversation…
              </p>
            )}
            {!channel && !c.edit && !c.loading && (
              <div className="channel-empty">
                <UsersIcon size={32} aria-hidden="true" />
                <h2>Bring your bots together</h2>
                <p>Create a group to share a conversation and let your bots work together.</p>
                <Button
                  size="sm"
                  disabled={!c.canManage || c.busy}
                  onClick={() => {
                    c.create();
                    setView("Settings");
                  }}
                >
                  Create group
                </Button>
              </div>
            )}
            {channel && (
              <>
                <UnreadMessagesBanner
                  count={c.channels?.find((item) => item.id === channel.id)?.unreadCount ?? 0}
                  busy={c.busy}
                  onRead={() => void c.markReadThrough(c.throughSequence)}
                  onJump={() => {
                    const id = c.presentation?.firstUnreadMessageId;
                    if (!id) return;
                    stickBottom.current = false;
                    unreadJumped.current = null;
                    setUnreadTarget({ channelId: channel.id, id });
                    if (!projection.rows.some((item) => item.id === id)) void c.revealUnread();
                    else setMessageLimit(projection.rows.length);
                  }}
                />
                <div
                  ref={scroller}
                  className="ob-chat-scroll ob-group-scroll"
                  onScroll={(event) => {
                    const element = event.currentTarget;
                    stickBottom.current =
                      element.scrollHeight - element.scrollTop - element.clientHeight < 80;
                    setAwayFromLatest(!stickBottom.current);
                    if (stickBottom.current && tally.count) tally.dismiss();
                  }}
                >
                  <SourceChatScrollRail
                    scroller={scroller}
                    sections={railSections}
                    onJump={(section) => {
                      stickBottom.current = false;
                      if (section.row === undefined) {
                        if (projection.rows.length <= messageLimit) void c.older();
                        setMessageLimit(messageLimit + 100);
                      } else
                        virtual.instance.scrollToIndex(section.row, {
                          align: "start",
                          behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
                            ? "auto"
                            : "smooth",
                        });
                    }}
                  />
                  <div className="ob-group-transcript">
                    <div className="ob-chat-history-status">
                      {(projection.rows.length > messageLimit || c.olderCursor !== null) && (
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={c.busy}
                          onClick={async () => {
                            const before = scroller.current
                              ? {
                                  height: scroller.current.scrollHeight,
                                  top: scroller.current.scrollTop,
                                }
                              : null;
                            stickBottom.current = false;
                            if (projection.rows.length <= messageLimit) await c.older();
                            olderPosition.current = before;
                            setMessageLimit(messageLimit + 100);
                          }}
                        >
                          Load older messages
                        </Button>
                      )}
                    </div>
                    {c.messages.length === 0 && (
                      <div className="channel-empty">
                        <GroupAvatar
                          channelId={channel.id}
                          members={channel.members}
                          agents={c.agents}
                        />
                        <h2>{channel.name}</h2>
                        {channel.title && <p className="channel-empty-title">{channel.title}</p>}
                        {channel.instructions && <p>{channel.instructions}</p>}
                      </div>
                    )}
                    <ol
                      ref={virtualRoot}
                      className="ob-group-messages virtual-chat-list"
                      aria-label="Group messages"
                      style={{
                        position: "relative",
                        height: virtual.virtualized ? virtual.total : "auto",
                      }}
                    >
                      {virtual.items.map((item) => {
                        const index = item.index,
                          message = messages[index];
                        if (!message) return null;
                        const day = groupDayMarker(
                          messages[index - 1]?.message.createdAt,
                          message.message.createdAt,
                        );
                        const steps = projection.above.get(message.id);
                        const person = message.author.kind === "member";
                        const agent = c.agents.find((item) => item.id === message.author.id);
                        const grouped = continuesGroupSender(messages[index - 1], message);
                        const time = new Date(message.message.createdAt);
                        const timeLabel = Number.isNaN(time.getTime())
                          ? ""
                          : time.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
                        const reply = c.messages.find(
                          (entry) => entry.id === message.message.replyToMessageId,
                        );
                        return (
                          <li
                            key={message.id}
                            data-index={index}
                            ref={(element) => virtual.instance.measureElement(element)}
                            style={{
                              position: virtual.virtualized ? "absolute" : "relative",
                              top: virtual.virtualized ? 0 : undefined,
                              width: "100%",
                              transform: virtual.virtualized
                                ? `translateY(${item.start - virtual.margin}px)`
                                : undefined,
                            }}
                          >
                            <ol style={{ listStyle: "none", padding: 0, margin: 0 }}>
                              {message.id === c.presentation?.firstUnreadMessageId && (
                                <li role="presentation">
                                  <UnreadMessagesDivider />
                                </li>
                              )}
                              {day && (
                                <li className="ob-group-time-marker">
                                  <span>{day}</span>
                                </li>
                              )}
                              {steps && (
                                <li className="ob-group-step-row">
                                  <GroupCommentarySteps group={steps} reveal={revealedStep} />
                                </li>
                              )}
                              <li
                                className="ob-chat-message ob-group-message"
                                data-author={person ? "user" : "assistant"}
                                data-grouped={grouped || undefined}
                                style={
                                  {
                                    "--message-author-color": agentColor(message.author.id),
                                  } as CSSProperties
                                }
                              >
                                {!person && !grouped && (
                                  <div className="ob-group-message-avatar" data-avatar-hover>
                                    {agent && onSelectAgent ? (
                                      <button
                                        type="button"
                                        className="ob-group-message-avatar-button"
                                        aria-label={`Open chat with ${message.author.name}`}
                                        onClick={() => onSelectAgent(agent.id)}
                                      >
                                        <BotAvatar
                                          seed={agent?.avatarSeed ?? message.author.id}
                                          hue={agent?.avatarHue ?? null}
                                          size={32}
                                        />
                                      </button>
                                    ) : (
                                      <BotAvatar
                                        seed={agent?.avatarSeed ?? message.author.id}
                                        hue={agent?.avatarHue ?? null}
                                        size={32}
                                      />
                                    )}
                                  </div>
                                )}
                                {!grouped && (
                                  <div className="ob-group-message-author">
                                    {!person && agent && onSelectAgent ? (
                                      <button
                                        type="button"
                                        className="ob-group-author-link"
                                        onClick={() => onSelectAgent(agent.id)}
                                        aria-label={`Open chat with ${message.author.name}`}
                                      >
                                        {message.author.name}
                                      </button>
                                    ) : (
                                      <span>{message.author.name}</span>
                                    )}
                                    <time
                                      className="ob-chat-message-time"
                                      dateTime={message.message.createdAt}
                                    >
                                      {timeLabel}
                                    </time>
                                  </div>
                                )}
                                <div className="ob-chat-message-shell">
                                  <div className="ob-chat-bubble">
                                    {!person && (
                                      <BotToolActivity
                                        trace={message.message.trace}
                                        deferred={
                                          supportsFullTrace && message.message.trace
                                            ? {
                                                environmentId,
                                                hostId,
                                                channelId: channel.id,
                                                messageId: message.id,
                                              }
                                            : undefined
                                        }
                                        streaming={message.message.status === "streaming"}
                                      />
                                    )}
                                    <div className="ob-chat-bubble-content">
                                      {reply && (
                                        <button
                                          type="button"
                                          className="ob-chat-reply-quote ob-group-quote"
                                          onClick={() => {
                                            setMessageLimit(c.messages.length);
                                            setRevealedStep({ id: reply.id });
                                            requestAnimationFrame(() =>
                                              document
                                                .getElementById(`group-message-${reply.id}`)
                                                ?.scrollIntoView({ block: "center" }),
                                            );
                                          }}
                                        >
                                          {reply.author.name}: {reply.message.text.slice(0, 200)}
                                        </button>
                                      )}
                                      <div id={`group-message-${message.id}`}>
                                        {!message.message.text &&
                                          message.message.status === "streaming" && (
                                            <BotTypingIndicator
                                              label={`${message.author.name} is working`}
                                            />
                                          )}
                                        <BotStreamingMessage
                                          isStreaming={message.message.status === "streaming"}
                                          onLayout={() => {
                                            if (stickBottom.current && scroller.current)
                                              scroller.current.scrollTop =
                                                scroller.current.scrollHeight;
                                          }}
                                          environmentId={environmentId}
                                          hostId={hostId}
                                          agentId={channel.members[0]?.agentId ?? null}
                                          text={message.message.text}
                                        />
                                      </div>
                                      {message.message.uiBlock != null && (
                                        <BotGroupRichMessage
                                          environmentId={environmentId}
                                          hostId={hostId}
                                          channel={channelSummary!}
                                          entry={message}
                                          disabled={composeDisabled}
                                        />
                                      )}
                                      {channel.members[0] && (
                                        <BotMessageFiles
                                          environmentId={environmentId}
                                          hostId={hostId}
                                          agentId={channel.members[0].agentId}
                                          taskId={null}
                                          channelId={channel.id}
                                          beforeSequence={message.sequence + 1}
                                          messageId={message.id}
                                          attachments={message.message.attachments}
                                        />
                                      )}
                                    </div>
                                  </div>
                                </div>
                                <div className="ob-chat-message-footer ob-group-message-footer">
                                  <div className="ob-chat-message-actions">
                                    <button
                                      type="button"
                                      className="ob-chat-action-button"
                                      aria-label={`Reply to ${message.author.name}`}
                                      disabled={composeDisabled}
                                      onClick={() => {
                                        c.setReply(message.id);
                                        editor.current?.focus();
                                      }}
                                    >
                                      <ReplyIcon />
                                    </button>
                                    <button
                                      type="button"
                                      className="ob-chat-action-button"
                                      aria-label={
                                        copiedId === message.id ? "Copied" : "Copy message"
                                      }
                                      onClick={() =>
                                        void writeTextToClipboard(
                                          message.message.text,
                                          "message",
                                        ).then(
                                          () => {
                                            setCopiedId(message.id);
                                            setCopyError(null);
                                          },
                                          () => setCopyError("Could not copy this message."),
                                        )
                                      }
                                    >
                                      {copiedId === message.id ? <CheckIcon /> : <CopyIcon />}
                                    </button>
                                  </div>
                                  {message.message.status !== "completed" && (
                                    <span className="ob-chat-message-status">
                                      {message.message.status}
                                    </span>
                                  )}
                                  {message.superseded && (
                                    <span className="ob-group-earlier">Earlier attempt</span>
                                  )}
                                </div>
                              </li>
                            </ol>
                          </li>
                        );
                      })}
                    </ol>
                    {workers
                      .filter(
                        (id) =>
                          !c.messages.some(
                            (entry) =>
                              entry.author.id === id && entry.message.status === "streaming",
                          ),
                      )
                      .map((id) => {
                        const agent = c.agents.find((item) => item.id === id);
                        return (
                          <div
                            key={id}
                            className="ob-chat-message ob-group-message"
                            data-author="assistant"
                            aria-label={`${agent?.name ?? "Bot"} working`}
                          >
                            <div className="ob-group-message-avatar">
                              <BotAvatar
                                seed={agent?.avatarSeed ?? id}
                                hue={agent?.avatarHue ?? null}
                                size={32}
                              />
                            </div>
                            <div className="ob-group-message-author">{agent?.name ?? "Bot"}</div>
                            <div className="ob-chat-message-shell">
                              <div className="ob-chat-bubble-content">
                                <BotTypingIndicator label={`${agent?.name ?? "Bot"} is working`} />
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    {projection.pending.map((group) => (
                      <GroupCommentarySteps key={group.id} group={group} reveal={revealedStep} />
                    ))}
                    {channelSummary && (
                      <BotGroupRequests
                        environmentId={environmentId}
                        hostId={hostId}
                        channel={channelSummary}
                        entries={c.messages}
                      />
                    )}
                  </div>
                </div>
                {stopped.length > 0 && (
                  <div className="ob-group-paused-tasks">
                    {stopped.map((task) => (
                      <section key={task.id} className="ob-group-paused-task">
                        <p>{task.error}</p>
                        <button type="button" onClick={() => setView("Tasks")}>
                          Review task
                        </button>
                        {channelTaskActions(task.state, channel.archived).includes("resume") &&
                          (!task.ownerAgentId ||
                            channel.members.some(
                              (member) => member.agentId === task.ownerAgentId,
                            )) && (
                            <button
                              type="button"
                              disabled={disabled}
                              onClick={() =>
                                void c.act({
                                  operation: "channel.resume",
                                  channelId: channel.id,
                                  taskId: task.id,
                                  recipientAgentId: null,
                                })
                              }
                            >
                              Continue
                            </button>
                          )}
                      </section>
                    ))}
                  </div>
                )}
                <div className="ob-chat-composer-wrap">
                  {(awayFromLatest || c.hasNewer || tally.count > 0) && (
                    <ScrollToLatestButton
                      count={tally.count}

                      onJump={() => {
                        stickBottom.current = true;
                        olderPosition.current = null;
                        setUnreadTarget(null);
                        unreadJumped.current = null;
                        c.showLatest();
                        setAwayFromLatest(false);
                        tally.dismiss();
                        requestAnimationFrame(() => virtual.scrollToEnd());
                      }}
                    />
                  )}
                  {c.reply && (
                    <div className="ob-chat-reply-preview">
                      <div>
                        <span>
                          Replying to{" "}
                          {c.messages.find((message) => message.id === c.reply)?.author.name ??
                            "an earlier message"}
                        </span>
                        <p className="ob-chat-reply-quote">
                          {c.messages
                            .find((message) => message.id === c.reply)
                            ?.message.text.slice(0, 120)}
                        </p>
                      </div>
                      <button
                        type="button"
                        aria-label="Cancel reply"
                        onClick={() => c.setReply(null)}
                      >
                        <XIcon />
                      </button>
                    </div>
                  )}
                  <BotMessageComposer
                    onSubmit={(event) => {
                      event.preventDefault();
                      submit();
                    }}
                  >
                    <BotComposerInput>
                      {editorAgentId ? (
                        <BotComposerEditor
                          ref={editor}
                          environmentId={environmentId}
                          hostId={hostId}
                          agentId={editorAgentId}
                          allowedAgentIds={channel.members.map((member) => member.agentId)}
                          includeSelf
                          skillsEnabled={false}
                          value={c.text}
                          onChange={c.setText}
                          onSubmit={submit}
                          disabled={composeDisabled}
                          placeholder={
                            channel.archived
                              ? "Restore this group to continue the conversation"
                              : "Message…"
                          }
                          attachments={[]}
                        />
                      ) : (
                        <div className="ob-chat-editor-root">
                          <textarea
                            aria-label="Message group"
                            placeholder="Add a bot to start a conversation"
                            value={c.text}
                            onChange={(event) => c.setText(event.target.value)}
                            disabled={composeDisabled}
                            rows={1}
                          />
                        </div>
                      )}
                    </BotComposerInput>
                    <BotComposerFooter
                      actions={
                        <>
                          <BotComposerRecipient
                            label="Message recipient"
                            value={c.recipient ?? ""}
                            onChange={(id) => c.setRecipient(id || null)}
                            disabled={composeDisabled}
                            choices={[
                              {
                                id: "",
                                name: channel.leadAgentId
                                  ? `Auto · ${members.find((member) => member.id === channel.leadAgentId)?.name ?? "Group lead"}`
                                  : "Choose a lead or @mention",
                              },
                              ...members,
                            ]}
                          />
                          {editorAgentId && (
                            <SourceModelPicker
                              environmentId={environmentId}
                              hostId={hostId}
                              agentId={editorAgentId}
                            />
                          )}
                          <BotComposerVoice
                            voice={voice}
                            disabled={disabled || channel.archived || Boolean(c.edit)}
                          />
                          <BotComposerSend
                            aria-label="Send message"
                            busy={c.busy}
                            disabled={composeDisabled || !c.text.trim()}
                          />
                        </>
                      }
                    >
                      <Menu>
                        <MenuTrigger
                          render={<ComposerControl className="size-8 px-0" />}
                          aria-label="Add to group message"
                        >
                          <PlusIcon />
                        </MenuTrigger>
                        <MenuPopup align="start" side="top">
                          <MenuItem onClick={() => setView("Files")}>
                            <FolderIcon />
                            Group files
                          </MenuItem>
                          <MenuItem onClick={() => setView("Tasks")}>
                            <ListTodoIcon />
                            Group tasks
                          </MenuItem>
                          <MenuItem
                            disabled={c.busy || !c.canSettings}
                            onClick={() =>
                              void c.act({
                                operation: "channel.markRead",
                                channelId: channel.id,
                                throughSequence: c.throughSequence,
                              })
                            }
                          >
                            <CheckCheckIcon />
                            Mark read
                          </MenuItem>
                          <MenuItem disabled={c.busy} onClick={c.refresh}>
                            <RefreshCwIcon />
                            Refresh
                          </MenuItem>
                        </MenuPopup>
                      </Menu>
                    </BotComposerFooter>
                    <BotComposerVoiceStatus voice={voice} />
                  </BotMessageComposer>
                </div>
              </>
            )}
          </div>
          {pane && (channel || c.edit) && (
            <GroupSidePanel
              settings={view === "Settings" || Boolean(c.edit)}
              label={view === "Settings" || c.edit ? "Group settings" : "Group files and tasks"}
            >
              <div className="ob-group-panel-header">
                {view === "Settings" || c.edit ? (
                  <h2>{c.edit && !c.edit.update ? "New group" : "Group settings"}</h2>
                ) : (
                  <OpenbotSlidingTabs
                    value={view === "Tasks" ? "Tasks" : "Files"}
                    onChange={setView}
                    items={PANEL_TABS}
                    label="Group panel"
                  />
                )}
                <button
                  type="button"
                  className="ob-chat-action-button"
                  aria-label="Close group panel"
                  disabled={Boolean(c.edit)}
                  onClick={() => setView("Chat")}
                >
                  <XIcon />
                </button>
              </div>
              {c.edit || view === "Settings" ? (
                <div className="min-h-0 flex-1 overflow-y-auto scrollbar-gutter-both p-6">
                  <div className="mx-auto max-w-xl space-y-6">
                    {channel && (
                      <GroupPictureEditor
                        environmentId={environmentId}
                        hostId={hostId}
                        channel={channel}
                        agents={c.agents}
                        onSaved={c.refresh}
                      />
                    )}
                    {c.edit ? (
                      <ChannelSettings controller={c} />
                    ) : (
                      channel && (
                        <>
                          <div>
                            <h3 className="font-medium">{channel.name}</h3>
                            {channel.title && <p className="mt-1 text-sm">{channel.title}</p>}
                            {channel.instructions && (
                              <p className="mt-3 whitespace-pre-wrap text-sm text-muted-foreground">
                                {channel.instructions}
                              </p>
                            )}
                          </div>
                          <ul className="space-y-2">
                            {channel.members.map((member) => (
                              <li key={member.agentId} className="flex items-center gap-2 text-sm">
                                <BotAvatar
                                  seed={
                                    c.agents.find((agent) => agent.id === member.agentId)
                                      ?.avatarSeed ?? member.agentId
                                  }
                                  hue={
                                    c.agents.find((agent) => agent.id === member.agentId)
                                      ?.avatarHue ?? null
                                  }
                                  size={24}
                                />
                                {c.agents.find((agent) => agent.id === member.agentId)?.name ??
                                  "Unlisted bot"}
                                {member.agentId === channel.leadAgentId && (
                                  <span className="text-xs text-muted-foreground">Lead</span>
                                )}
                              </li>
                            ))}
                          </ul>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={c.busy || !c.canManage}
                            onClick={c.editSettings}
                          >
                            Edit group
                          </Button>
                          <BotChannelExtras environmentId={environmentId} hostId={hostId} />
                          {(c.recipient ?? channel.leadAgentId) && (
                            <details>
                              <summary className="cursor-pointer text-sm">
                                Background coding permission
                              </summary>
                              <div className="pt-3">
                                <BotChannelGrants
                                  key={`${channel.id}:${c.recipient ?? channel.leadAgentId}`}
                                  environmentId={environmentId}
                                  hostId={hostId}
                                  channelId={channel.id}
                                  agentId={(c.recipient ?? channel.leadAgentId)!}
                                />
                              </div>
                            </details>
                          )}
                          <div className="flex flex-wrap gap-2 border-t pt-5">
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={
                                c.busy || (channel.archived ? !c.canSettings : !c.canOperate)
                              }
                              onClick={() => {
                                if (channel.archived)
                                  void c.act({
                                    operation: "channel.restore",
                                    channelId: channel.id,
                                  });
                                else
                                  void confirm("Archive this group? Running work will pause.").then(
                                    (approved) => {
                                      if (approved)
                                        void c.act({
                                          operation: "channel.archive",
                                          channelId: channel.id,
                                        });
                                    },
                                  );
                              }}
                            >
                              {channel.archived ? "Restore group" : "Archive group"}
                            </Button>
                            <Button
                              variant="destructive"
                              size="sm"
                              disabled={disabled}
                              onClick={() => {
                                void confirm(
                                  "Delete this group and its history? Active work will stop.",
                                ).then((approved) => {
                                  if (approved)
                                    void c.act({
                                      operation: "channel.delete",
                                      channelId: channel.id,
                                    });
                                });
                              }}
                            >
                              Delete group
                            </Button>
                          </div>
                        </>
                      )
                    )}
                  </div>
                </div>
              ) : channel && view === "Files" ? (
                <div className="min-h-0 flex-1 overflow-auto p-6">
                  {channel.members[0] ? (
                    <BotFiles
                      key={channel.id}
                      environmentId={environmentId}
                      hostId={hostId}
                      agentId={channel.members[0].agentId}
                      initialTarget={{ kind: "channel", channelId: channel.id }}
                      initiallyExpanded
                    />
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      Add a bot to this group to share files.
                    </p>
                  )}
                </div>
              ) : (
                <div className="min-h-0 flex-1 overflow-y-auto scrollbar-gutter-both p-6">
                  <div className="mx-auto max-w-2xl">
                    <h3 className="mb-5 text-base font-medium">Group tasks</h3>
                    {c.tasks.length === 0 && (
                      <p className="text-sm text-muted-foreground">
                        Tasks appear here when bots begin working in this group.
                      </p>
                    )}
                    <ul className="space-y-6">
                      {c.tasks
                        .toSorted(
                          (left, right) =>
                            Number(right.id === initialTaskId) - Number(left.id === initialTaskId),
                        )
                        .slice(0, taskLimit)
                        .map((task) => (
                          <TaskRow key={task.id} task={task} controller={c} />
                        ))}
                    </ul>
                    {c.tasks.length > taskLimit && (
                      <Button variant="ghost" onClick={() => setTaskLimit(taskLimit + 25)}>
                        Show more tasks
                      </Button>
                    )}
                  </div>
                </div>
              )}
            </GroupSidePanel>
          )}
        </div>
      </div>
    </section>
  );
}
