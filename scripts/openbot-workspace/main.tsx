import { render } from "@solidjs/web";
import { Errored, createSignal } from "solid-js";
import { Toaster, toast } from "@openbot/ui";
import type { AppAppearance } from "@openbot/contracts/app-appearance";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { formatLocale, resolveLocale } from "@openbot/i18n";
import { WebWorkspace } from "../src/renderer/src/features/web-client/WebWorkspace";
import { createWebLanguagePreference } from "../src/renderer/src/features/web-client/web-language-preference";
import { StaticI18nProvider } from "../src/renderer/src/i18n-context";
import "../src/renderer/src/features/web-client/web-client.css";
import "./theme.css";
import { bridge } from "./transport";
import { createWorkspaceComputer } from "./computer";

const tokenNames: Record<string, string> = {
  "bg-canvas": "background",
  "bg-frame": "sidebar",
  "bg-sidebar": "sidebar",
  "bg-surface": "card",
  "bg-surface-raised": "muted",
  "bg-control": "muted",
  "text-primary": "foreground",
  "text-secondary": "foreground",
  "text-muted": "muted-foreground",
  border: "border",
  "border-strong": "border",
};
function Workspace(props: { port: MessagePort; accountId: string; initial: unknown }) {
  const language = createWebLanguagePreference();
  const [appearance, setAppearance] = createSignal<AppAppearance>("system");
  function applyTheme(value: unknown) {
    if (!isDynamicRecord(value) || (value.theme !== "light" && value.theme !== "dark")) return;
    // oxlint-disable-next-line react/immutability -- SolidJS component runs once on mount, not on React re-renders.
    document.documentElement.dataset.openbotColorScheme = value.theme;
    setAppearance(value.appearance === "system" ? "system" : value.theme);
    if (!isDynamicRecord(value.tokens)) return;
    for (const [target, source] of Object.entries(tokenNames)) {
      const color = value.tokens[source];
      if (typeof color === "string" && CSS.supports("color", color))
        document.documentElement.style.setProperty(`--openbot-${target}`, color);
    }
  }
  applyTheme(props.initial);
  const { call, createRuntime } = bridge(props.port, applyTheme);
  const computer = createWorkspaceComputer(call);
  return (
    <StaticI18nProvider
      locale={resolveLocale(language.language(), navigator.language)}
      formatLocale={formatLocale(language.language(), navigator.language)}
    >
      <div class="web-app">
        <Toaster />
        <Errored
          // oxlint-disable-next-line react/no-unstable-nested-components -- SolidJS Errored fallback prop runs outside React reconciliation.
          fallback={() => (
            <p role="alert">
              The Bots workspace could not load. Reload this page, or use the legacy workspace.
            </p>
          )}
        >
          <WebWorkspace
            computer={{
              available: isDynamicRecord(props.initial) && props.initial.computerAvailable === true,
              open: computer.open,
            }}
            accountId={props.accountId}
            accountName="Sled"
            accountFetch={async () => {
              throw new Error("Account administration is managed in Sled Connections");
            }}
            onSessionCheck={async () => {
              await call("hosts");
            }}
            onLogout={async () => {
              throw new Error(
                "Sign out through Sled Connections. This workspace uses your Sled session.",
              );
            }}
            language={language.language()}
            onChangeLanguage={language.setLanguage}
            appearance={appearance()}
            onChangeAppearance={(value) => {
              void call("theme", { appearance: value }).catch(() =>
                toast.error("Could not save the Sled appearance preference."),
              );
            }}
            createRuntime={createRuntime}
          />
          <computer.View />
        </Errored>
      </div>
    </StaticI18nProvider>
  );
}
function receive(event: MessageEvent) {
  if (
    event.origin !== location.origin ||
    event.source !== parent ||
    event.data?.type !== "sled:bots:connect" ||
    typeof event.data.accountId !== "string" ||
    !event.ports[0]
  )
    return;
  window.removeEventListener("message", receive);
  const root = document.getElementById("root")!;
  root.textContent = "";
  const dispose = render(
    () => (
      <Workspace port={event.ports[0]!} accountId={event.data.accountId} initial={event.data} />
    ),
    root,
  );
  window.addEventListener("pagehide", () => dispose(), { once: true });
}
window.addEventListener("message", receive);
parent.postMessage({ type: "sled:bots:ready" }, location.origin);
