/* oxlint-disable shadcn/no-unknown-classes -- Pinned OpenBot selectors are supplied by the source stylesheets. */
import { useId, type ReactNode, type ButtonHTMLAttributes, type Ref } from "react";
import "./settings-primitives.css";
import "./settings-status.css";
import "./settings-fields.css";
import "./settings-modal.css";
import "./integration-layout.css";
import { SettingsGroup } from "../../../settings/SettingsGroup";
import { SearchIcon } from "lucide-react";
import { InputGroup, InputGroupAddon, InputGroupInput } from "../../../ui/input-group";

export function SettingsSearch({
  label,
  value,
  onChange,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: "text" | "search";
}) {
  return (
    <div className="server-settings-search w-60 max-w-full">
      <InputGroup>
        <InputGroupAddon>
          <SearchIcon aria-hidden className="size-4" />
        </InputGroupAddon>
        <InputGroupInput
          type={type}
          aria-label={label}
          placeholder={label}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      </InputGroup>
    </div>
  );
}

export function SourceButton({
  variant = "outline",
  size = "sm",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  ref?: Ref<HTMLButtonElement> | undefined;
  variant?: "outline" | "ghost" | "secondary" | "default" | "destructive-ghost" | "destructive";
  size?: "sm" | "xs" | "default";
}) {
  return (
    <button
      type="button"
      {...props}
      className={`ui-button ui-button-variant-${variant} ui-button-size-${size} ${className}`}
      data-variant={variant}
      data-size={size}
    />
  );
}
export function SettingsSection({
  title,
  children,
  actions,
  description,
}: {
  title: string;
  children: ReactNode;
  actions?: ReactNode;
  description?: ReactNode;
}) {
  const id = useId();
  return (
    <section className="min-w-0 space-y-3" aria-labelledby={id}>
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3 px-1">
        <div className="min-w-0 flex-1 space-y-1">
          <h3 id={id} className="text-balance text-sm font-medium text-foreground">
            {title}
          </h3>
          {description && (
            <p className="text-pretty text-xs leading-relaxed text-muted-foreground">
              {description}
            </p>
          )}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
    </section>
  );
}
export function SettingsCard({ children }: { children: ReactNode }) {
  return <SettingsGroup>{children}</SettingsGroup>;
}
export function SettingsRow({
  title,
  description,
  children,
  id,
}: {
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  id?: string;
}) {
  return (
    <div
      data-slot="settings-row"
      className="@container/bot-setting flex min-w-0 flex-wrap items-center justify-between gap-x-6 gap-y-3 px-4 py-3"
    >
      <div className="min-w-0 flex-1 basis-48 space-y-1">
        <div className="text-sm font-medium text-foreground" id={id}>
          {title}
        </div>
        {description && (
          <div className="text-pretty text-xs leading-relaxed text-muted-foreground">
            {description}
          </div>
        )}
      </div>
      {children && (
        <div className="flex max-w-full min-w-0 flex-wrap items-center gap-2">{children}</div>
      )}
    </div>
  );
}
