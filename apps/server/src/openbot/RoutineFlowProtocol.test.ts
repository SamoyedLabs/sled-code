import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { OpenbotRoutineFlowCommand } from "@t3tools/contracts";
import * as RoutineFlowProtocol from "./RoutineFlowProtocol.ts";

const decodeCommand = Schema.decodeSync(OpenbotRoutineFlowCommand);

describe("released routine flow adapter", () => {
  it("preserves all touched agent identities and validates node coordinates", () => {
    expect(
      RoutineFlowProtocol.route({
        operation: "routineFlow.connect",
        routineId: "r",
        fromAgentId: "a",
        toAgentId: "b",
        instruction: "continue",
      }),
    ).toMatchObject({
      path: "/v1/routine-flows/links/connect",
      body: { routineId: "r", fromAgentId: "a", toAgentId: "b", instruction: "continue" },
    });
    expect(() =>
      decodeCommand({
        operation: "routineFlow.savePosition",
        agentId: "a",
        nodeKey: "agent:b",
        x: Infinity,
        y: 0,
      }),
    ).toThrow();
  });
  it.effect("retains unknown canvas state and rejects malformed step state", () =>
    Effect.gen(function* () {
      const canvas = {
        agentId: "a",
        routines: [],
        links: [],
        positions: [],
        placedAgentIds: [],
        futureRevision: 3,
      };
      expect(yield* RoutineFlowProtocol.project("routineFlow.canvas", canvas)).toEqual(canvas);
      const outcome = yield* Effect.exit(
        RoutineFlowProtocol.project("routineFlow.canvas", { ...canvas, routines: [{}] }),
      );
      expect(outcome._tag).toBe("Failure");
    }),
  );
});
