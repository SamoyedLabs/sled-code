import * as Schema from "effect/Schema";
import { OpenbotConversationSearchPage, OpenbotConversationFilePage } from "@t3tools/contracts";
import { useLocation, useNavigate } from "@tanstack/react-router";
import {
  BotIcon,
  MessagesSquareIcon,
  SearchIcon,
  ListTodoIcon,
  Repeat2Icon,
  GitBranchIcon,
  CalendarDaysIcon,
  StoreIcon,
  BellIcon,
  PlusIcon,
} from "lucide-react";
import { useEnvironments, usePrimaryEnvironmentId } from "../state/environments";
import { useDebouncedValue } from "../state/queries";
import { useEnvironmentQuery } from "../state/query";
import { openbot } from "../state/openbot";
import { channelList } from "@t3tools/client-runtime/openbot/presentation";
import { useBotRoutineIndex } from "./bots/useBotRoutineIndex";
import { SourceAgentAvatar } from "./bots/SourceAgentAvatar";
import { randomUUID } from "../lib/utils";
import type { CommandPaletteActionItem, CommandPaletteGroup } from "./CommandPalette.logic";
import { validateBotWorkspaceSearch, type BotWorkspacePage } from "./bots/workspaceNavigation";
import { useGT } from "gt-react";

const decodeMessageMatches = Schema.decodeUnknownOption(OpenbotConversationSearchPage);
const decodeFileMatches = Schema.decodeUnknownOption(OpenbotConversationFilePage);
export function useBotCommandPaletteGroups(
  query: string,
  enabled = true,
): readonly CommandPaletteGroup[] {
  const gt = useGT();
  const primary = usePrimaryEnvironmentId();
  const search = useLocation({ select: (location) => validateBotWorkspaceSearch(location.search) });
  const { environments } = useEnvironments();
  const environmentId =
    environments.find((item) => item.environmentId === search.machine)?.environmentId ?? primary;
  const navigate = useNavigate();
  const host = useEnvironmentQuery(
    enabled && environmentId ? openbot.status({ environmentId, input: {} }) : null,
  );
  const ready = enabled && host.data?.state === "ready" && host.data.hostId;
  const agents = useEnvironmentQuery(
    environmentId && ready ? openbot.agents({ environmentId, input: {} }) : null,
  );
  const channels = useEnvironmentQuery(
    environmentId && ready
      ? openbot.readFromHost({
          environmentId,
          input: { hostId: ready, request: { operation: "channel.list" } },
        })
      : null,
  );
  const settledQuery = useDebouncedValue(query, 150);
  const searchEnabled =
    settledQuery === query &&
    query.trim().length >= 2 &&
    query.length <= 255 &&
    environmentId &&
    ready;
  const messages = useEnvironmentQuery(
    searchEnabled
      ? openbot.readFromHost({
          environmentId,
          input: { hostId: ready, request: { operation: "conversation.search", query, limit: 10 } },
        })
      : null,
  );
  const files = useEnvironmentQuery(
    searchEnabled ? openbot.fileSearch({ environmentId, input: { hostId: ready, query } }) : null,
  );
  const routines = useBotRoutineIndex({
    enabled: Boolean(searchEnabled),
    environmentId: environmentId ?? null,
    hostId: ready || null,
    agents: agents.data ?? [],
    channels: channelList(channels.data) ?? [],
  });
  const messagePage = decodeMessageMatches(searchEnabled ? messages.data : undefined);
  const filePage = decodeFileMatches(searchEnabled ? files.data : undefined);
  const go = async (
    page: BotWorkspacePage,
    target?: {
      botAgent?: string;
      botChannel?: string;
      botMessage?: string;
      botTask?: string;
      botRoutine?: string;
      botCreate?: "group";
    },
  ) => {
    await navigate({
      to: "/bots",
      search: {
        ...(environmentId ? { machine: environmentId } : {}),
        botPage: page,
        ...(ready ? { botHost: ready } : {}),
        ...target,
        botVisit: randomUUID(),
      },
    });
  };
  const actions: CommandPaletteActionItem[] = (
    [
      ["chats", "Open Bots", BotIcon],
      ["search", "Search bot messages & files", SearchIcon],
      ["manage", "New bot", PlusIcon],
      ["tasks", "Bot tasks", ListTodoIcon],
      ["flows", "Bot routines", Repeat2Icon],
      ["workflows", "Workflows", GitBranchIcon],
      ["schedule", "Schedule", CalendarDaysIcon],
      ["marketplace", "Marketplace", StoreIcon],
      ["attention", "Needs attention", BellIcon],
    ] as const
  ).map(([page, title, Icon]) => ({
    kind: "action",
    value: `bot-action:${page}`,
    title,
    searchTerms: [title, "bots", "openbot"],
    icon: <Icon className="size-4" />,
    run: () => go(page),
  }));
  actions.splice(3, 0, {
    kind: "action",
    value: "bot-action:new-group",
    title: gt("New group chat"),
    searchTerms: ["new", "group", "chat", "gc", "bots"],
    icon: <MessagesSquareIcon className="size-4" />,
    run: () => go("chats", { botCreate: "group" }),
  });
  const conversations: CommandPaletteActionItem[] = [
    ...(agents.data ?? []).map((agent): CommandPaletteActionItem => ({
      kind: "action",
      value: `bot:${agent.id}`,
      title: agent.name,
      description: gt("Bot conversation"),
      searchTerms: [agent.name, "bot", "chat"],
      icon: <SourceAgentAvatar agent={agent} size={24} />,
      run: () => go("chats", { botAgent: agent.id }),
    })),
    ...(channelList(channels.data) ?? []).map((channel): CommandPaletteActionItem => ({
      kind: "action",
      value: `bot-channel:${channel.id}`,
      title: channel.name,
      description: gt("Group conversation"),
      searchTerms: [channel.name, "group", "chat", "bots"],
      icon: <MessagesSquareIcon className="size-4" />,
      run: () => go("chats", { botChannel: channel.id }),
    })),
  ];
  const content: CommandPaletteActionItem[] = [
    ...(messagePage._tag === "Some"
      ? messagePage.value.results.map((hit): CommandPaletteActionItem => ({
          kind: "action",
          value: `bot-message:${hit.agentId}:${hit.message.id}`,
          title: hit.message.text.slice(0, 100) || gt("Bot message"),
          description: gt("Bot message · {value}", {
            value: agents.data?.find((agent) => agent.id === hit.agentId)?.name ?? "Conversation",
          }),
          searchTerms: [query, hit.message.text],
          icon: <MessagesSquareIcon className="size-4" />,
          run: () =>
            go("chats", {
              botAgent: hit.agentId,
              botMessage: hit.message.id,
              ...(hit.taskId ? { botTask: hit.taskId } : {}),
            }),
        }))
      : []),
    ...(filePage._tag === "Some"
      ? filePage.value.results.slice(0, 10).map((hit): CommandPaletteActionItem => ({
          kind: "action",
          value: `bot-file:${hit.agentId}:${hit.messageId}:${hit.attachment.id}`,
          title: hit.attachment.name,
          description: gt("Bot attachment · Open source message"),
          searchTerms: [query, hit.attachment.name],
          icon: <SearchIcon className="size-4" />,
          run: () =>
            go("chats", {
              botAgent: hit.agentId,
              botMessage: hit.messageId,
              ...(hit.taskId ? { botTask: hit.taskId } : {}),
            }),
        }))
      : []),
    ...(searchEnabled && (messages.error || files.error || routines.failed)
      ? [
          {
            kind: "action" as const,
            value: "bot-search-error",
            title: gt("Some bot search results could not load"),
            description: gt("Check the selected host connection and search permissions."),
            searchTerms: [query],
            icon: <SearchIcon className="size-4" />,
            disabled: true,
            run: async () => {},
          },
        ]
      : []),
  ];
  return [
    { value: "bot-actions", label: gt("Bots"), items: actions },
    ...(routines.items.length
      ? [
          {
            value: "bot-routines",
            label: gt("Bot routines"),
            items: routines.items.map((routine) => ({
              kind: "action" as const,
              value: `bot-routine:${routine.agentId ?? routine.channelId}:${routine.id}`,
              title: routine.name,
              description: gt("Routine · {detail}", { detail: routine.detail }),
              searchTerms: [routine.name, routine.detail, "routine", "schedule"],
              icon: <Repeat2Icon className="size-4" />,
              run: () =>
                go(
                  "chats",
                  routine.agentId
                    ? { botAgent: routine.agentId, botRoutine: routine.id }
                    : routine.channelId
                      ? { botChannel: routine.channelId }
                      : {},
                ),
            })),
          },
        ]
      : []),
    ...(content.length
      ? [{ value: "bot-content", label: gt("Bot messages & files"), items: content }]
      : []),
    ...(conversations.length
      ? [{ value: "bot-conversations", label: gt("Bot conversations"), items: conversations }]
      : []),
  ];
}
