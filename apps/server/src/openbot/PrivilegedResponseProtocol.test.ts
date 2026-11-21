import { describe, expect, it } from "@effect/vitest";
import * as Schema from "effect/Schema";
import * as Effect from "effect/Effect";
import { dispatch } from "./PrivilegedResponseProtocol.ts";
class SyntheticFailure extends Schema.TaggedError<SyntheticFailure>()("SyntheticFailure", {
  value: Schema.String,
}) {}
const target = {
  agentId: "a",
  threadId: "t",
  turnId: "u",
  messageId: "m",
  blockId: "b",
  requestId: "r",
};
describe("dedicated privileged response transport", () => {
  it.effect(
    "refuses absent capability, unauthorized callers, excess fields and wrong receipts without leaking errors",
    () =>
      Effect.gen(function* () {
        const canary = "synthetic-private-value";
        const request = {
          operation: "privilegedResponse.respond",
          target,
          nonce: "n",
          consent: true,
          response: { actionId: "submit", values: { key: canary } },
        };
        const calls: string[] = [];
        const ports = {
          capabilities: new Set(["sled-privileged-responses-v1"]),
          authorize: () => Effect.void,
          post: (path: string, body: string) => {
            calls.push(path);
            expect(body).toContain(canary);
            return Effect.succeed({ nonce: "n", status: "answered", secret: canary });
          },
        };
        expect(yield* dispatch(request, ports)).toEqual({
          nonce: "n",
          status: "answered",
        });
        expect(calls).toEqual(["/v1/sled/privileged-responses/respond"]);
        for (const invalidPorts of [
          { ...ports, capabilities: new Set<string>() },
          { ...ports, authorize: () => Effect.fail(new SyntheticFailure({ value: canary })) },
          { ...ports, post: () => Effect.fail(new SyntheticFailure({ value: canary })) },
          { ...ports, post: () => Effect.succeed({ nonce: "other", status: "answered" }) },
        ]) {
          const exit = yield* Effect.exit(dispatch(request, invalidPorts));
          expect(exit._tag).toBe("Failure");
          expect(JSON.stringify(exit)).not.toContain(canary);
        }
        expect(
          (yield* Effect.exit(dispatch({ ...request, answers: { key: [canary] } }, ports)))._tag,
        ).toBe("Failure");
        expect(calls).toHaveLength(1);
      }),
  );
});
