import { Effect, Exit } from "effect";
import { AuthSessionId, type OpenbotChannelCodingBinding } from "@t3tools/contracts";
import { expect, it } from "@effect/vitest";
import { ChannelCodingIdentity, resolveChannelCodingOwner } from "./ChannelCodingAuthority.ts";

const binding: OpenbotChannelCodingBinding = {
  channelId: "channel",
  taskId: "task",
  taskRevision: 1,
  assignmentId: "assignment",
  agentId: "agent",
  turnId: "turn",
  requestMessageId: "request",
  requesterId: "person",
  operationId: "operation",
};
const owner = {
  kind: "session" as const,
  sessionId: AuthSessionId.make("original-session"),
  limits: { runtimeMode: "full-access" as const, interactionMode: "default" as const },
};

it.effect(
  "requires the exact issuer attestation and an original owner mapping before returning Sled authority",
  () =>
    Effect.gen(function* () {
      let lookups = 0;
      for (const mismatch of ["hostId", "expiresAt", ...Object.keys(binding)]) {
        const verified = { hostId: "host", binding: { ...binding }, expiresAt: 2_000 };
        if (mismatch === "hostId") verified.hostId = "other";
        else if (mismatch === "expiresAt") verified.expiresAt = 1_000;
        else Reflect.set(verified.binding, mismatch, mismatch === "taskRevision" ? 2 : "other");
        const result = yield* resolveChannelCodingOwner("host", binding, "credential", 1_000).pipe(
          Effect.provideService(ChannelCodingIdentity, {
            verify: () => Effect.succeed(verified),
            owner: () => {
              lookups++;
              return Effect.succeed(owner);
            },
          }),
          Effect.exit,
        );
        expect(Exit.isFailure(result)).toBe(true);
      }
      expect(lookups).toBe(0);
      const resolve = (mapped: boolean) =>
        resolveChannelCodingOwner("host", binding, "credential", 1_000).pipe(
          Effect.provideService(ChannelCodingIdentity, {
            verify: () => Effect.succeed({ hostId: "host", binding, expiresAt: 2_000 }),
            owner: () => Effect.succeed(mapped ? owner : undefined),
          }),
        );
      expect(Exit.isFailure(yield* resolve(false).pipe(Effect.exit))).toBe(true);
      expect(yield* resolve(true)).toEqual(owner);
    }),
);
