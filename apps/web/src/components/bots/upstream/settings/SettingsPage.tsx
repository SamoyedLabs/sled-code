import { observeResize } from "../../../../lib/observeResize";
/* oxlint-disable shadcn/no-unknown-classes -- Pinned OpenBot selectors are supplied by the source stylesheets. */
import { useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import {
  Bell,
  Bot,
  CircleArrowDown,
  CreditCard,
  Mic,
  MousePointer2,
  PanelTop,
  Settings,
  Smartphone,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import "./settings-adapter.css";
import "./SettingsParts";
import { m } from "../../../../i18n/messages";
import { msg, useGT } from "gt-react";
export type AppSettingsTab =
  | "general"
  | "agents"
  | "profile"
  | "notifications"
  | "voice"
  | "dynamic-island"
  | "computer-use"
  | "billing"
  | "mobile-connect"
  | "updates";
export const appSettingsSections: readonly {
  id: AppSettingsTab;
  title: string;
  description: string;
  icon: LucideIcon;
}[] = [
  {
    id: "general",
    title: m(msg("General")),
    description: m(msg("Control how OpenBot behaves on this computer.")),
    icon: Settings,
  },
  {
    id: "agents",
    title: m(msg("Agents")),
    description: m(
      msg("Choose what the agents on this computer can do when you do not set it for an agent."),
    ),
    icon: Bot,
  },
  {
    id: "profile",
    title: m(msg("Profile")),
    description: m(msg("Manage how you appear in OpenBot.")),
    icon: UserRound,
  },
  {
    id: "notifications",
    title: m(msg("Notifications")),
    description: m(msg("Choose how OpenBot alerts you.")),
    icon: Bell,
  },
  {
    id: "voice",
    title: m(msg("Voice")),
    description: m(
      msg(
        "Dictation in the message box. Local models run on this computer; ElevenLabs runs in the cloud.",
      ),
    ),
    icon: Mic,
  },
  {
    id: "dynamic-island",
    title: m(msg("Dynamic Island")),
    description: m(msg("Choose when the island shows and how large it is.")),
    icon: PanelTop,
  },
  {
    id: "computer-use",
    title: m(msg("Computer Use")),
    description: m(
      msg(
        "Let agents on this computer's OpenBot see and use its apps. Agents on another server use that server's computer.",
      ),
    ),
    icon: MousePointer2,
  },
  {
    id: "billing",
    title: m(msg("Billing")),
    description: m(msg("License, server plans, payment method and invoices.")),
    icon: CreditCard,
  },
  {
    id: "mobile-connect",
    title: m(msg("Mobile Connect")),
    description: m(msg("Sign in securely on your phone.")),
    icon: Smartphone,
  },
  {
    id: "updates",
    title: m(msg("Updates")),
    description: m(msg("Keep OpenBot current on this computer.")),
    icon: CircleArrowDown,
  },
];
export function SettingsPage({
  sections,
  initialSection,
  label: rawLabel,
}: {
  sections: readonly {
    id: string;
    title: string;
    description: string;
    icon: LucideIcon;
    content: ReactNode;
  }[];
  initialSection?: string | undefined;
  label?: string;
}) {
  const gt = useGT();
  const label = rawLabel ?? gt("Settings");
  const [selected, setSelected] = useState(initialSection ?? sections[0]?.id);
  const current = sections.find((section) => section.id === selected) ?? sections[0];
  const titleId = useId();
  const nav = useRef<HTMLElement>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Source SettingsDialogShell resets and measures the actual scrolling DOM when its panel changes.
  useLayoutEffect(() => {
    const element = scroll.current;
    if (!element || !current?.id) return;
    element.scrollTop = 0;
    const measure = () => {
      frame.current?.toggleAttribute("data-scroll-up", element.scrollTop > 1);
      frame.current?.toggleAttribute(
        "data-scroll-down",
        element.scrollTop + element.clientHeight < element.scrollHeight - 1,
      );
    };
    const stop = observeResize([element, ...(content.current ? [content.current] : [])], measure);
    element.addEventListener("scroll", measure);
    measure();
    return () => {
      stop();
      element.removeEventListener("scroll", measure);
    };
  }, [current?.id]);
  if (!current) return null;
  return (
    <div className="openbot-settings-page" aria-label={label}>
      <aside className="openbot-settings-nav">
        <div className="settings-page-nav-group">
          <nav
            ref={nav}
            className="settings-modal-nav"
            aria-label={`${label} sections`}
            onKeyDown={(event) => {
              if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
              event.preventDefault();
              const index = sections.findIndex((section) => section.id === current.id);
              const next =
                event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? sections.length - 1
                    : (index + (event.key === "ArrowDown" ? 1 : -1) + sections.length) %
                      sections.length;
              const section = sections[next];
              if (section) {
                setSelected(section.id);
                nav.current?.querySelectorAll<HTMLButtonElement>("button")[next]?.focus();
              }
            }}
          >
            {sections.map((section) => (
              <button
                key={section.id}
                type="button"
                className="settings-modal-nav-item"
                aria-current={section.id === current.id ? "page" : undefined}
                onClick={() => setSelected(section.id)}
              >
                <section.icon aria-hidden="true" />
                <span>{section.title}</span>
              </button>
            ))}
          </nav>
        </div>
      </aside>
      <section
        className="settings-modal settings-modal-page app-settings-modal-shell"
        aria-labelledby={titleId}
      >
        <div className="settings-modal-main">
          <header className="settings-modal-header">
            <div>
              <h2 id={titleId} className="settings-modal-title">
                {current.title}
              </h2>
              <p className="settings-modal-description">{current.description}</p>
            </div>
          </header>
          <div ref={frame} className="settings-modal-scroll-frame">
            <div ref={scroll} className="settings-modal-content">
              <div
                ref={content}
                className="settings-modal-tab-panel"
                data-tab={current.id}
                data-selected
              >
                {current.content}
              </div>
            </div>
          </div>
          <div className="settings-modal-footer" />
        </div>
      </section>
    </div>
  );
}
export function AppSettingsPage({
  panels,
  initialSection,
}: {
  panels: Readonly<Partial<Record<AppSettingsTab, ReactNode>>>;
  initialSection?: AppSettingsTab;
}) {
  return (
    <SettingsPage
      initialSection={initialSection}
      sections={appSettingsSections.flatMap((section) =>
        panels[section.id] === undefined ? [] : [{ ...section, content: panels[section.id] }],
      )}
    />
  );
}
