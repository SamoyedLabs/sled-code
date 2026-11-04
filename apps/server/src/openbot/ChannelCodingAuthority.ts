import { Context, Effect, Schema } from "effect";
import type { OpenbotChannelCodingBinding } from "@t3tools/contracts";
import type { Authority } from "./RemoteCoding.ts";

export class ChannelCodingIdentityError extends Schema.TaggedError<ChannelCodingIdentityError>()(
  "ChannelCodingIdentityError",
  { reason: Schema.Literals(["attestation", "owner"]), cause: Schema.optional(Schema.Defect()) },
) {}

/** Engine verifier output; request JSON and private host sessions are not attestations. */
export interface VerifiedChannelAssignment {
  readonly hostId: string;
  readonly binding: OpenbotChannelCodingBinding;
  readonly expiresAt: number;
}
export interface ChannelCodingIdentityPorts {
  /** Verify an engine-issued, assignment-scoped credential at its authenticated issuer. */
  readonly verify: (
    credential: string,
  ) => Effect.Effect<VerifiedChannelAssignment, ChannelCodingIdentityError>;
  /** Provisioned only from original authenticated Sled approval, never from channel JSON. */
  readonly owner: (
    hostId: string,
    binding: OpenbotChannelCodingBinding,
  ) => Effect.Effect<Authority | undefined, ChannelCodingIdentityError>;
}

export class ChannelCodingIdentity extends Context.Service<
  ChannelCodingIdentity,
  ChannelCodingIdentityPorts
>()("t3/openbot/ChannelCodingAuthority/ChannelCodingIdentity") {}

/** Returns original authority for the existing RemoteCoding revalidation/grant path. */
export const resolveChannelCodingOwner = Effect.fn("ChannelCoding.resolveOwner")(function* (
  hostId: string,
  binding: OpenbotChannelCodingBinding,
  credential: string,
  now: number,
) {
  const identity = yield* ChannelCodingIdentity;
  const verified = yield* identity.verify(credential);
  const fields = Object.keys(binding) as Array<keyof OpenbotChannelCodingBinding>;
  if (
    verified.hostId !== hostId ||
    !Number.isSafeInteger(verified.expiresAt) ||
    verified.expiresAt <= now ||
    fields.some((key) => verified.binding[key] !== binding[key])
  )
    return yield* new ChannelCodingIdentityError({ reason: "attestation" });
  const owner = yield* identity.owner(hostId, verified.binding);
  if (!owner) return yield* new ChannelCodingIdentityError({ reason: "owner" });
  return owner;
});
