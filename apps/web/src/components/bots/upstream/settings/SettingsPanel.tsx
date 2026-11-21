/* oxlint-disable shadcn/no-unknown-classes -- Original SettingsPanel selectors are supplied by source CSS. */
import { useId, useLayoutEffect, useRef, type ReactNode, type Ref } from "react";
import { ArrowLeft, ChevronRight, X } from "lucide-react";
import { Button } from "../../../ui/button";
import { cn } from "../../../../lib/utils";
import { observeResize } from "../../../../lib/observeResize";
import { SourceButton } from "./SettingsParts";
import "./settings-panel.css";
import { useGT } from "gt-react";

export function SettingsPanelHeader({
  title,
  onBack,
  backLabel: rawBackLabel,
  onClose,
  closeLabel: rawCloseLabel,
  paneRoot = false,
}: {
  title: ReactNode;
  onBack?: (() => void) | undefined;
  backLabel?: string;
  onClose: () => void;
  closeLabel?: string;
  paneRoot?: boolean;
}) {
  const gt = useGT();
  const backLabel = rawBackLabel ?? gt("Back");
  const closeLabel = rawCloseLabel ?? gt("Close settings");
  return (
    <header
      data-pane-root={paneRoot || undefined}
      className={cn(
        "flex min-h-11 shrink-0 items-center gap-2 border-b border-border/60 px-3 py-1.5",
        paneRoot && "side-panel-pane-header",
      )}
    >
      {onBack ? (
        <Button variant="ghost-muted" size="icon-sm" aria-label={backLabel} onClick={onBack}>
          <ArrowLeft aria-hidden className="size-4" />
        </Button>
      ) : null}
      <h2 className="min-w-0 flex-1 truncate text-sm font-medium">{title}</h2>
      <span className="side-panel-pane-close inline-flex">
        <Button variant="ghost-muted" size="icon-sm" aria-label={closeLabel} onClick={onClose}>
          <X aria-hidden className="size-4" />
        </Button>
      </span>
    </header>
  );
}
export function SettingsPanelContent({
  children,
  embedded = false,
}: {
  children: ReactNode;
  embedded?: boolean;
}) {
  const scroll = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Source scroll fades track real scroll geometry, including nested page height changes.
  useLayoutEffect(() => {
    const element = scroll.current;
    if (!element) return;
    const measure = () => {
      element.classList.toggle("scroll-fade-top", element.scrollTop > 2);
      element.classList.toggle(
        "scroll-fade-bottom",
        element.scrollTop + element.clientHeight < element.scrollHeight - 2,
      );
    };
    const stop = observeResize([element, ...(content.current ? [content.current] : [])], measure);
    element.addEventListener("scroll", measure);
    measure();
    return () => {
      stop();
      element.removeEventListener("scroll", measure);
    };
  }, []);
  return (
    <div ref={scroll} className={embedded ? "min-w-0" : "settings-panel-content"}>
      <div ref={content}>{children}</div>
    </div>
  );
}
export function SettingsLinkGroup({
  title,
  inset = false,
  className = "",
  children,
}: {
  title?: ReactNode;
  inset?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const id = useId();
  const rows = (
    <div className={`settings-link-group ${className}${inset ? " settings-link-group-inset" : ""}`}>
      {children}
    </div>
  );
  return title ? (
    <section className="settings-link-section" aria-labelledby={id}>
      <h3 id={id} className="settings-link-section-title">
        {title}
      </h3>
      {rows}
    </section>
  ) : (
    rows
  );
}
export function SettingsLinkRow({
  icon,
  label,
  value,
  onClick,
  disabled = false,
  ref,
}: {
  icon?: ReactNode;
  label: ReactNode;
  value?: ReactNode;
  onClick: (trigger: HTMLButtonElement) => void;
  disabled?: boolean;
  ref?: Ref<HTMLButtonElement>;
}) {
  return (
    <SourceButton
      ref={ref}
      variant="ghost"
      className="settings-link"
      disabled={disabled}
      onClick={(event) => onClick(event.currentTarget)}
    >
      <span className="settings-link-label">
        {icon && <span className="settings-link-icon">{icon}</span>}
        <span className="settings-link-text ui-text-truncate">{label}</span>
      </span>
      <span className="settings-link-value">
        {typeof value === "string" ? (
          <span className="settings-link-text ui-text-truncate">{value}</span>
        ) : (
          value
        )}
        <ChevronRight aria-hidden="true" />
      </span>
    </SourceButton>
  );
}
