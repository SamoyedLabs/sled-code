import { type ReactNode } from "react";
import { Pressable, View } from "react-native";
import { SymbolView } from "../../components/ui/AppSymbol";
import * as Dialog from "../../components/ui/Dialog";
import { Menu } from "../../components/ui/Menu";
import { ScreenScrollView } from "../../components/ui/ScreenScrollView";
import { Sheet } from "../../components/ui/Sheet";
import { BotIconButton, useBotPalette } from "./upstream/BotChrome";
import { OpenBotText as Text } from "./upstream/OpenBotTypography";
import { typeScale } from "./upstream/openbot-mobile/shared/lib/type-scale";
import {
  mobileSidebarRows,
  mobileChatOrderSortsSections,
} from "./upstream/openbot-mobile/workspace/sidebar-layout";
import {
  BotRosterDrag,
  RosterDragRow,
  RosterDropArea,
  pinDropKey,
  sectionDropKey,
  type RosterDragItem,
  type RosterDragScroll,
} from "./BotRosterDrag";
import {
  botRosterItemKey,
  type BotRosterPin,
  type BotRosterSection,
  type useBotRosterOrganization,
} from "./useBotRosterOrganization";

type Organization = ReturnType<typeof useBotRosterOrganization>;
export type BotRosterPresentation = {
  pin: BotRosterPin;
  name: string;
  unread: number;
  updatedAt?: string | null | undefined;
  needsInput: boolean;
  avatar: (size: number) => ReactNode;
  open: () => void;
  row: ReactNode;
};

export function requestBotRosterSection(
  organization: Organization,
  action: { section?: BotRosterSection; parentId?: string } = {},
) {
  const section = action.section;
  Dialog.prompt({
    title: section ? "Rename section" : "New section",
    initialValue: section?.name ?? "",
    placeholder: "Section name",
    confirmText: section ? "Save" : "Create",
    onConfirm: (value) => {
      const name = value.trim().slice(0, 40);
      if (!name) return;
      void organization.editSection(
        section
          ? { type: "rename", sectionId: section.id, name }
          : { type: "create", name, ...(action.parentId ? { parentId: action.parentId } : {}) },
      );
    },
  });
}

export function BotRosterGroups({
  items,
  organization,
  filtered,
  dragging,
  scroll,
}: {
  items: readonly BotRosterPresentation[];
  organization: Organization;
  filtered: boolean;
  dragging: boolean;
  scroll: RosterDragScroll;
}) {
  const p = useBotPalette();
  const shown = items.filter(({ pin }) => !organization.hidden.has(botRosterItemKey(pin)));
  if (filtered) return shown.map((item) => item.row);
  const layout = organization.layout;
  const itemsByKey = new Map(shown.map((item) => [botRosterItemKey(item.pin), item]));
  const pinned = organization.pinned
    .filter(({ kind }) => kind === "agent")
    .concat(organization.pinned.filter(({ kind }) => kind === "channel"))
    .flatMap((pin) => {
      const item = itemsByKey.get(botRosterItemKey(pin));
      return item ? [item] : [];
    });
  const pinnedKeys = new Set(pinned.map(({ pin }) => botRosterItemKey(pin)));
  const sections = new Map(layout?.sections.map((section) => [section.id, section]));
  const { waiting, unread, entries } = mobileSidebarRows(
    layout,
    shown.filter(({ pin }) => !pinnedKeys.has(botRosterItemKey(pin))),
    new Set(organization.collapsed),
    organization.order,
  );
  const dragItems: RosterDragItem[] = [];
  const renderRow = (item: BotRosterPresentation, sectionId: string | null) => {
    dragItems.push({ kind: "chat", chat: item.pin, sectionId });
    return (
      <RosterDragRow
        key={botRosterItemKey(item.pin)}
        place="row"
        source={{ chat: item.pin, pinned: false, name: item.name, preview: item.avatar(40) }}
      >
        {item.row}
      </RosterDragRow>
    );
  };
  const renderSection = (entry: Extract<(typeof entries)[number], { kind: "section" }>) => {
    const { id, name, parentId, ancestorIds, collapsed } = entry.section;
    const section = sections.get(id);
    dragItems.push({ kind: "section", id: id, open: !collapsed });
    return (
      <View key={id}>
        <RosterDropArea target={sectionDropKey(id)}>
          <View className="min-h-11 flex-row items-center gap-1 px-5">
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={name}
              accessibilityState={{ expanded: !collapsed }}
              onPress={() => void organization.toggleSection(id)}
              className="min-h-11 flex-1 flex-row items-center gap-2"
            >
              <SymbolView
                name={collapsed ? "chevron.right" : "chevron.down"}
                size={13}
                tintColor={p.muted}
              />
              <Text numberOfLines={1} style={{ color: p.muted, fontSize: 13, flexShrink: 1 }}>
                {name}
              </Text>
            </Pressable>
            {section && organization.canEditSections && (
              <Menu
                actions={[
                  { id: "rename", title: "Rename" },
                  ...(ancestorIds.length < 2 ? [{ id: "subfolder", title: "Add subsection" }] : []),
                  { id: "up", title: "Move up" },
                  { id: "down", title: "Move down" },
                  ...(parentId ? [{ id: "top", title: "Move to top level" }] : []),
                  { id: "delete", title: "Delete section", attributes: { destructive: true } },
                ]}
                onPressAction={({ nativeEvent }) => {
                  switch (nativeEvent.event) {
                    case "rename":
                      requestBotRosterSection(organization, { section });
                      break;
                    case "subfolder":
                      requestBotRosterSection(organization, { parentId: id });
                      break;
                    case "up":
                    case "down":
                      void organization.editSection({
                        type: "move",
                        sectionId: id,
                        direction: nativeEvent.event,
                      });
                      break;
                    case "top":
                      void organization.editSection({
                        type: "nest",
                        sectionId: id,
                        parentId: null,
                        beforeSectionId: null,
                      });
                      break;
                    case "delete":
                      Dialog.confirm({
                        title: "Delete this section?",
                        message: "The chats in this section stay on this server.",
                        confirmText: "Delete section",
                        destructive: true,
                        onConfirm: () =>
                          void organization.editSection({ type: "delete", sectionId: id }),
                      });
                      break;
                  }
                }}
              >
                <BotIconButton label={`${section.name} section menu`} icon="ellipsis" />
              </Menu>
            )}
          </View>
        </RosterDropArea>
      </View>
    );
  };
  const inputRows = waiting.map((item) => renderRow(item, null));
  const unreadRows = unread.map((item) => renderRow(item, null));
  const normalRows = entries.map((entry) =>
    entry.kind === "section" ? renderSection(entry) : renderRow(entry.chat, entry.sectionId),
  );
  const canOrder =
    organization.canEditSections && !mobileChatOrderSortsSections(organization.order);
  return (
    <BotRosterDrag
      items={dragItems}
      pins={organization.pinned}
      canPin={organization.canPin && organization.pinned.length < 16}
      layout={canOrder ? layout : null}
      scroll={scroll}
      onDrop={organization.applyDrop}
    >
      {(pinned.length > 0 || dragging) && (
        <RosterDropArea target={pinDropKey}>
          <>
            <Text style={{ color: p.muted, fontSize: 13, marginHorizontal: 20, marginTop: 8 }}>
              Pinned
            </Text>
            <View className="flex-row flex-wrap px-4 py-2">
              {!pinned.length && (
                <Text style={{ color: p.muted, padding: 12 }}>Drop here to pin</Text>
              )}
              {pinned.map((item) => (
                <View key={botRosterItemKey(item.pin)} className="w-1/4">
                  <RosterDragRow
                    place="pin"
                    source={{
                      chat: item.pin,
                      pinned: true,
                      name: item.name,
                      preview: item.avatar(40),
                    }}
                  >
                    <Menu
                      shouldOpenOnLongPress
                      actions={[
                        {
                          id: "unpin",
                          title: "Unpin chat",
                          attributes: { disabled: !organization.canPin },
                        },
                      ]}
                      onPressAction={() => void organization.pin(item.pin)}
                    >
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`${item.name}, pinned`}
                        onPress={item.open}
                        className="min-h-20 items-center gap-1.5 px-1 py-2 active:opacity-60"
                      >
                        {item.avatar(48)}
                        <Text
                          numberOfLines={1}
                          style={{ color: p.text, fontSize: 12, maxWidth: "100%" }}
                        >
                          {item.name}
                        </Text>
                      </Pressable>
                    </Menu>
                  </RosterDragRow>
                </View>
              ))}
            </View>
          </>
        </RosterDropArea>
      )}
      {waiting.length > 0 && (
        <>
          <RosterStatusHeader count={waiting.length} waiting />
          {inputRows}
        </>
      )}
      {unread.length > 0 && (
        <>
          <RosterStatusHeader count={unread.length} />
          {unreadRows}
        </>
      )}
      {normalRows}
    </BotRosterDrag>
  );
}

