import { useRef, useLayoutEffect, type ComponentProps } from "react";
import { useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/reactivity";
import { privilegedTarget } from "@t3tools/client-runtime/openbot/privileged-target";
import type { PrivilegedResponseScope } from "@t3tools/client-runtime/openbot/privileged-response";
import { openbot } from "../../state/openbot";
import { useAtomCommand } from "../../state/use-atom-command";
import { BotUiBlock } from "./BotUiBlock";
import { BotPrivilegedResponse } from "./BotPrivilegedResponse";
type Props = ComponentProps<typeof BotUiBlock>;
export function BotResponseBlock(props: Props) {
  const target = privilegedTarget(props.snapshot, props.message);
  return target && !props.disabled ? (
    <SecureBlock {...props} binding={target} />
  ) : (
    <BotUiBlock {...props} />
  );
}
function SecureBlock({
  binding,
  ...props
}: Props & { binding: NonNullable<ReturnType<typeof privilegedTarget>> }) {
  const result = useAtomValue(
    openbot.privilegedScope({
      environmentId: props.environmentId,
      input: { hostId: props.hostId },
    }),
  );
  const allowed = useAtomValue(openbot.privilegedExecute.permissionAtom(props.environmentId));
  const execute = useAtomCommand(openbot.privilegedExecute, {
    reportFailure: false,
    reportDefect: false,
  });
  const scope: PrivilegedResponseScope | null =
    allowed &&
    AsyncResult.isSuccess(result) &&
    result.value.available &&
    result.value.environmentId === props.environmentId &&
    result.value.hostId === props.hostId
      ? {
          principal: result.value.principalId,
          environmentId: props.environmentId,
          hostId: props.hostId,
          target: binding.target,
        }
      : null;
  const current = useRef(scope);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- The external one-use controller must see the committed scope and lose it on unmount.
  useLayoutEffect(() => {
    current.current = scope;
    return () => {
      current.current = null;
    };
  }, [scope]);
  if (!scope) return <BotUiBlock {...props} />;
  return (
    <BotPrivilegedResponse
      scope={scope}
      spec={binding.spec}
      available
      current={() => current.current}
      execute={async (request) => {
        const response = await execute({
          environmentId: props.environmentId,
          input: { hostId: scope.hostId, principalId: scope.principal, request },
        });
        if (!AsyncResult.isSuccess(response)) throw new Error("Secure response unavailable");
        return response.value;
      }}
    />
  );
}
