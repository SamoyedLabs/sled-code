import type {
  PrivilegedResponseRequest,
  PrivilegedResponseResult,
  PrivilegedResponseTarget,
} from "@t3tools/contracts/openbot-privileged-response";

export interface PrivilegedResponseScope {
  readonly principal: string;
  readonly environmentId: string;
  readonly hostId: string;
  readonly target: PrivilegedResponseTarget;
}
const sameScope = (a: PrivilegedResponseScope, b: PrivilegedResponseScope | null) =>
  b !== null &&
  a.principal === b.principal &&
  a.environmentId === b.environmentId &&
  a.hostId === b.hostId &&
  Object.keys(a.target).every(
    (key) =>
      a.target[key as keyof PrivilegedResponseTarget] ===
      b.target[key as keyof PrivilegedResponseTarget],
  );

export function createPrivilegedResponseController(
  scope: PrivilegedResponseScope,
  ports: {
    current(): PrivilegedResponseScope | null;
    execute(request: PrivilegedResponseRequest): Promise<PrivilegedResponseResult>;
  },
) {
  let nonce: string | null = null;
  let closed = false;
  let submitted = false;
  let busy = false;
  let generation = 0;
  const current = () => !closed && sameScope(scope, ports.current());
  return {
    clearForm() {
      generation += 1;
      if (!submitted) nonce = null;
    },
    close() {
      closed = true;
      nonce = null;
    },
    async prepare() {
      if (!current() || busy || submitted) return null;
      busy = true;
      const opened = generation;
      try {
        const result = await ports.execute({
          operation: "privilegedResponse.context",
          target: scope.target,
        });
        if (!current() || opened !== generation || result.status !== "pending") return null;
        nonce = result.nonce;
        return result;
      } finally {
        busy = false;
      }
    },
    async submit(
      response: Extract<
        PrivilegedResponseRequest,
        { operation: "privilegedResponse.respond" }
      >["response"],
    ) {
      if (!current() || !nonce || busy || submitted) return null;
      submitted = true;
      busy = true;
      const originalNonce = nonce;
      try {
        const result = await ports.execute({
          operation: "privilegedResponse.respond",
          target: scope.target,
          nonce: originalNonce,
          consent: true,
          response,
        });
        return current() && result.nonce === originalNonce ? result : null;
      } catch {
        return { nonce: originalNonce, status: "unknown" as const };
      } finally {
        busy = false;
      }
    },
    async result() {
      if (!current() || !nonce || busy || !submitted) return null;
      const originalNonce = nonce;
      const result = await ports.execute({
        operation: "privilegedResponse.result",
        target: scope.target,
        nonce: originalNonce,
      });
      return current() && result.nonce === originalNonce ? result : null;
    },
  };
}
