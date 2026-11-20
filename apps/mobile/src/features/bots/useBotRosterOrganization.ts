import { useAtomValue } from "@effect/atom-react";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils";
import { OpenbotSettingsAdminRequest, type EnvironmentId } from "@t3tools/contracts";
import { botConversationPage, channelPage } from "@t3tools/client-runtime/openbot/presentation";
import { settingsCapabilities } from "@t3tools/client-runtime/openbot/settings";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import * as Schema from "effect/Schema";
import type { Json } from "effect/Schema";
import * as Option from "effect/Option";
import * as Crypto from "expo-crypto";
import Storage from "expo-sqlite/kv-store";
import { useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useBotCachedValue } from "./botOfflineCache";
import {
  BOT_ROSTER_ORDERS,
  DEFAULT_BOT_ROSTER_ORDER,
  type BotRosterOrder,
} from "./bot-roster-order";
import { appAtomRegistry } from "../../state/atom-registry";
import { openbot } from "../../state/openbot";
import { useEnvironmentQuery } from "../../state/query";
import { environmentSession } from "../../state/session";
import { useAtomCommand } from "../../state/use-atom-command";
import { useAtomQueryRunner } from "../../state/use-atom-query-runner";

import { Pin, botRosterItemKey, type BotRosterPin } from "./bot-roster-pin";
import type { DropChange } from "./bot-roster-drag-model";

export { botRosterItemKey, type BotRosterPin } from "./bot-roster-pin";

const Pins = Schema.Struct({ items: Schema.Array(Pin), updatedAt: Schema.NullOr(Schema.String) });
const Hidden = Schema.Struct({
  agents: Schema.Array(Schema.Struct({ agentId: Schema.String, hiddenAt: Schema.String })),
});
const Section = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  parentId: Schema.optional(Schema.String),
});
export type BotRosterSection = typeof Section.Type;
const Layout = Schema.Struct({
  revision: Schema.Int,
  sections: Schema.Array(Section),
  order: Schema.Array(Schema.String),
  agentOrder: Schema.Array(Schema.String),
  agentAssignments: Schema.Record(Schema.String, Schema.String),
});
const Preferences = Schema.Struct({
  pinned: Schema.Array(Pin),
  hidden: Schema.Array(Pin),
  collapsed: Schema.optional(Schema.Array(Schema.String)),
  order: Schema.optional(Schema.Literals(BOT_ROSTER_ORDERS)),
});
type Preferences = typeof Preferences.Type;
const decodeAdminRequest = Schema.decodeUnknownOption(OpenbotSettingsAdminRequest);
const decodePins = Schema.decodeUnknownOption(Pins);
const decodeHidden = Schema.decodeUnknownOption(Hidden);
const decodeLayout = Schema.decodeUnknownOption(Layout);
const readCachedPins = (value: unknown) => Option.getOrNull(decodePins(value));
const readCachedHidden = (value: unknown) => Option.getOrNull(decodeHidden(value));
const readCachedLayout = (value: unknown) => Option.getOrNull(decodeLayout(value));
const decodeLocal = Schema.decodeUnknownOption(Schema.fromJsonString(Preferences));
const emptyPreferences: Preferences = { pinned: [], hidden: [] };
const byScope = new Map<string, Preferences>();
const listeners = new Set<() => void>();
const maxPinned = 16;

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
function readLocal(key: string) {
  const previous = byScope.get(key);
  if (previous) return previous;
  try {
    const result = decodeLocal(Storage.getItemSync(key));
    const value = Option.getOrElse(result, () => emptyPreferences);
    byScope.set(key, value);
    return value;
  } catch {
    return emptyPreferences;
  }
}

const same = (a: BotRosterPin, b: BotRosterPin) => a.kind === b.kind && a.id === b.id;

type Host = {
  environmentId: EnvironmentId;
  hostId: string;
  online: boolean;
  cacheScope: string | null;
};

