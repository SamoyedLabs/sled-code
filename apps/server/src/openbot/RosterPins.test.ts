import { assert, it } from "@effect/vitest";
import { AuthSessionId } from "@t3tools/contracts";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as SqlClient from "effect/sql/SqlClient";
import migrate from "../persistence/Migrations/098_OpenbotRosterPins.ts";
import { READ_ROSTER_PINS, SET_ROSTER_PINS, rosterPins } from "./RosterPins.ts";

it.effect(
  "isolates pins by signed pairing and bot host, and retains them across proof-bound renewal",
  () =>
    Effect.gen(function* () {
      yield* migrate;
      const sql = yield* SqlClient.SqlClient;
      const paired = { sessionId: AuthSessionId.make("one"), proofKeyThumbprint: "phone-one" };
      const renewed = { ...paired, sessionId: AuthSessionId.make("renewed") };
      const other = { sessionId: AuthSessionId.make("other"), proofKeyThumbprint: "phone-other" };
      const unsigned = { sessionId: AuthSessionId.make("unsigned") };
      const item = { kind: "channel", id: "fixture" };
      const read = { operation: READ_ROSTER_PINS, parameters: {} } as const;

      assert.deepEqual(yield* rosterPins(sql, paired, "host", read), {
        items: [],
        updatedAt: null,
      });
      const saved = yield* rosterPins(sql, paired, "host", {
        operation: SET_ROSTER_PINS,
        parameters: { items: [item] },
      });
      assert.deepEqual(yield* rosterPins(sql, renewed, "host", read), saved);
      for (const [session, hostId] of [
        [other, "host"],
        [paired, "another-host"],
        [unsigned, "host"],
      ] as const)
        assert.deepEqual(yield* rosterPins(sql, session, hostId, read), {
          items: [],
          updatedAt: null,
        });
      const duplicate = yield* Effect.exit(
        rosterPins(sql, paired, "host", {
          operation: SET_ROSTER_PINS,
          parameters: { items: [item, item] },
        }),
      );
      assert.isTrue(Exit.isFailure(duplicate));
      assert.deepEqual(yield* rosterPins(sql, paired, "host", read), saved);
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
);
