import { createContext, useContext, useLayoutEffect, useState, type ReactNode } from "react";
import { useStableCallback } from "../../hooks/useStableCallback";

export type BotFileSelectionActions = {
  disabled: boolean;
  onQuote: (id: string, text: string) => void;
  onSend: (id: string, body: string) => Promise<boolean>;
};
export const BotFileSelectionContext = createContext<BotFileSelectionActions | null>(null);
const RegistrationContext = createContext<
  ((actions: BotFileSelectionActions) => () => void) | null
>(null);

// Key this workspace to the main conversation target: sibling Files must never address a previous chat.
export function BotFileSelectionWorkspace({ children }: { children: ReactNode }) {
  const [actions, setActions] = useState<BotFileSelectionActions | null>(null);
  const register = useStableCallback((next: BotFileSelectionActions) => {
    setActions(next);
    return () => setActions((current) => (current === next ? null : current));
  });
  return (
    <RegistrationContext value={register}>
      <BotFileSelectionContext value={actions}>{children}</BotFileSelectionContext>
    </RegistrationContext>
  );
}
export function usePublishBotFileSelection(enabled: boolean, actions: BotFileSelectionActions) {
  const register = useContext(RegistrationContext);
  const onQuote = useStableCallback(actions.onQuote);
  const onSend = useStableCallback(actions.onSend);
  const disabled = actions.disabled;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Register the mounted main conversation's guarded callbacks for the sibling Files pane; cleanup removes its authority before another target can use it.
  useLayoutEffect(() => {
    if (enabled && register) return register({ disabled, onQuote, onSend });
  }, [enabled, register, disabled, onQuote, onSend]);
}
