import { useContext, useRef, useState } from "react";
import { RegistryContext, useAtomValue } from "@effect/atom-react";
import { templateState } from "@t3tools/client-runtime/openbot/template-atoms";
import { templateIsRead, type TemplateRequest } from "@t3tools/contracts/openbot-templates";
import {
  templateStarted,
  templateFailed,
  templateResult,
  type TemplateActions,
} from "@t3tools/client-runtime/openbot/templates";
export function useBotTemplates(scopeKey: string, actions: TemplateActions) {
  const registry = useContext(RegistryContext);
  const atom = templateState(scopeKey);
  const state = useAtomValue(atom);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lock = useRef(false);
  const run = async (request: TemplateRequest) => {
    const current = registry.get(atom);
    if (lock.current || (!templateIsRead(request) && current.uncertain) || !actions.can(request))
      return;
    lock.current = true;
    setBusy(true);
    setError(null);
    const started = templateStarted(current, request);
    registry.set(atom, started);
    const next = await actions
      .execute(request)
      .then((value) => templateResult(registry.get(atom), request, value))
      .catch(() => null);
    registry.set(atom, next ?? templateFailed(started, request));
    if (!next)
      setError(
        templateIsRead(request)
          ? "Review unavailable. The host may lack this API, admin authority, or a signed-in account. No installation or publication was requested."
          : "Host outcome unknown. Reconcile on the destination host before another change. The original request remains retained in this client session.",
      );
    lock.current = false;
    setBusy(false);
    return next !== null;
  };
  return { state, busy, error, run };
}