function RosterStatusHeader({ count, waiting = false }: { count: number; waiting?: boolean }) {
  const p = useBotPalette();
  const title = waiting ? "Needs you" : "Unread";
  const formattedCount = count.toLocaleString();
  return (
    <View
      accessible
      accessibilityRole="header"
      accessibilityLabel={`${title}, ${formattedCount}`}
      className="flex-row items-center gap-1.5 px-5 pb-1.5 pt-5"
    >
      <Text style={{ ...typeScale.caption, color: p.muted, fontWeight: "500" }}>{title}</Text>
      <View
        className="h-5 min-w-5 items-center justify-center rounded-full px-1.5"
        style={{ backgroundColor: waiting ? p.warning : p.control }}
      >
        <Text style={{ ...typeScale.small, color: waiting ? p.canvas : p.muted, fontWeight: "600" }}>
          {formattedCount}
        </Text>
      </View>
    </View>
  );
}

export function BotHiddenChats({
  items,
  organization,
  onClose,
}: {
  items: readonly BotRosterPresentation[];
  organization: Organization;
  onClose: () => void;
}) {
  const p = useBotPalette();
  const hidden = items.filter(({ pin }) => organization.hidden.has(botRosterItemKey(pin)));
  return (
    <Sheet title="Hidden chats" onClose={onClose}>
      <ScreenScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerClassName="gap-4 px-5 pb-6 pt-4"
      >
        {organization.error && (
          <Text accessibilityRole="alert" style={{ color: p.text }}>
            {organization.error}
          </Text>
        )}
        {hidden.length === 0 && <Text style={{ color: p.muted }}>No hidden chats</Text>}
        {hidden.map((item) => (
          <View
            key={botRosterItemKey(item.pin)}
            className="min-h-16 flex-row items-center gap-2 rounded-2xl px-3"
            style={{ backgroundColor: p.control }}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Open ${item.name}`}
              className="min-h-14 min-w-0 flex-1 flex-row items-center gap-2"
              onPress={() => {
                onClose();
                item.open();
              }}
            >
              {item.avatar(40)}
              <Text numberOfLines={1} style={{ color: p.text, flexShrink: 1 }}>
                {item.name}
              </Text>
            </Pressable>
            {organization.canHide(item.pin) && (
              <BotIconButton
                label={`Show ${item.name}`}
                icon="eye"
                onPress={() => void organization.setHidden(item.pin, false)}
              />
            )}
          </View>
        ))}
      </ScreenScrollView>
    </Sheet>
  );
}
