import { useAtomValue } from "@effect/atom-react";
import {
  resolveEnvironmentMachineKind,
  type EnvironmentId,
  type EnvironmentMachineKind,
} from "@t3tools/contracts";
import Storage from "expo-sqlite/kv-store";
import { useGT } from "gt-react-native";
import { useState } from "react";
import { Image, Modal, Pressable, ScrollView, useWindowDimensions, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";

import { EnvironmentMachineSymbol } from "../../components/EnvironmentMachineSymbol";
import { AppActivityIndicator } from "../../components/ui/AppActivityIndicator";
import { SymbolView } from "../../components/ui/AppSymbol";
import { AppText } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { IconButton } from "../../components/ui/IconButton";
import { SegmentedControl } from "../../components/ui/SegmentedControl";
import { cn } from "../../lib/cn";
import { MOBILE_SHAPE } from "../../lib/designTokens";
import { serverEnvironment } from "../../state/server";

type Layout = "tiles" | "list";
type PickerSection = "sled" | "saved" | "setup";
export type RemoteDesktopPickerAction =
  | "connect"
  | "select"
  | "enable"
  | "reconnect"
  | "refreshAccess";

const LAYOUT_KEY = "remote-desktop-computer-picker-layout";

function readSavedLayout(): Layout {
  try {
    return Storage.getItemSync(LAYOUT_KEY) === "list" ? "list" : "tiles";
  } catch {
    return "tiles";
  }
}

export interface RemoteDesktopPickerComputer {
  readonly id: EnvironmentId;
  readonly name: string;
  readonly detail?: string | undefined;
  readonly preview?: string | undefined;
  readonly section: PickerSection;
  readonly machine?: EnvironmentMachineKind | undefined;
  readonly status: string;
  readonly action: RemoteDesktopPickerAction | undefined;
  readonly selected?: boolean;
  readonly busy: boolean;
  readonly onPress: () => void;
}

interface PickerProps {
  readonly visible: boolean;
  readonly inline: boolean;
  readonly title: string;
  readonly computers: readonly RemoteDesktopPickerComputer[];
  readonly emptyMessage: string;
  readonly discoveryError: string | null;
  readonly selectionError: string | null;
  readonly onClose: () => void;
  readonly onAddComputer: () => void;
  readonly onDisconnect: (() => void) | undefined;
}

export function RemoteDesktopComputerPicker(props: PickerProps) {
  const gt = useGT();
  const [layout, setLayout] = useState<Layout>(readSavedLayout);
  const { width, fontScale } = useWindowDimensions();
  const twoColumns = width >= 320 && fontScale < 1.4;
  const firstLayoutSection = props.computers.some((computer) => computer.section === "sled")
    ? "sled"
    : "saved";
  const selectLayout = (next: Layout) => {
    setLayout(next);
    try {
      Storage.setItemSync(LAYOUT_KEY, next);
    } catch {
      // The picker still works if the layout preference can't be saved.
    }
  };
  const layouts = [
    { value: "tiles", label: gt("Tiles") },
    { value: "list", label: gt("List") },
  ] as const;
  const sections: readonly { readonly id: PickerSection; readonly title: string }[] = [
    { id: "sled", title: gt("Sled Connect") },
    { id: "saved", title: gt("Saved computers") },
    { id: "setup", title: gt("Needs setup") },
  ];

  const content = (
    <SafeAreaView
      edges={props.inline ? ["top", "left", "right", "bottom"] : ["bottom"]}
      style={{ flex: 1 }}
      className="bg-sheet"
    >
      <View className="flex-row items-center gap-3 px-5 pt-3 pb-1">
        <IconButton
          icon="xmark"
          variant="tonal"
          accessibilityLabel={gt("Close computers")}
          onPress={props.onClose}
        />
        <AppText
          accessibilityRole="header"
          className="min-w-0 flex-1 text-center font-t3-bold"
          textRole="headline"
        >
          {props.title}
        </AppText>
        <IconButton
          icon="plus"
          variant="tonal"
          accessibilityLabel={gt("Add computer")}
          onPress={props.onAddComputer}
        />
      </View>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerClassName="mx-auto w-full max-w-[704px] gap-5 px-5 pt-4 pb-5"
      >
        {props.computers.length === 0 ? (
          <View
            className="items-center gap-2 bg-grouped-card px-5 py-7"
            style={{ borderCurve: "continuous", borderRadius: MOBILE_SHAPE.group.ios }}
          >
            <SymbolView name="desktopcomputer" size={24} tintColorClassName="accent-icon-muted" />
            <AppText textRole="footnote" className="text-center text-foreground-muted">
              {props.emptyMessage}
            </AppText>
          </View>
        ) : null}

        {sections.map((section) => {
          const computers = props.computers.filter((computer) => computer.section === section.id);
          if (computers.length === 0) return null;
          const isTiles = layout === "tiles" && section.id !== "setup";
          return (
            <View key={section.id} className="gap-2">
              <View className="flex-row items-center justify-between gap-3">
                <AppText
                  accessibilityRole="header"
                  textRole="footnote"
                  className={cn(
                    "min-w-0 flex-1 px-1 font-t3-bold text-foreground-muted",
                    section.id === "sled" && "uppercase",
                  )}
                >
                  {section.title}
                </AppText>
                {section.id === firstLayoutSection ? (
                  <SegmentedControl
                    className="w-30"
                    options={layouts}
                    selected={layout}
                    onSelect={selectLayout}
                    size="compact"
                  />
                ) : null}
              </View>
              <View
                className={
                  isTiles
                    ? "flex-row flex-wrap justify-between gap-y-3"
                    : "overflow-hidden bg-grouped-card"
                }
                style={
                  isTiles
                    ? undefined
                    : { borderCurve: "continuous", borderRadius: MOBILE_SHAPE.group.ios }
                }
              >
                {computers.map((computer, index) => (
                  <PickerItem
                    key={computer.id}
                    computer={computer}
                    tile={isTiles}
                    halfWidth={isTiles && twoColumns}
                    divider={!isTiles && index > 0}
                  />
                ))}
              </View>
            </View>
          );
        })}
        {(
          [
            { key: "discovery", error: props.discoveryError },
            { key: "selection", error: props.selectionError },
          ] as const
        ).map(({ key, error }) =>
          error ? (
            <AppText
              key={key}
              textRole="footnote"
              accessibilityRole="alert"
              className="text-foreground-muted"
            >
              {error}
            </AppText>
          ) : null,
        )}
      </ScrollView>
      {props.onDisconnect ? (
        <View className="flex-row px-5 pt-2 pb-3">
          <Button label={gt("Disconnect")} size="compact" onPress={props.onDisconnect} />
        </View>
      ) : null}
    </SafeAreaView>
  );
  if (props.inline) {
    return props.visible ? <View className="absolute inset-0 bg-sheet">{content}</View> : null;
  }
  return (
    <Modal
      visible={props.visible}
      onRequestClose={props.onClose}
      presentationStyle="pageSheet"
      animationType="slide"
    >
      <SafeAreaProvider>{content}</SafeAreaProvider>
    </Modal>
  );
}

function usePickerActionLabel(action: RemoteDesktopPickerAction | undefined): string | undefined {
  const gt = useGT();
  switch (action) {
    case "connect":
      return gt("Connect");
    case "select":
      return gt("Select");
    case "enable":
      return gt("Enable");
    case "reconnect":
      return gt("Reconnect");
    case "refreshAccess":
      return gt("Refresh access");
    case undefined:
      return undefined;
  }
}

function PickerItem({
  computer,
  tile,
  halfWidth,
  divider,
}: {
  readonly computer: RemoteDesktopPickerComputer;
  readonly tile: boolean;
  readonly halfWidth: boolean;
  readonly divider: boolean;
}) {
  const config = useAtomValue(serverEnvironment.configValueAtom(computer.id));
  const machine = config ? resolveEnvironmentMachineKind(config) : (computer.machine ?? "desktop");
  const action = computer.action;
  const actionLabel = usePickerActionLabel(action);
  return (
    <Pressable
      accessibilityRole={action ? "button" : undefined}
      accessibilityLabel={[
        actionLabel ? `${actionLabel} ${computer.name}` : computer.name,
        computer.detail,
        computer.status,
      ]
        .filter(Boolean)
        .join(", ")}
      accessibilityState={{ selected: computer.selected, busy: computer.busy }}
      disabled={!action}
      onPress={action ? computer.onPress : undefined}
      className={cn(
        "bg-grouped-card",
        tile && "overflow-hidden",
        halfWidth ? "w-[48.5%]" : "w-full",
        computer.selected && "bg-thread-selected",
        action && "active:opacity-70",
      )}
      style={tile ? { borderCurve: "continuous", borderRadius: MOBILE_SHAPE.group.ios } : undefined}
    >
      {divider ? <View className="mx-4 h-px bg-border-subtle" /> : null}
      {tile ? (
        <View className="aspect-[1.38] items-center justify-center bg-secondary">
          {computer.preview ? (
            <Image
              source={{ uri: computer.preview }}
              className="h-full w-full"
              resizeMode="contain"
            />
          ) : (
            <EnvironmentMachineSymbol
              kind={machine}
              size={48}
              tintColorClassName="accent-foreground-muted"
            />
          )}
        </View>
      ) : null}
      <View className="min-h-16 flex-row items-center gap-3 px-4 py-3">
        {tile ? null : (
          <EnvironmentMachineSymbol
            kind={machine}
            size={20}
            tintColorClassName="accent-foreground-muted"
          />
        )}
        <View className="min-w-0 flex-1 gap-0.5">
          <AppText className="font-t3-bold" numberOfLines={tile ? 2 : undefined}>
            {computer.name}
          </AppText>
          {computer.detail ? (
            <AppText
              textRole="caption"
              className="text-foreground-muted"
              numberOfLines={tile ? 2 : undefined}
            >
              {computer.detail}
            </AppText>
          ) : null}
          <AppText textRole="caption" className="text-foreground-muted">
            {computer.status}
          </AppText>
        </View>
        <PickerItemAction computer={computer} actionLabel={actionLabel} />
      </View>
    </Pressable>
  );
}

function PickerItemAction({
  computer,
  actionLabel,
}: {
  readonly computer: RemoteDesktopPickerComputer;
  readonly actionLabel: string | undefined;
}) {
  const action = computer.action;
  if (computer.busy && !action) {
    return <AppActivityIndicator colorClassName="accent-foreground-muted" />;
  }
  if (!action || !actionLabel) return null;
  if (action === "connect" || action === "select") {
    return (
      <View className="size-7 items-center justify-center rounded-full bg-screen">
        <SymbolView
          name={computer.selected ? "checkmark" : "arrow.up.right"}
          size={13}
          tintColorClassName="accent-primary-text"
        />
      </View>
    );
  }
  return (
    <AppText
      textRole="caption"
      className="max-w-[40%] shrink text-right font-t3-medium text-primary-text"
    >
      {actionLabel}
    </AppText>
  );
}