export function useBotRosterOrganization({ environmentId, hostId, online, cacheScope }: Host) {
  const key = cacheScope
    ? "bots.roster.v1." + bytesToHex(sha256(utf8ToBytes(JSON.stringify([cacheScope, hostId]))))
    : null;
  const preferences = useSyncExternalStore(subscribe, () =>
    key ? readLocal(key) : emptyPreferences,
  );
  const writeLocal = (change: (value: Preferences) => Preferences) => {
    if (!key) throw new Error("This device cannot save your chat preferences.");
    const next = change(readLocal(key));
    Storage.setItemSync(key, JSON.stringify(next));
    byScope.set(key, next);
    for (const notify of listeners) notify();
  };
  const scope = {
    environmentId,
    input: { hostId, request: { operation: "compatibility.read" as const } },
  };
  const compatibility = useEnvironmentQuery(online ? openbot.readFromHost(scope) : null);
  const capabilities = settingsCapabilities(compatibility.data);
  const syncPins = capabilities.includes("sled-roster-pins-v1");
  const syncHidden = capabilities.includes("agent-hidden-v1");
  const syncSections = capabilities.includes("sidebar-folders-v1");
  const pinsInput = {
    environmentId,
    input: {
      hostId,
      request: { operation: "settings.sled-roster-pins.read" as const, parameters: {} },
    },
  };
  const hiddenInput = {
    environmentId,
    input: {
      hostId,
      request: { operation: "settings.agent-hidden.read" as const, parameters: {} },
    },
  };
  const layoutInput = {
    environmentId,
    input: {
      hostId,
      request: { operation: "settings.sidebar-folders.read" as const, parameters: {} },
    },
  };
  const pins = useEnvironmentQuery(online && syncPins ? openbot.readFromHost(pinsInput) : null);
  const hidden = useEnvironmentQuery(
    online && syncHidden ? openbot.readFromHost(hiddenInput) : null,
  );
  const layout = useEnvironmentQuery(
    online && syncSections ? openbot.readFromHost(layoutInput) : null,
  );
  const pinPermission = useAtomValue(
    openbot.adminToHost.permissionAtom(environmentId, {
      hostId,
      request: { operation: "settings.sled-roster-pins.set", parameters: { items: [] } },
    }),
  );
  const hiddenPermission = useAtomValue(
    openbot.adminToHost.permissionAtom(environmentId, {
      hostId,
      request: {
        operation: "settings.agent-hidden.set",
        parameters: { agentId: "permission", hidden: true },
      },
    }),
  );
  const sectionPermission = useAtomValue(
    openbot.adminToHost.permissionAtom(environmentId, {
      hostId,
      request: {
        operation: "settings.sidebar-folders.actions",
        parameters: { type: "create", name: "Permission" },
      },
    }),
  );
  const loadedPins = useMemo(() => readCachedPins(pins.data), [pins.data]);
  const remoteHidden = useMemo(() => readCachedHidden(hidden.data), [hidden.data]);
  const remoteLayout = useMemo(() => readCachedLayout(layout.data), [layout.data]);
  const cachedPins = useBotCachedValue({
    scope: cacheScope,
    name: `roster-pins:${hostId}`,
    live: loadedPins,
    decode: readCachedPins,
  });
  const cachedHidden = useBotCachedValue({
    scope: cacheScope,
    name: `roster-hidden:${hostId}`,
    live: remoteHidden,
    decode: readCachedHidden,
  });
  const cachedLayout = useBotCachedValue({
    scope: cacheScope,
    name: `roster-layout:${hostId}`,
    live: remoteLayout,
    decode: readCachedLayout,
  });
  const visiblePins = (online ? loadedPins?.items : cachedPins?.items) ?? preferences.pinned;
  const hostHidden =
    (online ? remoteHidden : cachedHidden)?.agents.map(({ agentId }) => agentId) ?? [];
  const hiddenKeys = new Set([
    ...preferences.hidden.map(botRosterItemKey),
    ...hostHidden.map((id) => botRosterItemKey({ kind: "agent", id })),
  ]);
  const lock = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const command = useAtomCommand(openbot.adminToHost, { reportFailure: false });
  const write = useAtomCommand(openbot.writeToHost, { reportFailure: false });
  const refresh = useAtomQueryRunner(openbot.readFromHost, { reportFailure: false, refresh: true });
  const connection = environmentSession.preparedConnectionValueAtom(environmentId);
  const canReadBot = useAtomValue(
    openbot.writeToHost.permissionAtom(environmentId, {
      hostId,
      request: {
        operation: "conversation.markRead",
        agentId: "permission",
        throughMessageId: null,
      },
    }),
  );
  const canReadGroup = useAtomValue(
    openbot.adminToHost.permissionAtom(environmentId, {
      hostId,
      request: {
        operation: "channel.markRead",
        channelId: "permission",
        operationId: "permission",
        throughSequence: 0,
      },
    }),
  );
  const canMarkRead = ({ kind }: BotRosterPin) =>
    online && (kind === "agent" ? canReadBot === true : canReadGroup === true);
  const mutate = async (
    operation: typeof OpenbotSettingsAdminRequest.Type.operation,
    parameters: Json,
  ) => {
    const active = Option.getOrNull(appAtomRegistry.get(connection));
    const input = Option.getOrNull(decodeAdminRequest({ operation, parameters }));
    if (!active || !input) throw new Error("The selected bot computer is unavailable.");
    const result = await command({ environmentId, input: { hostId, request: input } });
    if (Option.getOrNull(appAtomRegistry.get(connection)) !== active)
      throw new Error("The bot computer changed. Reopen the roster to see its latest state.");
    if (result._tag === "Failure") throw squashAtomCommandFailure(result);
    return result.value;
  };

  async function run(action: () => Promise<void> | void) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update this roster.");
    }
    lock.current = false;
    setBusy(false);
  }

  const markAllRead = (items: readonly BotRosterPin[]) =>
    run(async () => {
      const active = Option.getOrNull(appAtomRegistry.get(connection));
      if (!active) throw new Error("The selected bot computer is offline.");
      const checkConnection = () => {
        if (Option.getOrNull(appAtomRegistry.get(connection)) !== active)
          throw new Error("The bot computer changed while marking chats as read.");
      };
      // Refresh the newest item on the same host so a stale roster never clears a newer reply.
      const results = await Promise.allSettled(
        items.filter(canMarkRead).map(async ({ kind, id }) => {
          const page = await refresh({
            environmentId,
            input: {
              hostId,
              request:
                kind === "agent"
                  ? {
                      operation: "conversation.page",
                      agentId: id,
                      anchor: { type: "latest" },
                      limit: 1,
                    }
                  : { operation: "channel.read", channelId: id },
            },
          });
          if (page._tag === "Failure") throw squashAtomCommandFailure(page);
          checkConnection();
          if (kind === "agent") {
            const history = botConversationPage(page.value);
            if (history?.agentId !== id)
              throw new Error("The host returned a different conversation.");
            const latest = history.messages.at(-1);
            if (!latest) return;
            const result = await write({
              environmentId,
              input: {
                hostId,
                request: {
                  operation: "conversation.markRead",
                  agentId: id,
                  throughMessageId: latest.id,
                },
              },
            });
            if (result._tag === "Failure") throw squashAtomCommandFailure(result);
          } else {
            const history = channelPage(page.value);
            if (history?.channel.id !== id)
              throw new Error("The host returned a different group chat.");
            const result = await command({
              environmentId,
              input: {
                hostId,
                request: {
                  operation: "channel.markRead",
                  channelId: id,
                  operationId: Crypto.randomUUID(),
                  throughSequence: history.throughSequence,
                },
              },
            });
            if (result._tag === "Failure") throw squashAtomCommandFailure(result);
          }
        }),
      );
      checkConnection();
      const visibleOperations = [
        ...(items.some(({ kind }) => kind === "agent") ? ["workspace.reads" as const] : []),
        ...(items.some(({ kind }) => kind === "channel") ? ["channel.list" as const] : []),
      ];
      await Promise.all(
        visibleOperations.map((operation) =>
          refresh({ environmentId, input: { hostId, request: { operation } } }),
        ),
      );
      const failure = results.find((result) => result.status === "rejected");
      if (failure) throw failure.reason;
    });

  const canPin =
    !busy &&
    online &&
    compatibility.isSuccess &&
    (syncPins ? pinPermission && loadedPins !== null : key !== null);
  const canEditSections =
    !busy && online && syncSections && sectionPermission && remoteLayout !== null;

  return {
    busy,
    error,
    hidden: hiddenKeys,
    pinned: visiblePins,
    layout: online ? remoteLayout : cachedLayout,
    collapsed: preferences.collapsed ?? [],
    order: preferences.order ?? DEFAULT_BOT_ROSTER_ORDER,
    canMarkRead,
    markAllRead,
    canSaveOrder: key !== null,
    setOrder: (order: BotRosterOrder) =>
      run(() => writeLocal((previous) => ({ ...previous, order }))),
    toggleSection: (id: string) =>
      run(() =>
        writeLocal((previous) => ({
          ...previous,
          collapsed: previous.collapsed?.includes(id)
            ? previous.collapsed.filter((section) => section !== id)
            : [...(previous.collapsed ?? []), id],
        })),
      ),
    canPin,
    hostOwnsHide: syncHidden && hiddenPermission === true,
    hiddenAgentsStillWork: capabilities.includes("agent-hidden-work"),
    canHide: (pin: BotRosterPin) =>
      !busy &&
      (pin.kind === "agent" && hostHidden.includes(pin.id)
        ? hiddenPermission === true && remoteHidden !== null
        : key !== null || (pin.kind === "agent" && hiddenPermission === true)),
    canEditSections,
    applyDrop: (change: DropChange) =>
      run(async () => {
        if (change.pins && canPin) {
          const next = change.pins;
          if (next.length > maxPinned) throw new Error("You can pin up to 16 chats.");
          if (syncPins) {
            const active = Option.getOrNull(appAtomRegistry.get(connection));
            const latest = await refresh(pinsInput);
            if (!active || Option.getOrNull(appAtomRegistry.get(connection)) !== active)
              throw new Error("The bot computer changed before saving pins.");
            if (latest._tag === "Failure") throw squashAtomCommandFailure(latest);
            const saved = Option.getOrNull(decodePins(latest.value));
            if (
              !saved ||
              saved.items.length !== visiblePins.length ||
              !saved.items.every((item, index) => {
                const before = visiblePins[index];
                return before !== undefined && same(item, before);
              })
            )
              throw new Error("Pinned chats changed. Try the move again.");
            await mutate("settings.sled-roster-pins.set", { items: next });
            pins.refresh();
          } else {
            writeLocal((previous) => ({ ...previous, pinned: next }));
          }
        }
        if (change.move && canEditSections) {
          await mutate("settings.sidebar-folders.actions", change.move);
          layout.refresh();
        }
      }),
    pin: (pin: BotRosterPin) =>
      run(async () => {
        if (!syncPins) {
          writeLocal((previous) => ({
            ...previous,
            pinned: previous.pinned.some((item) => same(item, pin))
              ? previous.pinned.filter((item) => !same(item, pin))
              : previous.pinned.length < maxPinned
                ? [...previous.pinned, pin]
                : previous.pinned,
          }));
          return;
        }
        if (!pinPermission) return;
        const active = Option.getOrNull(appAtomRegistry.get(connection));
        if (!active) throw new Error("The selected bot computer is offline.");
        const current = await refresh(pinsInput);
        if (Option.getOrNull(appAtomRegistry.get(connection)) !== active)
          throw new Error("The bot computer changed before saving pins.");
        if (current._tag === "Failure") throw squashAtomCommandFailure(current);
        const saved = Option.getOrNull(decodePins(current.value));
        if (!saved) throw new Error("This bot computer returned unsupported pins.");
        const pinned = saved.items.some((item) => same(item, pin));
        if (!pinned && saved.items.length >= maxPinned)
          throw new Error("You can pin up to 16 chats.");
        await mutate("settings.sled-roster-pins.set", {
          items: pinned ? saved.items.filter((item) => !same(item, pin)) : [...saved.items, pin],
        });
        pins.refresh();
      }),
    setHidden: (pin: BotRosterPin, hide: boolean) =>
      run(async () => {
        if (pin.kind === "agent" && syncHidden && hiddenPermission === true) {
          await mutate("settings.agent-hidden.set", { agentId: pin.id, hidden: hide });
          hidden.refresh();
        } else {
          writeLocal((previous) => ({
            ...previous,
            hidden: hide
              ? [...previous.hidden.filter((item) => !same(item, pin)), pin]
              : previous.hidden.filter((item) => !same(item, pin)),
            pinned: hide ? previous.pinned.filter((item) => !same(item, pin)) : previous.pinned,
          }));
        }
      }),
    editSection: (action: Json) =>
      run(async () => {
        if (!syncSections || !sectionPermission) return;
        await mutate("settings.sidebar-folders.actions", action);
        layout.refresh();
      }),
  };
}
