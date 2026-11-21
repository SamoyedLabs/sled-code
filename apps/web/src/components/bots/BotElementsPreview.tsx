import { useState, type ReactNode } from "react";
import { Chat, useChat } from "@ai-sdk/react";
import { isToolUIPart, type ToolUIPart } from "ai";
import {
  createPreviewStreamingTransport,
  type PreviewChatMessage,
} from "./previewStreamingTransport";
import { SidebarChromeHeader } from "../sidebar/SidebarChrome";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { PlayIcon, SquareIcon } from "lucide-react";
import {
  ArrowUpIcon,
  ChevronDownIcon,
  CopyIcon,
  MessageSquareIcon,
  SearchIcon,
  Settings2Icon,
  PlusIcon,
  ListTodoIcon,
  CheckIcon,
} from "lucide-react";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "../ai-elements/conversation";
import { Message, MessageContent, MessageActions } from "../ai-elements/message";
import { OpenbotPreviewTurnSteps } from "./OpenbotPreviewTurnSteps";
import { PreviewStreamingText } from "./PreviewStreamingText";
import { PreviewAccountUsageRail } from "./PreviewAccountUsage";
import { BotAvatar } from "./avatar/BotAvatar";
import { Button } from "../ui/button";
import { Textarea } from "../ui/textarea";
import { Tooltip, TooltipTrigger, TooltipPopup } from "../ui/tooltip";
import { Menu, MenuTrigger, MenuPopup, MenuItem } from "../ui/menu";
import {
  SquarePenIcon,
  MoreHorizontalIcon,
  PanelRightIcon,
  FilesIcon,
  MonitorIcon,
  Repeat2Icon,
  GitBranchIcon,
  CalendarDaysIcon,
  PuzzleIcon,
  ChartNoAxesColumnIcon,
  CircleAlertIcon,
  UsersIcon,
  BrainIcon,
  GlobeIcon,
  DatabaseIcon,
  LockKeyholeIcon,
  XIcon,
} from "lucide-react";
import {
  ElementsPreviewSidePanel,
  ElementsPreviewPage,
  previewBots as bots,
  type PreviewPage,
  type PreviewTool,
} from "./BotElementsPreviewPanels";
import { T, useGT } from "gt-react";

const group = { id: "launch", name: "Launch copy" };

function PreviewIconButton({
  label,
  pressed,
  onClick,
  children,
}: {
  label: string;
  pressed?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost-muted"
            size="icon-sm"
            aria-label={label}
            aria-pressed={pressed}
            onClick={onClick}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipPopup>{label}</TooltipPopup>
    </Tooltip>
  );
}

function Avatars({ size = 30 }: { size?: number }) {
  const gt = useGT();
  return (
    <span
      className="flex shrink-0 items-center -space-x-3"
      aria-label={gt("Luna Scout, Luna Writer and Luna")}
    >
      {bots.map((bot) => (
        <span key={bot.id} className="relative flex rounded-full bg-sidebar p-0.5">
          <BotAvatar seed={bot.seed} hue={bot.hue} size={size} />
        </span>
      ))}
    </span>
  );
}

const exampleTools: ToolUIPart[] = [
  {
    type: "tool-search_product_notes",
    toolCallId: "example-search",
    state: "output-available",
    input: { query: "launch positioning" },
    output: { files: ["launch-brief.md", "product-notes.md"] },
  },
  {
    type: "tool-read_launch_brief",
    toolCallId: "example-read",
    state: "output-available",
    input: { file: "launch-brief.md" },
    output: { tone: "Clear, confident, warm" },
  },
];
const exampleTrace = {
  startedAt: 0,
  endedAt: 7000,
  toolTimings: {
    "example-search": { start: 350, end: 1700 },
    "example-read": { start: 1900, end: 3250 },
  },
};

