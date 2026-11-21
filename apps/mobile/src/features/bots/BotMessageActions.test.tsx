import * as React from "react";
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vite-plus/test";

vi.mock("react-native", () => ({ Pressable: () => null, View: () => null }));
vi.mock("expo-clipboard", () => ({}));
vi.mock("./botFeedback", () => ({ selectionAsync: vi.fn() }));
vi.mock("../../components/ui/AppText", () => ({ AppText: () => null }));
vi.mock("../../components/ui/AppSymbol", () => ({ SymbolView: () => null }));
vi.mock("../../components/ui/ScreenScrollView", () => ({
  ScreenScrollView: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("../../components/ui/Sheet", () => ({
  Sheet: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("./upstream/BotChrome", () => ({ useBotPalette: vi.fn() }));
vi.mock("../../components/ui/Dialog", () => ({ confirm: vi.fn() }));
vi.mock("../../components/ui/ListActionRow", () => ({
  ListActionRow: ({ label, onPress }: { label: string; onPress: () => void }) =>
    React.createElement("button", { onClick: onPress }, label),
}));
vi.mock("../settings/components/SettingsRow", () => ({ SettingsRow: () => null }));
vi.mock("../settings/components/SettingsSection", () => ({
  SettingsSection: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("../files/FileMarkdownPreview", () => ({ useMarkdownPreviewStyles: vi.fn() }));
vi.mock("./BotReplyMotion", () => ({ BotReplyMarkdown: () => null }));

import { confirm } from "../../components/ui/Dialog";
import { BotMessageActions } from "./BotMessageActions";

it("requests destructive confirmation before deleting the message", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("React", React);
  const container = document.createElement("div");
  const root = createRoot(container);
  const onDelete = vi.fn();
  const onClose = vi.fn();
  try {
    act(() => root.render(<BotMessageActions text="Completed reply" onClose={onClose} />));
    expect(
      Array.from(container.querySelectorAll("button")).map((button) => button.textContent),
    ).not.toContain("Delete");
    act(() =>
      root.render(
        <BotMessageActions text="Completed reply" onClose={onClose} onDelete={onDelete} />,
      ),
    );
    const remove = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Delete",
    );
    expect(remove).toBeDefined();
    act(() => remove?.click());
    expect(onClose).toHaveBeenCalledOnce();
    expect(onDelete).not.toHaveBeenCalled();
    expect(confirm).toHaveBeenCalledOnce();
    const [options] = vi.mocked(confirm).mock.calls[0]!;
    expect(options).toMatchObject({ title: "Delete this message?", destructive: true });
    options.onConfirm();
    expect(onDelete).toHaveBeenCalledOnce();
  } finally {
    act(() => root.unmount());
    vi.unstubAllGlobals();
  }
});
