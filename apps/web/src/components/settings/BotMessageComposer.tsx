import { useEnvironmentIdentificationMode } from "~/hooks/useSettings";
import { useSidebarStageBackdropVariant } from "../SidebarStageBackdrop";
import type { ComponentProps, ReactNode } from "react";
import { ChevronDownIcon, SquareIcon } from "lucide-react";
import { ComposerSelectControl } from "../chat/ComposerControl";
import { Select, SelectPopup, SelectItem, SelectValue } from "../ui/select";
import { BotAvatar } from "../bots/avatar/BotAvatar";
import { ComposerSurface } from "../chat/ComposerSurface";
import { ComposerSendIcon, ComposerSubmitButton } from "../chat/ComposerSubmitButton";
import { ComposerVoiceInputButton, ComposerVoiceInputStatus } from "../chat/ComposerVoiceInput";
import { Spinner } from "../ui/spinner";
import { cn } from "~/lib/utils";
import type { useBotDictation } from "./BotDictation";
import "./bot-message-composer.css";

export function BotMessageComposer({ className, children, ...props }: ComponentProps<"form">) {
  return (
    <ComposerSurface.Shell data-bot-message-composer>
      <ComposerSurface.Host>
        <form className={cn("relative", className)} {...props}>
          <ComposerSurface.Main>{children}</ComposerSurface.Main>
        </form>
      </ComposerSurface.Host>
    </ComposerSurface.Shell>
  );
}

export function BotComposerInput({ children }: { children: ReactNode }) {
  return <div className="px-3.5 pt-3 pb-2">{children}</div>;
}

export function BotComposerFooter({
  children,
  actions,
}: {
  children?: ReactNode;
  actions: ReactNode;
}) {
  return (
    <ComposerSurface.Footer>
      {children ? <div className="me-2 flex shrink-0 items-center gap-1">{children}</div> : null}
      <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2">{actions}</div>
    </ComposerSurface.Footer>
  );
}

export function BotComposerVoice({
  voice,
  disabled,
}: {
  voice: ReturnType<typeof useBotDictation>;
  disabled: boolean;
}) {
  return <ComposerVoiceInputButton voice={voice} disabled={disabled} />;
}
export function BotComposerVoiceStatus({ voice }: { voice: ReturnType<typeof useBotDictation> }) {
  return <ComposerVoiceInputStatus voice={voice} />;
}

export function BotComposerSend({
  busy = false,
  stop,
  ...props
}: ComponentProps<"button"> & { busy?: boolean; stop?: boolean }) {
  const mode = useEnvironmentIdentificationMode();
  const backdropVariant = useSidebarStageBackdropVariant(mode);
  return (
    <ComposerSubmitButton
      backdropVariant={backdropVariant}
      type={stop ? "button" : "submit"}
      {...props}
    >
      {busy ? (
        <Spinner size="sm" aria-hidden="true" />
      ) : stop ? (
        <SquareIcon className="size-3 fill-current" aria-hidden="true" />
      ) : (
        <ComposerSendIcon />
      )}
    </ComposerSubmitButton>
  );
}

export function BotComposerRecipient({
  value,
  onChange,
  disabled,
  label,
  choices,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  label: string;
  choices: readonly {
    id: string;
    name: string;
    avatarSeed?: string | undefined;
    avatarHue?: number | null | undefined;
  }[];
}) {
  const current = choices.find((choice) => choice.id === value);
  return (
    <Select
      value={value}
      items={choices.map((choice) => ({ value: choice.id, label: choice.name }))}
      onValueChange={(next) => {
        if (next !== null) onChange(next);
      }}
      disabled={disabled}
    >
      <ComposerSelectControl aria-label={label} className="min-w-0 max-w-48">
        {current?.id ? (
          <BotAvatar
            seed={current.avatarSeed ?? current.id}
            hue={current.avatarHue ?? null}
            size={16}
          />
        ) : null}
        <SelectValue />
        <ChevronDownIcon className="size-3 text-muted-foreground" />
      </ComposerSelectControl>
      <SelectPopup side="top" align="end">
        {choices.map((choice) => (
          <SelectItem key={choice.id} value={choice.id}>
            {choice.name}
          </SelectItem>
        ))}
      </SelectPopup>
    </Select>
  );
}