export function BotElementsPreview() {
  const gt = useGT();
  const [selected, setSelected] = useState<string>(group.id);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [chats] = useState(() =>
    Object.fromEntries(
      [group.id, ...bots.map((bot) => bot.id)].map((id) => [
        id,
        new Chat<PreviewChatMessage>({
          id: `ui-preview-${id}`,
          transport: createPreviewStreamingTransport(),
        }),
      ]),
    ),
  );
  const {
    messages: transcript,
    sendMessage,
    stop,
    status,
    error,
  } = useChat({ chat: chats[selected]! });
  const streaming = status === "submitted" || status === "streaming";
  const [stoppedReplies, setStoppedReplies] = useState<ReadonlySet<string>>(() => new Set());
  const stopDemo = () => {
    const reply = transcript.findLast((message) => message.role === "assistant");
    if (streaming && reply)
      setStoppedReplies((current) => new Set([...current, `${selected}:${reply.id}`]));
    void stop();
  };
  const [search, setSearch] = useState("");
  const [copied, setCopied] = useState(false);
  const [page, setPage] = useState<PreviewPage>("Messages");
  const widePreview = useMediaQuery("(min-width: 1024px)");
  const [toolChoice, setTool] = useState<PreviewTool | null | undefined>(undefined);
  const tool = toolChoice === undefined ? (widePreview ? "Details" : null) : toolChoice;
  const [attachments, setAttachments] = useState<Record<string, boolean>>({});
  const attachment = attachments[selected] ?? false;
  const setAttachment = (value: boolean) =>
    setAttachments((current) => ({ ...current, [selected]: value }));
  const [recipient, setRecipient] = useState("Auto · Luna Scout");
  const chooseChat = (id: string) => {
    stopDemo();
    setSelected(id);
    setPage("Messages");
  };
  const isGroup = selected === group.id;
  const bot = bots.find((item) => item.id === selected) ?? bots[1];
  const title = isGroup ? group.name : bot.name;
  const response = isGroup
    ? "Two ways to make it yours. One duo, built around you."
    : selected === bots[0].id
      ? "Let’s start with the facts, then find the angle worth sharing."
      : selected === bots[1].id
        ? "Let’s make it clear, specific, and worth reading."
        : "What would you like to work on?";
  const draft = drafts[selected] ?? "";
  const submit = () => {
    if (!draft.trim() || streaming) return;
    void sendMessage({ text: draft.trim(), metadata: { sampleAttachment: attachment } });
    setDrafts((current) => ({ ...current, [selected]: "" }));
    setAttachment(false);
  };
  return (
    <div
      className="flex h-full min-h-0 flex-1 bg-background"
      aria-label={gt("AI Elements alternative")}
    >
      <aside
        className="flex w-72 shrink-0 flex-col border-r bg-sidebar max-md:w-60 max-sm:w-16"
        aria-label={gt("Preview chats")}
      >
        <div className="relative shrink-0">
          <SidebarChromeHeader isElectron={false} />
        </div>
        <div className="relative z-10 flex items-center gap-1 px-3 py-2 max-sm:hidden">
          <label className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 py-1.5 text-muted-foreground">
            <SearchIcon className="size-4 shrink-0" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={gt("Search")}
              aria-label={gt("Find preview conversation")}
              className="w-full min-w-0 bg-transparent text-sm outline-none"
            />
            <span className="text-2xs">⌘K</span>
          </label>
          <Menu>
            <MenuTrigger
              render={
                <Button variant="ghost-muted" size="icon-sm" aria-label={gt("Create in preview")} />
              }
            >
              <SquarePenIcon />
            </MenuTrigger>
            <MenuPopup align="end">
              <MenuItem onClick={() => setPage("Groups")}>
                <UsersIcon />
                <T>New group preview</T>
              </MenuItem>
              <MenuItem onClick={() => setPage("All tasks")}>
                <ListTodoIcon />
                <T>New task preview</T>
              </MenuItem>
            </MenuPopup>
          </Menu>
        </div>
        <nav
          aria-label={gt("Preview workspace navigation")}
          className="space-y-0.5 px-2 pb-4 max-sm:pt-3"
        >
          {(
            [
              ["Messages", MessageSquareIcon],
              ["All tasks", ListTodoIcon],
              ["Routines", Repeat2Icon],
              ["Workflows", GitBranchIcon],
              ["Schedule", CalendarDaysIcon],
            ] as const
          ).map(([name, Icon]) => (
            <button
              key={name}
              type="button"

              aria-label={name}
              aria-current={page === name ? "page" : undefined}
              onClick={() => setPage(name)}
              className="flex h-8 w-full items-center gap-2.5 rounded-md px-2 text-sm font-medium text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring aria-[current=page]:bg-accent aria-[current=page]:text-foreground max-sm:justify-center"
            >
              <Icon className="size-4" />
              <span className="max-sm:hidden">{name}</span>
            </button>
          ))}
        </nav>
        <div className="min-h-0 flex-1 overflow-y-auto px-2">
          <div className="mb-1.5 flex items-center justify-between px-2 text-xs font-medium text-muted-foreground max-sm:hidden">
            <span>
              <T>Conversations</T>
            </span>
            <span className="text-2xs font-normal">4</span>
          </div>
          <nav className="space-y-1" aria-label={gt("Alternative conversations")}>
            {group.name.toLowerCase().includes(search.toLowerCase()) && (
              <button
                type="button"
                onClick={() => chooseChat(group.id)}
                aria-current={isGroup && page === "Messages" ? "page" : undefined}
                aria-label={gt("Launch copy group")}
                className="flex min-h-16 w-full items-center gap-3 rounded-lg p-2.5 text-left outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring aria-[current=page]:bg-sidebar-row-selected aria-[current=page]:shadow-xs aria-[current=page]:ring-1 aria-[current=page]:ring-sidebar-border max-sm:justify-center max-sm:px-0"
              >
                <Avatars size={20} />
                <span className="min-w-0 flex-1 max-sm:hidden">
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium">
                      <T>Launch copy</T>
                    </span>
                    <span className="shrink-0 text-2xs text-muted-foreground">10:43</span>
                  </span>
                  <span className="mt-1 block truncate text-xs text-muted-foreground">
                    <T>Writer: Want a more playful version?</T>
                  </span>
                </span>
              </button>
            )}
            {bots
              .filter((item) => item.name.toLowerCase().includes(search.toLowerCase()))
              .map((item) => (
                <button
                  type="button"
                  key={item.id}
                  onClick={() => chooseChat(item.id)}
                  aria-current={selected === item.id && page === "Messages" ? "page" : undefined}
                  aria-label={item.name}
                  className="flex min-h-16 w-full items-center gap-3 rounded-lg p-2.5 text-left outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring aria-[current=page]:bg-sidebar-row-selected aria-[current=page]:shadow-xs aria-[current=page]:ring-1 aria-[current=page]:ring-sidebar-border max-sm:justify-center max-sm:px-0"
                >
                  <BotAvatar seed={item.seed} hue={item.hue} size={32} />
                  <span className="min-w-0 flex-1 max-sm:hidden">
                    <span className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium">{item.name}</span>
                      <span className="shrink-0 text-2xs text-muted-foreground">{item.time}</span>
                    </span>
                    <span className="mt-1 block truncate text-xs text-muted-foreground">
                      {item.preview}
                    </span>
                  </span>
                </button>
              ))}
          </nav>
        </div>
        <footer className="mt-auto shrink-0 px-2 pb-2 pt-3">
          <div className="mb-3 flex items-center px-1 max-sm:justify-center">
            <PreviewAccountUsageRail onOpen={() => setPage("Usage")} />
          </div>
          <Menu>
            <MenuTrigger
              render={
                <button
                  type="button"
                  className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-xs text-muted-foreground hover:bg-accent max-sm:justify-center"
                  aria-label={gt("Preview workspace menu")}
                />
              }
            >
              <MonitorIcon className="size-3.5" />
              <span className="min-w-0 flex-1 truncate text-left max-sm:hidden">
                <T>This Mac · Preview</T>
              </span>
              <ChevronDownIcon className="size-3 max-sm:hidden" />
            </MenuTrigger>
            <MenuPopup side="top" align="start">
              <MenuItem onClick={() => setPage("Settings")}>
                <Settings2Icon />
                <T>Workspace settings preview</T>
              </MenuItem>
              <MenuItem onClick={() => setPage("Usage")}>
                <ChartNoAxesColumnIcon />
                <T>Sample model usage</T>
              </MenuItem>
            </MenuPopup>
          </Menu>
          <div className="flex h-9 items-center gap-1 max-sm:justify-center">
            <PreviewIconButton label={gt("Preview settings")} onClick={() => setPage("Settings")}>
              <Settings2Icon />
            </PreviewIconButton>
            <Menu>
              <MenuTrigger
                render={
                  <Button
                    variant="ghost-muted"
                    size="icon-sm"
                    aria-label={gt("More preview pages")}
                  />
                }
              >
                <MoreHorizontalIcon />
              </MenuTrigger>
              <MenuPopup align="start" side="top">
                {(
                  [
                    ["Groups", UsersIcon],
                    ["Workflows", GitBranchIcon],
                    ["Schedule", CalendarDaysIcon],
                    ["Usage", ChartNoAxesColumnIcon],
                    ["Needs attention", CircleAlertIcon],
                    ["Marketplace", PuzzleIcon],
                  ] as const
                ).map(([name, Icon]) => (
                  <MenuItem key={name} onClick={() => setPage(name)}>
                    <Icon />
                    {name}
                  </MenuItem>
                ))}
              </MenuPopup>
            </Menu>
            <Button
              variant="ghost-muted"
              size="xs"
              className="ml-auto max-sm:hidden"
              onClick={() => setPage("Usage")}
            >
              <T>Usage</T>
            </Button>
          </div>
        </footer>
      </aside>
      {page === "Messages" ? (
        <section
          className="flex min-w-0 flex-1 flex-col"
          aria-label={gt("{title} preview conversation", { title })}
        >
          <header className="flex h-14 shrink-0 items-center gap-3 border-b px-6 max-sm:px-3">
            {isGroup ? (
              <Avatars size={23} />
            ) : (
              <BotAvatar seed={bot.seed} hue={bot.hue} size={28} />
            )}
            <div className="min-w-0">
              <h1 className="truncate text-sm font-medium">{title}</h1>
              <p className="text-2xs text-muted-foreground">
                {isGroup ? gt("3 bots · coordinated by Luna Scout") : bot.role}
              </p>
            </div>
            <div className="ml-auto flex items-center gap-1">
              <PreviewIconButton
                label={gt("Preview conversation tasks")}
                aria-pressed={tool === "Tasks"}
                onClick={() => setTool(tool === "Tasks" ? null : "Tasks")}
              >
                <ListTodoIcon />
              </PreviewIconButton>
              <PreviewIconButton
                label={gt("Preview conversation files")}
                aria-pressed={tool === "Files"}
                onClick={() => setTool(tool === "Files" ? null : "Files")}
              >
                <FilesIcon />
              </PreviewIconButton>
              <Menu>
                <MenuTrigger
                  render={
                    <Button
                      variant="ghost-muted"
                      size="icon-sm"
                      aria-label={gt("More preview conversation tools")}
                    />
                  }
                >
                  <MoreHorizontalIcon />
                </MenuTrigger>
                <MenuPopup align="end">
                  {(
                    [
                      ["Memory", BrainIcon],
                      ["Routines", Repeat2Icon],
                      ["Browser", GlobeIcon],
                      ["Computer", MonitorIcon],
                      ["Data", DatabaseIcon],
                      ["Vault", LockKeyholeIcon],
                      ["Settings", Settings2Icon],
                    ] as const
                  ).map(([name, Icon]) => (
                    <MenuItem
                      key={name}
                      onClick={() => (name === "Routines" ? setPage("Routines") : setTool(name))}
                    >
                      <Icon />
                      {name}
                    </MenuItem>
                  ))}
                </MenuPopup>
              </Menu>
              <div className="mx-1 h-4 border-l" />
              <PreviewIconButton
                label={gt("Toggle preview details panel")}
                aria-pressed={tool !== null}
                onClick={() => setTool(tool ? null : "Details")}
              >
                <PanelRightIcon />
              </PreviewIconButton>
            </div>
          </header>
          <div className="flex h-9 shrink-0 items-center gap-4 border-b px-5 text-xs">
            <button
              type="button"
              onClick={() => setTool(null)}
              className="flex h-full items-center gap-2 border-b-2 border-foreground font-medium"
            >
              <MessageSquareIcon className="size-3.5" />
              <T>Main chat</T>
            </button>
            <button
              type="button"
              onClick={() => setTool("Tasks")}
              className="flex h-full items-center gap-2 text-muted-foreground hover:text-foreground"
            >
              <ListTodoIcon className="size-3.5" />
              <T>Draft launch headline</T>
            </button>
            <Button
              variant="ghost-muted"
              size="compact"
              className="ml-auto"
              aria-label={streaming ? gt("Stop streaming demo") : gt("Replay streaming demo")}
              onClick={() => {
                if (streaming) stopDemo();
                else void sendMessage({ text: gt("Make it a little more playful.") });
              }}
            >
              {streaming ? <SquareIcon /> : <PlayIcon />}
              {streaming ? gt("Stop demo") : gt("Try streaming")}
            </Button>
            <Menu>
              <MenuTrigger
                render={
                  <Button
                    variant="ghost-muted"
                    size="icon-xs"
                    aria-label={gt("Streaming demo options")}
                    disabled={streaming}
                  />
                }
              >
                <ChevronDownIcon />
              </MenuTrigger>
              <MenuPopup align="end">
                <MenuItem
                  onClick={() => void sendMessage({ text: gt("Make it a little more playful.") })}
                >
                  <T>Successful tools and reply</T>
                </MenuItem>
                <MenuItem
                  onClick={() => void sendMessage({ text: gt("Show a failed tool demo.") })}
                >
                  <T>Failed tool and recovery message</T>
                </MenuItem>
              </MenuPopup>
            </Menu>
          </div>
          <div className="relative flex min-h-0 flex-1">
            <div className="flex min-w-0 flex-1 flex-col">
              <Conversation
                key={selected}
                initial="instant"
                resize="instant"
                className="min-h-0"
                aria-label={gt("Preview messages")}
              >
                <ConversationContent className="mx-auto w-full max-w-3xl gap-8 px-8 py-10 max-sm:px-4">
                  <div className="text-center text-2xs text-muted-foreground">
                    <T>Sample conversation · Today</T>
                  </div>
                  <Message from="user">
                    <MessageContent>
                      <p>
                        <T>Can you help me turn this launch brief into a short headline?</T>
                      </p>
                    </MessageContent>
                    <span className="pr-1 text-right text-2xs text-muted-foreground">
                      <T>You · 10:42</T>
                    </span>
                  </Message>
                  <div className="flex items-start gap-3">
                    <span className="pt-1">
                      <BotAvatar
                        seed={isGroup ? bots[0].seed : bot.seed}
                        hue={isGroup ? bots[0].hue : bot.hue}
                        size={32}
                      />
                    </span>
                    <Message from="assistant">
                      <div className="flex items-center gap-2 text-xs">
                        <span className="font-medium">{isGroup ? gt("Luna Scout") : bot.name}</span>
                        <span className="text-2xs text-muted-foreground">10:42</span>
                      </div>
                      <MessageContent>
                        <p className="leading-relaxed">
                          {isGroup
                            ? gt(
                                "I’ll check the brief and pass the strongest angle to Writer. We’ll keep it short and avoid unsupported claims.",
                              )
                            : gt(
                                "Of course. Share the brief, the audience, and the one thing you want people to remember.",
                              )}
                        </p>
                      </MessageContent>
                    </Message>
                  </div>
                  <div className="space-y-2">
                    <div className="ml-11">
                      <OpenbotPreviewTurnSteps
                        tools={exampleTools}
                        agent={isGroup ? bots[1] : bot}
                        metadata={exampleTrace}
                      />
                    </div>
                    <div className="flex items-start gap-3">
                      <span className="pt-1">
                        <BotAvatar
                          seed={isGroup ? bots[1].seed : bot.seed}
                          hue={isGroup ? bots[1].hue : bot.hue}
                          size={32}
                        />
                      </span>
                      <Message from="assistant">
                        <div className="flex items-center gap-2 text-xs">
                          <span className="font-medium">
                            {isGroup ? gt("Luna Writer") : bot.name}
                          </span>
                          <span className="text-2xs text-muted-foreground">10:43</span>
                        </div>
                        <MessageContent>
                          <p className="mb-1 leading-relaxed">
                            {isGroup
                              ? gt("Here’s a starting point:")
                              : gt("Here’s how I’d approach it:")}
                          </p>
                          <p className="text-base font-medium leading-relaxed">{response}</p>
                          <p className="mt-2 leading-relaxed text-muted-foreground">
                            {isGroup
                              ? gt("Want it to feel more playful, more premium, or more direct?")
                              : gt("We can shape it together from there.")}
                          </p>
                        </MessageContent>
                        <MessageActions>
                          <Button
                            variant="ghost-muted"
                            size="icon-xs"
                            aria-label={
                              copied ? gt("Copied example reply") : gt("Copy example reply")
                            }
                            onClick={() => {
                              void navigator.clipboard
                                .writeText(response)
                                .then(() => setCopied(true));
                            }}
                          >
                            {copied ? <CheckIcon /> : <CopyIcon />}
                          </Button>
                        </MessageActions>
                      </Message>
                    </div>
                  </div>
                  {transcript.map((message) => {
                    const text = message.parts
                      .filter((part) => part.type === "text")
                      .map((part) => part.text)
                      .join("");
                    const tools = message.parts.filter(isToolUIPart);
                    const incoming = message.role === "assistant";
                    const active = incoming && streaming && message.id === transcript.at(-1)?.id;
                    if (incoming && !text && !active && !tools.length) return null;
                    const stopped = stoppedReplies.has(`${selected}:${message.id}`);
                    const writer = isGroup ? bots[1] : bot;
                    if (incoming)
                      return (
                        <div
                          key={message.id}
                          data-message-id={message.id}
                          data-streaming={active || undefined}
                          className="space-y-2"
                        >
                          {(active || tools.length > 0) && (
                            <div className="ml-11">
                              <OpenbotPreviewTurnSteps
                                live={active}
                                tools={tools}
                                stopped={stopped}
                                agent={writer}
                                showAvatar={false}
                                compact
                                metadata={message.metadata}
                              />
                            </div>
                          )}
                          {(text || active) && (
                            <div className="flex items-start gap-3">
                              <span className="pt-1">
                                <BotAvatar
                                  seed={writer.seed}
                                  hue={writer.hue}
                                  size={32}
                                  mood="idle"
                                />
                              </span>
                              <Message from="assistant">
                                <div className="flex items-center gap-2 text-xs">
                                  <span className="font-medium">{writer.name}</span>
                                  <span className="text-2xs text-muted-foreground">
                                    {stopped ? gt("Demo stopped") : gt("Local demo")}
                                  </span>
                                </div>
                                <MessageContent>
                                  <PreviewStreamingText text={text} streaming={active} />
                                </MessageContent>
                              </Message>
                            </div>
                          )}
                        </div>
                      );
                    return (
                      <Message key={message.id} from={message.role} data-message-id={message.id}>
                        <MessageContent>
                          {message.metadata?.sampleAttachment && (
                            <span className="mb-2 flex items-center gap-2 rounded-md border p-2 text-xs">
                              <FilesIcon className="size-3.5" />
                              <T>launch-brief.md · Sample</T>
                            </span>
                          )}
                          <p className="whitespace-pre-wrap break-words leading-relaxed">{text}</p>
                        </MessageContent>
                        <span className="text-right text-2xs text-muted-foreground">
                          <T>Preview only · not sent to a bot</T>
                        </span>
                      </Message>
                    );
                  })}
                  {error && (
                    <p role="alert" className="text-xs text-destructive">
                      <T>The local demo stream stopped unexpectedly. Try again.</T>
                    </p>
                  )}
                </ConversationContent>
                <ConversationScrollButton aria-label={gt("Go to latest preview message")} />
              </Conversation>
              <div className="mx-auto w-full max-w-3xl shrink-0 px-8 pb-5 pt-3 max-sm:px-4">
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    submit();
                  }}
                  className="rounded-xl border bg-card p-2 shadow-sm"
                >
                  {attachment && (
                    <div className="mb-2 flex w-fit items-center gap-2 rounded-md border px-2 py-1 text-xs">
                      <FilesIcon className="size-3.5" />
                      launch-brief.md
                      <span className="text-2xs text-muted-foreground">
                        <T>Sample</T>
                      </span>
                      <Button
                        variant="ghost-muted"
                        size="icon-tiny"
                        aria-label={gt("Remove sample attachment")}
                        onClick={() => setAttachment(false)}
                      >
                        <XIcon />
                      </Button>
                    </div>
                  )}
                  <Textarea
                    aria-label={gt("Preview message")}
                    value={draft}
                    onChange={(e) =>
                      setDrafts((current) => ({ ...current, [selected]: e.target.value }))
                    }
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                        e.preventDefault();
                        submit();
                      }
                    }}
                    placeholder={
                      isGroup ? gt("Message the group…") : gt("Message {name}…", { name: bot.name })
                    }
                    unstyled
                    size="compact"
                    className="max-h-40 min-h-14"
                  />
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Menu>
                        <MenuTrigger
                          render={
                            <Button
                              type="button"
                              variant="ghost-muted"
                              size="icon-sm"
                              aria-label={gt("Preview attachments")}
                            />
                          }
                        >
                          <PlusIcon />
                        </MenuTrigger>
                        <MenuPopup side="top" align="start">
                          <MenuItem onClick={() => setAttachment(true)}>
                            <FilesIcon />
                            <T>Attach sample launch brief</T>
                          </MenuItem>
                        </MenuPopup>
                      </Menu>
                      <Menu>
                        <MenuTrigger
                          render={
                            <Button
                              variant="ghost-muted"
                              size="xs"
                              aria-label={gt("Preview recipient and model")}
                            />
                          }
                        >
                          {isGroup ? recipient : gt("Codex Luna")}
                          <ChevronDownIcon className="size-3" />
                        </MenuTrigger>
                        <MenuPopup side="top" align="start">
                          <MenuItem onClick={() => setRecipient("Auto · Luna Scout")}>
                            <T>Auto · Luna Scout</T>
                          </MenuItem>
                          {bots.map((item) => (
                            <MenuItem key={item.id} onClick={() => setRecipient(item.name)}>
                              <BotAvatar seed={item.seed} hue={item.hue} size={18} />
                              {item.name}
                            </MenuItem>
                          ))}
                          <MenuItem disabled>
                            <T>Model · Codex Luna</T>
                          </MenuItem>
                        </MenuPopup>
                      </Menu>
                    </div>
                    <Button
                      type="submit"
                      variant="default"
                      size="icon-sm"
                      disabled={!draft.trim() || streaming}
                      aria-label={gt("Add preview message")}
                    >
                      <ArrowUpIcon />
                    </Button>
                  </div>
                </form>
                <p className="mt-2 text-center text-2xs text-muted-foreground">
                  <T>Local streaming demo · no bot runs</T>
                </p>
              </div>
            </div>
            {tool && (
              <ElementsPreviewSidePanel
                key={tool}
                view={tool}
                onClose={() => setTool(null)}
                onView={setTool}
              />
            )}
          </div>
        </section>
      ) : (
        <ElementsPreviewPage key={page} page={page} onBack={() => setPage("Messages")} />
      )}
    </div>
  );
}
