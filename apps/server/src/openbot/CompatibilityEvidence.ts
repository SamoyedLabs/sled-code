import {
  OpenbotCompatibilityEvidence,
  type OpenbotCompatibilityIdentity,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import { stableStringify } from "@t3tools/shared/relaySigning";
export class CompatibilityEvidenceError extends Schema.TaggedError<CompatibilityEvidenceError>()(
  "OpenbotCompatibilityEvidenceError",
  {
    reason: Schema.Literals(["storage", "identity", "incomplete"]),
    cause: Schema.optional(Schema.Defect()),
  },
) {}
const verified = Symbol("OpenbotCompatibilityVerified");
export interface VerifiedCompatibilityEvidence {
  readonly evidence: OpenbotCompatibilityEvidence;
  readonly [verified]: true;
}
export class CompatibilityEvidence extends Context.Service<
  CompatibilityEvidence,
  {
    readonly get: (
      runId: string,
    ) => Effect.Effect<OpenbotCompatibilityEvidence, CompatibilityEvidenceError>;
    readonly requireEligible: (
      runId: string,
      identity: OpenbotCompatibilityIdentity,
    ) => Effect.Effect<VerifiedCompatibilityEvidence, CompatibilityEvidenceError>;
  }
>()("t3/openbot/CompatibilityEvidence") {}
const isCompatibilityEvidenceError = Schema.is(CompatibilityEvidenceError);
export const layer = Layer.effect(
  CompatibilityEvidence,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const decode = Schema.decodeUnknownEffect(Schema.fromJsonString(OpenbotCompatibilityEvidence));
    const get = Effect.fn("CompatibilityEvidence.get")(
      function* (runId: string) {
        const rows = yield* sql<{
          readonly evidence_json: string | null;
        }>`SELECT evidence_json FROM openbot_compatibility_runs WHERE id=${runId}`;
        if (!rows[0]?.evidence_json)
          return yield* new CompatibilityEvidenceError({ reason: "incomplete" });
        return yield* decode(rows[0].evidence_json);
      },
      Effect.mapError((cause) =>
        isCompatibilityEvidenceError(cause)
          ? cause
          : new CompatibilityEvidenceError({ reason: "storage", cause }),
      ),
    );
    const requireEligible = Effect.fn("CompatibilityEvidence.requireEligible")(function* (
      runId: string,
      identity: OpenbotCompatibilityIdentity,
    ) {
      const evidence = yield* get(runId);
      if (stableStringify(evidence.identity) !== stableStringify(identity))
        return yield* new CompatibilityEvidenceError({ reason: "identity" });
      const required = [
        "source",
        "patches",
        "build",
        "transport",
        "desktop",
        "native",
        "profile-migration",
        "rollback",
      ];
      if (
        evidence.state !== "eligible" ||
        required.some(
          (kind) =>
            !evidence.checks.some((check) => check.kind === kind && check.outcome === "passed"),
        )
      )
        return yield* new CompatibilityEvidenceError({ reason: "incomplete" });
      return { evidence, [verified]: true as const };
    });
    return CompatibilityEvidence.of({ get, requireEligible });
  }),
);
